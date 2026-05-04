# Tile-Based Layout Refactor — Agents Server UI

Follow-up to the Radix → Base UI migration. With Base UI + CSS Modules in
place, the next foundation is a **VS Code / Cursor-style splittable
workspace** so multiple agents — and multiple **views** of an agent — can
be open side-by-side.

---

## 1. What we're building

### Concepts

1. **Workspace** — the root pane container that fills the area to the
   right of the sidebar. Holds a single root `Split` node (or nothing).
2. **Split** — a horizontal _or_ vertical container of children.
   Children are either other `Split` nodes or `Group`s.
3. **Group** (a.k.a. _editor group_ in VS Code) — a leaf area that
   holds one or more `Tile`s, only one of which is "active" at a time,
   with a tab strip across the top.
4. **Tile** — what's rendered. A tile is `{ entityUrl, viewId }`. The
   same entity can be open in multiple tiles (e.g. chat + state explorer
   side-by-side).
5. **View** — a pluggable renderer registered against an `id` (e.g.
   `chat`, `state-explorer`, future `logs`, `inspector`, `metrics`,
   etc.). Splitting and view-switching are **orthogonal** primitives.

### User-facing behaviour

| Action                                                                                        | Result                                                                                                                            |
| --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Click an entity in the sidebar                                                                | Opens it as a new tile in the **active group**, replacing the current tile. (v1: always replace; preview-tab semantics deferred.) |
| Cmd/Ctrl-click sidebar entity                                                                 | Open in a new group split to the right.                                                                                           |
| Drag entity from sidebar onto workspace                                                       | Shows split-zone overlay; drop into one of 5 zones (centre/N/E/S/W of an existing group, or onto a tab strip).                    |
| Drag a tab between groups                                                                     | Move tile to that group. Same 5-zone overlay.                                                                                     |
| `…` menu → **Split Right / Split Down / Split Left / Split Up**                               | Duplicates the active tile into a new group split in that direction (matches Cursor's chat-pane menu).                            |
| `…` menu → **View ▸ {viewId} ▸ Open here / Split right / Split down / Split left / Split up** | Opens an additional view of the _same_ entity.                                                                                    |
| Close last tile in a group                                                                    | Group is removed; sibling expands.                                                                                                |
| Close last group                                                                              | Workspace returns to the empty `NewSessionPage`.                                                                                  |
| Drag the divider between groups                                                               | Resizes the split.                                                                                                                |
| Hotkeys                                                                                       | `⌘D` Split Right · `⇧⌘D` Split Down · `⌘W` close active tile · `⌘\` switch active group · `⌘1..9` focus group N.                  |

### Out of scope for this work

- Floating windows / detach to OS window.
- Pinned tabs ordering / drag-to-reorder _within_ a tab strip (v1: drop
  on tab strip = append).
- "Preview" (italic) tab semantics — start with "always replace active
  tile" then iterate.
- Per-server-keyed workspace persistence (start global; revisit later).

---

## 2. Why a new layout model (and not just CSS flex)

The current `EntityPage` (`src/router.tsx`) hardcodes:

- one entity at a time (URL-driven),
- a single optional right drawer for the State Explorer with a
  hand-rolled splitter,
- the State Explorer toggle living on `EntityHeader`.

To support arbitrary nested splits we need a **recursive tree data
structure** as the source of truth, not URL + boolean flags. Once the
tree exists, the URL becomes a _projection_ of it (one of the tiles is
"focused" and its url shows up in the address bar) instead of the
source.

---

## 3. Architecture

### 3.1 Data model

`src/lib/workspace/types.ts`:

```ts
export type ViewId = string // 'chat' | 'state-explorer' | 'logs' | ...

export type Tile = {
  id: string // nanoid; stable across renders
  entityUrl: string // '/horton/foo-123'
  viewId: ViewId
}

export type Group = {
  kind: 'group'
  id: string
  tiles: Tile[]
  activeTileId: string
}

export type Split = {
  kind: 'split'
  id: string
  direction: 'horizontal' | 'vertical' // horizontal = side-by-side
  // Each child carries its own size as a fraction (sums to ~1).
  children: { node: WorkspaceNode; size: number }[]
}

export type WorkspaceNode = Split | Group

export type Workspace = {
  root: WorkspaceNode | null // null = empty / new-session
  activeGroupId: string | null
}
```

`ViewId` is a plain string instead of a string-literal union, because
the registry (§3.3) is the source of truth and grows over time. We
type-check at the registration site.

### 3.2 Reducer + provider

`src/lib/workspace/workspaceReducer.ts` — pure operations:

- `openTile(state, { entityUrl, viewId, target: { groupId, position } })`
  where `position` is `'replace' | 'append' | 'split-right' | 'split-down' | 'split-left' | 'split-up'`.
- `closeTile(state, tileId)` — collapses empty groups; unwraps
  single-child splits.
- `moveTile(state, tileId, target)` — drag-and-drop primitive.
- `setActive(state, { groupId, tileId? })`.
- `setTileView(state, tileId, viewId)` — view switching in place.
- `resizeSplit(state, splitId, sizes[])`.
- `splitTileWithView(state, tileId, viewId, direction)` — composition
  helper used by the menu (split + setTileView in one).

`src/hooks/useWorkspace.tsx` — `WorkspaceProvider` (wraps `useReducer`)
and `useWorkspace()` returning `{ workspace, dispatch, helpers }`.
Helpers wrap dispatch for ergonomics, e.g.
`helpers.openEntity(url, { in: 'active' | 'split-right' | … })`.

> **Implementation note:** the reducer must be **synchronous and
> side-effect-free** so it's cheap to unit-test. Vitest suite in
> `src/lib/workspace/workspaceReducer.test.ts` covers the tricky bits
> (closing the last tile, splitting an only-tile group, normalising
> sizes after a delete, view-switching during a drag).

### 3.3 View registry

`src/lib/workspace/viewRegistry.tsx`:

```ts
import type { ComponentType } from 'react'
import type { LucideIcon } from 'lucide-react'
import type { ElectricEntity } from '../ElectricAgentsProvider'

export type ViewProps = {
  baseUrl: string
  entityUrl: string
  entity: ElectricEntity
  entityStopped: boolean
  isSpawning: boolean
  // The tile id is passed so views can scope local state (e.g. scroll
  // position, selected row) per-tile rather than per-entity, matching
  // VS Code editor behaviour where two splits of the same file scroll
  // independently.
  tileId: string
}

export type ViewDefinition = {
  id: ViewId
  label: string // 'Chat', 'State Explorer'
  icon: LucideIcon // shown in tab + menu
  shortLabel?: string // shown in narrow tabs
  description?: string // shown as menu hint
  // Whether this view applies to a given entity. Lets us hide views
  // that don't make sense (e.g. a Coding-session-only timeline view).
  isAvailable?: (entity: ElectricEntity) => boolean
  // Default split direction when the menu's "View ▸ X" leaf is clicked
  // directly (not its sub-items). Preserves muscle-memory like
  // "State Explorer pops out to the right".
  defaultSplit?: 'right' | 'down'
  Component: ComponentType<ViewProps>
}

const registry = new Map<ViewId, ViewDefinition>()

export function registerView(def: ViewDefinition): void {
  registry.set(def.id, def)
}
export function getView(id: ViewId): ViewDefinition | undefined {
  return registry.get(id)
}
export function listViews(entity?: ElectricEntity): ViewDefinition[] {
  const all = Array.from(registry.values())
  return entity ? all.filter((v) => v.isAvailable?.(entity) ?? true) : all
}
```

Registration happens once at app boot in
`src/lib/workspace/registerViews.ts`:

```ts
import { MessageSquare, Database } from 'lucide-react'
import { registerView } from './viewRegistry'
import { ChatView } from '../../components/views/ChatView'
import { StateExplorerView } from '../../components/views/StateExplorerView'

registerView({
  id: 'chat',
  label: 'Chat',
  icon: MessageSquare,
  Component: ChatView,
})

registerView({
  id: 'state-explorer',
  label: 'State Explorer',
  icon: Database,
  description: 'Inspect shared state and event log',
  defaultSplit: 'right',
  Component: StateExplorerView,
})
```

`registerViews` is imported once from `main.tsx` so the side-effect
runs before the app mounts.

#### Why splits and views stay orthogonal

| Operation                             | Affects layout?        | Affects view?                |
| ------------------------------------- | ---------------------- | ---------------------------- |
| `Split Right` (`⌘D`)                  | yes — adds a new group | no — duplicates current view |
| `View ▸ State Explorer ▸ Open here`   | no                     | yes — swaps in-place         |
| `View ▸ State Explorer ▸ Split right` | yes                    | yes — both, in one step      |
| Drag tab to another group             | yes                    | no                           |
| Click a tab in the strip              | no                     | yes (changes active tile)    |

Two clean primitives (`split`, `setTileView`) compose to express every
menu item.

### 3.4 URL ↔ workspace sync (hybrid strategy)

The app uses `createHashHistory` (`src/router.tsx`), so URLs look like
`https://app/#/entity/foo`. We adopt a **hybrid model**:

1. **Default URL = active tile only.** Clean and human-readable;
   matches a user's mental model of "I'm looking at X right now".
2. **Layout state lives in localStorage**, keyed by server (so two
   different Electric servers each remember their own layout).
3. **`?layout=…` is an opt-in import param** for sharing —
   pasting/visiting one hydrates the workspace; we then strip the
   param so the URL settles back to "active tile only".

Examples:

```
#/                                       → empty workspace
#/entity/horton/foo                      → single chat tile
#/entity/horton/foo?view=state-explorer  → single State Explorer tile
#/entity/horton/foo                      → multi-tile workspace where
                                            'foo' is the active tile;
                                            full layout from localStorage
#/entity/horton/foo?layout=H(…)          → explicit layout import; we
                                            hydrate then strip the param
```

#### Layout encoding mini-DSL

Compact, human-debuggable, URL-safe (no encoding needed for
parens/commas/colons/dot/at):

```
node    := group | hsplit | vsplit
hsplit  := 'H' '(' sized (',' sized)+ ')'      // horizontal = side-by-side
vsplit  := 'V' '(' sized (',' sized)+ ')'      // vertical   = stacked
sized   := node (':' int)?                      // size as percentage; default = even
group   := tile (',' tile)* ('@' int)?          // @int = active tile index, default 0
tile    := <urlEncodedEntityUrl> '.' viewId
```

| Layout                               | Encoded                                                       |
| ------------------------------------ | ------------------------------------------------------------- |
| Single tile                          | `horton%2Ffoo.chat`                                           |
| Two tabs in one group, second active | `horton%2Ffoo.chat,horton%2Ffoo.state-explorer@1`             |
| Chat 60% + State 40% side-by-side    | `H(horton%2Ffoo.chat:60,horton%2Ffoo.state-explorer:40)`      |
| Chat left, two stacked right         | `H(horton%2Ffoo.chat,V(horton%2Fbar.chat,horton%2Fbaz.logs))` |

Encoder/decoder lives in `src/lib/workspace/layoutCodec.ts` with a
Vitest suite covering round-trips. We deliberately avoid base64+JSON
because the DSL is ~2× shorter and visually parseable in the URL bar
when something goes wrong.

#### URL → workspace (hydration order on load / external nav)

1. If `?layout=…` is present → parse it, replace the workspace,
   `navigate({ replace: true })` to strip the param.
2. Else if a serialized workspace exists in
   `localStorage[electric-agents-ui.workspace.<serverId>.v1]` **and**
   it contains a tile matching the URL's `entity`+`view` → restore it
   and mark that tile active.
3. Else → fresh workspace with a single tile from the URL (current
   behaviour).

If the URL points at an entity that's missing from the restored
layout we **insert a new tile in the active group** rather than
discarding the layout — preserves "open this link" semantics while
respecting existing splits.

#### Workspace → URL (sync after every state change)

Critical rule: the **active tile drives the URL**, and we use
`push` vs `replace` carefully so back/forward maps to user intent
rather than splitter drags.

| Change                                                                   | History                                                   |
| ------------------------------------------------------------------------ | --------------------------------------------------------- |
| Active tile changes (click tab, click sidebar row, switch view in place) | `push` — back/forward navigates between tiles             |
| Open new tile in active group                                            | `push` — it became the new active tile                    |
| Split (active → new group)                                               | `push` — focus follows split, becomes the new active tile |
| Resize splitter                                                          | none (no URL change)                                      |
| Move/drag tile, close non-active tile                                    | `replace` — no URL change, but localStorage update fires  |
| Close active tile                                                        | `push` — the new active tile becomes the URL              |
| Drag sidebar entity into a non-active group                              | `replace` — active tile didn't change                     |

#### Persistence

- Debounced 250 ms write of the whole `Workspace` to
  `localStorage[electric-agents-ui.workspace.<serverId>.v1]`.
- Prune-on-load entities that no longer exist in `entitiesCollection`;
  if pruning empties a group, collapse the group; if it empties the
  workspace, reset to single-tile from the URL.
- A schema-version-stamped envelope (`{ v: 1, workspace: {…} }`) so
  a future format change can either migrate or fall back to a fresh
  workspace.

#### "Copy layout link" affordance

A menu item in the workspace `…` menu (or a workspace-level menu in
the sidebar header):

```ts
function copyLayoutLink() {
  const encoded = encodeLayout(workspace) // 'H(...)'
  const url = new URL(window.location.href)
  const [path, query = ''] = url.hash.replace(/^#/, '').split('?')
  const params = new URLSearchParams(query)
  params.set('layout', encoded)
  url.hash = '#' + path + '?' + params.toString()
  navigator.clipboard.writeText(url.toString())
}
```

The URL is long but only when explicitly requested; the address bar
during normal use stays clean.

### 3.5 Component tree

```
<RootShell>
  ├── <Sidebar>         (existing; gets DnD source bindings)
  └── <Workspace>       (new — replaces EntityPage's body)
        └── <NodeRenderer node={root}>
              └── if Split:  <SplitContainer> with <NodeRenderer>s + <Splitter>s
              └── if Group:  <GroupContainer>
                                ├── <TabStrip>
                                ├── <TileChrome>   (header + … menu, wraps EntityHeader)
                                └── <TileBody>     (resolves view from registry)
        └── <DropOverlay /> (drag-target zones, rendered into a portal)
```

`TileBody`:

```tsx
const def = getView(tile.viewId)
if (!def) return <UnknownView viewId={tile.viewId} />
const View = def.Component
return (
  <View
    baseUrl={baseUrl}
    entityUrl={entity.url}
    entity={entity}
    entityStopped={entityStopped}
    isSpawning={isSpawning}
    tileId={tile.id}
  />
)
```

#### Files added

- `src/components/workspace/Workspace.tsx`
- `src/components/workspace/NodeRenderer.tsx`
- `src/components/workspace/SplitContainer.tsx` + `.module.css`
- `src/components/workspace/Splitter.tsx` + `.module.css`
  (extract & generalise the existing `EntityPage` splitter)
- `src/components/workspace/GroupContainer.tsx` + `.module.css`
- `src/components/workspace/TabStrip.tsx` + `.module.css`
- `src/components/workspace/TileChrome.tsx` + `.module.css`
- `src/components/workspace/DropOverlay.tsx` + `.module.css`
- `src/components/workspace/SplitMenu.tsx` (the `…` menu)
- `src/components/views/ChatView.tsx`
- `src/components/views/StateExplorerView.tsx`
- `src/lib/workspace/types.ts`
- `src/lib/workspace/workspaceReducer.ts` (+ test)
- `src/lib/workspace/viewRegistry.tsx`
- `src/lib/workspace/registerViews.ts`
- `src/hooks/useWorkspace.tsx`

#### Files changed

- `router.tsx` — replace `EntityPage`'s ad-hoc body with `<Workspace />`;
  add the URL-sync effect; remove `statePanelWidth` / bespoke splitter.
- `EntityHeader.tsx` — strip the State-Explorer toggle (it moves into
  `SplitMenu` as `View ▸ State Explorer ▸ …`); the per-tile `…` menu
  becomes the new actions cluster.
- `Sidebar.tsx` / `SidebarRow.tsx` / `SidebarTree.tsx` — make rows
  draggable (HTML5 `draggable=true` + `dragstart` payload); allow
  `Cmd/Ctrl+click` and `Middle-click` shortcuts to open in a new
  split.

### 3.6 Drag-and-drop strategy

Use **native HTML5 DnD** (no `react-dnd`). The surface is small
(sidebar rows, tabs, group-body drop zones), and Cursor-style overlays
are pure CSS once we have the geometry. A thin abstraction:

- `useDraggable({ payload: WorkspaceDragPayload })` — wires
  `draggable`, `dragstart`/`dragend`, sets `dataTransfer` (JSON via
  `application/x-electric-tile`).
- `useDropTarget(groupId)` — on `dragover`, computes which of the 5
  zones the cursor is in (centre / N / E / S / W using a 25% inset),
  shows the overlay, and on `drop` dispatches `moveTile` or `openTile`.

```ts
type WorkspaceDragPayload =
  | { kind: 'sidebar-entity'; entityUrl: string }
  | { kind: 'tile'; tileId: string; sourceGroupId: string }
```

`<DropOverlay>` is one element per group, absolutely positioned, with
five segments that highlight on hover — same visual language as
Cursor's chat-pane drop zones.

### 3.7 The `…` menu (matches the screenshots)

Component: `SplitMenu.tsx` using existing Base UI `Menu`.

```
View                ►   [for each view in listViews(entity):]
                           Chat                          ⌘1
                           State Explorer                ⌘2
                           …
                        ─────
                        Switch view in place      ►   Chat
                                                     State Explorer
                                                     …
─────
Split Right          ⌘D     (duplicates current tile)
Split Down          ⇧⌘D
Split Left
Split Up
─────
Move tile to        ►   New group right / below / Group N
─────
Copy URL · Pin
─────
Close tile          ⌘W
Close group        ⇧⌘W
```

Each `View ▸ {leaf}` is itself a sub-menu, answering the brief's
"second level option to specify open in a split to the side or under":

```
View ▸ State Explorer ▸  Open here       (replaces current tile)
                         Split right     (matches today's drawer)
                         Split down
                         Split left
                         Split up
```

Each leaf calls one of `setTileView(viewId)` or
`splitTileWithView(viewId, direction)`. Clicking the parent `View ▸
{viewId}` row directly uses `defaultSplit` from the registry (so
clicking `View ▸ State Explorer` matches today's drawer behaviour
without forcing the user into the sub-menu).

If Base UI's three-level submenu rendering proves janky in practice
we'll flatten the second level (e.g. `View ▸ State Explorer here` /
`View ▸ State Explorer (split right)` / …) — the registry-driven
generation makes this a one-line change.

### 3.8 State Explorer migration

Today the State Explorer is a right-drawer toggled from `EntityHeader`
(`router.tsx` 211-250). After the refactor the `Database` icon and
toggle disappear from `EntityHeader`; instead:

- "Open State Explorer" from the `…` menu calls
  `splitTileWithView('state-explorer', 'right')` — its default split
  direction matches today's drawer because we set
  `defaultSplit: 'right'` in its registration.
- Existing `<StateExplorerPanel>` is rendered unchanged inside
  `<StateExplorerView>` (a thin `ViewProps` wrapper) inside `TileBody`;
  we just remove the splitter / width state from the route component.

### 3.9 Persistence (light)

Save `Workspace` to `localStorage`
(`electric-agents-ui.workspace.v1`) on every change behind a 250 ms
debounce. Skip restoring tiles whose `entityUrl` no longer exists in
the live `entitiesCollection` (silent prune). Defer per-server-keyed
persistence to a follow-up.

### 3.10 Adding a future view ("Logs", say)

```tsx
// src/components/views/LogsView.tsx
export function LogsView({ entityUrl, baseUrl }: ViewProps) { … }

// src/lib/workspace/registerViews.ts
import { ScrollText } from 'lucide-react'
import { LogsView } from '../../components/views/LogsView'

registerView({
  id: 'logs',
  label: 'Logs',
  icon: ScrollText,
  description: 'Process and child-process logs',
  defaultSplit: 'down',
  Component: LogsView,
})
```

That's the entire diff. The view shows up in the `View ▸` submenu, in
the tab-strip's `+` "new view" picker, gets a deep-link
(`?view=logs`), and is draggable between groups — all for free.

---

## 4. Migration in stages

Ship in **5 small PRs** rather than one big bang, so each stage is
reviewable and we can stop at any of them with a working app.

| #   | Stage                                                                 | What ships                                                                                                                                                                                                                                                                                                                                     | What deletes                                                                                             |
| --- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 1   | **View registry + extract `ChatView` / `StateExplorerView`**          | `viewRegistry.tsx`, `ChatView.tsx`, `StateExplorerView.tsx`, registration. `EntityPage` still renders one view at a time, but goes through the registry. `?view=…` query-param deep-linking. State Explorer toggle in `EntityHeader` becomes "switch to State Explorer view" / "back to Chat" — already a ship-able UX improvement on its own. | –                                                                                                        |
| 2   | **Workspace skeleton + reducer**                                      | `lib/workspace/*` types + reducer + tests, `WorkspaceProvider`, `<Workspace />`. Single-tile by default; visually identical to stage 1. Active-tile URL sync (one-way: workspace → URL, with `push` vs `replace` rules from §3.4). Generic `<Splitter>`.                                                                                       | Bespoke `statePanelWidth` splitter in `router.tsx`.                                                      |
| 3   | **`SplitMenu` (Split Right/Down + hotkeys) and the `View ▸` submenu** | Power users can split, swap views in place, or split-with-view in one step. State Explorer regains its "drawer to the right" UX as the _default_ action of `View ▸ State Explorer` thanks to `defaultSplit: 'right'`.                                                                                                                          | Old `EntityHeader` State-Explorer button (already moved in stage 1; this fully removes the drawer mode). |
| 4   | **Drag-and-drop**                                                     | Sidebar rows + tabs draggable; 5-zone drop overlay; close tile/group; tab strip with click-to-activate + middle-click-to-close.                                                                                                                                                                                                                | –                                                                                                        |
| 5   | **Persistence + polish (incl. shareable layouts)**                    | localStorage workspace persistence (debounced, server-keyed, schema-versioned), layout DSL encoder/decoder + tests, `?layout=…` import + auto-strip, "Copy layout link" menu item, `⌘1..9` group focus, `⌘W` / `⇧⌘W`, prune-on-load, mobile fallback.                                                                                          | –                                                                                                        |

Each PR keeps the build green and ships value on its own.

---

## 5. Risks & open questions

1. **Performance with N tiles** — each tile mounts its own
   `useEntityTimeline`, which subscribes to a Durable Stream. With 4
   tiles on the same entity that's 4 subscriptions. _Mitigation:_ hoist
   the timeline subscription into a shared cache keyed by `entityUrl`
   (similar pattern to the existing `electricAgents` provider) so
   opening a second view of the same entity is free. Land this in
   stage 2 or 3.
2. **Deep-linking semantics** — _resolved by §3.4 hybrid strategy._
   External URL changes that target an entity already present in the
   workspace just refocus that tile; if the entity isn't present we
   add a tile to the active group rather than wiping the layout.
   `?layout=…` is the explicit "replace my layout with this" affordance.
3. **Nested submenu reliability** — Base UI `Menu` supports nested
   triggers, but the third level (`View ▸ State Explorer ▸ Split
right`) is unusual. If it feels janky on first build we'll flatten
   to two levels (`View ▸ State Explorer here / State Explorer split
right / State Explorer split down`). The registry-driven generation
   makes this a one-line change.
4. **Mobile / narrow viewports** — splits don't make sense below
   ~700 px. We'll degrade to "single active tile, tabs become a select
   dropdown" rather than try to make splits work on mobile.
5. **View IDs for sub-types** — should `chat` actually be
   `chat-coding-session` vs `chat-generic` (matching the current
   `CODING_SESSION_ENTITY_TYPE` branch in `router.tsx`), or keep one
   `chat` view that internally branches? **Decision:** one `chat` view,
   internally polymorphic — keeps the user-facing menu simple.
6. **Default opened view** — when a sidebar row is clicked, do we
   always open `chat`, or remember the last view used for that entity?
   VS Code remembers per-file. **Decision:** start with always-open-chat
   for simplicity; revisit once telemetry is in.
7. **Preview-tab semantics** — copy VS Code's "single click = preview
   tab that gets replaced; double-click = pin"? **Decision:** v1
   always replaces the active tile; preview-tab is a follow-up.
8. **Workspace persistence scope** — global, or per-server (sidebar
   already has `useServerConnection`)? **Decision:** start global;
   per-server is a follow-up.

---

## 6. Acceptance checklist

- [ ] Open two different agents side-by-side, each scrolling
      independently.
- [ ] Open the same agent's chat + state explorer side-by-side and
      they stay in sync.
- [ ] Drag a sidebar entity into the right edge of an existing group
      → new vertical split.
- [ ] Drag a tab from group A to group B → tile moves; group A is
      removed if empty.
- [ ] `⌘D` on focused tile splits it right; `⇧⌘D` splits down.
- [ ] `View ▸ State Explorer` (parent click) splits right; sub-items
      open in place / split in chosen direction.
- [ ] Switch view in place leaves the layout untouched (only the
      tile's `viewId` changes).
- [ ] Close the last tile → empty workspace shows `NewSessionPage`.
- [ ] Reload the page → previous layout is restored (skipping deleted
      entities).
- [ ] "Copy layout link" produces a `?layout=…` URL that, when opened
      in another browser/incognito, hydrates the same workspace and
      then strips the param so the address bar settles to the active
      tile.
- [ ] Resizing splitters or rearranging tiles does **not** create
      browser history entries; switching active tile **does**.
- [ ] Hotkeys `⌘1..9` focus group N; `⌘W` closes the active tile.
- [ ] No regressions in existing keyboard shortcuts (`⌘B` sidebar,
      `⌘K` palette, `⌘N` new session).
- [ ] Adding a new view requires only a `registerView({…})` call and
      a new `*View.tsx` file — no edits to `Workspace`, `SplitMenu`,
      or routing.
