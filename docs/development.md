# Development Workflow

Use `pnpm`.

## Commands

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
- `pnpm run api`: run the Node CLI API client.
- `pnpm run openapi:generate`: regenerate `public/openapi.json`.
- `pnpm run openapi:check`: verify `public/openapi.json` is current.
- `pnpm run preview`: build, then start Vite preview.
- `pnpm run deploy`: build, then deploy with Wrangler.

For small changes, run the narrowest relevant typecheck plus tests that cover the changed behavior.

Before broader handoff, prefer:

```sh
pnpm run format:check
pnpm run typecheck
pnpm run lint
pnpm test
pnpm run build
```

`pnpm run build` intentionally emits no production source maps because `vite.config.ts` sets `build.sourcemap = false`.

In the sandbox, Wrangler may print a log-write warning for `~/Library/Preferences/.wrangler/logs`. If the command exits successfully and Vite completes, report the warning but do not treat it as a build failure by itself.

## Local Configuration

- Copy `.dev.vars.example` to `.dev.vars` for local development.
- Do not commit `.dev.vars`.
- `AUTH_SECRET` and `TURNSTILE_SECRET_KEY` are secrets.
- `LOGIN_EMAIL_FROM` is a non-secret environment variable in `wrangler.jsonc`.
- Local fixed-code login is controlled by `LOCAL_DEV_LOGIN_CODE`.
- Local fixed-code login must only work for localhost-style requests.
- Login registration is not email-allowlisted. Any syntactically valid email may request a code.

## Editing Conventions

- Prefer small, scoped changes.
- Use structured parsers and APIs where available rather than ad hoc string handling.
- Keep TypeScript types precise; avoid weakening shared API or project types to `any`.
- Do not revert unrelated local changes.
- Use Prettier for formatting.
