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
    const { api, events } = makeApi({ withWriteEvent: true })
    api.setGoal({ objective: `x` })
    api.updateGoalUsage(500)

    expect(events.length).toBe(1)
    const value = (events[0] as { value?: { tokensUsed?: number } }).value
    expect(value?.tokensUsed).toBe(500)
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
})
