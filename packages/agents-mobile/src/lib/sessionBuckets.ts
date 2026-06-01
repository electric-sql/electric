import type { ElectricEntity } from './agentsClient'

/**
 * Date-bucketed grouping for the sessions list — mirrors
 * `packages/agents-server-ui/src/lib/sessionGroups.ts` so the mobile
 * sidebar reads the same as the web one.
 *
 * Buckets are filled in this order, and empty buckets are dropped:
 *   1. Today              — same calendar day as `now`
 *   2. Yesterday          — previous calendar day
 *   3. Previous 7 days    — calendar days 2..7 ago
 *   4. Previous 30 days   — days 8..30 ago
 *   5. <Month YYYY>       — one bucket per month, newest first, up to ~1y
 *   6. Older              — anything ≥ 1 year old
 */

export type BucketKey =
  | `today`
  | `yesterday`
  | `last7`
  | `last30`
  | `older`
  | `month`

export type SessionGroup = {
  id: string
  key: BucketKey
  label: string
  items: Array<ElectricEntity>
}

const MONTH_NAMES = [
  `January`,
  `February`,
  `March`,
  `April`,
  `May`,
  `June`,
  `July`,
  `August`,
  `September`,
  `October`,
  `November`,
  `December`,
]

function toMillis(ts: number): number {
  return ts < 1e12 ? ts * 1000 : ts
}

function startOfDay(d: Date): Date {
  const out = new Date(d)
  out.setHours(0, 0, 0, 0)
  return out
}

function daysBetween(a: Date, b: Date): number {
  const ms = startOfDay(a).getTime() - startOfDay(b).getTime()
  return Math.round(ms / 86_400_000)
}

export function groupByType(
  entities: ReadonlyArray<ElectricEntity>
): Array<SessionGroup> {
  const buckets = new Map<string, SessionGroup>()
  for (const entity of [...entities].sort(
    (a, b) => b.updated_at - a.updated_at
  )) {
    const t = entity.type
    let group = buckets.get(t)
    if (!group) {
      group = mk(`type-${t}`, `older`, formatLabel(t))
      buckets.set(t, group)
    }
    group.items.push(entity)
  }
  return Array.from(buckets.values()).sort((a, b) => {
    const sizeDelta = b.items.length - a.items.length
    if (sizeDelta !== 0) return sizeDelta
    return a.label.localeCompare(b.label)
  })
}

const STATUS_ORDER: Record<string, number> = {
  running: 0,
  idle: 1,
  paused: 2,
  spawning: 3,
  stopping: 4,
  stopped: 5,
  killed: 6,
}

export function groupByStatus(
  entities: ReadonlyArray<ElectricEntity>
): Array<SessionGroup> {
  const buckets = new Map<string, SessionGroup>()
  for (const entity of [...entities].sort(
    (a, b) => b.updated_at - a.updated_at
  )) {
    const s = entity.status
    let group = buckets.get(s)
    if (!group) {
      group = mk(`status-${s}`, `older`, formatLabel(s))
      buckets.set(s, group)
    }
    group.items.push(entity)
  }
  return Array.from(buckets.values()).sort((a, b) => {
    const ax = STATUS_ORDER[a.id.replace(`status-`, ``)] ?? 99
    const bx = STATUS_ORDER[b.id.replace(`status-`, ``)] ?? 99
    return ax - bx
  })
}

function formatLabel(id: string): string {
  return id.replace(/[-_]+/g, ` `).replace(/\b\w/g, (c) => c.toUpperCase())
}

export function bucketEntities(
  entities: ReadonlyArray<ElectricEntity>,
  now: Date = new Date()
): Array<SessionGroup> {
  const today: SessionGroup = mk(`today`, `today`, `Today`)
  const yesterday: SessionGroup = mk(`yesterday`, `yesterday`, `Yesterday`)
  const last7: SessionGroup = mk(`last7`, `last7`, `Previous 7 days`)
  const last30: SessionGroup = mk(`last30`, `last30`, `Previous 30 days`)
  const older: SessionGroup = mk(`older`, `older`, `Older`)
  const months = new Map<string, SessionGroup>()

  const sorted = [...entities].sort((a, b) => b.updated_at - a.updated_at)

  for (const entity of sorted) {
    const updated = new Date(toMillis(entity.updated_at))
    const days = daysBetween(now, updated)
    if (days <= 0) {
      today.items.push(entity)
    } else if (days === 1) {
      yesterday.items.push(entity)
    } else if (days <= 7) {
      last7.items.push(entity)
    } else if (days <= 30) {
      last30.items.push(entity)
    } else if (days <= 365) {
      const tag = `${updated.getFullYear()}-${String(updated.getMonth() + 1).padStart(2, `0`)}`
      const id = `month-${tag}`
      let group = months.get(id)
      if (!group) {
        const label = `${MONTH_NAMES[updated.getMonth()]} ${updated.getFullYear()}`
        group = mk(id, `month`, label)
        months.set(id, group)
      }
      group.items.push(entity)
    } else {
      older.items.push(entity)
    }
  }

  const monthGroups = Array.from(months.values()).sort((a, b) =>
    a.id < b.id ? 1 : -1
  )
  return [today, yesterday, last7, last30, ...monthGroups, older].filter(
    (g) => g.items.length > 0
  )
}

function mk(id: string, key: BucketKey, label: string): SessionGroup {
  return { id, key, label, items: [] }
}
