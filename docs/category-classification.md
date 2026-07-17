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
- `worker/routes/categories.ts`: public category listing, authenticated classification, and admin
  category CRUD routes.
- `scripts/client.ts`, `scripts/client-cli.ts`, `scripts/populate-categories.ts`, and
  `scripts/cleanup-categories.ts`: CLI support, seeding, and removal of obsolete categories.
- `scripts/category-challenges.ts` and `scripts/evaluate-categories.ts`: the reproducible local
  classification corpus and live Workers AI/Vectorize evaluation harness.
- `test/categoryClassification.test.ts`: focused category coverage.

Admin routes are excluded from public OpenAPI. `GET /api/categories` is a public unauthenticated API
surface. `POST /api/categories/classify` is included in OpenAPI with bearer API-key auth.

## API

Application routes:

- `GET /api/categories`: public read-only route returning `{ categories }` from
  `PUBLISHED_GLOBAL_CONFIG` so public project timelines can resolve category labels and icons.
- `POST /api/categories/classify` with `{ name, topK? }`: classifies a post name and returns `{ category, score, candidates }`.

Admin routes:

- `GET /api/admin/categories`: returns the same response shape from strongly consistent `GlobalConfig` storage for admin workflows.
- `POST /api/admin/categories` with `{ name, description?, icon? }`: creates a category and returns `{ category, vectorizeMutation }` with status `201`.
- `PUT /api/admin/categories/:id` with `{ name, description?, icon? }`: updates a category in place and returns `{ category, vectorizeMutation }`.
- `DELETE /api/admin/categories/:id`: waits for Vectorize to accept deletion, removes the category,
  and returns `204`.

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
      "icon": "restaurant",
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
- `icon` is one of the names in `shared/icon-names.ts`. It remains optional when parsing version-1
  documents for backward compatibility. New categories default to `expense`, and updates that omit
  `icon` preserve the stored value.
- The default taxonomy assigns a distinct semantic icon to every category. Re-running the population
  script updates stored icon names in place without changing category IDs or vector embeddings.

Admin reads and writes go through `CategoryClassifier`. `getCategoriesForUpdate()` delegates to `GlobalConfig.listCategories()`, while mutations delegate to `GlobalConfig.upsertCategory()`, `setCategories()`, and `deleteCategory()`. The Durable Object performs category reads and mutations against SQLite and schedules the full document to be written to `PUBLISHED_GLOBAL_CONFIG` under the same `categories` key before `CategoryClassifier` runs Vectorize work. Overlapping publication tasks converge to the latest SQLite document as described in `docs/global-config.md`.

Public category listing, authenticated classification, and expense `categoryId` validation read only `PUBLISHED_GLOBAL_CONFIG` with a 5 minute KV cache TTL. There is intentionally no DO fallback: missing, unreadable, or invalid KV data is a hard `500`. The admin list route reads `GlobalConfig` directly so administrative read/modify/write workflows observe strongly consistent state.

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

1. Read the category and stable vector ID from strongly consistent `GlobalConfig` storage.
2. Await `CATEGORY_INDEX.deleteByIds([vectorId])`. This confirms that Vectorize accepted the
   asynchronous mutation, not that index propagation has completed.
3. If Vectorize rejects the request, return `500` without removing the category so cleanup can be
   retried safely.
4. Call `GLOBAL_CONFIG.deleteCategory()`; inside the Durable Object, remove the category, store the
   updated document in SQLite, and schedule publication to `PUBLISHED_GLOBAL_CONFIG`.

Expense posting:

1. Validate record schema and project access as usual.
2. If `description.type === "expense"` and `categoryId` is present, read `PUBLISHED_GLOBAL_CONFIG`.
3. Reject unknown IDs with `400`; hard fail KV problems with `500`.

Project reads are more tolerant than writes. When returning stored records, the project route removes
an expense `categoryId` that is malformed, no longer present in the published document, or cannot be
resolved because category configuration is unavailable. Clients therefore treat that historical
record as the general `Others` expense instead of receiving a stale category reference.

## CLI

Use `pnpm run api -- <command>`. Commands target `http://localhost:5173` by default; use `--env=dev` or `--env=production` for deployed environments.

Commands:

```sh
pnpm run api -- category-list
pnpm run api -- category-add "Restaurant" --description="Places that sell prepared meals" --icon=restaurant
pnpm run api -- category-update <category-id> --name="Restaurant" --description="Prepared meals" --icon=restaurant
pnpm run api -- category-remove <category-id>
pnpm run api -- classify-category "Taco Bell" --top-k=5
pnpm run api -- classify-category "Taco Bell" --top-k=5 --verbose
```

`classify-category` prints the winning category name, score, and candidate category names by default. Pass `--verbose` to print complete category objects.

The `category-list` CLI command uses the strongly consistent admin compatibility route. Application
clients use public `GET /api/categories`, which reads published KV.

Seed the default category set through the CLI:

```sh
pnpm run categories:populate -- --env=local
pnpm run categories:populate -- --env=dev
pnpm run categories:populate -- --env=production
```

The seed script lists categories, skips existing categories whose normalized name, display name,
description, and icon match, creates missing categories, and updates changed categories in place to
preserve IDs.

After populating a replacement taxonomy, remove categories that are no longer seeded:

```sh
pnpm run categories:cleanup -- --env=local --dry-run
pnpm run categories:cleanup -- --env=local
```

Use the same commands with `--env=dev` or `--env=production`. Cleanup refuses to run until every
current seed category exists, so deployment order is always populate first and cleanup second.
Deleting an obsolete category does not rewrite immutable project records; the tolerant project-read
behavior above makes those old IDs render as `Others`.
Cleanup stops if a deletion is not accepted by Vectorize. Because the category remains configured,
rerunning the command safely retries that category.

## Default Taxonomy And Evaluation

The built-in taxonomy is optimized around shared apartments and group road, rail, flight, and ship
travel. Category meanings are intentionally flat and mutually exclusive. In particular:

- `Fuel & Charging` is only vehicle energy.
- `Vehicle Rental & Maintenance` is renting or maintaining a group-operated vehicle.
- `Parking & Tolls` is road access and vehicle parking.
- `Public Transit & Rideshare` is a purchased ride where the group is not operating the vehicle.
- Flights, lodging, passenger ships, and temporary travel connectivity remain separate travel
  intents.
- Home labor and repair services intentionally fall back to `Others`; a dedicated category was too
  broad and attracted unrelated expense descriptions.
- Pet expenses also fall back to `Others` because they are uncommon in the group-spend use cases the
  default taxonomy targets.

Run the live corpus against an isolated local state with a unique persistence path for each
experiment:

```sh
CATEGORY_EXPERIMENT_STATE=.wrangler/category-experiments/run-1 \
  pnpm run dev --config vite.category-experiment.config.ts --host 127.0.0.1 --port 5174
pnpm run categories:evaluate
```

The unique local Durable Object state creates a new persisted `vectorNamespace`; this is required
because the remotely bound Vectorize index persists across local-state resets. The evaluator seeds
the taxonomy, waits for Vectorize convergence, authenticates through the localhost fixed-code flow,
and reports overall, scenario, and per-challenge results. Use `--skip-seed --show-all` to rerun and
print every result against an already seeded experiment state.

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
