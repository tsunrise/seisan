# RT-17 - Medium - Multi-Account Unauthorized Appends Exhaust Project Rate Limits

Date: 2026-07-13 20:34:07 PDT
Commit: b8176cccc86cb33a2f59d7dcb56b6fe2f994c035

Two authenticated non-members can consume the shared project append bucket with requests that are rejected only after both account and project rate-limit tokens are spent, temporarily denying legitimate project members the ability to post records.

## Reproduce Steps

Live local API target: `http://127.0.0.1:5173/api/*`, running from a disposable Worker state.

Actor personas:

- Owner: `owner-1783999584307@example.com`, linked to member 1 of the target project.
- Attacker one: `attacker-one-1783999584307@example.com`, authenticated but not linked to the project.
- Attacker two: `attacker-two-1783999584307@example.com`, authenticated but not linked to the project.

1. The owner created public project `06f9bf9a-b715-43ce-b5ea-b75c37df4874`; `PUT /api/project` returned `201`.
2. Each attacker sent 60 syntactically valid `POST /api/project/06f9bf9a-b715-43ce-b5ea-b75c37df4874` requests. The body described a 100-cent expense paid and owed by member 1 with an empty derived delta.
3. All 60 requests from attacker one and all 60 requests from attacker two returned `403`. The 120 rejected mutations completed in 519 ms and created no records.
4. The owner immediately sent the same valid append request. It returned `429 {"error":"rate_limited","reason":"project"}`.
5. The owner read the project. `GET /api/project/06f9bf9a-b715-43ce-b5ea-b75c37df4874` returned `200` with zero records, confirming that only shared rate-limit capacity, not project state, had changed.

This is direct-client feasible for authenticated attackers who know a public project ID. It is a multi-account regression of the abuse class described in resolved RT-12: the current 60-per-account and 120-per-project configuration requires two identities instead of one, but unauthorized requests still consume the shared project bucket before authorization fails.

## Root Cause Analysis

`worker/routes/project.ts:928-943` spends the caller's account token and then the shared project token before calling `ProjectStore.postRecord()`. Project-local authorization occurs only inside that Durable Object call, after both rate-limit operations have succeeded.

For a public project, an authenticated non-member can resolve and read the project, but `ProjectStore.postRecord()` rejects the caller because there is no active linked member. The route maps that later failure to `403`, after the shared token is already gone.

`worker/routes/project.ts:1010-1038` scopes the account limiter by the normalized email hash and the project limiter by public project ID. `wrangler.jsonc:121-137` configures 60 requests per 60 seconds per account and 120 requests per 60 seconds per project. Two identities can therefore spend the full project allowance while remaining below their separate account ceilings.

The previous RT-12 resolution added a longer-lived automated per-account no-post block. Commit `eda3f036278fb34ca8137d602462ccdcaa3f8001` removed that mechanism and doubled the project bucket from 60 to 120, leaving the authorization/rate-limit ordering unchanged and reopening the targeted denial with two accounts.
