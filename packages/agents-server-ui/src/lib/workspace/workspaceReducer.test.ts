import { describe, expect, it } from 'vitest'
import {
  findGroupContainingTile,
  findTile,
  listGroups,
  workspaceReducer,
} from './workspaceReducer'
import { EMPTY_WORKSPACE } from './types'
import type { Workspace } from './types'

// ---------------------------------------------------------------------------
// Tiny driver — applies a sequence of actions in order so each test reads
// like a script of user steps. Returns the final workspace.
// ---------------------------------------------------------------------------

function run(
  initial: Workspace,
  ...actions: Array<Parameters<typeof workspaceReducer>[1]>
): Workspace {
  return actions.reduce(workspaceReducer, initial)
}

describe(`workspaceReducer`, () => {
  describe(`open-tile`, () => {
    it(`bootstraps an empty workspace into a single-tile single-group`, () => {
      const ws = run(EMPTY_WORKSPACE, {
        type: `open-tile`,
        tile: { entityUrl: `/horton/foo`, viewId: `chat` },
      })
      expect(ws.root).not.toBeNull()
      expect(ws.root!.kind).toBe(`group`)
      expect(ws.activeGroupId).toBe(ws.root!.id)
      const group = ws.root as Extract<typeof ws.root, { kind: `group` }>
      expect(group.tiles).toHaveLength(1)
      expect(group.tiles[0].entityUrl).toBe(`/horton/foo`)
      expect(group.tiles[0].viewId).toBe(`chat`)
      expect(group.activeTileId).toBe(group.tiles[0].id)
    })

    it(`with no target opens into the active group, replacing the active tile`, () => {
      const after1 = run(EMPTY_WORKSPACE, {
        type: `open-tile`,
        tile: { entityUrl: `/horton/foo`, viewId: `chat` },
      })
      const ws = workspaceReducer(after1, {
        type: `open-tile`,
        tile: { entityUrl: `/horton/bar`, viewId: `chat` },
      })
      expect(listGroups(ws.root)).toHaveLength(1)
      const group = listGroups(ws.root)[0]
      expect(group.tiles).toHaveLength(1)
      expect(group.tiles[0].entityUrl).toBe(`/horton/bar`)
    })

    it(`with append target adds a new tab and activates it`, () => {
      const after1 = run(EMPTY_WORKSPACE, {
        type: `open-tile`,
        tile: { entityUrl: `/horton/foo`, viewId: `chat` },
      })
      const groupId = listGroups(after1.root)[0].id
      const ws = workspaceReducer(after1, {
        type: `open-tile`,
        tile: { entityUrl: `/horton/bar`, viewId: `chat` },
        target: { groupId, position: `append` },
      })
      const group = listGroups(ws.root)[0]
      expect(group.tiles).toHaveLength(2)
      expect(group.tiles[1].entityUrl).toBe(`/horton/bar`)
      expect(group.activeTileId).toBe(group.tiles[1].id)
    })

    it(`split-right wraps the existing group in a horizontal split`, () => {
      const after1 = run(EMPTY_WORKSPACE, {
        type: `open-tile`,
        tile: { entityUrl: `/horton/foo`, viewId: `chat` },
      })
      const groupId = listGroups(after1.root)[0].id
      const ws = workspaceReducer(after1, {
        type: `open-tile`,
        tile: { entityUrl: `/horton/bar`, viewId: `chat` },
        target: { groupId, position: `split-right` },
      })
      expect(ws.root!.kind).toBe(`split`)
      const split = ws.root as Extract<typeof ws.root, { kind: `split` }>
      expect(split.direction).toBe(`horizontal`)
      expect(split.children).toHaveLength(2)
      expect(split.children[0].size + split.children[1].size).toBeCloseTo(1)
      // The new tile sits on the right of the existing one.
      const right = split.children[1].node as Extract<
        (typeof split.children)[1][`node`],
        { kind: `group` }
      >
      expect(right.tiles[0].entityUrl).toBe(`/horton/bar`)
    })

    it(`split-up places the new tile *above* the existing one`, () => {
      const after1 = run(EMPTY_WORKSPACE, {
        type: `open-tile`,
        tile: { entityUrl: `/horton/foo`, viewId: `chat` },
      })
      const groupId = listGroups(after1.root)[0].id
      const ws = workspaceReducer(after1, {
        type: `open-tile`,
        tile: { entityUrl: `/horton/bar`, viewId: `chat` },
        target: { groupId, position: `split-up` },
      })
      const split = ws.root as Extract<typeof ws.root, { kind: `split` }>
      expect(split.direction).toBe(`vertical`)
      const top = split.children[0].node as Extract<
        (typeof split.children)[0][`node`],
        { kind: `group` }
      >
      expect(top.tiles[0].entityUrl).toBe(`/horton/bar`)
    })
  })

  describe(`close-tile`, () => {
    it(`removes a non-last tile and re-picks an active`, () => {
      const ws0 = run(EMPTY_WORKSPACE, {
        type: `open-tile`,
        tile: { entityUrl: `/horton/foo`, viewId: `chat` },
      })
      const groupId = listGroups(ws0.root)[0].id
      const ws1 = workspaceReducer(ws0, {
        type: `open-tile`,
        tile: { entityUrl: `/horton/bar`, viewId: `chat` },
        target: { groupId, position: `append` },
      })
      // Close the active (newer) tile.
      const group1 = listGroups(ws1.root)[0]
      const ws2 = workspaceReducer(ws1, {
        type: `close-tile`,
        tileId: group1.activeTileId,
      })
      const group2 = listGroups(ws2.root)[0]
      expect(group2.tiles).toHaveLength(1)
      expect(group2.tiles[0].entityUrl).toBe(`/horton/foo`)
      expect(group2.activeTileId).toBe(group2.tiles[0].id)
    })

    it(`removes the group when its last tile is closed`, () => {
      const ws0 = run(EMPTY_WORKSPACE, {
        type: `open-tile`,
        tile: { entityUrl: `/horton/foo`, viewId: `chat` },
      })
      const tileId = listGroups(ws0.root)[0].tiles[0].id
      const ws1 = workspaceReducer(ws0, { type: `close-tile`, tileId })
      expect(ws1.root).toBeNull()
      expect(ws1.activeGroupId).toBeNull()
    })

    it(`unwraps a split when one of two groups is emptied`, () => {
      let ws = run(EMPTY_WORKSPACE, {
        type: `open-tile`,
        tile: { entityUrl: `/horton/foo`, viewId: `chat` },
      })
      const fooGroupId = listGroups(ws.root)[0].id
      ws = workspaceReducer(ws, {
        type: `open-tile`,
        tile: { entityUrl: `/horton/bar`, viewId: `chat` },
        target: { groupId: fooGroupId, position: `split-right` },
      })
      // Now there's a horizontal split with two groups. Close the
      // bar tile (right side).
      const groups = listGroups(ws.root)
      const barGroup = groups.find((g) =>
        g.tiles.some((t) => t.entityUrl === `/horton/bar`)
      )!
      ws = workspaceReducer(ws, {
        type: `close-tile`,
        tileId: barGroup.tiles[0].id,
      })
      // Split should have collapsed; root is back to a single group.
      expect(ws.root!.kind).toBe(`group`)
      const remaining = ws.root as Extract<typeof ws.root, { kind: `group` }>
      expect(remaining.tiles[0].entityUrl).toBe(`/horton/foo`)
    })
  })

  describe(`move-tile`, () => {
    it(`moves a tile from one group to another`, () => {
      let ws = run(EMPTY_WORKSPACE, {
        type: `open-tile`,
        tile: { entityUrl: `/horton/foo`, viewId: `chat` },
      })
      const fooGroupId = listGroups(ws.root)[0].id
      ws = workspaceReducer(ws, {
        type: `open-tile`,
        tile: { entityUrl: `/horton/bar`, viewId: `chat` },
        target: { groupId: fooGroupId, position: `split-right` },
      })
      // Two groups exist. Move the bar tile back into the foo group as
      // an appended tab.
      const barGroup = listGroups(ws.root).find((g) =>
        g.tiles.some((t) => t.entityUrl === `/horton/bar`)
      )!
      const barTileId = barGroup.tiles[0].id
      ws = workspaceReducer(ws, {
        type: `move-tile`,
        tileId: barTileId,
        target: { groupId: fooGroupId, position: `append` },
      })
      // Single group remains with two tiles; split collapsed.
      expect(ws.root!.kind).toBe(`group`)
      const finalGroup = ws.root as Extract<typeof ws.root, { kind: `group` }>
      expect(finalGroup.tiles).toHaveLength(2)
      expect(finalGroup.tiles.map((t) => t.entityUrl).sort()).toEqual([
        `/horton/bar`,
        `/horton/foo`,
      ])
    })

    it(`survives moving the only tile of a group into a new split of itself`, () => {
      let ws = run(EMPTY_WORKSPACE, {
        type: `open-tile`,
        tile: { entityUrl: `/horton/foo`, viewId: `chat` },
      })
      const groupId = listGroups(ws.root)[0].id
      const tileId = listGroups(ws.root)[0].tiles[0].id
      ws = workspaceReducer(ws, {
        type: `move-tile`,
        tileId,
        target: { groupId, position: `split-right` },
      })
      // The reducer's safety net inserts the orphaned tile into a fresh
      // root group rather than losing it.
      expect(ws.root).not.toBeNull()
      expect(findTile(ws.root, tileId)).not.toBeNull()
    })
  })

  describe(`set-tile-view / split-tile-with-view`, () => {
    it(`set-tile-view swaps in place without changing layout`, () => {
      let ws = run(EMPTY_WORKSPACE, {
        type: `open-tile`,
        tile: { entityUrl: `/horton/foo`, viewId: `chat` },
      })
      const tileId = listGroups(ws.root)[0].tiles[0].id
      ws = workspaceReducer(ws, {
        type: `set-tile-view`,
        tileId,
        viewId: `state-explorer`,
      })
      expect(ws.root!.kind).toBe(`group`)
      const tile = findTile(ws.root, tileId)!
      expect(tile.viewId).toBe(`state-explorer`)
    })

    it(`split-tile-with-view creates a new group with a different view of the same entity`, () => {
      let ws = run(EMPTY_WORKSPACE, {
        type: `open-tile`,
        tile: { entityUrl: `/horton/foo`, viewId: `chat` },
      })
      const tileId = listGroups(ws.root)[0].tiles[0].id
      ws = workspaceReducer(ws, {
        type: `split-tile-with-view`,
        tileId,
        viewId: `state-explorer`,
        direction: `right`,
      })
      const groups = listGroups(ws.root)
      expect(groups).toHaveLength(2)
      const states = groups.flatMap((g) =>
        g.tiles.map((t) => ({ entityUrl: t.entityUrl, viewId: t.viewId }))
      )
      expect(states).toContainEqual({
        entityUrl: `/horton/foo`,
        viewId: `chat`,
      })
      expect(states).toContainEqual({
        entityUrl: `/horton/foo`,
        viewId: `state-explorer`,
      })
      // Active group should be the new one.
      const activeGroup = groups.find((g) => g.id === ws.activeGroupId)
      expect(activeGroup?.tiles[0].viewId).toBe(`state-explorer`)
    })
  })

  describe(`resize-split`, () => {
    it(`normalises sizes to sum to 1`, () => {
      let ws = run(EMPTY_WORKSPACE, {
        type: `open-tile`,
        tile: { entityUrl: `/horton/foo`, viewId: `chat` },
      })
      const groupId = listGroups(ws.root)[0].id
      ws = workspaceReducer(ws, {
        type: `open-tile`,
        tile: { entityUrl: `/horton/bar`, viewId: `chat` },
        target: { groupId, position: `split-right` },
      })
      const split = ws.root as Extract<typeof ws.root, { kind: `split` }>
      ws = workspaceReducer(ws, {
        type: `resize-split`,
        splitId: split.id,
        sizes: [3, 1],
      })
      const next = ws.root as Extract<typeof ws.root, { kind: `split` }>
      expect(next.children[0].size).toBeCloseTo(0.75)
      expect(next.children[1].size).toBeCloseTo(0.25)
    })
  })

  describe(`active group bookkeeping`, () => {
    it(`updates activeGroupId when the previously active group is destroyed`, () => {
      let ws = run(EMPTY_WORKSPACE, {
        type: `open-tile`,
        tile: { entityUrl: `/horton/foo`, viewId: `chat` },
      })
      const fooGroupId = listGroups(ws.root)[0].id
      ws = workspaceReducer(ws, {
        type: `open-tile`,
        tile: { entityUrl: `/horton/bar`, viewId: `chat` },
        target: { groupId: fooGroupId, position: `split-right` },
      })
      const barGroup = listGroups(ws.root).find((g) =>
        g.tiles.some((t) => t.entityUrl === `/horton/bar`)
      )!
      ws = workspaceReducer(ws, {
        type: `set-active-group`,
        groupId: barGroup.id,
      })
      expect(ws.activeGroupId).toBe(barGroup.id)
      // Now close the active group's tile — it should disappear and
      // the active should fall back to the remaining group.
      ws = workspaceReducer(ws, {
        type: `close-tile`,
        tileId: barGroup.tiles[0].id,
      })
      expect(ws.activeGroupId).toBe(fooGroupId)
    })
  })

  describe(`findGroupContainingTile`, () => {
    it(`returns null for unknown tile ids`, () => {
      const ws = run(EMPTY_WORKSPACE, {
        type: `open-tile`,
        tile: { entityUrl: `/horton/foo`, viewId: `chat` },
      })
      expect(findGroupContainingTile(ws.root, `nope`)).toBeNull()
    })
  })
})
