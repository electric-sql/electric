import { useCallback, useEffect, useRef, useState } from 'react'
import { useWorkspace } from '../../hooks/useWorkspace'
import {
  isWorkspaceDrag,
  readDragPayload,
} from '../../lib/workspace/dragPayload'
import type { DropPosition } from '../../lib/workspace/types'
import styles from './DropOverlay.module.css'

/**
 * Visualises and resolves the 5-zone drop target on top of a Group.
 *
 * Wraps a containing relative element. When a workspace drag starts
 * anywhere in the document we "arm" — pointer-events flip on so this
 * element can intercept `dragover`/`drop` events. While armed, we
 * compute which of the 5 zones the cursor is in (using the group's
 * client rect + a 25% inset for the centre square) and highlight that
 * zone. On `drop` we either:
 *
 * - move an existing tile into this group (`tile` payload), or
 * - open a sidebar entity into this group (`sidebar-entity` payload).
 *
 * The overlay is the only DnD-aware element per group — keeping the
 * pointer-events toggle here means splitter drags / text selection in
 * the body aren't affected when no drag is in progress.
 */
export function DropOverlay({
  groupId,
  containerRef,
}: {
  groupId: string
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
      // Centre square (matches CSS .center inset:25%)
      if (x >= 0.25 && x <= 0.75 && y >= 0.25 && y <= 0.75) return `center`
      // Pick the dominant edge by relative distance from the centre.
      // We compare normalised |x-.5| vs |y-.5| so square groups map
      // cleanly into 4 triangle slabs joined at the centre.
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
        // No-op when dropping a tile back onto its source group's
        // centre — the reducer's same-group append handles this, but
        // skipping the dispatch saves a render.
        if (
          payload.sourceGroupId === groupId &&
          (position === `append` || position === `replace`)
        ) {
          return
        }
        helpers.moveTile(payload.tileId, { groupId, position })
      } else {
        helpers.openEntity(payload.entityUrl, {
          viewId: payload.viewId,
          target: { groupId, position },
        })
      }
    },
    [computeZone, helpers, groupId]
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
      data-group-id={groupId}
    >
      {([`center`, `north`, `east`, `south`, `west`] as const).map((z) => (
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

type Zone = `center` | `north` | `east` | `south` | `west`

const ZONE_TO_POSITION: Record<Zone, DropPosition> = {
  center: `append`,
  north: `split-up`,
  east: `split-right`,
  south: `split-down`,
  west: `split-left`,
}
