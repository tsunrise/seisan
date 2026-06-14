# RT-2 - High - Missing Origin and CSRF Protection on Cookie Mutations

Date: 2026-06-14 14:13:28 PDT
Commit: 25f932606bd064aa29331732e190ef814c8889e6

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
