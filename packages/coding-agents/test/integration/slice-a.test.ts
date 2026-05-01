import { describe, it, expect, beforeAll } from 'vitest'
import {
  LocalDockerProvider,
  StdioBridge,
  WorkspaceRegistry,
  LifecycleManager,
} from '../../src'
import { makeCodingAgentHandler } from '../../src/entity/handler'
import { buildTestImage, TEST_IMAGE_TAG } from '../support/build-image'
import { loadTestEnv } from '../support/env'

const SHOULD_RUN = process.env.DOCKER === `1`
const describeMaybe = SHOULD_RUN ? describe : describe.skip

interface CollectionStub {
  rows: Map<string, any>
  get(k: string): any
  toArray: Array<any>
}

function makeCollection(): CollectionStub {
  const rows = new Map<string, any>()
  return {
    rows,
    get(k: string) {
      return rows.get(k)
    },
    get toArray(): Array<any> {
      return Array.from(rows.values())
    },
  }
}

interface FakeCtxState {
  sessionMeta: CollectionStub
  runs: CollectionStub
  events: CollectionStub
  lifecycle: CollectionStub
  nativeJsonl: CollectionStub
  inbox: CollectionStub
}

function makeFakeCtx(entityUrl: string, args: Record<string, unknown>) {
  const state: FakeCtxState = {
    sessionMeta: makeCollection(),
    runs: makeCollection(),
    events: makeCollection(),
    lifecycle: makeCollection(),
    nativeJsonl: makeCollection(),
    inbox: makeCollection(),
  }
  let runCounter = 0
  const ctx: any = {
    entityUrl,
    entityType: `coding-agent`,
    args,
    tags: {},
    firstWake: false,
    db: {
      collections: state,
      actions: {
        sessionMeta_insert: ({ row }: any) =>
          state.sessionMeta.rows.set(row.key, row),
        sessionMeta_update: ({ key, updater }: any) => {
          const r = state.sessionMeta.rows.get(key)
          if (r) updater(r)
        },
        runs_insert: ({ row }: any) => state.runs.rows.set(row.key, row),
        runs_update: ({ key, updater }: any) => {
          const r = state.runs.rows.get(key)
          if (r) updater(r)
        },
        events_insert: ({ row }: any) => state.events.rows.set(row.key, row),
        nativeJsonl_insert: ({ row }: any) =>
          state.nativeJsonl.rows.set(row.key, row),
        lifecycle_insert: ({ row }: any) =>
          state.lifecycle.rows.set(row.key, row),
      },
    },
    recordRun() {
      const key = `run-${++runCounter}`
      const ent: { key: string; status?: string; response: string } = {
        key,
        status: undefined,
        response: ``,
      }
      return {
        key,
        end({ status }: { status: string }) {
          ent.status = status
        },
        attachResponse(text: string) {
          ent.response += text
        },
      }
    },
    setTag: () => Promise.resolve(),
    send: () => undefined,
  }
  return { ctx, state }
}

function pushInbox(
  state: FakeCtxState,
  key: string,
  message_type: string,
  payload: any = {}
) {
  state.inbox.rows.set(key, { key, message_type, payload })
}

describeMaybe(`Slice A — full integration`, () => {
  beforeAll(async () => {
    await buildTestImage()
  }, 600_000)

  it(`spawns, runs prompt, lease-serializes, recovers from crash, destroys`, async () => {
    const env = loadTestEnv()
    const provider = new LocalDockerProvider({ image: TEST_IMAGE_TAG })
    const bridge = new StdioBridge()
    const wr = new WorkspaceRegistry()
    const lm = new LifecycleManager({
      providers: { sandbox: provider, host: provider },
      bridge,
    })
    const handler = makeCodingAgentHandler(lm, wr, {
      defaults: {
        idleTimeoutMs: 2000,
        coldBootBudgetMs: 60_000,
        runTimeoutMs: 120_000,
      },
      env: () => ({
        ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
        ANTHROPIC_MODEL: env.ANTHROPIC_MODEL,
      }),
    })

    const agentA = `/test/coding-agent/a-${Date.now().toString(36)}`
    const sharedName = `slice-a-shared-${Date.now().toString(36)}`
    const args = {
      kind: `claude`,
      workspaceType: `volume`,
      workspaceName: sharedName,
      idleTimeoutMs: 2000,
    }
    const { ctx: ctxA, state: stateA } = makeFakeCtx(agentA, args)

    // ── Assertion 1: First-wake init ──────────────────────────────────────────
    await handler(ctxA, { type: `message_received` })
    expect(stateA.sessionMeta.get(`current`).status).toBe(`cold`)

    // ── Assertion 2: Send prompt; cold boot + run completes ───────────────────
    pushInbox(stateA, `i1`, `prompt`, {
      text: `Reply with the single word: ok`,
    })
    await handler(ctxA, { type: `message_received` })

    const metaA1 = stateA.sessionMeta.get(`current`)
    expect(metaA1.status).toBe(`idle`)
    const runsA = Array.from(stateA.runs.rows.values()) as any[]
    expect(runsA).toHaveLength(1)
    expect(runsA[0].status).toBe(`completed`)
    expect((runsA[0].responseText?.length ?? 0) > 0).toBe(true)

    // ── Assertion 3: Pin; sleep past idle timeout; container still running ────
    pushInbox(stateA, `i2`, `pin`)
    await handler(ctxA, { type: `message_received` })
    expect(stateA.sessionMeta.get(`current`).pinned).toBe(true)

    await new Promise((r) => setTimeout(r, 3000))
    expect([`running`]).toContain(await provider.status(agentA))

    // ── Assertion 4: Release; sleep past idle; sandbox stops ─────────────────
    pushInbox(stateA, `i3`, `release`)
    await handler(ctxA, { type: `message_received` })
    await new Promise((r) => setTimeout(r, 3000))
    expect([`stopped`, `unknown`]).toContain(await provider.status(agentA))

    // ── Assertion 5: Second prompt triggers cold-boot path ────────────────────
    pushInbox(stateA, `i4`, `prompt`, { text: `Reply: again` })
    await handler(ctxA, { type: `message_received` })
    const runsA2 = Array.from(stateA.runs.rows.values()) as any[]
    expect(runsA2.length).toBeGreaterThanOrEqual(2)
    expect(runsA2[runsA2.length - 1].status).toBe(`completed`)

    // ── Assertion 6: Second agent on same workspace, lease-serialized ─────────
    // Wait past the idle timer so A's container is already stopped before
    // we launch the concurrent test. This ensures no in-flight idle-timer
    // kill can interrupt the concurrent run.
    await new Promise((r) => setTimeout(r, 3000))

    const agentB = `/test/coding-agent/b-${Date.now().toString(36)}`
    const { ctx: ctxB, state: stateB } = makeFakeCtx(agentB, args)
    // First-wake init for B
    await handler(ctxB, { type: `message_received` })

    pushInbox(stateB, `j1`, `prompt`, { text: `Reply: B` })
    pushInbox(stateA, `i5`, `prompt`, { text: `Reply: A` })
    await Promise.all([
      handler(ctxA, { type: `message_received` }),
      handler(ctxB, { type: `message_received` }),
    ])

    const runsAFinal = Array.from(stateA.runs.rows.values()) as any[]
    const runsBFinal = Array.from(stateB.runs.rows.values()) as any[]
    expect(runsAFinal[runsAFinal.length - 1].status).toBe(`completed`)
    expect(runsBFinal[0].status).toBe(`completed`)

    // Lease serialization: A's last run and B's first run must not overlap.
    const lastA = runsAFinal[runsAFinal.length - 1]
    const firstB = runsBFinal[0]
    const noOverlap =
      lastA.endedAt <= firstB.startedAt || firstB.endedAt <= lastA.startedAt
    expect(noOverlap).toBe(true)

    // ── Assertion 7: Crash recovery ───────────────────────────────────────────
    // Simulate a "prior LM crash" by creating lm2 (new startedAtMs).
    // Inject a stale 'running' row predating lm2 into stateA.
    const oldRunStart = Date.now() - 60_000
    stateA.runs.rows.set(`stale`, {
      key: `stale`,
      startedAt: oldRunStart,
      status: `running`,
      promptInboxKey: `fake`,
    } as any)
    stateA.sessionMeta.rows.set(`current`, {
      ...stateA.sessionMeta.get(`current`),
      status: `running`,
    })

    // Small delay to ensure lm2.startedAtMs > oldRunStart
    await new Promise((r) => setTimeout(r, 50))

    const lm2 = new LifecycleManager({
      providers: { sandbox: provider, host: provider },
      bridge,
    })
    const handler2 = makeCodingAgentHandler(lm2, wr, {
      defaults: {
        idleTimeoutMs: 2000,
        coldBootBudgetMs: 60_000,
        runTimeoutMs: 120_000,
      },
      env: () => ({ ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY }),
    })

    pushInbox(stateA, `i6`, `prompt`, { text: `after crash` })
    await handler2(ctxA, { type: `message_received` })

    // Stale run must be reconciled to orphaned
    expect((stateA.runs.get(`stale`) as any).status).toBe(`failed`)
    expect((stateA.runs.get(`stale`) as any).finishReason).toBe(`orphaned`)
    // A new run must have completed
    const newRuns = (Array.from(stateA.runs.rows.values()) as any[]).filter(
      (r) => r.status === `completed` && r.key !== `stale`
    )
    expect(newRuns.length).toBeGreaterThan(0)

    // ── Assertion 8: Destroy ──────────────────────────────────────────────────
    pushInbox(stateA, `i7`, `destroy`)
    await handler2(ctxA, { type: `message_received` })
    expect(stateA.sessionMeta.get(`current`).status).toBe(`destroyed`)
    expect([`stopped`, `unknown`]).toContain(await provider.status(agentA))

    // Cleanup B
    await provider.destroy(agentB).catch(() => undefined)
  }, 360_000)
})
