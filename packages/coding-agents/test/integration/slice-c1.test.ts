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

function makeFakeCtx(entityUrl: string, args: Record<string, unknown>) {
  const state = {
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
        lifecycle_insert: ({ row }: any) =>
          state.lifecycle.rows.set(row.key, row),
        nativeJsonl_insert: ({ row }: any) =>
          state.nativeJsonl.rows.set(row.key, row),
      },
    },
    recordRun() {
      const key = `run-${++runCounter}`
      const ent: any = { key, status: undefined, response: `` }
      state.runs.rows.set(key, ent)
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

describeMaybe(`Slice C₁ — idle eviction roundtrip`, () => {
  beforeAll(async () => {
    await buildTestImage()
  }, 600_000)

  it(`forced destroy between turns: turn 2 still resumes via probe-and-materialise`, async () => {
    const env = loadTestEnv()
    const provider = new LocalDockerProvider({ image: TEST_IMAGE_TAG })
    const bridge = new StdioBridge()
    const wr = new WorkspaceRegistry()
    const lm = new LifecycleManager({ provider, bridge })

    const handler = makeCodingAgentHandler(lm, wr, {
      defaults: {
        idleTimeoutMs: 1_000,
        coldBootBudgetMs: 60_000,
        runTimeoutMs: 120_000,
      },
      env: () => ({
        ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
        ANTHROPIC_MODEL: env.ANTHROPIC_MODEL,
      }),
    })

    const agentId = `/test/coding-agent/c1-${Date.now().toString(36)}`
    const args = {
      kind: `claude`,
      workspaceType: `volume`,
      workspaceName: `c1-${Date.now().toString(36)}`,
      idleTimeoutMs: 1_000,
    }
    const { ctx, state } = makeFakeCtx(agentId, args)

    // First wake — seeds sessionMeta, status=cold.
    await handler(ctx, { type: `message_received` })
    expect(state.sessionMeta.get(`current`).status).toBe(`cold`)

    // Turn 1 — boot sandbox, run claude.
    state.inbox.rows.set(`i1`, {
      key: `i1`,
      message_type: `prompt`,
      payload: {
        text: `My favourite fruit is ELEPHANTBANANA. Acknowledge with exactly: "Got it"`,
      },
    })
    await handler(ctx, { type: `message_received` })
    expect(state.sessionMeta.get(`current`).status).toBe(`idle`)
    expect(state.sessionMeta.get(`current`).nativeSessionId).toBeDefined()

    // Force destroy NOW — more aggressive than waiting for the 1s idle
    // timer. Simulates external container death (OOM, daemon restart,
    // manual docker rm) at the worst possible time. Cancel the still-
    // armed idle timer from turn 1 so it doesn't fire mid-turn-2 and
    // SIGKILL claude.
    lm.cancelIdleTimer(agentId)
    await provider.destroy(agentId)

    // Re-enter the handler with no inbox message — reconcile observes
    // the meta as 'idle' and providerStatus as 'unknown' (the
    // post-destroy state) and flips to 'cold'.
    await handler(ctx, { type: `message_received` })
    expect(state.sessionMeta.get(`current`).status).toBe(`cold`)

    // Turn 2 — must trigger probe-and-materialise of the captured
    // transcript and resume successfully.
    state.inbox.rows.set(`i2`, {
      key: `i2`,
      message_type: `prompt`,
      payload: {
        text: `What was the favourite fruit I told you? Reply with the single word in all caps.`,
      },
    })
    await handler(ctx, { type: `message_received` })

    const runs = Array.from(state.runs.rows.values()) as any[]
    const lastRun = runs[runs.length - 1]
    if (lastRun.status !== `completed`) {
      console.log(
        `lastRun.finishReason:`,
        lastRun.finishReason,
        `\nlastError:`,
        state.sessionMeta.get(`current`)?.lastError,
        `\nlifecycle:`,
        Array.from(state.lifecycle.rows.values()).map(
          (r: any) => `${r.event}${r.detail ? `: ${r.detail}` : ``}`
        )
      )
    }
    expect(lastRun.status).toBe(`completed`)
    expect(lastRun.responseText?.toUpperCase()).toContain(`ELEPHANTBANANA`)

    // resume.restored MUST appear because the transcript file did not
    // exist in the post-destroy container.
    const lifecycleRows = Array.from(state.lifecycle.rows.values()) as any[]
    const resumeRow = lifecycleRows.find(
      (r: any) => r.event === `resume.restored`
    )
    expect(resumeRow).toBeDefined()

    await provider.destroy(agentId).catch(() => undefined)
  }, 360_000)
})
