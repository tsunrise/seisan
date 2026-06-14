# RT-5 - Medium - Per-Email Quotas Are Alias-Friendly

Date: 2026-06-14 14:13:28 PDT
Commit: 25f932606bd064aa29331732e190ef814c8889e6

Project and linked-project quotas are enforced against normalized email strings, not against a canonical human/account identity. Users can often bypass quota intent with email aliases.

## Reproduce Steps

On the live local API at `http://localhost:5173/api/*`, I used the admin endpoint to set `maxOwnedProjects: 1` and `maxLinkedProjects: 1` for `quota-...@example.com`.

Observed results:

- First project as `quota-...@example.com`: `201`.
- Second project as `quota-...@example.com`: `409 {"error":"project_limit_exceeded"}`.
- First project as `quota-...+alias@example.com`: `201`.

## Root Cause Analysis

Emails are normalized with trim/lowercase only. Limits are loaded from keys like `limits:user:<email>`, and registry counts are keyed by exact email. There is no provider-aware canonicalization, domain policy, or account-level identity beyond the email string.
