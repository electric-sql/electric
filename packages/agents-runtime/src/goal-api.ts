import { entityStateSchema } from './entity-schema'
import type { ChangeEvent } from '@durable-streams/state'
import type {
  EntityStreamDBWithActions,
  GoalEntry,
  GoalInput,
  ManifestGoalEntry,
  WakeSession,
} from './types'

export interface GoalApi {
  setGoal: (input: GoalInput) => GoalEntry
  clearGoal: () => boolean
  getGoal: () => GoalEntry | undefined
  markGoalComplete: () => GoalEntry | undefined
  markGoalBudgetLimited: () => GoalEntry | undefined
  /**
   * Persist an accurate `tokensUsed` from an authoritative source (e.g. the
   * runtime's in-memory step accumulator, which doesn't suffer from the
   * round-trip lag of summing the steps collection). Optionally also flips
   * status. Never decreases `tokensUsed`.
   */
  updateGoalUsage: (
    tokensUsed: number,
    opts?: { status?: GoalEntry[`status`] }
  ) => GoalEntry | undefined
  // Fallback recompute from the steps collection. Used by handlers that
  // don't manage token tracking themselves. Never decreases `tokensUsed` —
  // an explicit `updateGoalUsage` call wins over a stale collection sum.
  refreshGoalUsage: () => number | undefined
}

export const GOAL_MANIFEST_KEY = `goal`
const GOAL_ID = `goal`
export const DEFAULT_TOKEN_BUDGET = 50_000

function isGoalManifest(
  row: unknown
): row is Record<string, unknown> & { kind: `goal` } {
  return (
    typeof row === `object` &&
    row !== null &&
    (row as { kind?: unknown }).kind === `goal`
  )
}

function toGoalEntry(row: Record<string, unknown>): GoalEntry {
  const rawBudget = row.tokenBudget
  const tokenBudget =
    rawBudget === null
      ? null
      : typeof rawBudget === `number`
        ? rawBudget
        : DEFAULT_TOKEN_BUDGET
  return {
    id: String(row.id ?? GOAL_ID),
    objective: String(row.objective ?? ``),
    status: (row.status ?? `active`) as GoalEntry[`status`],
    tokenBudget,
    tokensUsed: typeof row.tokensUsed === `number` ? row.tokensUsed : 0,
    tokensAtCreation:
      typeof row.tokensAtCreation === `number` ? row.tokensAtCreation : 0,
    createdAt: typeof row.createdAt === `number` ? row.createdAt : 0,
    updatedAt: typeof row.updatedAt === `number` ? row.updatedAt : 0,
  }
}

export function sumStepTokens(db: EntityStreamDBWithActions): number {
  let total = 0
  for (const row of db.collections.steps.toArray) {
    const r = row as Record<string, unknown>
    if (typeof r.input_tokens === `number`) total += r.input_tokens
    if (typeof r.output_tokens === `number`) total += r.output_tokens
  }
  return total
}

export function createGoalApi(opts: {
  db: EntityStreamDBWithActions
  wakeSession: WakeSession
  writeEvent?: (event: ChangeEvent) => void
  now?: () => number
}): GoalApi {
  const now = opts.now ?? (() => Date.now())

  function readRaw():
    | (ManifestGoalEntry & Record<string, unknown>)
    | undefined {
    for (const row of opts.db.collections.manifests.toArray) {
      if (isGoalManifest(row)) {
        return row as ManifestGoalEntry & Record<string, unknown>
      }
    }
    return undefined
  }

  function readLive(): GoalEntry | undefined {
    const raw = readRaw()
    return raw ? toGoalEntry(raw) : undefined
  }

  function persist(entry: ManifestGoalEntry): GoalEntry {
    opts.wakeSession.registerManifestEntry(entry)
    return toGoalEntry(entry as unknown as Record<string, unknown>)
  }

  return {
    setGoal(input) {
      const existing = readRaw()
      const timestamp = now()
      const isSameObjective = existing?.objective === input.objective
      const tokenBudget =
        input.tokenBudget === undefined
          ? DEFAULT_TOKEN_BUDGET
          : input.tokenBudget
      const tokensAtCreation = isSameObjective
        ? typeof existing?.tokensAtCreation === `number`
          ? existing.tokensAtCreation
          : 0
        : sumStepTokens(opts.db)
      const entry: ManifestGoalEntry = {
        key: GOAL_MANIFEST_KEY,
        kind: `goal`,
        id: GOAL_ID,
        objective: input.objective,
        status: input.status ?? `active`,
        tokenBudget,
        tokensUsed: isSameObjective
          ? typeof existing?.tokensUsed === `number`
            ? existing.tokensUsed
            : 0
          : 0,
        tokensAtCreation,
        createdAt:
          isSameObjective && typeof existing?.createdAt === `number`
            ? existing.createdAt
            : timestamp,
        updatedAt: timestamp,
      }
      return persist(entry)
    },

    clearGoal() {
      return opts.wakeSession.removeManifestEntry(GOAL_MANIFEST_KEY)
    },

    getGoal() {
      return readLive()
    },

    markGoalComplete() {
      const existing = readRaw()
      if (!existing) return undefined
      const next: ManifestGoalEntry = {
        ...(existing as unknown as ManifestGoalEntry),
        key: GOAL_MANIFEST_KEY,
        kind: `goal`,
        status: `complete`,
        updatedAt: now(),
      }
      return persist(next)
    },

    markGoalBudgetLimited() {
      const existing = readRaw()
      if (!existing) return undefined
      const next: ManifestGoalEntry = {
        ...(existing as unknown as ManifestGoalEntry),
        key: GOAL_MANIFEST_KEY,
        kind: `goal`,
        status: `budget_limited`,
        updatedAt: now(),
      }
      return persist(next)
    },

    updateGoalUsage(tokensUsed, opts2) {
      const existing = readRaw()
      if (!existing) return undefined
      const previousTokens =
        typeof existing.tokensUsed === `number` ? existing.tokensUsed : 0
      // Never decrease — guards against a stale value clobbering a fresher one.
      const nextTokens = Math.max(previousTokens, Math.max(0, tokensUsed))
      const nextStatus = (opts2?.status ??
        existing.status ??
        `active`) as ManifestGoalEntry[`status`]
      if (nextTokens === previousTokens && nextStatus === existing.status) {
        return toGoalEntry(existing as unknown as Record<string, unknown>)
      }
      const next: ManifestGoalEntry = {
        key: GOAL_MANIFEST_KEY,
        kind: `goal`,
        id: String(existing.id ?? GOAL_ID),
        objective: String(existing.objective ?? ``),
        status: nextStatus,
        tokenBudget:
          existing.tokenBudget === null
            ? null
            : typeof existing.tokenBudget === `number`
              ? existing.tokenBudget
              : DEFAULT_TOKEN_BUDGET,
        tokensUsed: nextTokens,
        tokensAtCreation:
          typeof existing.tokensAtCreation === `number`
            ? existing.tokensAtCreation
            : 0,
        createdAt:
          typeof existing.createdAt === `number` ? existing.createdAt : now(),
        updatedAt: now(),
      }
      // Live path: write the manifest update event directly to the entity
      // stream so the UI sees it during the run. The wake-session's manifest
      // transaction only commits at end-of-wake, which is too late for
      // per-step UI updates. Fall back to the transactional path if
      // writeEvent isn't wired (e.g. in tests).
      if (opts.writeEvent) {
        opts.writeEvent(
          entityStateSchema.manifests.update({
            key: GOAL_MANIFEST_KEY,
            value: next as never,
          }) as ChangeEvent
        )
        return toGoalEntry(next as unknown as Record<string, unknown>)
      }
      return persist(next)
    },

    refreshGoalUsage() {
      const existing = readRaw()
      if (!existing) return undefined
      const tokensAtCreation =
        typeof existing.tokensAtCreation === `number`
          ? existing.tokensAtCreation
          : 0
      const previousTokens =
        typeof existing.tokensUsed === `number` ? existing.tokensUsed : 0
      const currentTotal = sumStepTokens(opts.db)
      const computed = Math.max(0, currentTotal - tokensAtCreation)
      // Never decrease — an authoritative `updateGoalUsage` may have set a
      // higher value than the steps collection currently reflects (events
      // round-trip back into the local DB asynchronously).
      const tokensUsed = Math.max(previousTokens, computed)
      if (tokensUsed === previousTokens) return tokensUsed
      const next: ManifestGoalEntry = {
        key: GOAL_MANIFEST_KEY,
        kind: `goal`,
        id: String(existing.id ?? GOAL_ID),
        objective: String(existing.objective ?? ``),
        status: (existing.status ?? `active`) as ManifestGoalEntry[`status`],
        tokenBudget:
          existing.tokenBudget === null
            ? null
            : typeof existing.tokenBudget === `number`
              ? existing.tokenBudget
              : DEFAULT_TOKEN_BUDGET,
        tokensUsed,
        tokensAtCreation,
        createdAt:
          typeof existing.createdAt === `number` ? existing.createdAt : now(),
        updatedAt: now(),
      }
      opts.wakeSession.registerManifestEntry(next)
      return tokensUsed
    },
  }
}
