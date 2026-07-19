# RT-20 - High - Public Project Members Can Rewrite Unlinked Payment Profiles

Date: 2026-07-18 23:54:17 PDT
Commit: b7a00394afbdda4386430469d82fcfacdd302b6d

After joining a public project, an arbitrary authenticated account can rename any unlinked member, replace that member's payment instructions, and create additional unlinked members, enabling payment redirection and member-capacity exhaustion.

## Reproduce Steps

Confirmed with isolated Worker-runtime requests against `https://seisan.test/api/*` and disposable
test storage. No production traffic was used. A separate Wrangler HTTP probe was not run because a
pre-existing user-owned Vite process occupied the required localhost port.

Actor personas:

- Owner: `owner@example.com`, owner of a public project.
- Attacker: `attacker@example.com`, initially unrelated to the project.
- Target: an unlinked project member named `Recipient`.

1. The owner created a public project and the unlinked target member.
2. The attacker joined with `POST /api/project/:id/join` and `{"name":"Mallory"}`. It returned
   `201`, making the attacker an active linked member without owner approval.
3. The attacker sent `PATCH /api/project/:id/members/:targetId` with
   `{"name":"Recipient impostor"}`. It returned `200`.
4. The attacker sent `PUT /api/project/:id/members/:targetId/config` with
   `{"paymentMethod":"venmo: attacker"}`. It returned `200` with
   `{"paymentMethod":"venmo: attacker"}`.
5. The attacker sent `POST /api/project/:id/members` with `{"name":"Injected member"}`. It
   returned `201`, showing that the same permission can consume additional project member slots.
6. The owner's next `GET /api/project/:id` returned `200` and showed the target as
   `Recipient impostor` with `paymentMethod: "venmo: attacker"`.

This is browser-feasible for an authenticated attacker who knows a public project ID. The target
must still be unlinked, but unlinked members can hold balances and appear as settlement recipients.
The altered payment method is rendered in transfer and settlement UI, so a project participant can
be directed to send funds to the attacker's account. Repeated member creation can also fill the
owner's shared `projects.maxMembersPerProject` allowance.

## Root Cause Analysis

Public project authorization at `worker/do/ProjectStore.ts:1651-1654` permits an arbitrary
authenticated account to enter the join flow. Once joined, commit
`b7a00394afbdda4386430469d82fcfacdd302b6d` expands that account's authority beyond its own member.

`createMember()` at `worker/do/ProjectStore.ts:587-623` now accepts either the owner or any active
linked member. It applies the owner's shared member-count policy, so every successful attacker
request consumes project-wide capacity.

For edits, `getMemberWriteAccess()` at `worker/do/ProjectStore.ts:1665-1694` grants access whenever
the target is unlinked and the caller has any other active linked member. Both member renames and
member-config writes use this helper, so the attacker does not need to own, represent, or claim the
target member. The resulting name/config records do not identify the editor in the API response.

`test/project.test.ts:1854-1986` explicitly confirms that a non-owner linked member can create an
unlinked member, rename it, and replace and patch its payment method. The temporary red-team probe
combined that permission with a public-project join and confirmed the complete outsider-to-payment
profile rewrite path.

RT-8 accepted the narrower risk that public-project outsiders can claim an unlinked member. This is
a new consequence: the July 18 permission change lets an outsider join as a separate member and
then control every remaining unlinked identity and its payment destination without claiming it.
