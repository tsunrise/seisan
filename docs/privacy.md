# Privacy Policy Map

`privacy_policy.md` is the public policy; `public/privacy_policy.html` is generated from it. This
document maps each public claim to the code that makes it true, so a code change that breaks a
claim is easy to spot. Keep it short: one row per claim, pointing at files rather than restating
them.

Rows marked _operator_ are promises about how the maintainer behaves, not something the code
enforces.

## Claim map

### At a glance

Policy anchor: [#at-a-glance](../privacy_policy.md#at-a-glance)

| Claim                                                       | Evidence                                                                                                                                                                                                                                           |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Calculator input stays in the browser.                      | `src/calculator/calculatorStorage.ts`; `src/calculator/useGroupExpenseCalculator.ts` (no API calls with draft data).                                                                                                                               |
| Shared projects are stored on Cloudflare.                   | `worker/do/ProjectStore.ts`; `wrangler.jsonc`.                                                                                                                                                                                                     |
| Public links expose records, member names, and owner email. | `worker/routes/project.ts` (public read path); `worker/project.ts` (response schemas).                                                                                                                                                             |
| No ads, analytics trackers, or sale of data.                | `package.json` and the network calls in `src/api/`. Re-check dependencies and outbound requests when either changes. The Cloudflare-injected Precursor script is bot detection, not analytics; Cloudflare does not expose its signals to the site. |

### What Seisan collects

Policy anchor: [#what-seisan-collects](../privacy_policy.md#what-seisan-collects)

| Claim                                                                     | Evidence                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Account data: email, hashed login codes, sessions.                        | `worker/routes/login.ts`; `worker/do/LoginAttemptStore.ts`; `worker/auth.ts`; `worker/crypto.ts`.                                                                                                                                                                             |
| API keys store metadata and a hash; the secret is shown once.             | `worker/apiKey.ts`; `worker/do/UserAPIKeysStore.ts`; `src/account/apiKeys/CreateApiKeyDialog.tsx`.                                                                                                                                                                            |
| Project, member, and record fields.                                       | `worker/project.ts`; `src/components/memberConfig/memberConfigDraft.ts`; `docs/project-model.md`.                                                                                                                                                                             |
| Expense names go to Workers AI for category suggestions.                  | `worker/routes/categories.ts`; `worker/category/clef.ts`; `src/project/composer/useExpenseCategoryClassification.ts`.                                                                                                                                                         |
| Turnstile on login; email domains checked with Cloudflare DNS.            | `src/components/Turnstile.tsx`; `worker/turnstile.ts`; `worker/emailDomainValidation.ts`.                                                                                                                                                                                     |
| Suggestions need a bot-checked browser, not the API.                      | `worker/routes/categories.ts` (`requireSameOrigin`, `requireSessionAuth`); Precursor Rule in `docs/category-classification.md`.                                                                                                                                               |
| Suggestions are rate limited per account and hashed IP.                   | `worker/routes/categories.ts`: `CategoryClassificationRateLimiter`; `wrangler.jsonc` `ratelimits`.                                                                                                                                                                            |
| Cloudflare bot detection on every page; keystroke timing only. _operator_ | Zone setting, not code: Precursor is enabled in the Cloudflare dashboard (`docs/category-classification.md`). Production HTML includes `/cdn-cgi/challenge-platform/scripts/precursor/main.js`. Signal list and keystroke-timing claim come from Cloudflare's Precursor docs. |

### How information is used

Policy anchor: [#how-information-is-used](../privacy_policy.md#how-information-is-used)

| Claim                                                | Evidence                                          |
| ---------------------------------------------------- | ------------------------------------------------- |
| Data is used only for the features and for security. | `worker/app.ts` (all routes); `worker/limits.ts`. |

### Who can see your information

Policy anchor: [#who-can-see-your-information](../privacy_policy.md#who-can-see-your-information)

| Claim                                                                        | Evidence                                                                                       |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Signed-in visitors of public projects also see member emails and details.    | `worker/routes/project.ts`; `worker/project.ts`.                                               |
| Restricted projects: owner, linked members, and allowed emails only.         | `worker/routes/project.ts` (authorization middleware); `docs/project-model.md`.                |
| Cloudflare is the only service provider; login codes go to the user's inbox. | `wrangler.jsonc`; `worker/email.ts`; Precursor bot detection is Cloudflare zone configuration. |
| The operator may access data to run the service. _operator_                  | `worker/routes/admin.ts`; `docs/auth.md`.                                                      |

### Cookies and browser storage

Policy anchor: [#cookies-and-browser-storage](../privacy_policy.md#cookies-and-browser-storage)

| Claim                                                 | Evidence                                                                                                      |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `__Host-seisan_session` cookie, up to 30 days.        | `worker/constants.ts`: `SESSION_COOKIE_NAME`, `SESSION_TTL_SECONDS`.                                          |
| Cloudflare `cf_clearance` security cookie. _operator_ | Set by Cloudflare's edge for Precursor and challenges, not by Seisan code; `docs/category-classification.md`. |
| Calculator draft in `localStorage`.                   | `src/calculator/calculatorStorage.ts`: `CALCULATOR_STORAGE_KEY`.                                              |
| Timeline scroll position in `sessionStorage`.         | `src/project/timeline/timelineScroll.ts`.                                                                     |

### How long information is kept

Policy anchor: [#how-long-information-is-kept](../privacy_policy.md#how-long-information-is-kept)

| Claim                                                                 | Evidence                                                 |
| --------------------------------------------------------------------- | -------------------------------------------------------- |
| Login codes expire after 10 minutes; sessions after 30 days.          | `worker/constants.ts`; `worker/do/LoginAttemptStore.ts`. |
| Expired or revoked API keys stop working.                             | `worker/apiKey.ts`.                                      |
| Rate-limit counters reset within a minute.                            | `wrangler.jsonc` `ratelimits` (every `period` is 60).    |
| Projects have no automatic expiry; deleted records leave a tombstone. | `worker/do/ProjectStore.ts`; `docs/project-model.md`.    |

### Your choices and requests

Policy anchor: [#your-choices-and-requests](../privacy_policy.md#your-choices-and-requests)

| Claim                                                                       | Evidence                                                                                                                              |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Users can edit or delete records, leave projects, and clear the calculator. | `src/project/records/EditRecordPanel.tsx`; `src/project/settings/ProjectSettings.tsx`; `src/calculator/useGroupExpenseCalculator.ts`. |
| Requests are handled by email. _operator_                                   | No in-app request workflow exists.                                                                                                    |

### Security and data location

Policy anchor: [#security-and-data-location](../privacy_policy.md#security-and-data-location)

| Claim                                                              | Evidence                                                                                                 |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| Hashed codes and keys, secure cookies, access checks, rate limits. | `worker/crypto.ts`; `worker/auth.ts`; `worker/limits.ts`; `worker/routes/categories.ts`; `docs/auth.md`. |

### Children

Policy anchor: [#children](../privacy_policy.md#children)

| Claim                                          | Evidence                  |
| ---------------------------------------------- | ------------------------- |
| Not intended for children under 13. _operator_ | No age data is collected. |

### Changes

Policy anchor: [#changes](../privacy_policy.md#changes)

| Claim                                          | Evidence                            |
| ---------------------------------------------- | ----------------------------------- |
| Updates are posted with a new date. _operator_ | `privacy_policy.md` history in git. |

## When to update

Update this map, and the public policy if a claim changes, when you change:

- what personal data is collected or stored, or who can see it;
- cookies, `localStorage`, `sessionStorage`, or other browser storage;
- third-party services, scripts, dependencies, or outbound network calls, including Cloudflare
  zone features that inject scripts or set cookies, such as Precursor;
- retention, deletion, or expiry behavior.

## Release steps

1. Edit `privacy_policy.md` and bump its "Last updated" date for substantive changes.
2. Run `node scripts/build-privacy-policy.mjs` (also run by `pnpm run build`) to regenerate
   `public/privacy_policy.html`.
3. Run `pnpm run test:privacy`. It checks that every policy section has an anchor entry here and
   that every file cited here exists.
4. Check `/privacy` in the browser.
