import { getCookie } from "hono/cookie";
import type { Context, MiddlewareHandler } from "hono";
import { z } from "zod";

import { ApiKeyVerificationKvStore } from "./apiKey";
import { SESSION_COOKIE_NAME } from "./constants";
import { sha256Hex, verifySessionToken } from "./crypto";
import { ErrorResponse } from "./error";

export interface Identity {
  email: string;
}

export type EnvWithIdentity = {
  Bindings: Env;
  Variables: {
    identity: Identity | undefined;
  };
};

export type AppContext = Context<EnvWithIdentity>;

type AuthenticationResult = { ok: true; identity: Identity | null } | { ok: false };
type BearerAuthorization =
  | { status: "absent" }
  | { status: "present"; token: string }
  | { status: "invalid" };

export async function parseJson<T>(
  context: AppContext,
  schema: z.ZodSchema<T>,
): Promise<{ ok: true; data: T } | { ok: false }> {
  try {
    const body = await context.req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return { ok: false };
    }
    return { ok: true, data: parsed.data };
  } catch {
    return { ok: false };
  }
}

export function getSessionToken(context: AppContext): string | undefined {
  return getCookie(context, SESSION_COOKIE_NAME);
}

export async function authenticate(context: AppContext): Promise<Identity | null> {
  const result = await authenticateRequest(context);
  return result.ok ? result.identity : null;
}

export async function authenticateSession(context: AppContext): Promise<Identity | null> {
  const token = getSessionToken(context);
  if (!token) {
    return null;
  }

  const payload = await verifySessionToken(token, context.env.AUTH_SECRET);
  if (!payload) {
    return null;
  }

  const tokenHash = await sha256Hex(token);
  const revokedToken = await context.env.REVOKED_TOKENS.get(tokenHash, {
    cacheTtl: 60,
  });
  if (revokedToken !== null) {
    return null;
  }

  return { email: payload.email };
}

async function authenticateRequest(context: AppContext): Promise<AuthenticationResult> {
  const bearer = getBearerAuthorization(context);
  if (bearer.status === "invalid") {
    return { ok: false };
  }
  if (bearer.status === "present") {
    const verification = await new ApiKeyVerificationKvStore(
      context.env.API_KEY_VERIFICATION,
    ).verify(bearer.token);
    return verification.ok ? { ok: true, identity: { email: verification.email } } : { ok: false };
  }

  return { ok: true, identity: await authenticateSession(context) };
}

export function getRequiredIdentity(context: AppContext): Identity {
  const identity = context.get("identity");
  if (!identity) {
    throw new Error("Expected authenticated identity in context.");
  }
  return identity;
}

export const requireSameOriginWhenPresent: MiddlewareHandler<EnvWithIdentity> = async (
  context,
  next,
) => {
  const origin = context.req.header("Origin");
  if (origin === undefined) {
    // Allow non-browser requests
    await next();
    return;
  }

  if (!isCanonicalOrigin(origin) || origin !== new URL(context.req.url).origin) {
    return ErrorResponse.forbidden();
  }

  await next();
};

export const optionalAuth: MiddlewareHandler<EnvWithIdentity> = async (context, next) => {
  const result = await authenticateRequest(context);
  if (!result.ok) {
    return ErrorResponse.unauthorized();
  }

  context.set("identity", result.identity ?? undefined);
  await next();
};

export const requireAuth: MiddlewareHandler<EnvWithIdentity> = async (context, next) => {
  const result = await authenticateRequest(context);
  if (!result.ok || !result.identity) {
    return ErrorResponse.unauthorized();
  }

  context.set("identity", result.identity);
  await next();
};

export const requireSessionAuth: MiddlewareHandler<EnvWithIdentity> = async (context, next) => {
  const identity = await authenticateSession(context);
  if (!identity) {
    return ErrorResponse.unauthorized();
  }

  context.set("identity", identity);
  await next();
};

function getBearerAuthorization(context: AppContext): BearerAuthorization {
  const authorization = context.req.header("Authorization");
  if (authorization === undefined) {
    return { status: "absent" };
  }
  if (!/^Bearer\b/iu.test(authorization)) {
    return { status: "absent" };
  }

  const match = /^Bearer\s+(\S+)$/iu.exec(authorization);
  if (!match) {
    return { status: "invalid" };
  }
  return { status: "present", token: match[1] };
}

function isCanonicalOrigin(origin: string): boolean {
  try {
    return new URL(origin).origin === origin;
  } catch {
    return false;
  }
}
