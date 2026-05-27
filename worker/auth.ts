import { getCookie } from "hono/cookie";
import type { Context, MiddlewareHandler } from "hono";
import { z } from "zod";

import { SESSION_COOKIE_NAME } from "./constants";
import { sha256Hex, verifySessionToken } from "./crypto";

export const loginAttemptSchema = z.object({
  email: z.email(),
});

export const loginVerifySchema = z.object({
  email: z.email(),
  code: z.string().regex(/^\d{6}$/u),
});

export interface Identity {
  email: string;
}

export type AppEnv = {
  Bindings: Env;
  Variables: {
    identity: Identity;
  };
};

export type AppContext = Context<AppEnv>;

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

export function isEmailAllowed(email: string, allowedEmails: string): boolean {
  return allowedEmails
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .includes(email);
}

export function getSessionToken(context: AppContext): string | undefined {
  return getCookie(context, SESSION_COOKIE_NAME);
}

export async function authenticate(context: AppContext): Promise<Identity | null> {
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

export const requireAuth: MiddlewareHandler<AppEnv> = async (context, next) => {
  const identity = await authenticate(context);
  if (!identity) {
    return context.json({ error: "unauthorized" }, 401);
  }

  context.set("identity", identity);
  await next();
};
