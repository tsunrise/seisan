# AGENTS.md

Guidance for coding agents working in this repository.

## Project Overview

Seisan is a Cloudflare Worker application with a React frontend for managing group expenses. The Worker serves API routes under `/api/*`; the React single-page app handles non-API routes.

Core areas:

- `worker/`: Hono Worker app, auth, route modules, domain helpers, and Durable Objects.
- `src/`: React UI built with hooks, React Router, and Material UI.
- `scripts/client.ts` and `scripts/client-cli.ts`: Node CLI API client.
- `test/*.test.ts`: Worker-runtime Vitest tests.
- `docs/`: durable implementation guidance for agents.

## Docs

When working on an area covered by a Markdown file in `docs/`, read the relevant doc before changing that area. If the implementation change affects documented behavior, storage, bindings, deployment details, or public API contracts, update the corresponding doc in the same change.

| Title                             | Read For                                                                                                                                   |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `docs/development.md`             | Commands, local configuration, build notes, clean local dev-server workflow, Wrangler state backup/restore, and editing conventions.       |
| `docs/category-classification.md` | Category classification routes, category config document, Workers AI embeddings, Vectorize behavior, CLI commands, seed script, and tests. |
| `docs/global-config.md`           | GlobalConfig keys, value codecs, DO/KV ownership, publication behavior, adding new keys, and focused tests.                                |
| `docs/api-serving.md`             | Worker API serving, Hono app composition, route middleware, validation, bindings, background work, and OpenAPI.                            |
| `docs/auth.md`                    | Browser sessions, API keys, Turnstile, verifier storage, auth bindings, route split, and OpenAPI auth documentation.                       |
| `docs/worker-code-style.md`       | Worker route/helper style, zod schema rules, domain result unions, constants, crypto, errors, and background work.                         |
| `docs/durable-objects.md`         | Durable Object ownership, SQLite storage, transactions, SQL migrations, alarms, summary sync, and backfills.                               |
| `docs/project-model.md`           | Project/member/record identity, balances, ACL access, public reads, and mutation invariants.                                               |
| `docs/project-list-caching.md`    | `/api/registry`, Cache API behavior, registry summaries, and project-list invalidation strategy.                                           |
| `docs/frontend.md`                | React implementation boundaries, API client usage, route titles, brand assets, timeline behavior, and SEO shell work.                      |
| `docs/ui-style-guide.md`          | Frontend visual system for the warm ledger-style project UI, including timeline, panel, form, and responsive rules.                        |
| `docs/testing.md`                 | Worker test helpers, Durable Object test patterns, frontend checks, and browser verification expectations.                                 |

## Commands

Use `pnpm`. See `docs/development.md` for the full command list and for the workflow to run a clean local Seisan dev server while restoring the user's original Wrangler state afterward.

For small changes, run the narrowest relevant typecheck plus tests that cover the changed behavior. Before broader handoff, prefer:

```sh
pnpm run format:check
pnpm run typecheck
pnpm run lint
pnpm test
pnpm run build
```
