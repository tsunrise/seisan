# Durable Objects And Storage

Use this before changing Durable Object classes, storage schemas, migrations, or backfills.

## Core Rules

- Durable Object classes belong in `worker/do/`, one class per file.
- Use SQLite storage APIs for Durable Object state.
- Keep mutations that must be atomic inside a transaction.
- Be careful with shutdown behavior: if a method writes multiple related pieces of storage state, prefer a transaction or leave an inline TODO if a future transaction is needed.
- Keep Durable Object helper methods private when they are internal implementation details.
- Put pure row conversion helpers near the bottom of the file.

## Ownership

- `ProjectStore` owns project state, members, ACL data, records, and balances.
- `ProjectsRegistry` owns public project ID to ProjectStore Durable Object ID mapping, project membership index rows, and cached project summaries for `/api/registry`.
- `GlobalConfig` owns generic global key/value configuration in SQLite and publishes selected keys to `PUBLISHED_GLOBAL_CONFIG`. Read `docs/global-config.md` before adding keys or changing GlobalConfig behavior; category classification owns only the `categories` key in `docs/category-classification.md`.
- `PROJECT_REGISTRY_CACHE` stores public project ID to `ProjectStore` Durable Object ID references. Project routes treat a KV hit as the fast path and a KV miss as a terminal 404; they only consult `ProjectsRegistry.lookupProject()` when the KV read is unavailable or the cached value is malformed. `ProjectsRegistry` writes and repairs those references.

## Project Summary Sync

- `ProjectStore` queues project summary syncs with a Durable Object alarm.
- Use `setAlarmIfNotAlready()` style logic so repeated mutations inside the delay window do not reschedule or fan out.
- `ProjectStore.alarm()` syncs summary data to `ProjectsRegistry.syncProjectSummary()`.
- Keep the summary good enough for project lists; it does not need to be perfectly fresh.
- When a `ProjectStore` mutation affects project-list data, call `queueProjectSummarySync()` rather than writing registry summary rows or Cache API entries inline.

## Settlement Plan Cache

- `ProjectStore` stores the settlement plan and its `latestRecordId` together in the
  `settlementPlanCache` Durable Object KV value.
- Cache reads compare against `MAX(records.id)`, using zero for an empty ledger. This SQL value is
  authoritative even if project metadata KV lags a completed record transaction.
- Record changes invalidate the cache lazily through the ID mismatch. The cache has no TTL and does
  not need eager deletion when a record is posted.
- A `settle: true` transfer may patch a valid cache that matches the pre-insert `MAX(records.id)`.
  The submitted transfer must semantically equal the caller-linked member's complete cached sender
  batch. On a match, remove only that batch, preserve the remaining batches byte-for-byte and
  order-for-order, and store them with the inserted record ID.
- Cache patching is deliberately best effort: a missing, stale, malformed, partial, or nonmatching
  cache must not reject a valid transfer. Leave the prior value stale so the next read recomputes.
  Preserving an already-viewed plan favors stability and may retain a less efficient plan than a
  fresh computation; ordinary records continue to use lazy record-ID invalidation.
- Treat malformed cached JSON as a miss. Do not cache a computed plan when stored balances fail the
  safe-integer or zero-sum invariants.

## Public Durable Object Methods

Public Durable Object methods should follow the local pattern:

1. Check initialization and access first.
2. Validate RPC input.
3. Perform the minimal SQL reads and writes.
4. Queue summary/cache side effects after successful state changes.
5. Return a typed result union.

`ProjectStore` access checks should go through `getProjectAccess()` or `getOwnerAccess()` so owner/public/restricted behavior stays centralized.

## SQL Rows And Transactions

- For SQL rows, define narrow row interfaces that extend `Record<string, SqlStorageValue>`.
- Use typed `sql.exec<Row>(...)` calls and parameter placeholders rather than string interpolation for values.
- Prefer `.toArray()[0] ?? null` or explicit `undefined` checks for single-row reads.
- Keep JSON parsing and serialization at the storage boundary.
- Use `transactionSync()` for related SQL writes, especially records plus balances and registry summary/member-index rows.
- `ProjectStore` metadata and initialized state live in Durable Object KV (`projectMetadata`, `initialized`), outside SQL transactions; when a mutation updates both SQL rows and metadata KV, do the SQL transaction first, update KV deliberately, and queue alarms/cache writes only after storage updates have succeeded.
- Store extensible record data as JSON (`description_json`, `delta_json`) and keep schema-specific validation in TypeScript/zod instead of adding schema columns for every future record type.

## SQL Migrations

Use SQL migrations for every Durable Object schema change. This includes creating or dropping tables or indexes, adding columns, changing constraints, and any required persisted data shape change that the new code cannot safely run without.

Rules:

- Do not use `backfill()` for schema changes. If the Durable Object would be unusable or code would fail without the change, it belongs in SQL migrations.
- Add a new ordered migration group to the Durable Object class `static readonly migrations`.
- Do not edit migration groups that may already have run in deployed Durable Objects.
- Keep `dbMigrationVersion` in Durable Object storage KV.
- Run pending migrations with `runSqlMigrations(state, ClassName.migrations)` inside `ctx.blockConcurrencyWhile()`.
- Migrations should be deterministic and safe to run exactly once per Durable Object instance.
- Prefer `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, and explicit `ALTER TABLE` statements only when the target deployed state is known.
- After changing a Durable Object migration list, update migration tests that assert `dbMigrationVersion`.
- Wrangler-level Durable Object migrations in `wrangler.jsonc` are for class lifecycle changes such as introducing a new Durable Object class. Internal SQL migrations are still required for that Durable Object class's SQLite schema.

## Backfills

Use the shared `backfill()` helper only for temporary, one-time deployed-data repairs where missing the run does not make the Durable Object unusable. Backfills are lighter weight and less persistent than SQL migrations, and should be removed after confidence that deployed data has been repaired.

Rules:

- `backfill()` stores `dbBackfillState` in Durable Object storage KV and only marks the backfill complete after the awaited repair function succeeds.
- Use a unique, date-stamped name such as `20260607-project-summary`.
- Keep at most one active `backfill()` definition per Durable Object class.
- Before adding a new backfill for a Durable Object class, remove any previous completed backfill for that same class, including its call path, tests, helpers, and TODOs.
- Backfills for different Durable Object classes are independent.
- Backfills are appropriate for derived or redundant data, cache-like summaries, optional repair jobs, or best-effort compatibility fills.
- Backfills are not appropriate for required schema setup.
- Put the `backfill()` call close to the code path that can safely repair the data, such as a registry/listing path or another Durable Object method that has enough information to rebuild the missing state.
- Always add a cleanup TODO comment on every backfill use and every backfill-specific test, using this exact format: `TODO: remove this after backfill <backfill_name> is fully done`.
- Backfill tests should verify the repaired behavior and, when practical, that the helper does not run the same named backfill more than once.
