# Project List Caching

Use this before changing `/api/registry`, project summaries, or project-list cache behavior.

- `/api/registry` first checks the Cache API via `worker/routes/registry.ts`.
- On Cache API miss, `/api/registry` should call `ProjectsRegistry.listProjects()` only.
- `/api/registry` should not activate all linked `ProjectStore` Durable Objects.
- The internal Cache API entry is per normalized caller email and is stored with `Cache-Control: s-maxage=10`; `/api/registry` responses sent to clients use `Cache-Control: private, no-store`, including cache hits.
- Do not patch, delete, or carry custom expiry metadata for project-list Cache API entries.
- The project summary `lastSyncAt` comes from `ProjectsRegistry` summary rows, not from Cache API write time.
- Mutations that affect project-list summaries should queue a `ProjectStore` alarm rather than writing the Cache API directly.
