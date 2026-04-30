import { describe, it, expect, vi } from 'vitest'
import { makeCodingAgentHandler } from '../../src/entity/handler'
import { LifecycleManager } from '../../src/lifecycle-manager'
import { WorkspaceRegistry } from '../../src/workspace-registry'
import type {
  Bridge,
  RunTurnArgs,
  RunTurnResult,
  SandboxInstance,
  SandboxSpec,
} from '../../src/types'

// ── Fakes ──

interface InboxRow {
  key: string
  payload?: unknown
  message_type?: string
}

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

function makeFakeCtx(opts: {
  entityUrl: string
  args?: Record<string, unknown>
  inbox?: Array<InboxRow>
  meta?: any
  runs?: Array<any>
}) {
  const sessionMeta = makeCollection()
  const runs = makeCollection()
  const events = makeCollection()
  const lifecycle = makeCollection()
  const nativeJsonl = makeCollection()
  const inbox = makeCollection()

  if (opts.meta) sessionMeta.rows.set(`current`, opts.meta)
  for (const r of opts.runs ?? []) runs.rows.set(r.key, r)
  for (const i of opts.inbox ?? []) inbox.rows.set(i.key, i)

  const recordedRuns: Array<{
    key: string
    status?: string
    response: string
  }> = []
  let runCounter = 0

  const ctx: any = {
    entityUrl: opts.entityUrl,
    entityType: `coding-agent`,
    args: opts.args ?? {},
    tags: {},
    firstWake: false,
    db: {
      collections: { sessionMeta, runs, events, lifecycle, nativeJsonl, inbox },
      actions: {
        sessionMeta_insert: ({ row }: { row: any }) =>
          sessionMeta.rows.set(row.key, row),
        sessionMeta_update: ({
          key,
          updater,
        }: {
          key: string
          updater: (d: any) => void
        }) => {
          const cur = sessionMeta.rows.get(key)
          if (cur) updater(cur)
        },
        runs_insert: ({ row }: { row: any }) => runs.rows.set(row.key, row),
        runs_update: ({
          key,
          updater,
        }: {
          key: string
          updater: (d: any) => void
        }) => {
          const cur = runs.rows.get(key)
          if (cur) updater(cur)
        },
        events_insert: ({ row }: { row: any }) => events.rows.set(row.key, row),
        nativeJsonl_insert: ({ row }: { row: any }) =>
          nativeJsonl.rows.set(row.key, row),
        lifecycle_insert: ({ row }: { row: any }) =>
          lifecycle.rows.set(row.key, row),
      },
    },
    recordRun() {
      const key = `run-${++runCounter}`
      const ent = { key, status: undefined as string | undefined, response: `` }
      recordedRuns.push(ent)
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
    send: vi.fn(),
  }

  return { ctx, recordedRuns }
}

function makeFakeProvider(
  initialStatus: `running` | `stopped` | `unknown` = `stopped`
) {
  const stub: SandboxInstance = {
    instanceId: `inst-1`,
    agentId: ``,
    workspaceMount: `/workspace`,
    async exec() {
      throw new Error(`not used`)
    },
  }
  const fp: any = {
    name: `fake`,
    statusReturn: initialStatus,
    async start(spec: SandboxSpec): Promise<SandboxInstance> {
      return { ...stub, agentId: spec.agentId }
    },
    async stop(_id: string) {},
    async destroy(_id: string) {},
    async status() {
      return fp.statusReturn
    },
    async recover() {
      return []
    },
  }
  return fp
}

describe(`entity handler — first-wake init`, () => {
  it(`seeds sessionMeta when none exists, using args`, async () => {
    const lm = new LifecycleManager({
      provider: makeFakeProvider(),
      bridge: {
        async runTurn() {
          return { exitCode: 0 }
        },
      },
    })
    const wr = new WorkspaceRegistry()
    const handler = makeCodingAgentHandler(lm, wr, {
      defaults: {
        idleTimeoutMs: 1000,
        coldBootBudgetMs: 5000,
        runTimeoutMs: 5000,
      },
      env: () => ({}),
    })

    const { ctx } = makeFakeCtx({
      entityUrl: `/test/coding-agent/x`,
      args: {
        kind: `claude`,
        workspaceType: `volume`,
        workspaceName: `w`,
      },
    })

    await handler(ctx, { type: `message_received` } as any)

    const meta = ctx.db.collections.sessionMeta.get(`current`)
    expect(meta).toBeDefined()
    expect(meta.status).toBe(`cold`)
    expect(meta.kind).toBe(`claude`)
    expect(meta.workspaceIdentity).toBe(`volume:w`)
    expect(meta.pinned).toBe(false)
  })
})

describe(`entity handler — pin/release`, () => {
  it(`pin sets pinned=true and cancels timer`, async () => {
    const lm = new LifecycleManager({
      provider: makeFakeProvider(`running`),
      bridge: {
        async runTurn() {
          return { exitCode: 0 }
        },
      },
    })
    const wr = new WorkspaceRegistry()
    const handler = makeCodingAgentHandler(lm, wr, {
      defaults: {
        idleTimeoutMs: 1000,
        coldBootBudgetMs: 5000,
        runTimeoutMs: 5000,
      },
      env: () => ({}),
    })
    const meta = {
      key: `current`,
      status: `idle`,
      kind: `claude`,
      pinned: false,
      workspaceIdentity: `volume:w`,
      workspaceSpec: { type: `volume`, name: `w` },
      idleTimeoutMs: 1000,
      keepWarm: false,
    }
    const { ctx } = makeFakeCtx({
      entityUrl: `/t/coding-agent/x`,
      meta,
      inbox: [{ key: `i1`, message_type: `pin` }],
    })
    await handler(ctx, { type: `message_received` } as any)
    expect(ctx.db.collections.sessionMeta.get(`current`).pinned).toBe(true)
    expect(lm.pinCount(`/t/coding-agent/x`)).toBe(1)
  })
})

describe(`entity handler — reconcile orphan run`, () => {
  it(`marks orphan run failed when meta=running and run.startedAt < lm.startedAtMs`, async () => {
    const lm = new LifecycleManager({
      provider: makeFakeProvider(`stopped`),
      bridge: {
        async runTurn() {
          return { exitCode: 0 }
        },
      },
    })
    const wr = new WorkspaceRegistry()
    const handler = makeCodingAgentHandler(lm, wr, {
      defaults: {
        idleTimeoutMs: 1000,
        coldBootBudgetMs: 5000,
        runTimeoutMs: 5000,
      },
      env: () => ({}),
    })
    const oldStart = lm.startedAtMs - 10_000
    const meta = {
      key: `current`,
      status: `running`,
      kind: `claude`,
      pinned: false,
      workspaceIdentity: `volume:w`,
      workspaceSpec: { type: `volume`, name: `w` },
      idleTimeoutMs: 1000,
      keepWarm: false,
      instanceId: `old-inst`,
    }
    const orphanRun = {
      key: `run-old`,
      startedAt: oldStart,
      status: `running`,
      promptInboxKey: `i0`,
    }
    const { ctx } = makeFakeCtx({
      entityUrl: `/t/coding-agent/x`,
      meta,
      runs: [orphanRun],
    })
    await handler(ctx, { type: `message_received` } as any)
    const updated = ctx.db.collections.runs.get(`run-old`)
    expect(updated.status).toBe(`failed`)
    expect(updated.finishReason).toBe(`orphaned`)
    expect(ctx.db.collections.sessionMeta.get(`current`).status).toBe(`cold`)
  })
})

describe(`entity handler — processPrompt happy path`, () => {
  it(`runs a turn, records events, ends run completed`, async () => {
    const events: Array<any> = [
      { type: `session_init`, sessionId: `abc`, ts: 1 },
      { type: `assistant_message`, text: `hello`, ts: 2 },
    ]
    const bridge: Bridge = {
      async runTurn(args: RunTurnArgs): Promise<RunTurnResult> {
        for (const e of events) args.onEvent(e as any)
        return { exitCode: 0, finalText: `hello` }
      },
    }
    const lm = new LifecycleManager({
      provider: makeFakeProvider(`stopped`),
      bridge,
    })
    const wr = new WorkspaceRegistry()
    const handler = makeCodingAgentHandler(lm, wr, {
      defaults: {
        idleTimeoutMs: 1000,
        coldBootBudgetMs: 5000,
        runTimeoutMs: 5000,
      },
      env: () => ({ ANTHROPIC_API_KEY: `sk-test` }),
    })
    const meta = {
      key: `current`,
      status: `cold`,
      kind: `claude`,
      pinned: false,
      workspaceIdentity: `volume:w`,
      workspaceSpec: { type: `volume`, name: `w` },
      idleTimeoutMs: 1000,
      keepWarm: false,
    }
    const { ctx, recordedRuns } = makeFakeCtx({
      entityUrl: `/t/coding-agent/x`,
      meta,
      inbox: [{ key: `i1`, message_type: `prompt`, payload: { text: `hi` } }],
    })
    await handler(ctx, { type: `message_received` } as any)

    expect(recordedRuns).toHaveLength(1)
    expect(recordedRuns[0]!.status).toBe(`completed`)
    expect(recordedRuns[0]!.response).toBe(`hello`)

    const finalMeta = ctx.db.collections.sessionMeta.get(`current`)
    expect(finalMeta.status).toBe(`idle`)

    const runs = Array.from(ctx.db.collections.runs.rows.values())
    expect(runs).toHaveLength(1)
    expect((runs[0] as any).status).toBe(`completed`)

    const eventRows = Array.from(ctx.db.collections.events.rows.values())
    expect(eventRows).toHaveLength(2)
  })
})
