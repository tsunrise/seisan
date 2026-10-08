# Category Classification

Use this document before changing category classification only: category admin routes, the authenticated classification endpoint, category schema, `categories` GlobalConfig data, `PUBLISHED_GLOBAL_CONFIG` category reads, the clef-flash classifier, category CLI commands, seed script, or category tests.

Do not require this document for unrelated `GlobalConfig` keys or non-category global configuration work. For generic GlobalConfig ownership and extension guidance, read `docs/global-config.md`.

## Scope

Category classification uses a fixed platform-managed category set. Users cannot create custom categories. Expenses may include an optional `categoryId`, and posting validates that ID against the published category document.

Implementation files:

- `worker/category/index.ts`: public exports and `CategoryClassifier` orchestration.
- `worker/category/schema.ts`: category Zod schemas and inferred types.
- `worker/category/document.ts`: category document codec, construction, canonical ordering, and pure mutations.
- `worker/category/clef.ts`: the clef-flash request builder, response validation, and ranking.
- `worker/do/GlobalConfig.ts`: generic strongly consistent SQL key/value store plus category mutation methods.
- `worker/routes/categories.ts`: public category listing, authenticated classification, and admin
  category CRUD routes.
- `scripts/client.ts`, `scripts/client-cli.ts`, `scripts/populate-categories.ts`, and
  `scripts/cleanup-categories.ts`: CLI support, seeding, and removal of obsolete categories.
- `scripts/category-challenges.ts` and `scripts/evaluate-categories.ts`: the labeled
  classification corpus and the live end-to-end evaluation harness.
- `test/categoryClassification.test.ts`: focused category coverage.
- `src/domain/categories.ts`: the client-side rule that turns a classification into an automatic
  category or `Others`.

Admin routes are excluded from public OpenAPI. `GET /api/categories` is a public unauthenticated API
surface. `POST /api/categories/classify` is included in OpenAPI with bearer API-key auth.

## API

Application routes:

- `GET /api/categories`: public read-only route returning `{ categories }` from
  `PUBLISHED_GLOBAL_CONFIG` so public project timelines can resolve category labels and icons.
- `POST /api/categories/classify` with `{ name, topK? }`: classifies a post name and returns
  `{ category, score, othersScore, candidates }`. `score` and every candidate `score` are clef-flash
  probabilities. `othersScore` is the probability of the explicit "none of these" option. All
  category probabilities plus `othersScore` sum to 1, and `candidates` is the top `topK` categories
  by probability.

Admin routes:

- `GET /api/admin/categories`: returns the same response shape from strongly consistent `GlobalConfig` storage for admin workflows.
- `POST /api/admin/categories` with `{ name, description?, icon? }`: creates a category and returns `{ category }` with status `201`.
- `PUT /api/admin/categories/:id` with `{ name, description?, icon? }`: updates a category in place and returns `{ category }`.
- `DELETE /api/admin/categories/:id`: removes the category and returns `204`.

Request behavior:

- Duplicate normalized category names return `409 { error: "category_exists" }`.
- `Others`, compared case-insensitively, is reserved for the built-in fallback and the classifier's
  "none of these" option. Creating or renaming a category to it returns `400`.
- A document holds at most 254 categories, because clef-flash accepts up to 255 choice options and
  one is `Others`.
- Invalid bodies, invalid IDs, or invalid `topK` return `400 { error: "invalid_request" }`.
- Classification with no active matching category returns `404 { error: "not_found" }`.
- Classification is limited to 30 requests per minute per normalized account. Session and API-key
  authentication for the same account share one quota; excess requests return
  `429 { error: "rate_limited", reason: "account" }` before Workers AI is called.
- KV read, missing document, invalid document, Workers AI failures, and clef-flash responses that
  do not match the expected choice-answer shape return `500 { error: "internal_server_error" }`.
- `topK` defaults to `5` and is capped at `20`.

## Storage And Published Config

Generic `GLOBAL_CONFIG` and `PUBLISHED_GLOBAL_CONFIG` behavior is documented in `docs/global-config.md`.

Category classification owns only the `categories` key. Its value is a JSON string:

```json
{
  "version": 2,
  "categories": [
    {
      "id": "<uuid>",
      "name": "Restaurant",
      "normalizedName": "restaurant",
      "description": "Prepared meals...",
      "icon": "restaurant",
      "createdAt": 1814136000000,
      "updatedAt": 1814136000000
    }
  ]
}
```

The `categories` key and `CategoriesDocument` value type are registered in `worker/globalConfig.ts` so published KV reads share the same TypeScript contract and parse/serialize codec as the stored category document.

Schema invariants:

- Category arrays are serialized in normalized-name order, and IDs and normalized names must be
  unique within a document. Display names are therefore unique too, which lets the classifier use
  them as clef-flash option IDs.
- `icon` is one of the names in `shared/icon-names.ts`. It remains optional when parsing for
  backward compatibility. New categories default to `expense`, and updates that omit `icon`
  preserve the stored value.
- The default taxonomy assigns a distinct semantic icon to every category. Re-running the population
  script updates stored icon names in place without changing category IDs.

Only version 2 is accepted. Version 1 documents came from the retired Vectorize classifier and
carried `vectorNamespace`, `documentText`, and `vectorId`; dev and production were rewritten to
version 2 before version-1 parsing was removed. A leftover version-1 document, for example in an old
local `.wrangler/state`, fails to parse: GlobalConfig reports `invalid_value` and every category
route returns `500`. Reset that local state and run `categories:populate` again.

Admin reads and writes go through `CategoryClassifier`. `getCategoriesForUpdate()` delegates to `GlobalConfig.listCategories()`, while mutations delegate to `GlobalConfig.upsertCategory()` and `deleteCategory()`. The Durable Object performs category reads and mutations against SQLite and schedules the full document to be written to `PUBLISHED_GLOBAL_CONFIG` under the same `categories` key. Category mutations have no other side effects. Overlapping publication tasks converge to the latest SQLite document as described in `docs/global-config.md`.

Public category listing, authenticated classification, and expense `categoryId` validation read only `PUBLISHED_GLOBAL_CONFIG` with a 5 minute KV cache TTL. There is intentionally no DO fallback: missing, unreadable, or invalid KV data is a hard `500`. The admin list route reads `GlobalConfig` directly so administrative read/modify/write workflows observe strongly consistent state.

Create the remote KV namespaces before deploying dev or production, then fill the generated IDs into `wrangler.jsonc`:

```sh
pnpm exec wrangler kv namespace create PUBLISHED_GLOBAL_CONFIG --env dev
pnpm exec wrangler kv namespace create PUBLISHED_GLOBAL_CONFIG --env production
```

## clef-flash Classifier

Classification uses Workers AI model `@cf/cloudflare/clef-flash`, a decision model that scores a
state against typed questions and returns a probability for every allowed answer. There is no index
to keep in sync: each request sends the full current published category list.

`ClefCategoryClassifier.request()` builds one request:

- `state`: the normalized post name.
- `questions.category`: a `choice` question with fixed instructions describing a shared-ledger
  expense name.
- `criteria`: one option per published category, keyed by its display name, with its description
  as the option text (`null` when the description is empty), plus an `Others` option meaning that no
  listed category clearly fits.

The response is validated with zod. Categories missing from `probabilities` score `0`, and a
malformed answer is a `500`. Because the request reads the published KV snapshot, deleted
categories stop being offered once the deletion is published, and there are no stale-ID filters.

Clients choose a category automatically only when its probability is at least
`CATEGORY_SCORE_THRESHOLD` (`0.2`) and at least `othersScore`. Otherwise they fall back to `Others`.
The rule lives in `automaticCategoryId()` in `src/domain/categories.ts` and is shared by the
composer and the live evaluator.

Each request costs about 1,150 input tokens for the 19-category default taxonomy, or about $0.10
per 1,000 classifications at clef-flash's $0.09 per million input tokens. Cost grows linearly with
the number and length of category descriptions. clef-flash is deterministic: repeated requests
return identical probabilities.

## Consistency

Create, update, or delete category:

1. Validate and normalize request body or ID.
2. Call `GLOBAL_CONFIG.upsertCategory()` or `GLOBAL_CONFIG.deleteCategory()`. Upsert creates an
   empty document only on first category creation.
3. Inside the Durable Object, reject duplicate normalized names, write the updated document to
   SQLite, and schedule publication to `PUBLISHED_GLOBAL_CONFIG`.

Classification sees the change once publication completes and the 5 minute KV cache TTL expires.

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

`classify-category` prints the winning category name, score, `othersScore`, and candidate category names by default. Pass `--verbose` to print complete category objects.

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
Cleanup stops at the first failed deletion. Because the category remains configured, rerunning the
command safely retries that category.

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

### Model Choice

A one-off benchmark ran clef-flash on `CATEGORY_CHALLENGES` and `SEED_CATEGORIES` through the
Workers AI REST API, using the production request and `automaticCategoryId()` with the `0.2`
threshold.

Result on 2026-10-07 (167 challenges, 19 categories):

| Strategy                               | Accuracy        | Apartment     | p50 / p95 latency |
| -------------------------------------- | --------------- | ------------- | ----------------- |
| clef-flash, shipped rule               | 160/167 (95.8%) | 38/43 (88.4%) | 299 / 438 ms      |
| clef-flash, ignoring the Others option | 158/167 (94.6%) | 36/43 (83.7%) | n/a               |

The expected category is in the top three for every non-`Others` challenge. Most remaining misses are home
labor and pet expenses that this taxonomy deliberately routes to `Others`, for example "House
cleaner", "Fix broken sink", and "Dog food".

### Live End-To-End Evaluation

Run the corpus through the real Worker routes against an isolated local state:

```sh
CATEGORY_EXPERIMENT_STATE=.wrangler/category-experiments/run-1 \
  pnpm run dev --config vite.category-experiment.config.ts --host 127.0.0.1 --port 5174
pnpm run categories:evaluate
```

The evaluator seeds the taxonomy, waits briefly for KV publication, authenticates through the
localhost fixed-code flow, and reports overall, scenario, and per-challenge results. Use
`--skip-seed --show-all` to rerun and print every result against an already seeded experiment
state.

For remote admin requests, and for every dev request, the client runs `cloudflared access token -app=<request-url>` automatically and sends the resulting token as `cf-access-token`. Use the concrete request URL for token lookup because normal dev and admin paths can belong to different Access applications with different audiences.

## Local Testing

For live local API probes, follow `docs/development.md` for clean `.wrangler/state` backup and restore.

Worker tests replace the `AI` binding with a fake that returns clef-flash-shaped answers, so they do
not call Workers AI.

Focused checks:

```sh
pnpm run typecheck:worker
pnpm run typecheck:test
pnpm run typecheck:node
pnpm test test/categoryClassification.test.ts test/categoryUi.test.ts
```
