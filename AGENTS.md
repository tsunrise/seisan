# AGENTS.md

Guidance for coding agents working in this repository.

## Project Overview

Seisan is a Cloudflare Worker application with a React frontend, for managing group expenses. The Worker serves all API routes under `/api/*` and serves the React single-page app for non-API routes.

Core pieces:

- `worker/index.ts`: Hono Worker entrypoint and HTTP route wiring.
- `worker/auth.ts`: request schemas, auth middleware, identity handling.
- `worker/project.ts`: project schemas, project helpers, shared project types.
- `worker/routes/login.ts`: login, logout, and identity route handling.
- `worker/routes/registry.ts`: `/api/registry` route handling and transparent Cache API wrapper for registry list responses.
- `worker/routes/project.ts`: `/api/project*` route handling and route-local project lookup helpers.
- `worker/routes/admin.ts`: admin limits API and Cloudflare Access middleware.
- `worker/do/*.ts`: Durable Object classes. Keep one DO class per file.
- `src/`: React UI built with hooks, React Router, and Material UI.
- `src/api.ts`: browser API client for `/api/*`.
- `src/domain.ts`: frontend domain formatting and pure record helpers, including money, dates, record summaries, and record detail titles.
- `src/components/styles.ts`: shared MUI frame and surface style objects.
- `src/project/recordActor.ts`: record actor/subject derivation for timeline display.
- `src/project/timelineScroll.ts`: timeline scroll restoration, infinite-load sentinel helpers, and mobile fixed-action clearance.
- `scripts/client.ts` and `scripts/client-cli.ts`: Node CLI API client.
- `test/*.test.ts`: Worker-runtime Vitest tests.

## Commands

Use `pnpm`.

- `pnpm run dev`: start local Vite/Cloudflare dev server.
- `pnpm run build`: production build.
- `pnpm test`: Worker-runtime Vitest tests.
- `pnpm run lint`: ESLint.
- `pnpm run format`: Prettier write.
- `pnpm run format:check`: Prettier check.
- `pnpm run typecheck`: all typechecks.
- `pnpm run typecheck:frontend`: React app only.
- `pnpm run typecheck:worker`: Worker production code only.
- `pnpm run typecheck:test`: Worker tests only.
- `pnpm run typecheck:node`: Node scripts/config only.
- `pnpm run cf-typegen`: regenerate `worker-configuration.d.ts` after binding/config changes.

For small changes, run the narrowest relevant typecheck plus tests that cover the changed behavior. Before broader handoff, prefer:

```sh
pnpm run format:check
pnpm run typecheck
pnpm run lint
pnpm test
pnpm run build
```

`pnpm run build` intentionally emits no production source maps (`vite.config.ts` has `build.sourcemap = false`). In the sandbox, Wrangler may print a log-write warning for `~/Library/Preferences/.wrangler/logs`; if the command exits successfully and Vite completes, report the warning but do not treat it as a build failure by itself.

## Local Configuration

- Copy `.dev.vars.example` to `.dev.vars` for local development.
- Do not commit `.dev.vars`.
- `AUTH_SECRET` and `TURNSTILE_SECRET_KEY` are secrets.
- `LOGIN_EMAIL_FROM` is a non-secret environment variable in `wrangler.jsonc`.
- Local fixed-code login is controlled by `LOCAL_DEV_LOGIN_CODE`.
- Local fixed-code login must only work for localhost-style requests.
- Login registration is not email-allowlisted. Any syntactically valid email may request a code.

## Auth And Turnstile

- Public auth endpoints live under `/api/login/*`.
- Login attempt validation uses zod in `worker/auth.ts`.
- Login attempts return an opaque attempt ID. Verification must include that ID, email, and code.
- Keep login cooldown and failed-attempt state in `LoginAttemptStore`; do not delete attempts on failed verification in a way that bypasses cooldowns.
- In deployed/non-local login attempts, the server must verify Turnstile before sending or storing a login code.
- In local dev, fixed-code login may bypass Turnstile only when `isLocalDevLogin()` accepts the localhost-style request.
- The frontend decides whether to render Turnstile with `import.meta.env.DEV`; do not use hostname checks in frontend code for that behavior.
- Keep auth identity in Hono context as `identity`.
- `requireAuth` requires a valid session; `optionalAuth` permits unauthenticated public project reads.

## Worker Code Style

- Keep `worker/index.ts` focused on Hono route wiring, request parsing, auth middleware application, RPC calls, and HTTP response mapping. Push domain validation and derivation into `worker/project.ts`, `worker/auth.ts`, or DO methods.
- Prefer small response helpers in `worker/index.ts` such as `unauthorized()`, `invalidRequest()`, `notFound()`, `forbidden()`, `conflict()`, and central mapper functions for repeated DO error unions.
- Validate JSON request bodies with `parseJson(context, schema)` and zod schemas. Use `safeParse()` inside DO RPC methods for public RPC inputs, even if the route already validated the request.
- Keep schemas near the domain they validate: auth schemas in `worker/auth.ts`, project/member/record schemas in `worker/project.ts`.
- Name zod schema values in PascalCase without a `Schema` suffix, and export the inferred type beside the schema with the same identifier, for example `export const MoneyMap = ...; export type MoneyMap = z.infer<typeof MoneyMap>;`. If an existing domain type would conflict with a different schema shape, choose a precise schema name instead of using a `*Schema` suffix.
- Use zod at trust and serialization boundaries: request bodies, route params, stored JSON, RPC inputs, and external service payloads. Do not add zod schemas for values that are only constructed internally; use TypeScript unions, interfaces, or object types for those.
- Prefer grouping cohesive behavior behind small named classes or objects instead of exporting clusters of top-level helper functions. If logic owns a binding, cache, storage namespace, policy, or shared state, model it as a focused class such as `LimitsKvStore` or `LimitsPolicy`.
- Keep top-level functions limited to small pure helpers, response helpers, schema builders, and file-local row conversion utilities. Avoid exporting standalone key builders, parse/serialize helpers, or limit-check functions when they naturally belong to a store, policy, or domain object.
- Normalize boundary data immediately. Emails should go through `normalizeEmail()` or `normalizedEmailSchema`; project and member names should go through the project normalization helpers.
- Use explicit `{ ok: true, ... } | { ok: false, error: "..." }` unions for expected domain results. Do not throw for normal user/domain errors such as forbidden, invalid input, not found, already linked, or conflict.
- Keep error strings stable and narrow. When adding a new DO error string, update the relevant HTTP mapper and tests in the same change.
- Use constants from `worker/constants.ts` or `worker/project.ts` for limits, TTLs, cache timings, and money bounds. Avoid new route-local magic numbers.
- Use Web Crypto through helpers in `worker/crypto.ts` for hashes, random tokens, login codes, JWT signing, and timing-safe comparison. Do not use `Math.random()` or direct string equality for secrets/tokens.
- For post-response or best-effort work from routes, use `context.executionCtx.waitUntil(...)`. For DO best-effort work, use `this.ctx.waitUntil(...)`. Always catch and log failures inside the scheduled promise.
- Do not destructure `waitUntil` or other methods that depend on platform object binding.
- Use `Response.json(...)` or `context.json(...)` consistently with the surrounding route. Return `204` with an empty body for successful no-content mutation responses.
- Keep comments sparse and attached to non-obvious invariants, security reminders, or temporary backfills. Avoid comments that simply restate the SQL or TypeScript.

## Durable Objects And Storage

- Durable Object classes belong in `worker/do/`, one class per file.
- Use SQLite storage APIs for DO state; keep mutations that must be atomic inside a transaction.
- Be careful with shutdown behavior: if a method writes multiple related pieces of storage state, prefer a transaction or leave an inline TODO if a future transaction is needed.
- `ProjectStore` owns project state, members, ACL data, records, and balances.
- `ProjectsRegistry` owns public project ID to ProjectStore DO ID mapping, project membership index rows, and cached project summaries for `/api/registry`.
- `PROJECT_REGISTRY_CACHE` is a KV cache for public project ID to ProjectStore DO ID lookup. The registry DO is authoritative.
- `ProjectStore` queues project summary syncs with a DO alarm. Use `setAlarmIfNotAlready()` style logic so repeated mutations inside the delay window do not reschedule or fan out.
- `ProjectStore.alarm()` syncs summary data to `ProjectsRegistry.syncProjectSummary()`. Keep this summary good enough for project lists; it does not need to be perfectly fresh.
- Public DO methods should follow the local pattern: check initialization/access first, validate RPC input, perform the minimal SQL reads/writes, queue summary/cache side effects after successful state changes, and return a typed result union.
- `ProjectStore` access checks should go through `getProjectAccess()` or `getOwnerAccess()` so owner/public/restricted behavior stays centralized.
- For SQL rows, define narrow row interfaces that extend `Record<string, SqlStorageValue>`. Use typed `sql.exec<Row>(...)` calls and parameter placeholders rather than string interpolation for values.
- Prefer `.toArray()[0] ?? null` or explicit `undefined` checks for single-row reads. Keep JSON parsing/serialization at the storage boundary.
- Use `transactionSync()` for related multi-write state changes, especially when updating rows plus counters, balances, membership rows, project metadata, or initialized state. Queue alarms/cache writes only after the transaction has succeeded.
- Store extensible record data as JSON (`description_json`, `delta_json`) and keep schema-specific validation in TypeScript/zod instead of adding schema columns for every future record type.
- Keep DO helper methods private when they are internal implementation details. Put pure row conversion helpers near the bottom of the file.
- When a `ProjectStore` mutation affects project-list data, call `queueProjectSummarySync()` rather than writing registry summary rows or Cache API entries inline.

### Durable Object SQL Migrations

- Use SQL migrations for every Durable Object schema change. This includes creating or dropping tables or indexes, adding columns, changing constraints, and any required persisted data shape change that the new code cannot safely run without.
- Do not use `backfill()` for schema changes. If the DO would be unusable or code would fail without the change, it belongs in SQL migrations.
- Add a new ordered migration group to the DO class `static readonly migrations`; do not edit migration groups that may already have run in deployed Durable Objects.
- Keep `dbMigrationVersion` in DO storage KV and run pending migrations with `runSqlMigrations(state, ClassName.migrations)` inside `ctx.blockConcurrencyWhile()`.
- Migrations should be deterministic and safe to run exactly once per DO instance. Prefer `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, and explicit `ALTER TABLE` statements only when the target deployed state is known.
- After changing a DO migration list, update migration tests that assert `dbMigrationVersion`.
- Wrangler-level Durable Object migrations in `wrangler.jsonc` are for class lifecycle changes such as introducing a new DO class. Internal SQL migrations are still required for that DO class's SQLite schema.

### Durable Object Backfills

- Use the shared `backfill()` helper only for temporary, one-time deployed-data repairs where missing the run does not make the Durable Object unusable. Backfills are lighter weight and less persistent than SQL migrations, and should be removed after confidence that deployed data has been repaired.
- `backfill()` stores `dbBackfillState` in DO storage KV and only marks the backfill complete after the awaited repair function succeeds. Use a unique, date-stamped name such as `20260607-project-summary`.
- Keep at most one active `backfill()` definition per Durable Object class. Before adding a new backfill for a DO class, remove any previous completed backfill for that same class, including its call path, tests, helpers, and TODOs. Backfills for different DO classes are independent.
- Backfills are appropriate for derived or redundant data, cache-like summaries, optional repair jobs, or best-effort compatibility fills. They are not appropriate for required schema setup.
- Put the `backfill()` call close to the code path that can safely repair the data, such as a registry/listing path or another DO method that has enough information to rebuild the missing state.
- Always add a cleanup TODO comment on every backfill use and every backfill-specific test, using this exact format: `TODO: remove this after backfill <backfill_name> is fully done`.
- Backfill tests should verify the repaired behavior and, when practical, that the helper does not run the same named backfill more than once.

## Project Model Notes

- Project records are keyed by project-local numeric `memberId`, not email.
- Emails are for authentication, ACL access, and linking a logged-in user to a project member.
- Deleted members are soft-deleted so historical records can still render.
- Balances are stored by member ID, in cents.
- Record descriptions are JSON to allow future description types without schema churn.
- Validate that record deltas match the server-derived delta and sum to zero.
- Owner identity is stored in `ProjectStore`. Owner-only checks should happen there unless the operation only touches registry metadata.
- `ProjectsRegistry.listProjects()` must never return all projects. It should only return projects relevant to the caller email.
- Public projects can be read by logged-out guests, but mutations require auth and posting requires a linked active member.

## Project List Caching

- `/api/registry` first checks the Cache API via `worker/routes/registry.ts`.
- On Cache API miss, `/api/registry` should call `ProjectsRegistry.listProjects()` only. It should not activate all linked `ProjectStore` DOs.
- Cache API entries are transparent response caches with `s-maxage=10`. Do not patch, delete, or carry custom expiry metadata for project-list Cache API entries.
- The project summary `lastSyncAt` comes from `ProjectsRegistry` summary rows, not from Cache API write time.
- Mutations that affect project-list summaries should queue a `ProjectStore` alarm rather than writing the Cache API directly.

## Frontend Notes

- Use React hooks and React Router.
- UI uses Material UI. Prefer MUI components and idioms before custom controls.
- Keep large rendering modules split into separate files under `src/pages`, `src/project`, `src/components`, or `src/hooks`.
- API calls from the browser go through `src/api.ts` and use relative `/api/*` URLs.
- Preserve the mobile-first ledger/chat-like project timeline. Desktop should use the existing multi-pane layout, not a stretched mobile view.
- Mobile uses a single active panel. Pad-width layouts show the main timeline plus right panel. Wider desktop layouts show left rail, center timeline, and right panel.
- Project timelines render oldest-to-newest and initial project loads scroll to the latest record. Infinite loading fetches older records when the user scrolls upward, and prepending older records must preserve the visible scroll position.
- Timeline scroll restoration and fixed-action overlap handling belong in `src/project/timelineScroll.ts`. Do not duplicate sessionStorage, DOM measurement, iOS Safari safe-area, or mobile bottom CTA clearance logic inside rendering components.
- The mobile timeline CTA is marked with `data-project-mobile-action`; keep that marker or update `timelineScroll.ts` at the same time. This is required so initial scroll and restore logic keep the latest bubble clear of the fixed action, especially on iPhone Safari.
- Record cards should only make the bubble clickable, not the surrounding timeline lane. Keep hover states subtle and consistent with the bubble tone.
- Shared record text, money, timestamp, and title formatting belongs in `src/domain.ts`. Components should call helpers such as `recordTitle`, `recordDetailTitle`, `formatCents`, and timestamp formatters instead of duplicating formatting rules.
- Keep record actor/subject selection in `src/project/recordActor.ts` so avatar direction and record summaries stay consistent.
- Use `BrandLink` for the logo plus `SEISAN` brand mark. The logo asset is `public/seisan-logo.svg`, and `index.html` uses it as the favicon.
- Route titles are controlled with `useDocumentTitle`: root/project-list pages use `Seisan`; project routes use `<Project Name> - Seisan`.
- Avoid in-app explanatory text about how the UI works unless it is actual product copy.
- Use `lucide` only if it is already installed; this repo currently uses MUI icons.
- For SEO-facing shell content, update `index.html` metadata rather than adding marketing-only UI to app routes.

## Testing Notes

- Tests use `@cloudflare/vitest-pool-workers` and `cloudflare:test`.
- Use `runInDurableObject` to inspect or seed DO storage in unit-style tests.
- Use `runDurableObjectAlarm` to manually run DO alarms.
- HTTP test helpers should call `waitOnExecutionContext()` after `worker.fetch()` so `ctx.waitUntil()` work completes before assertions.
- After `waitOnExecutionContext()`, tests should directly assert expected `waitUntil` side effects such as configured alarms. Avoid polling helpers for those cases unless testing eventual external behavior explicitly.
- Mock external services such as Email and Turnstile in tests; tests should not depend on real network calls.
- Keep malformed schema tests for zod-covered request bodies.
- After changing bindings or Wrangler config, regenerate `worker-configuration.d.ts`.
- For frontend-only changes, usually run `pnpm run typecheck:frontend`, `pnpm run format:check`, and `pnpm run lint`. Run `pnpm run build` when touching routing, theme/styles, Vite config, shared imports, or assets used by the production bundle.
- Use browser verification when changing visible layout, responsive behavior, scrolling, or user flows, or when explicitly requested. Always use the in-app Browser plugin (`[@Browser](plugin://browser@openai-bundled)`) instead of standalone Playwright for this verification. Do not run full browser-flow checks for every small code cleanup.
- When verifying visual changes, take a screenshot with the in-app Browser and inspect it visually with multimodal capability. Do not rely only on DOM geometry, computed styles, or coordinate checks for UI quality.
- When changing timeline pagination or scroll restoration, verify the main cases when practical: initial latest-record positioning, loading older records without scroll jumps, record detail navigation and back, and mobile fixed action clearance.

## Editing Conventions

- Prefer small, scoped changes.
- Use structured parsers/APIs where available rather than ad hoc string handling.
- Keep TypeScript types precise; avoid weakening shared API or project types to `any`.
- Do not revert unrelated local changes.
- Use Prettier for formatting.
