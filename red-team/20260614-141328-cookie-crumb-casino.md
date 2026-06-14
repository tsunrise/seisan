# Cookie Crumb Casino: Forged Origins, Fake Members, and Billable Busywork

Time: 2026-06-14 14:13:28 PDT
Commit: 25f932606bd064aa29331732e190ef814c8889e6

## Summary

I ran a local-only source-guided red-team assessment against the live dev API at `http://localhost:5173/api/*`. I used local fixed-code login, local admin limit changes, forged request headers, role-boundary probes, concurrency probes, random UUID lookup sprays, and oversized record payloads. No production endpoints were tested.

| Severity | Vulnerability | Confirmed live result | Affected surface |
| --- | --- | --- | --- |
| High | Oversized money-map member references trigger `500` | 100 referenced IDs returned `400`; 101+ returned `500`; 40,001 keys returned `500` | `POST /api/project/:id` |
| High | Cookie-authenticated mutations lack Origin/CSRF protection | Forged `Origin` project create returned `201`; forged logout returned `204` and revoked the session | Project mutation routes, `/api/logout` |
| High | Linked member emails leak to authenticated non-members | Any authenticated reader of a public project saw the owner's `linkedEmail` | `GET /api/project/:id` |
| Medium | Lowered limits can stay stale | After lowering max records to `1`, two additional posts still returned `201` | Owner-scoped ProjectStore limits |
| Medium | Per-email quotas are easy to bypass with aliases | Capped `quota@example.com` was blocked, while `quota+alias@example.com` created a project | Login identity and limits |
| Medium | Login/email billing can fan out across unique emails | Source and local flow confirm cooldown is per email hash, while successful unique attempts send mail | `/api/login/attempt` |
| Low/Medium | Random UUID lookup spray hits registry path | 50 authenticated random UUID lookups all returned `404` in 68ms | `GET /api/project/:id` |
| Product risk | Public projects allow arbitrary authenticated users to claim unlinked members | Attacker joined public project as pre-created member ID `2` | `POST /api/project/:id/join` |

## Oversized Money Maps Produce 500s

An authenticated project member can submit an expense payload with many referenced member IDs that do not exist. The request is syntactically valid and reaches `ProjectStore.postRecord()`, but it can generate an oversized SQLite placeholder list and return `500 Internal Server Error` instead of a controlled `400`.

### Reproduce steps

On the live local API, I logged in with local fixed-code login, created a public project, and posted expense records whose `paid`, `liability`, and `delta` maps referenced fake member IDs.

Observed results:

| Fake liability entries | Referenced IDs | Result |
| --- | --- | --- |
| 90 | 91 | `400 {"error":"invalid_request"}` |
| 99 | 100 | `400 {"error":"invalid_request"}` |
| 100 | 101 | `500 Internal Server Error` |
| 1,000 | 1,001 | `500 Internal Server Error` |
| 40,000 | 40,001 | `500 Internal Server Error` in 141ms |

The server remained alive after the large request; `/api/ping` still returned `200 Hello World`.

### Root Cause Analysis

`makeMoneyMapSchema()` validates member-id key shape and amount values, but it does not cap the number of entries in a money map. See `worker/routes/project.ts`.

`ProjectStore.postRecord()` then collects every referenced member ID from `delta`, `paid`, and `liability`, builds a dynamic `IN (?, ?, ...)` clause, and passes all IDs as SQL parameters. This makes the query size attacker-controlled. When the placeholder count crosses the local SQLite limit, the Durable Object method throws and the route returns a generic `500`.

### Suggested fix

Add an explicit entry-count cap to all money-map schemas. The cap should be no higher than `projects.maxMembersPerProject` and also comfortably below the SQLite variable limit.

Return a stable domain error such as `invalid_record` or `member_limit_exceeded` before building SQL. Also wrap the active-member lookup path so unexpected SQL errors are mapped to a controlled response and logged with enough detail for operators.

## Missing Origin and CSRF Protection on Cookie Mutations

Cookie-authenticated mutation routes accept requests with forged or missing Origin headers. This allows non-browser clients to forge origins freely and creates browser-facing risk for same-site sibling origins or compromised subdomains, because the session cookie uses `SameSite=Lax`.

### Reproduce steps

On the live local API, I logged in as `victim-...@example.com` and replayed mutations with a valid session cookie and forged origins.

Observed results:

| Request | Forged Origin | Result |
| --- | --- | --- |
| `PUT /api/project` with `Content-Type: application/json` | `https://evil.example` | `201`, project created |
| `PUT /api/project` with `Content-Type: text/plain` containing JSON | `https://evil.waga.me` | `201`, project created |
| `POST /api/logout` | `https://evil.waga.me` | `204`, then `GET /api/whoami` returned `401` |

### Root Cause Analysis

The project route source includes a reminder to add Origin/CSRF checks before cookie-authenticated mutation routes become browser-facing. That check is not implemented.

`parseJson()` calls `context.req.json()` and validates the parsed body, but it does not require `Content-Type: application/json`. In local testing, a `text/plain` request body containing JSON was parsed and accepted.

Session cookies are `HttpOnly`, `Secure`, and `SameSite=Lax`, which helps against ordinary cross-site subresource requests, but it is not a substitute for server-side Origin validation on state-changing endpoints.

### Suggested fix

Add centralized middleware for all cookie-authenticated mutation routes:

- Reject requests whose `Origin` is absent or not an allowed origin, except for explicitly approved non-browser clients.
- Check `Sec-Fetch-Site` where available and reject `cross-site`.
- Require `Content-Type: application/json` for JSON mutation routes.
- Consider a CSRF token or required custom header for browser mutations.
- Include `/api/logout` in the protection set.

## Linked Emails Leak to Authenticated Non-Members

Any authenticated user who can read a project can see linked member emails for all members, even if they are not an owner or linked member of that project.

### Reproduce steps

On the live local API, I created a public project as `owner-...@example.com`, then read it anonymously and as a separate authenticated attacker.

Observed results:

- Anonymous `GET /api/project/:id` returned members without `linkedEmail`.
- Authenticated attacker `GET /api/project/:id` returned the owner member with `linkedEmail: "owner-...@example.com"`.
- A restricted project allowed an ACL-listed, not-yet-joined attacker to read the project and see the owner's linked email.

### Root Cause Analysis

`ProjectStore.getRecords()` returns `members` through `getMembersForResponse({ includeLinkedEmails: metadata.email !== null })`. That means any authenticated authorized reader gets all linked member emails.

For public projects, every authenticated user is an authorized reader. For restricted projects, every ACL-listed user is an authorized reader, even before they join.

### Suggested fix

Limit linked email visibility to owners by default. If non-owner users need identity context, return only their own linked email or a boolean such as `isLinkedToCaller`.

Add tests for:

- Anonymous public read.
- Authenticated public non-member read.
- Restricted ACL-listed non-member read.
- Owner read.
- Linked member read.

## Lowered Limits Can Stay Stale

Admin limit changes do not reliably take effect immediately for active Durable Objects. This weakens the limits API as an emergency abuse throttle.

### Reproduce steps

On the live local API, I logged in as `stale-...@example.com`, created a project, added a peer member, and posted one transfer record. Then I used the local admin endpoint to lower that user's `records.maxRecordsPerOwnedProject` to `1`.

Observed results:

- First record before lowering: `201`.
- Second record immediately after lowering to `1`: `201`.
- Third record after waiting 11.2 seconds: `201`.

### Root Cause Analysis

`ProjectStore` loads owner limits through a `LazyRefresh` with a 10-second TTL. The underlying `LimitsKvStore` reads KV with `cacheTtl: 300`, so even after the DO refreshes, it can still read stale KV data.

This is especially surprising because the admin endpoint returns `204` after writing limits, implying the new policy is active.

### Suggested fix

For abuse-response limits, avoid edge-cached KV reads. Options:

- Read limits from a strongly consistent source for enforcement paths.
- Add a limits version key and force ProjectStore refresh when the version changes.
- Make the admin write path invalidate or bump a monotonic policy version.
- Document that limit changes are eventually consistent if that is acceptable, and expose the expected propagation delay.

## Per-Email Quotas Are Alias-Friendly

Project and linked-project quotas are enforced against normalized email strings, not against a canonical human/account identity. Users can often bypass quota intent with email aliases.

### Reproduce steps

On the live local API, I used the admin endpoint to set `maxOwnedProjects: 1` and `maxLinkedProjects: 1` for `quota-...@example.com`.

Observed results:

- First project as `quota-...@example.com`: `201`.
- Second project as `quota-...@example.com`: `409 {"error":"project_limit_exceeded"}`.
- First project as `quota-...+alias@example.com`: `201`.

### Root Cause Analysis

Emails are normalized with trim/lowercase only. Limits are loaded from keys like `limits:user:<email>`, and registry counts are keyed by exact email. There is no provider-aware canonicalization, domain policy, or account-level identity beyond the email string.

### Suggested fix

Decide whether limits are meant to be per email address or per human/account. If they are account controls, add a durable account identity that can own multiple verified emails, or add provider-aware alias canonicalization where safe.

If exact-email semantics are intentional, document this clearly and add separate abuse controls such as domain, IP, device, and global creation limits.

## Login Email Billing Fan-Out

The login flow can be used to trigger Turnstile verification and Send Email work across many unique email addresses. The existing cooldown protects only repeated sends to the same normalized email.

### Reproduce steps

On the live local API, I used local fixed-code login to create multiple identities. The production path differs because it requires Turnstile, so I validated the billing path from source rather than sending real production emails.

Relevant observed/source-backed behavior:

- Local login accepts any syntactically valid email on localhost when fixed-code login is configured.
- Production `/api/login/attempt` verifies Turnstile first.
- After successful Turnstile, attempts are stored per email hash.
- A successful new attempt schedules `SEND_EMAIL.send()` in `waitUntil`.
- Cooldown and failed-attempt counters are scoped to one email hash.

### Root Cause Analysis

`LoginAttemptStore.createAttempt()` enforces cooldown only for an existing row for the same email hash. Attackers with many target emails, disposable emails, or aliases can produce many distinct rows and therefore many Turnstile verifications and email sends.

This is partly product policy: login registration is intentionally not allowlisted.

### Suggested fix

Add layered rate limits before email send:

- IP and subnet rate limits.
- Domain-level rate limits.
- Global send-per-minute and send-per-day ceilings.
- Disposable-domain suppression or challenge escalation.
- Alerting when unique-recipient velocity spikes.

Keep the existing per-email cooldown, but do not rely on it as the only billing control.

## Random UUID Lookup Spray Has No Negative Cache

Authenticated users can spray valid UUID-shaped project IDs. Every cache miss can reach the registry lookup path.

### Reproduce steps

On the live local API, I sent 50 authenticated `GET /api/project/<random-uuid>` requests.

Observed result:

- All 50 returned `404`.
- The batch completed in 68ms locally.

### Root Cause Analysis

The route rejects malformed project IDs before touching storage, which is good. But valid UUID-shaped misses call through the project-ref cache and then `ProjectsRegistry.lookupProject()`. There is no negative cache or per-user/IP throttling for high-cardinality unknown UUID misses.

### Suggested fix

Add a short negative cache for valid UUID misses, and consider rate limiting unknown project lookups per identity and source IP. Keep malformed UUID rejection as-is.

## Public Projects Let Attackers Claim Unlinked Members

In a public project, any authenticated user can join by claiming an unlinked member ID. This may be intended for frictionless group expense sharing, but it is a surprising capability if public project IDs are shared or discoverable.

### Reproduce steps

On the live local API, I created a public project as owner, added an unlinked member named `Unlinked Friend`, then joined as a separate attacker identity using `{ "memberId": 2 }`.

Observed result:

`POST /api/project/:id/join` returned `201` and linked member `2` to `attacker-...@example.com`.

### Root Cause Analysis

For public projects, `getProjectMetadata()` authorizes any caller. `joinProject()` permits an authorized caller to claim any active unlinked member by ID.

### Suggested fix

If public self-claim is intended, make it visible in product copy and consider an owner confirmation or invite code for claiming existing unlinked members. If not intended, require owner approval or restrict self-join to creating a new member rather than claiming existing placeholders.

