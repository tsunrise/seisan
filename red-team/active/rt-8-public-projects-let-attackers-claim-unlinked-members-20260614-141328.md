# RT-8 - Product Risk - Public Projects Let Attackers Claim Unlinked Members

Date: 2026-06-14 14:13:28 PDT
Commit: 25f932606bd064aa29331732e190ef814c8889e6

In a public project, any authenticated user can join by claiming an unlinked member ID. This may be intended for frictionless group expense sharing, but it is a surprising capability if public project IDs are shared or discoverable.

## Reproduce Steps

On the live local API at `http://localhost:5173/api/*`, I created a public project as owner, added an unlinked member named `Unlinked Friend`, then joined as a separate attacker identity using `{ "memberId": 2 }`.

Observed result:

`POST /api/project/:id/join` returned `201` and linked member `2` to `attacker-...@example.com`.

## Root Cause Analysis

For public projects, `getProjectMetadata()` authorizes any caller. `joinProject()` permits an authorized caller to claim any active unlinked member by ID.
