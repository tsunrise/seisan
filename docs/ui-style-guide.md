# UI Style Guide

This document captures the Seisan interface direction established by the project page redesign. Read it before changing visible frontend surfaces, especially project, record, list, detail, and form flows.

## Design Read

Seisan is a product UI for repeated group-expense work. It should feel like a calm ledger: warm paper, editorial hierarchy, thin dividers, restrained blue selection, and no decorative marketing composition.

Design dials:

- `DESIGN_VARIANCE 5`: ordered but not generic, with subtle asymmetry in rails and panels.
- `MOTION_INTENSITY 3`: mostly static, with quiet hover, focus, and state transitions.
- `VISUAL_DENSITY 5`: information-rich enough for daily use, but still readable.

## Source Files

Use these implementation files as the design source of truth:

- `src/theme.ts`: shared palette, typography stacks, component-level MUI defaults.
- `src/components/styles.ts`: shared panel and surface styles.
- `src/components/PanelFrame.tsx`: standard panel title, back action, and frame behavior.
- `src/project/RecordTimeline.tsx`: day-group timeline composition.
- `src/project/RecordCard.tsx`: full record rows and minor system events, including category/type markers.
- `src/project/LinkedBlockForm.tsx`: linked composer bands, connectors, and secondary verbs.
- `src/project/timelineLayout.ts`: date/marker column widths, rail position, row heights, marker offsets, and transition constants.
- `src/project/timelineScroll.ts`: scroll restoration, sticky header offset, fixed mobile CTA clearance.
- `src/project/timelineGroups.ts`: local-day grouping and day labels.

## Visual System

Use a warm monochrome base:

- Backgrounds should read as paper, not app chrome. Prefer `ledgerColors.paper`, `ledgerColors.paperSoft`, and white-adjacent surfaces.
- Dividers should be thin and low contrast. Prefer `ledgerColors.line`; use stronger borders only for selected or focused states.
- Use dividers to separate sections, panels, and day boundaries in the timeline, not every minor event or individual members inside balance/member lists.
- Blue is reserved for selection, focus, current-member emphasis, and active navigation. Do not introduce new accent colors for ordinary decoration.
- Shadows should be absent or extremely soft. Prefer dividers and spacing over elevation.
- Corners stay restrained: generally 4-8px. Avoid large rounded cards and pill-like primary surfaces.
- Do not add gradients, glow effects, glassmorphism, decorative blobs, or marketing-style hero sections to app routes.

Prefer existing MUI components and icons. Do not add a second UI framework or icon family for visual changes.

## Typography

Use the typography stacks from `ledgerFonts`:

- Do not commit, convert, or serve downloaded Apple font binaries. San Francisco is available to
  the web UI only as a historical design reference.
- Inter Variable, Source Serif 4 Variable, and Source Code Pro Variable are self-hosted through
  Fontsource and are the first faces in their respective stacks on every operating system. This
  keeps glyphs and requested weights consistent across platforms.
- Display serif is only for major page/detail titles, such as project names and record detail titles.
- UI sans is for controls, labels, forms, rows, and panels.
- Mono is for rail/date metadata and tight numeric/system metadata when it helps scanning.
- Use tabular numbers for money, record IDs, and balances.
- Body and metadata text should be muted but readable. Do not use placeholder-as-label or low-contrast helper text.

## App Layout

Preserve the responsive panel model:

- Mobile: one active panel at a time. Keep the fixed post CTA clear of the latest record.
- Tablet: timeline plus right/detail panel when space allows.
- Desktop: left project rail, center timeline, right detail panel.

Panels should feel related, not like separate products:

- Same warm surface, same thin dividers, same restrained selection blue.
- Detail and rail panels should use the same title hierarchy and spacing rhythm as the timeline.
- Avoid nested cards. Use full-width bands, dividers, and unframed groups unless the content is a repeated item, modal, or actual framed tool.
- Keep the linked member's nonzero-balance `View transfer plan` action beside their standard
  accounting balance as a compact, text-only, underlined link so it is discoverable without adding
  button height or weight.
- Put the linked member's full-width `View settlement plan` action near the top of Project info so
  it remains discoverable even when their zero balance hides the project-header shortcut.

## Timeline

The project timeline is the primary visual language.

Records render oldest-to-newest. Each loaded day is a group:

- Left column: sticky vertical day label.
- Middle rail: one continuous thin vertical rule with category/type icons or system nodes overlaid.
- Content column: clickable record content only.

Date timeline rules:

- Group by browser-local calendar day.
- Place the day label at the first loaded record of that day.
- Render date labels as compact numeric metadata: `MMDD` over `YYYY`. Do not use long rotated date strings or display-style day numbers on the rail.
- Keep the date rail horizontally compact on desktop; it should be just wide enough for the numeric label and a small buffer before the marker rail.
- Make the day label sticky below the project header while any part of that day remains visible.
- Leave a small breathing gap between a stuck date label and the upper sticky/header line.
- Let the label release at the day-group boundary.
- Date labels should push one another at day boundaries. A later day label should move the previous sticky label upward rather than overlaying its lower text.
- Keep the date column size-contained so a tall vertical label does not create extra blank space before the next day.
- Keep sticky top measurement in `src/project/timelineScroll.ts`; do not add scroll listeners in render components.

Full record rows:

- Flat ledger rows separated by rail rhythm, whitespace, and date-boundary separators, not chat bubbles or dense per-item dividers.
- Actor name, title, relative metadata, record number, and viewer amount should align predictably.
- Category/type icon centers should align optically with the first title line, not the actor label or full row center.
- Expense rows show the category name immediately below the title in secondary text. Missing,
  deleted, or general categories display `Others`.
- Keep minimum row height compact enough that whitespace feels intentional: roughly 112px on mobile/tablet and 120px on desktop for ordinary one-line records, with mobile rows allowed to grow when amount metadata stacks.
- Records without a visible viewer amount can use a tighter minimum height, because there is no lower-right amount anchoring the row.
- Use a faint separator only at day boundaries, aligned to the content column between adjacent records from different dates. Do not draw same-day row dividers.
- Only the row content link is clickable. The empty rail/lane must not be clickable.
- Render the gray timeline rail as one continuous parent line, not separate row-level line segments.
- Selected rows use pale blue background, a subtle blue left border, and the desktop connector toward the detail panel.
- Legacy revert events remain visible, but source records use ordinary styling because the API no
  longer publishes reverse-link annotations.

Minor system events:

- Use for legacy revert records, deleted tombstones, and similar low-weight history events.
- Keep them compact, but align their right-side record number with full record rows.
- Use a small hollow timeline node rather than a full record icon.
- Center the hollow node on the system message baseline and keep the row visually lighter than a full record.
- Use one quiet row aligned to the rail, not a chip, toast, full record card, or divider-bearing row.
- Do not draw separator lines between consecutive minor system events.
- Keep them keyboard-focusable and accessible through the same record link behavior.
- Deleted events use the record's original creation time for grouping and relative metadata. Show
  who deleted the post in the message when trustworthy audit metadata is available.

## Dates, Money, And Copy

Use shared domain helpers from `src/domain.ts`.

- Timeline and list surfaces use relative time such as `8 minutes ago`, `3 hours ago`, `27 days ago`, `2 months ago`; day, month, and year counts are based on local calendar boundaries.
- Detail panels use exact timestamps for auditability.
- Money formatting must go through `formatCents` and existing amount components.
- Member balance lists and money tables should use compact row spacing, whitespace, and alignment instead of divider lines between members.
- Record titles must go through `recordTitle` or `recordDetailTitle`.
- Keep copy plain and functional. Avoid explanatory UI text unless it is actual product copy.

## Forms

Use the shared linked-block composer pattern for new and edited records. Warm bands hold related
fields, faint vertical rules connect repeated clauses, and verbs/connectors use secondary text:

- Expense: start with `For [expense]`, link it through `Categorized as [category]`, then use a comma
  connector before the first `[payer] paid [amount]` band. Additional payer bands use
  `and [payer] paid [amount]`; payer selections are unique and the expense total is the sum of all
  payer rows. Use the same prefix-searchable member dropdown as transfer inputs. End that linked
  sequence after the payers. Introduce the separate allocation block with the unlinked sentence
  `This expense should be paid by`, styled with the same secondary treatment as other verbs. At the
  bottom of the allocation block, remind active linked members in secondary text that additional
  members can be added in Project settings.
- Transfer: use warm, compact condition-builder bands instead of tall sentence cards. The first band
  starts with searchable `[from] paid`; every band contains `[to] [amount]`. Introduce additional
  recipients with secondary `and` text beside a faint vertical rule that connects the adjacent
  bands. Keep the band fill and border low-contrast, removal controls quiet, and both member inputs
  prefix-searchable. Keep the aggregate sent amount visible below the rows.
- Settlement: use a dedicated payment-plan display rather than transfer form controls. Lead with a
  concise explanation, show present-tense `Transfer to` rows with prominent amounts, then place
  the primary confirmation, full-width secondary customization buttons, and the default-collapsed
  full project plan in that order. Do not repeat total-sent or resulting-balance previews in this
  view. Do not place dividers between recipients in one sender batch; use a single divider between
  sender groups in the expanded plan. When the project has no outstanding transfers, replace the
  explanation and alert treatment with a centered, positive completion state. When the current
  member is owed money, use symmetric `Receive from` rows with a reversed direction icon and a
  restrained success color so incoming payments remain distinct from outgoing payments. Reuse the
  positive completion treatment with member-specific wording when only the current member has a
  zero balance, and keep the full-plan control available beneath it.
- Promise: the first band reads `[debtor] should pay [creditor] [amount]`; a linked `for` reason band
  completes the sentence.

Form rules:

- Desktop can keep sentence fields on one or two clean rows.
- Mobile stacks fields with visible labels and bridge words.
- Never rely on placeholder text as the only label.
- Keep split controls, preview, and validation visually quiet but readable.
- Inputs should match the project page: warm surface, thin border, clear focus ring.

## Interaction States

Every interactive row/control needs:

- A subtle hover state that does not look like a new card.
- A visible focus state using the shared blue.
- Accessible labels for links and icon-only controls.
- Stable dimensions so hover, selected, and focus states do not shift layout.

Keep motion minimal. Use simple CSS transitions for color, border, opacity, and small transforms only when they communicate feedback.

## Responsive QA

For visible UI changes, verify at least:

- Desktop wide: rail, timeline, detail panel, selected connector, right-column alignment.
- Tablet: timeline plus detail panel without the left rail.
- Mobile: single-panel timeline, fixed post CTA clearance, detail route, and composer form.
- Scroll states: middle of a day, partial top rows, day boundary handoff, older-record prepend, and back-from-detail restoration when practical.

Check that text does not overlap, CTA labels do not wrap awkwardly, date labels do not collide with the header, and record-number columns stay aligned between full rows and minor system rows.

## Anti-Patterns

Avoid these unless explicitly approved:

- Marketing landing-page sections inside app routes.
- Gradient, blob, glass, or heavy-shadow decoration.
- New color accents that compete with the selection blue.
- Rounded pill cards for primary surfaces.
- Cards inside cards.
- Dense dividers on every timeline item, especially inside runs of minor system events.
- Hand-rolled formatting for money, dates, record titles, or member names.
- Making the empty timeline lane clickable.
- Duplicating scroll restoration or mobile CTA clearance logic outside `timelineScroll.ts`.
- Adding a new UI framework, icon set, animation dependency, or font-loading strategy for a local UI change.

## Change Checklist

Before handing off a visible frontend change:

- The UI still reads as warm paper ledger.
- Tokens come from `src/theme.ts` or a documented extension to it.
- Shared panel styles are reused where possible.
- Timeline date rail, record rows, and minor system events keep their alignment.
- Relative and exact timestamps are used in the correct surfaces.
- Form labels remain visible on mobile and desktop.
- Hover/focus/selected states are implemented and do not shift layout.
- Relevant frontend checks pass.
- Browser QA is done for layout, responsive behavior, scrolling, or visible workflow changes.
