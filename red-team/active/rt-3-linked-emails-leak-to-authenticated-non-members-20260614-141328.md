# RT-3 - High - Linked Emails Leak to Authenticated Non-Members

Date: 2026-06-14 14:13:28 PDT
Commit: 25f932606bd064aa29331732e190ef814c8889e6

Any authenticated user who can read a project can see linked member emails for all members, even if they are not an owner or linked member of that project.

## Reproduce Steps

On the live local API at `http://localhost:5173/api/*`, I created a public project as `owner-...@example.com`, then read it anonymously and as a separate authenticated attacker.

Observed results:

- Anonymous `GET /api/project/:id` returned members without `linkedEmail`.
- Authenticated attacker `GET /api/project/:id` returned the owner member with `linkedEmail: "owner-...@example.com"`.
- A restricted project allowed an ACL-listed, not-yet-joined attacker to read the project and see the owner's linked email.

## Root Cause Analysis

`ProjectStore.getRecords()` returns `members` through `getMembersForResponse({ includeLinkedEmails: metadata.email !== null })`. That means any authenticated authorized reader gets all linked member emails.

For public projects, every authenticated user is an authorized reader. For restricted projects, every ACL-listed user is an authorized reader, even before they join.
