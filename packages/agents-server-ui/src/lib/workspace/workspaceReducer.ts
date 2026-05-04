import { nanoid } from 'nanoid'
import type {
  DropTarget,
  Group,
  Split,
  Tile,
  Workspace,
  WorkspaceNode,
} from './types'
import type { ViewId } from './viewRegistry'

// ---------------------------------------------------------------------------
// Pure reducer for the workspace tree. Every operation returns a *new*
// `Workspace` value — no in-place mutation — so `useReducer` can drive
// React updates by reference identity. The shape of the tree
// (Split → Group → Tile) is enforced by the reducer's invariants:
//
// 1. A `Split` always has ≥2 children. After any mutation that could
//    leave it with 1 child, the split is unwrapped — its single child
//    takes the split's place in the parent.
// 2. A `Group` always has ≥1 tile. After any mutation that could leave
//    it empty, the group is removed; its parent split unwraps too if
//    that drops it to 1 child.
// 3. `activeGroupId` always references a group present in the tree, or
//    `null` iff `root === null`.
// 4. Sibling sizes inside a `Split` are normalised so they sum to ~1.
// ---------------------------------------------------------------------------

export type WorkspaceAction =
  | {
      type: `open-tile`
      tile: { entityUrl: string; viewId: ViewId }
      target?: DropTarget
    }
  | { type: `close-tile`; tileId: string }
  | { type: `move-tile`; tileId: string; target: DropTarget }
  | { type: `set-active-tile`; tileId: string }
  | { type: `set-active-group`; groupId: string }
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
    case `close-tile`:
      return closeTile(state, action.tileId)
    case `move-tile`:
      return moveTile(state, action.tileId, action.target)
    case `set-active-tile`:
      return setActiveTile(state, action.tileId)
    case `set-active-group`:
      return state.activeGroupId === action.groupId
        ? state
        : { ...state, activeGroupId: action.groupId }
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
export function makeGroupId(): string {
  return `grp_${nanoid(8)}`
}
export function makeSplitId(): string {
  return `spl_${nanoid(8)}`
}

export function makeTile(entityUrl: string, viewId: ViewId): Tile {
  return { id: makeTileId(), entityUrl, viewId }
}

// ---------------------------------------------------------------------------
// Tree walkers (read-only). These traverse without copying so they're
// safe to call inside reducer cases for lookups.
// ---------------------------------------------------------------------------

export function findGroup(
  node: WorkspaceNode | null,
  groupId: string
): Group | null {
  if (node === null) return null
  if (node.kind === `group`) return node.id === groupId ? node : null
  for (const child of node.children) {
    const found = findGroup(child.node, groupId)
    if (found) return found
  }
  return null
}

export function findGroupContainingTile(
  node: WorkspaceNode | null,
  tileId: string
): Group | null {
  if (node === null) return null
  if (node.kind === `group`) {
    return node.tiles.some((t) => t.id === tileId) ? node : null
  }
  for (const child of node.children) {
    const found = findGroupContainingTile(child.node, tileId)
    if (found) return found
  }
  return null
}

export function findTile(
  node: WorkspaceNode | null,
  tileId: string
): Tile | null {
  const group = findGroupContainingTile(node, tileId)
  return group?.tiles.find((t) => t.id === tileId) ?? null
}

export function listGroups(node: WorkspaceNode | null): Array<Group> {
  if (node === null) return []
  if (node.kind === `group`) return [node]
  return node.children.flatMap((c) => listGroups(c.node))
}

// ---------------------------------------------------------------------------
// Open tile
// ---------------------------------------------------------------------------

function openTile(
  state: Workspace,
  tile: { entityUrl: string; viewId: ViewId },
  target?: DropTarget
): Workspace {
  const newTile = makeTile(tile.entityUrl, tile.viewId)

  // Empty workspace → bootstrap a single group with the new tile.
  if (state.root === null) {
    const group: Group = {
      kind: `group`,
      id: makeGroupId(),
      tiles: [newTile],
      activeTileId: newTile.id,
    }
    return { root: group, activeGroupId: group.id }
  }

  // No explicit target → default to the active group. Fall back to the
  // first group in the tree if `activeGroupId` is somehow stale.
  const targetGroupId =
    target?.groupId ??
    state.activeGroupId ??
    listGroups(state.root)[0]?.id ??
    null
  if (targetGroupId === null) return state

  const position = target?.position ?? `replace`
  return applyToGroup(state, targetGroupId, (group) =>
    insertTileIntoGroup(group, newTile, position)
  )
}

/**
 * Apply a transformation to a target group inside the tree. The
 * transformation receives the existing group and returns a replacement
 * subtree (Group, Split, or `null` to delete the group entirely).
 *
 * Walks back up the tree normalising splits (collapse single-child,
 * keep sibling sizes summing to ~1).
 */
function applyToGroup(
  state: Workspace,
  groupId: string,
  fn: (group: Group) => WorkspaceNode | null
): Workspace {
  if (state.root === null) return state
  const replaced = replaceGroupInTree(state.root, groupId, fn)
  return finaliseWorkspace(state, replaced)
}

function replaceGroupInTree(
  node: WorkspaceNode,
  groupId: string,
  fn: (group: Group) => WorkspaceNode | null
): WorkspaceNode | null {
  if (node.kind === `group`) {
    if (node.id !== groupId) return node
    return fn(node)
  }
  const newChildren: Split[`children`] = []
  let changed = false
  for (const child of node.children) {
    const replacement = replaceGroupInTree(child.node, groupId, fn)
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
 * Insert / replace / split. Returns the new subtree that should sit in
 * the parent's slot — either the same group (mutated tiles), the same
 * group + a sibling under a new split, or just a different group.
 */
function insertTileIntoGroup(
  group: Group,
  tile: Tile,
  position: DropTarget[`position`]
): WorkspaceNode {
  switch (position) {
    case `append`: {
      // Add as a new tab in the strip; activate it.
      return {
        ...group,
        tiles: [...group.tiles, tile],
        activeTileId: tile.id,
      }
    }
    case `replace`: {
      // Replace the active tile in place. If there's only one tile this
      // is the same as `append` semantically.
      const newTiles = group.tiles.map((t) =>
        t.id === group.activeTileId ? tile : t
      )
      return {
        ...group,
        tiles: newTiles,
        activeTileId: tile.id,
      }
    }
    case `split-right`:
    case `split-down`:
    case `split-left`:
    case `split-up`: {
      const newGroup: Group = {
        kind: `group`,
        id: makeGroupId(),
        tiles: [tile],
        activeTileId: tile.id,
      }
      return wrapInSplit(group, newGroup, position)
    }
  }
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
  const group = findGroupContainingTile(state.root, tileId)
  if (!group) return state
  if (group.tiles.length === 1) {
    // Closing the last tile removes the group entirely.
    return applyToGroup(state, group.id, () => null)
  }
  // Otherwise drop the tile and pick the next-best active.
  const tileIndex = group.tiles.findIndex((t) => t.id === tileId)
  const newTiles = group.tiles.filter((t) => t.id !== tileId)
  const wasActive = group.activeTileId === tileId
  const nextActiveId = wasActive
    ? (newTiles[Math.max(0, tileIndex - 1)] ?? newTiles[0]).id
    : group.activeTileId
  return applyToGroup(state, group.id, (g) => ({
    ...g,
    tiles: newTiles,
    activeTileId: nextActiveId,
  }))
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
  const sourceGroup = findGroupContainingTile(state.root, tileId)
  if (!sourceGroup) return state
  const tile = sourceGroup.tiles.find((t) => t.id === tileId)
  if (!tile) return state

  // No-op self-move (drop on the same group with the same tile and
  // position 'append' or 'replace' on the active tile).
  if (
    sourceGroup.id === target.groupId &&
    sourceGroup.tiles.length === 1 &&
    (target.position === `append` || target.position === `replace`)
  ) {
    return state
  }

  // Detach the tile from its source first.
  const detached = closeTile(state, tileId)
  // Re-find the target group in the post-detach tree (the source group
  // may have collapsed if `tileId` was its last tile).
  const targetGroupExists = findGroup(detached.root, target.groupId) !== null
  if (!targetGroupExists) {
    // Target collapsed during detach — re-insert as a fresh single-tile
    // group at the root to avoid losing the tile.
    if (detached.root === null) {
      const group: Group = {
        kind: `group`,
        id: makeGroupId(),
        tiles: [tile],
        activeTileId: tile.id,
      }
      return { root: group, activeGroupId: group.id }
    }
    return detached
  }
  return applyToGroup(detached, target.groupId, (group) =>
    insertTileIntoGroup(group, tile, target.position)
  )
}

// ---------------------------------------------------------------------------
// Set active tile / group / view
// ---------------------------------------------------------------------------

function setActiveTile(state: Workspace, tileId: string): Workspace {
  if (state.root === null) return state
  const group = findGroupContainingTile(state.root, tileId)
  if (!group) return state
  if (group.activeTileId === tileId && state.activeGroupId === group.id) {
    return state
  }
  return applyToGroup({ ...state, activeGroupId: group.id }, group.id, (g) => ({
    ...g,
    activeTileId: tileId,
  }))
}

function setTileView(
  state: Workspace,
  tileId: string,
  viewId: ViewId
): Workspace {
  if (state.root === null) return state
  const group = findGroupContainingTile(state.root, tileId)
  if (!group) return state
  return applyToGroup(state, group.id, (g) => ({
    ...g,
    tiles: g.tiles.map((t) => (t.id === tileId ? { ...t, viewId } : t)),
  }))
}

function splitTileWithView(
  state: Workspace,
  tileId: string,
  viewId: ViewId,
  direction: `right` | `down` | `left` | `up`
): Workspace {
  const tile = findTile(state.root, tileId)
  if (!tile) return state
  const group = findGroupContainingTile(state.root, tileId)
  if (!group) return state
  const newTile = makeTile(tile.entityUrl, viewId)
  const next = applyToGroup(state, group.id, (g) =>
    insertTileIntoGroup(g, newTile, `split-${direction}`)
  )
  // The new tile's group is whatever the latest open created.
  const newGroup = findGroupContainingTile(next.root, newTile.id)
  return newGroup ? { ...next, activeGroupId: newGroup.id } : next
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
  if (node.kind === `group`) return node
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
      // Distribute this child's `size` across its grandchildren proportionally.
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
 * After a structural mutation, fix up `activeGroupId` to ensure it
 * points at a group that still exists. Picks the first remaining group
 * if the previous active was removed.
 */
function finaliseWorkspace(
  prev: Workspace,
  newRoot: WorkspaceNode | null
): Workspace {
  if (newRoot === null) {
    return { root: null, activeGroupId: null }
  }
  const groups = listGroups(newRoot)
  const stillThere =
    prev.activeGroupId !== null &&
    groups.some((g) => g.id === prev.activeGroupId)
  return {
    root: newRoot,
    activeGroupId: stillThere ? prev.activeGroupId : groups[0].id,
  }
}
