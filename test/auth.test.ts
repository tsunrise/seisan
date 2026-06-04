import { env } from "cloudflare:workers";
import {
  createExecutionContext,
  runInDurableObject,
  waitOnExecutionContext,
} from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";

import {
  LOGIN_CODE_TTL_MS,
  LOGIN_RESEND_COOLDOWN_MS,
  SESSION_COOKIE_NAME,
  SESSION_TTL_SECONDS,
} from "../worker/constants";
import {
  generateLoginAttemptId,
  hashLoginCode,
  sha256Hex,
  signSessionToken,
} from "../worker/crypto";
import worker from "../worker/index";

const AUTH_SECRET = "test-auth-secret-at-least-32-bytes";
const LOGIN_EMAIL_FROM = "login@example.com";
const TURNSTILE_SECRET_KEY = "1x0000000000000000000000000000000AA";
const TURNSTILE_TOKEN = "test-turnstile-token";
const TURNSTILE_SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const ATTEMPT_ID_PATTERN = /^[0-9A-Za-z]{32}$/u;

interface TestEnv {
  env: Env;
  sentEmails: Array<{
    from: string;
    to: string;
    subject: string;
    text?: string;
    html?: string;
  }>;
  turnstileFetch: ReturnType<typeof vi.fn>;
}

function uniqueEmail(): string {
  return `test-${crypto.randomUUID()}@example.com`;
}

function makeEnv(allowedEmail = uniqueEmail(), turnstileSuccess = true): TestEnv {
  const sentEmails: TestEnv["sentEmails"] = [];
  const send = vi.fn(async (message: TestEnv["sentEmails"][number]) => {
    sentEmails.push(message);
    return { messageId: crypto.randomUUID() };
  });
  const turnstileFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    expect(String(input)).toBe(TURNSTILE_SITEVERIFY_URL);
    expect(init?.method).toBe("POST");
    const body = JSON.parse(String(init?.body)) as { secret: string; response: string };
    expect(body.secret).toBe(TURNSTILE_SECRET_KEY);
    expect(body.response).toBe(TURNSTILE_TOKEN);
    return Response.json({ success: turnstileSuccess, "error-codes": [] });
  });
  vi.stubGlobal("fetch", turnstileFetch);

  return {
    env: {
      ...env,
      AUTH_SECRET,
      LOGIN_EMAIL_FROM,
      TURNSTILE_SECRET_KEY,
      ALLOWED_LOGIN_EMAILS: allowedEmail,
      SEND_EMAIL: { send } as unknown as SendEmail,
    } as unknown as Env,
    sentEmails,
    turnstileFetch,
  };
}

async function dispatch(
  path: string,
  testEnv: Env,
  init: RequestInit = {},
  origin = "https://seisan.test",
): Promise<Response> {
  const apiPath = path.startsWith("/api/") ? path : `/api${path}`;
  const request = new Request(`${origin}${apiPath}`, init);
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

function loginAttemptBody(
  email: string,
  turnstileToken = TURNSTILE_TOKEN,
): {
  email: string;
  turnstileToken: string;
} {
  return { email, turnstileToken };
}

async function readLoginAttemptId(response: Response): Promise<string> {
  const body = (await response.json()) as { id?: unknown };
  expect(body.id).toEqual(expect.stringMatching(ATTEMPT_ID_PATTERN));
  return body.id as string;
}

function loginVerifyBody(
  email: string,
  code: string,
  id: string,
): { id: string; email: string; code: string } {
  return { id, email, code };
}

function getSessionToken(response: Response): string {
  const setCookie = response.headers.get("set-cookie") ?? "";
  const match = new RegExp(`${SESSION_COOKIE_NAME}=([^;]+)`).exec(setCookie);
  expect(match).not.toBeNull();
  return match?.[1] ?? "";
}

async function createVerifiedSession(testEnv: Env, email: string): Promise<string> {
  const attemptResponse = await dispatch(
    "/login/attempt",
    testEnv,
    jsonPost(loginAttemptBody(email)),
  );
  expect(attemptResponse.status).toBe(202);
  const attemptId = await readLoginAttemptId(attemptResponse);

  const emailText = (testEnv.SEND_EMAIL.send as unknown as ReturnType<typeof vi.fn>).mock
    .calls[0][0].text as string;
  const code = /\b(\d{6})\b/u.exec(emailText)?.[1];
  expect(code).toBeDefined();

  const verifyResponse = await dispatch(
    "/login/verify",
    testEnv,
    jsonPost(loginVerifyBody(email, code ?? "", attemptId)),
  );
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

  it("requires turnstile before sending login email", async () => {
    const email = uniqueEmail();
    const { env: testEnv, sentEmails, turnstileFetch } = makeEnv(email);
    const missingToken = await dispatch("/login/attempt", testEnv, jsonPost({ email }));

    expect(missingToken.status).toBe(400);
    expect(sentEmails).toHaveLength(0);
    expect(turnstileFetch).not.toHaveBeenCalled();

    const failedEnv = makeEnv(email, false);
    const failedTurnstile = await dispatch(
      "/login/attempt",
      failedEnv.env,
      jsonPost(loginAttemptBody(email)),
    );

    expect(failedTurnstile.status).toBe(400);
    expect(failedEnv.sentEmails).toHaveLength(0);
    expect(failedEnv.turnstileFetch).toHaveBeenCalledTimes(1);
  });

  it("returns generic success for non-allowlisted login attempts without sending email", async () => {
    const { env: testEnv, sentEmails, turnstileFetch } = makeEnv("allowed@example.com");
    const response = await dispatch(
      "/login/attempt",
      testEnv,
      jsonPost(loginAttemptBody("blocked@example.com")),
    );

    expect(response.status).toBe(202);
    await readLoginAttemptId(response);
    expect(sentEmails).toHaveLength(0);
    expect(turnstileFetch).toHaveBeenCalledTimes(1);
  });

  it("stores hashed login codes and sends email for allowlisted users", async () => {
    const email = uniqueEmail();
    const { env: testEnv, sentEmails } = makeEnv(email);
    const response = await dispatch("/login/attempt", testEnv, jsonPost(loginAttemptBody(email)));
    const attemptId = await readLoginAttemptId(response);

    expect(response.status).toBe(202);
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].to).toBe(email);

    const emailHash = await sha256Hex(email);
    const stub = env.LOGIN_ATTEMPT_STORE.getByName(emailHash);
    await runInDurableObject(stub, async (_instance, state) => {
      const migrationVersion = await state.storage.get<number>("dbMigrationVersion");
      expect(migrationVersion).toBe(2);

      const rows = state.storage.sql
        .exec<{
          attempt_id: string;
          code_hash: string;
          email: string;
          failed_attempts: number;
        }>(
          "SELECT attempt_id, code_hash, email, failed_attempts FROM login_attempts WHERE email_hash = ?",
          emailHash,
        )
        .toArray();
      expect(rows).toHaveLength(1);
      expect(rows[0].attempt_id).toBe(attemptId);
      expect(rows[0].email).toBe(email);
      expect(rows[0].failed_attempts).toBe(0);
      expect(rows[0].code_hash).not.toMatch(/\b\d{6}\b/u);
    });
  });

  it("returns generic success without sending during the resend cooldown", async () => {
    const email = uniqueEmail();
    const { env: testEnv, sentEmails } = makeEnv(email);

    const first = await dispatch("/login/attempt", testEnv, jsonPost(loginAttemptBody(email)));
    expect(first.status).toBe(202);
    await readLoginAttemptId(first);
    expect(sentEmails).toHaveLength(1);

    const second = await dispatch("/login/attempt", testEnv, jsonPost(loginAttemptBody(email)));
    expect(second.status).toBe(202);
    expect(await second.json()).toEqual({ ok: true });
    expect(second.headers.get("retry-after")).toBeNull();
    expect(sentEmails).toHaveLength(1);
  });

  it("rejects wrong, expired, and over-attempted verification codes", async () => {
    const email = uniqueEmail();
    const { env: testEnv, sentEmails } = makeEnv(email);
    const attemptResponse = await dispatch(
      "/login/attempt",
      testEnv,
      jsonPost(loginAttemptBody(email)),
    );
    const attemptId = await readLoginAttemptId(attemptResponse);
    const code = /\b(\d{6})\b/u.exec(sentEmails[0].text ?? "")?.[1];
    expect(code).toBeDefined();

    const mismatchedId = await dispatch(
      "/login/verify",
      testEnv,
      jsonPost(loginVerifyBody(email, code ?? "", generateLoginAttemptId())),
    );
    expect(mismatchedId.status).toBe(401);

    const emailHash = await sha256Hex(email);
    await runInDurableObject(
      env.LOGIN_ATTEMPT_STORE.getByName(emailHash),
      async (_instance, state) => {
        const rows = state.storage.sql
          .exec<{
            failed_attempts: number;
          }>("SELECT failed_attempts FROM login_attempts WHERE email_hash = ?", emailHash)
          .toArray();
        expect(rows).toHaveLength(1);
        expect(rows[0].failed_attempts).toBe(0);
      },
    );

    const wrong = await dispatch(
      "/login/verify",
      testEnv,
      jsonPost(loginVerifyBody(email, "000000", attemptId)),
    );
    expect(wrong.status).toBe(401);

    for (let index = 0; index < 4; index += 1) {
      await dispatch(
        "/login/verify",
        testEnv,
        jsonPost(loginVerifyBody(email, "111111", attemptId)),
      );
    }

    await runInDurableObject(
      env.LOGIN_ATTEMPT_STORE.getByName(emailHash),
      async (_instance, state) => {
        const rows = state.storage.sql
          .exec<{
            failed_attempts: number;
          }>("SELECT failed_attempts FROM login_attempts WHERE email_hash = ?", emailHash)
          .toArray();
        expect(rows).toHaveLength(1);
        expect(rows[0].failed_attempts).toBe(5);
      },
    );

    const correctAfterFailureCap = await dispatch(
      "/login/verify",
      testEnv,
      jsonPost(loginVerifyBody(email, code ?? "", attemptId)),
    );
    expect(correctAfterFailureCap.status).toBe(401);

    await runInDurableObject(
      env.LOGIN_ATTEMPT_STORE.getByName(emailHash),
      async (_instance, state) => {
        state.storage.sql.exec(
          "UPDATE login_attempts SET last_sent_at = ? WHERE email_hash = ?",
          Date.now() - LOGIN_RESEND_COOLDOWN_MS - 1_000,
          emailHash,
        );
      },
    );

    const retryAfterFailureCap = await dispatch(
      "/login/attempt",
      testEnv,
      jsonPost(loginAttemptBody(email)),
    );
    expect(retryAfterFailureCap.status).toBe(202);
    expect(await retryAfterFailureCap.json()).toEqual({ ok: true });
    expect(sentEmails).toHaveLength(1);

    const expiredEmail = uniqueEmail();
    const expiredEnv = makeEnv(expiredEmail).env;
    const expiredEmailHash = await sha256Hex(expiredEmail);
    const expiredAttemptId = generateLoginAttemptId();
    const expiredCodeHash = await hashLoginCode(expiredEmail, "123456", AUTH_SECRET);
    await env.LOGIN_ATTEMPT_STORE.getByName(expiredEmailHash).createAttempt({
      emailHash: expiredEmailHash,
      attemptId: expiredAttemptId,
      email: expiredEmail,
      codeHash: expiredCodeHash,
      nowMs: Date.now() - LOGIN_CODE_TTL_MS - 1_000,
      expiresAtMs: Date.now() - 1_000,
    });

    const expired = await dispatch(
      "/login/verify",
      expiredEnv,
      jsonPost(loginVerifyBody(expiredEmail, "123456", expiredAttemptId)),
    );
    expect(expired.status).toBe(401);
  });

  it("verifies a correct code, consumes the attempt, and sets a session cookie", async () => {
    const email = uniqueEmail();
    const { env: testEnv, sentEmails } = makeEnv(email);

    const attemptResponse = await dispatch(
      "/login/attempt",
      testEnv,
      jsonPost(loginAttemptBody(email)),
    );
    const attemptId = await readLoginAttemptId(attemptResponse);
    const code = /\b(\d{6})\b/u.exec(sentEmails[0].text ?? "")?.[1];
    expect(code).toBeDefined();

    const response = await dispatch(
      "/login/verify",
      testEnv,
      jsonPost(loginVerifyBody(email, code ?? "", attemptId)),
    );
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

  it("allows a configured fixed code only for local dev login", async () => {
    const email = uniqueEmail();
    const { env: testEnv, sentEmails } = makeEnv("allowed@example.com");
    const localDevEnv = {
      ...testEnv,
      LOCAL_DEV_LOGIN_EMAILS: email,
      LOCAL_DEV_LOGIN_CODE: "123456",
    } as unknown as Env;

    const remoteAttempt = await dispatch(
      "/login/attempt",
      localDevEnv,
      jsonPost(loginAttemptBody(email)),
      "https://seisan.test",
    );
    expect(remoteAttempt.status).toBe(202);
    const remoteAttemptId = await readLoginAttemptId(remoteAttempt);
    expect(sentEmails).toHaveLength(0);

    const remoteVerify = await dispatch(
      "/login/verify",
      localDevEnv,
      jsonPost(loginVerifyBody(email, "123456", remoteAttemptId)),
      "https://seisan.test",
    );
    expect(remoteVerify.status).toBe(401);

    const localAttempt = await dispatch(
      "/login/attempt",
      localDevEnv,
      jsonPost({ email }),
      "http://127.0.0.1:5173",
    );
    expect(localAttempt.status).toBe(202);
    const localAttemptId = await readLoginAttemptId(localAttempt);
    expect(sentEmails).toHaveLength(0);

    const localWrongCode = await dispatch(
      "/login/verify",
      localDevEnv,
      jsonPost(loginVerifyBody(email, "000000", localAttemptId)),
      "http://127.0.0.1:5173",
    );
    expect(localWrongCode.status).toBe(401);

    const localVerify = await dispatch(
      "/login/verify",
      localDevEnv,
      jsonPost(loginVerifyBody(email, "123456", localAttemptId)),
      "http://127.0.0.1:5173",
    );
    expect(localVerify.status).toBe(200);
    expect(await localVerify.json()).toEqual({ ok: true });

    const token = getSessionToken(localVerify);
    const whoami = await dispatch("/whoami", localDevEnv, {
      headers: { Cookie: `${SESSION_COOKIE_NAME}=${token}` },
    });
    expect(whoami.status).toBe(200);
    expect(await whoami.json()).toEqual({ email });
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
