# RT-1 - High - Oversized Money Maps Produce 500s

Date: 2026-06-14 14:13:28 PDT
Commit: 25f932606bd064aa29331732e190ef814c8889e6

An authenticated project member can submit an expense payload with many referenced member IDs that do not exist. The request is syntactically valid and reaches `ProjectStore.postRecord()`, but it can generate an oversized SQLite placeholder list and return `500 Internal Server Error` instead of a controlled `400`.

## Reproduce Steps

On the live local API at `http://localhost:5173/api/*`, I logged in with local fixed-code login, created a public project, and posted expense records whose `paid`, `liability`, and `delta` maps referenced fake member IDs.

Observed results:

| Fake liability entries | Referenced IDs | Result |
| --- | --- | --- |
| 90 | 91 | `400 {"error":"invalid_request"}` |
| 99 | 100 | `400 {"error":"invalid_request"}` |
| 100 | 101 | `500 Internal Server Error` |
| 1,000 | 1,001 | `500 Internal Server Error` |
| 40,000 | 40,001 | `500 Internal Server Error` in 141ms |

The server remained alive after the large request; `/api/ping` still returned `200 Hello World`.

## Root Cause Analysis

`makeMoneyMapSchema()` validates member-id key shape and amount values, but it does not cap the number of entries in a money map. See `worker/routes/project.ts`.

`ProjectStore.postRecord()` collects every referenced member ID from `delta`, `paid`, and `liability`, builds a dynamic `IN (?, ?, ...)` clause, and passes all IDs as SQL parameters. This makes the query size attacker-controlled. When the placeholder count crosses the local SQLite limit, the Durable Object method throws and the route returns a generic `500`.
