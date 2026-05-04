import type { ViewId } from './viewRegistry'

/**
 * Payload carried by every workspace drag operation. Encoded as JSON
 * into the `dataTransfer` slot under our custom MIME type so the browser
 * doesn't try to interpret it as text/plain or a URL.
 *
 * Two kinds today:
 * - `sidebar-entity` — the user dragged an entity row out of the sidebar.
 *   No `viewId` is carried because the receiving group decides how to
 *   render it (defaults to `chat`).
 * - `tile` — the user dragged an existing tile (from a tab or a tile
 *   header). Carries the source group id so the reducer can detect a
 *   no-op (drop-on-self) and skip the round-trip.
 */
export type WorkspaceDragPayload =
  | {
      kind: `sidebar-entity`
      entityUrl: string
      viewId?: ViewId
    }
  | {
      kind: `tile`
      tileId: string
      sourceGroupId: string
    }

/**
 * Custom MIME type for our payload. Browsers expose drag types in
 * lowercase, so we never check this string with case-sensitivity. The
 * `application/vnd.electric-tile+json` form follows RFC 6838 vendor
 * tree conventions to make it obvious this is our app's private wire
 * format.
 */
export const DRAG_MIME = `application/vnd.electric-tile+json`

export function setDragPayload(
  e: DragEvent | React.DragEvent,
  payload: WorkspaceDragPayload
): void {
  const dt = (e as DragEvent).dataTransfer
  if (!dt) return
  dt.setData(DRAG_MIME, JSON.stringify(payload))
  // Some browsers (Safari especially) only honour text/plain — set a
  // human-readable fallback too. The receiver always reads the typed
  // form first.
  dt.setData(`text/plain`, describePayload(payload))
  dt.effectAllowed = `move`
}

export function readDragPayload(
  e: DragEvent | React.DragEvent
): WorkspaceDragPayload | null {
  const dt = (e as DragEvent).dataTransfer
  if (!dt) return null
  const raw = dt.getData(DRAG_MIME)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as WorkspaceDragPayload
    if (
      parsed.kind === `sidebar-entity` &&
      typeof parsed.entityUrl === `string`
    ) {
      return parsed
    }
    if (
      parsed.kind === `tile` &&
      typeof parsed.tileId === `string` &&
      typeof parsed.sourceGroupId === `string`
    ) {
      return parsed
    }
  } catch {
    // Malformed payload — silently ignore; the drop becomes a no-op.
  }
  return null
}

/**
 * Sniff the dataTransfer types list during `dragover` (when the actual
 * payload data isn't readable for security reasons in most browsers,
 * only the type list is). Used to gate `dragover`'s `preventDefault`
 * so we only intercept drags that originated inside the workspace.
 */
export function isWorkspaceDrag(e: DragEvent | React.DragEvent): boolean {
  const dt = (e as DragEvent).dataTransfer
  if (!dt) return false
  // dt.types is a DOMStringList (or string[]) depending on browser.
  for (let i = 0; i < dt.types.length; i++) {
    if (dt.types[i].toLowerCase() === DRAG_MIME) return true
  }
  return false
}

function describePayload(p: WorkspaceDragPayload): string {
  return p.kind === `sidebar-entity`
    ? `entity: ${p.entityUrl}`
    : `tile: ${p.tileId}`
}
