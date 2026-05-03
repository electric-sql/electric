# Base UI Refactor Plan — `@electric-ax/agents-server-ui`

> **Status:** proposed, not started
> **Owner:** UI foundation
> **Scope:** swap `@radix-ui/themes` for `@base-ui/react`, move all component styling to CSS Modules, define a self-contained design-token sheet. Foundation only — no visual redesign in this pass.

## Goals

1. Drop `@radix-ui/themes` (`Theme`, `Flex`, `Text`, `Button`, `Dialog`, `Popover`, `DropdownMenu`, `Select`, `ScrollArea`, `Tooltip`, `HoverCard`, `IconButton`, `Badge`, `Code`, `Box`, `DataList`, `Link`).
2. Adopt `@base-ui/react` (v1.4.1, stable Dec 2025) for behaviourally-identical headless primitives.
3. Replace all Radix-supplied CSS (tokens, component styles, layout/typography primitives, the entire `--accent-*` and `--gray-*` scales) with our own token sheet + per-component CSS Modules.
4. **Simplify and standardise typography** — drop the Capsize trim trick (the `::before`/`::after` negative-margin hack in `agent-ui-markdown`) in favour of plain `line-height` values. Type metrics become predictable and trivially overridable.
5. Match the current visual look as closely as practical. This is a foundation step; a proper design overhaul follows.
6. Keep the public API of `@electric-ax/agents-server-ui` (the `src/index.ts` exports) source-compatible for downstream consumers.

## What we lose with Base UI (and have to rebuild)

Base UI is fully unstyled and ships zero CSS. Concretely we have to provide:

| Today (Radix Themes)                                                                                                                                                                                 | New owner                                                                                        |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `<Theme>` wrapper, `--accent-*`, `--gray-*` color scales (light + dark), spacing (`--space-1..9`), radii (`--radius-1..6`), type scale (`--font-size-1..6`, line-height pairs), font tokens, shadows | `src/ui/tokens.css` (light + dark via `data-theme`)                                              |
| `Flex`, `Box`, `Grid`, `Section`, `Container` (layout primitives)                                                                                                                                    | Tiny `Box` / `Stack` wrappers on top of `<div>` + CSS Modules                                    |
| `Text`, `Heading`, `Code`, `Link`, `DataList` (typography primitives)                                                                                                                                | Local `<Text>` / `<Heading>` / `<Code>` / `<Link>` / `<DataList>` components                     |
| `Button`, `IconButton`, `Badge` (visual components)                                                                                                                                                  | Local components — Base UI ships an unstyled `<Button>` we wrap; Badge has no Base UI equivalent |
| `Dialog`, `Popover`, `DropdownMenu`, `HoverCard`, `Tooltip`, `ScrollArea`, `Select` (overlay/behaviour)                                                                                              | Wrapped Base UI primitives (`Menu`, `Popover` w/ `openOnHover`, etc.)                            |
| Component-color props (`color="red" \| "green" \| "amber" \| "blue" \| "yellow" \| "gray"`) on `Badge` / `Button` / `IconButton` / `DropdownMenu.Item`                                               | Our token scale + a `tone` prop driving CSS Module selectors                                     |

## Architecture

### Folder layout

```
packages/agents-server-ui/src/
  ui/                              ← NEW: design-system primitives
    tokens.css                     ← color/space/type/radius/shadow tokens (light + dark)
    global.css                     ← reset, body, .app-root { isolation: isolate }
    Box.tsx + Box.module.css
    Stack.tsx + Stack.module.css
    Text.tsx + Text.module.css
    Heading.tsx + Heading.module.css
    Code.tsx + Code.module.css
    Badge.tsx + Badge.module.css
    Button.tsx + Button.module.css       (wraps @base-ui/react/button)
    IconButton.tsx + IconButton.module.css
    Input.tsx + Input.module.css         (wraps @base-ui/react/input)
    Textarea.tsx + Textarea.module.css
    Field.tsx + Field.module.css         (wraps @base-ui/react/field)
    Select.tsx + Select.module.css       (wraps @base-ui/react/select)
    Dialog.tsx + Dialog.module.css       (wraps @base-ui/react/dialog)
    AlertDialog.tsx + AlertDialog.module.css
    Popover.tsx + Popover.module.css
    HoverCard.tsx + HoverCard.module.css (Popover with openOnHover)
    Menu.tsx + Menu.module.css           (wraps @base-ui/react/menu)
    Tooltip.tsx + Tooltip.module.css
    ScrollArea.tsx + ScrollArea.module.css
    Separator.tsx + Separator.module.css
    Link.tsx + Link.module.css
    DataList.tsx + DataList.module.css
    ThemeProvider.tsx              ← replaces <Theme>; toggles data-theme="dark|light"
    index.ts                       ← barrel
  components/                      ← existing feature components, migrated to ui/*
  styles.css                       ← shrinks to: Streamdown markdown overrides only
  ...
```

### Why a thin wrapper layer (and not "use Base UI directly everywhere")

- 17 files import Radix today; centralising the swap means each migrated file changes only its imports + a few prop names, not its overlay wiring.
- `data-tone="danger"`, `data-variant="ghost"`, `data-size="sm"` on our wrappers gives us CSS hooks without exposing Base UI's compose-many-parts API to feature code.
- When the design overhaul happens later, we re-skin `ui/*.module.css` once instead of touching 17 component files.

### Tokens

`ui/tokens.css` keeps the same shape we currently rely on, but renamed to `--ds-*` and self-contained (no Radix dependency). To minimize churn during migration we keep aliases:

```css
:root[data-theme='light'],
:root:not([data-theme]) {
  /* light tokens */
}
:root[data-theme='dark'] {
  /* dark overrides */
}

/* Aliases for the existing CSS that references --gray-a5, --accent-9, --space-3, etc.
   Drop these aliases at end of Phase 4 once all references are on --ds-*. */
:root {
  --gray-a5: var(--ds-gray-a5);
  --accent-9: var(--ds-accent-9);
  --space-3: var(--ds-space-3);
  /* … */
}
```

Light/dark switching moves from toggling `.dark` class on `<html>` to setting `data-theme="dark"`.

### Typography — simplified, no Capsize

The current `agent-ui-markdown` block uses a Capsize-style trim — every `<p>`, `<h1>`–`<h6>`, `<ul>`, `<ol>` gets `::before` and `::after` pseudo-elements with hard-coded negative em margins (`-0.3968em`, `-0.1819em`, `-0.2425em`, …) tied to specific Radix `--font-size-*` / `--line-height-*` pairs. That's three problems:

- it locks us into Radix's exact font metrics,
- it makes adjusting type sizes (or fonts) brittle (you have to recompute the trim ratios), and
- it makes the markdown CSS much bigger than it needs to be.

**Replacement approach:**

- Define a small, predictable type scale in `tokens.css`:

  | Token            | Size | Line height |
  | ---------------- | ---- | ----------- |
  | `--ds-text-xs`   | 12px | 1.5         |
  | `--ds-text-sm`   | 13px | 1.55        |
  | `--ds-text-base` | 15px | 1.6         |
  | `--ds-text-lg`   | 17px | 1.5         |
  | `--ds-text-xl`   | 20px | 1.4         |
  | `--ds-text-2xl`  | 24px | 1.35        |
  | `--ds-text-3xl`  | 30px | 1.25        |

  (Final values to be confirmed against current rendered sizes; aim for visual parity ±1px.)

- Each markdown element gets one rule: `font-size: var(--ds-text-…); line-height: …; margin: 0;`. Vertical rhythm comes from the parent flex `gap` (already in place) — no per-element trim, no pseudo-elements.
- Remove every `::before { margin-bottom: -0.3968em }` / `::after` block from `styles.css`.
- The `<Text>` / `<Heading>` primitives expose `size="xs|sm|base|lg|xl|2xl|3xl"` and map to the same tokens.

Net effect: simpler, fully overridable, no font-metric coupling.

### Spacing scale

| Token          | Px  |
| -------------- | --- |
| `--ds-space-1` | 4   |
| `--ds-space-2` | 8   |
| `--ds-space-3` | 12  |
| `--ds-space-4` | 16  |
| `--ds-space-5` | 24  |
| `--ds-space-6` | 32  |
| `--ds-space-7` | 48  |
| `--ds-space-8` | 64  |
| `--ds-space-9` | 96  |

Matches Radix Themes' pixel scale 1:1, so existing `p="3"` / `gap="2"` migrations are mechanical.

### Radii

`--ds-radius-1` 4px · `--ds-radius-2` 6px · `--ds-radius-3` 8px · `--ds-radius-4` 12px · `--ds-radius-5` 16px · `--ds-radius-full` 9999px.

### Color scales

Per scale (`gray`, `accent`, `red`, `green`, `amber`, `blue`, `yellow`), provide steps `1..12` solid + `a1..a12` alpha, both light and dark, matching the way Radix exposes them. The accent scale is driven from a single `--ds-accent-base` (the current teal `#56e8ea` / `#75fbfd`) using `color-mix(in oklab, …)` — same generation strategy already used in the current `.radix-themes` block.

## Phased migration

### Phase 0 — Token self-containment (no behaviour change, ~½ day)

- Audit `styles.css` and the 2 `.module.css` files in `stateExplorer/` for every Radix token referenced (already inventoried).
- Add `ui/tokens.css` defining the complete `--ds-*` set; backfill aliases for the legacy names so nothing breaks while Radix Themes is still mounted.
- Verify pixel parity (light + dark) with Radix Themes still wrapped around the app.

### Phase 1 — Add Base UI + build the `ui/` primitive layer (~1–2 days)

- `pnpm --filter @electric-ax/agents-server-ui add @base-ui/react`.
- Build the `ui/*` wrappers listed above. Each is small (~30–80 lines TSX + module CSS).
- Add iOS-26 / portal hygiene: `body { position: relative }` + `.app-root { isolation: isolate }` on the root `<div>` in `App.tsx`.
- Snapshot tests / Storybook are out of scope; visually smoke-check each new primitive in dev next to its Radix counterpart.

### Phase 2 — File-by-file migration (~2–3 days)

Migrate leaf-first so each step compiles and runs:

| Order | File                                                  | Replaces                                                                                                                        |
| ----- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 1     | `StatusDot.tsx`                                       | (no Radix — skip)                                                                                                               |
| 2     | `UserMessage.tsx`                                     | `Flex`, `Text` → `Stack`, `Text`                                                                                                |
| 3     | `AgentResponse.tsx`                                   | `Flex`, `Text`                                                                                                                  |
| 4     | `EntityListItem.tsx`                                  | `Flex`, `Text` (+ inline tree-guide CSS → module)                                                                               |
| 5     | `MessageInput.tsx`                                    | `Flex`, `Text` (+ inline textarea styles → module)                                                                              |
| 6     | `EntityTimeline.tsx`                                  | `Flex`, `IconButton`, `ScrollArea`, `Text`                                                                                      |
| 7     | `CodingSessionTimeline.tsx`                           | `Badge`, `Flex`, `ScrollArea`, `Text`                                                                                           |
| 8     | `CodingSessionView.tsx`                               | `Flex`                                                                                                                          |
| 9     | `ToolCallView.tsx`                                    | `Badge`, `Box`, `Flex`, `Text` (+ inline pre/header styles → module)                                                            |
| 10    | `ServerPicker.tsx`                                    | `Button`, `DropdownMenu`, `Flex`, `IconButton`, `Text` → `Menu`                                                                 |
| 11    | `SpawnArgsDialog.tsx`, `CodingSessionSpawnDialog.tsx` | `Button`, `Dialog`, `Flex`, `Text` → `Dialog` + `Field`                                                                         |
| 12    | `EntityHeader.tsx`                                    | `Badge`, `Button`, `Dialog` (×2), `DropdownMenu`, `Flex`, `Text`                                                                |
| 13    | `Sidebar.tsx`                                         | `Flex`, `IconButton`, `Popover`, `ScrollArea`, `Text` (+ giant inline-style sections → module)                                  |
| 14    | `stateExplorer/TypeList.tsx`                          | `Badge`, `Box`, `Flex`, `Text`                                                                                                  |
| 15    | `stateExplorer/EventSidebar.tsx`                      | `Badge`, `Code`, `Flex`, `IconButton`, `Text`, `Tooltip` (existing module already references Radix tokens — switch to `--ds-*`) |
| 16    | `stateExplorer/StateTable.tsx`                        | `Badge`, `Code`, `DataList`, `Flex`, `HoverCard`, `Link`, `Text`                                                                |
| 17    | `stateExplorer/StateExplorerPanel.tsx`                | `Badge`, `Flex`, `Select`, `Text`                                                                                               |
| 18    | `router.tsx`, `App.tsx`                               | `Flex`, `Text`, `Theme` → `Stack`, `Text`, `ThemeProvider`                                                                      |

### Phase 3 — Remove Radix Themes (~½ day)

- Drop `@radix-ui/themes` from `package.json`.
- Remove `import '@radix-ui/themes/styles.css'` from `main.tsx`.
- Delete the `.radix-themes { … }` accent override block and the `.radix-themes h1…h6` block from `styles.css`.
- Replace `<Theme>` with `<ThemeProvider>` in `App.tsx`; `useDarkMode` switches from toggling `.dark` class to setting `data-theme` attribute.
- Run `pnpm -C packages/agents-server-ui typecheck && pnpm test && pnpm build`.

### Phase 4 — CSS hygiene cleanup (follow-up, ~½ day)

- Strip the Capsize `::before` / `::after` trim blocks from the `.agent-ui-markdown` styles. Set `font-size` + `line-height` directly per element, sourced from `--ds-text-*`.
- Move the Streamdown / `agent-ui-markdown` selectors out of `styles.css` into `components/Markdown.css` (kept as a global since `dangerouslySetInnerHTML`-rendered HTML cannot benefit from CSS Module hashing).
- Remove the legacy Radix-token aliases added in Phase 0 once all references are on `--ds-*`.
- `styles.css` (or a new `global.css`) shrinks to: `@import 'streamdown/styles.css'` + a small `body { margin: 0 }` reset + the `.app-root { isolation: isolate }` rule. Markdown styles live in their own file.

## Component-mapping notes (the tricky bits)

- **`DropdownMenu` → `Menu`**: Base UI's `Menu.Item` has no `color="red"`. Our wrapper exposes `<Menu.Item tone="danger">` and styles via `[data-tone="danger"]` selector.
- **`Dialog maxWidth="600px"`**: Base UI has no `maxWidth` prop; our wrapper passes `style={{ maxWidth }}` to `Dialog.Popup`.
- **`HoverCard`**: implement as `<Popover openOnHover delay={…}>` per Base UI docs — single component covers both popover and hovercard stories.
- **`ScrollArea scrollbars="vertical"`**: Base UI uses explicit `<ScrollArea.Scrollbar orientation="vertical">` parts; wrapper hides the prop and renders both scrollbars by default with `orientation` configurable.
- **`Select`**: Base UI's API is similar but exposes `Trigger / Value / Icon / Popup / Item` parts; wrapper presents a `{ value, onValueChange, items }`-style API to keep call sites tiny.
- **`Tooltip`**: requires a `<Tooltip.Provider>` near root — added in `ThemeProvider`.
- **`DataList`**: only used by `StateTable`'s FK hover-card; reimplement as a 2-col CSS grid (~20 lines).
- **`Code variant="ghost"`** + `Code size="1"`: just an inline-mono `<code>` styled to ghost (no background) or filled.
- **`Badge color="red|green|amber|blue|yellow|gray"`** + `variant="soft"`: ours becomes `<Badge tone="danger|success|warning|info|neutral|accent" variant="soft|solid">` (CSS module per tone × variant matrix).
- **Spacing prop migration**: `p="3"` (Radix `space-3` = 12px) → `<Box p={3}>` mapped to `padding: var(--ds-space-3)` so the visual scale is identical.
- **`Theme grayColor="slate"`**: pick the matching slate-flavoured neutral ramp when defining `--ds-gray-*`.

## Risks / open decisions

1. **Public API surface**: `src/index.ts` re-exports `Sidebar`, `EntityTimeline`, `EntityHeader`, etc. These keep working but consumers no longer need `@radix-ui/themes/styles.css` — note this in `CHANGELOG.md` and bump to `0.3.0`.
2. **`agents-server`'s embedded UI build**: confirm it still picks up the new tokens (it bundles `dist/`, so should be a non-issue, but worth a smoke test).
3. **Folder name**: proposed `src/ui/`. Alternatives: `src/primitives/`, `src/foundation/`, `src/components/ui/`. Easy to rename — confirm preference.
4. **One PR or several?** Phases 0+1 land cleanly without removing Radix (additive). Phases 2+3 are best as one coordinated PR (or split per feature area: timeline, sidebar, state-explorer, dialogs, app-shell). Phase 4 cleanup is independent.
5. **Type-scale parity**: dropping Capsize means a small (≤1–2px) shift in vertical metrics in markdown rendering. Acceptable since a redesign follows; flag if any consumer relies on exact pixel-perfect rendering today.

## Effort estimate

~4–6 focused dev days end-to-end (Phases 0–3). Phase 4 cleanup another ~½ day.

## Out of scope

- Visual redesign / restyle (follow-up project).
- Storybook / visual regression tooling.
- Token-name standardisation across other packages (`packages/website`, etc.) — this plan covers `agents-server-ui` only.
- Migrating `streamdown/styles.css` itself; we keep importing it as-is and override what we need.
