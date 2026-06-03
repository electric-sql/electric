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

/**
 * Verbose absolute timestamp used as tooltip content on short
 * `HH:MM` chat metadata. Includes weekday + seconds so the user can
 * disambiguate identical-minute events, e.g.
 * `Monday, 4 May 2026 at 14:18:05`.
 */
export function formatAbsoluteDateTimeVerbose(ts: number): string {
  const d = new Date(toMillis(ts))
  return d.toLocaleString(undefined, {
    weekday: `long`,
    day: `numeric`,
    month: `long`,
    year: `numeric`,
    hour: `2-digit`,
    minute: `2-digit`,
    second: `2-digit`,
  })
}

/**
 * Compact elapsed-duration label intended for live "thinking" timers
 * (next to the agent's `Thinking` indicator while a response is in
 * flight). Returns one of:
 *   - `0s` … `59s`
 *   - `1m`, `1m 5s`, `12m 7s`
 *   - `1h`, `1h 3m`, `2h 47m`
 *
 * Takes raw milliseconds (the caller is expected to have already
 * subtracted the start timestamp); not seconds/ms-ambiguous like
 * `toMillis`, since the input is a duration, not a wall-clock value.
 */
export function formatElapsedDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  if (total < 60) return `${total}s`
  if (total < 3600) {
    const m = Math.floor(total / 60)
    const s = total % 60
    return s === 0 ? `${m}m` : `${m}m ${s}s`
  }
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

/** Short clock-style label, e.g. `14:18`. Locale chooses 24h vs am/pm. */
export function formatShortTime(ts: number): string {
  const d = new Date(toMillis(ts))
  return d.toLocaleTimeString([], {
    hour: `2-digit`,
    minute: `2-digit`,
  })
}

/**
 * Chat metadata timestamp:
 *   - today: time only
 *   - earlier this week: weekday + time
 *   - older: date + time
 */
export function formatChatTimestamp(
  ts: number,
  now: number = Date.now()
): string {
  const d = new Date(toMillis(ts))
  const today = new Date(now)
  const isToday =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate()

  if (isToday) return formatShortTime(ts)

  const startOfWeek = new Date(today)
  startOfWeek.setHours(0, 0, 0, 0)
  const day = startOfWeek.getDay()
  const mondayOffset = day === 0 ? -6 : 1 - day
  startOfWeek.setDate(startOfWeek.getDate() + mondayOffset)

  if (d < startOfWeek) {
    return d.toLocaleString([], {
      day: `numeric`,
      month: `short`,
      hour: `2-digit`,
      minute: `2-digit`,
    })
  }

  return d.toLocaleString([], {
    weekday: `short`,
    hour: `2-digit`,
    minute: `2-digit`,
  })
}
