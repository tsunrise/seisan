# Worker Code Style

Use this for Worker production code in `worker/`, especially route modules and shared backend helpers.

## Route And Handler Shape

- Keep `worker/index.ts` thin: it should export Durable Object classes and delegate HTTP handling to `worker/app.ts`.
- Keep route modules focused on Hono route wiring, request parsing, auth middleware application, RPC calls, and HTTP response mapping.
- Push domain validation and derivation into `worker/project.ts`, `worker/auth.ts`, focused store/policy classes, or Durable Object methods.
- Prefer small response helpers and central mapper functions for repeated Durable Object error unions.
- Use `Response.json(...)` or `context.json(...)` consistently with the surrounding route.
- Return `204` with an empty body for successful no-content mutation responses.

## Validation And Schemas

- Validate JSON request bodies with `parseJson(context, schema)` and zod schemas.
- Use `safeParse()` inside Durable Object RPC methods for public RPC inputs, even if the route already validated the request.
- Keep schemas near the boundary they validate: route request schemas live with their route handlers, OpenAPI mirror schemas live in `worker/model.ts`, and shared project IDs/types/normalization helpers live in `worker/project.ts`.
- Name zod schema values in PascalCase without a `Schema` suffix.
- Export the inferred type beside the schema with the same identifier, for example `export const MoneyMap = ...; export type MoneyMap = z.infer<typeof MoneyMap>;`.
- If an existing domain type would conflict with a different schema shape, choose a precise schema name instead of using a `*Schema` suffix.
- Use zod at trust and serialization boundaries: request bodies, route params, stored JSON, RPC inputs, and external service payloads.
- Do not add zod schemas for values that are only constructed internally; use TypeScript unions, interfaces, or object types for those.
- Normalize boundary data immediately. Emails should go through `normalizeEmail()` or `normalizedEmailSchema`; project and member names should go through the project normalization helpers.

## Organization

- Prefer grouping cohesive behavior behind small named classes or objects instead of exporting clusters of top-level helper functions.
- If logic owns a binding, cache, storage namespace, policy, or shared state, model it as a focused class such as `LimitsKvStore` or `LimitsPolicy`.
- Keep top-level functions limited to small pure helpers, response helpers, schema builders, and file-local row conversion utilities.
- Avoid exporting standalone key builders, parse/serialize helpers, or limit-check functions when they naturally belong to a store, policy, or domain object.

## Domain Results And Errors

- Use explicit `{ ok: true, ... } | { ok: false, error: "..." }` unions for expected domain results.
- Do not throw for normal user/domain errors such as forbidden, invalid input, not found, already linked, or conflict.
- Keep error strings stable and narrow.
- When adding a new Durable Object error string, update the relevant HTTP mapper and tests in the same change.

## Constants And Crypto

- Use existing constants from `worker/constants.ts`, `worker/limits.ts`, `worker/project.ts`, or focused route/store classes for limits, TTLs, cache timings, and money bounds.
- Avoid new route-local magic numbers.
- Keep auth/session/API-key randomness, login codes, JWT signing, hashes, and timing-safe comparisons behind `worker/crypto.ts` helpers; `crypto.randomUUID()` is acceptable for non-secret public IDs.
- Do not use `Math.random()` or direct string equality for secrets or tokens.

## Background Work

- For post-response or best-effort work from routes, use `context.executionCtx.waitUntil(...)`.
- For Durable Object best-effort work, use `this.ctx.waitUntil(...)`.
- Always catch and log failures inside the scheduled promise.
- Do not destructure `waitUntil` or other methods that depend on platform object binding.

## Comments

Keep comments sparse and attached to non-obvious invariants, security reminders, or temporary backfills. Avoid comments that simply restate the SQL or TypeScript.
