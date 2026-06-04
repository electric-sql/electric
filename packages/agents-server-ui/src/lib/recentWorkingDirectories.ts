import { getEntityRunnerId } from './entityRuntime'
import type { ElectricEntity } from './ElectricAgentsProvider'

const MAX_RECENTS = 10

/**
 * Per-runner recent working directories, derived from the synced entities
 * collection: every session row carries the `spawn_args.workingDirectory` it
 * was spawned with and the runner it was dispatched to, so the recents list
 * is just the most recently used paths across the user's sessions on that
 * runner. Derived facts, not a curated list — no storage, no migration, and
 * the same list appears on every device the entities shape syncs to.
 */
export function recentWorkingDirsForRunner(
  entities: ReadonlyArray<
    Pick<ElectricEntity, `spawn_args` | `dispatch_policy` | `updated_at`>
  >,
  runnerId: string
): Array<string> {
  const newestByPath = new Map<string, number>()
  for (const entity of entities) {
    if (getEntityRunnerId(entity) !== runnerId) continue
    const raw = entity.spawn_args?.workingDirectory
    if (typeof raw !== `string` || raw.trim().length === 0) continue
    const seen = newestByPath.get(raw)
    if (seen === undefined || entity.updated_at > seen) {
      newestByPath.set(raw, entity.updated_at)
    }
  }
  return Array.from(newestByPath.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_RECENTS)
    .map(([path]) => path)
}
