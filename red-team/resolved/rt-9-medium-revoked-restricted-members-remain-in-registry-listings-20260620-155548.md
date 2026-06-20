# RT-9 - Medium - Revoked Restricted Members Remain In Registry Listings

Date: 2026-06-15 22:55:02 PDT
Commit: 6f739cb9224893a68e05dedef76aa1d361ff5b08
Resolution: Fixed

A linked member whose email is removed from a restricted project ACL can lose direct project read access but still receive that project in /api/registry. The registry indexes linked members independently of ACL authorization, and project summary sync preserves linked-member rows even when the member is no longer allowed to read the restricted project.

## Reproduce Steps

On a clean local Worker state at `http://localhost:5173/api/*`, I used the localhost fixed-code login flow with these isolated identities:

- Owner: `owner-1781589167481@example.com`
- Linked member: `member-1781589167481@example.com`
- Outsider control: `outsider-1781589167481@example.com`

Request sequence and observed results:

1. `POST /api/login/verify` for each identity with local code `123456`: all returned `200`.
2. Owner `PUT /api/project` with a restricted ACL containing only `member-1781589167481@example.com`: returned `201` and project ID `0a03cd23-de83-46ba-9d92-00fdd2b51226`.
3. Owner `POST /api/project/0a03cd23-de83-46ba-9d92-00fdd2b51226/members` with `{ "name": "Bob" }`: returned `201`.
4. Linked member `POST /api/project/0a03cd23-de83-46ba-9d92-00fdd2b51226/join` with `{ "memberId": 2 }`: returned `201` with:

   ```json
   {
     "member": {
       "id": 2,
       "name": "Bob",
       "deleted": false,
       "linkedEmail": "member-1781589167481@example.com"
     }
   }
   ```

5. Waited 12 seconds for project summary sync.
6. Owner `DELETE /api/project/0a03cd23-de83-46ba-9d92-00fdd2b51226/acl/emails` with `{ "emails": ["member-1781589167481@example.com"] }`: returned `204`.
7. Linked member `GET /api/project/0a03cd23-de83-46ba-9d92-00fdd2b51226`: returned `403 {"error":"forbidden"}`.
8. Outsider control `GET /api/project/0a03cd23-de83-46ba-9d92-00fdd2b51226`: returned `403 {"error":"forbidden"}`.
9. Waited another 12 seconds so this was not the 10-second registry response cache.
10. Linked member `GET /api/registry`: returned `200` and still included the revoked restricted project:

```json
{
  "projects": [
    {
      "id": "0a03cd23-de83-46ba-9d92-00fdd2b51226",
      "name": "Restricted ACL 1781589167481",
      "owner": "owner-1781589167481@example.com",
      "member": {
        "id": 2,
        "name": "Bob",
        "deleted": false,
        "linkedEmail": "member-1781589167481@example.com"
      },
      "balance": 0,
      "updatedAt": 1781589179583,
      "lastSyncAt": 1781589189586
    }
  ]
}
```

11. Outsider control `GET /api/registry`: returned `200 {"projects":[]}`.

The behavior is browser-feasible for any signed-in user who remains linked to a member record after losing restricted ACL access. The leak is summary-level data, not full records: project name, project ID, owner email, the caller's linked member record, balance, and timestamps.

## Root Cause Analysis

Restricted project read authorization is enforced in `ProjectStore.getProjectMetadata()` by `ProjectStore.isAuthorized()`: owners are allowed, public projects are allowed, and restricted projects allow only emails present in `meta.acl_allowed_list`.

`/api/registry` does not ask `ProjectStore` to re-check project ACLs. `ProjectsRegistry.listProjects()` returns rows from `project_members` for the caller email joined with `project_summaries`.

Project summary sync preserves linked-member rows regardless of restricted ACL membership. `ProjectStore.buildProjectSummarySync()` includes every member whose `linked_email IS NOT NULL`. `ProjectsRegistry.syncProjectSummary()` then rewrites `project_members` from that linked-member set and deletes only emails that are no longer linked. Removing an email from `acl_allowed_list` does not unlink the member, so the registry keeps listing the project for an email that `ProjectStore` now rejects with `forbidden`.

The direct route and registry route therefore answer different authorization questions for restricted projects: direct reads enforce ACL access, while registry listing enforces only linked-member presence.

## Resolution

Access policy now treats an active linked project member as authorized for restricted project reads, in addition to owner/public access and explicit ACL emails. Added Worker tests covering linked member direct access after ACL removal and registry consistency. Verified with pnpm test test/project.test.ts test/registry.test.ts, pnpm run typecheck:worker, pnpm run typecheck:frontend, pnpm run lint, and a live local replay on clean Wrangler state: after owner removed member-1781996081530@example.com from the restricted ACL, GET /api/project/fd42a566-d201-43ab-930f-20f9ae3f455e returned 200 for the linked member, 403 for outsider-1781996081530@example.com, /api/registry still listed the project for the linked member, and outsider registry returned an empty list.
