# RT-11 - Low/Medium - Owner Member Self-Removal Bypasses Owner Guards

Date: 2026-06-20 16:16:17 PDT
Commit: 49ee5357b21f93a6369b3997bf90974ccefa9487

Project owners can remove their own linked owner member through the generic member patch/delete routes even though owner leave and explicit member-link removal paths forbid owner self-removal. The project remains owner-readable by ID, but the owner loses the registry listing and cannot post records until they manually rejoin; queued summary syncs fail because registry summaries require the owner email to appear among linked members.

## Reproduce Steps

Live local API target: `http://localhost:5173/api/*`.

Actor persona: authenticated project owner. The requests are browser-feasible when issued from the same origin with the owner's session cookie; forged cross-origin requests were separately checked and returned `403`.

Probe identities:

- Owner: `owner-1781997320429@example.com`
- Linked member: `member-1781997320429@example.com`
- Outsider control: `outsider-1781997320429@example.com`

Observed request sequence:

1. `POST /api/login/verify` for the owner, linked member, and outsider using the localhost fixed-code flow: all returned `200` and set session cookies.
2. Control checks:
   - Forged-origin `POST /api/login/verify` returned `403 {"error":"forbidden"}`.
   - Forged-origin `PUT /api/project` returned `403 {"error":"forbidden"}`.
   - Forged-origin `text/plain` JSON `PUT /api/project` returned `403 {"error":"forbidden"}`.
3. Owner `PUT /api/project` with a restricted ACL containing `member-1781997320429@example.com` returned `201` and created project `c0c4db01-995f-4cbb-b444-da3608b5156b` with owner member `1` linked to `owner-1781997320429@example.com`.
4. Owner `POST /api/project/c0c4db01-995f-4cbb-b444-da3608b5156b/members` with `{ "name": "Bob" }` returned `201` and created member `2`.
5. Linked member `POST /api/project/c0c4db01-995f-4cbb-b444-da3608b5156b/join` with `{ "memberId": 2 }` returned `201` with member `2` linked to `member-1781997320429@example.com`.
6. Outsider control `GET /api/project/c0c4db01-995f-4cbb-b444-da3608b5156b` returned `403 {"error":"forbidden"}`.
7. Linked member `GET /api/project/c0c4db01-995f-4cbb-b444-da3608b5156b` returned `200` and included both linked members.
8. After waiting for project summary sync, linked member `GET /api/registry` returned `200` with the project summary, while outsider `GET /api/registry` returned `200 {"projects":[]}`.
9. Owner `PATCH /api/project/c0c4db01-995f-4cbb-b444-da3608b5156b/members/1` with `{ "email": "" }` returned `200`:

```json
{
  "member": {
    "id": 1,
    "name": "Alice",
    "deleted": false
  }
}
```

10. Owner `GET /api/project/c0c4db01-995f-4cbb-b444-da3608b5156b` still returned `200` by owner email, but member `1` no longer had a `linkedEmail`.
11. Owner `POST /api/project/c0c4db01-995f-4cbb-b444-da3608b5156b` with a valid self-only expense returned `403 {"error":"forbidden"}` because the owner no longer had an active linked member.
12. After waiting past the registry response cache window, owner `GET /api/registry` returned `200 {"projects":[]}`. The dev server also logged `failed to sync project summary { error: 'invalid_input' }`.
13. Owner `POST /api/project/c0c4db01-995f-4cbb-b444-da3608b5156b/join` with `{ "memberId": 1 }` returned `201`, showing manual recovery is possible if the owner still knows the project ID.
14. Owner `DELETE /api/project/c0c4db01-995f-4cbb-b444-da3608b5156b/members/1` then returned `204`, showing the same owner self-removal invariant can be bypassed through member deletion when the owner member has zero balance.
15. Owner `POST /api/project/c0c4db01-995f-4cbb-b444-da3608b5156b` again returned `403 {"error":"forbidden"}` after deleting the owner member.

## Root Cause Analysis

The code has explicit owner self-removal guards in two paths:

- `ProjectStore.leaveProject()` rejects owners with `forbidden`.
- `ProjectStore.unlinkMemberEmail()` rejects requests where the removed email equals `owner_email`.

The generic member management paths do not enforce the same invariant:

- `ProjectStore.patchMember()` authorizes owners to patch any member, and its `{ email: "" }` branch clears `linked_email` without checking whether the target member is linked to the project owner.
- `ProjectStore.deleteMember()` authorizes owners to delete any zero-balance active member, including the member currently linked to `owner_email`.
- The route layer then calls `ProjectsRegistry.removeProjectMember()` for the removed linked email in both `PATCH /project/:id/members/:memberId` and `DELETE /project/:id/members/:memberId`, so owner self-removal deletes the owner's registry membership row.

After the owner member is unlinked or deleted, direct owner reads still work because project ownership is stored in project metadata, but owner mutations that need an active linked member fail. `ProjectStore.postRecord()` requires `getActiveLinkedMember(ownerEmail)` and returns `forbidden` when none exists.

The registry summary path also depends on the owner being present in the linked-member export. `ProjectStore.buildProjectSummarySync()` exports only rows where `linked_email IS NOT NULL`. `ProjectsRegistry.syncProjectSummary()` rejects summaries where the owner email is absent from that member set. Once the owner member is unlinked or deleted, queued summary syncs fail with `invalid_input`, leaving registry summaries stale until the owner manually rejoins.
