# Category Classification POC

Use this document before changing the category classification proof of concept, including its admin API routes, Durable Object storage, Workers AI embeddings, Vectorize index behavior, CLI commands, or tests.

## Scope

The category classification POC is admin-only and is not integrated into record posting. It is mounted under `/api/admin/category-poc`, protected by Cloudflare Access in deployed environments, and covered by the local admin bypass for localhost development.

Admin routes remain excluded from public OpenAPI.

Implementation files:

- `worker/categoryPoc.ts`: shared category POC schemas, normalization helpers, vector IDs, and namespace helpers.
- `worker/do/CategoryPocStore.ts`: singleton SQLite Durable Object source of truth.
- `worker/routes/categoryPoc.ts`: admin HTTP route module.
- `scripts/client.ts` and `scripts/client-cli.ts`: CLI client support.
- `test/categoryPoc.test.ts`: focused Worker-runtime coverage.

## API

Base path:

```text
/api/admin/category-poc
```

Endpoints:

- `GET /categories`: returns `{ categories }`, ordered by normalized category name.
- `POST /categories` with `{ name, description? }`: embeds and stores a category, returning `{ category, vectorizeMutation }` with status `201`.
- `DELETE /categories/:id`: removes a category row and schedules best-effort Vectorize deletion, returning `204` or `404`.
- `POST /classify` with `{ name, topK? }`: embeds a transaction name, queries Vectorize in the current namespace, resolves matches through the Durable Object, and returns `{ category, score, candidates }`.

Request behavior:

- Duplicate normalized category names return `409 { error: "category_exists" }`.
- Invalid bodies, bad IDs, or invalid `topK` return `400 { error: "invalid_request" }`.
- Classification with no current matching category returns `404 { error: "not_found" }`.
- `topK` defaults to `5` and is capped at `20`.

## Embeddings

The route uses Workers AI model `@cf/google/embeddinggemma-300m`.

Prompt formats:

- Category document: `title: {category name} | text: {description or category name}`
- Classification query: `task: classification | query: {transaction name}`

The category document text is persisted with the category row so changes to formatting are explicit data-shape changes.

## Durable Object Storage

`CATEGORY_POC_STORE` is backed by `CategoryPocStore`, reached through `getByName("category-poc-store")`.

The Durable Object owns:

- Category rows: `id`, normalized name, display name, description, generated document text, Vectorize ID, and timestamps.
- Vector IDs, formatted as `category:<category-uuid>`.
- Durable Object KV key `vectorNamespace`, a random namespace generated on first use and reused for all future vectors from the same Durable Object state.

The SQLite `categories` table enforces unique `normalized_name` and unique `vector_id`. `listCategories()` orders by `normalized_name`.

## Vectorize

`CATEGORY_POC_INDEX` stores category embeddings for this POC. Each upsert includes the Durable Object's persisted `namespace`, and each classification query uses the same namespace.

The namespace isolates the current Durable Object source of truth from old remote Vectorize state. This matters in local development because cleaning `.wrangler/state` resets local Durable Objects, KV, and Cache API state, but it does not clear remote Vectorize vectors.

Still resolve Vectorize match IDs through `CategoryPocStore.resolveMatches()` and ignore missing rows. This handles deletes that are still converging and any other stale IDs inside the current namespace.

## Consistency

Add category:

1. Validate and normalize the request body.
2. Generate the category ID and Vectorize ID.
3. Embed the category document text.
4. Load or create the Durable Object vector namespace.
5. Persist the category row in the Durable Object.
6. Upsert the vector with `{ id, values, namespace }`.
7. If Vectorize upsert fails, remove the Durable Object row and return `500`.

Remove category:

1. Delete the Durable Object row first.
2. Schedule `CATEGORY_POC_INDEX.deleteByIds([vectorId])` with `waitUntil`.
3. Treat Vectorize deletion as best-effort and eventually consistent.

Classify:

1. Embed the transaction query text.
2. Query Vectorize with `{ topK, namespace }`.
3. Resolve returned Vectorize IDs through the Durable Object.
4. Return the highest still-active category.

## Cloudflare Resources

Wrangler bindings:

- `AI`: Workers AI inference binding.
- `CATEGORY_POC_INDEX`: Vectorize index binding.
- `CATEGORY_POC_STORE`: singleton SQLite Durable Object binding.

Vectorize indexes must use `dimensions=768` and `metric=cosine`:

```sh
pnpm exec wrangler vectorize create seisan-category-poc --dimensions=768 --metric=cosine
pnpm exec wrangler vectorize create seisan-category-poc-test --dimensions=768 --metric=cosine
pnpm exec wrangler vectorize create seisan-category-poc-dev --dimensions=768 --metric=cosine
pnpm exec wrangler vectorize create seisan-category-poc-production --dimensions=768 --metric=cosine
```

Top-level local dev uses `remote: true` for `AI` and `CATEGORY_POC_INDEX`. The Worker still runs locally; unmarked Durable Object state remains local in `.wrangler/state`.

## CLI

Use `pnpm run api -- <command>`. Commands target `http://localhost:5173` by default; use `--env=dev` or `--env=production` for deployed environments.

Commands:

```sh
pnpm run api -- category-poc-list
pnpm run api -- category-poc-add "Restaurant" --description="Places that sell prepared meals"
pnpm run api -- category-poc-remove <category-id>
pnpm run api -- category-poc-classify "Taco Bell" --top-k=5
pnpm run api -- category-poc-classify "Taco Bell" --top-k=5 --verbose
```

`category-poc-classify` prints a concise response by default: the winning category name, score, and candidate category names with scores. Pass `--verbose` to print the full API response with complete category objects.

Seed the default spending category set through the CLI:

```sh
pnpm run category-poc:populate -- --env=local
pnpm run category-poc:populate -- --env=dev
pnpm run category-poc:populate -- --env=production
```

The seed set excludes `Income: Paycheck`. For each seeded category, the script lists categories through `category-poc-list`, skips an existing category with the same normalized name and description, or deletes and recreates it when the description differs. Add, delete, and list operations all go through `pnpm api --env=<env>`.

For non-local admin targets, the client runs `cloudflared access token -app=<admin-request-url>` automatically and sends the resulting token as `cf-access-token`. Use the concrete admin request URL for token lookup; looking up only `<target>/api/admin` can select the wrong Access application audience when multiple Access apps protect the same host. Cloudflare Access validates that token and forwards a `Cf-Access-Jwt-Assertion` header to the Worker, which performs explicit Access JWT validation. Localhost admin requests skip Cloudflare Access.

## Local Testing

For live local API probes, follow `docs/development.md` for clean `.wrangler/state` backup and restore.

Vectorize mutations are async and eventually consistent. Wait at least 10-20 seconds after adding categories before expecting remote Vectorize queries to include new vectors.

Do not increase `topK` just to work around stale vectors. The namespace must isolate unrelated remote vectors, and the Durable Object must filter any stale IDs that still appear inside the current namespace.

Focused checks:

```sh
pnpm run typecheck:worker
pnpm run typecheck:test
pnpm run typecheck:node
pnpm test test/categoryPoc.test.ts
```
