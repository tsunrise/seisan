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
- Keep record actor/subject selection in `src/project/recordActor.ts` so avatar direction and record summaries stay consistent.

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
