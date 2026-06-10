# Seisan

Seisan is a Cloudflare Worker and React application for splitting shared expenses. It supports passwordless login, project-local members, shared ledgers, balances, and settlement records.

## Development

Use `pnpm`.

```sh
pnpm run dev
pnpm run typecheck
pnpm run lint
pnpm test
pnpm run build
```

Copy `.dev.vars.example` to `.dev.vars` for local development secrets and local-only login settings.

## Structure

- `worker/`: Hono API routes, authentication, project schemas, and Durable Objects.
- `worker/do/`: Durable Object classes, one class per file.
- `src/`: React frontend built with React Router and Material UI.
- `scripts/`: Node API client and maintenance scripts.
- `test/`: Worker-runtime Vitest tests.
