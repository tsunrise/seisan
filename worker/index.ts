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
  generateLoginAttemptId,
  generateLoginCode,
  hashLoginCode,
  sha256Hex,
  signSessionToken,
  timingSafeEqual,
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
  projectRenameSchema,
  type ProjectRegistryCacheValue,
  type ProjectSummary,
} from "./project";
import { verifyTurnstileToken } from "./turnstile";

export { LoginAttemptStore, ProjectStore, ProjectsRegistry };

const app = new Hono<AppEnv>();

interface LocalDevLoginConfig {
  emails: Set<string>;
  code: string;
}

type LocalDevLoginEnv = Env & {
  LOCAL_DEV_LOGIN_EMAILS?: string;
  LOCAL_DEV_LOGIN_CODE?: string;
};

function getLocalDevLoginConfig(context: AppContext): LocalDevLoginConfig | null {
  const hostname = new URL(context.req.url).hostname;
  if (!["localhost", "127.0.0.1", "::1"].includes(hostname)) {
    return null;
  }

  const env = context.env as LocalDevLoginEnv;
  const emails = (env.LOCAL_DEV_LOGIN_EMAILS ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  const code = env.LOCAL_DEV_LOGIN_CODE?.trim();
  if (emails.length === 0 || !code || !/^\d{6}$/u.test(code)) {
    return null;
  }

  return { emails: new Set(emails), code };
}

function isLocalDevLogin(context: AppContext, email: string, code?: string): boolean {
  const config = getLocalDevLoginConfig(context);
  if (!config || !config.emails.has(email)) {
    return false;
  }
  if (code === undefined) {
    return true;
  }
  return timingSafeEqual(code, config.code);
}

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

app.get("/api/ping", (context) => {
  console.log("ping called");
  return context.text("Hello World");
});

app.post("/api/login/attempt", async (context) => {
  const parsed = await parseJson(context, loginAttemptSchema);
  if (!parsed.ok) {
    return invalidRequest();
  }

  const { email } = parsed.data;
  const attemptId = generateLoginAttemptId();
  const isLocalDevAttempt = isLocalDevLogin(context, email);
  if (isLocalDevAttempt) {
    console.log("local dev login code requested", { email });
    return context.json({ ok: true, id: attemptId }, 202);
  } else if (!(await verifyTurnstileToken(context, parsed.data.turnstileToken))) {
    return invalidRequest();
  }

  if (!isEmailAllowed(email, context.env.ALLOWED_LOGIN_EMAILS)) {
    // silently ignore disallowed login email without letting the abusers know
    console.log("disallowed email silently ignored", { email });
    return context.json({ ok: true, id: attemptId }, 202);
  }

  const nowMs = Date.now();
  const code = generateLoginCode();
  const emailHash = await sha256Hex(email);
  const codeHash = await hashLoginCode(email, code, context.env.AUTH_SECRET);
  const attempt = await context.env.LOGIN_ATTEMPT_STORE.getByName(emailHash).createAttempt({
    emailHash,
    attemptId,
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

  return context.json({ ok: true, id: attempt.id }, 202);
});

app.post("/api/login/verify", async (context) => {
  const parsed = await parseJson(context, loginVerifySchema);
  if (!parsed.ok) {
    return invalidRequest();
  }

  const { id, email, code } = parsed.data;
  if (isLocalDevLogin(context, email, code)) {
    const { token } = await signSessionToken(email, context.env.AUTH_SECRET);
    setSessionCookie(context, token);
    return context.json({ ok: true });
  }

  if (!isEmailAllowed(email, context.env.ALLOWED_LOGIN_EMAILS)) {
    return unauthorized();
  }

  const emailHash = await sha256Hex(email);
  const codeHash = await hashLoginCode(email, code, context.env.AUTH_SECRET);
  const verification = await context.env.LOGIN_ATTEMPT_STORE.getByName(emailHash).verifyAttempt({
    emailHash,
    attemptId: id,
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

app.post("/api/logout", async (context) => {
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
app.put("/api/project", requireAuth, async (context) => {
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
    name: parsed.data.name,
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
    ownerEmail: owner,
    nowMs: Date.now(),
  });
  if (!registered.ok) {
    return internalServerError();
  }

  return context.json(
    {
      id: projectId,
      name: parsed.data.name,
      owner,
      acl: parsed.data.acl,
      members: created.members,
    },
    201,
  );
});

app.get("/api/projects", requireAuth, async (context) => {
  const identity = getRequiredIdentity(context);
  const registry = context.env.PROJECTS_REGISTRY.getByName(PROJECTS_REGISTRY_NAME);
  const listed = await registry.listProjects({ callerEmail: identity.email });
  if (!listed.ok) {
    return invalidRequest();
  }
  const projects =
    // TODO: this is not efficient. We should cache the balance (or even the entire projects) somewhere.
    (
      await Promise.all(
        listed.projects.map(async (projectReference): Promise<ProjectSummary | null> => {
          try {
            const store = context.env.PROJECT_STORE.get(
              context.env.PROJECT_STORE.idFromString(projectReference.doId),
            );
            const summary = await store.getProjectSummary({
              callerEmail: identity.email,
              publicId: projectReference.id,
            });
            return summary.ok ? summary.project : null;
          } catch {
            return null;
          }
        }),
      )
    )
      .filter((project): project is ProjectSummary => project !== null)
      .sort((left, right) => right.updatedAt - left.updatedAt);

  return context.json({ projects });
});

app.get("/api/project/:id", optionalAuth, async (context) => {
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
    name: result.name,
    owner: result.owner,
    acl: result.acl,
    members: result.members,
    records: result.records,
    balance: result.balance,
  });
});

app.patch("/api/project/:id", requireAuth, async (context) => {
  if (!isValidProjectId(context.req.param("id"))) {
    return notFound();
  }

  const parsed = await parseJson(context, projectRenameSchema);
  if (!parsed.ok) {
    return invalidRequest();
  }

  const projectLookup = await getProjectStore(context, context.req.param("id"));
  if (!projectLookup) {
    return notFound();
  }

  const result = await projectLookup.store.renameProject({
    callerEmail: getRequiredIdentity(context).email,
    name: parsed.data.name,
    nowMs: Date.now(),
  });
  if (!result.ok) {
    return mapProjectStoreError(result.error);
  }
  return context.json({ name: result.name });
});

app.post("/api/project/:id/acl/emails", requireAuth, async (context) => {
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

app.delete("/api/project/:id/acl/emails", requireAuth, async (context) => {
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

app.put("/api/project/:id/acl/type", requireAuth, async (context) => {
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

app.post("/api/project/:id/members", requireAuth, async (context) => {
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

app.post("/api/project/:id/join", requireAuth, async (context) => {
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
  // TODO: Replace this cross-DO membership sync, and the unlink/delete syncs below,
  // with a ProjectStore outbox/alarm so shutdown between RPCs cannot leave listings stale.
  const registered = await context.env.PROJECTS_REGISTRY.getByName(
    PROJECTS_REGISTRY_NAME,
  ).addProjectMember({
    id: projectLookup.projectId,
    email: getRequiredIdentity(context).email,
    nowMs: Date.now(),
  });
  if (!registered.ok) {
    return internalServerError();
  }
  return context.json({ member: result.member }, 201);
});

app.patch("/api/project/:id/members/:memberId", requireAuth, async (context) => {
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
  if (result.removedLinkedEmail) {
    const removed = await context.env.PROJECTS_REGISTRY.getByName(
      PROJECTS_REGISTRY_NAME,
    ).removeProjectMember({
      id: projectLookup.projectId,
      email: result.removedLinkedEmail,
    });
    if (!removed.ok) {
      return internalServerError();
    }
  }
  return context.json({ member: result.member });
});

app.delete("/api/project/:id/members/:memberId", requireAuth, async (context) => {
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
  if (result.removedLinkedEmail) {
    const removed = await context.env.PROJECTS_REGISTRY.getByName(
      PROJECTS_REGISTRY_NAME,
    ).removeProjectMember({
      id: projectLookup.projectId,
      email: result.removedLinkedEmail,
    });
    if (!removed.ok) {
      return internalServerError();
    }
  }
  return context.body(null, 204);
});

app.post("/api/project/:id", requireAuth, async (context) => {
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

app.get("/api/whoami", requireAuth, (context) => {
  return context.json(getRequiredIdentity(context));
});

export default {
  fetch(request, env, executionContext) {
    return app.fetch(request, env, executionContext);
  },
} satisfies ExportedHandler<Env>;
