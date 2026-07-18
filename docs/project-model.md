# Project Model

Use this before changing project, member, record, ACL, or balance behavior.

## Identity And Membership

- Project records are keyed by project-local numeric `memberId`, not email.
- Emails are for authentication, ACL access, and linking a logged-in user to a project member.
- Email addresses accepted at Worker boundaries are limited to 255 characters.
- Deleted members are soft-deleted so historical records can still render.
- Owner identity is stored in `ProjectStore`.
- Owner-only checks should happen in `ProjectStore` unless the operation only touches registry metadata.

## Balances And Records

- Balances are stored by member ID, in cents.
- Record descriptions are JSON to allow future description types without schema churn.
- Validate that record deltas match the server-derived delta and sum to zero.
- Transfer records accept both the legacy single-recipient `{ from, to, amount }` shape and the
  multi-recipient `{ src, dests: [{ id, amount }] }` shape. Multi-recipient destinations must be
  unique, positive, and different from the source; their amounts are summed into the source delta.
- Record writes may include a top-level `settle: true` intent for a transfer. This flag is not part
  of the description and is not persisted in the immutable record.
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
