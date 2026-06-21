import { Hono } from "hono";
import { setCookie } from "hono/cookie";
import { z } from "zod";

import {
  type AppContext,
  type EnvWithIdentity,
  getRequiredIdentity,
  getSessionToken,
  parseJson,
  requireAuth,
  requireSameOriginWhenPresent,
} from "../auth";
import { LOGIN_CODE_TTL_MS, SESSION_COOKIE_NAME, SESSION_TTL_SECONDS } from "../constants";
import {
  generateLoginAttemptId,
  generateLoginCode,
  hashLoginCode,
  sha256Hex,
  signSessionToken,
  timingSafeEqual,
  verifySessionToken,
} from "../crypto";
import { normalizeEmail } from "../email";
import { ErrorResponse } from "../error";
import { verifyTurnstileToken } from "../turnstile";

interface LocalDevLoginConfig {
  code: string;
}

type LocalDevLoginEnv = Env & {
  LOCAL_DEV_LOGIN_CODE?: string;
};

const LoginAttempt = z.object({
  email: z.email().transform(normalizeEmail),
  turnstileToken: z.string().min(1).max(2048).optional(),
});

const LoginVerify = z.object({
  id: z.string().regex(/^[0-9A-Za-z]{32}$/u),
  email: z.email().transform(normalizeEmail),
  code: z.string().regex(/^\d{6}$/u),
});

export const loginApp = new Hono<EnvWithIdentity>();

loginApp.post("/login/attempt", async (context) => {
  const parsed = await parseJson(context, LoginAttempt);
  if (!parsed.ok) {
    return ErrorResponse.invalidRequest();
  }

  const { email } = parsed.data;
  const attemptId = generateLoginAttemptId();
  const isLocalDevAttempt = isLocalDevLogin(context);
  if (isLocalDevAttempt) {
    console.log("local dev login code requested", { email });
    return context.json({ ok: true, id: attemptId }, 202);
  } else if (!(await verifyTurnstileToken(context, parsed.data.turnstileToken))) {
    return ErrorResponse.invalidRequest();
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

  const emailMessage = buildLoginEmail({ code, loginLocation: getLoginLocation(context) });
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

loginApp.post("/login/verify", requireSameOriginWhenPresent, async (context) => {
  const parsed = await parseJson(context, LoginVerify);
  if (!parsed.ok) {
    return ErrorResponse.invalidRequest();
  }

  const { id, email, code } = parsed.data;
  if (isLocalDevLogin(context, code)) {
    const { token } = await signSessionToken(email, context.env.AUTH_SECRET);
    setSessionCookie(context, token);
    return context.json({ ok: true });
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
    return ErrorResponse.unauthorized();
  }

  const { token } = await signSessionToken(email, context.env.AUTH_SECRET);
  setSessionCookie(context, token);
  return context.json({ ok: true });
});

loginApp.post("/logout", requireSameOriginWhenPresent, async (context) => {
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

loginApp.get("/whoami", requireAuth, (context) => {
  return context.json(getRequiredIdentity(context));
});

function getLocalDevLoginConfig(context: AppContext): LocalDevLoginConfig | null {
  const hostname = new URL(context.req.url).hostname;
  if (!["localhost", "127.0.0.1", "::1"].includes(hostname)) {
    return null;
  }

  const env = context.env as LocalDevLoginEnv;
  const code = env.LOCAL_DEV_LOGIN_CODE?.trim();
  if (!code || !/^\d{6}$/u.test(code)) {
    return null;
  }

  return { code };
}

function isLocalDevLogin(context: AppContext, code?: string): boolean {
  const config = getLocalDevLoginConfig(context);
  if (!config) {
    return false;
  }
  if (code === undefined) {
    return true;
  }
  return timingSafeEqual(code, config.code);
}

function getLoginLocation(context: AppContext): string | null {
  const cf = context.req.raw.cf;
  const city = cleanLocationPart(cf?.city);
  const country = cleanLocationPart(cf?.country);
  const countryName = country ? formatCountry(country) : null;
  const parts = [city, countryName].filter((part) => part !== null);

  return parts.length > 0 ? parts.join(", ") : null;
}

function cleanLocationPart(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const cleaned = value.trim();
  return cleaned.length > 0 ? cleaned : null;
}

function formatCountry(countryCode: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(countryCode) ?? countryCode;
  } catch {
    return countryCode;
  }
}

function buildLoginEmail(input: { code: string; loginLocation: string | null }): {
  subject: string;
  text: string;
  html: string;
} {
  const locationText = input.loginLocation
    ? `\n\nThis sign-in request came from ${input.loginLocation}.`
    : "";
  const locationHtml = input.loginLocation
    ? `<p>This sign-in request came from ${escapeHtml(input.loginLocation)}.</p>`
    : "";

  return {
    subject: "Your Seisan login code",
    text: `Your Seisan login code is:\n\n${input.code}${locationText}\n\nIt expires in 10 minutes. If you did not request this, you can ignore this email.`,
    html: `<p>Your Seisan login code is:</p><p><strong style="display: inline-block; font-family: monospace; font-size: 32px; letter-spacing: 0.16em; line-height: 1.2;">${input.code}</strong></p>${locationHtml}<p>It expires in 10 minutes. If you did not request this, you can ignore this email.</p>`,
  };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return character;
    }
  });
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
