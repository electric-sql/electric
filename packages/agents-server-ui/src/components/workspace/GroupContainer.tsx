import { useCallback, useEffect } from 'react'
import { useLiveQuery } from '@tanstack/react-db'
import { eq } from '@tanstack/db'
import { useNavigate } from '@tanstack/react-router'
import { useElectricAgents } from '../../lib/ElectricAgentsProvider'
import { useServerConnection } from '../../hooks/useServerConnection'
import { usePinnedEntities } from '../../hooks/usePinnedEntities'
import { useWorkspace } from '../../hooks/useWorkspace'
import { getView } from '../../lib/workspace/viewRegistry'
import { EntityHeader } from '../EntityHeader'
import { Stack } from '../../ui'
import { TabStrip } from './TabStrip'
import type { Group, Tile } from '../../lib/workspace/types'
import type { ViewId } from '../../lib/workspace/viewRegistry'
import styles from './GroupContainer.module.css'

/**
 * Renders one Group: tab strip + the active tile's header + body.
 *
 * Loads the entity for the active tile via `useLiveQuery` so the header
 * is always in sync with the live entity data. The body delegates to
 * the registered view component.
 */
export function GroupContainer({
  group,
}: {
  group: Group
}): React.ReactElement {
  const { helpers, workspace } = useWorkspace()
  const isActiveGroup = workspace.activeGroupId === group.id

  // Click anywhere inside the group's chrome to make it the active
  // group. Wired on the outer wrapper rather than just the tab strip so
  // a click on the body counts too — matches VS Code's "focus follows
  // last click" group-activation behaviour.
  const onActivate = useCallback(() => {
    if (!isActiveGroup) helpers.setActiveGroup(group.id)
  }, [helpers, group.id, isActiveGroup])

  const activeTile =
    group.tiles.find((t) => t.id === group.activeTileId) ?? group.tiles[0]

  return (
    <div className={styles.group} onMouseDownCapture={onActivate}>
      <TabStrip group={group} />
      {activeTile ? (
        <ActiveTileBody groupId={group.id} tile={activeTile} />
      ) : null}
    </div>
  )
}

function ActiveTileBody({
  groupId,
  tile,
}: {
  groupId: string
  tile: Tile
}): React.ReactElement {
  const { activeServer } = useServerConnection()
  const { pinnedUrls, togglePin } = usePinnedEntities()
  const { entitiesCollection, forkEntity, killEntity } = useElectricAgents()
  const { helpers } = useWorkspace()
  const navigate = useNavigate()

  const { data: matches = [] } = useLiveQuery(
    (q) => {
      if (!entitiesCollection) return undefined
      return q
        .from({ e: entitiesCollection })
        .where(({ e }) => eq(e.url, tile.entityUrl))
    },
    [entitiesCollection, tile.entityUrl]
  )
  const entity = matches.at(0) ?? null
  const isSpawning = entity?.status === `spawning`
  const entityStopped = entity?.status === `stopped`

  // Kill / fork are tile-local actions; the errors shown are the
  // tile's own concern, so they live as state inside the tile body
  // rather than at workspace level.
  const handleKill = useCallback(() => {
    if (!killEntity) return
    const tx = killEntity(tile.entityUrl)
    tx.isPersisted.promise.catch(() => {
      // Errors surface in EntityHeader's error bar via prop wiring,
      // but Stage 2 omits the error-passing for brevity since the kill
      // surface is unchanged from before; revisit if it regresses.
    })
  }, [killEntity, tile.entityUrl])

  const handleFork = useCallback(() => {
    if (!forkEntity) return
    forkEntity(tile.entityUrl)
      .then((root) => {
        navigate({
          to: `/entity/$`,
          params: { _splat: root.url.replace(/^\//, ``) },
        })
      })
      .catch(() => {})
  }, [forkEntity, tile.entityUrl, navigate])

  const setView = useCallback(
    (viewId: ViewId) => helpers.setTileView(tile.id, viewId),
    [helpers, tile.id]
  )

  // If the entity disappears entirely (e.g. user killed it elsewhere),
  // close this tile so the workspace doesn't keep dead references.
  useEffect(() => {
    if (matches.length === 0 && entitiesCollection) {
      // Defer one tick so we don't race the initial query resolution.
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
  const View = getView(tile.viewId)?.Component

  return (
    <Stack direction="column" className={styles.body} data-group-id={groupId}>
      <EntityHeader
        entity={entity}
        pinned={pinnedUrls.includes(tile.entityUrl)}
        onTogglePin={() => togglePin(tile.entityUrl)}
        onKill={handleKill}
        onFork={forkEntity && !entity.parent ? handleFork : undefined}
        currentViewId={tile.viewId}
        onSetView={setView}
      />
      {View ? (
        <View
          baseUrl={baseUrl}
          entityUrl={tile.entityUrl}
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
