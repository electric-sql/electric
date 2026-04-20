# Cloud section — navigation refactor (`/cloud/*` + `/pricing`)

> Working spec for a small navigation refactor of the Cloud area.
>
> **Problem.** The Cloud section uses the default VitePress _docs_
> sidebar (Overview · Usage · Protocols · Pricing · CLI), which makes
> it read like a thin wedge of reference docs rather than a product
> section. Pricing sits in the sidebar but is actually a polished
> `layout: home` page that lives at `/pricing`, so the two halves of
> the section already look inconsistent.
>
> **Direction (from product).** Drop the docs-style left sidebar
> across the Cloud section. Replace it with a row of **navigation
> pills along the top of every page** in the section. Treat
> `/pricing` as a member of the Cloud section so it gets the same
> pill bar.
>
> **Scope discipline.** This is a refactor, **not** a content
> expansion. No new pages. The only content change is folding the
> ~35-line `/cloud/protocols` page into `/cloud` (and dropping the
> stale duplicate paste at the bottom of `/cloud/usage`).

---

## Goals

1. **Unify the section.** `/cloud/*` and `/pricing` should look and
   feel like one product area, not two unrelated trees.
2. **Replace the docs sidebar.** Sidebar nav for ~5 short pages reads
   as low-rent. Pills at the top sit better on the landing-style
   pages we already have.
3. **Discoverability.** Anyone landing on `/pricing` from search/ads
   should clearly see they're inside Cloud and can step sideways into
   _Overview_, _Usage_, _CLI_.
4. **Don't regress SEO or URLs.** Keep `/pricing`, `/cloud`,
   `/cloud/usage`, `/cloud/cli` exactly where they are. Only
   `/cloud/protocols` moves (folds into `/cloud#protocols` with a
   redirect).

## Non-goals

- No new pages (Regions, Security, Dashboard tour, Status — all
  parking-lot, not v1).
- No rewrite of `/pricing` — only adding the pill bar above it.
- No change to the global `MegaNav`. Cloud and Pricing remain
  top-level entries there; the pill bar is a _secondary_, in-section
  nav.
- No new visual components beyond the pill bar itself.

---

## Current state (audit)

### Pages

| URL                | Layout              | Source                       | Notes                                                                                                                                          |
| ------------------ | ------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `/cloud/`          | docs (sidebar)      | `website/cloud/index.md`     | Hero block, two product paragraphs, DDN paragraph, CTA. ~70 lines.                                                                             |
| `/cloud/usage`     | docs (sidebar)      | `website/cloud/usage.md`     | Register DB → API request → security model → proxy auth example. **Has the entire body duplicated below itself** — stale paste, needs cleanup. |
| `/cloud/protocols` | docs (sidebar)      | `website/cloud/protocols.md` | ~35 lines. HTTP sync, DDN, clients, integrations links. Skeletal — folds cleanly into Overview.                                                |
| `/cloud/cli`       | docs (sidebar)      | `website/cloud/cli.md`       | Solid CLI overview. Strongest page in the section.                                                                                             |
| `/pricing`         | `home` (no sidebar) | `website/pricing.md`         | Polished landing-style page using `<Section>`, `PricingCard`, `ComparisonTable`, `PricingCalculator`, FAQ.                                     |

### Sidebar (to be removed)

In `website/.vitepress/config.mts`:

```202:213:website/.vitepress/config.mts
'/cloud': [
  {
    text: 'Electric Cloud',
    items: [
      { text: 'Overview', link: '/cloud/' },
      { text: 'Usage', link: '/cloud/usage' },
      { text: 'Protocols', link: '/cloud/protocols' },
      { text: 'Pricing', link: '/pricing' },
      { text: 'CLI', link: '/cloud/cli' },
    ],
  },
],
```

The sidebar is only attached to `/cloud` — `/pricing` doesn't get it
because it sets `layout: home`. So the two halves of the section are
already navigationally inconsistent.

### Mega-nav (unchanged)

`MegaNav.vue` already lists Cloud and Pricing as sibling top-level
entries:

```86:87:website/.vitepress/theme/components/MegaNav.vue
{ id: 'cloud', label: 'Cloud', link: '/cloud' },
{ id: 'pricing', label: 'Pricing', link: '/pricing' },
```

→ We keep this. The pill bar is the second-level nav inside the
section.

---

## Pill bar — final set

Four pills + an external link, in a deliberate left-to-right order:

```
┌────────────────────────────────────────────────────────────────────┐
│  Overview · Usage · CLI · Pricing · Dashboard ↗                   │
└────────────────────────────────────────────────────────────────────┘
```

| #   | Pill             | URL                                    | Status                                                                                      |
| --- | ---------------- | -------------------------------------- | ------------------------------------------------------------------------------------------- |
| 1   | **Overview**     | `/cloud`                               | minor edit — fold in `/cloud/protocols` content (HTTP sync / DDN / clients / integrations). |
| 2   | **Usage**        | `/cloud/usage`                         | content unchanged; **delete** the duplicated trailing copy of itself.                       |
| 3   | **CLI**          | `/cloud/cli`                           | content unchanged.                                                                          |
| 4   | **Pricing**      | `/pricing`                             | content unchanged; pill bar dropped on top.                                                 |
| 5   | **Dashboard ↗** | `https://dashboard.electric-sql.cloud` | external; opens in new tab.                                                                 |

> Why drop _Protocols_ as a pill? It's ~35 lines and overlaps
> conceptually with the DDN paragraph already in Overview. Folding it
> in tightens the section without losing any content. Its URL becomes
> a 301 to `/cloud#protocols`.

---

## Pill-nav component

### Visual spec

A single bar that sits **directly under the global nav** and **above
the page content / hero**, full-width within the page gutter.

```
┌──────────────────────────────────────────────────────────────────┐
│  Global VPNav (logo · MegaNav · search)                          │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ◉ Overview   ○ Usage   ○ CLI   ○ Pricing   Dashboard ↗        │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│                  (page hero / page content)                      │
│                                                                  │
```

- **Pill chrome:** `padding: 8px 16px`, `border-radius: 999px`,
  `border: 1px solid var(--ea-divider)`, `background: var(--ea-surface)`.
- **Active pill:** filled, `background: var(--ec-surface-2)`,
  `color: var(--vp-c-text-1)`, border `var(--ec-border-2)`. Subtle —
  these are nav, not CTAs.
- **Hover:** border ramps to `var(--ec-border-2)`, no fill.
- **Type:** 14px, weight 600, `var(--vp-font-family-base)`. Match the
  weight of `MegaNav` triggers.
- **External pill (Dashboard):** trailing `↗` glyph,
  `target="_blank" rel="noopener"`. Same chrome.
- **Eyebrow strip (optional):** above the pills, a single muted
  `ELECTRIC CLOUD` line — `mono`, 11px, letter-spacing 0.08em,
  `var(--ea-text-3)`. Reinforces "you are inside the Cloud section".
  Easy to drop if it feels heavy.
- **Bottom rule:** 1px hairline (`var(--ea-divider)`) below the bar.

### Behaviour

- **Sticky:** `position: sticky; top: var(--vp-nav-height);` so it
  pins under the global nav. Add a 1px shadow on scroll for the
  detached state.
- **Active state:** computed from `useRoute().path`, mirroring the
  `activeId` pattern already in `MegaNav.vue`.
  - `/cloud` exact (or `/cloud/`) → Overview
  - `/cloud/usage*` → Usage
  - `/cloud/cli*` → CLI
  - `/pricing*` → Pricing
- **No anchor sub-rows in v1.** Keep it flat.

### Mobile

- < 768 px: bar becomes a **horizontally-scrollable row** with
  momentum scroll (`overflow-x: auto; scroll-snap-type: x mandatory`),
  scrollbar hidden — same pattern as `.pl-grid` in
  `PolyglotLineup.vue`. Active pill scrolls into view on mount.
- Sticky behaviour preserved.

### Component shape

```
website/.vitepress/theme/components/
  CloudSectionNav.vue          ← new, ~120 LOC
  CloudSectionNav.items.ts     ← new, single source of truth
```

`CloudSectionNav.items.ts`:

```ts
export type CloudPill = {
  id: string
  label: string
  href: string
  external?: boolean
  match?: (path: string) => boolean
}

export const CLOUD_PILLS: CloudPill[] = [
  {
    id: 'overview',
    label: 'Overview',
    href: '/cloud',
    match: (p) => p === '/cloud' || p === '/cloud/',
  },
  {
    id: 'usage',
    label: 'Usage',
    href: '/cloud/usage',
    match: (p) => p.startsWith('/cloud/usage'),
  },
  {
    id: 'cli',
    label: 'CLI',
    href: '/cloud/cli',
    match: (p) => p.startsWith('/cloud/cli'),
  },
  {
    id: 'pricing',
    label: 'Pricing',
    href: '/pricing',
    match: (p) => p.startsWith('/pricing'),
  },
  {
    id: 'dashboard',
    label: 'Dashboard',
    href: 'https://dashboard.electric-sql.cloud',
    external: true,
  },
]
```

Registered globally in `website/.vitepress/theme/index.js` (same
pattern as `MegaNav` etc.) so any page can write `<CloudSectionNav />`
without a per-page import.

### Integration

For each Cloud-section page (and `/pricing`), drop
`<CloudSectionNav />` as the first element of the page body.

Frontmatter changes:

- `cloud/index.md` — switch from current docs frontmatter to
  `layout: page` + `sidebar: false` (mirrors `/sync/index.md`).
- `cloud/usage.md` — keep docs layout for the right-rail outline,
  but add `sidebar: false` and `aside: true` in frontmatter as
  belt-and-braces.
- `cloud/cli.md` — same as `usage.md`.
- `pricing.md` — already `layout: home`; just add the bar at the top.

### Sidebar removal

In `website/.vitepress/config.mts`, **delete** the entire `/cloud`
entry from `themeConfig.sidebar`. Combined with `sidebar: false` on
each page, the docs sidebar disappears across the section.

---

## Per-page changes

### 1. `/cloud` — Overview

**Edit, don't rewrite.** Today's page is fine in tone — it just needs
the protocols content folded in and the pill bar at the top.

- Add `<CloudSectionNav />` at the top.
- Switch frontmatter to `layout: page` + `sidebar: false`.
- After the existing `## Data delivery network` block, append two
  small subsections lifted verbatim from `cloud/protocols.md`:
  - `### Clients` — TypeScript / Elixir links
  - `### Integrations` — pointer to `/docs/sync/integrations/react`
- Add anchor `id="protocols"` on the DDN heading (or a new `##
Protocols` heading wrapping the lifted content) so the redirect
  from `/cloud/protocols` lands somewhere meaningful.
- No other content changes.

### 2. `/cloud/usage` — Usage

- Add `<CloudSectionNav />` at the top.
- Add `sidebar: false` (and `aside: true` if not already implied) to
  the frontmatter.
- **Delete the duplicated trailing copy** of the page (lines ~60
  onwards in `usage.md` re-run the entire body — clearly a stale
  paste).
- No other content changes.

### 3. `/cloud/cli` — CLI

- Add `<CloudSectionNav />` at the top.
- Add `sidebar: false` to the frontmatter.
- No content changes.

### 4. `/pricing` — Pricing

- Add `<CloudSectionNav />` as the first element inside the page
  body, above the first `<Section>`.
- No other changes.

### 5. `/cloud/protocols` — fold in & redirect

- Lift the two useful subsections (_Clients_, _Integrations_) into
  `/cloud` as described above. The HTTP sync / DDN content already
  exists in Overview.
- **Delete** `website/cloud/protocols.md`.
- Add a 301 redirect `/cloud/protocols` → `/cloud#protocols` in
  whatever Netlify config the site uses for redirects.

---

## Implementation steps (in order)

1. **Component** — build `CloudSectionNav.vue` +
   `CloudSectionNav.items.ts`. Register globally in
   `theme/index.js`.
2. **Sidebar removal** — delete the `/cloud` entry from
   `config.mts` sidebar map.
3. **CLI page first** — add `<CloudSectionNav />` to `cloud/cli.md`
   plus `sidebar: false`. Verify sticky behaviour, active-state
   highlight, and that the right-rail outline still renders. CLI is
   the lowest-risk page to validate the bar on (no content changes).
4. **Usage page** — same treatment. Delete the duplicated trailing
   body in `usage.md` while we're in there.
5. **Pricing page** — drop the bar in at the top of `pricing.md`.
   Verify the `layout: home` container doesn't fight it.
6. **Overview page** — switch `cloud/index.md` to `layout: page`
   - `sidebar: false`, add the bar, fold in the two short subsections
     from `protocols.md` with a `#protocols` anchor.
7. **Protocols redirect** — add the 301; delete
   `website/cloud/protocols.md`.
8. **QA pass** — keyboard nav (Tab through pills, Enter to
   activate), `prefers-reduced-motion` (no animation on sticky
   shadow), dark mode, mobile horizontal scroll, deep-link landing
   on `/cloud#protocols`.

---

## Open questions

1. **Pill order.** Is _Pricing_ better at position 4 (current order,
   reads as the commercial step at the end of the journey) or
   position 2 (right after Overview, treating it as a marketing-led
   section)? Defaulting to the journey order: Overview → Usage →
   CLI → Pricing → Dashboard.
2. **Dashboard pill vs. button.** Render _Dashboard ↗_ as one of the
   pills (uniform, restrained) or as a right-aligned `Sign in →`
   button (stronger CTA, breaks the row). Default: pill, keep it
   uniform.
3. **Eyebrow strip.** `◉ ELECTRIC CLOUD` above the pills, or just
   the pills alone? Default: include it; trivial to drop later.
4. **Pricing page sub-anchors.** Worth surfacing `Plans · Compare ·
Calculator · FAQ` somewhere on `/pricing`? **Out of scope for
   v1** — a future enhancement to the pill bar (anchor sub-row under
   the active pill) could solve it without per-page work.
