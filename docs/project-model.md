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

## Access

- `ProjectsRegistry.listProjects()` must never return all projects. It should only return projects relevant to the caller email.
- `ProjectsRegistry.listProjects()` is backed by `project_members`, so it lists projects where the caller is linked/indexed, including owned projects. Restricted ACL allowlist entries can authorize direct `GET /project/:id` reads before joining, but they do not by themselves add the project to `/api/registry`.
- Public projects can be read by logged-out guests.
- Project mutations require auth.
- Posting requires a linked active member.
