# RT-18 - Medium - Missing Project Reference Cache Entries Strand Registered Projects

Date: 2026-07-13 20:34:07 PDT
Commit: b8176cccc86cb33a2f59d7dcb56b6fe2f994c035

Project registration commits the authoritative registry row before a best-effort KV reference publication. Because a KV miss is treated as a terminal 404 and does not consult the registry, a failed or lost publication can make a successfully created project unreachable until an operator manually repairs the cache.

## Reproduce Steps

Live local API target: `http://127.0.0.1:5173/api/*`, running from a disposable Worker state.

Actor persona: the legitimate owner of a successfully created project. This is an operational failure-mode finding rather than an attacker-triggered cache deletion claim.

1. Created project `06f9bf9a-b715-43ce-b5ea-b75c37df4874` as `owner-1783999584307@example.com`; `PUT /api/project` returned `201`.
2. Waited for summary synchronization. `GET /api/admin/projects?limit=100&sort=updated_desc` returned `200` and listed the project with its owner, one member, and zero records, proving the authoritative registry and project summary existed.
3. Stopped the isolated server and deleted only `project:06f9bf9a-b715-43ce-b5ea-b75c37df4874` from the disposable local `PROJECT_REGISTRY_CACHE`. This simulates the final state after a registration-time KV publication failure or a lost cache entry without changing registry or project Durable Object state.
4. Restarted the server, logged in as the owner, and requested `GET /api/project/06f9bf9a-b715-43ce-b5ea-b75c37df4874` twice. Both requests returned `404 {"error":"not_found"}`.
5. Between those reads, the localhost admin registry endpoint still returned `200`, contained the project ID, and showed the intact project summary. The second project read remained `404` after that authoritative registry access.

The repository's focused registry test also injects a rejected `PROJECT_REGISTRY_CACHE.put()` during `registerProject()` and asserts that registration still returns `{ok:true}`. The manual local cache deletion reproduced the resulting cross-store state without claiming that local Wrangler itself generated a transient KV failure.

## Root Cause Analysis

`worker/do/ProjectsRegistry.ts:201-220` commits the `projects` and owner `project_members` rows first, then schedules project-reference publication after the transaction. `worker/do/ProjectsRegistry.ts:655-660` catches and logs publication failures without changing the successful registration result or scheduling a durable retry.

On every project route, `worker/routes/project.ts:1069-1080` returns `null` immediately when `PROJECT_REGISTRY_CACHE` reports a miss. `worker/routes/project.ts:1083-1099` classifies a literal KV `null` as that terminal miss. The registry fallback is used only when the KV read is unavailable or malformed, not when the key is absent.

The only cache repair path is `ProjectsRegistry.lookupProject()`, which schedules `repairProjectCacheIfOld()` for sufficiently old rows. But a normal missing key never reaches `lookupProject()` because `ProjectRefFetcher.fetch()` returns first. As a result, the system has an authoritative registry row and initialized ProjectStore but no self-healing request path from the missing-reference state.
