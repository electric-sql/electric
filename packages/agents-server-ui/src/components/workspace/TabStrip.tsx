import { X } from 'lucide-react'
import { useLiveQuery } from '@tanstack/react-db'
import { eq } from '@tanstack/db'
import { useElectricAgents } from '../../lib/ElectricAgentsProvider'
import { useWorkspace } from '../../hooks/useWorkspace'
import { getView } from '../../lib/workspace/viewRegistry'
import { getEntityDisplayTitle } from '../../lib/entityDisplay'
import { setDragPayload } from '../../lib/workspace/dragPayload'
import type { Group, Tile } from '../../lib/workspace/types'
import styles from './TabStrip.module.css'

/**
 * The tab strip across the top of a Group. Renders one button per tile
 * with the entity's short display title (or the entity URL when the
 * entity isn't loaded yet) plus a small close `×`.
 *
 * Stage 2 has no DnD on tabs yet — clicking activates, middle-click
 * closes. Drag-to-rearrange and drop targets land in Stage 4.
 *
 * The strip is hidden entirely when a group has only one tile, matching
 * the look of the pre-tile UI: a single tile reads as "the page" and a
 * tab labelled identically would be visual noise.
 */
export function TabStrip({
  group,
}: {
  group: Group
}): React.ReactElement | null {
  const { helpers } = useWorkspace()

  if (group.tiles.length <= 1) return null

  const onMiddleClickClose = (e: React.MouseEvent, tileId: string) => {
    if (e.button === 1) {
      e.preventDefault()
      helpers.closeTile(tileId)
    }
  }

  return (
    <div className={styles.strip} role="tablist">
      {group.tiles.map((tile) => {
        const active = tile.id === group.activeTileId
        return (
          <button
            key={tile.id}
            type="button"
            role="tab"
            aria-selected={active}
            className={`${styles.tab} ${active ? styles.activeTab : ``}`}
            draggable
            onDragStart={(e) =>
              setDragPayload(e, {
                kind: `tile`,
                tileId: tile.id,
                sourceGroupId: group.id,
              })
            }
            onClick={() => helpers.setActiveTile(tile.id)}
            onMouseDown={(e) => onMiddleClickClose(e, tile.id)}
          >
            <TabLabel tile={tile} />
            <span
              className={styles.closeBtn}
              role="button"
              aria-label="Close tile"
              onClick={(e) => {
                e.stopPropagation()
                helpers.closeTile(tile.id)
              }}
            >
              <X size={12} />
            </span>
          </button>
        )
      })}
    </div>
  )
}

/**
 * Resolves the display label for a single tab. Looks up the entity by
 * `entityUrl` so we can show its short title (e.g. "foo-123") rather
 * than the raw URL.
 *
 * If a view defines a non-default `shortLabel` it's appended in
 * parentheses so two tabs of the same entity but different views are
 * distinguishable: `foo-123 (State Explorer)`.
 */
function TabLabel({ tile }: { tile: Tile }): React.ReactElement {
  const { entitiesCollection } = useElectricAgents()
  const { data: matches = [] } = useLiveQuery(
    (q) => {
      if (!entitiesCollection) return undefined
      return q
        .from({ e: entitiesCollection })
        .where(({ e }) => eq(e.url, tile.entityUrl))
    },
    [entitiesCollection, tile.entityUrl]
  )
  const entity = matches.at(0)
  const baseLabel = entity
    ? getEntityDisplayTitle(entity).title
    : tile.entityUrl.replace(/^\//, ``)
  const view = getView(tile.viewId)
  const showViewLabel = view && view.id !== `chat`
  const display = showViewLabel
    ? `${baseLabel} (${view.shortLabel ?? view.label})`
    : baseLabel
  return (
    <span className={styles.label} title={display}>
      {display}
    </span>
  )
}
