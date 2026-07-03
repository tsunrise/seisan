import { Hono } from "hono";
import { createRemoteJWKSet, jwtVerify } from "jose";

import { type AppContext, type EnvWithIdentity, parseJson } from "../auth";
import { normalizedEmailSchema } from "../email";
import { ErrorResponse } from "../error";
import {
  BUILTIN_DEFAULT_LIMITS,
  LIMITS_STORE_NAME,
  LIMIT_DEFINITIONS,
  LimitsDocument,
  type LimitsTarget,
} from "../limits";
import { PROJECTS_REGISTRY_NAME } from "../project";
import { categoryPocApp } from "./categoryPoc";
import type { AdminProjectSort } from "../do/ProjectsRegistry";

type AdminAccessEnv = Env & {
  ADMIN_ACCESS_AUD?: string;
  ADMIN_ACCESS_TEAM_DOMAIN?: string;
};

const DEFAULT_ADMIN_PAGE_LIMIT = 25;
const MAX_ADMIN_PAGE_LIMIT = 100;

export const adminApp = new Hono<EnvWithIdentity>();

adminApp.use("*", requireAdminAccess);

adminApp.route("/category-poc", categoryPocApp);

adminApp.get("/whoami", (context) => {
  return context.json({
    ok: true,
    email: context.get("identity")?.email ?? null,
    local: isLocalhostRequest(context),
  });
});

adminApp.get("/login", (context) => {
  return new Response(null, {
    status: 302,
    headers: {
      "Cache-Control": "no-store",
      Location: parseAdminLoginReturnTo(context.req.query("returnTo")),
    },
  });
});

adminApp.get("/projects", async (context) => {
  const page = parsePageQuery(context);
  const ownerEmail = parseOwnerEmailQuery(context.req.query("ownerEmail"));
  const sort = parseProjectSortQuery(context.req.query("sort"), context.req.query("recordOrder"));
  if (!page || ownerEmail === "invalid" || !sort) {
    return ErrorResponse.invalidRequest();
  }

  const result = await context.env.PROJECTS_REGISTRY.getByName(
    PROJECTS_REGISTRY_NAME,
  ).adminListProjects({
    ...page,
    ...(ownerEmail ? { ownerEmail } : {}),
    sort,
  });
  if (!result.ok) {
    return ErrorResponse.invalidRequest();
  }
  return context.json({ projects: result.projects, page: result.page });
});

adminApp.get("/users", async (context) => {
  const page = parsePageQuery(context);
  if (!page) {
    return ErrorResponse.invalidRequest();
  }

  const result =
    await context.env.PROJECTS_REGISTRY.getByName(PROJECTS_REGISTRY_NAME).adminListOwners(page);
  if (!result.ok) {
    return ErrorResponse.invalidRequest();
  }
  return context.json({ users: result.users, page: result.page });
});

adminApp.get("/limits/built-in", (context) => {
  return context.json(BUILTIN_DEFAULT_LIMITS);
});

adminApp.get("/limits-schema", getLimitsSchema);

adminApp.get("/limits/default", async (context) => {
  return getLimits(context, { type: "default" });
});

adminApp.put("/limits/default", async (context) => {
  return putLimits(context, { type: "default" });
});

adminApp.get("/limits/user/:email", async (context) => {
  const target = parseUserTarget(context.req.param("email"));
  if (!target) {
    return ErrorResponse.invalidRequest();
  }
  return getLimits(context, target);
});

adminApp.put("/limits/user/:email", async (context) => {
  const target = parseUserTarget(context.req.param("email"));
  if (!target) {
    return ErrorResponse.invalidRequest();
  }
  return putLimits(context, target);
});

async function getLimits(context: AppContext, target: LimitsTarget): Promise<Response> {
  const result = await context.env.LIMITS_STORE.getByName(LIMITS_STORE_NAME).getLimits(target);
  if (!result.ok) {
    return ErrorResponse.invalidRequest();
  }
  return context.json(result.limits ?? {});
}

function getLimitsSchema(context: AppContext): Response {
  return context.json(LIMIT_DEFINITIONS);
}

async function putLimits(context: AppContext, target: LimitsTarget): Promise<Response> {
  const parsed = await parseJson(context, LimitsDocument);
  if (!parsed.ok) {
    return ErrorResponse.invalidRequest();
  }

  const result = await context.env.LIMITS_STORE.getByName(LIMITS_STORE_NAME).putLimits({
    target,
    limits: parsed.data,
    nowMs: Date.now(),
  });
  if (!result.ok) {
    return result.error === "kv_write_failed"
      ? ErrorResponse.internalServerError()
      : ErrorResponse.invalidRequest();
  }
  return new Response(null, { status: 204 });
}

async function requireAdminAccess(
  context: AppContext,
  next: () => Promise<void>,
): Promise<Response | void> {
  if (isLocalhostRequest(context)) {
    await next();
    return;
  }

  const env = context.env as AdminAccessEnv;
  const audience = env.ADMIN_ACCESS_AUD?.trim();
  const teamDomain = env.ADMIN_ACCESS_TEAM_DOMAIN;
  if (!audience || !teamDomain) {
    return ErrorResponse.forbidden();
  }

  const token = context.req.header("Cf-Access-Jwt-Assertion");
  if (!token) {
    return ErrorResponse.forbidden();
  }

  try {
    const jwks = createRemoteJWKSet(new URL(`${teamDomain}/cdn-cgi/access/certs`));
    const verified = await jwtVerify(token, jwks, {
      audience,
      issuer: teamDomain,
    });
    const email = parseAccessEmail(verified.payload.email);
    if (email) {
      context.set("identity", { email });
    }
  } catch (error) {
    console.error("invalid Cloudflare Access JWT", { error });
    return ErrorResponse.forbidden();
  }

  await next();
}

function parsePageQuery(context: AppContext): { limit: number; offset: number } | null {
  const limit = parseBoundedInteger(
    context.req.query("limit"),
    DEFAULT_ADMIN_PAGE_LIMIT,
    1,
    MAX_ADMIN_PAGE_LIMIT,
  );
  const offset = parseBoundedInteger(context.req.query("offset"), 0, 0, Number.MAX_SAFE_INTEGER);
  return limit === null || offset === null ? null : { limit, offset };
}

function parseBoundedInteger(
  value: string | undefined,
  defaultValue: number,
  min: number,
  max: number,
): number | null {
  if (value === undefined || value === "") {
    return defaultValue;
  }
  if (!/^\d+$/u.test(value)) {
    return null;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : null;
}

function parseOwnerEmailQuery(rawEmail: string | undefined): string | "invalid" | null {
  if (rawEmail === undefined || rawEmail === "") {
    return null;
  }
  const parsed = normalizedEmailSchema.safeParse(rawEmail);
  return parsed.success ? parsed.data : "invalid";
}

function parseProjectSortQuery(
  rawSort: string | undefined,
  legacyRecordOrder: string | undefined,
): AdminProjectSort | null {
  if (rawSort !== undefined && rawSort !== "") {
    return isAdminProjectSort(rawSort) ? rawSort : null;
  }
  if (legacyRecordOrder === undefined || legacyRecordOrder === "") {
    return "records_desc";
  }
  return legacyRecordOrder === "desc" ? "records_desc" : null;
}

function isAdminProjectSort(value: string): value is AdminProjectSort {
  return value === "records_desc" || value === "updated_desc" || value === "updated_asc";
}

function parseAccessEmail(value: unknown): string | null {
  const parsed = normalizedEmailSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function parseAdminLoginReturnTo(value: string | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/admin";
  }

  let returnTo: URL;
  try {
    returnTo = new URL(value, "https://seisan.local");
  } catch {
    return "/admin";
  }
  return returnTo.origin === "https://seisan.local"
    ? returnTo.pathname + returnTo.search + returnTo.hash
    : "/admin";
}

function parseUserTarget(rawEmail: string): LimitsTarget | null {
  let email: string;
  try {
    email = decodeURIComponent(rawEmail);
  } catch {
    return null;
  }

  const parsed = normalizedEmailSchema.safeParse(email);
  return parsed.success ? { type: "user", email: parsed.data } : null;
}

function isLocalhostRequest(context: AppContext): boolean {
  const hostname = new URL(context.req.url).hostname;
  return ["localhost", "127.0.0.1", "::1"].includes(hostname);
}
