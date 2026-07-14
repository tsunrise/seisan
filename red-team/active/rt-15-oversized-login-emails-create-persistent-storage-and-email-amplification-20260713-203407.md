# RT-15 - High - Oversized Login Emails Create Persistent Storage and Email Amplification

Date: 2026-07-13 20:34:07 PDT
Commit: b8176cccc86cb33a2f59d7dcb56b6fe2f994c035

The login email schemas accept multi-megabyte values. After Turnstile, each unique value is hashed, persisted in its own LoginAttemptStore Durable Object, and forwarded to Send Email, allowing bounded requests to amplify into durable storage, CPU, and email-binding work.

## Reproduce Steps

Live local API target: `http://127.0.0.1:5173/api/*`, running from a disposable Worker state.

Actor persona: an unauthenticated direct API client. The deployed path still requires a successful Turnstile token; the local fixed-code path was used only to prove the HTTP boundary accepts the oversized value.

1. Sent `POST /api/login/attempt` with `Content-Type: application/json` and an `email` value made from 8,388,608 `a` characters followed by `@example.com`. The complete JSON request was 8,388,632 bytes.
2. The endpoint returned `202` in 81 ms with `{"ok":true,"id":"2Rcp0NPn3P2o6SYDKQQUEVIiUvIgMOVU"}` instead of rejecting the email length.
3. `GET /api/ping` immediately afterward returned `200 Hello World`, so the bounded probe did not crash the local server.

Because localhost fixed-code login returns before Turnstile, Durable Object, and Send Email work, I separately exercised the deployed branch in the isolated Worker test runtime with a mocked successful Turnstile response and mocked Send Email binding. A one-megabyte email value produced `202`; the full value was passed as the email recipient, and `SELECT LENGTH(email)` in the corresponding `LoginAttemptStore` row equaled the full input length. The focused test passed in 3.40 seconds.

This is direct-client feasible. A deployed attacker needs a valid Turnstile token for each accepted login attempt, but each unique oversized value selects a distinct per-email Durable Object and reaches persistent storage and email work after that check.

## Root Cause Analysis

`worker/auth.ts:40-47` calls `context.req.json()` before applying the route schema, so the Worker buffers and parses the entire request body without an application-level byte limit.

`worker/routes/login.ts:40-43` and `worker/routes/login.ts:45-49` use `z.email()` without a maximum length for both login endpoints. The shared `normalizedEmailSchema` in `worker/email.ts:7` has the same unbounded shape, so there is no central email-size invariant.

On the deployed login-attempt path, `worker/routes/login.ts:76-91` verifies Turnstile, hashes the full email and login-code inputs, selects `LOGIN_ATTEMPT_STORE` by the email hash, and passes the full raw email into `createAttempt()`. `worker/do/LoginAttemptStore.ts:67-78` writes that email into SQLite. Unique expired attempts have no alarm-based cleanup; they remain until the same email hash is revisited by a later attempt or verification path.

Finally, `worker/routes/login.ts:97-112` forwards the same unbounded value as `SEND_EMAIL.send(...).to`. A single accepted request therefore combines large-body buffering, hashing/HMAC work, a separately sharded Durable Object write, persistent storage, and an email-binding attempt.
