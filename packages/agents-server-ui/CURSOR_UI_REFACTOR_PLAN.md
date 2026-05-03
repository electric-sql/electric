# Cursor / Codex UI refactor plan

> Goal: reshape the agents-server-ui to feel like Cursor / Codex — a modern
> desktop-app aesthetic with a tighter sidebar, a single-line content header,
> a command-palette search, and a footer-anchored server + settings tile.
> Built on the existing Base UI + `--ds-*` design tokens. **No new component
> library.** Restructure layout, restyle, and add a few primitives.

## North-star (from the reference screenshot)

```
┌──────────┬──────────────────────────────────────────────────────────────┐
│ ▣  ⌕     │  ◀ Truncate subset refetch handling   tanstack/db   ●   …  ▤ │  ← top bar
├──────────┼──────────────────────────────────────────────────────────────┤
│ ▢ New    │                                                              │
│   …      │                                                              │
│ This wk  │                                                              │
│  ● item  │                  conversation history                        │
│  ● item  │                                                              │
│ Older    │                                                              │
│  ● item  │                                                              │
│  ● item  │                                                              │
│          │                                                              │
├──────────┤  ┌───────────────────────────────────────────────────────┐   │
│ ● Local  │  │ message input...                                  ↗  │   │
│   ⚙      │  └───────────────────────────────────────────────────────┘   │
└──────────┴──────────────────────────────────────────────────────────────┘
```

Key visual deltas vs. today:

- **Top bar** runs the full width; sidebar toggle + search live on the left,
  the entity title (left-aligned) + actions live on the right.
- **Sidebar** has new-session at top, **time-grouped** sessions in the middle,
  **server picker + settings** anchored to the bottom (replacing the avatar
  tile in Cursor).
- **Sessions** are single-line. Children collapsed by default — caret expands
  the subtree (instead of always-on tree guides).
- **Search** is a ⌘K overlay (sessions only), not a sidebar input. A
  separate **command** palette (e.g. `⌘P` / `⌘⇧P`) is reserved for a
  future phase covering actions like fork / kill / open state explorer.
- **Theme switching** moves into a settings menu beside the server picker
  (no more standalone footer icon).

## Phasing (each phase ships independently)

### Phase 0 — Foundations

Small additions to the design system that the rest of the plan leans on.

- `src/ui/Kbd.tsx` (+ `.module.css`) — keycap primitive (`<Kbd>⌘K</Kbd>`).
  Cursor-style: 11px, mono, `--ds-gray-a3` background, 1px bottom shadow.
- `src/ui/TopBar.tsx` (+ `.module.css`) — new layout primitive:
  - 36–40px height, `border-bottom: 1px solid var(--ds-divider)`.
  - Three slots: `start`, `title` (centered/truncated), `end`.
  - Used by both the global app shell and (Phase 1) wraps the entity header.
- `src/lib/sessionGroups.ts` — pure utility:
  ```ts
  type Bucket =
    | 'today'
    | 'yesterday'
    | 'last7'
    | 'last30'
    | 'monthYYYYMM'
    | 'older'
  function bucketEntities(
    entities,
    now
  ): Array<{ key: Bucket; label: string; items: ElectricEntity[] }>
  ```
  Buckets, in order: **Today**, **Yesterday**, **Previous 7 days**
  (rolling, days 2–7 ago — not ISO week), **Previous 30 days** (rolling),
  then per-month labels (`October 2024`, …) ending in **Older** (anything
  > 12 months old). Empty buckets are dropped from the output.
- `src/hooks/useHotkey.ts` — minimal `useHotkey('mod+k', cb)` that respects
  inputs (skips when target is editable). Used for ⌘K and the sidebar toggle.
- Token tweaks in `src/ui/tokens.css`:
  - Drop default body size from 16 → 14 (`--ds-text-base: 14px`), keep
    `--ds-text-sm` at 13 for chrome (sidebar rows, top bar). Status / meta
    text drops to `--ds-text-xs` (11–12px).
  - Tighten neutral surfaces: `--ds-bg` slightly cooler / closer to
    Cursor's off-white; `--ds-bg-subtle` becomes the sidebar surface
    (currently `--ds-gray-a2`).
  - Add `--ds-row-height-sm: 24px` and `--ds-row-height-md: 28px` for
    sidebar/menu/topbar rows.

No app-level behaviour changes in this phase.

### Phase 1 — Global top bar + single-line entity header

Today: `EntityHeader` is a 2-line block (title + url) with a horizontal
toolbar and lives inside the entity route only. We promote it to a global
top bar so the sidebar toggle and search live in a stable place.

- New `src/components/AppTopBar.tsx`:
  - Left slot: **sidebar toggle** (`PanelLeftClose` / `PanelLeftOpen`),
    **search** trigger button (`Search` icon + label "Search…" + `<Kbd>⌘K</Kbd>`).
    Search button is the visible affordance for the palette (Phase 4).
  - Title slot: route-supplied title, **left-aligned** immediately after
    the search button (Codex-style, not centered).
  - Right slot: route-supplied actions (status badge, panel toggle, 3-dot menu).
- `RootLayout` in `src/router.tsx`:
  - Wraps everything in a column: `<AppTopBar />` above the
    `Sidebar` + `<Outlet />` row.
  - Manages sidebar collapsed state (`useSidebarCollapsed()` hook, persisted
    to `localStorage`). Toggle hotkey: `mod+b` (Cursor parity).
  - **Collapsed = fully hidden** (sidebar element unmounts / `display: none`,
    main content takes full width). No icon rail. Re-open via the top-bar
    toggle button or `mod+b`.
- Refactor `EntityHeader.tsx`:
  - Becomes a render function that contributes title (left) + actions (right)
    to `AppTopBar` via a small `useTopBarSlots()` hook (or the simpler
    "EntityPage renders `<AppTopBar title={…} actions={…}/>`" pattern —
    pick the latter to avoid context plumbing).
  - **Single-line title:** `instance-name` (medium) · entity-type (small,
    muted, badge-style) · `…/short-url` (small, mono, copyable on click).
    Errors (`killError`, `forkError`) move into a toast/inline alert below
    the bar (or surface in the existing dialog), not in the title row.
  - **Right cluster:** status badge → panel toggle → 3-dot menu.
    Pin and Fork move **into** the 3-dot menu (per north-star).
  - Drop the standalone Pin button + standalone Fork button from the bar.
- `IndexPage` also renders `<AppTopBar title="" actions={null}/>` so the
  bar is always visible (Cursor never hides chrome on empty states).

### Phase 2 — Sidebar restructure (rows + grouping)

- `src/components/Sidebar.tsx` layout becomes:
  1. **New session** button (top, full-width, accent fill — keep current
     popover for entity-type selection).
  2. **Pinned** section (only when non-empty; same as today).
  3. **Time-grouped sessions** using `bucketEntities(entities, Date.now())`.
  4. (Footer becomes Phase 3.)
- Remove the inline filter `<input>` and `urlsMatchingFilter` — replaced by
  ⌘K palette in Phase 4. (Keep the helper file deletable until Phase 4
  lands so we can ship the layout first if needed.)
- New `src/components/SidebarRow.tsx` replacing `EntityListItem.tsx`:
  - **Single line, fixed height** (`--ds-row-height-md`).
  - Layout: `[caret? ▸/▾]  [● status dot]  [title (truncated)]  [type badge, muted]`.
  - No second meta line, no relative-time, no slug. (Those move to
    hover-card / detail view if we want them.)
  - Selection background: `--ds-accent-a3` (today's behaviour, kept).
  - Truncation: `text-overflow: ellipsis`, full title in `title=""` and
    via tooltip on long-press / hover (use existing `Tooltip` primitive).
- New `src/components/SidebarTree.tsx`:
  - Tracks per-row expanded state (`Map<url, boolean>`, persisted in
    `localStorage` keyed by `electric-agents-ui.tree.expanded`).
  - **Children collapsed by default.** Caret renders only when row has
    children; expanded state shows children indented (16px per level)
    with the existing `TreeGuide` lines, **only inside expanded subtrees**.
  - Selecting a child still navigates as today.
- Section labels (`SectionLabel`) get a tighter style: 10px uppercase,
  letter-spacing `0.08em`, `--ds-gray-a9`, padding `12px 12px 4px`.
  Reused for "Pinned" + each time bucket.

### Phase 3 — Bottom-anchored server + settings tile

Replace today's footer (just a theme button) with a Cursor-style "user tile".

- New `src/components/SidebarFooter.tsx` mounted at the bottom of `Sidebar`:
  - Left: **server tile** — clickable, opens server menu.
    - `[● status dot] [server name (truncated)]  [▾]`.
    - Single line, `--ds-row-height-md`, hover background `--ds-gray-a3`.
    - Status dot colours from existing logic (green = connected,
      red = configured-but-down, gray = none).
  - Right: **settings button** (`Settings` icon, ghost) opens a menu.
- `src/components/ServerPicker.tsx`:
  - Keep the menu, drop the `bar` wrapping (now lives in `SidebarFooter`).
  - Server-list items get a Cursor-like single-row form (icon + name +
    trash on hover, instead of always-visible).
  - "Add server" stays as a menu entry; the inline `AddServerPanel` still
    appears anchored to the footer when triggered.
- New `src/components/SettingsMenu.tsx` (uses `Menu` primitive):
  - **Theme** submenu group with three menu items, each with a leading icon
    - a trailing check on the active option:
      `Light` (Sun) · `Dark` (Moon) · `System` (Monitor).
      Selecting calls a new `setPreference(p)` (add to `useDarkMode` —
      today only `cyclePreference` is exposed).
  - Reserve a `Menu.Separator` + slot for future "About / Diagnostics /
    Reset state" actions (no-ops in this phase).

Net effect: `Sidebar.tsx`'s top section loses the server bar; the footer
gains the server tile + settings cog.

### Phase 4 — Search palette (⌘K)

VS Code / Cursor style **search**, scoped to finding sessions. A future
phase will introduce a separate **command** palette (likely `⌘P` or
`⌘⇧P`) for actions (kill / fork / open state explorer / etc.); that work
is out of scope here.

- New `src/components/SearchPalette.tsx`:
  - Renders an always-mounted `<Dialog.Root>` controlled by a
    `useSearchPalette()` hook (open state in context so any component can
    open it — top-bar search button + ⌘K hotkey).
  - `Dialog.Content` styled wide (`min(640px, 92vw)`) and **top-anchored**
    (margin-top: 12vh; new `topAnchored` flag on `Dialog` primitive, or a
    dedicated CSS class via `className`).
  - Body:
    - Search `<input>` with placeholder "Search sessions…",
      auto-focused on open.
    - Result list, virtualized only if needed (initially plain `map`).
      Grouped by **Pinned / Sessions** (sessions ordered by recency).
      Each row mirrors `SidebarRow`'s layout: status dot, title, type pill.
    - Up/Down arrows move highlight; Enter navigates to the highlighted
      session and closes the palette; Esc closes; mouse hover updates
      highlight.
    - Footer hint row showing `↑↓ Navigate · ↵ Open · esc Close`.
- Search algorithm (initially): substring match on
  `title | url | type | tag values`, ranked by recency (`updated_at desc`).
  Easy to swap for `fuzzysort` later if needed.
- Hotkeys (`useHotkey`):
  - `mod+k` toggles search palette open from anywhere.
  - `mod+b` toggles sidebar collapsed (already bound in Phase 1).
- `Sidebar.tsx`: remove the filter `<input>` and `useState(filter)`,
  remove `urlsMatchingFilter` (or keep if reused by palette — likely not,
  palette has its own ranker).
- Reserve `mod+p` / `mod+shift+p` (do not bind yet) for the future command
  palette so we don't accidentally claim the shortcut for something else.

### Phase 5 — Visual polish (Cursor-y feel)

Mostly CSS / token tuning, no behaviour changes.

- **Density**: sidebar rows + menu rows shrink to 28px; top-bar buttons to
  28px; chat bubbles tighten by ~10% top/bottom padding.
- **Type scale**:
  - Sidebar row title: 13px / 500.
  - Sidebar row meta + section labels: 11px / 500 / muted.
  - Top-bar title: 13px / 600; type pill: 11px / 500 / muted.
  - Status badges shrink to 10px uppercase (`letter-spacing: 0.06em`).
- **Surfaces**: sidebar background = `--ds-bg-subtle`; top bar = same;
  main content = `--ds-bg`. Subtle 1px right border between them.
- **Buttons / menus**: align icon-only ghost buttons to 24×24, switch from
  `--ds-radius-2` to `--ds-radius-3` on rows, tighten popover padding
  (`Menu` content `padding: 4px`, item `padding: 4px 8px`).
- **Status dot**: keep current 7px circle but desaturate slightly to
  match Cursor's quieter palette (e.g. `running` → `--ds-blue-a9` mix).
- **Icon sizing**: standardise to 14px in chrome, 16px in toolbars.
- **Resizer**: hover affordance becomes a 1px accent line instead of a
  full-width tint (subtler, Cursor-style).

### Phase 6 — Cleanup + verification

- Delete the now-unused: sidebar filter input + helper, separate Pin/Fork
  buttons in the entity bar, `themeButtonIcon/themeButtonAriaLabel`
  helpers (subsumed by `SettingsMenu`).
- Confirm `useDarkMode` exposes both `cyclePreference` (back-compat,
  unused after Phase 3) and the new `setPreference`. Decide whether to
  remove `cyclePreference` in this phase.
- Browser pass on http://localhost:5173/\_\_agent_ui/:
  - Top bar: sidebar toggle, search opens palette, ⌘K opens palette,
    ⌘B toggles sidebar.
  - Sidebar: groups render correctly across week/month boundaries
    (mock entities with edited `updated_at` if needed); caret expand
    persists across reloads.
  - Footer: server menu + settings (Theme: Light/Dark/System) work.
  - Entity header: single-line, pin + fork live in the 3-dot menu.
  - Light / dark / system theme switching has no flash.
- Typecheck + lint + build green.

## File map (new / changed / deleted)

**New**

- `src/ui/Kbd.tsx`, `src/ui/Kbd.module.css`
- `src/components/AppTopBar.tsx`, `AppTopBar.module.css`
- `src/components/SidebarRow.tsx`, `SidebarRow.module.css`
- `src/components/SidebarTree.tsx`
- `src/components/SidebarFooter.tsx`, `SidebarFooter.module.css`
- `src/components/SettingsMenu.tsx`
- `src/components/SearchPalette.tsx`, `SearchPalette.module.css`
- `src/lib/sessionGroups.ts`
- `src/hooks/useHotkey.ts`
- `src/hooks/useSidebarCollapsed.ts`
- `src/hooks/useExpandedTreeNodes.ts`
- `src/hooks/useSearchPalette.tsx` (provider + hook)

**Changed**

- `src/router.tsx` — top-bar in `RootLayout`; entity page contributes title/actions.
- `src/components/Sidebar.tsx` — drop server picker from top, drop filter,
  replace tree with `SidebarTree`, mount `SidebarFooter`.
- `src/components/EntityHeader.tsx` — collapses to single-line; pin + fork
  move into the 3-dot menu; bar contents pass through `AppTopBar`.
- `src/components/ServerPicker.tsx` — strip outer `bar`; restyle menu rows.
- `src/hooks/useDarkMode.tsx` — add `setPreference(p)`.
- `src/ui/tokens.css` — type scale + density tokens (Phase 0/5).
- `src/ui/global.css` — small additions for top bar grid.

**Deleted**

- `src/components/EntityListItem.tsx` (replaced by `SidebarRow`).
- Sidebar filter styles / `emptyTreeText` / `filterRow` / `filterInput` in
  `Sidebar.module.css`.
- `themeButtonIcon` / `themeButtonAriaLabel` helpers in `Sidebar.tsx`.

## Resolved

- **Title placement**: left-aligned (Codex-style) immediately after the
  search button.
- **Sidebar collapsed**: fully hidden — re-open via top-bar toggle or `⌘B`.
  No icon rail.
- **Time buckets**: rolling 7 / 30 days (not ISO week).
- **⌘K = search**, sessions only. A separate **command** palette is a
  future phase and out of scope here.

## Still open

1. **Pin affordance on sidebar rows**: only in the 3-dot menu (current
   plan), or also a hover-revealed pin icon on each row? Plan defaults to
   menu-only; trivial to add back if we miss the quick-pin during use.
2. **Future command-palette shortcut**: tentatively `⌘P` or `⌘⇧P`. Not
   bound in this refactor — just reserved.

## Non-goals (explicitly out of scope)

- Touching the entity timeline / chat rendering. The brief says "match
  cursor" for chat; treat as Phase 7+ once layout is settled.
- Replacing Base UI or revisiting the design-token structure beyond the
  small Phase 0 tweaks.
- Dropping HashRouter / changing routing semantics.
- Server-list / server-management UI changes beyond restyling.
