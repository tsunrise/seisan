---
name: seisan-security-analysis
description: Run local-only security and abuse analysis for the Seisan Cloudflare Worker backend, including auth, CSRF, quota, resource-exhaustion, billing-risk, Durable Object state, and API authorization probes. Use when asked to red-team Seisan, assess Worker backend security, investigate abuse paths, run local API security experiments, or generate a red-team report.
---

# Seisan Security Analysis

## Overview

Run Seisan backend red-team assessments against a disposable local dev state. The workflow must start and stop its own `pnpm run dev` server, isolate `.wrangler/state`, and write a timestamped markdown report under `red-team/`.

## State And Server Lifecycle

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

## Assessment Workflow

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

## Probe Guidelines

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
- Suggested fix and tests to add.

Classify platform behavior that cannot be faithfully reproduced locally as source-backed risk or hypothesis. Do not overstate local Wrangler behavior as production fact.

## Report

Write a dedicated markdown report in:

`red-team/<YYYYMMDD-HHMMSS>-<funny-eyecatching-title-slug>.md`

Use this format:

```markdown
# <Title>

Time: <time>
Commit: <commit>

## Summary

<Short summary and severity table>

## <Vulnerability Name>

<Summary of the vulnerability>

### Reproduce steps

<What was done on the live local API and what happened>

### Root Cause Analysis

<Why the bug exists, with code references>

### Suggested fix

<Concrete remediation and suggested tests>
```

Include positive checks when useful, but keep confirmed vulnerabilities first. State clearly that testing was local-only and whether `.wrangler/state` was restored.
