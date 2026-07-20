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
  current member's profile, settlement plan, members, and access control.
- Profile, members, and access control use nested settings routes and return to the settings menu.
  Keep the profile page scoped to the current linked member. Editing another eligible member belongs
  in member settings so there is only one administrative edit surface.
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
- Timeline scroll restoration and fixed-action overlap handling belong in `src/project/timelineScroll.ts`.
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
  verb primitives from `src/project/LinkedBlockForm.tsx` while retaining type-specific fields and
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
- Keep the linked member's `Settle up` entry beside their balance in the project header at every
  breakpoint when their balance is nonzero. Hide it for a zero balance, and do not duplicate it
  below the desktop rail's full member-balance list. Project info provides linked members with an
  always-visible `View settlement plan` action regardless of their balance.
- `shared/icon-names.ts` is the backend/frontend icon contract, and `NamedIcon` is the only frontend
  name-to-MUI mapping. Keep category icons semantically distinct; unknown names use the expense icon.

## Expense Category Classification

- The expense composer classifies the exact expense text after a 400 ms debounce or immediately on
  blur, requesting up to 20 candidates.
- The category control is a searchable prefix-matching autocomplete. It keeps the classified
  suggestions first, follows them with the remaining categories alphabetically, and shows each
  category icon both in the input and dropdown.
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
- `public/sitemap.xml` lists only stable public pages on the production origin. Keep authenticated, admin, and dynamic project URLs out of it, and keep its absolute URL advertised in `public/robots.txt`.
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
