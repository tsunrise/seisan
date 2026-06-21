# RT-12 - Medium - Unauthorized Appends Exhaust Project Rate Limits

Date: 2026-06-20 20:41:28 PDT
Commit: 422376e9c6daaf4573c1210a8c3bea497b70fbff

An authenticated non-member can consume a project's append-record rate-limit bucket by sending syntactically valid POST /api/project/:id requests that are later rejected as forbidden. Because the route spends the project rate-limit token before ProjectStore.postRecord() checks whether the caller is an active linked member, the attacker can temporarily block legitimate project members from posting records.

## Reproduce Steps

Live local API target: `http://localhost:5173/api/*`.

Actor personas:

- Owner: authenticated project owner.
- Attacker: authenticated account with no linked member in the target project.

Sequence A:

1. Started from a clean Wrangler state and logged in with the local fixed code as `owner-1782013239372@example.com` and `attacker-1782013239372@example.com`.
2. Owner created a public project with `PUT /api/project`.
   - Project ID: `4202c3fd-86f1-4d90-b265-23a4f76efe2f`
   - Response: `201`.
3. Attacker sent 60 syntactically valid append requests to `POST /api/project/4202c3fd-86f1-4d90-b265-23a4f76efe2f`.
   - Body shape: an `expense` record where member `1` pays and owes 100 cents, producing an empty delta.
   - Observed statuses: `60` responses with `403 {"error":"forbidden"}`.
4. Owner immediately sent a valid append request to the same endpoint.
   - Response: `429 {"error":"rate_limited","reason":"project"}`.
5. Owner read the project with `GET /api/project/4202c3fd-86f1-4d90-b265-23a4f76efe2f`.
   - Response: `200`, with `0` records, confirming the attacker did not create records but still exhausted the project limiter.

Control sequence:

1. Logged in as fresh identities `owner-1782013271593-control@example.com` and `attacker-1782013271593-control@example.com`.
2. Owner created public project `75414c7e-1127-41f1-9179-63a7ae506ba8`.
3. Owner sent a valid append before the attack.
   - Response: `201 {"id":1}`.
4. Attacker sent 59 valid-shaped append requests as a non-member.
   - Observed statuses: `59` responses with `403 {"error":"forbidden"}`.
5. Owner sent another valid append.
   - Response: `429 {"error":"rate_limited","reason":"project"}`.
6. Owner read the project.
   - Response: `200`, with `1` record, confirming only the pre-attack owner append persisted.

This is API/client feasible for any authenticated attacker who knows a project ID. Public project IDs are naturally shared with participants and guests, and the attack does not require membership in the target project.

## Root Cause Analysis

`POST /api/project/:id` validates the request body and resolves the project reference, then calls `AppendRecordRateLimiter.limit()` before invoking `ProjectStore.postRecord()` (`worker/routes/project.ts:681-705`).

`AppendRecordRateLimiter.limit()` spends both the account bucket and the project bucket, including `APPEND_RECORD_PROJECT_RATE_LIMITER`, before any project-local authorization result is known (`worker/routes/project.ts:776-794`). The configured project bucket is `60` requests per `60` seconds (`wrangler.jsonc:82-98`).

The project-local permission check happens later inside `ProjectStore.postRecord()`. For public projects, `getProjectMetadata()` authorizes any authenticated caller because `isAuthorized()` returns true for public ACLs (`worker/do/ProjectStore.ts:989-994` and `worker/do/ProjectStore.ts:1031-1034`). Posting a record still requires the caller to be an active linked member; a non-member fails only after the route has already spent the project rate-limit token (`worker/do/ProjectStore.ts:244-254`).

The result is an authorization/rate-limit ordering bug: unauthorized append attempts are correctly rejected as `403`, but they are counted against the shared project mutation bucket and can deny legitimate member writes until the limiter window resets.
