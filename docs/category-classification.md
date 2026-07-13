# Category Classification

Use this document before changing category classification only: category admin routes, the authenticated classification endpoint, category schema, `categories` GlobalConfig data, `PUBLISHED_GLOBAL_CONFIG` category reads, `CATEGORY_INDEX`, category CLI commands, seed script, or category tests.

Do not require this document for unrelated `GlobalConfig` keys or non-category global configuration work. For generic GlobalConfig ownership and extension guidance, read `docs/global-config.md`.

## Scope

Category classification uses a fixed platform-managed category set. Users cannot create custom categories. Expenses may include an optional `categoryId`, and posting validates that ID against the published category document.

Implementation files:

- `worker/category/index.ts`: public exports and `CategoryClassifier` orchestration.
- `worker/category/schema.ts`: category Zod schemas and inferred types.
- `worker/category/document.ts`: category document codec, construction, canonical ordering, and pure mutations.
- `worker/category/vectorIndex.ts`: Workers AI embedding and Vectorize query/upsert/delete behavior.
- `worker/do/GlobalConfig.ts`: generic strongly consistent SQL key/value store plus category mutation methods.
- `worker/routes/categories.ts`: public classification route and admin category CRUD routes.
- `scripts/client.ts`, `scripts/client-cli.ts`, and `scripts/populate-categories.ts`: CLI support and seeding.
- `test/categoryClassification.test.ts`: focused category coverage.

Admin routes are excluded from public OpenAPI. `GET /api/categories` and `POST /api/categories/classify` are public API surfaces and are included in OpenAPI with bearer API-key auth.

## API

Authenticated application route:

- `GET /api/categories`: returns `{ categories }` from `PUBLISHED_GLOBAL_CONFIG`.
- `POST /api/categories/classify` with `{ name, topK? }`: classifies a post name and returns `{ category, score, candidates }`.

Admin routes:

- `GET /api/admin/categories`: returns the same response shape from strongly consistent `GlobalConfig` storage for admin workflows.
- `POST /api/admin/categories` with `{ name, description? }`: creates a category and returns `{ category, vectorizeMutation }` with status `201`.
- `PUT /api/admin/categories/:id` with `{ name, description? }`: updates a category in place and returns `{ category, vectorizeMutation }`.
- `DELETE /api/admin/categories/:id`: removes a category and returns `204`.

Request behavior:

- Duplicate normalized category names return `409 { error: "category_exists" }`.
- Invalid bodies, invalid IDs, or invalid `topK` return `400 { error: "invalid_request" }`.
- Classification with no active matching category returns `404 { error: "not_found" }`.
- KV read, missing document, invalid document, AI, or Vectorize failures return `500 { error: "internal_server_error" }`.
- `topK` defaults to `5` and is capped at `20`.

## Storage And Published Config

Generic `GLOBAL_CONFIG` and `PUBLISHED_GLOBAL_CONFIG` behavior is documented in `docs/global-config.md`.

Category classification owns only the `categories` key. Its value is a JSON string:

```json
{
  "version": 1,
  "vectorNamespace": "categories-<uuid>",
  "categories": [
    {
      "id": "<uuid>",
      "name": "Restaurant",
      "normalizedName": "restaurant",
      "description": "Prepared meals...",
      "documentText": "title: Restaurant | text: Prepared meals...",
      "vectorId": "category:<uuid>",
      "createdAt": 1814136000000,
      "updatedAt": 1814136000000
    }
  ]
}
```

The `categories` key and `CategoriesDocument` value type are registered in `worker/globalConfig.ts` so published KV reads share the same TypeScript contract and parse/serialize codec as the stored category document.

Schema invariants:

- `vectorNamespace` scopes every vector represented by that document and isolates vectors from earlier document lineages. Stale IDs within the active namespace are still filtered against the current category array.
- `documentText` is the exact persisted embedding input, so changing prompt formatting does not silently reinterpret existing categories.
- `vectorId` remains stable across category updates; Vectorize upserts replace the embedding associated with that category.
- Category arrays are serialized in normalized-name order, and IDs, normalized names, and vector IDs must be unique within a document.

Admin reads and writes go through `CategoryClassifier`. `getCategoriesForUpdate()` delegates to `GlobalConfig.listCategories()`, while mutations delegate to `GlobalConfig.upsertCategory()`, `setCategories()`, and `deleteCategory()`. The Durable Object performs category reads and mutations against SQLite and schedules the full document to be written to `PUBLISHED_GLOBAL_CONFIG` under the same `categories` key before `CategoryClassifier` runs Vectorize work. Overlapping publication tasks converge to the latest SQLite document as described in `docs/global-config.md`.

Authenticated category listing, classification, and expense `categoryId` validation read only `PUBLISHED_GLOBAL_CONFIG` with a 5 minute KV cache TTL. There is intentionally no DO fallback: missing, unreadable, or invalid KV data is a hard `500`. The admin list route reads `GlobalConfig` directly so administrative read/modify/write workflows observe strongly consistent state.

Create the remote KV namespaces before deploying dev or production, then fill the generated IDs into `wrangler.jsonc`:

```sh
pnpm exec wrangler kv namespace create PUBLISHED_GLOBAL_CONFIG --env dev
pnpm exec wrangler kv namespace create PUBLISHED_GLOBAL_CONFIG --env production
```

## Embeddings And Vectorize

The route uses Workers AI model `@cf/google/embeddinggemma-300m`.

Prompt formats:

- Category document: `title: {category name} | text: {description or category name}`
- Classification query: `task: classification | query: {post name}`

`CATEGORY_INDEX` stores category embeddings. Vectorize indexes must use `dimensions=768` and `metric=cosine`:

```sh
pnpm exec wrangler vectorize create seisan-category --dimensions=768 --metric=cosine
pnpm exec wrangler vectorize create seisan-category-test --dimensions=768 --metric=cosine
pnpm exec wrangler vectorize create seisan-category-dev --dimensions=768 --metric=cosine
pnpm exec wrangler vectorize create seisan-category-production --dimensions=768 --metric=cosine
```

Each upsert includes the document `vectorNamespace`, and each classification query uses that namespace. Classification resolves Vectorize match IDs through the current published KV document and ignores stale IDs.

## Consistency

Create or update category:

1. Validate and normalize request body.
2. Call `GLOBAL_CONFIG.upsertCategory()`, creating an empty document only on first category creation.
3. Inside the Durable Object, reject duplicate normalized names, write the updated document to SQLite, and schedule publication to `PUBLISHED_GLOBAL_CONFIG`.
4. Embed the category document text.
5. Upsert the category vector synchronously.
6. Return `500` if embedding or Vectorize fails; the category document may already be stored and published and can be repaired by updating the category again.

Delete category:

1. Call `GLOBAL_CONFIG.deleteCategory()`.
2. Inside the Durable Object, remove the category, store the updated document in SQLite, and schedule publication to `PUBLISHED_GLOBAL_CONFIG`.
3. Schedule `CATEGORY_INDEX.deleteByIds([vectorId])` with `waitUntil`; deletion is best-effort.

Expense posting:

1. Validate record schema and project access as usual.
2. If `description.type === "expense"` and `categoryId` is present, read `PUBLISHED_GLOBAL_CONFIG`.
3. Reject unknown IDs with `400`; hard fail KV problems with `500`.

## CLI

Use `pnpm run api -- <command>`. Commands target `http://localhost:5173` by default; use `--env=dev` or `--env=production` for deployed environments.

Commands:

```sh
pnpm run api -- category-list
pnpm run api -- category-add "Restaurant" --description="Places that sell prepared meals"
pnpm run api -- category-update <category-id> --name="Restaurant" --description="Prepared meals"
pnpm run api -- category-remove <category-id>
pnpm run api -- classify-category "Taco Bell" --top-k=5
pnpm run api -- classify-category "Taco Bell" --top-k=5 --verbose
```

`classify-category` prints the winning category name, score, and candidate category names by default. Pass `--verbose` to print complete category objects.

The `category-list` CLI command uses the strongly consistent admin compatibility route. Application clients use authenticated `GET /api/categories`, which reads published KV.

Seed the default category set through the CLI:

```sh
pnpm run categories:populate -- --env=local
pnpm run categories:populate -- --env=dev
pnpm run categories:populate -- --env=production
```

The seed script lists categories, skips existing categories whose normalized name, display name, and description match, creates missing categories, and updates changed categories in place to preserve IDs.

For remote admin requests, and for every dev request, the client runs `cloudflared access token -app=<request-url>` automatically and sends the resulting token as `cf-access-token`. Use the concrete request URL for token lookup because normal dev and admin paths can belong to different Access applications with different audiences.

## Local Testing

For live local API probes, follow `docs/development.md` for clean `.wrangler/state` backup and restore.

Vectorize mutations are async and eventually consistent. Wait at least 10-20 seconds after adding categories before expecting remote Vectorize queries to include new vectors.

Focused checks:

```sh
pnpm run typecheck:worker
pnpm run typecheck:test
pnpm run typecheck:node
pnpm test test/categoryClassification.test.ts
```
