# Authentication

Seisan has two user authentication models:

- Browser session cookies for the web app and identity-management operations.
- Bearer API keys for no-browser API clients.

Both models resolve to the same runtime identity shape in Hono context:

```ts
{
  email: string;
}
```

## Browser Sessions

Browser sessions are created through the email-code login flow under `/api/login/*`.

Flow:

1. `POST /api/login/attempt` validates the email and, outside local dev, verifies Turnstile before sending a login code.
2. `POST /api/login/verify` verifies the attempt ID, email, and code, then sets the `__Host-seisan_session` cookie.
3. Authenticated browser requests use the session cookie.
4. `POST /api/logout` writes the session token hash to `REVOKED_TOKENS` and clears the cookie.

Session tokens are signed with `AUTH_SECRET`. Session revocation uses KV and is eventually consistent in the same way as other KV-backed checks.

Routes that do not authenticate with API keys:

- `/api/login/*`
- `/api/logout`
- `/api/api-keys*`

These routes must not accept API keys. Login routes are public auth-creation routes; logout and API-key management require session cookies. API-key management is intentionally session-only so an API key cannot create, list, revoke, or roll API keys.

## Login Attempts And Turnstile

Public auth endpoints live under `/api/login/*`.

Login attempt rules:

- Login attempt validation uses zod in `worker/auth.ts`.
- Login attempts return an opaque attempt ID.
- Verification must include the attempt ID, email, and code.
- Keep login cooldown and failed-attempt state in `LoginAttemptStore`.
- Do not delete attempts on failed verification in a way that bypasses cooldowns.
- Login registration is not email-allowlisted. Any syntactically valid email may request a code.

Turnstile rules:

- In deployed or otherwise non-local login attempts, the server must verify Turnstile before sending or storing a login code.
- In local dev, fixed-code login may bypass Turnstile only when `isLocalDevLogin()` accepts the localhost-style request.
- The frontend decides whether to render Turnstile with `import.meta.env.DEV`; do not use hostname checks in frontend code for that behavior.

Local fixed-code login is controlled by `LOCAL_DEV_LOGIN_CODE` and must only work for localhost-style requests.

For local fixed-code login, `/api/login/attempt` returns an attempt ID without storing an attempt or sending email. Local `/api/login/verify` accepts the configured fixed code without consulting `LoginAttemptStore`.

## API Keys

API keys are intended for direct `/api` usage from no-browser environments.

The Node CLI uses API keys for authenticated application routes. It resolves `SEISAN_API_KEY` first, then a per-environment saved key, and finally a hidden stdin prompt. Prompted keys are stored in macOS Keychain when available or in a mode-`0600` config file fallback. CLI `logout` only removes the saved key because the server `/api/logout` route is intentionally session-only.

Clients send one bearer credential:

```http
Authorization: Bearer seisan_v1_<keyId>_<secret>
```

Format:

```text
seisan_v1_[16 base64url chars]_[32 base64url chars]
```

Properties:

- Total size is 59 ASCII bytes.
- `keyId` is 12 random bytes encoded as 16 base64url characters.
- `secret` is 24 random bytes encoded as 32 base64url characters.
- The stored verifier is `sha256Hex(fullApiKey)`, compared with `timingSafeEqual`.
- A user may have at most `apikeys.max_keys` unrevoked, unexpired keys. The built-in default is 10.
- Requested key lifetime must not exceed `apikeys.max_expiry` seconds. The built-in default is 31,536,000 seconds, or 365 days.

`UserAPIKeysStore` is the source of truth for user API-key metadata. It is sharded per normalized email hash and stores key ID, email, hash, label, creation time, expiration time, revocation time, and projection publish state.

After a new key's verifier projection is published successfully, `UserAPIKeysStore` deletes that user's expired and revoked metadata rows. KV verifier entries are not part of this cleanup: expiration TTLs and published revocation markers continue to govern the authentication hot path.

`API_KEY_VERIFICATION` KV is only the hot-path verifier projection. Verification must not call `UserAPIKeysStore` or any other Durable Object.

KV verifier values contain:

```json
{
  "v": 1,
  "email": "user@example.com",
  "hash": "<sha256 hex of full API key>",
  "expiresAt": 1814136000,
  "revokedAt": null
}
```

Writes also set KV `expirationTtl` from the key expiration time, with the platform minimum handled in code. The value still stores `expiresAt` so verification can reject expired keys even if the KV value is still present.

## Verification Rules

Normal application API routes accept either bearer API-key auth or browser session auth:

- If `Authorization: Bearer ...` is present, verify it as an API key.
- If bearer auth is malformed or invalid, return `401`; do not fall back to a cookie.
- If no bearer auth is present, use the browser session cookie path.
- `optionalAuth` permits unauthenticated access only when no bearer credential was supplied.

`/api/whoami` supports both auth models. API-key authentication returns `{ email }`. Browser-session authentication also returns `sessionExpiresAt`, the session JWT expiration time in Unix seconds.

API-key revocation updates the source-of-truth row and republishes the KV verifier value with `revokedAt`. Revocation is eventually consistent globally because verifier reads are served from KV cache, but should converge within the configured KV cache window.

Keep auth identity in Hono context as `identity`. `requireAuth` requires a valid authenticated identity; `optionalAuth` permits unauthenticated public project reads when no bearer credential is supplied. See `docs/api-serving.md` for route middleware behavior.

Admin routes under `/api/admin/*` use Cloudflare Access in deployed environments and a localhost bypass in local development. They do not use browser session or API-key auth.

## OpenAPI

`public/openapi.json` is API-key-client oriented:

- It documents only bearer auth via `apiKeyBearer`.
- It must not mention the session cookie or `__Host-seisan_session`.
- `/api/whoami` is included as a bearer-auth endpoint even though the implementation also accepts session cookies. Its response schema keeps `sessionExpiresAt` optional because API-key-authenticated requests do not receive it.
- Admin routes, login/logout routes, and API-key-management routes are excluded from the generated spec.

When auth route behavior, auth schemas, auth bindings, or generated OpenAPI security schemes change, update this document and regenerate `public/openapi.json`.
