# RT-7 - Low/Medium - Random UUID Lookup Spray Has No Negative Cache

Date: 2026-06-14 14:13:28 PDT
Commit: 25f932606bd064aa29331732e190ef814c8889e6
Resolution: Fixed

Authenticated users can spray valid UUID-shaped project IDs. Every cache miss can reach the registry lookup path.

## Reproduce Steps

On the live local API at `http://localhost:5173/api/*`, I sent 50 authenticated `GET /api/project/<random-uuid>` requests.

Observed result:

- All 50 returned `404`.
- The batch completed in 68ms locally.

## Root Cause Analysis

The route rejects malformed project IDs before touching storage, which is good. But valid UUID-shaped misses call through the project-ref cache and then `ProjectsRegistry.lookupProject()`. There is no negative cache or per-user/IP throttling for high-cardinality unknown UUID misses.

## Resolution

Project route lookup now treats a PROJECT_REGISTRY_CACHE null result as a terminal negative cache entry, so UUID-shaped misses return 404 without falling back to ProjectsRegistry.lookupProject(). Focused tests assert random UUID misses and existing registry rows with missing KV entries do not touch PROJECTS_REGISTRY or PROJECT_STORE, and assert the KV get uses cacheTtl 60. Verified with pnpm test test/project.test.ts, pnpm run typecheck:worker, pnpm run typecheck:test, and a touched-file Prettier check. Live replay on a clean local Wrangler state sent 50 authenticated GET /api/project/<random-uuid> requests to http://localhost:5173 and observed 50 404 responses in 95ms with sample body {"error":"not_found"}.
