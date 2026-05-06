import type { ViewId } from './viewRegistry'

/**
 * A `Tile` is a leaf in the workspace tree, rendered through one view.
 * Tiles do not group: each leaf is its own thing. Two tiles can show
 * the same entity through different views (chat + state-explorer
 * side-by-side); they're independent leaves.
 *
 * `entityUrl` is null for *standalone* tiles — currently the
 * "new-session" tile is the only example. Standalone tiles render a
 * view that doesn't depend on a specific entity (the view registry
 * marks them with `kind: 'standalone'`). Most reducer / codec /
 * persistence code paths care about identity (the tile's `id`) rather
 * than the entity URL, so the null is a small, contained change.
 *
 * The `id` is a stable nanoid that survives renders so React keying
 * and per-tile state (scroll position, etc.) is preserved across
 * re-orderings.
 */
export type Tile = {
  kind: `tile`
  id: string
  entityUrl: string | null
  viewId: ViewId
}

/**
 * Sentinel viewId for the standalone "new-session" tile. Lives here
 * (rather than in the registry file) so it can be referenced from
 * pure-data layers — the codec, the URL ↔ workspace sync, the
 * persistence prune — without dragging the registry's React imports
 * along.
 */
export const NEW_SESSION_VIEW_ID = `new-session`

/**
 * A `Split` is an internal node containing two or more children laid
 * out horizontally (side-by-side) or vertically (stacked). Each child
 * carries its own size as a fraction in [0, 1]; sizes across siblings
 * sum to ~1. Splits with one child are illegal — the reducer collapses
 * them on every mutation.
 */
export type Split = {
  kind: `split`
  id: string
  direction: `horizontal` | `vertical`
  children: Array<{ node: WorkspaceNode; size: number }>
}

export type WorkspaceNode = Split | Tile

/**
 * The full workspace state. `root === null` represents the empty
 * workspace (the new-session screen). `activeTileId` always points
 * at a tile that exists in the tree (or `null` when the workspace
 * is empty); reducer enforces this on every mutation.
 */
export type Workspace = {
  root: WorkspaceNode | null
  activeTileId: string | null
}

/** The empty workspace — the initial state on first load. */
export const EMPTY_WORKSPACE: Workspace = {
  root: null,
  activeTileId: null,
}

/**
 * Where to put a tile when opening or moving it.
 *
 * - `replace`     : take over the target tile's slot (used by URL
 *                   navigation and click-on-sidebar — the active tile
 *                   gets a new (entity, view)). Not exposed as a drop
 *                   zone.
 * - `split-{dir}` : create a new split with the new tile on the named
 *                   side of the target. The four drop edges.
 */
export type DropPosition =
  | `replace`
  | `split-right`
  | `split-down`
  | `split-left`
  | `split-up`

export type DropTarget = {
  /** The id of the tile being targeted. */
  tileId: string
  position: DropPosition
}

/** Convenience alias used by the menu / hotkeys. */
export type SplitDirection = `right` | `down` | `left` | `up`

export function dropPositionFromSplit(dir: SplitDirection): DropPosition {
  switch (dir) {
    case `right`:
      return `split-right`
    case `down`:
      return `split-down`
    case `left`:
      return `split-left`
    case `up`:
      return `split-up`
  }
}
