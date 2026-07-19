# RT-19 - High - Authenticated Public Readers Receive Member Payment Instructions

Date: 2026-07-18 23:54:17 PDT
Commit: de374d20fd55712f662c21af9e59dc29b2ff06a2

Any authenticated account that can resolve a public project can read every member's payment instructions, and soft-deleting a member preserves those instructions while preventing them from being cleared through the API.

## Reproduce Steps

Confirmed with isolated Worker-runtime requests against `https://seisan.test/api/*` and disposable
test storage. No production traffic was used. A separate Wrangler HTTP probe was not run because a
pre-existing user-owned Vite process occupied the required localhost port, so the evidence below is
Worker-runtime rather than a live network reproduction.

Actor personas:

- Owner: `owner@example.com`, owner of a public project.
- Outsider: `outsider@example.com`, authenticated but neither linked to the project nor listed in an
  ACL.

1. The owner created a public project and an unlinked member named `Recipient`.
2. The owner sent `PUT /api/project/:id/members/:memberId/config` with
   `{"paymentMethod":"zelle: 123456789"}`. It returned `200` with the same payment method.
3. The outsider sent `GET /api/project/:id/members/:memberId/config`. It returned `200` with
   `{"paymentMethod":"zelle: 123456789"}`.
4. The outsider sent `GET /api/project/:id`. It returned `200`, and the recipient entry in `members`
   also contained `config.paymentMethod: "zelle: 123456789"`.
5. The owner soft-deleted the recipient with `DELETE /api/project/:id/members/:memberId`. It returned
   `204`.
6. The outsider repeated the config GET. It still returned `200` with
   `{"paymentMethod":"zelle: 123456789"}`.
7. The owner attempted to clear the deleted member's config with `PUT .../config` and `{}`. It
   returned `409 {"error":"already_deleted"}`.

The disclosure is browser-feasible for any signed-in account that opens a known public-project URL,
and direct-client feasible through an API key. Restricted-project ACL viewers receive the same
config read access even before linking a member. The existing focused project tests and the temporary
three-case red-team probe both passed with these statuses.

## Root Cause Analysis

`worker/do/ProjectStore.ts:1594-1663` treats every caller as authorized when the project ACL is
public. `getMemberConfig()` at `worker/do/ProjectStore.ts:797-816` performs only that project-level
read check before returning `memberConfigFromRow(member)`; it does not require the caller to be the
owner or an active linked member and does not reject deleted members.

The full project read has the same exposure. `getRecords()` at
`worker/do/ProjectStore.ts:473-479` sets `includePrivateFields` from `metadata.email !== null`, so
merely being authenticated adds every member's config, including payment instructions, to the
response for a public project.

Deletion does not minimize or remove the newly sensitive field. `deleteMember()` at
`worker/do/ProjectStore.ts:919-924` clears `linked_email` and sets `deleted_at` but leaves `config`
unchanged. Conversely, `getMemberWriteAccess()` at `worker/do/ProjectStore.ts:1677-1683` rejects a
deleted member before considering owner authority, so the public API cannot clear the retained
payment method after deletion.

The behavior is explicitly covered by `test/project.test.ts:2242-2288` for authenticated outsider
reads and `test/project.test.ts:2291-2348` for retained post-deletion config. This is distinct from
the previously accepted linked-email exposure in RT-3: commit
`de374d20fd55712f662c21af9e59dc29b2ff06a2` introduced opaque payment instructions that can contain
phone numbers, account handles, or other transfer identifiers, and made them persistent after member
deletion.
