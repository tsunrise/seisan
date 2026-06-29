# RT-13 - Medium - API Key Creation Lacks Quota And Expiry Bounds

Date: 2026-06-28 22:30:32 PDT
Commit: 7c452780551a0b06094be5be42d136c51716b2c3

An authenticated session can create API keys without a per-user count limit or maximum lifetime, causing durable-object rows and KV verifier projections to grow without a product-policy control. Live local probing created 31 active keys for one account, and a schema-accepted Number.MAX_SAFE_INTEGER expiration triggered a verifier publish failure and 500 response because the generated KV expirationTtl exceeded the runtime range.

## Reproduce Steps

Live local probe against `http://localhost:5173` on a fresh Wrangler state:

1. `POST /api/login/verify` as `redteam-api-1782710954976@example.com` with the local fixed code returned `200` and set a session cookie.
2. `POST /api/api-keys` with that session cookie and a one-hour expiration returned `201`, key ID `WRovb3JSUjyQmtm0`, and a 59-byte `seisan_v1_...` API key.
3. `GET /api/whoami` with `Authorization: Bearer <apiKey>` returned `200` and the same email identity.
4. Control checks behaved as expected: `GET /api/api-keys` with only bearer auth returned `401`; `POST /api/api-keys` with a hostile `Origin` returned `403`; `GET /api/whoami` with a valid cookie plus invalid bearer returned `401`.
5. Repeated `POST /api/api-keys` 30 more times with the same session cookie. All 30 requests returned `201`; none returned a quota, conflict, or rate-limit response.
6. `GET /api/api-keys` with the same session cookie returned `200` with `count: 31`.
7. `POST /api/api-keys` with `expiresAt: Number.MAX_SAFE_INTEGER` returned `500`. The local Worker log showed `failed to publish API key verification projection` with `TypeError: Value out of range. Must be between -2147483648 and 2147483647 (inclusive).`

## Root Cause Analysis

`worker/routes/apiKeys.ts` validates `expiresAt` only as a positive safe integer and checks only that it is later than `nowSeconds`. It does not enforce a maximum lifetime, per-user key count, or API-key creation rate limit before calling `UserAPIKeysStore.createKey()`.

`worker/do/UserAPIKeysStore.ts` also validates only that `expiresAt > createdAt` and that the randomly generated key ID is not already present in the user's shard. It inserts one SQL row and publishes one KV verifier projection per successful request, with no count query or product-limit check.

The product-limit model in `worker/limits.ts` defines project, record, and money limits, but no API-key count or lifetime limit, so admin-lowered limits cannot constrain this resource path.

The 500 response comes from `worker/apiKey.ts`: `ApiKeyVerificationKvStore.expirationTtl()` returns `expiresAt - nowSeconds` without capping to the KV/runtime-supported range. The API route accepts `Number.MAX_SAFE_INTEGER`, but `kv.put(..., { expirationTtl })` rejects that value and the route maps the publish failure to `internal_server_error`.
