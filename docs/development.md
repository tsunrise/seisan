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
- The default local environment in `wrangler.jsonc` sets `LOCAL_DEV_LOGIN_CODE` to `123456`; use that code for localhost browser and live API login checks without adding it to `.dev.vars`. Deployed and test environments set this binding to an empty string.
- Local fixed-code login must only work for localhost-style requests.
- Every login attempt, including local fixed-code login, validates the recipient domain through
  Cloudflare DNS over HTTPS. Local development therefore needs outbound access to
  `https://cloudflare-dns.com/dns-query` even though fixed-code login does not send email.
- Login registration is not email-allowlisted. A syntactically valid email may request a code when
  its domain advertises an MX record or qualifies for SMTP's A/AAAA fallback, unless it matches the
  published blocked-email regex policy documented in `docs/auth.md`. Administrators may attach a
  single-line user-facing reason to each rule; the login UI appends it to the generic
  unsupported-email message.

## CLI API Client

Run the CLI client with `pnpm run api -- <command>`. It targets `http://localhost:5173` by default.

Authenticated commands use bearer API keys instead of browser login sessions. Set `SEISAN_API_KEY`, or enter an API key at the hidden stdin prompt when no key is available. A prompted key is saved per target environment in macOS Keychain when available, with a mode-`0600` file under the user's config directory as the fallback and as the storage mechanism on other platforms. `SEISAN_API_KEY` overrides a saved key. Run `pnpm run api -- --env=<env> logout` to remove the saved key for an environment; this does not unset `SEISAN_API_KEY` or call the browser-session `/api/logout` route.

Use `--env=dev` for `https://dev.seisan.waga.me` or `--env=production` for `https://seisan.waga.me`. All dev requests and remote admin requests run `cloudflared access token -app=<request-url>` automatically and send the result as `cf-access-token`. The concrete request URL matters because separate Access applications can protect normal dev and admin paths with different audiences. Cloudflare Access validates the token and, on admin paths, forwards `Cf-Access-Jwt-Assertion` to the Worker for explicit Access JWT validation. If `cloudflared` has no cached login for an application, run `cloudflared access login <concrete-request-url>` first. Localhost admin requests rely on the Worker's local admin bypass and do not require an Access token. Feature-specific commands are documented with their feature docs.

## Cloudflare Resources

Category classification uses the Workers AI `AI` binding; feature-specific model details live in `docs/category-classification.md`.

Local dev uses `remote: true` for the Workers AI binding, so the Worker still runs locally while model calls use Cloudflare remote resources. Durable Object state remains local in `.wrangler/state` unless its binding is explicitly made remote. Workers AI always uses remote Cloudflare resources, including during local development and Worker tests when the real `AI` binding is invoked.

## Local Dev Server For Live API Probes

Use this workflow for live local API reproduction, verification, red-team probing, and other tasks that need a fresh local Worker state. Do not run probes against production.

Record baseline facts before changing local Worker state:

```sh
git rev-parse HEAD
date '+%Y-%m-%d %H:%M:%S %Z'
git status --short
```

Back up local Worker state before starting the dev server:

1. If `.wrangler/state` exists, move it to `.wrangler/state-backup-<YYYYMMDD-HHMMSS>`.
2. If that backup path already exists, choose a unique timestamped suffix.
3. Do not delete the user's original state.
4. Ensure the run starts with no `.wrangler/state` directory.

Keep the backup path in your notes so cleanup can restore it exactly.

Start the server from the repo root:

```sh
pnpm run dev
```

Keep the exact command session ID. Wait until this endpoint returns `200` before making other API calls:

```text
http://localhost:5173/api/ping
```

Make live API calls only against:

- `http://localhost:5173`
- `http://127.0.0.1:5173`

Capture method, endpoint, status, and relevant response bodies for any evidence or verification notes.

Always run cleanup before finishing, even if probing or verification fails:

1. Stop the exact `pnpm run dev` session you started, normally by sending `Ctrl-C`.
2. Move or remove the generated `.wrangler/state` from this run.
3. Move the saved `.wrangler/state-backup-<timestamp>` back to `.wrangler/state` if a backup exists.
4. Verify the final state with `git status --short`.

If cleanup fails, do not continue silently. Report the exact backup path and current `.wrangler/state` path.

### Remote Bindings

Some bindings are not locally simulated. Use local development with remote bindings, not Vite `--remote`:

- `pnpm run dev -- --remote` is not the right tool for this Vite app.
- `wrangler dev --remote` is legacy full-remote development and is not supported by the Cloudflare Vite plugin.
- With `remote: true`, the Worker still executes locally; unmarked bindings such as Durable Objects, KV, and Cache API still use local `.wrangler/state`.

If an endpoint backed by a remote binding returns `500`, check the dev server logs. This message means the binding is not configured for remote local dev:

```text
Binding <BINDING_NAME> needs to be run remotely
```

Live Workers AI calls are billed to the logged-in Cloudflare account. Use only test data.

## Editing Conventions

- Prefer small, scoped changes.
- Use structured parsers and APIs where available rather than ad hoc string handling.
- Keep TypeScript types precise; avoid weakening shared API or project types to `any`.
- Do not revert unrelated local changes.
- Use Prettier for formatting.
