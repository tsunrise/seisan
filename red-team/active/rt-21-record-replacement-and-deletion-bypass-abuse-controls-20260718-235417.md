# RT-21 - Medium - Record Replacement And Deletion Bypass Abuse Controls

Date: 2026-07-18 23:54:17 PDT
Commit: dabd697baf2eb4e8b7781d767e7700716ef2083e

The new record replacement and deletion endpoints do not consult the caller's records.allow_post block and do not invoke the account or project record rate limiters, so a blocked linked account can mutate records without the controls applied to record creation.

## Reproduce Steps

Confirmed with isolated Worker-runtime requests against `https://seisan.test/api/*` and disposable
test storage. No production traffic was used. A separate Wrangler HTTP probe was not run because a
pre-existing user-owned Vite process occupied the required localhost port.

Actor personas:

- Owner: `owner@example.com`, project owner and author of record 1.
- Blocked member: `blocked@example.com`, linked to a different active project member.

1. The owner created a public project and appended record 1. `POST /api/project/:id/record` returned
   `201 {"id":1}`.
2. The blocked account joined the project. Its disposable user limits document was then set to
   `{"records.allow_post":false}`, equivalent to an administrator publishing the account-specific
   posting block.
3. Both record rate-limit bindings were replaced with rejecting probes so any invocation would
   return `success: false` and be observable.
4. The blocked account attempted another `POST /api/project/:id/record`. It returned `403` with
   `{"error":"posting_blocked"}`, confirming that its account policy was active.
5. The same account sent a valid `PUT /api/project/:id/record/1`. It returned `200` and replaced the
   record.
6. The same account sent `DELETE /api/project/:id/record/1`. It returned `204` and tombstoned the
   record.
7. Neither the account nor project rate-limit probe was called by the replacement or deletion.

This is direct-client feasible for any linked member. Repeating valid replacements causes Durable
Object SQL/KV writes, project metadata updates, and summary-sync work without the 10-per-minute
account control. It also lets an account that administrators blocked from creating records continue
to rewrite or erase existing project history.

## Root Cause Analysis

The append route at `worker/routes/project.ts:1129-1149` loads the caller's limits, checks
`allowsRecordPost()`, and spends both the account and project rate-limit tokens before calling the
Durable Object.

The new replacement route at `worker/routes/project.ts:1000-1053` and deletion route at
`worker/routes/project.ts:1055-1095` perform none of those checks. They authenticate the caller and
delegate directly to `ProjectStore.putRecord()` or `ProjectStore.deleteRecord()`.

Those Durable Object methods at `worker/do/ProjectStore.ts:369-417` load the project owner's limits
only. The policy is used for description, money, and resulting-balance bounds; it does not load or
enforce the caller's `records.allow_post` value and has no access to the route-level rate-limit
bindings.

`test/project.test.ts:1490-1533` explicitly asserts that the limiter is called only for appends and
not for replacement or deletion. `test/project.test.ts:2670-2737` also sets
`records.allow_post:false` for the linked editor and expects both the `200` replacement and `204`
deletion to succeed. This conflicts with `docs/api-serving.md:107-109`, which says record creation,
replacement, and deletion are protected at 10 requests per minute per account and 120 per project.
