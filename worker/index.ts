import { Hono } from "hono";
import { setCookie } from "hono/cookie";

import { LOGIN_CODE_TTL_MS, SESSION_COOKIE_NAME, SESSION_TTL_SECONDS } from "./constants";
import {
  type AppEnv,
  type AppContext,
  getRequiredIdentity,
  getSessionToken,
  isEmailAllowed,
  loginAttemptSchema,
  loginVerifySchema,
  optionalAuth,
  parseJson,
  requireAuth,
} from "./auth";
import {
  generateLoginCode,
  hashLoginCode,
  sha256Hex,
  signSessionToken,
  verifySessionToken,
} from "./crypto";
import { buildLoginEmail } from "./email";
import { LoginAttemptStore } from "./do/LoginAttemptStore";
import { ProjectStore } from "./do/ProjectStore";
import { ProjectsRegistry } from "./do/ProjectsRegistry";
import {
  PROJECTS_REGISTRY_NAME,
  PROJECT_REGISTRY_CACHE_TTL_SECONDS,
  normalizeEmail,
  parseProjectRegistryCacheValue,
  parseMemberIdParam,
  parseRecordLimit,
  parseRecordOffset,
  projectAclEmailsSchema,
  projectAclTypeSchema,
  projectAppendRecordSchema,
  projectCreateSchema,
  projectIdSchema,
  projectJoinSchema,
  projectMemberCreateSchema,
  projectMemberPatchSchema,
  projectRegistryCacheKey,
  type ProjectRegistryCacheValue,
} from "./project";

export { LoginAttemptStore, ProjectStore, ProjectsRegistry };

const app = new Hono<AppEnv>();

function unauthorized() {
  return Response.json({ error: "unauthorized" }, { status: 401 });
}

function invalidRequest() {
  return Response.json({ error: "invalid_request" }, { status: 400 });
}

function notFound() {
  return Response.json({ error: "not_found" }, { status: 404 });
}

function forbidden() {
  return Response.json({ error: "forbidden" }, { status: 403 });
}

function conflict(error = "conflict") {
  return Response.json({ error }, { status: 409 });
}

function internalServerError() {
  return Response.json({ error: "internal_server_error" }, { status: 500 });
}

function setSessionCookie(context: AppContext, token: string): void {
  setCookie(context, SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

function clearSessionCookie(context: AppContext): void {
  setCookie(context, SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: 0,
  });
}

async function revokeToken(env: Env, token: string, expiresAtSeconds: number): Promise<void> {
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (expiresAtSeconds <= nowSeconds) {
    return;
  }

  const tokenHash = await sha256Hex(token);
  const expirationTtl = Math.max(1, expiresAtSeconds - nowSeconds);
  await env.REVOKED_TOKENS.put(tokenHash, "", { expirationTtl });
}

async function lookupProjectReference(
  context: AppContext,
  projectId: string,
): Promise<ProjectRegistryCacheValue | null> {
  const cacheKey = projectRegistryCacheKey(projectId);
  const cachedValue = await context.env.PROJECT_REGISTRY_CACHE.get(cacheKey, {
    cacheTtl: PROJECT_REGISTRY_CACHE_TTL_SECONDS,
  });
  if (cachedValue) {
    const cachedProject = parseProjectRegistryCacheValue(cachedValue);
    if (cachedProject) {
      return cachedProject;
    }
  }

  const registry = context.env.PROJECTS_REGISTRY.getByName(PROJECTS_REGISTRY_NAME);
  const lookup = await registry.lookupProject(projectId);
  if (!lookup.ok) {
    return null;
  }

  return { doId: lookup.doId };
}

async function getProjectStore(
  context: AppContext,
  rawProjectId: string,
): Promise<{
  projectId: string;
  store: DurableObjectStub<ProjectStore>;
} | null> {
  const parsedProjectId = projectIdSchema.safeParse(rawProjectId);
  if (!parsedProjectId.success) {
    return null;
  }

  const projectId = parsedProjectId.data;
  let projectReference = await lookupProjectReference(context, projectId);
  if (!projectReference) {
    return null;
  }

  try {
    return {
      projectId,
      store: context.env.PROJECT_STORE.get(
        context.env.PROJECT_STORE.idFromString(projectReference.doId),
      ),
    };
  } catch {
    // Fall back to the registry if a stale cache value no longer parses as a Durable Object ID.
  }

  const registry = context.env.PROJECTS_REGISTRY.getByName(PROJECTS_REGISTRY_NAME);
  const lookup = await registry.lookupProject(projectId);
  if (!lookup.ok) {
    return null;
  }

  projectReference = { doId: lookup.doId };
  try {
    return {
      projectId,
      store: context.env.PROJECT_STORE.get(
        context.env.PROJECT_STORE.idFromString(projectReference.doId),
      ),
    };
  } catch {
    return null;
  }
}

function isValidProjectId(rawProjectId: string): boolean {
  return projectIdSchema.safeParse(rawProjectId).success;
}

function mapAclAdminResult(
  result: { ok: true } | { ok: false; error: "uninitialized" | "forbidden" | "invalid_input" },
): Response {
  if (result.ok) {
    return new Response(null, { status: 204 });
  }
  if (result.error === "forbidden") {
    return forbidden();
  }
  return result.error === "uninitialized" ? notFound() : invalidRequest();
}

function mapProjectStoreError(error: string): Response {
  if (error === "uninitialized" || error === "not_found") {
    return notFound();
  }
  if (error === "forbidden") {
    return forbidden();
  }
  if (error === "already_linked" || error === "already_deleted" || error === "nonzero_balance") {
    return conflict(error);
  }
  return invalidRequest();
}

app.get("/ping", (context) => {
  console.log("ping called");
  return context.text("Hello World");
});

app.post("/login/attempt", async (context) => {
  const parsed = await parseJson(context, loginAttemptSchema);
  if (!parsed.ok) {
    return invalidRequest();
  }

  const { email } = parsed.data;
  if (!isEmailAllowed(email, context.env.ALLOWED_LOGIN_EMAILS)) {
    // silently ignore disallowed login email without letting the abusers know
    console.log("disallowed email silently ignored", { email });
    return context.json({ ok: true }, 202);
  }

  const nowMs = Date.now();
  const code = generateLoginCode();
  const emailHash = await sha256Hex(email);
  const codeHash = await hashLoginCode(email, code, context.env.AUTH_SECRET);
  const attempt = await context.env.LOGIN_ATTEMPT_STORE.getByName(emailHash).createAttempt({
    emailHash,
    email,
    codeHash,
    nowMs,
    expiresAtMs: nowMs + LOGIN_CODE_TTL_MS,
  });

  if (!attempt.ok) {
    return context.json({ ok: true }, 202);
  }

  const emailMessage = buildLoginEmail({ code });
  context.executionCtx.waitUntil(
    context.env.SEND_EMAIL.send({
      from: context.env.LOGIN_EMAIL_FROM,
      to: email,
      subject: emailMessage.subject,
      text: emailMessage.text,
      html: emailMessage.html,
    })
      .then(() => {
        console.log("email sent");
      })
      .catch((error: unknown) => {
        console.error("failed to send login email", error);
      }),
  );

  return context.json({ ok: true }, 202);
});

app.post("/login/verify", async (context) => {
  const parsed = await parseJson(context, loginVerifySchema);
  if (!parsed.ok) {
    return invalidRequest();
  }

  const { email, code } = parsed.data;
  if (!isEmailAllowed(email, context.env.ALLOWED_LOGIN_EMAILS)) {
    return unauthorized();
  }

  const emailHash = await sha256Hex(email);
  const codeHash = await hashLoginCode(email, code, context.env.AUTH_SECRET);
  const verification = await context.env.LOGIN_ATTEMPT_STORE.getByName(emailHash).verifyAttempt({
    emailHash,
    codeHash,
    nowMs: Date.now(),
  });

  if (!verification.ok) {
    return unauthorized();
  }

  const { token } = await signSessionToken(email, context.env.AUTH_SECRET);
  setSessionCookie(context, token);
  return context.json({ ok: true });
});

app.post("/logout", async (context) => {
  const token = getSessionToken(context);
  if (token) {
    const payload = await verifySessionToken(token, context.env.AUTH_SECRET, {
      ignoreExpiration: true,
    });
    if (payload) {
      await revokeToken(context.env, token, payload.exp);
    }
  }

  clearSessionCookie(context);
  return context.body(null, 204);
});

// Reminder: add an Origin/CSRF check before these cookie-authenticated mutation routes become browser-facing.
app.put("/project", requireAuth, async (context) => {
  const parsed = await parseJson(context, projectCreateSchema);
  if (!parsed.ok) {
    return invalidRequest();
  }

  const owner = normalizeEmail(getRequiredIdentity(context).email);
  const projectId = crypto.randomUUID();
  const projectDoId = context.env.PROJECT_STORE.newUniqueId();
  const projectDoIdString = projectDoId.toString();
  const project = context.env.PROJECT_STORE.get(projectDoId);
  const created = await project.initialize({
    acl: parsed.data.acl,
    ownerEmail: owner,
    ownerMemberName: parsed.data.ownerMemberName,
    nowMs: Date.now(),
  });
  if (!created.ok) {
    return internalServerError();
  }

  const registry = context.env.PROJECTS_REGISTRY.getByName(PROJECTS_REGISTRY_NAME);
  const registered = await registry.registerProject({
    id: projectId,
    doId: projectDoIdString,
    nowMs: Date.now(),
  });
  if (!registered.ok) {
    return internalServerError();
  }

  return context.json(
    { id: projectId, owner, acl: parsed.data.acl, members: created.members },
    201,
  );
});

app.get("/project/:id", optionalAuth, async (context) => {
  if (!isValidProjectId(context.req.param("id"))) {
    return notFound();
  }

  const limit = parseRecordLimit(context.req.query("limit"));
  const offset = parseRecordOffset(context.req.query("offset"));
  if (limit === null || offset === null) {
    return invalidRequest();
  }

  const projectLookup = await getProjectStore(context, context.req.param("id"));
  if (!projectLookup) {
    return notFound();
  }

  const result = await projectLookup.store.getRecords({
    callerEmail: context.get("identity")?.email,
    limit,
    offset,
  });
  if (!result.ok) {
    return result.error === "forbidden" ? forbidden() : notFound();
  }

  return context.json({
    id: projectLookup.projectId,
    owner: result.owner,
    acl: result.acl,
    members: result.members,
    records: result.records,
    balance: result.balance,
  });
});

app.post("/project/:id/acl/emails", requireAuth, async (context) => {
  if (!isValidProjectId(context.req.param("id"))) {
    return notFound();
  }

  const projectLookup = await getProjectStore(context, context.req.param("id"));
  if (!projectLookup) {
    return notFound();
  }
  const parsed = await parseJson(context, projectAclEmailsSchema);
  if (!parsed.ok) {
    return invalidRequest();
  }

  return mapAclAdminResult(
    await projectLookup.store.appendEmailsToAcl({
      callerEmail: getRequiredIdentity(context).email,
      emails: parsed.data.emails,
    }),
  );
});

app.delete("/project/:id/acl/emails", requireAuth, async (context) => {
  if (!isValidProjectId(context.req.param("id"))) {
    return notFound();
  }

  const projectLookup = await getProjectStore(context, context.req.param("id"));
  if (!projectLookup) {
    return notFound();
  }
  const parsed = await parseJson(context, projectAclEmailsSchema);
  if (!parsed.ok) {
    return invalidRequest();
  }

  return mapAclAdminResult(
    await projectLookup.store.removeEmailsFromAcl({
      callerEmail: getRequiredIdentity(context).email,
      emails: parsed.data.emails,
    }),
  );
});

app.put("/project/:id/acl/type", requireAuth, async (context) => {
  if (!isValidProjectId(context.req.param("id"))) {
    return notFound();
  }

  const projectLookup = await getProjectStore(context, context.req.param("id"));
  if (!projectLookup) {
    return notFound();
  }
  const parsed = await parseJson(context, projectAclTypeSchema);
  if (!parsed.ok) {
    return invalidRequest();
  }

  return mapAclAdminResult(
    await projectLookup.store.setAclType({
      callerEmail: getRequiredIdentity(context).email,
      type: parsed.data.type,
    }),
  );
});

app.post("/project/:id/members", requireAuth, async (context) => {
  if (!isValidProjectId(context.req.param("id"))) {
    return notFound();
  }

  const projectLookup = await getProjectStore(context, context.req.param("id"));
  if (!projectLookup) {
    return notFound();
  }
  const parsed = await parseJson(context, projectMemberCreateSchema);
  if (!parsed.ok) {
    return invalidRequest();
  }

  const result = await projectLookup.store.createMember({
    callerEmail: getRequiredIdentity(context).email,
    name: parsed.data.name,
    nowMs: Date.now(),
  });
  if (!result.ok) {
    return mapProjectStoreError(result.error);
  }
  return context.json({ member: result.member }, 201);
});

app.post("/project/:id/join", requireAuth, async (context) => {
  if (!isValidProjectId(context.req.param("id"))) {
    return notFound();
  }

  const parsed = await parseJson(context, projectJoinSchema);
  if (!parsed.ok) {
    return invalidRequest();
  }

  const projectLookup = await getProjectStore(context, context.req.param("id"));
  if (!projectLookup) {
    return notFound();
  }

  const result = await projectLookup.store.joinProject({
    callerEmail: getRequiredIdentity(context).email,
    join: parsed.data,
    nowMs: Date.now(),
  });
  if (!result.ok) {
    return mapProjectStoreError(result.error);
  }
  return context.json({ member: result.member }, 201);
});

app.patch("/project/:id/members/:memberId", requireAuth, async (context) => {
  if (!isValidProjectId(context.req.param("id"))) {
    return notFound();
  }

  const memberId = parseMemberIdParam(context.req.param("memberId"));
  if (memberId === null) {
    return notFound();
  }

  const parsed = await parseJson(context, projectMemberPatchSchema);
  if (!parsed.ok) {
    return invalidRequest();
  }

  const projectLookup = await getProjectStore(context, context.req.param("id"));
  if (!projectLookup) {
    return notFound();
  }

  const result = await projectLookup.store.patchMember({
    callerEmail: getRequiredIdentity(context).email,
    memberId,
    patch: parsed.data,
    nowMs: Date.now(),
  });
  if (!result.ok) {
    return mapProjectStoreError(result.error);
  }
  return context.json({ member: result.member });
});

app.delete("/project/:id/members/:memberId", requireAuth, async (context) => {
  if (!isValidProjectId(context.req.param("id"))) {
    return notFound();
  }

  const memberId = parseMemberIdParam(context.req.param("memberId"));
  if (memberId === null) {
    return notFound();
  }

  const projectLookup = await getProjectStore(context, context.req.param("id"));
  if (!projectLookup) {
    return notFound();
  }
  const result = await projectLookup.store.deleteMember({
    callerEmail: getRequiredIdentity(context).email,
    memberId,
    nowMs: Date.now(),
  });
  if (!result.ok) {
    return mapProjectStoreError(result.error);
  }
  return context.body(null, 204);
});

app.post("/project/:id", requireAuth, async (context) => {
  if (!isValidProjectId(context.req.param("id"))) {
    return notFound();
  }

  const parsed = await parseJson(context, projectAppendRecordSchema);
  if (!parsed.ok) {
    return invalidRequest();
  }

  const projectLookup = await getProjectStore(context, context.req.param("id"));
  if (!projectLookup) {
    return notFound();
  }

  const result = await projectLookup.store.postRecord({
    callerEmail: getRequiredIdentity(context).email,
    delta: parsed.data.delta,
    description: parsed.data.description,
    nowMs: Date.now(),
  });
  if (!result.ok) {
    return mapProjectStoreError(result.error);
  }

  return context.json({ id: result.id }, 201);
});

app.get("/whoami", requireAuth, (context) => {
  return context.json(getRequiredIdentity(context));
});

export default {
  fetch(request, env, executionContext) {
    return app.fetch(request, env, executionContext);
  },
} satisfies ExportedHandler<Env>;
