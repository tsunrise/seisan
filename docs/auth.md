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

Cookie-only operations:

- `/api/login/*`
- `/api/logout`
- `/api/api-keys*`

These routes must not accept API keys. API-key management is intentionally session-only so an API key cannot create, list, revoke, or roll API keys.

## API Keys

API keys are intended for direct `/api` usage from no-browser environments.

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

`/api/whoami` supports both auth models and returns the same identity response.

API-key revocation updates the source-of-truth row and republishes the KV verifier value with `revokedAt`. Revocation is eventually consistent globally because verifier reads are served from KV cache, but should converge within the configured KV cache window.

## OpenAPI

`public/openapi.json` is API-key-client oriented:

- It documents only bearer auth via `apiKeyBearer`.
- It must not mention the session cookie or `__Host-seisan_session`.
- Cookie-only identity and API-key-management routes are excluded from the generated spec.

When auth route behavior, auth schemas, auth bindings, or generated OpenAPI security schemes change, update this document and regenerate `public/openapi.json`.
