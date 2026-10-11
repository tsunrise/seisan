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

1. `POST /api/login/attempt` validates the email and, outside local dev, verifies Turnstile.
2. Login attempts reject emails matching the published `blocked_emails` policy, then validate the
   recipient domain through Cloudflare DNS over HTTPS before storing an attempt or sending a code.
3. Login verification rejects emails matching the published `blocked_emails` policy, then verifies
   the attempt ID, email, and code and sets the `__Host-seisan_session` cookie.
4. Authenticated browser requests use the session cookie.
5. `POST /api/logout` writes the session token hash to `REVOKED_TOKENS` and clears the cookie.

Session tokens are signed with `AUTH_SECRET`. Session revocation uses KV and is eventually consistent in the same way as other KV-backed checks.

Routes that do not authenticate with API keys:

- `GET /api/categories`
- `/api/login/*`
- `/api/logout`
- `/api/api-keys*`
- `POST /api/categories/classify`

`GET /api/categories` is a public read-only configuration route used by public project timelines.
The remaining routes in this list must not accept API keys. Login routes are public auth-creation
routes; logout and API-key management require session cookies. API-key management is intentionally
session-only so an API key cannot create, list, revoke, or roll API keys. Category classification
is session-only and also requires a same-origin `Origin` header (`requireSameOrigin`) because it is
a browser-only, Precursor-protected route that spends Workers AI budget; see
`docs/category-classification.md`.

## Login Attempts And Turnstile

Public auth endpoints live under `/api/login/*`.

Login attempt rules:

- Login attempt validation uses zod in `worker/routes/login.ts`.
- Login attempt and verification email inputs are limited to 255 characters and rejected before Turnstile, hashing, Durable Object, or Send Email work.
- Login attempts return an opaque attempt ID.
- Verification must include the attempt ID, email, and code.
- Keep login cooldown and failed-attempt state in `LoginAttemptStore`.
- Do not delete attempts on failed verification in a way that bypasses cooldowns.
- Login registration is not email-allowlisted. A syntactically valid email may request a code when
  its domain passes the mail-routing validation below and it does not match the published
  blocked-email regex policy.

Blocked-email rules:

- Both login-code requests and code verification check `blocked_emails` in
  `PUBLISHED_GLOBAL_CONFIG`; this also applies to local fixed-code login.
- Deployed login attempts verify Turnstile before checking the email policy, but blocked attempts
  are rejected before creating attempt state or sending email.
- A blocked request returns `403 { "error": "email_not_supported", "reason"?: string }`. The
  browser displays `This email is not supported.` and appends the configured reason when present.
- Missing, unreadable, or invalid published configuration fails open so a KV/configuration problem
  cannot prevent browser login. Failures are logged and the login path does not fall back to the
  strongly consistent Durable Object.
- The policy governs new browser sessions only. Existing sessions and API-key authentication are
  unaffected.
- Publication is eventually consistent and may take up to the GlobalConfig KV cache window to
  reach login requests. An already-issued code cannot create a session once the published policy
  observed by verification blocks its email.

Email-domain rules:

- Every login attempt validates the normalized recipient domain after Turnstile and blocked-email
  checks. This includes localhost fixed-code login, even though that path does not store an attempt
  or send email.
- Validation queries Cloudflare's `https://cloudflare-dns.com/dns-query` JSON endpoint for MX
  records. An ordinary MX record is accepted, while NXDOMAIN and explicit Null MX are rejected.
- If the domain has no MX record, validation queries A and AAAA concurrently and accepts either as
  SMTP's implicit-MX fallback. A domain with no MX, A, or AAAA record is rejected.
- Invalid domains return `403` with `error: "email_not_supported"` and the reason “The email domain
  does not appear to support receiving email. Check that the domain name is correct.” Temporary or
  inconclusive DNS failures return `503 { "error": "internal_server_error" }`. Neither result
  creates login-attempt state or sends email; DNS validation does not fail open.
- Login verification does not repeat DNS validation because no new email is sent on that path.
- Domain validation establishes only that DNS advertises a possible mail route. It does not prove
  that a recipient mailbox exists.

Turnstile rules:

- In deployed or otherwise non-local login attempts, the server must verify Turnstile before sending or storing a login code.
- In local dev, fixed-code login may bypass Turnstile only when `isLocalDevLogin()` accepts the localhost-style request.
- The frontend decides whether to render Turnstile with `import.meta.env.DEV`; do not use hostname checks in frontend code for that behavior.

Local fixed-code login is controlled by `LOCAL_DEV_LOGIN_CODE` and must only work for localhost-style requests.

For local fixed-code login, `/api/login/attempt` returns an attempt ID after domain validation
without storing an attempt or sending email. Local `/api/login/verify` accepts the configured fixed
code without consulting `LoginAttemptStore`.

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
- Admin routes, login/logout routes, API-key-management routes, and the browser-only category
  classification route are excluded from the generated spec.

When auth route behavior, auth schemas, auth bindings, or generated OpenAPI security schemes change, update this document and regenerate `public/openapi.json`.
