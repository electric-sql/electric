import { useCallback, useEffect, useRef } from 'react'
import { useLiveQuery } from '@tanstack/react-db'
import { eq } from '@tanstack/db'
import { useElectricAgents } from '../../lib/ElectricAgentsProvider'
import { useServerConnection } from '../../hooks/useServerConnection'
import { useWorkspace } from '../../hooks/useWorkspace'
import { getView } from '../../lib/workspace/viewRegistry'
import { setDragPayload } from '../../lib/workspace/dragPayload'
import { EntityHeader } from '../EntityHeader'
import { MainHeader } from '../MainHeader'
import { Stack, Text } from '../../ui'
import { SplitMenu } from './SplitMenu'
import { DropOverlay } from './DropOverlay'
import type { Tile } from '../../lib/workspace/types'
import type { ViewId } from '../../lib/workspace/viewRegistry'
import styles from './TileContainer.module.css'

/**
 * Renders a single Tile (a leaf in the workspace tree).
 *
 * Branches on whether the tile has an `entityUrl`:
 *   - entity tile     → load entity, render `<EntityHeader>` + the
 *                       registered entity view body.
 *   - standalone tile → no entity load. Render `<MainHeader>` with
 *                       the view's label and the `SplitMenu`, then
 *                       the registered standalone view body.
 *
 * Click anywhere inside makes this the active tile (mouse-down-capture
 * so it fires before the body's own handlers).
 */
export function TileContainer({ tile }: { tile: Tile }): React.ReactElement {
  const { workspace, helpers } = useWorkspace()
  const isActive = workspace.activeTileId === tile.id
  const tileRef = useRef<HTMLDivElement>(null)

  const onActivate = useCallback(() => {
    if (!isActive) helpers.setActiveTile(tile.id)
  }, [isActive, tile.id, helpers])

  return (
    <div ref={tileRef} className={styles.tile} onMouseDownCapture={onActivate}>
      {tile.entityUrl !== null ? (
        <EntityTileBody tile={tile} entityUrl={tile.entityUrl} />
      ) : (
        <StandaloneTileBody tile={tile} />
      )}
      <DropOverlay tileId={tile.id} containerRef={tileRef} />
    </div>
  )
}

function EntityTileBody({
  tile,
  entityUrl,
}: {
  tile: Tile
  entityUrl: string
}): React.ReactElement {
  const { activeServer } = useServerConnection()
  const { entitiesCollection } = useElectricAgents()
  const { helpers } = useWorkspace()

  const { data: matches = [] } = useLiveQuery(
    (q) => {
      if (!entitiesCollection) return undefined
      return q
        .from({ e: entitiesCollection })
        .where(({ e }) => eq(e.url, entityUrl))
    },
    [entitiesCollection, entityUrl]
  )
  const entity = matches.at(0) ?? null
  const isSpawning = entity?.status === `spawning`
  const entityStopped = entity?.status === `stopped`

  const setView = useCallback(
    (viewId: ViewId) => helpers.setTileView(tile.id, viewId),
    [helpers, tile.id]
  )

  // If the entity disappears entirely (e.g. user killed it elsewhere),
  // close this tile so the workspace doesn't keep dead references.
  useEffect(() => {
    if (matches.length === 0 && entitiesCollection) {
      const t = setTimeout(() => {
        if (matches.length === 0) helpers.closeTile(tile.id)
      }, 250)
      return () => clearTimeout(t)
    }
  }, [matches.length, entitiesCollection, helpers, tile.id])

  if (!entity) {
    return (
      <Stack align="center" justify="center" grow className={styles.body}>
        <span>Loading entity...</span>
      </Stack>
    )
  }

  const baseUrl = activeServer?.url ?? ``
  const viewDef = getView(tile.viewId)
  // Only render the view body if it's an *entity* view. If we ever land
  // here with a standalone view id (shouldn't happen — entityUrl !== null
  // is checked one frame above) we fall through to the unknown-view
  // placeholder to avoid passing an entity into a view that doesn't
  // expect one.
  const View = viewDef?.kind === `entity` ? viewDef.Component : undefined

  // The header is the drag handle for this tile. The browser only
  // dispatches `dragstart` after the cursor moves, so the title's
  // copy-on-click button still works for clicks-without-movement.
  const onHeaderDragStart = (e: React.DragEvent) => {
    setDragPayload(e, { kind: `tile`, tileId: tile.id })
  }

  return (
    <Stack
      direction="column"
      className={styles.body}
      data-tile-id={tile.id}
      draggable
      onDragStart={onHeaderDragStart}
    >
      <EntityHeader
        entity={entity}
        currentViewId={tile.viewId}
        onSetView={setView}
        menu={<SplitMenu tile={tile} entity={entity} />}
      />
      {View ? (
        <View
          baseUrl={baseUrl}
          entityUrl={entityUrl}
          entity={entity}
          entityStopped={entityStopped}
          isSpawning={isSpawning}
          tileId={tile.id}
        />
      ) : (
        <Stack align="center" justify="center" grow>
          <span>Unknown view: {tile.viewId}</span>
        </Stack>
      )}
    </Stack>
  )
}

/**
 * Body for tiles that don't bind to an entity (the new-session tile
 * is the only one today). Renders the standalone view's component
 * inside a generic `MainHeader` chrome with the SplitMenu so the
 * tile participates in splits / drops / "..." actions just like an
 * entity tile.
 */
function StandaloneTileBody({ tile }: { tile: Tile }): React.ReactElement {
  const { activeServer } = useServerConnection()
  const viewDef = getView(tile.viewId)
  const Icon = viewDef?.icon
  const baseUrl = activeServer?.url ?? ``

  // Same drag-by-header trick as the entity tile body — the whole
  // surface is draggable, but the actual `dragstart` doesn't fire
  // until the cursor moves, so clicks on inner controls (the agent
  // picker buttons, the composer) still work.
  const onHeaderDragStart = (e: React.DragEvent) => {
    setDragPayload(e, { kind: `tile`, tileId: tile.id })
  }

  if (!viewDef || viewDef.kind !== `standalone`) {
    return (
      <Stack align="center" justify="center" grow className={styles.body}>
        <span>Unknown view: {tile.viewId}</span>
      </Stack>
    )
  }

  const View = viewDef.Component

  return (
    <Stack
      direction="column"
      className={styles.body}
      data-tile-id={tile.id}
      draggable
      onDragStart={onHeaderDragStart}
    >
      <MainHeader
        title={
          <span className={styles.standaloneTitle}>
            {Icon && <Icon size={14} />}
            <Text size={2}>{viewDef.label}</Text>
          </span>
        }
        actions={<SplitMenu tile={tile} entity={null} />}
      />
      <View baseUrl={baseUrl} tileId={tile.id} />
    </Stack>
  )
}
