# RT-10 - Medium - Revoked Sessions Can Survive KV Negative Cache Windows

Date: 2026-06-15 22:55:07 PDT
Commit: 6f739cb9224893a68e05dedef76aa1d361ff5b08
Resolution: Risk Accepted

Session revocation is stored in KV, but authentication reads the revocation key with cacheTtl: 60. Cloudflare KV caches both existing values and negative lookups, so a token whose non-revoked state was read shortly before logout can remain accepted at an edge location until the cached negative lookup expires, despite the logout route writing a revocation marker.

## Reproduce Steps

This is a source-backed production risk. Local Wrangler did not reproduce the stale-cache behavior, which is expected because the local KV implementation does not faithfully model Cloudflare edge cache propagation.

Local replay at `http://localhost:5173/api/*`:

1. `POST /api/login/verify` as `revocation-1781589258116@example.com` with local code `123456`: returned `200` and set a session cookie.
2. `GET /api/whoami` with that cookie before logout: returned `200 {"email":"revocation-1781589258116@example.com"}`. This primes a non-revoked lookup for the token hash in `authenticate()`.
3. `POST /api/logout` with the same cookie: returned `204`.
4. `GET /api/whoami` with the old token after logout: returned `401 {"error":"unauthorized"}` locally.

Production source-backed behavior:

- `authenticate()` reads `REVOKED_TOKENS.get(tokenHash, { cacheTtl: 60 })`.
- Cloudflare KV documentation says KV reads can return stale values after recent writes, and its `cacheTtl` guidance states that both existing values and non-existent keys (negative lookups) are cached at the edge: https://developers.cloudflare.com/kv/api/read-key-value-pairs/
- If an attacker has a copied session token and that token's revocation key was read as absent shortly before logout at the same edge cache location, the logout route can write the revocation marker while a cached negative lookup remains usable until expiry.

Actor persona: an attacker with a stolen or copied session token, or a concurrent client still holding the pre-logout token. The observed local status was secure after logout, but the production risk follows from the code path and Cloudflare KV cache semantics.

## Root Cause Analysis

Logout revocation is stored out-of-band in KV:

- `loginApp.post("/logout")` extracts the session cookie, verifies the token ignoring expiration, and calls `revokeToken()`.
- `revokeToken()` writes the token hash to `REVOKED_TOKENS` until the session expiration.
- `authenticate()` verifies the JWT first, hashes the token, and then checks `REVOKED_TOKENS.get(tokenHash, { cacheTtl: 60 })`.

The revocation lookup is a write-after-read-sensitive security decision, but it is performed with an edge cache TTL. Before logout, a normal authenticated request for the token reads a missing revocation key. Because Cloudflare KV caches negative lookups, a later logout write may not immediately affect `authenticate()` at the same cache location. During that stale negative-cache window, possession of the token can still authenticate even though logout has completed.

The live local replay shows the intended behavior in Wrangler, but the deployed behavior depends on Cloudflare KV's documented edge caching model.

## Resolution

Not planned: the short stale-revocation window is accepted as a performance tradeoff. Revoked sessions may remain valid briefly when Cloudflare KV has cached a negative revocation lookup, and Seisan intentionally keeps the cached KV revocation read rather than adding a stronger immediate-consistency path.
