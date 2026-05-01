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

describeMaybe(`Slice B — resume integration`, () => {
  beforeAll(async () => {
    await buildTestImage()
  }, 600_000)

  it(`second prompt references prior turn content (lossless resume)`, async () => {
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
        idleTimeoutMs: 1500,
        coldBootBudgetMs: 60_000,
        runTimeoutMs: 120_000,
      },
      env: (_kind) => ({
        ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY!,
        ANTHROPIC_MODEL: env.ANTHROPIC_MODEL!,
      }),
    })

    const agentId = `/test/coding-agent/resume-${Date.now().toString(36)}`
    const args = {
      kind: `claude`,
      workspaceType: `volume`,
      workspaceName: `slice-b-resume-${Date.now().toString(36)}`,
      idleTimeoutMs: 1500,
    }
    const { ctx, state } = makeFakeCtx(agentId, args)

    await handler(ctx, { type: `message_received` })
    expect(state.sessionMeta.get(`current`).status).toBe(`cold`)

    state.inbox.rows.set(`i1`, {
      key: `i1`,
      message_type: `prompt`,
      payload: {
        text: `My favorite fruit is BANANA. Acknowledge by replying with exactly: "Got it: BANANA"`,
      },
    })
    await handler(ctx, { type: `message_received` })

    const meta1 = state.sessionMeta.get(`current`)
    expect(meta1.status).toBe(`idle`)
    expect(meta1.nativeSessionId).toBeDefined()

    const runs1 = Array.from(state.runs.rows.values()) as any[]
    expect(runs1).toHaveLength(1)
    expect(runs1[0].status).toBe(`completed`)

    const nativeRows = Array.from(state.nativeJsonl.rows.values()) as any[]
    expect(nativeRows.length).toBeGreaterThan(0)

    await new Promise((r) => setTimeout(r, 2500))
    expect([`stopped`, `unknown`]).toContain(await provider.status(agentId))

    state.inbox.rows.set(`i2`, {
      key: `i2`,
      message_type: `prompt`,
      payload: {
        text: `What did I tell you my favorite fruit was? Reply with just the fruit name in all caps.`,
      },
    })
    await handler(ctx, { type: `message_received` })

    const runs2 = Array.from(state.runs.rows.values()) as any[]
    expect(runs2.length).toBeGreaterThanOrEqual(2)
    const lastRun = runs2[runs2.length - 1]
    if (lastRun.status !== `completed`) {
      console.log(
        `lastRun.finishReason:`,
        lastRun.finishReason,
        `\nlastError:`,
        state.sessionMeta.get(`current`)?.lastError,
        `\nlifecycle rows:`,
        Array.from(state.lifecycle.rows.values()).map(
          (r: any) => `${r.event}${r.detail ? `: ${r.detail}` : ``}`
        )
      )
    }
    expect(lastRun.status).toBe(`completed`)

    expect(lastRun.responseText?.toUpperCase()).toContain(`BANANA`)

    const lifecycleRows = Array.from(state.lifecycle.rows.values()) as any[]
    const resumeRow = lifecycleRows.find(
      (r: any) => r.event === `resume.restored`
    )
    expect(resumeRow).toBeDefined()

    await provider.destroy(agentId).catch(() => undefined)
  }, 360_000)
})
