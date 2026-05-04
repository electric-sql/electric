import { useEffect, useRef } from 'react'
import { useWorkspace, listTiles } from './useWorkspace'
import { useServerConnection } from './useServerConnection'
import { useElectricAgents } from '../lib/ElectricAgentsProvider'
import { useLiveQuery } from '@tanstack/react-db'
import type { Workspace, WorkspaceNode } from '../lib/workspace/types'

/**
 * Workspace persistence: serialise the current workspace tree to
 * localStorage (debounced) and restore it on next load.
 *
 * Storage shape (envelope so future revisions can migrate or fall
 * back without crashing the UI):
 *
 *   key:   `electric-agents-ui.workspace.<serverId>.v2`
 *   value: { v: 2, workspace: <Workspace> }
 *
 * Schema bumped from v1 → v2 when the data model dropped the Group
 * concept; v1 envelopes are silently ignored on hydration.
 *
 * Server-keyed because two different Electric servers each remember
 * their own layout — switching servers shouldn't drag the previous
 * server's tile tree along.
 *
 * Hydration order on first mount:
 *   1. If persisted workspace exists for the active server, restore it
 *      and prune any tiles whose entity has gone missing in the live
 *      `entitiesCollection`.
 *   2. Otherwise: leave the workspace empty (the URL → workspace
 *      effect in `<Workspace />` will populate it).
 *
 * Persistence write: debounced 250ms after every workspace change so
 * we don't beat localStorage with one write per splitter pixel.
 */
const SCHEMA_VERSION = 2
const DEBOUNCE_MS = 250

type Envelope = {
  v: number
  workspace: Workspace
}

function storageKey(serverId: string | null): string | null {
  if (!serverId) return null
  return `electric-agents-ui.workspace.${serverId}.v${SCHEMA_VERSION}`
}

export function useWorkspacePersistence(): void {
  const { workspace, helpers } = useWorkspace()
  const { activeServer } = useServerConnection()
  const { entitiesCollection } = useElectricAgents()
  // Use the server's URL (URI-safe-encoded) as the persistence key
  // namespace — the user-facing `name` could be edited or duplicated,
  // but the URL is the stable identity that the rest of the app uses
  // when wiring shapes / storing per-server preferences.
  const serverId = activeServer?.url
    ? encodeURIComponent(activeServer.url)
    : null

  // Mark the workspace as hydrated for the current server. We only
  // restore once per (server, mount) — subsequent workspace changes
  // are user-driven and shouldn't get blown away by a re-hydration.
  const hydratedFor = useRef<string | null>(null)
  // Materialise the live entities once so prune-on-load can drop dead
  // tiles. Re-running `useLiveQuery` on every render is fine — TanStack
  // memoises by query identity.
  const { data: liveEntities = [] } = useLiveQuery(
    (q) => {
      if (!entitiesCollection) return undefined
      return q.from({ e: entitiesCollection })
    },
    [entitiesCollection]
  )
  const liveUrls = useRef<Set<string>>(new Set())
  liveUrls.current = new Set(liveEntities.map((e) => e.url))

  useEffect(() => {
    const key = storageKey(serverId)
    if (!key) return
    if (hydratedFor.current === serverId) return
    hydratedFor.current = serverId

    let raw: string | null = null
    try {
      raw = window.localStorage.getItem(key)
    } catch {
      // Some embedded contexts (file://, sandboxed iframes) deny
      // localStorage. Fail silently — we still work, just without
      // persistence.
      return
    }
    if (!raw) return

    try {
      const env = JSON.parse(raw) as Envelope
      if (!env || env.v !== SCHEMA_VERSION || !env.workspace) return
      // Prune entities that are no longer alive on the server. We do
      // this against `liveUrls` *as of first hydration*; subsequent
      // entity disappearances are handled by `<TileContainer>`'s
      // close-on-disappear effect. If the entities collection hasn't
      // populated yet we skip the prune (the close-on-disappear
      // effect will handle it on next render).
      const pruned =
        liveUrls.current.size === 0
          ? env.workspace
          : pruneWorkspace(env.workspace, liveUrls.current)
      // Don't override an existing non-empty workspace — that would
      // wipe out the tile that the URL → workspace effect just opened
      // for the current route. We only restore when the workspace is
      // currently empty (the common case on cold load).
      if (workspace.root === null && pruned.root !== null) {
        helpers.replaceWorkspace(pruned)
      }
    } catch {
      // Malformed envelope — ignore and start fresh.
    }
    // Note: we intentionally *don't* depend on `workspace` here;
    // hydration is a one-shot per (server, mount) tied to the
    // hydratedFor ref. Including `workspace` would cause hydration to
    // try to fire after every state change. Reading the latest
    // `workspace.root` via the live closure rather than declaring it
    // a dep is what we want for this read-once-on-mount semantics.
  }, [serverId, helpers, workspace.root])

  // Debounced write on workspace change. We always write; even
  // workspace.root === null is a meaningful state to remember (so
  // closing all tiles persists). Wrap in try/catch because Safari's
  // private browsing throws on every setItem.
  useEffect(() => {
    const key = storageKey(serverId)
    if (!key) return
    const handle = setTimeout(() => {
      try {
        const env: Envelope = { v: SCHEMA_VERSION, workspace }
        window.localStorage.setItem(key, JSON.stringify(env))
      } catch {
        /* ignore */
      }
    }, DEBOUNCE_MS)
    return () => clearTimeout(handle)
  }, [serverId, workspace])
}

/**
 * Drop tiles whose entity URL isn't present in `liveUrls`. Empty
 * splits cascade-collapse to `null` (or to their sole survivor when
 * one child remains); the root collapses to `null` if every tile is
 * dead.
 *
 * activeTileId is reset to whichever tile survives the prune (first
 * one in tree order) when the previous active is gone.
 */
function pruneWorkspace(
  workspace: Workspace,
  liveUrls: Set<string>
): Workspace {
  const root = pruneNode(workspace.root, liveUrls)
  if (!root) return { root: null, activeTileId: null }
  const tiles = listTiles(root)
  const stillThere =
    workspace.activeTileId !== null &&
    tiles.some((t) => t.id === workspace.activeTileId)
  return {
    root,
    activeTileId: stillThere ? workspace.activeTileId : (tiles[0]?.id ?? null),
  }
}

function pruneNode(
  node: WorkspaceNode | null,
  liveUrls: Set<string>
): WorkspaceNode | null {
  if (!node) return null
  if (node.kind === `tile`) {
    // Standalone tiles (e.g. new-session) have no entity to validate
    // against — they always survive the prune.
    if (node.entityUrl === null) return node
    return liveUrls.has(node.entityUrl) ? node : null
  }
  const newChildren: typeof node.children = []
  for (const child of node.children) {
    const pruned = pruneNode(child.node, liveUrls)
    if (pruned) newChildren.push({ ...child, node: pruned })
  }
  if (newChildren.length === 0) return null
  if (newChildren.length === 1) return newChildren[0].node
  // Re-normalise sizes so they sum to 1 again after dropping siblings.
  const total = newChildren.reduce((a: number, c) => a + c.size, 0)
  const normalised = newChildren.map((c) => ({
    ...c,
    size: total > 0 ? c.size / total : 1 / newChildren.length,
  }))
  return { ...node, children: normalised }
}
