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
  markGoalComplete: (summary?: string) => GoalEntry | undefined
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
    ...(typeof row.summary === `string` && row.summary
      ? { summary: row.summary }
      : {}),
    createdAt: typeof row.createdAt === `string` ? row.createdAt : ``,
    updatedAt: typeof row.updatedAt === `string` ? row.updatedAt : ``,
  }
}

export function createGoalApi(opts: {
  db: EntityStreamDBWithActions
  wakeSession: WakeSession
  writeEvent?: (event: ChangeEvent) => void
  now?: () => string
}): GoalApi {
  const now = opts.now ?? (() => new Date().toISOString())

  // Read-your-writes cache for the duration of this wake. Events written via
  // writeEvent only reach the local manifests collection after a round-trip
  // through the stream, so a read straight after a write would observe the
  // previous value — e.g. mark_goal_complete firing mid-run would snapshot a
  // stale tokensUsed and clobber the fresher per-step counter.
  let lastWritten: ManifestGoalEntry | undefined
  let clearedThisWake = false

  function readRaw():
    | (ManifestGoalEntry & Record<string, unknown>)
    | undefined {
    if (clearedThisWake) return undefined
    if (lastWritten) {
      return lastWritten as ManifestGoalEntry & Record<string, unknown>
    }
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

  // Single write channel: every goal mutation goes directly through
  // writeEvent (live, ordered) when it is wired. Mixing this with the
  // wake-session's staged manifest transaction (which replays at
  // end-of-wake) re-introduces the ordering race where a snapshot staged
  // mid-run lands after — and overwrites — fresher live writes. The staged
  // path remains only as a fallback for tests that don't wire writeEvent.
  function persist(entry: ManifestGoalEntry): GoalEntry {
    if (opts.writeEvent) {
      opts.writeEvent(
        entityStateSchema.manifests.upsert({
          key: GOAL_MANIFEST_KEY,
          value: entry as never,
        }) as ChangeEvent
      )
    } else {
      opts.wakeSession.registerManifestEntry(entry)
    }
    lastWritten = entry
    clearedThisWake = false
    return toGoalEntry(entry as unknown as Record<string, unknown>)
  }

  return {
    setGoal(input) {
      const existing = readRaw()
      const timestamp = now()
      // Re-setting the same objective (e.g. to raise the budget) preserves
      // accumulated usage; a new objective starts from zero.
      const isSameObjective = existing?.objective === input.objective
      const tokenBudget =
        input.tokenBudget === undefined
          ? DEFAULT_TOKEN_BUDGET
          : input.tokenBudget
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
        createdAt:
          isSameObjective && typeof existing?.createdAt === `string`
            ? existing.createdAt
            : timestamp,
        updatedAt: timestamp,
      }
      return persist(entry)
    },

    clearGoal() {
      const existed = readRaw() !== undefined
      if (opts.writeEvent) {
        if (existed) {
          opts.writeEvent(
            entityStateSchema.manifests.delete({
              key: GOAL_MANIFEST_KEY,
            }) as ChangeEvent
          )
        }
      } else {
        opts.wakeSession.removeManifestEntry(GOAL_MANIFEST_KEY)
      }
      lastWritten = undefined
      clearedThisWake = true
      return existed
    },

    getGoal() {
      return readLive()
    },

    markGoalComplete(summary) {
      const existing = readRaw()
      if (!existing) return undefined
      const trimmed = summary?.trim()
      const next: ManifestGoalEntry = {
        ...(existing as unknown as ManifestGoalEntry),
        key: GOAL_MANIFEST_KEY,
        kind: `goal`,
        status: `complete`,
        ...(trimmed ? { summary: trimmed } : {}),
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
        ...(typeof existing.summary === `string` && existing.summary
          ? { summary: existing.summary }
          : {}),
        createdAt:
          typeof existing.createdAt === `string` ? existing.createdAt : now(),
        updatedAt: now(),
      }
      return persist(next)
    },
  }
}
