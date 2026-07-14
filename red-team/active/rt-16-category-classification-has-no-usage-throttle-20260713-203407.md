# RT-16 - Medium - Category Classification Has No Usage Throttle

Date: 2026-07-13 20:34:07 PDT
Commit: b8176cccc86cb33a2f59d7dcb56b6fe2f994c035

Any authenticated account can call the category classification route without an account, API-key, IP, or global usage limit. Every valid call reaches Workers AI embedding and Vectorize query work, including calls that ultimately return not found.

## Reproduce Steps

Live local API target: `http://127.0.0.1:5173/api/*`, running from a disposable Worker state. The configured Workers AI and Vectorize bindings were remote, as documented for local category testing.

Actor persona: an ordinary authenticated account with no project membership or administrative access.

1. Created a disposable category through the localhost-only admin route. `POST /api/admin/categories` returned `201` for category `0f9e4b54-84d9-4cb0-a57e-1b06e12b12bb` and a Vectorize mutation ID.
2. After the category document was published, sent ten sequential `POST /api/categories/classify` requests with the authenticated session and body `{"name":"Red Team Category 1783999780099","topK":5}`.
3. All ten requests reached classification work and returned `404 {"error":"not_found"}` in a combined 5,365 ms. None returned `429`, and there was no cooldown or quota response.
4. Deleted the disposable category. `DELETE /api/admin/categories/0f9e4b54-84d9-4cb0-a57e-1b06e12b12bb` returned `204`, and a final admin list returned `200 {"categories":[]}`.

The `404` responses resulted from Vectorize not yet returning a candidate in the new namespace; they still followed the code path that embeds the query with Workers AI and queries Vectorize before deciding that no candidate exists. The attack is client-feasible with either a browser session or bearer API key. One authenticated account can repeat the calls without creating projects or joining one.

## Root Cause Analysis

`worker/routes/categories.ts:62-98` protects classification only with same-origin checking when an Origin is present and general authentication. It parses the bounded input and immediately calls `CategoryClassifier.classify()`; there is no account, API-key, IP, or platform-wide usage limiter on the route.

`worker/category/index.ts:160-180` validates the name and `topK`, loads the published document, and calls the vector adapter for every valid request while categories exist. `worker/category/vectorIndex.ts:28-49` invokes the Workers AI embedding model and then `CATEGORY_INDEX.query()` for each call. `worker/category/index.ts:185-187` returns `not_found` only after that paid work completes without a resolvable candidate.

The only configured application rate-limit bindings are append-record account and project limiters in `wrangler.jsonc`; the classification route does not use either and has no classification-specific binding or durable quota.
