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

Do not edit `red-team/metadata.json` manually. Use the report-management script for all metadata changes and report moves:

```bash
uv run --script .agents/skills/seisan-security-analysis/scripts/red_team_reports.py <command>
```

If `uv` cannot write its default cache, prefix commands with `UV_CACHE_DIR=/private/tmp/uv-cache`.

Script commands:

- `new --severity <severity> --title <title> --summary <summary>` creates an active report and updates metadata.
- `resolve <id> --resolution "Fixed|Risk Accepted|Not Valid" --details <text>` moves an active report to `resolved/`, adds resolution boilerplate, and updates metadata.
- `sync` rebuilds `metadata.json` from active and resolved markdown files.
- `validate` checks report and metadata consistency.
- `list` prints all reports from metadata.

Agents may edit markdown report bodies manually, but must run `sync` afterward. Agents must not hand-edit metadata.

## Scan Agent: Local Dev Server Lifecycle

Before live local API probes, read and follow `docs/development.md`, especially `## Local Dev Server For Live API Probes`. Always control the local dev server and local Worker state yourself, and restore the user's original Wrangler state before finishing.

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

Write one dedicated markdown report per distinct issue by using the script:

```bash
uv run --script .agents/skills/seisan-security-analysis/scripts/red_team_reports.py new \
  --severity "High" \
  --title "Short Vulnerability Title" \
  --summary "One-paragraph summary of the vulnerability."
```

The script creates:

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

After editing issue files, run:

```bash
uv run --script .agents/skills/seisan-security-analysis/scripts/red_team_reports.py sync
uv run --script .agents/skills/seisan-security-analysis/scripts/red_team_reports.py validate
```

## Resolution Agent Workflow

When asked to resolve a red-team issue:

1. Read exactly one active issue report unless the user explicitly asks for more.
2. Reproduce or validate the issue from source and tests before editing when practical.
3. Implement the narrowest fix that resolves that issue without broad unrelated refactors.
4. Add or update focused tests proving the issue is fixed or no longer valid.
5. Run the narrowest relevant verification commands.
6. If the resolution is `Fixed`, run a live local replay before moving the report:
   - Follow `docs/development.md` for the clean Wrangler state, dev-server start, `/api/ping` readiness check, local API calls, exact server stop, cleanup, state restore, final status verification, and remote-binding caveats.
   - Recreate the report's `## Reproduce Steps` against `http://localhost:5173` or `http://127.0.0.1:5173` using the clean local state. Seed accounts, projects, admin limits, or other prerequisites through the API as needed.
   - Verify that the abusive path no longer works. Prefer the same request sequence that previously demonstrated the issue, and capture the new statuses/responses in the resolved report's `## Resolution` section.
   - If the original reproduction cannot be replayed exactly, document the gap and run the closest live API proof plus focused tests. Do not mark `Fixed` if there is no live evidence that the reported path is blocked.
   - For `Risk Accepted` or `Not Valid`, do not run the fixed live replay unless it is needed to prove the classification.
7. Move the report from `red-team/active/` to `red-team/resolved/` with the script:

   ```bash
   uv run --script .agents/skills/seisan-security-analysis/scripts/red_team_reports.py resolve RT-1 \
     --resolution "Fixed" \
     --details "Describe how the issue was resolved and verified."
   ```

8. Rename the resolved file as:

   `red-team/resolved/<id>-<severity-slug>-<title-slug>-<YYYYMMDD-HHMMSS>.md`

   The script handles the move, rename, `Resolution:` field, `## Resolution` section, and metadata update.

9. Edit the resolved markdown manually if the generated resolution details need polish.
10. Run `validate`.

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
