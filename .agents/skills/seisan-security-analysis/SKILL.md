---
name: seisan-security-analysis
description: Run local-only security and abuse analysis for the Seisan Cloudflare Worker backend, generate per-issue red-team reports, and guide one-vulnerability-at-a-time resolution work. Use when asked to red-team Seisan, assess Worker backend security, investigate abuse paths, run local API security experiments, create active red-team reports, or resolve an existing red-team issue.
---

# Seisan Security Analysis

## Overview

Run Seisan backend red-team assessments against a disposable local dev state, or resolve one existing red-team issue. Scan agents create one markdown file per issue in `red-team/active/`; resolution agents fix one active issue and move its report to `red-team/resolved/`.

## Report Registry

Use this structure:

```text
red-team/
  active/
    <id>-<vuln>-<datetime>.md
  resolved/
    <id>-<severity>-<title>-<datetime>.md
  metadata.json
```

Treat `active/` as the reporting inbox for newly found issues. Keep `metadata.json` in sync whenever adding, moving, or resolving reports.

Use IDs like `RT-1`, `RT-2`, `RT-10`, and `RT-11`; do not zero-pad the numeric suffix. Allocate the next ID from `metadata.json.nextId`, then increment it. If `metadata.json` is missing, inspect existing filenames and choose the next unused number.

## Scan Agent: State And Server Lifecycle

Always control the local dev server and local Worker state yourself.

1. Record baseline facts:
   - `git rev-parse HEAD`
   - `date '+%Y-%m-%d %H:%M:%S %Z'`
   - `git status --short`
2. Back up local Worker state before starting the dev server:
   - If `.wrangler/state` exists, move it to `.wrangler/state-backup-<YYYYMMDD-HHMMSS>`.
   - If that backup name already exists, choose a unique timestamped suffix.
   - Do not delete the user's original state.
3. Ensure the assessment starts with no `.wrangler/state` directory.
4. Start the server with `pnpm run dev` from the repo root. Keep the command session ID.
5. Wait until `http://localhost:5173/api/ping` returns `200`.
6. Run all live probes only against `http://localhost:5173` or `http://127.0.0.1:5173`.
7. Stop the exact `pnpm run dev` session you started, normally by sending `Ctrl-C`.
8. Restore state in a cleanup block before finishing:
   - Stop the server first.
   - Move or remove the assessment-generated `.wrangler/state`.
   - Move `.wrangler/state-backup-<timestamp>` back to `.wrangler/state` if a backup exists.
   - Verify with `git status --short`.

If cleanup fails, do not continue silently. Report the exact backup path and current `.wrangler/state` path.

## Scan Agent: Assessment Workflow

Use source-guided testing: read the Worker code first, then run bounded live experiments to prove or falsify abuse hypotheses.

Read these files as the main map:

- `worker/index.ts`
- `worker/auth.ts`
- `worker/routes/login.ts`
- `worker/routes/project.ts`
- `worker/routes/registry.ts`
- `worker/routes/admin.ts`
- `worker/limits.ts`
- `worker/do/*.ts`
- Relevant tests in `test/*.test.ts`

Cover these attack classes:

- Auth and identity abuse: spoofing, local fixed-code behavior, login-code verification, session revocation, arbitrary email signup, aliases, and login-email fan-out.
- Browser mutation abuse: forged `Origin`, missing `Origin`, same-site sibling origins, `Content-Type` bypasses, logout CSRF, and cookie behavior.
- Resource and billing abuse: Turnstile verification, Send Email, random UUID lookups, large JSON bodies, large money maps, project/member/record creation loops, Cache API/KV/DO hot paths, alarms, and registry backfills.
- Limit behavior: default/user limits, admin-lowered limits, KV cache staleness, DO lazy refresh, concurrency races, and multi-email bypasses.
- Authorization and data exposure: public versus restricted reads, owner-only routes, member linking/unlinking, member claiming, linked email visibility, and registry list isolation.
- State consistency: partial writes between registry and project DOs, delayed summary sync, stale project-ref cache, stale registry list cache, and mutation failure modes.

Use local admin endpoints to set deliberately low limits for test identities when proving limit behavior. Keep live load bounded; prefer dozens or hundreds of requests, not uncontrolled floods.

## Scan Agent: Probe Guidelines

Create isolated local-only identities such as:

- `victim-<timestamp>@example.com`
- `attacker-<timestamp>@example.com`
- `owner-<timestamp>@example.com`
- `quota-<timestamp>@example.com`
- Alias variants such as `quota-<timestamp>+alias@example.com`

Use the local fixed login code only for localhost dev-server testing. Do not test production.

For each confirmed issue, capture:

- Endpoint and method.
- Actor persona.
- Exact observed statuses and relevant response bodies.
- Whether the behavior is browser-feasible, client-only, or source-backed.
- Root cause with file references.

Classify platform behavior that cannot be faithfully reproduced locally as source-backed risk or hypothesis. Do not overstate local Wrangler behavior as production fact.

## Scan Agent: Report Output

Write one dedicated markdown report per distinct issue in:

`red-team/active/<id>-<vuln-slug>-<YYYYMMDD-HHMMSS>.md`

Use exactly this structure:

```markdown
# <ID> - <Severity> - <Title>

Date: <date>
Commit: <commit>

<Summary of the vulnerability>

## Reproduce Steps

<What was done on the live local API and what happened>

## Root Cause Analysis

<Why the bug exists, with code references>
```

Do not include a suggested-fix section in active reports. The fixing agent owns implementation strategy.

After writing issue files, update `red-team/metadata.json` with each issue's `id`, `status`, `severity`, `title`, `file`, `date`, and `commit`.

## Resolution Agent Workflow

When asked to resolve a red-team issue:

1. Read exactly one active issue report unless the user explicitly asks for more.
2. Reproduce or validate the issue from source and tests before editing when practical.
3. Implement the narrowest fix that resolves that issue without broad unrelated refactors.
4. Add or update focused tests proving the issue is fixed or no longer valid.
5. Run the narrowest relevant verification commands.
6. Move the report from `red-team/active/` to `red-team/resolved/`.
7. Rename the resolved file as:

   `red-team/resolved/<id>-<severity-slug>-<title-slug>-<YYYYMMDD-HHMMSS>.md`

8. Add a `Resolution: Fixed`, `Resolution: Risk Accepted`, or `Resolution: Not Valid` field directly below the `Commit:` field.
9. Add a `## Resolution` section explaining what changed, how it was verified, and any residual risk.
10. Update `red-team/metadata.json` so the issue status and file path match the resolved report.

Resolved report format:

```markdown
# <ID> - <Severity> - <Title>

Date: <original report date>
Commit: <original report commit>
Resolution: Fixed

<Original summary>

## Reproduce Steps

<Original reproduce steps>

## Root Cause Analysis

<Original root cause analysis>

## Resolution

<How it was resolved and verified>
```

Use `Risk Accepted` only when the user explicitly accepts the risk. Use `Not Valid` only when investigation proves the report is incorrect or not exploitable under the stated assumptions.
