import { useCallback, useEffect, useRef, useState } from 'react'
import { GripVertical, X } from 'lucide-react'
import { useLiveQuery } from '@tanstack/react-db'
import { eq } from '@tanstack/db'
import { useElectricAgents } from '../../lib/ElectricAgentsProvider'
import { useServerConnection } from '../../hooks/useServerConnection'
import { listTiles, useWorkspace } from '../../hooks/useWorkspace'
import { getView } from '../../lib/workspace/viewRegistry'
import { setWorkspaceDrag } from '../../lib/workspace/dragPayload'
import { getEntityDisplayTitle } from '../../lib/entityDisplay'
import { EntityHeader } from '../EntityHeader'
import { MainHeader } from '../MainHeader'
import { Icon, IconButton, Stack, Text, Tooltip } from '../../ui'
import { SplitMenu } from './SplitMenu'
import { DropOverlay } from './DropOverlay'
import { PaneFindBar } from './PaneFindBar'
import type { Tile } from '../../lib/workspace/types'
import type { ViewId } from '../../lib/workspace/viewRegistry'
import type { ReactNode } from 'react'
import type { ElectricEntity } from '../../lib/ElectricAgentsProvider'
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
        <EntityTileBody
          tile={tile}
          entityUrl={tile.entityUrl}
          rootRef={tileRef}
        />
      ) : (
        <StandaloneTileBody tile={tile} rootRef={tileRef} />
      )}
      <DropOverlay tileId={tile.id} containerRef={tileRef} />
    </div>
  )
}

function EntityTileBody({
  tile,
  entityUrl,
  rootRef,
}: {
  tile: Tile
  entityUrl: string
  rootRef: React.RefObject<HTMLDivElement | null>
}): React.ReactElement {
  const { activeServer } = useServerConnection()
  const { entitiesCollection } = useElectricAgents()
  const { workspace, helpers } = useWorkspace()
  const canRearrange = listTiles(workspace.root).length > 1

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
        <Text tone="muted" size={2}>
          Loading entity...
        </Text>
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

  return (
    <Stack direction="column" className={styles.body} data-tile-id={tile.id}>
      <div>
        <EntityHeader
          entity={entity}
          currentViewId={tile.viewId}
          onSetView={setView}
          leading={
            canRearrange ? (
              <TileDragHandle
                tile={tile}
                label={getEntityDisplayTitle(entity).title}
              />
            ) : undefined
          }
          menu={<TileActions tile={tile} entity={entity} />}
        />
      </div>
      <PaneFindBar tileId={tile.id} rootRef={rootRef} />
      {View ? (
        <View
          baseUrl={baseUrl}
          entityUrl={entityUrl}
          entity={entity}
          entityStopped={entityStopped}
          isSpawning={isSpawning}
          tileId={tile.id}
          viewParams={tile.viewParams}
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
function StandaloneTileBody({
  tile,
  rootRef,
}: {
  tile: Tile
  rootRef: React.RefObject<HTMLDivElement | null>
}): React.ReactElement {
  const { activeServer } = useServerConnection()
  const { workspace } = useWorkspace()
  const viewDef = getView(tile.viewId)
  const baseUrl = activeServer?.url ?? ``
  const [toolbarTitle, setToolbarTitle] = useState<ReactNode | null>(null)
  const canRearrange = listTiles(workspace.root).length > 1

  if (!viewDef || viewDef.kind !== `standalone`) {
    return (
      <Stack align="center" justify="center" grow className={styles.body}>
        <span>Unknown view: {tile.viewId}</span>
      </Stack>
    )
  }

  const View = viewDef.Component

  return (
    <Stack direction="column" className={styles.body} data-tile-id={tile.id}>
      <div>
        <MainHeader
          leading={
            canRearrange ? (
              <TileDragHandle tile={tile} label={viewDef.label} />
            ) : undefined
          }
          title={toolbarTitle}
          actions={<TileActions tile={tile} entity={null} />}
        />
      </div>
      <PaneFindBar tileId={tile.id} rootRef={rootRef} />
      <View
        baseUrl={baseUrl}
        tileId={tile.id}
        setToolbarTitle={setToolbarTitle}
      />
    </Stack>
  )
}

function TileDragHandle({
  tile,
  label,
}: {
  tile: Tile
  label: string
}): React.ReactElement {
  return (
    <span
      className={styles.dragHandle}
      title="Drag to rearrange tile"
      aria-hidden="true"
      data-no-drag
      draggable={true}
      onDragStart={(e) => {
        setWorkspaceDrag(
          e,
          { kind: `tile`, tileId: tile.id },
          { dragImage: `label-row`, dragImageLabel: label }
        )
      }}
    >
      <Icon icon={GripVertical} size={2} />
    </span>
  )
}

function TileActions({
  tile,
  entity,
}: {
  tile: Tile
  entity: ElectricEntity | null
}): React.ReactElement {
  const { workspace, helpers } = useWorkspace()
  const canClose = listTiles(workspace.root).length > 1

  return (
    <>
      <SplitMenu tile={tile} entity={entity} />
      {canClose && (
        <Tooltip content="Close tile">
          <IconButton
            variant="ghost"
            tone="neutral"
            size={1}
            aria-label="Close tile"
            title="Close tile"
            onClick={() => helpers.closeTile(tile.id)}
          >
            <Icon icon={X} size={3} />
          </IconButton>
        </Tooltip>
      )}
    </>
  )
}
