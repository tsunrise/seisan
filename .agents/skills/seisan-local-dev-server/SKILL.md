---
name: seisan-local-dev-server
description: Safely run Seisan's local Cloudflare Worker dev server against disposable Wrangler state. Use when Codex needs to back up or restore .wrangler/state, start a clean pnpm run dev server, wait for /api/ping, make local API calls, stop the server, or clean up after local reproduction and verification.
---

# Seisan Local Dev Server

## Overview

Run Seisan's local Cloudflare Worker dev server against a disposable Wrangler state, then restore the user's original local state before finishing.

Use this workflow for live local API reproduction, verification, red-team probing, and other tasks that need a fresh local Worker state. Do not run probes against production.

## Baseline And State Backup

Record baseline facts before changing local Worker state:

```bash
git rev-parse HEAD
date '+%Y-%m-%d %H:%M:%S %Z'
git status --short
```

Back up local Worker state before starting the dev server:

1. If `.wrangler/state` exists, move it to `.wrangler/state-backup-<YYYYMMDD-HHMMSS>`.
2. If that backup path already exists, choose a unique timestamped suffix.
3. Do not delete the user's original state.
4. Ensure the run starts with no `.wrangler/state` directory.

Keep the backup path in your notes so cleanup can restore it exactly.

## Start And Probe

Start the server from the repo root:

```bash
pnpm run dev
```

Keep the exact command session ID. Wait until this endpoint returns `200` before making other API calls:

```text
http://localhost:5173/api/ping
```

Make live API calls only against:

- `http://localhost:5173`
- `http://127.0.0.1:5173`

Capture method, endpoint, status, and relevant response bodies for any evidence or verification notes.

## Stop And Restore

Always run cleanup before finishing, even if probing or verification fails:

1. Stop the exact `pnpm run dev` session you started, normally by sending `Ctrl-C`.
2. Move or remove the generated `.wrangler/state` from this run.
3. Move the saved `.wrangler/state-backup-<timestamp>` back to `.wrangler/state` if a backup exists.
4. Verify the final state with:

   ```bash
   git status --short
   ```

If cleanup fails, do not continue silently. Report the exact backup path and current `.wrangler/state` path.
