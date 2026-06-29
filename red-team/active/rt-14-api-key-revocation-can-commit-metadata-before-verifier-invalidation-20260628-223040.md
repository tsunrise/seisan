# RT-14 - Medium - API Key Revocation Can Commit Metadata Before Verifier Invalidation

Date: 2026-06-28 22:30:40 PDT
Commit: 7c452780551a0b06094be5be42d136c51716b2c3

API key revocation updates the source-of-truth SQL row before publishing the revoked verifier projection to KV. If the KV publish fails after the SQL update, key-management metadata can show the key as revoked while the hot-path API-key verifier still accepts the previous KV projection until a later successful publish or key expiry.

## Reproduce Steps

This is a source-backed failure-mode finding. The normal revocation path was exercised locally, and it behaved correctly when KV publication succeeded:

1. `POST /api/login/verify` as `redteam-api-1782710954976@example.com` with the local fixed code returned `200` and set a session cookie.
2. `POST /api/api-keys` with the session cookie returned `201` and key ID `WRovb3JSUjyQmtm0`.
3. `GET /api/whoami` with `Authorization: Bearer <apiKey>` returned `200`.
4. `DELETE /api/api-keys/WRovb3JSUjyQmtm0` with the session cookie returned `204`.
5. An immediate `GET /api/whoami` with the revoked bearer key returned `401`.

The failure condition is the same verifier publish error class observed during the live huge-expiry probe: the local Worker logged `failed to publish API key verification projection` and returned `500` when `ApiKeyVerificationKvStore.publish()` rejected the KV write. If that publish failure occurs during revocation after the SQL update, the old KV verifier projection remains the hot-path authentication source.

## Root Cause Analysis

`worker/do/UserAPIKeysStore.ts` mutates the source-of-truth row before invalidating the verifier projection. In `revokeKey()`, it computes `revokedAt`, executes `UPDATE api_keys SET revoked_at = ? WHERE id = ?`, then calls `ApiKeyVerificationKvStore.publish()` with `revokedAt` set.

If that publish returns `kv_write_failed`, `revokeKey()` returns the error without rolling back the SQL update, deleting the existing projection, scheduling a retry, or otherwise making verifier invalidation atomic with the metadata mutation.

The hot-path authenticator does not consult `UserAPIKeysStore`. `worker/auth.ts` verifies bearer credentials only through `ApiKeyVerificationKvStore.verify()`, and `worker/apiKey.ts` verifies by reading the KV projection for the key ID and comparing the stored hash, expiry, and `revokedAt`.

Meanwhile, `listKeys()` in `worker/do/UserAPIKeysStore.ts` reads the SQL row and `rowToMetadata()` returns `revokedAt`, so API-key management metadata can report the key as revoked while the previous KV projection still authenticates it until a later successful publish or expiry.
