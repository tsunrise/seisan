# RT-4 - Medium - Lowered Limits Can Stay Stale

Date: 2026-06-14 14:13:28 PDT
Commit: 25f932606bd064aa29331732e190ef814c8889e6

Admin limit changes do not reliably take effect immediately for active Durable Objects. This weakens the limits API as an emergency abuse throttle.

## Reproduce Steps

On the live local API at `http://localhost:5173/api/*`, I logged in as `stale-...@example.com`, created a project, added a peer member, and posted one transfer record. Then I used the local admin endpoint to lower that user's `records.maxRecordsPerOwnedProject` to `1`.

Observed results:

- First record before lowering: `201`.
- Second record immediately after lowering to `1`: `201`.
- Third record after waiting 11.2 seconds: `201`.

## Root Cause Analysis

`ProjectStore` loads owner limits through a `LazyRefresh` with a 10-second TTL. The underlying `LimitsKvStore` reads KV with `cacheTtl: 300`, so even after the DO refreshes, it can still read stale KV data.

This is especially surprising because the admin endpoint returns `204` after writing limits, implying the new policy is active.
