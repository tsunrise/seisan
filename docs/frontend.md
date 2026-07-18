# Frontend Implementation

Use this before changing React frontend code in `src/`. Read `docs/ui-style-guide.md` before changing visible frontend surfaces.

## Stack

- Use React hooks and React Router.
- UI uses Material UI. Prefer MUI components and idioms before custom controls.
- Use `lucide` only if it is already installed; this repo currently uses MUI icons.

## Module Boundaries

- Keep app pages in `src/pages`, account dashboard UI in `src/account`, project-specific UI in `src/project`, shared UI in `src/components`, hooks in `src/hooks`, and admin-only UI in `src/admin`.
- API calls from the browser go through `src/api.ts` and use relative `/api/*` URLs.
- Shared record text, money, timestamp, and title formatting belongs in `src/domain.ts`.
- Components should call helpers such as `recordTitle`, `recordDetailTitle`, `formatCents`, and timestamp formatters instead of duplicating formatting rules.
- Keep record actor/subject selection in `src/project/recordActor.ts` so marker emphasis and record summaries stay consistent.

## Responsive Project UI

- Preserve the mobile-first ledger/chat-like project timeline.
- Desktop should use the existing multi-pane layout, not a stretched mobile view.
- Mobile uses a single active panel.
- Tablet-width layouts show the main timeline plus right panel.
- Wider desktop layouts show left rail, center timeline, and right panel.

## Timeline Behavior

- Project timelines render oldest-to-newest.
- Initial project loads scroll to the latest record.
- Infinite loading fetches older records when the user scrolls upward.
- Prepending older records must preserve the visible scroll position.
- Timeline scroll restoration and fixed-action overlap handling belong in `src/project/timelineScroll.ts`.
- Do not duplicate sessionStorage, DOM measurement, iOS Safari safe-area, or mobile bottom CTA clearance logic inside rendering components.
- The mobile timeline CTA is marked with `data-project-mobile-action`; keep that marker or update `timelineScroll.ts` at the same time.
- This marker is required so initial scroll and restore logic keep the latest record content clear of the fixed action, especially on iPhone Safari.
- Record cards should only make the record content row clickable, not the surrounding timeline lane.
- Keep hover states subtle and consistent with the row tone.
- Project pages load the public category list once and share it with the expense composer and
  timeline. Missing category metadata renders as `Others` with the default expense icon.
- Expense markers use category icons; transfer and promise markers use their hardcoded record-type
  icons. Expense rows show the resolved category name directly below the record title.
- Transfer readers support both legacy single-recipient records and multi-recipient records. For a
  multi-recipient transfer, summaries show the recipient list and total while details show each
  recipient's amount; the source member remains the timeline actor.
- `shared/icon-names.ts` is the backend/frontend icon contract, and `NamedIcon` is the only frontend
  name-to-MUI mapping. Keep category icons semantically distinct; unknown names use the expense icon.

## Expense Category Classification

- The expense composer classifies the exact expense text after a 400 ms debounce or immediately on
  blur, requesting up to 20 candidates.
- The category menu initially shows the first three unique ranked candidates plus every additional
  unique candidate scoring above `0.2`, followed by a `Show all categories` action. Expanding shows
  the remaining categories and `Others` alphabetically below a divider.
- Superseded requests must be aborted and ignored. Classification times out after 5 seconds and
  falls back to `Others`; scores below `0.2` also produce `Others`.
- Manual dropdown selections remain authoritative for the rest of that composer session even while
  later classifications refresh suggestion ordering.
- Do not post while the latest expense text is unresolved. Submission must independently confirm
  the exact text snapshot so Enter or programmatic submission cannot attach a stale category.
- While classification is unresolved, replace the category select chevron with a compact progress
  spinner and disable the unchanged `Post` action. Do not add classification status helper text
  below the category field.

## Branding, Titles, And SEO

- Use `BrandLink` for the logo plus `SEISAN` brand mark.
- The logo asset is `public/seisan-logo.svg`, and `index.html` uses it as the favicon.
- Set page titles with `useDocumentTitle` for routes that should own `document.title`.
- Existing title-setting routes include `/projects`, `/account`, `/account/api-keys`, `/api-docs`, project routes, `/login`, `/privacy`, and `/admin/*`; root redirects to `/projects`.
- Avoid in-app explanatory text about how the UI works unless it is actual product copy.
- For SEO-facing shell content, update `index.html` metadata rather than adding marketing-only UI to app routes.

## Account Dashboard

- Account routes live under `/account` and require browser session authentication.
- `/account` uses the existing lightweight `/api/whoami` identity response, including the browser session expiration timestamp. Do not load project or API-key metadata on the account home page.
- `/account/api-keys` uses the session-only `/api/api-keys` routes. The complete secret returned at creation is one-time UI state and must be discarded when its dialog closes.
- `/api-docs` is a public, lazy-loaded Scalar reference backed by `/openapi.json`; `/account/api-docs` redirects there for compatibility.
- Keep the API reference outside the authenticated account shell so its endpoint navigation, structured schemas, cURL samples, and response examples have the full viewport. The API Keys page is the authenticated entry point.
- The reference is documentation-only: keep Scalar's test-request, credential persistence, API-client, Agent, developer-tool, and telemetry features disabled.
- Keep the account shell visually aligned with the warm ledger system: a desktop navigation rail, compact mobile tabs, thin dividers, and restrained blue active states.
- Account entry links identify their source page so the account shell can label and pop back to that browser-history entry. Account tab changes replace the current entry so this destination stays stable; direct account loads fall back to `/projects`.
- Account logout controls require confirmation before ending the browser session.
- Authenticated project-list and project-detail surfaces should keep a visible Account entry point. Public project views must not show an account action without a resolved session identity.
