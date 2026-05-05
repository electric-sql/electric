import { describe, expect, it } from 'vitest'
import { decodeLayout, encodeLayout } from './layoutCodec'
import type { Split, Tile, Workspace, WorkspaceNode } from './types'

/**
 * Round-trips through the codec strip generated ids (split / tile ids
 * are minted fresh on decode), so we compare on the structural
 * projection that's part of the wire format.
 */
function structureOf(ws: Workspace): unknown {
  if (!ws.root) return null
  const visit = (node: WorkspaceNode): unknown => {
    if (node.kind === `tile`) {
      return {
        kind: `tile`,
        entityUrl: node.entityUrl,
        viewId: node.viewId,
      }
    }
    return {
      kind: `split`,
      direction: node.direction,
      children: node.children.map((c) => ({
        node: visit(c.node),
        size: Math.round(c.size * 100) / 100,
      })),
    }
  }
  return visit(ws.root)
}

describe(`layoutCodec`, () => {
  it(`encodes and decodes a single tile`, () => {
    const encoded = `horton%2Ffoo.chat`
    const decoded = decodeLayout(encoded)
    expect(decoded.kind).toBe(`ok`)
    if (decoded.kind !== `ok`) return
    expect(structureOf(decoded.workspace)).toEqual({
      kind: `tile`,
      entityUrl: `/horton/foo`,
      viewId: `chat`,
    })
    expect(encodeLayout(decoded.workspace)).toBe(encoded)
  })

  it(`encodes a horizontal split with explicit sizes`, () => {
    const encoded = `H(horton%2Ffoo.chat:60,horton%2Ffoo.state-explorer:40)`
    const decoded = decodeLayout(encoded)
    expect(decoded.kind).toBe(`ok`)
    if (decoded.kind !== `ok`) return
    expect(structureOf(decoded.workspace)).toEqual({
      kind: `split`,
      direction: `horizontal`,
      children: [
        {
          node: {
            kind: `tile`,
            entityUrl: `/horton/foo`,
            viewId: `chat`,
          },
          size: 0.6,
        },
        {
          node: {
            kind: `tile`,
            entityUrl: `/horton/foo`,
            viewId: `state-explorer`,
          },
          size: 0.4,
        },
      ],
    })
    expect(encodeLayout(decoded.workspace)).toBe(encoded)
  })

  it(`omits sizes when they are the natural even share`, () => {
    const encoded = `H(horton%2Ffoo.chat,horton%2Fbar.chat)`
    const decoded = decodeLayout(encoded)
    expect(decoded.kind).toBe(`ok`)
    if (decoded.kind !== `ok`) return
    // Re-encoded form has no `:50`s — both are even share.
    expect(encodeLayout(decoded.workspace)).toBe(encoded)
  })

  it(`handles nested splits`, () => {
    const encoded = `H(horton%2Ffoo.chat,V(horton%2Fbar.chat,horton%2Fbaz.chat))`
    const decoded = decodeLayout(encoded)
    expect(decoded.kind).toBe(`ok`)
    if (decoded.kind !== `ok`) return
    expect(structureOf(decoded.workspace)).toEqual({
      kind: `split`,
      direction: `horizontal`,
      children: [
        {
          node: {
            kind: `tile`,
            entityUrl: `/horton/foo`,
            viewId: `chat`,
          },
          size: 0.5,
        },
        {
          node: {
            kind: `split`,
            direction: `vertical`,
            children: [
              {
                node: {
                  kind: `tile`,
                  entityUrl: `/horton/bar`,
                  viewId: `chat`,
                },
                size: 0.5,
              },
              {
                node: {
                  kind: `tile`,
                  entityUrl: `/horton/baz`,
                  viewId: `chat`,
                },
                size: 0.5,
              },
            ],
          },
          size: 0.5,
        },
      ],
    })
    expect(encodeLayout(decoded.workspace)).toBe(encoded)
  })

  it(`returns ok with empty workspace for empty input`, () => {
    const decoded = decodeLayout(``)
    expect(decoded.kind).toBe(`ok`)
    if (decoded.kind === `ok`) {
      expect(decoded.workspace.root).toBeNull()
    }
  })

  it(`reports an error for malformed input`, () => {
    expect(decodeLayout(`H(`).kind).toBe(`error`)
    expect(decodeLayout(`H(foo)`).kind).toBe(`error`) // single child
    expect(decodeLayout(`foo`).kind).toBe(`error`) // no '.'
    expect(decodeLayout(`foo.`).kind).toBe(`error`) // empty viewId
  })

  it(`mints fresh ids on decode (so two decodes yield distinct ids)`, () => {
    const a = decodeLayout(`horton%2Ffoo.chat`)
    const b = decodeLayout(`horton%2Ffoo.chat`)
    expect(a.kind).toBe(`ok`)
    expect(b.kind).toBe(`ok`)
    if (a.kind !== `ok` || b.kind !== `ok`) return
    const at = a.workspace.root as Tile
    const bt = b.workspace.root as Tile
    expect(at.id).not.toBe(bt.id)
  })

  it(`round-trips a layout produced by encodeLayout()`, () => {
    const original = decodeLayout(
      `H(horton%2Ffoo.chat:70,V(horton%2Fbar.state-explorer,horton%2Fbaz.chat):30)`
    )
    expect(original.kind).toBe(`ok`)
    if (original.kind !== `ok`) return
    const encoded = encodeLayout(original.workspace)
    const reDecoded = decodeLayout(encoded)
    expect(reDecoded.kind).toBe(`ok`)
    if (reDecoded.kind !== `ok`) return
    expect(structureOf(reDecoded.workspace)).toEqual(
      structureOf(original.workspace)
    )
  })

  it(`renormalises sizes that exceed 100%`, () => {
    const decoded = decodeLayout(`H(horton%2Fa.chat:80,horton%2Fb.chat:80)`)
    expect(decoded.kind).toBe(`ok`)
    if (decoded.kind !== `ok`) return
    const split = decoded.workspace.root as Split
    const sum = split.children.reduce((acc: number, c) => acc + c.size, 0)
    expect(sum).toBeCloseTo(1)
  })

  it(`active tile after decode is the first leaf in tree order`, () => {
    const decoded = decodeLayout(
      `H(horton%2Ffoo.chat,V(horton%2Fbar.chat,horton%2Fbaz.chat))`
    )
    expect(decoded.kind).toBe(`ok`)
    if (decoded.kind !== `ok`) return
    const split = decoded.workspace.root as Split
    const firstTile = split.children[0].node as Tile
    expect(decoded.workspace.activeTileId).toBe(firstTile.id)
  })

  it(`encodes a standalone tile (null entityUrl) with empty path segment`, () => {
    const decoded = decodeLayout(`.new-session`)
    expect(decoded.kind).toBe(`ok`)
    if (decoded.kind !== `ok`) return
    const tile = decoded.workspace.root as Tile
    expect(tile.entityUrl).toBeNull()
    expect(tile.viewId).toBe(`new-session`)
    expect(encodeLayout(decoded.workspace)).toBe(`.new-session`)
  })

  it(`mixes standalone and entity tiles in the same split`, () => {
    const encoded = `H(.new-session,horton%2Fbar.chat)`
    const decoded = decodeLayout(encoded)
    expect(decoded.kind).toBe(`ok`)
    if (decoded.kind !== `ok`) return
    expect(structureOf(decoded.workspace)).toEqual({
      kind: `split`,
      direction: `horizontal`,
      children: [
        {
          node: {
            kind: `tile`,
            entityUrl: null,
            viewId: `new-session`,
          },
          size: 0.5,
        },
        {
          node: {
            kind: `tile`,
            entityUrl: `/horton/bar`,
            viewId: `chat`,
          },
          size: 0.5,
        },
      ],
    })
    expect(encodeLayout(decoded.workspace)).toBe(encoded)
  })
})
