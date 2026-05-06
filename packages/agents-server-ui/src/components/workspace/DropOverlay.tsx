import { useCallback, useEffect, useRef, useState } from 'react'
import { useWorkspace } from '../../hooks/useWorkspace'
import {
  isWorkspaceDrag,
  readDragPayload,
} from '../../lib/workspace/dragPayload'
import type { DropPosition } from '../../lib/workspace/types'
import styles from './DropOverlay.module.css'

/**
 * Visualises and resolves the 4-edge drop target on top of a Tile.
 *
 * Wraps a containing relative element. When a workspace drag starts
 * anywhere in the document we "arm" — pointer-events flip on so this
 * element can intercept `dragover`/`drop` events. While armed, we
 * compute which of the 4 edges the cursor is closest to and highlight
 * that zone. On `drop` we either:
 *
 * - move an existing tile (`tile` payload) to that side of this tile, or
 * - open a sidebar entity (`sidebar-entity` payload) as a new split.
 *
 * There is intentionally no centre zone: drops always create a new
 * split. To swap the contents of an existing tile in place, switch the
 * view from the tile menu or click the entity in the sidebar.
 */
export function DropOverlay({
  tileId,
  containerRef,
}: {
  tileId: string
  containerRef: React.RefObject<HTMLDivElement | null>
}): React.ReactElement {
  const { helpers } = useWorkspace()
  const [armed, setArmed] = useState(false)
  const [hoverZone, setHoverZone] = useState<Zone | null>(null)
  const overlayRef = useRef<HTMLDivElement>(null)

  // Arm whenever a workspace drag starts anywhere in the window. Use
  // window-level listeners (rather than wiring `dragstart` on every
  // draggable source) so adding a new draggable source doesn't need
  // changes here.
  useEffect(() => {
    const onStart = (e: DragEvent) => {
      if (!isWorkspaceDrag(e)) return
      setArmed(true)
    }
    const onEnd = () => {
      setArmed(false)
      setHoverZone(null)
    }
    window.addEventListener(`dragstart`, onStart)
    window.addEventListener(`dragend`, onEnd)
    window.addEventListener(`drop`, onEnd)
    return () => {
      window.removeEventListener(`dragstart`, onStart)
      window.removeEventListener(`dragend`, onEnd)
      window.removeEventListener(`drop`, onEnd)
    }
  }, [])

  const computeZone = useCallback(
    (e: React.DragEvent): Zone | null => {
      const el = containerRef.current
      if (!el) return null
      const rect = el.getBoundingClientRect()
      const x = (e.clientX - rect.left) / rect.width
      const y = (e.clientY - rect.top) / rect.height
      // Outside (e.g. cursor wandered off): no zone.
      if (x < 0 || x > 1 || y < 0 || y > 1) return null
      // Pick the dominant edge by relative distance from the centre.
      // Comparing |x-.5| vs |y-.5| splits the tile into four triangles
      // joined at the centre point — there's no neutral middle, so any
      // drop inside the tile falls into exactly one edge zone.
      const dx = Math.abs(x - 0.5)
      const dy = Math.abs(y - 0.5)
      if (dx > dy) return x < 0.5 ? `west` : `east`
      return y < 0.5 ? `north` : `south`
    },
    [containerRef]
  )

  const onDragOver = useCallback(
    (e: React.DragEvent) => {
      if (!isWorkspaceDrag(e)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = `move`
      const z = computeZone(e)
      setHoverZone(z)
    },
    [computeZone]
  )

  const onDragLeave = useCallback((e: React.DragEvent) => {
    // Only clear when leaving the overlay element itself, not when
    // the cursor crosses a child element inside it.
    if (e.currentTarget === overlayRef.current) {
      setHoverZone(null)
    }
  }, [])

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      const z = computeZone(e)
      const payload = readDragPayload(e)
      setHoverZone(null)
      setArmed(false)
      if (!z || !payload) return
      e.preventDefault()
      const position = ZONE_TO_POSITION[z]

      if (payload.kind === `tile`) {
        // Drop-on-self: no-op (the reducer also guards this, but a
        // local check saves a dispatch + render).
        if (payload.tileId === tileId) return
        helpers.moveTile(payload.tileId, { tileId, position })
      } else if (payload.kind === `sidebar-new-session`) {
        // Always create a *fresh* standalone tile — the click flow on
        // the same button focuses an existing new-session tile, this
        // drag flow is the user's explicit "give me another one"
        // gesture.
        helpers.openNewSession({ target: { tileId, position } })
      } else {
        helpers.openEntity(payload.entityUrl, {
          viewId: payload.viewId,
          target: { tileId, position },
        })
      }
    },
    [computeZone, helpers, tileId]
  )

  const cls = [styles.overlay, armed ? styles.armed : null]
    .filter(Boolean)
    .join(` `)

  return (
    <div
      ref={overlayRef}
      className={cls}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      data-tile-id={tileId}
    >
      {([`north`, `east`, `south`, `west`] as const).map((z) => (
        <div
          key={z}
          className={`${styles.zone} ${styles[z]} ${
            hoverZone === z ? styles.zoneActive : ``
          }`}
        />
      ))}
    </div>
  )
}

type Zone = `north` | `east` | `south` | `west`

const ZONE_TO_POSITION: Record<Zone, DropPosition> = {
  north: `split-up`,
  east: `split-right`,
  south: `split-down`,
  west: `split-left`,
}
