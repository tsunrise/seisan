# API Serving

Seisan serves API traffic from a Cloudflare module Worker using Hono. This document explains the request path, route composition, middleware contracts, and the patterns to follow when adding or changing API endpoints.

## Request Path

`wrangler.jsonc` points the Worker entrypoint at `worker/index.ts`. Cloudflare assets are configured with `run_worker_first` for `/api/*`, so API requests enter the Worker before asset handling. Non-API browser routes are handled by the built asset pipeline with single-page-app fallback.

Runtime flow:

1. Cloudflare calls the module Worker `fetch(request, env, executionContext)` in `worker/index.ts`.
2. The handler delegates to `app.fetch(request, env, executionContext)`.
3. `worker/app.ts` owns the shared `Hono<EnvWithIdentity>` instance and mounts route modules.
4. Route handlers validate HTTP inputs, apply auth middleware, call KV, Durable Object, Cache API, rate-limit, or email bindings, and return `Response` objects.

Keep `worker/index.ts` thin. It should export Durable Object classes and delegate HTTP handling to `worker/app.ts`.

## Hono App Composition

`worker/app.ts` is the route-composition layer:

- `app.route("/api/admin", adminApp)` mounts admin-only routes behind Cloudflare Access or localhost bypass.
- `app.route("/api", loginApp)` mounts `/api/login/*`, `/api/logout`, and `/api/whoami`.
- `app.route("/api", apiKeysApp)` mounts cookie-only API-key management routes under `/api/api-keys*`.
- `app.route("/api", registryApp)` mounts `/api/registry`.
- `app.route("/api", categoryApp)` mounts authenticated `/api/categories` reads and classification.
- `app.route("/api", projectApp)` mounts `/api/project*`.
- `app.get("/api/ping", ...)` provides the plain-text health check.

Prefer new route modules under `worker/routes/` when an area has more than a trivial number of handlers. Use `new Hono<EnvWithIdentity>()` for sub-apps so bindings and Hono variables stay typed.

Mount paths are part of the public API surface. Before changing a mount point, check browser calls in `src/api/`, CLI calls in `scripts/client.ts`, tests, and `public/openapi.json` generation.

## Route Module Responsibilities

Route modules should stay close to HTTP concerns:

- Parse path params, query params, and JSON bodies.
- Apply route-local middleware in the handler list.
- Normalize boundary values such as emails, project names, and member names.
- Load product limits or other policy inputs needed by the HTTP operation.
- Call the authoritative Durable Object or KV-backed store.
- Map expected domain result unions to stable HTTP errors.
- Queue best-effort post-response work with `context.executionCtx.waitUntil(...)`.

Push reusable domain validation and record/project derivation into `worker/project.ts`, `worker/auth.ts`, focused store/policy classes, or Durable Object methods. Keep Durable Object methods responsible for state ownership, access checks, transactional writes, and public RPC input validation.

## Middleware

API middleware lives mainly in `worker/auth.ts` and sets the request identity on Hono context as `identity`.

`requireAuth` accepts either a valid bearer API key or a valid session cookie. If an `Authorization: Bearer ...` header is present but malformed or invalid, it returns `401` and does not fall back to cookies.

`optionalAuth` uses the same authentication logic as `requireAuth`, but allows no credential and stores `undefined` identity. It still rejects malformed or invalid bearer credentials. Use this only for endpoints that can expose public data to logged-out callers, such as public project reads.

`requireSessionAuth` accepts only the browser session cookie. Use it for cookie-only identity operations, especially `/api/logout` and `/api/api-keys*`, so API keys cannot manage API keys or browser sessions.

`requireSameOriginWhenPresent` checks the `Origin` header when a browser sends one. Requests without `Origin` are allowed for non-browser clients. Requests with a non-canonical or cross-origin `Origin` return `403`. Put this before state-changing browser/session routes that should be same-origin protected.

`adminApp.use("*", requireAdminAccess)` protects every admin route. Localhost requests bypass Cloudflare Access. Deployed requests require `ADMIN_ACCESS_AUD`, `ADMIN_ACCESS_TEAM_DOMAIN`, and a valid `Cf-Access-Jwt-Assertion`; the verified Access email is stored as `identity` when present.

## Request Validation

Use zod at HTTP trust boundaries:

- Define route-local request schemas for bodies and route-specific query or path parsing.
- Use `parseJson(context, schema)` for JSON request bodies.
- Use `safeParse()` for path and query values when a schema is available.
- Normalize emails with `normalizeEmail()` or `normalizedEmailSchema`.
- Normalize project and member names with the helpers in `worker/project.ts`.

Do not trust route validation as the only validation layer for Durable Object RPC methods. Public DO methods should still validate RPC inputs with `safeParse()` because DO methods are also trust boundaries.

## Responses And Errors

Use `ErrorResponse` from `worker/error.ts` for stable JSON error bodies:

- `400 { error: "invalid_request" }`
- `401 { error: "unauthorized" }`
- `403 { error: "forbidden" }` or posting-specific forbidden responses
- `404 { error: "not_found" }`
- `409 { error: "<stable_conflict_code>" }`
- `429 { error: "rate_limited", reason: "account" | "project" }`
- `500 { error: "internal_server_error" }`
- `503 { error: "internal_server_error" }` when a required external service is temporarily
  unavailable

Return `204` with an empty body for successful no-content mutations. For JSON success bodies, use `context.json(...)` or `Response.json(...)` consistently with surrounding code.

When a Durable Object returns an expected `{ ok: false, error }` union, map that error string in the route module. If a new DO error string is added, update the HTTP mapper, tests, and any OpenAPI response docs in the same change.

## Bindings And State Handoffs

Routes should treat bindings as edges to owned state:

- `LOGIN_ATTEMPT_STORE` owns login-code attempt state.
- `USER_API_KEYS_STORE` owns API-key metadata and publishes verifier projections.
- `API_KEY_VERIFICATION` is the hot-path bearer-key verifier KV.
- `REVOKED_TOKENS` stores revoked session token hashes.
- `PROJECTS_REGISTRY` owns project ID lookup, membership indexes, and registry summaries.
- `PROJECT_STORE` owns per-project state, ACLs, members, records, and balances.
- `PROJECT_REGISTRY_CACHE` caches public project ID to ProjectStore Durable Object ID lookups.
- `LIMITS_STORE` is the admin-facing Durable Object for validating and writing limits documents to `CONFIGS`.
- `CONFIGS` stores limits policy documents consumed through `LimitsKvStore` on normal request paths.
- `GLOBAL_CONFIG` is the generic strongly consistent Durable Object for global key/value configuration and feature-specific read/modify/write methods.
- `PUBLISHED_GLOBAL_CONFIG` is the eventually consistent KV projection for hot-path global config reads.
- Known GlobalConfig keys and published value codecs are documented in `docs/global-config.md`.
- Category classification owns the `categories` global config key and is documented in `docs/category-classification.md`.
- Browser login owns the `blocked_emails` global config key and is documented in `docs/auth.md`.
- Browser login validates recipient domains through Cloudflare DNS over HTTPS before creating
  login-attempt state or calling `SEND_EMAIL`.
- Rate-limit bindings protect record creation, replacement, and deletion at 10 requests per minute
  per account and 120 requests per minute per project, and category classification at 30 requests
  per minute per account.
- `SEND_EMAIL` sends login-code email after an attempt is stored.

For project reads, `worker/routes/project.ts` looks up the ProjectStore reference through `ProjectRefFetcher`. A `PROJECT_REGISTRY_CACHE` hit is used without consulting the registry, a KV miss is treated as a terminal negative lookup, and `ProjectsRegistry.lookupProject()` is only used when the cache read is unavailable/invalid or a cached Durable Object ID cannot be converted.

For `/api/registry`, `worker/routes/registry.ts` wraps the Cache API as a transparent per-email response cache. Cache entries use a synthetic cache host and `s-maxage`; client responses are still returned with `Cache-Control: private, no-store`.

## Background Work

Use `context.executionCtx.waitUntil(...)` for best-effort work that should continue after the response:

- Sending login email after storing an attempt.
- Writing the `/api/registry` Cache API entry.

Always catch and log failures inside the scheduled promise. Do not destructure `waitUntil`; call it from `context.executionCtx`.

Durable Objects use `this.ctx.waitUntil(...)` for DO-local background work such as project summary/cache publication. If a mutation changes data shown in project lists, queue the existing ProjectStore summary sync path rather than writing registry summaries from the route.

## OpenAPI

API documentation is generated from Hono route metadata:

- Routes use `describeRoute(...)` from `hono-openapi`.
- Shared request, response, parameter, tag, and security definitions live in `worker/model.ts`.
- `scripts/generate-openapi.ts` calls `generateSpecs(app, OpenApiSpecOptions)`.
- `scripts/prebuild.mjs` regenerates `public/openapi.json` before builds.
- Every public operation needs a useful description. Documented parameters and body properties need descriptions and realistic examples, and each non-empty successful response needs an example.
- Keep examples internally consistent and use the correct units: project money is integer cents, project/category timestamps are Unix milliseconds, and browser-session expiry is Unix seconds.
- The generator rejects missing operation descriptions, parameter examples, request examples, successful-response examples, and undocumented request/response object properties.

`OpenApiSpecOptions.exclude` intentionally excludes admin routes, cookie-only login/logout routes, and cookie-only API-key management routes. Public OpenAPI is API-key-client oriented and documents bearer API key auth only. Keep this aligned with `docs/auth.md`.

After changing documented API routes, request/response schemas, OpenAPI security, or excluded route policy, run `pnpm run openapi:generate` or `pnpm run openapi:check` as appropriate.

## Adding Or Changing An API Route

Before changing an API route:

- Read this document and any domain-specific doc such as `docs/auth.md`.
- Identify whether the route is public, optionally authenticated, session-only, API-key capable, or admin-only.
- Pick the narrowest existing route module, or add a new `worker/routes/*.ts` module for a cohesive route group.
- Add route-local zod schemas for request bodies and boundary params.
- Apply `requireSameOriginWhenPresent` to browser/session state-changing routes.
- Use `requireSessionAuth` for cookie-only identity routes and `requireAuth` for normal authenticated application routes.
- Keep stable error strings and update mapper tests when adding new domain errors.
- Add or update `describeRoute(...)` metadata for public API-key-client routes.
- Update `public/openapi.json` when generated API docs change.
- Check `src/api/`, `scripts/client.ts`, and tests for client contract updates.

For narrow backend changes, run the relevant Worker typecheck and focused Worker tests. For public contract changes, also run OpenAPI generation/checks.
