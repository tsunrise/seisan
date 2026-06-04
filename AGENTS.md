# AGENTS.md

Guidance for coding agents working in this repository.

## Project Overview

Seisan is a Cloudflare Worker application with a React frontend. The Worker serves all API routes under `/api/*` and serves the React single-page app for non-API routes.

Core pieces:

- `worker/index.ts`: Hono Worker entrypoint and HTTP route wiring.
- `worker/auth.ts`: request schemas, auth middleware, identity handling.
- `worker/project.ts`: project schemas, project helpers, shared project types.
- `worker/do/*.ts`: Durable Object classes. Keep one DO class per file.
- `src/`: React UI built with hooks, React Router, and Material UI.
- `src/api.ts`: browser API client for `/api/*`.
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

## Local Configuration

- Copy `.dev.vars.example` to `.dev.vars` for local development.
- Do not commit `.dev.vars`.
- `AUTH_SECRET` and `TURNSTILE_SECRET_KEY` are secrets.
- `LOGIN_EMAIL_FROM` is a non-secret environment variable in `wrangler.jsonc`.
- Local fixed-code login is controlled by `LOCAL_DEV_LOGIN_EMAILS` and `LOCAL_DEV_LOGIN_CODE`.
- Local fixed-code login must only work for localhost-style requests.

## Auth And Turnstile

- Public auth endpoints live under `/api/login/*`.
- Login attempt validation uses zod in `worker/auth.ts`.
- In deployed/non-local login attempts, the server must verify Turnstile before sending or storing a login code.
- In local dev, fixed-code login may bypass Turnstile only when `isLocalDevLogin()` accepts the request.
- The frontend decides whether to render Turnstile with `import.meta.env.DEV`; do not use hostname checks in frontend code for that behavior.
- Keep auth identity in Hono context as `identity`.
- `requireAuth` requires a valid session; `optionalAuth` permits unauthenticated public project reads.

## Durable Objects And Storage

- Durable Object classes belong in `worker/do/`, one class per file.
- DOs use internal SQL migrations. Keep `dbMigrationVersion` in DO storage KV and run pending migrations in `ctx.blockConcurrencyWhile()`.
- Use SQLite storage APIs for DO state; keep mutations that must be atomic inside a transaction.
- Be careful with shutdown behavior: if a method writes multiple related pieces of storage state, prefer a transaction or leave an inline TODO if a future transaction is needed.
- `ProjectStore` owns project state, members, ACL data, records, and balances.
- `ProjectsRegistry` owns public project ID to ProjectStore DO ID mapping and project listing metadata.
- `PROJECT_REGISTRY_CACHE` is a cache. The registry DO is authoritative.

## Project Model Notes

- Project records are keyed by project-local numeric `memberId`, not email.
- Emails are for authentication, ACL access, and linking a logged-in user to a project member.
- Deleted members are soft-deleted so historical records can still render.
- Balances are stored by member ID, in cents.
- Record descriptions are JSON to allow future description types without schema churn.
- Validate that record deltas match the server-derived delta and sum to zero.

## Frontend Notes

- Use React hooks and React Router.
- UI uses Material UI. Prefer MUI components and idioms before custom controls.
- Keep large rendering modules split into separate files under `src/pages`, `src/project`, `src/components`, or `src/hooks`.
- API calls from the browser go through `src/api.ts` and use relative `/api/*` URLs.
- Preserve the mobile-first ledger/chat-like project timeline. Desktop should use the existing multi-pane layout, not a stretched mobile view.
- Avoid in-app explanatory text about how the UI works unless it is actual product copy.
- Use `lucide` only if it is already installed; this repo currently uses MUI icons.

## Testing Notes

- Tests use `@cloudflare/vitest-pool-workers` and `cloudflare:test`.
- Use `runInDurableObject` to inspect or seed DO storage in unit-style tests.
- Mock external services such as Email and Turnstile in tests; tests should not depend on real network calls.
- Keep malformed schema tests for zod-covered request bodies.
- After changing bindings or Wrangler config, regenerate `worker-configuration.d.ts`.

## Editing Conventions

- Prefer small, scoped changes.
- Use structured parsers/APIs where available rather than ad hoc string handling.
- Keep TypeScript types precise; avoid weakening shared API or project types to `any`.
- Do not revert unrelated local changes.
- Use Prettier for formatting.
