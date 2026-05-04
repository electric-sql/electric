import type { ViewId } from './viewRegistry'

/**
 * A `Tile` is the unit that gets rendered in a leaf area of the
 * workspace. It binds an entity to a view; the same entity can be open
 * in multiple tiles (e.g. chat + state-explorer side-by-side).
 *
 * The `id` is a stable nanoid that survives renders and lets us key
 * React state per-tile (so two splits of the same entity scroll
 * independently — see `tileId` in `ViewProps`).
 */
export type Tile = {
  id: string
  entityUrl: string
  viewId: ViewId
}

/**
 * A `Group` is a leaf node in the workspace tree. It holds one or more
 * tiles (the tab strip across the top of the group), with exactly one
 * marked active. An empty group is invalid — when the last tile is
 * closed the group itself is removed by the reducer.
 */
export type Group = {
  kind: `group`
  id: string
  tiles: Array<Tile>
  /** Must always reference an id from `tiles`; reducer enforces this. */
  activeTileId: string
}

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

export type WorkspaceNode = Split | Group

/**
 * The full workspace state. `root === null` represents the empty
 * workspace (the new-session screen). `activeGroupId` always points
 * at a group that exists in the tree (or `null` when the workspace
 * is empty); reducer enforces this on every mutation.
 */
export type Workspace = {
  root: WorkspaceNode | null
  activeGroupId: string | null
}

/** The empty workspace — the initial state on first load. */
export const EMPTY_WORKSPACE: Workspace = {
  root: null,
  activeGroupId: null,
}

/**
 * Where to put a tile when opening / moving it. `replace` and `append`
 * target an existing group; the four `split-*` directions create a new
 * sibling group on that side of the target.
 */
export type DropPosition =
  | `replace`
  | `append`
  | `split-right`
  | `split-down`
  | `split-left`
  | `split-up`

export type DropTarget = {
  groupId: string
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
