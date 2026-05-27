import { env } from "cloudflare:workers";
import {
  createExecutionContext,
  runInDurableObject,
  waitOnExecutionContext,
} from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";

import { LOGIN_CODE_TTL_MS, SESSION_COOKIE_NAME, SESSION_TTL_SECONDS } from "../worker/constants";
import { hashLoginCode, sha256Hex, signSessionToken } from "../worker/crypto";
import worker from "../worker/index";

const AUTH_SECRET = "test-auth-secret-at-least-32-bytes";
const LOGIN_EMAIL_FROM = "login@example.com";

interface TestEnv {
  env: Env;
  sentEmails: Array<{
    from: string;
    to: string;
    subject: string;
    text?: string;
    html?: string;
  }>;
}

function uniqueEmail(): string {
  return `test-${crypto.randomUUID()}@example.com`;
}

function makeEnv(allowedEmail = uniqueEmail()): TestEnv {
  const sentEmails: TestEnv["sentEmails"] = [];
  const send = vi.fn(async (message: TestEnv["sentEmails"][number]) => {
    sentEmails.push(message);
    return { messageId: crypto.randomUUID() };
  });

  return {
    env: {
      ...env,
      AUTH_SECRET,
      LOGIN_EMAIL_FROM,
      ALLOWED_LOGIN_EMAILS: allowedEmail,
      SEND_EMAIL: { send } as unknown as SendEmail,
    } as unknown as Env,
    sentEmails,
  };
}

async function dispatch(path: string, testEnv: Env, init: RequestInit = {}): Promise<Response> {
  const request = new Request(`https://seisan.test${path}`, init);
  const context = createExecutionContext();
  const response = await worker.fetch(
    request as Request<unknown, IncomingRequestCfProperties>,
    testEnv,
    context,
  );
  await waitOnExecutionContext(context);
  return response;
}

function jsonPost(body: unknown, headers?: HeadersInit): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  };
}

function getSessionToken(response: Response): string {
  const setCookie = response.headers.get("set-cookie") ?? "";
  const match = new RegExp(`${SESSION_COOKIE_NAME}=([^;]+)`).exec(setCookie);
  expect(match).not.toBeNull();
  return match?.[1] ?? "";
}

async function createVerifiedSession(testEnv: Env, email: string): Promise<string> {
  const attemptResponse = await dispatch("/login/attempt", testEnv, jsonPost({ email }));
  expect(attemptResponse.status).toBe(202);

  const emailText = (testEnv.SEND_EMAIL.send as unknown as ReturnType<typeof vi.fn>).mock
    .calls[0][0].text as string;
  const code = /\b(\d{6})\b/u.exec(emailText)?.[1];
  expect(code).toBeDefined();

  const verifyResponse = await dispatch("/login/verify", testEnv, jsonPost({ email, code }));
  expect(verifyResponse.status).toBe(200);
  return getSessionToken(verifyResponse);
}

describe("auth worker", () => {
  it("returns the public ping response", async () => {
    const { env: testEnv } = makeEnv();
    const response = await dispatch("/ping", testEnv);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("Hello World");
  });

  it("rejects malformed request bodies with zod-backed validation", async () => {
    const { env: testEnv } = makeEnv();

    const badAttempt = await dispatch("/login/attempt", testEnv, jsonPost({ email: "bad" }));
    expect(badAttempt.status).toBe(400);
    expect(await badAttempt.json()).toEqual({ error: "invalid_request" });

    const badVerify = await dispatch(
      "/login/verify",
      testEnv,
      jsonPost({ email: "user@example.com", code: "12345" }),
    );
    expect(badVerify.status).toBe(400);
    expect(await badVerify.json()).toEqual({ error: "invalid_request" });
  });

  it("returns generic success for non-allowlisted login attempts without sending email", async () => {
    const { env: testEnv, sentEmails } = makeEnv("allowed@example.com");
    const response = await dispatch(
      "/login/attempt",
      testEnv,
      jsonPost({ email: "blocked@example.com" }),
    );

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ ok: true });
    expect(sentEmails).toHaveLength(0);
  });

  it("stores hashed login codes and sends email for allowlisted users", async () => {
    const email = uniqueEmail();
    const { env: testEnv, sentEmails } = makeEnv(email);
    const response = await dispatch("/login/attempt", testEnv, jsonPost({ email }));

    expect(response.status).toBe(202);
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].to).toBe(email);

    const emailHash = await sha256Hex(email);
    const stub = env.LOGIN_ATTEMPT_STORE.getByName(emailHash);
    await runInDurableObject(stub, async (_instance, state) => {
      const migrationVersion = await state.storage.get<number>("dbMigrationVersion");
      expect(migrationVersion).toBe(1);

      const rows = state.storage.sql
        .exec<{
          code_hash: string;
          email: string;
          failed_attempts: number;
        }>(
          "SELECT code_hash, email, failed_attempts FROM login_attempts WHERE email_hash = ?",
          emailHash,
        )
        .toArray();
      expect(rows).toHaveLength(1);
      expect(rows[0].email).toBe(email);
      expect(rows[0].failed_attempts).toBe(0);
      expect(rows[0].code_hash).not.toMatch(/\b\d{6}\b/u);
    });
  });

  it("returns generic success without sending during the resend cooldown", async () => {
    const email = uniqueEmail();
    const { env: testEnv, sentEmails } = makeEnv(email);

    const first = await dispatch("/login/attempt", testEnv, jsonPost({ email }));
    expect(first.status).toBe(202);
    expect(sentEmails).toHaveLength(1);

    const second = await dispatch("/login/attempt", testEnv, jsonPost({ email }));
    expect(second.status).toBe(202);
    expect(await second.json()).toEqual({ ok: true });
    expect(second.headers.get("retry-after")).toBeNull();
    expect(sentEmails).toHaveLength(1);
  });

  it("rejects wrong, expired, and over-attempted verification codes", async () => {
    const email = uniqueEmail();
    const { env: testEnv } = makeEnv(email);
    await dispatch("/login/attempt", testEnv, jsonPost({ email }));

    const wrong = await dispatch("/login/verify", testEnv, jsonPost({ email, code: "000000" }));
    expect(wrong.status).toBe(401);

    for (let index = 0; index < 4; index += 1) {
      await dispatch("/login/verify", testEnv, jsonPost({ email, code: "111111" }));
    }

    const emailHash = await sha256Hex(email);
    await runInDurableObject(
      env.LOGIN_ATTEMPT_STORE.getByName(emailHash),
      async (_instance, state) => {
        const rows = state.storage.sql
          .exec("SELECT email_hash FROM login_attempts WHERE email_hash = ?", emailHash)
          .toArray();
        expect(rows).toHaveLength(0);
      },
    );

    const expiredEmail = uniqueEmail();
    const expiredEnv = makeEnv(expiredEmail).env;
    const expiredEmailHash = await sha256Hex(expiredEmail);
    const expiredCodeHash = await hashLoginCode(expiredEmail, "123456", AUTH_SECRET);
    await env.LOGIN_ATTEMPT_STORE.getByName(expiredEmailHash).createAttempt({
      emailHash: expiredEmailHash,
      email: expiredEmail,
      codeHash: expiredCodeHash,
      nowMs: Date.now() - LOGIN_CODE_TTL_MS - 1_000,
      expiresAtMs: Date.now() - 1_000,
    });

    const expired = await dispatch(
      "/login/verify",
      expiredEnv,
      jsonPost({ email: expiredEmail, code: "123456" }),
    );
    expect(expired.status).toBe(401);
  });

  it("verifies a correct code, consumes the attempt, and sets a session cookie", async () => {
    const email = uniqueEmail();
    const { env: testEnv, sentEmails } = makeEnv(email);

    await dispatch("/login/attempt", testEnv, jsonPost({ email }));
    const code = /\b(\d{6})\b/u.exec(sentEmails[0].text ?? "")?.[1];
    expect(code).toBeDefined();

    const response = await dispatch("/login/verify", testEnv, jsonPost({ email, code }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(response.headers.get("set-cookie")).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");

    const emailHash = await sha256Hex(email);
    await runInDurableObject(
      env.LOGIN_ATTEMPT_STORE.getByName(emailHash),
      async (_instance, state) => {
        const rows = state.storage.sql
          .exec("SELECT email_hash FROM login_attempts WHERE email_hash = ?", emailHash)
          .toArray();
        expect(rows).toHaveLength(0);
      },
    );
  });

  it("whoami accepts valid tokens unless KV-revoked and rejects expired tokens", async () => {
    const email = uniqueEmail();
    const { env: testEnv } = makeEnv(email);
    const validToken = await createVerifiedSession(testEnv, email);

    const valid = await dispatch("/whoami", testEnv, {
      headers: { Cookie: `${SESSION_COOKIE_NAME}=${validToken}` },
    });
    expect(valid.status).toBe(200);
    expect(await valid.json()).toEqual({ email });

    const expiredToken = await signSessionToken(
      email,
      AUTH_SECRET,
      Date.now() - (SESSION_TTL_SECONDS + 10) * 1000,
    );
    const expired = await dispatch("/whoami", testEnv, {
      headers: { Cookie: `${SESSION_COOKIE_NAME}=${expiredToken.token}` },
    });
    expect(expired.status).toBe(401);

    const tokenHash = await sha256Hex(validToken);
    await testEnv.REVOKED_TOKENS.put(tokenHash, "", { expirationTtl: SESSION_TTL_SECONDS });
    const revoked = await dispatch("/whoami", testEnv, {
      headers: { Cookie: `${SESSION_COOKIE_NAME}=${validToken}` },
    });
    expect(revoked.status).toBe(401);
  });

  it("does not expose a sensitive whoami endpoint", async () => {
    const email = uniqueEmail();
    const { env: testEnv } = makeEnv(email);
    const token = await createVerifiedSession(testEnv, email);

    const response = await dispatch("/whoami/sensitive", testEnv, {
      headers: { Cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect(response.status).toBe(404);
  });

  it("logout writes revocation to KV, then clears the cookie", async () => {
    const email = uniqueEmail();
    const { env: testEnv } = makeEnv(email);
    const token = await createVerifiedSession(testEnv, email);
    const tokenHash = await sha256Hex(token);

    const response = await dispatch("/logout", testEnv, {
      method: "POST",
      headers: { Cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get("set-cookie")).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(await testEnv.REVOKED_TOKENS.get(tokenHash)).toBe("");
  });
});
