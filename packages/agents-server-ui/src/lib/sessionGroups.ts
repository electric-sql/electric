import type { ElectricEntity } from './ElectricAgentsProvider'
import { abbreviatePath, detectHomeDir, tildifyPath } from './pathDisplay'
import { getEntityRunnerId, shortenId } from './entityRuntime'

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
  /**
   * Optional longer-form text — useful as a tooltip when the
   * `label` had to be abbreviated to fit a confined column (e.g.
   * working-directory labels in the sidebar). Falls back to
   * `label` when omitted.
   */
  title?: string
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
    public label: string,
    public title?: string
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
 * Group by `status`, ordered by lifecycle so the user's eye lands on
 * currently-active sessions
 * first. Same in-group sort as `groupByType`.
 */
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

/**
 * Group by the pinned runner read from each entity's `dispatch_policy`.
 * `runnerLabelById` maps a runner id to its display label (resolved from the
 * runners collection by the caller); ids absent from the map fall back to a
 * shortened form. Entities with no pinned runner collect in a trailing "None"
 * bucket — same convention as `groupByWorkingDirectory`. Most-populous group
 * first, alphabetical tiebreaker.
 */
export function groupByRunner(
  entities: ReadonlyArray<ElectricEntity>,
  runnerLabelById: ReadonlyMap<string, string>
): Array<SessionGroup> {
  const buckets = new Map<string, Group>()
  const noRunner = new Group(`runner:none`, `older`, `None`)

  for (const entity of [...entities].sort(
    (a, b) => b.updated_at - a.updated_at
  )) {
    const runnerId = getEntityRunnerId(entity)
    if (runnerId === null) {
      noRunner.items.push(entity)
      continue
    }
    let group = buckets.get(runnerId)
    if (!group) {
      const label = runnerLabelById.get(runnerId) ?? shortenId(runnerId)
      group = new Group(`runner:${runnerId}`, `older`, label, runnerId)
      buckets.set(runnerId, group)
    }
    group.items.push(entity)
  }

  const runnerGroups = Array.from(buckets.values()).sort((a, b) => {
    const dx = b.items.length - a.items.length
    if (dx !== 0) return dx
    return a.label.localeCompare(b.label)
  })
  return noRunner.items.length > 0 ? [...runnerGroups, noRunner] : runnerGroups
}

/**
 * Group by `spawn_args.workingDirectory`. Entities without a working
 * directory fall into a single trailing "None" bucket so they're
 * still visible — hiding them would silently drop sessions that were
 * spawned through paths that don't carry a cwd (e.g. older sessions,
 * agent types other than horton).
 *
 * Group labels are tildified and abbreviated to fit a sidebar
 * column (`~/Code/electric`, `…/projects/acme`) — see
 * `pathDisplay.abbreviatePath` for the truncation rule. The full
 * absolute path is preserved on `title` so the sidebar can surface
 * it as a tooltip on hover. Sort order: most-populous first,
 * alphabetical tiebreaker on the label.
 */
export function groupByWorkingDirectory(
  entities: ReadonlyArray<ElectricEntity>
): Array<SessionGroup> {
  const buckets = new Map<string, Group>()
  const noDir = new Group(`cwd:none`, `older`, `None`)

  // Two passes: collect all paths first so `detectHomeDir` can sniff
  // the home prefix from the full set, then label each bucket using
  // that consistent home dir. Doing it per-entity would re-detect
  // home for each path and risk inconsistent labels across groups.
  const sortedEntities = [...entities].sort(
    (a, b) => b.updated_at - a.updated_at
  )
  const allPaths = sortedEntities
    .map((e) => e.spawn_args?.workingDirectory)
    .filter((p): p is string => typeof p === `string` && p.trim().length > 0)
  const homeDir = detectHomeDir(allPaths)

  for (const entity of sortedEntities) {
    const raw = entity.spawn_args?.workingDirectory
    const cwd = typeof raw === `string` && raw.trim().length > 0 ? raw : null
    if (cwd === null) {
      noDir.items.push(entity)
      continue
    }
    let group = buckets.get(cwd)
    if (!group) {
      const label = abbreviatePath(tildifyPath(cwd, homeDir))
      group = new Group(`cwd:${cwd}`, `older`, label, cwd)
      buckets.set(cwd, group)
    }
    group.items.push(entity)
  }

  const dirGroups = Array.from(buckets.values()).sort((a, b) => {
    const dx = b.items.length - a.items.length
    if (dx !== 0) return dx
    return a.label.localeCompare(b.label)
  })
  // "None" bucket always last so user-tagged groups dominate the
  // visual top of the list.
  return noDir.items.length > 0 ? [...dirGroups, noDir] : dirGroups
}
