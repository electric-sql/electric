import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_TOKEN_BUDGET, createGoalApi } from '../src/goal-api'
import type { ChangeEvent } from '@durable-streams/state'

// Minimal harness: a mutable manifests array that registerManifestEntry
// upserts into (mirroring the wake-session's optimistic apply), plus an
// optional captured writeEvent channel for the live-update path.
function makeApi(opts?: { withWriteEvent?: boolean }) {
  const rows: Array<Record<string, unknown>> = []
  const events: Array<ChangeEvent> = []
  const wakeSession = {
    registerManifestEntry: vi.fn((entry: Record<string, unknown>) => {
      const idx = rows.findIndex((row) => row.kind === `goal`)
      if (idx >= 0) rows[idx] = entry
      else rows.push(entry)
      return true
    }),
    removeManifestEntry: vi.fn(() => {
      const idx = rows.findIndex((row) => row.kind === `goal`)
      if (idx >= 0) {
        rows.splice(idx, 1)
        return true
      }
      return false
    }),
  }
  let tick = 0
  const api = createGoalApi({
    db: { collections: { manifests: { toArray: rows } } } as never,
    wakeSession: wakeSession as never,
    ...(opts?.withWriteEvent
      ? { writeEvent: (event: ChangeEvent) => events.push(event) }
      : {}),
    now: () => `2026-06-10T00:00:0${tick++}.000Z`,
  })
  return { api, rows, events, wakeSession }
}

describe(`createGoalApi.setGoal`, () => {
  it(`defaults the budget and starts usage at zero`, () => {
    const { api } = makeApi()
    const goal = api.setGoal({ objective: `ship X` })

    expect(goal.tokenBudget).toBe(DEFAULT_TOKEN_BUDGET)
    expect(goal.tokensUsed).toBe(0)
    expect(goal.status).toBe(`active`)
    expect(goal.createdAt).toBe(`2026-06-10T00:00:00.000Z`)
  })

  it(`explicit null budget means unlimited`, () => {
    const { api } = makeApi()
    expect(
      api.setGoal({ objective: `x`, tokenBudget: null }).tokenBudget
    ).toBeNull()
  })

  it(`re-setting the same objective preserves usage and createdAt`, () => {
    const { api } = makeApi()
    api.setGoal({ objective: `ship X`, tokenBudget: 1_000 })
    api.updateGoalUsage(700)
    const raised = api.setGoal({ objective: `ship X`, tokenBudget: 5_000 })

    expect(raised.tokensUsed).toBe(700)
    expect(raised.tokenBudget).toBe(5_000)
    expect(raised.createdAt).toBe(`2026-06-10T00:00:00.000Z`)
  })

  it(`a new objective resets usage and createdAt`, () => {
    const { api } = makeApi()
    api.setGoal({ objective: `ship X` })
    api.updateGoalUsage(700)
    const next = api.setGoal({ objective: `ship Y` })

    expect(next.tokensUsed).toBe(0)
    expect(next.createdAt).not.toBe(`2026-06-10T00:00:00.000Z`)
  })
})

describe(`createGoalApi.updateGoalUsage`, () => {
  it(`never decreases tokensUsed`, () => {
    const { api } = makeApi()
    api.setGoal({ objective: `x` })
    api.updateGoalUsage(500)
    const after = api.updateGoalUsage(300)

    expect(after?.tokensUsed).toBe(500)
  })

  it(`flips status when requested`, () => {
    const { api } = makeApi()
    api.setGoal({ objective: `x` })
    const limited = api.updateGoalUsage(60_000, {
      status: `budget_limited`,
    })

    expect(limited?.status).toBe(`budget_limited`)
    expect(limited?.tokensUsed).toBe(60_000)
  })

  it(`is a no-op write when nothing changed`, () => {
    const { api, wakeSession } = makeApi()
    api.setGoal({ objective: `x` })
    api.updateGoalUsage(500)
    const writesBefore = wakeSession.registerManifestEntry.mock.calls.length
    api.updateGoalUsage(500)

    expect(wakeSession.registerManifestEntry.mock.calls.length).toBe(
      writesBefore
    )
  })

  it(`returns undefined when no goal exists`, () => {
    const { api } = makeApi()
    expect(api.updateGoalUsage(100)).toBeUndefined()
  })

  it(`writes through writeEvent when wired (live path)`, () => {
    const { api, events, wakeSession } = makeApi({ withWriteEvent: true })
    api.setGoal({ objective: `x` })
    api.updateGoalUsage(500)

    expect(events.length).toBe(2)
    const value = (events[1] as { value?: { tokensUsed?: number } }).value
    expect(value?.tokensUsed).toBe(500)
    // Single write channel: nothing may go through the wake-session's
    // staged transaction when writeEvent is wired — staged entries replay
    // at end-of-wake and would clobber fresher live writes.
    expect(wakeSession.registerManifestEntry).not.toHaveBeenCalled()
  })

  it(`preserves a recorded summary across usage writes`, () => {
    const { api, rows } = makeApi()
    api.setGoal({ objective: `x` })
    api.markGoalComplete(`done it`)
    api.updateGoalUsage(900)

    expect(rows[0]?.summary).toBe(`done it`)
  })
})

describe(`createGoalApi.markGoalComplete`, () => {
  it(`flips status and records the trimmed summary`, () => {
    const { api } = makeApi()
    api.setGoal({ objective: `x` })
    const done = api.markGoalComplete(`  shipped the thing  `)

    expect(done?.status).toBe(`complete`)
    expect(done?.summary).toBe(`shipped the thing`)
  })

  it(`omits an empty summary`, () => {
    const { api } = makeApi()
    api.setGoal({ objective: `x` })
    expect(api.markGoalComplete(`   `)?.summary).toBeUndefined()
  })

  it(`returns undefined when no goal exists`, () => {
    const { api } = makeApi()
    expect(api.markGoalComplete()).toBeUndefined()
  })

  // Regression: events written via writeEvent only reach the local
  // manifests collection after a stream round-trip. mark_goal_complete
  // firing mid-run must read its own wake's latest write (the per-step
  // usage counter), not a stale collection row — previously it snapshotted
  // the lagging value and overwrote a fresher tokensUsed.
  it(`does not clobber fresher usage written earlier in the same wake`, () => {
    const { api, events } = makeApi({ withWriteEvent: true })
    api.setGoal({ objective: `x` })
    api.updateGoalUsage(5_728)
    const done = api.markGoalComplete(`all wrapped up`)

    expect(done?.tokensUsed).toBe(5_728)
    const last = events.at(-1) as { value?: Record<string, unknown> }
    expect(last.value?.tokensUsed).toBe(5_728)
    expect(last.value?.status).toBe(`complete`)
  })

  it(`status survives a usage write that follows completion (lagging reads)`, () => {
    const { api, events } = makeApi({ withWriteEvent: true })
    api.setGoal({ objective: `x` })
    api.markGoalComplete()
    api.updateGoalUsage(9_000)

    const last = events.at(-1) as { value?: Record<string, unknown> }
    expect(last.value?.status).toBe(`complete`)
    expect(last.value?.tokensUsed).toBe(9_000)
  })
})

describe(`createGoalApi.clearGoal / getGoal`, () => {
  it(`round-trips through getGoal and clears`, () => {
    const { api } = makeApi()
    expect(api.getGoal()).toBeUndefined()
    api.setGoal({ objective: `x` })
    expect(api.getGoal()?.objective).toBe(`x`)
    expect(api.clearGoal()).toBe(true)
    expect(api.getGoal()).toBeUndefined()
    expect(api.clearGoal()).toBe(false)
  })

  it(`clears via a delete event when writeEvent is wired`, () => {
    // Seed a goal row as if persisted by a previous wake.
    const { api, rows, events, wakeSession } = makeApi({
      withWriteEvent: true,
    })
    rows.push({
      key: `goal`,
      kind: `goal`,
      id: `goal`,
      objective: `x`,
      status: `active`,
      tokenBudget: 1_000,
      tokensUsed: 10,
      createdAt: `2026-06-09T00:00:00.000Z`,
      updatedAt: `2026-06-09T00:00:00.000Z`,
    })

    expect(api.clearGoal()).toBe(true)
    expect(events.length).toBe(1)
    // The stale collection row hasn't round-tripped away yet, but reads in
    // this wake must already observe the goal as gone.
    expect(api.getGoal()).toBeUndefined()
    expect(api.clearGoal()).toBe(false)
    expect(wakeSession.removeManifestEntry).not.toHaveBeenCalled()
  })
})
