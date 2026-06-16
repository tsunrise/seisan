# RT-2 - High - Missing Origin and CSRF Protection on Cookie Mutations

Date: 2026-06-14 14:13:28 PDT
Commit: 25f932606bd064aa29331732e190ef814c8889e6
Resolution: Fixed

Cookie-authenticated mutation routes accept requests with forged or missing Origin headers. This allows non-browser clients to forge origins freely and creates browser-facing risk for same-site sibling origins or compromised subdomains, because the session cookie uses `SameSite=Lax`.

## Reproduce Steps

On the live local API at `http://localhost:5173/api/*`, I logged in as `victim-...@example.com` and replayed mutations with a valid session cookie and forged origins.

Observed results:

| Request | Forged Origin | Result |
| --- | --- | --- |
| `PUT /api/project` with `Content-Type: application/json` | `https://evil.example` | `201`, project created |
| `PUT /api/project` with `Content-Type: text/plain` containing JSON | `https://evil.waga.me` | `201`, project created |
| `POST /api/logout` | `https://evil.waga.me` | `204`, then `GET /api/whoami` returned `401` |

## Root Cause Analysis

The project route source includes a reminder to add Origin/CSRF checks before cookie-authenticated mutation routes become browser-facing. That check is not implemented.

`parseJson()` calls `context.req.json()` and validates the parsed body, but it does not require `Content-Type: application/json`. In local testing, a `text/plain` request body containing JSON was parsed and accepted.

Session cookies are `HttpOnly`, `Secure`, and `SameSite=Lax`, which helps against ordinary cross-site subresource requests, but it is not a substitute for server-side Origin validation on state-changing endpoints.

## Resolution

Implemented requireSameOriginWhenPresent middleware for browser-sent Origin headers and applied it to login verification, logout, and all unsafe project mutation routes. The middleware allows missing Origin, rejects malformed or cross-origin Origin with 403 forbidden, and leaves JSON parsing content-type agnostic. Focused verification passed: pnpm run typecheck:worker, pnpm run typecheck:test, and pnpm test -- test/auth.test.ts test/project.test.ts. Live local replay on clean Wrangler state confirmed: forged JSON PUT /api/project with Origin https://evil.example returned 403 forbidden; missing-Origin JSON PUT /api/project returned 201 created; forged text/plain JSON PUT /api/project with Origin https://evil.waga.me returned 403 forbidden; missing-Origin text/plain JSON PUT /api/project returned 201 created; forged POST /api/logout with Origin https://evil.waga.me returned 403 forbidden and GET /api/whoami still returned 200; missing-Origin POST /api/logout returned 204 and the following GET /api/whoami returned 401.
