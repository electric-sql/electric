/**
 * Tiny timestamp helpers used by the sidebar info popout (and any
 * other surface that needs to render entity timestamps consistently).
 *
 * Entity timestamps from the backend may arrive as either
 * seconds-since-epoch or milliseconds-since-epoch. `toMillis`
 * normalises that — anything ≤ 1e12 is treated as seconds and scaled
 * up. (Mirrors the helper in `sessionGroups.ts`.)
 */

export function toMillis(ts: number): number {
  return ts < 1e12 ? ts * 1000 : ts
}

/**
 * Compact "time ago" string suitable for hover-card meta lines.
 * Returns e.g. `just now`, `5m ago`, `2h ago`, `3d ago`, `4w ago`.
 * For anything older than ~1 year falls back to a year count.
 */
export function formatRelativeTime(
  ts: number,
  now: number = Date.now()
): string {
  const ms = toMillis(ts)
  const diff = Math.max(0, now - ms)
  const sec = Math.floor(diff / 1000)
  if (sec < 10) return `just now`
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  if (day < 7) return `${day}d ago`
  const week = Math.floor(day / 7)
  if (week < 5) return `${week}w ago`
  const month = Math.floor(day / 30)
  if (month < 12) return `${month}mo ago`
  const year = Math.floor(day / 365)
  return `${year}y ago`
}

/**
 * Absolute timestamp formatted in the user's locale, e.g.
 * `4 May 2026, 08:51`. Used for the spawn time line.
 */
export function formatAbsoluteDateTime(ts: number): string {
  const d = new Date(toMillis(ts))
  return d.toLocaleString(undefined, {
    day: `numeric`,
    month: `short`,
    year: `numeric`,
    hour: `2-digit`,
    minute: `2-digit`,
  })
}
