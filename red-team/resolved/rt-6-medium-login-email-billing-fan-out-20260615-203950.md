# RT-6 - Medium - Login Email Billing Fan-Out

Date: 2026-06-14 14:13:28 PDT
Commit: 25f932606bd064aa29331732e190ef814c8889e6
Resolution: Risk Accepted

The login flow can be used to trigger Turnstile verification and Send Email work across many unique email addresses. The existing cooldown protects only repeated sends to the same normalized email.

## Reproduce Steps

On the live local API at `http://localhost:5173/api/*`, I used local fixed-code login to create multiple identities. The production path differs because it requires Turnstile, so I validated the billing path from source rather than sending real production emails.

Relevant observed/source-backed behavior:

- Local login accepts any syntactically valid email on localhost when fixed-code login is configured.
- Production `/api/login/attempt` verifies Turnstile first.
- After successful Turnstile, attempts are stored per email hash.
- A successful new attempt schedules `SEND_EMAIL.send()` in `waitUntil`.
- Cooldown and failed-attempt counters are scoped to one email hash.

## Root Cause Analysis

`LoginAttemptStore.createAttempt()` enforces cooldown only for an existing row for the same email hash. Attackers with many target emails, disposable emails, or aliases can produce many distinct rows and therefore many Turnstile verifications and email sends.

This is partly product policy: login registration is intentionally not allowlisted.

## Resolution

Not planned: this is accepted behavior. Turnstile is the intended control for preventing large-scale automated login email sends, and its capacity and cost profile are accepted for this risk.
