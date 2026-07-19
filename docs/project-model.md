# Project Model

Use this before changing project, member, record, ACL, or balance behavior.

## Identity And Membership

- Project records are keyed by project-local numeric `memberId`, not email.
- Emails are for authentication, ACL access, and linking a logged-in user to a project member.
- Email addresses accepted at Worker boundaries are limited to 255 characters.
- Deleted members are soft-deleted so historical records can still render.
- Owner identity is stored in `ProjectStore`.
- Owner-only checks should happen in `ProjectStore` unless the operation only touches registry metadata.

## Member Config

- A member may have optional `size` and `paymentMethod` metadata in its JSON config. `size` is the
  positive number of people represented by that member. The backend does not weight balances,
  settlement calculations, or membership limits by size; the frontend uses it as the default weight
  when composing equal and ratio expense splits, and the posted liability remains explicit cents by
  member ID.
- `paymentMethod` is an opaque, trimmed payment instruction string. Seisan does not parse provider
  names or account identifiers from it.
- Authenticated full project reads include member configs. Logged-out public-project responses omit
  config, while ordinary member responses and registry summaries never include it. The owner or the
  account linked to a member may replace or shallow-patch that member's config. Any active linked
  member may also write config for an unlinked active member.
- Stored member config is parsed independently with zod. Malformed config falls back to an empty
  object for that member so one bad row cannot break project or registry reads.
- Member-config creation is a follow-up write after project creation, joining, or placeholder-member
  creation because those existing mutation payloads remain unchanged. UI flows should use the
  returned member ID and surface any follow-up failure without assuming the first mutation rolled
  back.

## Balances And Records

- Balances are stored by member ID, in cents.
- Record descriptions are JSON to allow future description types without schema churn.
- Validate that record deltas match the server-derived delta and sum to zero.
- Record creation uses `POST /api/project/:id/record`. Individual live records can be read,
  replaced, or deleted through `/api/project/:id/record/:recordId`.
- Any active linked project member may replace or delete any live record. Replacement preserves the
  original author and creation time while recording the latest editor and edit time. Replacement
  cannot change the record's expense, transfer, or promise type.
- Replacement applies the difference between the new and stored deltas to balances. Deletion
  applies the inverse stored delta before replacing the description and delta with an internal
  `deleted` tombstone. The existing update audit fields record the deleting member and time, and
  therefore replace any earlier edit audit metadata.
- Tombstones remain counted, appear in record pages, and can be read individually as the synthetic
  response-only `{ type: "deleted" }` description. Their persisted description and delta JSON stay
  empty. Further replacement and deletion attempts treat them as missing.
- New revert records are rejected. Stored legacy revert descriptions remain readable, but original
  records are no longer annotated with information about a later revert.
- Transfer records accept both the legacy single-recipient `{ from, to, amount }` shape and the
  multi-recipient `{ src, dests: [{ id, amount }] }` shape. Multi-recipient destinations must be
  unique, positive, and different from the source; their amounts are summed into the source delta.
- New record writes may include a top-level `settle: true` intent for a transfer. This flag is not
  part of the description and is not persisted in the record.
- Expense category IDs are validated against published categories when records are posted. Project
  reads omit malformed, deleted, or otherwise unresolvable stored category IDs so historical records
  degrade to the general expense category.

## Settlement Plans

- Positive balances send money and negative balances receive money.
- Settlement planning pairs equal balances first, then greedily matches the largest remaining
  sender and recipient. Amount and member-ID tie breakers keep the plan deterministic.
- Plans group destinations by source and are advisory reads; requesting a plan does not post records
  or change balances.
- When a linked member confirms their complete cached sender batch with `settle: true`, the store
  may advance that exact cached plan by removing only the confirmed batch. This keeps an
  already-viewed plan stable for the other senders, although recomputing could find a more efficient
  remaining plan.
- Cache advancement is best effort. Missing, stale, malformed, partial, or nonmatching cached
  batches do not reject an otherwise valid transfer; the new record ID makes the old cache stale and
  the next settlement read recomputes. Any ordinary record may therefore generate a new plan.

## Access

- `ProjectsRegistry.listProjects()` must never return all projects. It should only return projects relevant to the caller email.
- `ProjectsRegistry.listProjects()` is backed by `project_members`, so it lists projects where the caller is linked/indexed, including owned projects. Restricted ACL allowlist entries can authorize direct `GET /project/:id` reads before joining, but they do not by themselves add the project to `/api/registry`.
- Public projects can be read by logged-out guests.
- Project mutations require auth.
- Posting requires a linked active member.
- The owner or any active linked member may create an unlinked placeholder member. Public readers,
  ACL-only viewers, former members, and deleted members do not receive member-management access.
- The owner may edit any active member's name and config. An active linked member may edit their own
  linked profile and any unlinked active member, but not a different linked member.
- Administrative unlinking and member deletion are owner-only. A linked non-owner may still unlink
  themself through the separate Leave operation.
