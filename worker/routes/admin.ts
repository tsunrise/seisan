import { Hono } from "hono";
import { createRemoteJWKSet, jwtVerify } from "jose";

import { type AppContext, type EnvWithIdentity, parseJson } from "../auth";
import { normalizedEmailSchema } from "../email";
import { ErrorResponse } from "../error";
import { BUILTIN_DEFAULT_LIMITS, LIMITS_STORE_NAME, LimitsDocument, type LimitsTarget } from "../limits";

type AdminAccessEnv = Env & {
  ADMIN_ACCESS_AUD?: string;
  ADMIN_ACCESS_TEAM_DOMAIN?: string;
};

export const adminApp = new Hono<EnvWithIdentity>();

adminApp.use("*", requireAdminAccess);

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
  return context.json(result.limits ?? BUILTIN_DEFAULT_LIMITS);
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
  const teamDomain = normalizeTeamDomain(env.ADMIN_ACCESS_TEAM_DOMAIN);
  if (!audience || !teamDomain) {
    return ErrorResponse.forbidden();
  }

  const token = context.req.header("Cf-Access-Jwt-Assertion");
  if (!token) {
    return ErrorResponse.forbidden();
  }

  try {
    const jwks = createRemoteJWKSet(new URL(`${teamDomain}/cdn-cgi/access/certs`));
    await jwtVerify(token, jwks, {
      audience,
      issuer: teamDomain,
    });
  } catch (error) {
    console.error("invalid Cloudflare Access JWT", { error });
    return ErrorResponse.forbidden();
  }

  await next();
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

function normalizeTeamDomain(value: string | undefined): string | null {
  const trimmed = value?.trim().replace(/\/+$/u, "");
  if (!trimmed) {
    return null;
  }
  try {
    return new URL(trimmed).origin;
  } catch {
    return null;
  }
}

function isLocalhostRequest(context: AppContext): boolean {
  const hostname = new URL(context.req.url).hostname;
  return ["localhost", "127.0.0.1", "::1"].includes(hostname);
}
