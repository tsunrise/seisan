import { Hono } from "hono";
import { setCookie } from "hono/cookie";

import { LOGIN_CODE_TTL_MS, SESSION_COOKIE_NAME, SESSION_TTL_SECONDS } from "./constants";
import {
  type AppEnv,
  type AppContext,
  getSessionToken,
  isEmailAllowed,
  loginAttemptSchema,
  loginVerifySchema,
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

export { LoginAttemptStore };

const app = new Hono<AppEnv>();

function unauthorized() {
  return Response.json({ error: "unauthorized" }, { status: 401 });
}

function invalidRequest() {
  return Response.json({ error: "invalid_request" }, { status: 400 });
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
    context.header("Retry-After", String(attempt.retryAfterSeconds));
    return context.json({ error: "rate_limited" }, 429);
  }

  const emailMessage = buildLoginEmail({ code });
  try {
    await context.env.SEND_EMAIL.send({
      from: context.env.LOGIN_EMAIL_FROM,
      to: email,
      subject: emailMessage.subject,
      text: emailMessage.text,
      html: emailMessage.html,
    });
  } catch (error) {
    console.error("failed to send login email", error);
    return context.json({ error: "email_delivery_failed" }, 502);
  }

  console.log("email sent");

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

app.get("/whoami", requireAuth, (context) => {
  return context.json(context.get("identity"));
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

export default {
  fetch(request, env, executionContext) {
    return app.fetch(request, env, executionContext);
  },
} satisfies ExportedHandler<Env>;
