import { nanoid } from 'nanoid'
import { NEW_SESSION_VIEW_ID } from './types'
import type { DropTarget, Split, Tile, Workspace, WorkspaceNode } from './types'
import type { ViewId } from './viewRegistry'

// ---------------------------------------------------------------------------
// Pure reducer for the workspace tree. Every operation returns a *new*
// `Workspace` value — no in-place mutation — so `useReducer` can drive
// React updates by reference identity. The shape of the tree
// (Split → Tile, no groups) is enforced by the reducer's invariants:
//
// 1. A `Split` always has ≥2 children. After any mutation that could
//    leave it with 1 child, the split is unwrapped — its single child
//    takes the split's place in the parent.
// 2. `activeTileId` always references a tile present in the tree, or
//    `null` iff `root === null`.
// 3. Sibling sizes inside a `Split` are normalised so they sum to ~1.
// 4. Nested same-direction splits flatten: H(a, H(b, c)) → H(a, b, c).
// ---------------------------------------------------------------------------

export type WorkspaceAction =
  | {
      type: `open-tile`
      tile: { entityUrl: string | null; viewId: ViewId }
      target?: DropTarget
    }
  | {
      type: `open-new-session-tile`
      target?: DropTarget
    }
  | { type: `close-tile`; tileId: string }
  | { type: `move-tile`; tileId: string; target: DropTarget }
  | { type: `set-active-tile`; tileId: string }
  | { type: `set-tile-view`; tileId: string; viewId: ViewId }
  | {
      type: `split-tile-with-view`
      tileId: string
      viewId: ViewId
      direction: `right` | `down` | `left` | `up`
    }
  | {
      type: `resize-split`
      splitId: string
      sizes: Array<number>
    }
  | { type: `replace-workspace`; workspace: Workspace }

export function workspaceReducer(
  state: Workspace,
  action: WorkspaceAction
): Workspace {
  switch (action.type) {
    case `open-tile`:
      return openTile(state, action.tile, action.target)
    case `open-new-session-tile`:
      return openTile(
        state,
        { entityUrl: null, viewId: NEW_SESSION_VIEW_ID },
        action.target
      )
    case `close-tile`:
      return closeTile(state, action.tileId)
    case `move-tile`:
      return moveTile(state, action.tileId, action.target)
    case `set-active-tile`:
      return setActiveTile(state, action.tileId)
    case `set-tile-view`:
      return setTileView(state, action.tileId, action.viewId)
    case `split-tile-with-view`:
      return splitTileWithView(
        state,
        action.tileId,
        action.viewId,
        action.direction
      )
    case `resize-split`:
      return resizeSplit(state, action.splitId, action.sizes)
    case `replace-workspace`:
      return action.workspace
  }
}

// ---------------------------------------------------------------------------
// Public ID factories. Exposed so callers (DnD payloads, URL hydration)
// can mint ids before dispatching.
// ---------------------------------------------------------------------------

export function makeTileId(): string {
  return `tile_${nanoid(10)}`
}
export function makeSplitId(): string {
  return `spl_${nanoid(8)}`
}

export function makeTile(entityUrl: string | null, viewId: ViewId): Tile {
  return { kind: `tile`, id: makeTileId(), entityUrl, viewId }
}

/** Returns true iff the tile is a standalone (no entity attached). */
export function isStandaloneTile(tile: Tile): boolean {
  return tile.entityUrl === null
}

// ---------------------------------------------------------------------------
// Tree walkers (read-only). These traverse without copying so they're
// safe to call inside reducer cases for lookups.
// ---------------------------------------------------------------------------

export function findTile(
  node: WorkspaceNode | null,
  tileId: string
): Tile | null {
  if (node === null) return null
  if (node.kind === `tile`) return node.id === tileId ? node : null
  for (const child of node.children) {
    const found = findTile(child.node, tileId)
    if (found) return found
  }
  return null
}

export function listTiles(node: WorkspaceNode | null): Array<Tile> {
  if (node === null) return []
  if (node.kind === `tile`) return [node]
  return node.children.flatMap((c) => listTiles(c.node))
}

// ---------------------------------------------------------------------------
// Open tile
// ---------------------------------------------------------------------------

function openTile(
  state: Workspace,
  tile: { entityUrl: string | null; viewId: ViewId },
  target?: DropTarget
): Workspace {
  const newTile = makeTile(tile.entityUrl, tile.viewId)

  // Empty workspace → bootstrap with the new tile as the root.
  if (state.root === null) {
    return { root: newTile, activeTileId: newTile.id }
  }

  // No explicit target → default to replacing the active tile (URL
  // navigation / sidebar click semantics: "show this here").
  const targetTileId =
    target?.tileId ?? state.activeTileId ?? listTiles(state.root)[0]?.id ?? null
  if (targetTileId === null) return state

  const position = target?.position ?? `replace`
  const next = applyToTile(state, targetTileId, (existing) =>
    insertTileAt(existing, newTile, position)
  )
  // Focus follows opening: the freshly-created tile becomes active so
  // both replace ("show this here") and split ("drop into a quadrant")
  // give immediate visual + URL feedback. Mirrors VS Code's
  // drop-to-side behaviour. Guard against pathological inserts that
  // dropped the tile (e.g. target gone) by checking it actually
  // landed in the tree.
  if (findTile(next.root, newTile.id)) {
    return { ...next, activeTileId: newTile.id }
  }
  return next
}

/**
 * Apply a transformation to a target tile inside the tree. The
 * transformation receives the existing tile and returns a replacement
 * subtree (Tile, Split, or `null` to delete the tile entirely).
 *
 * Walks back up the tree normalising splits (collapse single-child,
 * keep sibling sizes summing to ~1).
 */
function applyToTile(
  state: Workspace,
  tileId: string,
  fn: (tile: Tile) => WorkspaceNode | null
): Workspace {
  if (state.root === null) return state
  const replaced = replaceTileInTree(state.root, tileId, fn)
  return finaliseWorkspace(state, replaced)
}

function replaceTileInTree(
  node: WorkspaceNode,
  tileId: string,
  fn: (tile: Tile) => WorkspaceNode | null
): WorkspaceNode | null {
  if (node.kind === `tile`) {
    if (node.id !== tileId) return node
    return fn(node)
  }
  const newChildren: Split[`children`] = []
  let changed = false
  for (const child of node.children) {
    const replacement = replaceTileInTree(child.node, tileId, fn)
    if (replacement !== child.node) changed = true
    if (replacement !== null) {
      newChildren.push({ node: replacement, size: child.size })
    } else {
      changed = true
    }
  }
  if (!changed) return node
  return collapseSplit({ ...node, children: newChildren })
}

/**
 * Place `incoming` at the named position relative to the existing
 * `target` tile. Returns the subtree that should sit in the parent's
 * slot — either the incoming tile alone (replace) or a fresh split
 * wrapping both.
 */
function insertTileAt(
  target: Tile,
  incoming: Tile,
  position: DropTarget[`position`]
): WorkspaceNode {
  if (position === `replace`) return incoming
  return wrapInSplit(target, incoming, position)
}

function wrapInSplit(
  existing: WorkspaceNode,
  incoming: WorkspaceNode,
  position: `split-right` | `split-down` | `split-left` | `split-up`
): Split {
  const direction: Split[`direction`] =
    position === `split-right` || position === `split-left`
      ? `horizontal`
      : `vertical`
  const incomingFirst = position === `split-left` || position === `split-up`
  const children: Split[`children`] = incomingFirst
    ? [
        { node: incoming, size: 0.5 },
        { node: existing, size: 0.5 },
      ]
    : [
        { node: existing, size: 0.5 },
        { node: incoming, size: 0.5 },
      ]
  return {
    kind: `split`,
    id: makeSplitId(),
    direction,
    children,
  }
}

// ---------------------------------------------------------------------------
// Close tile
// ---------------------------------------------------------------------------

function closeTile(state: Workspace, tileId: string): Workspace {
  if (state.root === null) return state
  // Sole tile → workspace becomes empty.
  if (state.root.kind === `tile` && state.root.id === tileId) {
    return { root: null, activeTileId: null }
  }
  return applyToTile(state, tileId, () => null)
}

// ---------------------------------------------------------------------------
// Move tile (drag-and-drop primitive)
// ---------------------------------------------------------------------------

function moveTile(
  state: Workspace,
  tileId: string,
  target: DropTarget
): Workspace {
  if (state.root === null) return state
  if (tileId === target.tileId) return state // dropping on self
  const tile = findTile(state.root, tileId)
  if (!tile) return state

  // Detach the tile from its source first.
  const detached = closeTile(state, tileId)
  // The target tile may have collapsed into a different parent during
  // detach, but its id is stable so we can still find it.
  if (!findTile(detached.root, target.tileId)) {
    // Target gone — fall back to inserting at the root so we never
    // silently drop a tile.
    if (detached.root === null) {
      return { root: tile, activeTileId: tile.id }
    }
    return detached
  }
  return applyToTile(detached, target.tileId, (existing) =>
    insertTileAt(existing, tile, target.position)
  )
}

// ---------------------------------------------------------------------------
// Set active tile / view
// ---------------------------------------------------------------------------

function setActiveTile(state: Workspace, tileId: string): Workspace {
  if (state.activeTileId === tileId) return state
  if (!findTile(state.root, tileId)) return state
  return { ...state, activeTileId: tileId }
}

function setTileView(
  state: Workspace,
  tileId: string,
  viewId: ViewId
): Workspace {
  return applyToTile(state, tileId, (tile) =>
    tile.viewId === viewId ? tile : { ...tile, viewId }
  )
}

function splitTileWithView(
  state: Workspace,
  tileId: string,
  viewId: ViewId,
  direction: `right` | `down` | `left` | `up`
): Workspace {
  const tile = findTile(state.root, tileId)
  if (!tile) return state
  const newTile = makeTile(tile.entityUrl, viewId)
  const next = applyToTile(state, tileId, (existing) =>
    wrapInSplit(existing, newTile, `split-${direction}`)
  )
  // Focus follows split.
  return { ...next, activeTileId: newTile.id }
}

// ---------------------------------------------------------------------------
// Resize split
// ---------------------------------------------------------------------------

function resizeSplit(
  state: Workspace,
  splitId: string,
  sizes: Array<number>
): Workspace {
  if (state.root === null) return state
  const updated = updateSplitInTree(state.root, splitId, sizes)
  return updated === state.root ? state : { ...state, root: updated }
}

function updateSplitInTree(
  node: WorkspaceNode,
  splitId: string,
  sizes: Array<number>
): WorkspaceNode {
  if (node.kind === `tile`) return node
  if (node.id === splitId) {
    if (node.children.length !== sizes.length) return node
    const total = sizes.reduce((a, b) => a + b, 0)
    if (total <= 0) return node
    return {
      ...node,
      children: node.children.map((child, i) => ({
        ...child,
        size: sizes[i] / total,
      })),
    }
  }
  let changed = false
  const newChildren = node.children.map((child) => {
    const replacement = updateSplitInTree(child.node, splitId, sizes)
    if (replacement !== child.node) {
      changed = true
      return { ...child, node: replacement }
    }
    return child
  })
  return changed ? { ...node, children: newChildren } : node
}

// ---------------------------------------------------------------------------
// Tree normalisation helpers
// ---------------------------------------------------------------------------

/**
 * Collapse a split with ≤1 child:
 * - 0 children → returns `null` (caller removes from parent).
 * - 1 child   → returns that child directly (the split disappears).
 * - 2+        → normalises sibling sizes so they sum to 1.
 *
 * Also flattens nested splits with matching directions:
 * `H(a, H(b, c))` → `H(a, b, c)`. This keeps the tree shallow and
 * the splitter UI predictable.
 */
function collapseSplit(split: Split): WorkspaceNode | null {
  if (split.children.length === 0) return null
  if (split.children.length === 1) return split.children[0].node

  // Flatten nested same-direction splits.
  const flat: Split[`children`] = []
  for (const child of split.children) {
    if (
      child.node.kind === `split` &&
      child.node.direction === split.direction
    ) {
      const inner = child.node
      const innerTotal = inner.children.reduce((a, c) => a + c.size, 0)
      for (const grand of inner.children) {
        flat.push({
          node: grand.node,
          size: child.size * (grand.size / (innerTotal || 1)),
        })
      }
    } else {
      flat.push(child)
    }
  }

  const total = flat.reduce((a, c) => a + c.size, 0)
  const normalised: Split[`children`] = flat.map((c) => ({
    ...c,
    size: total > 0 ? c.size / total : 1 / flat.length,
  }))
  return { ...split, children: normalised }
}

/**
 * After a structural mutation, fix up `activeTileId` to ensure it
 * points at a tile that still exists. Picks the first remaining tile
 * (tree order) if the previous active was removed.
 */
function finaliseWorkspace(
  prev: Workspace,
  newRoot: WorkspaceNode | null
): Workspace {
  if (newRoot === null) {
    return { root: null, activeTileId: null }
  }
  const tiles = listTiles(newRoot)
  const stillThere =
    prev.activeTileId !== null && tiles.some((t) => t.id === prev.activeTileId)
  return {
    root: newRoot,
    activeTileId: stillThere ? prev.activeTileId : tiles[0].id,
  }
}
