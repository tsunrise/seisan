# GlobalConfig

Use this before changing `GLOBAL_CONFIG`, `PUBLISHED_GLOBAL_CONFIG`, `worker/globalConfig.ts`, `worker/do/GlobalConfig.ts`, or any feature that stores a new global config key.

This document is generic GlobalConfig guidance. Feature docs should still describe feature-specific schemas and semantics; for example, category classification owns the `categories` key in `docs/category-classification.md`.

## Purpose

`GLOBAL_CONFIG` is the strongly consistent Durable Object for platform-wide configuration that does not belong to one project, user, or session.

`PUBLISHED_GLOBAL_CONFIG` is the eventually consistent KV projection for hot-path reads. Request paths that can tolerate eventual consistency should read from KV through the typed helpers in `worker/globalConfig.ts`; admin or read/modify/write operations should go through feature-specific `GlobalConfig` Durable Object methods.

Current bindings:

- `GLOBAL_CONFIG`: Durable Object namespace for `worker/do/GlobalConfig.ts`, reached with `getByName("global-config")`.
- `PUBLISHED_GLOBAL_CONFIG`: KV namespace containing published JSON values by global config key.

Current keys:

- `categories`: versioned category-classification configuration.
- `blocked_emails`: versioned regex policy used to reject unsupported emails during browser login.

`GlobalConfig` stores values in SQLite:

```sql
CREATE TABLE global_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
)
```

## Code Ownership

- `worker/globalConfig.ts`: key literals, value types, parse/serialize codecs, and typed published-KV read helpers.
- `worker/do/GlobalConfig.ts`: strongly consistent storage, private `readKey`/`writeKey` helpers, and feature-specific Durable Object RPC methods.
- Feature modules: pure schema/mutation helpers and route-level orchestration for side effects outside GlobalConfig, such as Workers AI, email, or other external services.

Keep generic key/value parsing in `worker/globalConfig.ts`. Keep feature-specific read/modify/write logic in public methods on `GlobalConfig`, backed by small pure helper modules when the logic is more than a few lines.

## Adding A Key

1. Define the value schema and TypeScript type in the owning feature module.
2. Add the key literal to `GlobalConfigKey` in `worker/globalConfig.ts`.
3. Add the value type to `GlobalConfigValueByKey`.
4. Add a parse/serialize codec to `GlobalConfigValueCodecs`.
5. Add feature-specific public methods to `GlobalConfig` for admin writes or any read/modify/write behavior.
6. Use `PublishedGlobalConfigKvStore.getValue(key)` for hot-path reads that should use KV.
7. Update the owning feature doc with the key name, value shape, read behavior, failure behavior, and tests.

Do not add generic `get`/`put` public methods for new features by default. Prefer named feature methods, such as `upsertCategory`, so validation, mutation rules, and publication behavior are explicit and tested.

## Write Behavior

`GlobalConfig` feature methods should follow this shape:

1. Validate RPC input.
2. Read the current value with `readKey(key, schema)`.
3. Build the next value with pure TypeScript helpers.
4. Write SQLite and schedule KV publication with `writeKey(key, value)`.
5. Return a typed result union that routes can map to stable HTTP errors.

`writeKey` serializes through the key's registered codec, writes SQLite first, then schedules `publishLatestValue(key)` with `this.ctx.waitUntil(...)`. The publication task reads the serialized value back from SQLite before writing it to `PUBLISHED_GLOBAL_CONFIG`. Callers do not wait for KV publication and do not receive KV publication failures. Publication failures are logged.

`waitUntil` keeps publication work alive but is not an ordering queue. Multiple publications can overlap and KV writes can finish out of order. The GlobalConfig publication task checks the current SQLite value after every KV write and republishes when necessary until KV has received the latest value from that Durable Object.

Do not rely on published KV being visible immediately after an admin write response. Strongly consistent admin reads should continue to use `GlobalConfig`.

Do not await external feature side effects between reading the current value and writing the next value. Run non-storage side effects after the GlobalConfig mutation unless the feature deliberately documents a different ordering.

## Read Behavior

Admin reads should use the relevant `GlobalConfig` method so they observe strongly consistent state.

Hot-path reads should use `PublishedGlobalConfigKvStore`, which applies a 5 minute KV cache TTL and validates values with the same key/value codec registered in `worker/globalConfig.ts`.

Each feature decides how KV failures map to user behavior. Category classification intentionally has no Durable Object fallback for hot-path KV failures.

## Blocked Emails

`blocked_emails` stores this strict document:

```json
{
  "version": 1,
  "patterns": [
    {
      "pattern": "@example\\.com$",
      "reason": "Please use your organization email."
    }
  ]
}
```

The document allows at most 100 ordered rule objects. Each rule has a required `pattern` of at most
512 characters and an optional user-facing `reason` of at most 256 characters. Both fields are
trimmed and single-line; patterns must be non-empty and compile as JavaScript regular expressions
with fixed `iu` flags. Empty reasons are omitted. The version-1 object shape intentionally does not
accept the earlier, undeployed string-array draft and has no compatibility parser or migration.
Emails are normalized before matching. Substring matching is allowed, and the first matching rule,
including its reason when present, is reported by admin tests.

Admin GET, PUT, and test operations use `GLOBAL_CONFIG` for strongly consistent behavior. A missing
value reads as `{ "version": 1, "patterns": [] }`. PUT writes SQLite and schedules publication to
`PUBLISHED_GLOBAL_CONFIG`; login edges can therefore take up to the five-minute KV cache window to
observe a change.

Login reads only `PUBLISHED_GLOBAL_CONFIG`. Missing, unreadable, or invalid published values fail
open and do not block login; read and validation failures are logged. There is no Durable Object
fallback on the login path.

## Bindings And Migrations

Wrangler-level Durable Object migrations for `GlobalConfig` belong at the top level of `wrangler.jsonc`, not repeated per environment.

The internal SQLite schema for `GlobalConfig` is managed by `GlobalConfig.migrations`. Adding a new key usually does not require a SQL migration because the table stores JSON by key. A SQL migration is only needed when the table shape itself changes.

Create and configure remote KV namespaces for `PUBLISHED_GLOBAL_CONFIG` before deploying environments that read published global config.

## Tests

For each new key, add focused tests for:

- Missing stored value behavior.
- Invalid stored JSON or schema mismatch.
- Successful write updates SQLite and schedules KV publication.
- KV publication failure logging when practical.
- Concurrent read/modify/write behavior when the feature mutates existing documents.
- Out-of-order KV write completion converges to the latest SQLite value.
- Hot-path KV reads, including cache/failure behavior if the route depends on it.

Update `cleanupWorkerTestState()` if the key writes data that persists across tests.
