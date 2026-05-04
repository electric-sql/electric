import type { Split, Tile, Workspace, WorkspaceNode } from './types'
import { makeSplitId, makeTileId } from './workspaceReducer'
import type { ViewId } from './viewRegistry'

// ---------------------------------------------------------------------------
// Compact layout encoding for shareable `?layout=` URLs (see §3.4 of
// TILE_LAYOUT_PLAN.md).
//
// Grammar:
//   node    := tile | hsplit | vsplit
//   hsplit  := 'H' '(' sized (',' sized)+ ')'    // horizontal = side-by-side
//   vsplit  := 'V' '(' sized (',' sized)+ ')'    // vertical   = stacked
//   sized   := node (':' int)?                    // size as percentage; default = even
//   tile    := <entityPath>? '.' viewId           // entityPath is urlEncoded,
//                                                  with the conventional
//                                                  leading '/' stripped.
//                                                  Empty entityPath ('.viewId')
//                                                  encodes a standalone tile —
//                                                  e.g. the new-session tile.
//
// Examples (canonical forms produced by `encodeLayout`):
//   horton%2Ffoo.chat
//   .new-session
//   H(horton%2Ffoo.chat:60,horton%2Ffoo.state-explorer:40)
//   H(.new-session,horton%2Fbar.chat)
//   H(horton%2Ffoo.chat,V(horton%2Fbar.chat,horton%2Fbaz.logs))
//
// Every leaf is a tile (no groups, no tabs). Tile / split ids are *not*
// part of the wire format — the decoder mints fresh ones via the same
// factories the reducer uses. IDs being ephemeral is the right thing
// here: a layout link should always paste cleanly into another window
// without colliding with that window's existing IDs.
//
// The active tile is *not* encoded either. The receiving window picks
// the first tile (tree order) as active during decode, then the
// workspace ↔ URL effect immediately overrides it with whatever
// (entity, view) the URL also carries — which is the typical "share
// link" workflow.
//
// Entity URLs always start with `/` everywhere else in the codebase
// (see `Tile.entityUrl`). The codec strips the leading slash on
// encode and re-adds it on decode purely for URL aesthetics — saves
// `%2F` characters per tile.
// ---------------------------------------------------------------------------

export function encodeLayout(workspace: Workspace): string {
  if (!workspace.root) return ``
  return encodeNode(workspace.root)
}

function encodeNode(node: WorkspaceNode): string {
  return node.kind === `split` ? encodeSplit(node) : encodeTile(node)
}

function encodeSplit(split: Split): string {
  const inner = split.children
    .map((c) => {
      const node = encodeNode(c.node)
      // Round to whole percentages for a compact URL — sub-percent
      // precision isn't useful for shared layouts (the receiving
      // window will likely be a different size anyway).
      const pct = Math.round(c.size * 100)
      // Omit the size when it's the natural even share — saves bytes.
      const evenShare = Math.round(100 / split.children.length)
      const sizePart = pct === evenShare ? `` : `:${pct}`
      return `${node}${sizePart}`
    })
    .join(`,`)
  return `${split.direction === `horizontal` ? `H` : `V`}(${inner})`
}

function encodeTile(tile: Tile): string {
  // Standalone tile (e.g. new-session) → empty entityPath segment, so
  // the canonical form is `.new-session`.
  if (tile.entityUrl === null) return `.${tile.viewId}`
  // Strip the conventional leading `/` so the canonical form is
  // `horton%2Ffoo.chat` instead of `%2Fhorton%2Ffoo.chat`. Decoder
  // adds it back. If for some reason an entityUrl doesn't start with
  // `/`, we encode it as-is — the decoder is symmetrical in only
  // *prepending* a slash when the decoded path doesn't already have one.
  const path = tile.entityUrl.startsWith(`/`)
    ? tile.entityUrl.slice(1)
    : tile.entityUrl
  return `${encodeURIComponent(path)}.${tile.viewId}`
}

// ---------------------------------------------------------------------------
// Decoder
// ---------------------------------------------------------------------------

export type DecodeError = { kind: `error`; message: string; at: number }
export type DecodeResult = { kind: `ok`; workspace: Workspace } | DecodeError

export function decodeLayout(input: string): DecodeResult {
  if (input.length === 0)
    return { kind: `ok`, workspace: { root: null, activeTileId: null } }
  const p = new Parser(input)
  try {
    const node = p.parseNode()
    p.expectEnd()
    const firstTile = findFirstTile(node)
    return {
      kind: `ok`,
      workspace: { root: node, activeTileId: firstTile?.id ?? null },
    }
  } catch (e) {
    return e instanceof ParseError
      ? { kind: `error`, message: e.message, at: e.at }
      : {
          kind: `error`,
          message: e instanceof Error ? e.message : String(e),
          at: p.pos,
        }
  }
}

class ParseError extends Error {
  constructor(
    message: string,
    public at: number
  ) {
    super(message)
    this.name = `ParseError`
  }
}

class Parser {
  pos = 0
  constructor(public src: string) {}

  parseNode(): WorkspaceNode {
    if (this.peek() === `H` && this.src[this.pos + 1] === `(`) {
      return this.parseSplit(`horizontal`)
    }
    if (this.peek() === `V` && this.src[this.pos + 1] === `(`) {
      return this.parseSplit(`vertical`)
    }
    return this.parseTile()
  }

  parseSplit(direction: `horizontal` | `vertical`): Split {
    this.pos += 2 // skip 'H(' or 'V('
    const children: Split[`children`] = []
    let totalDeclared = 0
    let countWithExplicitSize = 0
    while (true) {
      const node = this.parseNode()
      let size: number | null = null
      if (this.peek() === `:`) {
        this.pos += 1
        size = this.parseInt() / 100
        totalDeclared += size
        countWithExplicitSize++
      }
      children.push({ node, size: size ?? -1 })
      if (this.peek() === `,`) {
        this.pos += 1
        continue
      }
      if (this.peek() === `)`) {
        this.pos += 1
        break
      }
      throw new ParseError(
        `expected ',' or ')' inside split, got ${describeChar(this.peek())}`,
        this.pos
      )
    }
    if (children.length < 2) {
      throw new ParseError(`splits must have at least 2 children`, this.pos)
    }
    // Fill in the implicit (no-':') sizes by distributing the remaining
    // share evenly across them. If the explicit shares already exceed
    // 1, we renormalise below regardless.
    const remaining = Math.max(0, 1 - totalDeclared)
    const implicitCount = children.length - countWithExplicitSize
    const implicitShare = implicitCount > 0 ? remaining / implicitCount : 0
    for (const c of children) {
      if (c.size === -1) c.size = implicitShare
    }
    // Normalise so all sizes sum to 1 (handles the user-error case
    // where a `?layout=` URL declares >100% total).
    const total = children.reduce((a: number, c) => a + c.size, 0)
    if (total > 0) {
      for (const c of children) c.size = c.size / total
    } else {
      const even = 1 / children.length
      for (const c of children) c.size = even
    }
    return {
      kind: `split`,
      id: makeSplitId(),
      direction,
      children,
    }
  }

  parseTile(): Tile {
    // Tile = <urlEncodedEntityPath>? '.' <viewId>
    // We grab everything up to the LAST '.' before a control char as
    // the entity url; the suffix is the viewId. Control chars are
    // ',' '(' ')' ':'. Both halves accept alphanumerics + url-encoded
    // escapes (decoded via `decodeURIComponent`).
    //
    // An empty entity path ('.viewId') is the wire form for a
    // standalone tile (no entity attached) — currently the new-session
    // tile.
    const start = this.pos
    while (this.pos < this.src.length && !isControlChar(this.src[this.pos])) {
      this.pos++
    }
    const raw = this.src.slice(start, this.pos)
    const dot = raw.lastIndexOf(`.`)
    if (dot < 0) {
      throw new ParseError(
        `expected '.' separator in tile spec '${raw}'`,
        start
      )
    }
    const rawPath = raw.slice(0, dot)
    const viewId: ViewId = raw.slice(dot + 1)
    if (!viewId) {
      throw new ParseError(`empty viewId in tile spec '${raw}'`, start)
    }
    let entityUrl: string | null
    if (rawPath.length === 0) {
      // Standalone tile.
      entityUrl = null
    } else {
      const decoded = decodeURIComponent(rawPath)
      // Re-add the conventional leading `/` if the wire form omitted it
      // (canonical encoded form does — see encodeTile() comment). If
      // the wire form already includes one we don't double up.
      entityUrl = decoded.startsWith(`/`) ? decoded : `/${decoded}`
    }
    return { kind: `tile`, id: makeTileId(), entityUrl, viewId }
  }

  parseInt(): number {
    const start = this.pos
    while (this.pos < this.src.length && /[0-9]/.test(this.src[this.pos])) {
      this.pos++
    }
    if (this.pos === start) {
      throw new ParseError(`expected integer at position ${this.pos}`, this.pos)
    }
    return Number(this.src.slice(start, this.pos))
  }

  peek(): string {
    return this.src[this.pos] ?? ``
  }

  expectEnd(): void {
    if (this.pos !== this.src.length) {
      throw new ParseError(
        `unexpected trailing input at position ${this.pos}: '${this.src.slice(this.pos)}'`,
        this.pos
      )
    }
  }
}

function isControlChar(c: string): boolean {
  return c === `,` || c === `(` || c === `)` || c === `:`
}

function describeChar(c: string): string {
  return c.length === 0 ? `<end of input>` : `'${c}'`
}

function findFirstTile(node: WorkspaceNode): Tile | null {
  if (node.kind === `tile`) return node
  for (const c of node.children) {
    const found = findFirstTile(c.node)
    if (found) return found
  }
  return null
}
