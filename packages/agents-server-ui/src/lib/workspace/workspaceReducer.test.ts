import { describe, expect, it } from 'vitest'
import { findTile, listTiles, workspaceReducer } from './workspaceReducer'
import { EMPTY_WORKSPACE } from './types'
import type { Split, Tile, Workspace } from './types'

function run(
  initial: Workspace,
  ...actions: Array<Parameters<typeof workspaceReducer>[1]>
): Workspace {
  return actions.reduce(workspaceReducer, initial)
}

function rootAsTile(ws: Workspace): Tile {
  expect(ws.root?.kind).toBe(`tile`)
  return ws.root as Tile
}

function rootAsSplit(ws: Workspace): Split {
  expect(ws.root?.kind).toBe(`split`)
  return ws.root as Split
}

describe(`workspaceReducer`, () => {
  describe(`open-tile`, () => {
    it(`bootstraps an empty workspace into a single root tile`, () => {
      const ws = run(EMPTY_WORKSPACE, {
        type: `open-tile`,
        tile: { entityUrl: `/horton/foo`, viewId: `chat` },
      })
      const tile = rootAsTile(ws)
      expect(tile.entityUrl).toBe(`/horton/foo`)
      expect(tile.viewId).toBe(`chat`)
      expect(ws.activeTileId).toBe(tile.id)
    })

    it(`with no target replaces the active tile in place`, () => {
      const after1 = run(EMPTY_WORKSPACE, {
        type: `open-tile`,
        tile: { entityUrl: `/horton/foo`, viewId: `chat` },
      })
      const ws = workspaceReducer(after1, {
        type: `open-tile`,
        tile: { entityUrl: `/horton/bar`, viewId: `chat` },
      })
      const tile = rootAsTile(ws)
      expect(tile.entityUrl).toBe(`/horton/bar`)
      expect(ws.activeTileId).toBe(tile.id)
      expect(listTiles(ws.root)).toHaveLength(1)
    })

    it(`split-right wraps the existing tile in a horizontal split`, () => {
      const after1 = run(EMPTY_WORKSPACE, {
        type: `open-tile`,
        tile: { entityUrl: `/horton/foo`, viewId: `chat` },
      })
      const fooId = rootAsTile(after1).id
      const ws = workspaceReducer(after1, {
        type: `open-tile`,
        tile: { entityUrl: `/horton/bar`, viewId: `chat` },
        target: { tileId: fooId, position: `split-right` },
      })
      const split = rootAsSplit(ws)
      expect(split.direction).toBe(`horizontal`)
      expect(split.children).toHaveLength(2)
      expect(split.children[0].size + split.children[1].size).toBeCloseTo(1)
      const right = split.children[1].node as Tile
      expect(right.entityUrl).toBe(`/horton/bar`)
    })

    it(`split-up places the new tile above the existing one`, () => {
      const after1 = run(EMPTY_WORKSPACE, {
        type: `open-tile`,
        tile: { entityUrl: `/horton/foo`, viewId: `chat` },
      })
      const fooId = rootAsTile(after1).id
      const ws = workspaceReducer(after1, {
        type: `open-tile`,
        tile: { entityUrl: `/horton/bar`, viewId: `chat` },
        target: { tileId: fooId, position: `split-up` },
      })
      const split = rootAsSplit(ws)
      expect(split.direction).toBe(`vertical`)
      const top = split.children[0].node as Tile
      expect(top.entityUrl).toBe(`/horton/bar`)
    })
  })

  describe(`close-tile`, () => {
    it(`closing the only tile empties the workspace`, () => {
      const ws0 = run(EMPTY_WORKSPACE, {
        type: `open-tile`,
        tile: { entityUrl: `/horton/foo`, viewId: `chat` },
      })
      const tileId = rootAsTile(ws0).id
      const ws = workspaceReducer(ws0, { type: `close-tile`, tileId })
      expect(ws.root).toBeNull()
      expect(ws.activeTileId).toBeNull()
    })

    it(`closing one tile in a 2-tile split unwraps the split`, () => {
      let ws = run(EMPTY_WORKSPACE, {
        type: `open-tile`,
        tile: { entityUrl: `/horton/foo`, viewId: `chat` },
      })
      const fooId = rootAsTile(ws).id
      ws = workspaceReducer(ws, {
        type: `open-tile`,
        tile: { entityUrl: `/horton/bar`, viewId: `chat` },
        target: { tileId: fooId, position: `split-right` },
      })
      const barId = listTiles(ws.root).find(
        (t) => t.entityUrl === `/horton/bar`
      )!.id
      ws = workspaceReducer(ws, { type: `close-tile`, tileId: barId })
      const remaining = rootAsTile(ws)
      expect(remaining.entityUrl).toBe(`/horton/foo`)
    })

    it(`reassigns activeTileId when the active tile is closed`, () => {
      let ws = run(EMPTY_WORKSPACE, {
        type: `open-tile`,
        tile: { entityUrl: `/horton/foo`, viewId: `chat` },
      })
      const fooId = rootAsTile(ws).id
      ws = workspaceReducer(ws, {
        type: `open-tile`,
        tile: { entityUrl: `/horton/bar`, viewId: `chat` },
        target: { tileId: fooId, position: `split-right` },
      })
      // Make foo active explicitly, then close foo.
      ws = workspaceReducer(ws, { type: `set-active-tile`, tileId: fooId })
      ws = workspaceReducer(ws, { type: `close-tile`, tileId: fooId })
      expect(ws.activeTileId).not.toBeNull()
      const remaining = rootAsTile(ws)
      expect(ws.activeTileId).toBe(remaining.id)
    })
  })

  describe(`move-tile`, () => {
    it(`moves a tile to the other side of an existing tile`, () => {
      let ws = run(EMPTY_WORKSPACE, {
        type: `open-tile`,
        tile: { entityUrl: `/horton/foo`, viewId: `chat` },
      })
      const fooId = rootAsTile(ws).id
      ws = workspaceReducer(ws, {
        type: `open-tile`,
        tile: { entityUrl: `/horton/bar`, viewId: `chat` },
        target: { tileId: fooId, position: `split-right` },
      })
      ws = workspaceReducer(ws, {
        type: `open-tile`,
        tile: { entityUrl: `/horton/baz`, viewId: `chat` },
        target: { tileId: fooId, position: `split-down` },
      })
      // Now move baz to the right of foo.
      const bazId = listTiles(ws.root).find(
        (t) => t.entityUrl === `/horton/baz`
      )!.id
      ws = workspaceReducer(ws, {
        type: `move-tile`,
        tileId: bazId,
        target: { tileId: fooId, position: `split-right` },
      })
      // Tile structure changed but baz still present.
      expect(findTile(ws.root, bazId)).not.toBeNull()
      expect(listTiles(ws.root)).toHaveLength(3)
    })

    it(`drops on self are no-ops`, () => {
      let ws = run(EMPTY_WORKSPACE, {
        type: `open-tile`,
        tile: { entityUrl: `/horton/foo`, viewId: `chat` },
      })
      const tileId = rootAsTile(ws).id
      const before = ws
      ws = workspaceReducer(ws, {
        type: `move-tile`,
        tileId,
        target: { tileId, position: `split-right` },
      })
      expect(ws).toBe(before)
    })
  })

  describe(`set-tile-view`, () => {
    it(`swaps the view in place without changing layout`, () => {
      let ws = run(EMPTY_WORKSPACE, {
        type: `open-tile`,
        tile: { entityUrl: `/horton/foo`, viewId: `chat` },
      })
      const tileId = rootAsTile(ws).id
      ws = workspaceReducer(ws, {
        type: `set-tile-view`,
        tileId,
        viewId: `state-explorer`,
      })
      const tile = rootAsTile(ws)
      // Same tile id (state preserved across view swap).
      expect(tile.id).toBe(tileId)
      expect(tile.viewId).toBe(`state-explorer`)
    })
  })

  describe(`split-tile-with-view`, () => {
    it(`opens a different view of the same entity in a new split`, () => {
      let ws = run(EMPTY_WORKSPACE, {
        type: `open-tile`,
        tile: { entityUrl: `/horton/foo`, viewId: `chat` },
      })
      const tileId = rootAsTile(ws).id
      ws = workspaceReducer(ws, {
        type: `split-tile-with-view`,
        tileId,
        viewId: `state-explorer`,
        direction: `right`,
      })
      const tiles = listTiles(ws.root)
      expect(tiles).toHaveLength(2)
      const states = tiles.map((t) => ({
        entityUrl: t.entityUrl,
        viewId: t.viewId,
      }))
      expect(states).toContainEqual({
        entityUrl: `/horton/foo`,
        viewId: `chat`,
      })
      expect(states).toContainEqual({
        entityUrl: `/horton/foo`,
        viewId: `state-explorer`,
      })
      // Active follows the new tile.
      const activeTile = findTile(ws.root, ws.activeTileId!)
      expect(activeTile?.viewId).toBe(`state-explorer`)
    })
  })

  describe(`resize-split`, () => {
    it(`normalises sizes to sum to 1`, () => {
      let ws = run(EMPTY_WORKSPACE, {
        type: `open-tile`,
        tile: { entityUrl: `/horton/foo`, viewId: `chat` },
      })
      const fooId = rootAsTile(ws).id
      ws = workspaceReducer(ws, {
        type: `open-tile`,
        tile: { entityUrl: `/horton/bar`, viewId: `chat` },
        target: { tileId: fooId, position: `split-right` },
      })
      const split = rootAsSplit(ws)
      ws = workspaceReducer(ws, {
        type: `resize-split`,
        splitId: split.id,
        sizes: [3, 1],
      })
      const next = rootAsSplit(ws)
      expect(next.children[0].size).toBeCloseTo(0.75)
      expect(next.children[1].size).toBeCloseTo(0.25)
    })
  })

  describe(`open-new-session-tile`, () => {
    it(`bootstraps an empty workspace into a standalone new-session tile`, () => {
      const ws = run(EMPTY_WORKSPACE, { type: `open-new-session-tile` })
      const tile = rootAsTile(ws)
      expect(tile.entityUrl).toBeNull()
      expect(tile.viewId).toBe(`new-session`)
      expect(ws.activeTileId).toBe(tile.id)
    })

    it(`replaces the active entity tile when no target is given`, () => {
      let ws = run(EMPTY_WORKSPACE, {
        type: `open-tile`,
        tile: { entityUrl: `/horton/foo`, viewId: `chat` },
      })
      ws = workspaceReducer(ws, { type: `open-new-session-tile` })
      const tile = rootAsTile(ws)
      expect(tile.entityUrl).toBeNull()
      expect(listTiles(ws.root)).toHaveLength(1)
    })

    it(`opens a standalone tile in a split when given a target`, () => {
      let ws = run(EMPTY_WORKSPACE, {
        type: `open-tile`,
        tile: { entityUrl: `/horton/foo`, viewId: `chat` },
      })
      const fooId = rootAsTile(ws).id
      ws = workspaceReducer(ws, {
        type: `open-new-session-tile`,
        target: { tileId: fooId, position: `split-right` },
      })
      const split = rootAsSplit(ws)
      expect(split.direction).toBe(`horizontal`)
      const right = split.children[1].node as Tile
      expect(right.entityUrl).toBeNull()
      expect(right.viewId).toBe(`new-session`)
      // Focus follows the freshly-dropped tile so the user sees the
      // placeholder they just placed (matches drop-to-side semantics
      // in VS Code).
      expect(ws.activeTileId).toBe(right.id)
    })

    it(`allows multiple new-session tiles in the same workspace`, () => {
      let ws = run(EMPTY_WORKSPACE, { type: `open-new-session-tile` })
      const firstId = rootAsTile(ws).id
      ws = workspaceReducer(ws, {
        type: `open-new-session-tile`,
        target: { tileId: firstId, position: `split-right` },
      })
      const tiles = listTiles(ws.root)
      expect(tiles).toHaveLength(2)
      expect(tiles.every((t) => t.entityUrl === null)).toBe(true)
      expect(tiles.every((t) => t.viewId === `new-session`)).toBe(true)
    })
  })

  describe(`flattening`, () => {
    it(`flattens nested same-direction splits`, () => {
      // Build H(foo, bar), then split foo-right with baz → should
      // produce H(foo, baz, bar) with no nested H.
      let ws = run(EMPTY_WORKSPACE, {
        type: `open-tile`,
        tile: { entityUrl: `/horton/foo`, viewId: `chat` },
      })
      const fooId = rootAsTile(ws).id
      ws = workspaceReducer(ws, {
        type: `open-tile`,
        tile: { entityUrl: `/horton/bar`, viewId: `chat` },
        target: { tileId: fooId, position: `split-right` },
      })
      ws = workspaceReducer(ws, {
        type: `open-tile`,
        tile: { entityUrl: `/horton/baz`, viewId: `chat` },
        target: { tileId: fooId, position: `split-right` },
      })
      const split = rootAsSplit(ws)
      expect(split.direction).toBe(`horizontal`)
      expect(split.children).toHaveLength(3)
      expect(split.children.every((c) => c.node.kind === `tile`)).toBe(true)
    })
  })
})
