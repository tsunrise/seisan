# Seisan

Seisan is a tool for splitting shared expenses, hosted on Cloudflare Workers. Think about popular tools like Splitwise, but open source.

You can use it at [seisan.waga.me](https://seisan.waga.me). 

## Development

Use `pnpm`.

```sh
pnpm run dev
pnpm run typecheck
pnpm run lint
pnpm test
pnpm run build
```

Copy `.dev.vars.example` to `.dev.vars` for local development secrets and local-only login settings. Local development needs no Cloudflare setup beyond a `wrangler login` for the remote Workers AI binding.

## Structure

- `worker/`: Hono API routes, authentication, project schemas, and Durable Objects.
- `worker/do/`: Durable Object classes, one class per file.
- `src/`: React frontend built with React Router and Material UI.
- `scripts/`: Node API client and maintenance scripts.
- `test/`: Worker-runtime Vitest tests.
- `docs/`: implementation notes for each area.

## Self-Deployment

This repository is built and configured for the official deployment at `seisan.waga.me` only. The guide below is best effort: self-hosted setups are not tested or supported, and future changes may need manual migration.

### 1. Cloudflare resources

You need a Cloudflare account with a zone for your domain. Create one KV namespace per binding, for each environment you deploy:

```sh
pnpm exec wrangler kv namespace create REVOKED_TOKENS --env production
# Repeat for PROJECT_REGISTRY_CACHE, CONFIGS, API_KEY_VERIFICATION, PUBLISHED_GLOBAL_CONFIG.
```

Durable Objects, Workers AI, and rate limiters are created by `wrangler deploy` and need no manual setup.

### 2. `wrangler.jsonc`

Edit `env.production`. Delete `env.dev` unless you also run a separate dev deployment. Leave `env.test` alone because tests use it.

| Key                                             | Change to                                                                        |
| ----------------------------------------------- | -------------------------------------------------------------------------------- |
| `routes[].pattern`                              | Your hostname.                                                                   |
| `vars.LOGIN_EMAIL_FROM`                         | A sender address on a domain set up for Cloudflare email sending (see below).    |
| `vars.ADMIN_ACCESS_AUD`                         | The AUD tag of your Cloudflare Access application for admin routes.              |
| `vars.ADMIN_ACCESS_TEAM_DOMAIN`                 | Your Access team domain, such as `https://<team>.cloudflareaccess.com`.          |
| `kv_namespaces[].id`                            | The namespace IDs you created. Remove `preview_id`.                              |
| `ratelimits[].namespace_id`                     | Any integers that are unique within your account.                                |
| Top-level `kv_namespaces` (default environment) | Your own IDs, or remove the `id` fields so local development uses local KV only. |

Then set the secrets:

```sh
pnpm exec wrangler secret put AUTH_SECRET --env production          # at least 32 random bytes
pnpm exec wrangler secret put TURNSTILE_SECRET_KEY --env production
```

### 3. Hard-coded values

- `src/turnstile.ts`: your Turnstile site key.
- `public/_headers`, `public/robots.txt`, `public/sitemap.xml`, `src/calculator/calculatorMetadata.ts`: replace `https://seisan.waga.me`. The canonical `Link` headers otherwise tell search engines that your pages duplicate the official site.
- `scripts/client.ts`: `DEV_API_BASE_URL` and `PRODUCTION_API_BASE_URL` for the CLI.
- `privacy_policy.md`: it describes the official operator. Replace it with your own policy, then run `node scripts/build-privacy-policy.mjs`.

### 4. External configuration

- **Email sending.** Login codes go out through the `SEND_EMAIL` binding. Onboard the domain of `LOGIN_EMAIL_FROM` to Cloudflare email sending so the Worker can reach arbitrary recipients.
- **Turnstile.** Create a Turnstile widget for your hostname. The site key goes in `src/turnstile.ts` and the secret key goes in `TURNSTILE_SECRET_KEY`.
- **Cloudflare Access.** Create a self-hosted Access application covering `<your-host>/api/admin/*`. The Worker validates the forwarded Access JWT against `ADMIN_ACCESS_AUD` and `ADMIN_ACCESS_TEAM_DOMAIN`. If you leave either value empty, admin routes reject every remote request.
- **Precursor (optional).** On the official zone, Cloudflare Precursor bot detection is enabled, and a Precursor Rule applies **Maximize Security** to `/api/categories/classify`. This guards the Workers AI budget. Without it, that route is protected only by same-origin, session, and rate-limit checks. See `docs/category-classification.md`.

### 5. Deploy and seed

```sh
CLOUDFLARE_ENV=production pnpm run deploy
```

The Cloudflare Vite plugin picks the Wrangler environment at build time from `CLOUDFLARE_ENV`, so `wrangler deploy --env` does not apply here.

Expense categories start empty. After updating `PRODUCTION_API_BASE_URL`, seed them with `pnpm run categories:populate -- --env=production`. This calls the admin API through `cloudflared access token`, so log in with `cloudflared access login` first. See `docs/category-classification.md`. Workers AI usage for category suggestions is billed to your account.
