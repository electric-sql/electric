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
