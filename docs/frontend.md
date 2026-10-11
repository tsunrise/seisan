# Frontend Implementation

Use this before changing React frontend code in `src/`. Read `docs/ui-style-guide.md` before changing visible frontend surfaces.

## Stack

- Use React hooks and React Router.
- UI uses Material UI. Prefer MUI components and idioms before custom controls.
- Use `lucide` only if it is already installed; this repo currently uses MUI icons.

## Module Boundaries

Organize `src/` by feature. A feature folder owns its route entry, components, feature-specific
hooks, and pure helpers; only code shared across features lives in the top-level shared folders.
Keep pure logic (parsing, validation, allocation, draft transforms) in `.ts` modules next to the
components that use them so it can be unit tested, and keep stateful effects in hooks rather than
rendering components.

| Path              | Owns                                                                                                                                   |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `src/App.tsx`     | Top-level routes only. Project panel routes come from `projectPanelRoutes` in `src/project/paths.ts`.                                  |
| `src/api/`        | Browser API client split by resource (`auth`, `projects`, `categories`, `apiKeys`, `admin`), wire types in `types.ts`, and API errors. |
| `src/domain/`     | Pure money, member, record, timestamp, and category rules shared by every feature.                                                     |
| `src/components/` | Shared UI primitives such as `PanelFrame`, `ConfirmDialog`, `LinkedBlockForm`, `MoneyTable`, and the `memberConfig/` profile fields.   |
| `src/hooks/`      | Cross-feature hooks: `useLoadable`, `useCurrentUser`, `useProjects`, `useDocumentTitle`, `useAppSnackbar`.                             |
| `src/pages/`      | Standalone single-screen routes: login, privacy, not found, API docs, project list, and project creation.                              |
| `src/project/`    | `ProjectPage` (route entry), `ProjectSidePanel` (panel switch), `paths.ts`, project data hooks, and the subfolders below.              |
| `src/calculator/` | The public calculator page, its `useGroupExpenseCalculator` state hook, UI sections, pure draft logic, and local-storage persistence.  |
| `src/account/`    | Account shell, home, navigation state, and `apiKeys/`.                                                                                 |
| `src/admin/`      | Admin shell and one file per admin page, with pure draft parsing in `limitsDraft.ts` and `blockedEmailsDraft.ts`.                      |

Project subfolders:

- `layout/`: header, wide-desktop rail, mobile CTA, and desktop placeholder.
- `timeline/`: timeline rendering, record rows, day grouping, layout constants, and scroll behavior.
- `records/`: record detail, new-record chooser, edit panel, and record-editing rules.
- `composer/`: expense, transfer, and promise composers, the `RecordComposer` switch, and their pure
  form helpers.
- `settings/`, `settlement/`, `join/`: the corresponding project panels.

Rules:

- Keep the public group-expense calculator's pure draft, identity, allocation, and validation
  helpers in `src/calculator/groupExpenseCalculator.ts` and its local-storage persistence in
  `src/calculator/calculatorStorage.ts`. It may consume the pure settlement engine in
  `shared/settlement.ts`, but it must not call an API to calculate or persist a draft.
- API calls from the browser go through `src/api/` and use relative `/api/*` URLs. Components
  import it as `import * as api from "../api"`; pure modules import wire types from
  `src/api/types.ts` so they stay free of browser APIs.
- Load server data through `useLoadable` (or a feature hook built on it) instead of hand-written
  fetch effects, unless the screen needs custom state such as editable drafts.
- Build project URLs with `projectPaths` from `src/project/paths.ts` instead of string templates.
- Shared record text, money, timestamp, and title formatting belongs in `src/domain/`.
- Components should call helpers such as `recordTitle`, `recordDetailTitle`, `formatCents`,
  `formatCentsInput`, `memberBalance`, and timestamp formatters instead of duplicating formatting
  rules.
- Keep record actor/subject selection in `src/project/timeline/recordActor.ts` so marker emphasis and record summaries stay consistent.
- Use `ConfirmDialog` for cancel/confirm prompts on destructive actions.

## Responsive Project UI

- Preserve the mobile-first ledger/chat-like project timeline.
- Desktop should use the existing multi-pane layout, not a stretched mobile view.
- Mobile uses a single active panel.
- Tablet-width layouts show the main timeline plus right panel.
- Wider desktop layouts show left rail, center timeline, and right panel.
- Below the wide-desktop breakpoint, place the signed-in account email opposite the Seisan brand
  in the project header and link it to the account page. The wide layout uses the account entry in
  the left rail instead. Public project views omit the email link.

## Project Member Metadata

- Authenticated project reads expose `ProjectMemberFull` entries. Keep `ProjectMember` for registry
  summaries and mutation responses, which intentionally do not carry config.
- Member profile fields use the shared `MemberConfigFields` control. Its shared
  `RepresentedGroupFields` gadget requires self/other context, uses first-person copy for the
  current member and third-person copy when editing someone else, reveals an integer input of at
  least two, and reminds the user that represented people should not join independently.
- The frontend project-creation flow always creates a public project. Owners can change visibility
  and manage restricted-project emails afterward from Access control.
- Project creation, joining, and placeholder-member creation save config with a follow-up member
  config request using the member ID returned by the first mutation.
- Equal expense splits weight selected members by `config.size ?? 1`. Allocate indivisible cents
  with the largest-remainder method and break equal remainders by member ID so no final member
  absorbs the accumulated rounding difference. Ratio splits show the same value as each member's
  editable default, while custom splits remain explicit amounts.
- Show payment methods where someone is deciding how to pay: member lists, selected recipients in
  the transfer composer, and outgoing settlement payments.
- Show represented group size as `+N` beside member names in compact balance lists, member settings
  rows, expense split rows, timeline actor labels, and record-detail money tables, where `N` is
  `config.size - 1`; omit the marker when size is one or absent. Use the shared member-name
  component so the calculation and alignment stay consistent.

## Project Settings

- `/project/:id/settings` is a compact settings menu rather than a single long form. It links to the
  project name, current member's profile, settlement plan, members, and access control. The project
  name row opens a focused editor for the owner and remains read-only for other viewers.
- Project name, profile, members, and access control use nested settings routes and return to the
  settings menu. Keep the profile page scoped to the current linked member. Editing another eligible
  member belongs in member settings so there is only one administrative edit surface.
- Member settings expose management mode to the owner and active linked members. Both can add
  placeholders and edit unlinked members' names, represented sizes, and payment methods. A linked
  member may also edit their own row, while only the owner sees administrative unlink and delete
  controls or can edit a different linked member.
- Follow the warm-ledger interpretation of an iOS settings list: full-width rows, restrained leading
  icons, thin grouped dividers, clear chevrons, and no nested decorative cards.

## Timeline Behavior

- Project timelines render oldest-to-newest.
- Initial project loads scroll to the latest record.
- Infinite loading fetches older records when the user scrolls upward.
- Prepending older records must preserve the visible scroll position.
- Timeline scroll restoration and fixed-action overlap handling belong in `src/project/timeline/timelineScroll.ts` (DOM and storage helpers) and `src/project/timeline/useTimelineScroll.ts` (the effects that drive them).
- Do not duplicate sessionStorage, DOM measurement, iOS Safari safe-area, or mobile bottom CTA clearance logic inside rendering components.
- The mobile timeline CTA is marked with `data-project-mobile-action`; keep that marker or update `timelineScroll.ts` at the same time.
- This marker is required so initial scroll and restore logic keep the latest record content clear of the fixed action, especially on iPhone Safari.
- Record cards should only make the record content row clickable, not the surrounding timeline lane.
- Legacy revert records remain visible as compact history events, but the UI does not offer a
  Revert action and source records are no longer struck through or annotated as reverted.
- Deleted records remain visible as compact history events at their original creation position.
  Their detail view shows original creation and deletion audit metadata but no money tables.
- Active linked members can edit live expense, transfer, and promise records from record detail.
  Editing keeps the record type fixed and reuses the new-record composers with prefilled values;
  records that reference deleted members remain read-only. Confirmed deletion lives on the edit
  panel and returns to the readable tombstone detail.
- Keep hover states subtle and consistent with the row tone.
- Project pages load the public category list once and share it with the expense composer and
  timeline. Missing category metadata renders as `Others` with the default expense icon.
- Expense markers use category icons; transfer and promise markers use their hardcoded record-type
  icons. Expense rows show the resolved category name directly below the record title.
- Transfer readers support both legacy single-recipient records and multi-recipient records. A
  single-recipient summary remains `Transferred <member> <amount>`; a multi-recipient summary is
  `Transferred <amount> in total` and uses the branching transfer icon. Details show every
  recipient's amount, and the source member remains the timeline actor.
- The transfer composer has one sender and repeatable destination rows. Destination autocomplete is
  a case-insensitive name-prefix match, excludes the sender and recipients already chosen in other
  rows, and always posts the multi-recipient transfer shape. The sender uses the same searchable
  prefix dropdown. Present the transfer as warm, compact condition-builder bands: the first starts
  with `[from] paid`, each band contains `[to] [amount]`, and an `and` connector introduces every
  additional recipient. Allow only one unfinished recipient row at a time. Show the aggregate sent
  amount alongside the delta preview.
- Expense, transfer, and promise composers share the linked-block surface, connector, and secondary
  verb primitives from `src/components/LinkedBlockForm.tsx` while retaining type-specific fields and
  validation.
- The expense composer supports repeatable unique payer/amount rows using the grammar
  `For <expense> | Categorized as <category> | , <payer> paid <amount> (| and <payer> paid
<amount>)*`. Category and the first payer use a comma connector. Payer inputs use the same
  prefix-searchable member dropdown as transfer inputs. Editing prefills exact payer allocations
  and liability values, starting the liability control in custom mode. The liability block is not
  linked to the payer sequence and follows the sentence `This expense should be paid by`. Its
  secondary hint tells active linked members that additional members can be added in Project
  settings.
- `/project/:id/settle` is available only to linked active members. Show the current member's
  outgoing batch first in a settlement-specific payment list, without transfer-form inputs, past
  tense, or balance-total previews. Follow it with the primary confirmation action, full-width
  secondary customization buttons back to an ordinary prefilled transfer, and a default-collapsed
  full-plan control. Confirming posts the complete current-member batch; ordinary transactions can
  cause the plan to be recomputed. For a member who is owed money, replace the outgoing instructions
  with an incoming-payment list that identifies every sender and amount; do not render the outgoing
  confirmation or customization actions. When the current member has a zero balance while other
  members remain unsettled, show a member-specific completion state while retaining the collapsed
  full-plan control.
- Keep a compact, text-only, underlined `View transfer plan` link beside the linked member's
  nonzero balance at all breakpoints. Preserve the standard accounting balance presentation, hide
  the header link for a zero balance, and do not duplicate it below the desktop rail's full
  member-balance list. Project info provides linked members with an always-visible
  `View settlement plan` action regardless of their balance.
- `shared/icon-names.ts` is the backend/frontend icon contract, and `NamedIcon` is the only frontend
  name-to-MUI mapping. Keep category icons semantically distinct; unknown names use the expense icon.

## Expense Category Classification

- Classification spends Workers AI budget, so the composer minimizes requests without delaying
  posting. `useExpenseCategoryClassification` owns these rules:
  - Requests use the whitespace-normalized text (`classificationKey()`, matching the API) and up to
    20 candidates.
  - Results are cached for the tab in `ClassificationCache` (200 entries, 5 minute TTL, matching
    the published category KV window). Cached text resolves immediately without a request.
  - Automatic requests start only after 500 ms without input and at least 1.5 s after the previous
    request started (`automaticClassificationDelayMs()`), and never overlap: text typed while a
    request runs waits for that request to settle.
  - Blur and submission classify immediately, bypassing the wait, interval, and overlap rules, and
    reuse an identical in-flight request.
- The category control is a searchable prefix-matching autocomplete. It keeps the classified
  suggestions first, follows them with the remaining categories alphabetically, and shows each
  category icon both in the input and dropdown.
- Superseded requests are not aborted, because their cost is already paid; their results are
  cached and applied only while they still match the latest input. Classification times out after
  5 seconds and falls back to `Others`; scores below `0.2` and failed requests, including
  Cloudflare challenges, also produce `Others`.
- Manual dropdown selections remain authoritative for the rest of that composer session even while
  later classifications refresh suggestion ordering.
- Do not post while the latest expense text is unresolved. Submission must independently confirm
  the exact text snapshot so Enter or programmatic submission cannot attach a stale category.
- While classification is unresolved, replace the category select chevron with a compact progress
  spinner and disable the unchanged `Post` action. Do not add classification status helper text
  below the category field.

## Branding, Titles, And SEO

- Use `BrandLink` for the logo plus `SEISAN` brand mark.
- On project routes, both the compact project header and wide project rail brand links return
  authenticated visitors to `/projects` and anonymous visitors to the public calculator at `/`.
  Brand links on other surfaces continue to target `/` by default.
- Every client-side navigation to `/` resets the document scroll position to the top, including
  browser-history navigation and repeated navigation entries for the index route.
- The logo asset is `public/seisan-logo.svg`, and `index.html` uses it as the favicon.
- Set page titles with `useDocumentTitle` for routes that should own `document.title`.
- `/` is the public Group Expense Calculator for logged-out and authenticated visitors. `/projects`
  remains the authenticated project list, and `/projects/new` remains project creation. The
  session-aware root header links anonymous visitors to sign in and authenticated visitors to My
  Projects without blocking calculator use.
- The root calculator owns the title, canonical, description, Open Graph, Twitter, and
  `SoftwareApplication` structured data for the production root URL. Keep FAQ content visible but
  do not add FAQ rich-result markup.
- Existing title-setting routes also include `/projects`, `/account`, `/account/api-keys`,
  `/api-docs`, project routes, `/login`, `/privacy`, and `/admin/*`.
- `public/sitemap.xml` lists only stable public pages on the production origin. Keep authenticated, admin, and dynamic project URLs out of it, and keep its absolute URL advertised in `public/robots.txt`.
- Avoid in-app explanatory text about how the UI works unless it is actual product copy.
- Keep root SEO shell metadata in `index.html`; root-only structured data is attached by the
  calculator page and removed when it unmounts.

## Public Calculator

- The calculator models one aggregate USD snapshot, not an anonymous multi-expense ledger.
- Member IDs and payer-row keys are local positive integers. Persist them so equal-split rounding
  and settlement tie breakers remain stable across refreshes.
- Normalize member identity by trimming and case-insensitive comparison while preserving committed
  display casing. Payers are always liability members. Removing a payer leaves that member as
  liability-only, and an active payer cannot be deleted from liability.
- Keep liability members in compact flat rows rather than connected or individually framed blocks.
  Each row keeps its participation checkbox, truncated name, Equal or Ratio allocated-share
  preview, optional ratio or custom input, and borderless Edit and Delete actions on one line.
  Custom rows use the amount input itself as the allocated share and do not repeat that amount in a
  separate preview. Active payer rows keep their
  checkbox and split input enabled, but their name Edit and Delete actions stay disabled because
  payer names are owned by the Who paid section.
- Checkboxes control split participation without removing members. Unchecked members display a zero
  allocated share and retain their ratio and custom values. Equal, Ratio, and Custom allocate and
  validate selected members only; Calculate requires at least one selected member.
- Liability-only names use an explicit single-row editor with Cancel and Confirm actions. Only one
  existing or pending member name can be edited at a time. A pending Add member row remains
  UI-only until a valid, unique name is confirmed.
- Preview allocated liability shares live for Equal and Ratio. Equal and valid Ratio allocations
  resolve across selected members; an unresolved Ratio shows zero for every member. In Custom, the
  directly editable amount is the share, so do not render a duplicate preview beside it.
- Save a version 2 draft under the calculator-specific v2 local-storage key 400 ms after the latest
  edit. Version 1 data is intentionally removed and reset rather than migrated. Do not persist
  temporary name editors or computed plans. Unsupported or malformed versions reset safely, and
  storage failures must not prevent in-memory calculation.
- Any draft edit hides the computed result. A new result appears only after the visitor explicitly
  calculates again.
- Keep one always-visible, session-aware conversion section below the calculator for visitors who
  need to track individual expenses in a shared Seisan project. Use one CTA to project creation,
  present shared itemized tracking, member-specific transfer plans, and the free
  no-daily-posting-cap model as flat divider-separated rows, and disclose that full projects store
  expense data on Seisan's servers with a link to the Privacy Policy. Settlement results contain
  only the calculated transfer plan and must not repeat this marketing content.

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

## Admin Dashboard

- `/admin/blocked-emails` manages the versioned blocked-email regex document through the admin API.
- Show rules in stored order with pattern, optional user-facing reason, and remove controls. Add Rule
  appends an empty row up to the 100-rule limit. Omit completely empty rows on save, reject a reason
  without a pattern, and omit whitespace-only reasons from the saved document. Validate patterns
  and reasons before saving, stack row controls on mobile, and require dirty changes to be saved
  before using the email test form.
- Admin tests use the strongly consistent saved configuration and report the normalized email plus
  the first matching pattern and configured reason when present. Remind admins that login
  enforcement uses published KV and may take up to five minutes to reflect a save.
