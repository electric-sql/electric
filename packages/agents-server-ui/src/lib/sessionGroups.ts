import type { ElectricEntity } from './ElectricAgentsProvider'

/**
 * Session list grouping by recency.
 *
 * Buckets are filled in this order, and empty buckets are dropped from
 * the result:
 *
 *   1. Today              — same calendar day as `now`
 *   2. Yesterday          — previous calendar day
 *   3. Previous 7 days    — calendar days 2..7 ago (rolling, not ISO week)
 *   4. Previous 30 days   — days 8..30 ago (rolling)
 *   5. <Month YYYY>       — one bucket per month, newest first, for
 *                           anything older than 30 days but within ~1 year
 *   6. Older              — anything ≥ 1 year old
 *
 * `updated_at` may arrive as either seconds-since-epoch or
 * milliseconds-since-epoch (the Electric backend has historically sent
 * both shapes). `normaliseTimestamp` below handles both — anything ≤ 1e12
 * is treated as seconds and multiplied up.
 */

export type BucketKey =
  | `today`
  | `yesterday`
  | `last7`
  | `last30`
  | `older`
  | `month`

export type SessionGroup = {
  /** Stable identifier — for `month` buckets includes the YYYY-MM tag. */
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

export function bucketEntities(
  entities: ReadonlyArray<ElectricEntity>,
  now: Date = new Date()
): Array<SessionGroup> {
  const today = new Group(`today`, `today`, `Today`)
  const yesterday = new Group(`yesterday`, `yesterday`, `Yesterday`)
  const last7 = new Group(`last7`, `last7`, `Previous 7 days`)
  const last30 = new Group(`last30`, `last30`, `Previous 30 days`)
  const months = new Map<string, Group>()
  const older = new Group(`older`, `older`, `Older`)

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
        group = new Group(id, `month`, label)
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

class Group implements SessionGroup {
  items: Array<ElectricEntity> = []
  constructor(
    public id: string,
    public key: BucketKey,
    public label: string
  ) {}
}

/**
 * Group by entity `type`, sorted by group size (most populous group
 * first) and then alphabetically. Inside each group entities are
 * ordered by `updated_at` descending — same as the date buckets — so
 * the most recently touched entity in any group is always at the top.
 */
export function groupByType(
  entities: ReadonlyArray<ElectricEntity>
): Array<SessionGroup> {
  const buckets = new Map<string, Group>()
  for (const entity of [...entities].sort(
    (a, b) => b.updated_at - a.updated_at
  )) {
    const t = entity.type
    let group = buckets.get(t)
    if (!group) {
      group = new Group(`type-${t}`, `older`, formatLabel(t))
      buckets.set(t, group)
    }
    group.items.push(entity)
  }
  return Array.from(buckets.values()).sort((a, b) => {
    const dx = b.items.length - a.items.length
    if (dx !== 0) return dx
    return a.label.localeCompare(b.label)
  })
}

/**
 * Group by `status`, ordered by lifecycle (running → idle → spawning
 * → stopped) so the user's eye lands on currently-active sessions
 * first. Same in-group sort as `groupByType`.
 */
const STATUS_ORDER: Record<string, number> = {
  running: 0,
  idle: 1,
  spawning: 2,
  stopped: 3,
}

export function groupByStatus(
  entities: ReadonlyArray<ElectricEntity>
): Array<SessionGroup> {
  const buckets = new Map<string, Group>()
  for (const entity of [...entities].sort(
    (a, b) => b.updated_at - a.updated_at
  )) {
    const s = entity.status
    let group = buckets.get(s)
    if (!group) {
      group = new Group(`status-${s}`, `older`, formatLabel(s))
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

/** Title-case a snake_case / kebab-case identifier for use as a label. */
function formatLabel(id: string): string {
  return id.replace(/[-_]+/g, ` `).replace(/\b\w/g, (c) => c.toUpperCase())
}
