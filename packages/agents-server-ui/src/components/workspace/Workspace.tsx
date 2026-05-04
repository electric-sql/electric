import { useEffect, useRef } from 'react'
import { useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { useWorkspace } from '../../hooks/useWorkspace'
import { listViews } from '../../lib/workspace/viewRegistry'
import { useElectricAgents } from '../../lib/ElectricAgentsProvider'
import { useLiveQuery } from '@tanstack/react-db'
import { eq } from '@tanstack/db'
import { decodeLayout } from '../../lib/workspace/layoutCodec'
import { NodeRenderer } from './NodeRenderer'
import styles from './Workspace.module.css'
import type { ViewId } from '../../lib/workspace/viewRegistry'

/**
 * Top-level workspace renderer. Owns:
 *
 * - Reading the URL (entity splat + ?view) and reflecting it into the
 *   workspace state on the way *in* (one-way: URL → workspace).
 * - Reflecting the active tile back out into the URL (one-way:
 *   workspace → URL) so deep-links still work.
 *
 * Stage 2 keeps the workspace single-tile by default — multi-tile
 * arrives in stages 3 and 4 via the `…` menu and drag-and-drop. The
 * URL ↔ workspace contract here is the foundation those stages build
 * on, and the rules in §3.4 of the plan are encoded as effects below.
 */
export function Workspace(): React.ReactElement {
  const { workspace, helpers } = useWorkspace()
  const params = useParams({ strict: false })
  const search = useSearch({ strict: false }) as {
    view?: string
    layout?: string
  }
  const navigate = useNavigate()
  const splat = (params as Record<string, string | undefined>)._splat
  const entityUrl = splat ? `/${splat}` : null
  const requestedViewId = (search.view as ViewId | undefined) ?? null
  const layoutParam = (search.layout as string | undefined) ?? null

  // ---- ?layout=<DSL> import -------------------------------------------
  // Highest-priority hydration source: pasting a `?layout=…` URL
  // replaces the workspace then strips the param so the address bar
  // settles to the active tile (per §3.4 of the plan). Only fires once
  // per param value — guarded by `lastLayoutParam.current`.
  const lastLayoutParam = useRef<string | null>(null)
  useEffect(() => {
    if (!layoutParam || layoutParam === lastLayoutParam.current) return
    lastLayoutParam.current = layoutParam
    const decoded = decodeLayout(layoutParam)
    if (decoded.kind === `ok` && decoded.workspace.root) {
      helpers.replaceWorkspace(decoded.workspace)
    }
    // Strip the ?layout= param regardless of decode success — a bad
    // payload shouldn't sit in the address bar nagging the user.
    void navigate({
      to: `/entity/$`,
      params: { _splat: splat ?? `` },
      search: requestedViewId ? { view: requestedViewId } : {},
      replace: true,
    })
  }, [layoutParam, helpers, navigate, splat, requestedViewId])

  const { entitiesCollection } = useElectricAgents()
  const { data: entityMatches = [] } = useLiveQuery(
    (q) => {
      if (!entitiesCollection || !entityUrl) return undefined
      return q
        .from({ e: entitiesCollection })
        .where(({ e }) => eq(e.url, entityUrl))
    },
    [entitiesCollection, entityUrl]
  )
  const entity = entityMatches.at(0) ?? null

  // ---- URL → workspace -------------------------------------------------
  // Whenever the URL points at an entity, ensure it has a tile in the
  // workspace and that that tile is active. If the entity is already
  // present in some tile, just refocus it (no layout disruption);
  // otherwise insert a new tile in the active group, replacing its
  // current active tile (matches Stage 1 behaviour: the URL drives
  // what's visible).
  //
  // The `lastSyncedKey` ref dedupes redundant syncs — without it, the
  // workspace → URL effect below would echo back into this one and
  // create infinite open-tile dispatches.
  const lastSyncedKey = useRef<string | null>(null)
  useEffect(() => {
    if (!entityUrl) return
    const availableViews = entity ? listViews(entity) : []
    const defaultViewId = availableViews[0]?.id ?? `chat`
    const desiredViewId =
      requestedViewId && availableViews.some((v) => v.id === requestedViewId)
        ? requestedViewId
        : defaultViewId
    const key = `${entityUrl}::${desiredViewId}`
    if (lastSyncedKey.current === key) return

    // Look for an existing tile that already matches.
    const groups: Array<{
      id: string
      tiles: Array<{ id: string; entityUrl: string; viewId: string }>
    }> = []
    if (workspace.root) {
      const collect = (node: typeof workspace.root): void => {
        if (!node) return
        if (node.kind === `group`) {
          groups.push(node)
        } else {
          for (const c of node.children) collect(c.node)
        }
      }
      collect(workspace.root)
    }
    const exactMatch = groups
      .flatMap((g) => g.tiles.map((t) => ({ groupId: g.id, tile: t })))
      .find(
        (m) => m.tile.entityUrl === entityUrl && m.tile.viewId === desiredViewId
      )

    if (exactMatch) {
      helpers.setActiveTile(exactMatch.tile.id)
    } else {
      // No matching tile — open one. If a tile of the same entity
      // already exists in the active group, switch its view in place
      // rather than adding a new tile.
      const activeGroup =
        groups.find((g) => g.id === workspace.activeGroupId) ?? groups[0]
      const sameEntityInActive = activeGroup?.tiles.find(
        (t) => t.entityUrl === entityUrl
      )
      if (sameEntityInActive) {
        helpers.setActiveTile(sameEntityInActive.id)
        helpers.setTileView(sameEntityInActive.id, desiredViewId)
      } else {
        helpers.openEntity(entityUrl, { viewId: desiredViewId })
      }
    }
    lastSyncedKey.current = key
  }, [
    entityUrl,
    requestedViewId,
    entity,
    workspace.root,
    workspace.activeGroupId,
    helpers,
  ])

  // ---- Workspace → URL -------------------------------------------------
  // Whenever the active tile changes, mirror its (entityUrl, viewId)
  // into the route. We use `replace: true` for the URL update because
  // the *user* navigations that change the active tile (clicking a
  // sidebar row, opening a new tile, switching views) already pushed a
  // history entry through their own `navigate({})` calls — this effect
  // runs *after* the dispatch and is just keeping the URL in sync, so
  // pushing again would double up.
  useEffect(() => {
    const tile = helpers.activeTile
    if (!tile) return
    const expectedKey = `${tile.entityUrl}::${tile.viewId}`
    if (lastSyncedKey.current === expectedKey) return
    lastSyncedKey.current = expectedKey
    void navigate({
      to: `/entity/$`,
      params: { _splat: tile.entityUrl.replace(/^\//, ``) },
      search: tile.viewId === `chat` ? {} : { view: tile.viewId },
      replace: true,
    })
  }, [helpers.activeTile, navigate])

  if (!workspace.root) {
    return (
      <div className={styles.workspace}>
        <div className={styles.empty}>
          <span>Loading workspace...</span>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.workspace}>
      <NodeRenderer node={workspace.root} />
    </div>
  )
}
