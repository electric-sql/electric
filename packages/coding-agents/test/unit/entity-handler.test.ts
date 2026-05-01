import { describe, it, expect, vi } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
    async copyTo() {
      // not used in unit tests; processPrompt only calls copyTo when
      // a nativeSessionId is set
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
      providers: { sandbox: makeFakeProvider(), host: makeFakeProvider() },
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
      providers: {
        sandbox: makeFakeProvider(`running`),
        host: makeFakeProvider(`running`),
      },
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
      target: `sandbox` as const,
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
      providers: {
        sandbox: makeFakeProvider(`stopped`),
        host: makeFakeProvider(`stopped`),
      },
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
      target: `sandbox` as const,
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
      providers: {
        sandbox: makeFakeProvider(`stopped`),
        host: makeFakeProvider(`stopped`),
      },
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
      target: `sandbox` as const,
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

describe(`entity handler — idle timer wakes entity`, () => {
  it(`calls wakeEntity after destroy when timer fires`, async () => {
    vi.useFakeTimers()
    try {
      const events: Array<any> = [
        { type: `session_init`, sessionId: `abc`, ts: 1 },
        { type: `assistant_message`, text: `ok`, ts: 2 },
      ]
      const bridge: Bridge = {
        async runTurn(args: RunTurnArgs): Promise<RunTurnResult> {
          for (const e of events) args.onEvent(e as any)
          return { exitCode: 0, finalText: `ok` }
        },
      }
      const destroyCalls: Array<string> = []
      const wakeCalls: Array<string> = []
      const provider = makeFakeProvider(`stopped`)
      provider.destroy = async (agentId: string) => {
        destroyCalls.push(agentId)
      }
      const lm = new LifecycleManager({
        providers: { sandbox: provider, host: provider },
        bridge,
      })
      const wr = new WorkspaceRegistry()
      const handler = makeCodingAgentHandler(lm, wr, {
        defaults: {
          idleTimeoutMs: 50,
          coldBootBudgetMs: 5_000,
          runTimeoutMs: 5_000,
        },
        env: () => ({}),
        wakeEntity: (agentId: string) => {
          wakeCalls.push(agentId)
        },
      })
      const meta = {
        key: `current`,
        status: `cold`,
        kind: `claude`,
        target: `sandbox` as const,
        pinned: false,
        workspaceIdentity: `volume:w`,
        workspaceSpec: { type: `volume`, name: `w` },
        idleTimeoutMs: 50,
        keepWarm: false,
      }
      const { ctx } = makeFakeCtx({
        entityUrl: `/t/coding-agent/x`,
        meta,
        inbox: [{ key: `i1`, message_type: `prompt`, payload: { text: `hi` } }],
      })
      await handler(ctx, { type: `message_received` } as any)

      // Timer was armed at idleTimeoutMs=50. Fast-forward and let the
      // microtask queue drain so the destroy()/wakeEntity finally chain runs.
      await vi.advanceTimersByTimeAsync(100)
      await vi.runAllTimersAsync()

      expect(destroyCalls).toEqual([`/t/coding-agent/x`])
      expect(wakeCalls).toEqual([`/t/coding-agent/x`])
    } finally {
      vi.useRealTimers()
    }
  })

  it(`dispatches lifecycle/idle-eviction-fired as a no-op (reconcile flips status)`, async () => {
    // Provider returns 'unknown' simulating the post-destroy state.
    const provider = makeFakeProvider(`unknown`)
    const lm = new LifecycleManager({
      providers: { sandbox: provider, host: provider },
      bridge: {
        async runTurn() {
          return { exitCode: 0 }
        },
      },
    })
    const wr = new WorkspaceRegistry()
    const handler = makeCodingAgentHandler(lm, wr, {
      defaults: {
        idleTimeoutMs: 1_000,
        coldBootBudgetMs: 5_000,
        runTimeoutMs: 5_000,
      },
      env: () => ({}),
    })
    const meta = {
      key: `current`,
      status: `idle`,
      kind: `claude`,
      target: `sandbox` as const,
      pinned: false,
      workspaceIdentity: `volume:w`,
      workspaceSpec: { type: `volume`, name: `w` },
      idleTimeoutMs: 1_000,
      keepWarm: false,
      instanceId: `inst-1`,
    }
    const { ctx } = makeFakeCtx({
      entityUrl: `/t/coding-agent/x`,
      meta,
      inbox: [{ key: `i1`, message_type: `lifecycle/idle-eviction-fired` }],
    })
    await handler(ctx, { type: `message_received` } as any)

    // Reconcile saw 'idle' && providerStatus === 'unknown' → flips to 'cold'.
    expect(ctx.db.collections.sessionMeta.get(`current`).status).toBe(`cold`)
    // No new run was started.
    expect(Array.from(ctx.db.collections.runs.rows.values())).toHaveLength(0)
  })
})

describe(`entity handler — target validation`, () => {
  it(`target='host' with workspaceType='volume' fails into error state`, async () => {
    const lm = new LifecycleManager({
      providers: {
        sandbox: makeFakeProvider(),
        host: makeFakeProvider(),
      },
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
      entityUrl: `/t/coding-agent/x`,
      args: {
        kind: `claude`,
        target: `host`,
        workspaceType: `volume`,
        workspaceName: `w`,
      },
    })
    await handler(ctx, { type: `message_received` } as any)
    const meta = ctx.db.collections.sessionMeta.get(`current`)
    expect(meta.status).toBe(`error`)
    expect(meta.lastError).toMatch(/host.*bindMount/)
  })

  it(`target='sandbox' with importNativeSessionId fails into error state`, async () => {
    const lm = new LifecycleManager({
      providers: { sandbox: makeFakeProvider(), host: makeFakeProvider() },
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
      entityUrl: `/t/coding-agent/x`,
      args: {
        kind: `claude`,
        target: `sandbox`,
        workspaceType: `bindMount`,
        workspaceHostPath: `/tmp`,
        importNativeSessionId: `abc-123`,
      },
    })
    await handler(ctx, { type: `message_received` } as any)
    const meta = ctx.db.collections.sessionMeta.get(`current`)
    expect(meta.status).toBe(`error`)
    expect(meta.lastError).toMatch(/importNativeSessionId.*host/)
  })
})

describe(`entity handler — importNativeSessionId flow`, () => {
  it(`reads the JSONL from ~/.claude/projects and seeds nativeJsonl`, async () => {
    const fakeHome = await mkdtemp(join(tmpdir(), `home-`))
    const workspace = await mkdtemp(join(tmpdir(), `ws-`))
    const realWorkspace = await realpath(workspace)
    const sanitised = realWorkspace.replace(/\//g, `-`)
    const projectDir = join(fakeHome, `.claude`, `projects`, sanitised)
    await mkdir(projectDir, { recursive: true })
    const sessionId = `imported-abc`
    const transcript = `{"type":"system","subtype":"init"}\n`
    await writeFile(join(projectDir, `${sessionId}.jsonl`), transcript)

    try {
      const lm = new LifecycleManager({
        providers: { sandbox: makeFakeProvider(), host: makeFakeProvider() },
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
        homeDir: fakeHome,
      })
      const { ctx } = makeFakeCtx({
        entityUrl: `/t/coding-agent/imp-${Date.now()}`,
        args: {
          kind: `claude`,
          target: `host`,
          workspaceType: `bindMount`,
          workspaceHostPath: workspace,
          importNativeSessionId: sessionId,
        },
      })
      await handler(ctx, { type: `message_received` } as any)
      const meta = ctx.db.collections.sessionMeta.get(`current`)
      expect(meta.status).toBe(`cold`)
      expect(meta.nativeSessionId).toBe(sessionId)
      const row = ctx.db.collections.nativeJsonl.get(`current`)
      expect(row).toBeDefined()
      expect(row.nativeSessionId).toBe(sessionId)
      expect(row.content).toBe(transcript)
      const rows = ctx.db.collections.lifecycle.toArray
      const restored = rows.find((r: any) => r.event === `import.restored`)
      expect(restored).toBeDefined()
    } finally {
      await rm(fakeHome, { recursive: true, force: true })
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it(`missing JSONL → status=error and lifecycle import.failed row`, async () => {
    const fakeHome = await mkdtemp(join(tmpdir(), `home-`))
    const workspace = await mkdtemp(join(tmpdir(), `ws-`))
    try {
      const lm = new LifecycleManager({
        providers: { sandbox: makeFakeProvider(), host: makeFakeProvider() },
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
        homeDir: fakeHome,
      })
      const { ctx } = makeFakeCtx({
        entityUrl: `/t/coding-agent/missing-${Date.now()}`,
        args: {
          kind: `claude`,
          target: `host`,
          workspaceType: `bindMount`,
          workspaceHostPath: workspace,
          importNativeSessionId: `does-not-exist`,
        },
      })
      await handler(ctx, { type: `message_received` } as any)
      const meta = ctx.db.collections.sessionMeta.get(`current`)
      expect(meta.status).toBe(`error`)
      expect(meta.lastError).toMatch(/imported session file not found/)
      const failed = ctx.db.collections.lifecycle.toArray.find(
        (r: any) => r.event === `import.failed`
      )
      expect(failed).toBeDefined()
    } finally {
      await rm(fakeHome, { recursive: true, force: true })
      await rm(workspace, { recursive: true, force: true })
    }
  })
})

describe(`entity handler — convert-target`, () => {
  it(`flips meta.target sandbox→host when workspace is bindMount`, async () => {
    const lm = new LifecycleManager({
      providers: { sandbox: makeFakeProvider(), host: makeFakeProvider() },
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
      target: `sandbox`,
      pinned: false,
      workspaceIdentity: `bindMount:/tmp/x`,
      workspaceSpec: { type: `bindMount`, hostPath: `/tmp/x` },
      idleTimeoutMs: 1000,
      keepWarm: false,
    }
    const { ctx } = makeFakeCtx({
      entityUrl: `/t/coding-agent/x`,
      meta,
      inbox: [
        { key: `i1`, message_type: `convert-target`, payload: { to: `host` } },
      ],
    })
    await handler(ctx, { type: `message_received` } as any)
    const after = ctx.db.collections.sessionMeta.get(`current`)
    expect(after.target).toBe(`host`)
    expect(after.status).toBe(`cold`)
    const evt = ctx.db.collections.lifecycle.toArray.find(
      (r: any) => r.event === `target.changed`
    )
    expect(evt).toBeDefined()
    expect(evt.detail).toMatch(/from=sandbox;to=host/)
  })

  it(`rejects sandbox→host when workspace is volume`, async () => {
    const lm = new LifecycleManager({
      providers: { sandbox: makeFakeProvider(), host: makeFakeProvider() },
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
      target: `sandbox`,
      pinned: false,
      workspaceIdentity: `volume:w`,
      workspaceSpec: { type: `volume`, name: `w` },
      idleTimeoutMs: 1000,
      keepWarm: false,
    }
    const { ctx } = makeFakeCtx({
      entityUrl: `/t/coding-agent/x`,
      meta,
      inbox: [
        { key: `i1`, message_type: `convert-target`, payload: { to: `host` } },
      ],
    })
    await handler(ctx, { type: `message_received` } as any)
    const after = ctx.db.collections.sessionMeta.get(`current`)
    expect(after.target).toBe(`sandbox`) // unchanged
    expect(after.lastError).toMatch(/host requires.*bindMount/)
    const evt = ctx.db.collections.lifecycle.toArray.find(
      (r: any) =>
        r.event === `target.changed` && r.detail?.startsWith(`failed:`)
    )
    expect(evt).toBeDefined()
  })

  it(`rejects convert when status=running`, async () => {
    const lm = new LifecycleManager({
      providers: {
        sandbox: makeFakeProvider(`running`),
        host: makeFakeProvider(`running`),
      },
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
      status: `running`,
      kind: `claude`,
      target: `sandbox`,
      pinned: false,
      workspaceIdentity: `bindMount:/tmp/x`,
      workspaceSpec: { type: `bindMount`, hostPath: `/tmp/x` },
      idleTimeoutMs: 1000,
      keepWarm: false,
    }
    const { ctx } = makeFakeCtx({
      entityUrl: `/t/coding-agent/x`,
      meta,
      inbox: [
        { key: `i1`, message_type: `convert-target`, payload: { to: `host` } },
      ],
    })
    await handler(ctx, { type: `message_received` } as any)
    const after = ctx.db.collections.sessionMeta.get(`current`)
    expect(after.target).toBe(`sandbox`)
    expect(after.lastError).toMatch(/cannot convert.*running/)
  })

  it(`convert-target followed by prompt in same wake uses the new target`, async () => {
    const sandboxStarts: any[] = []
    const hostStarts: any[] = []
    const lm = new LifecycleManager({
      providers: {
        sandbox: {
          ...makeFakeProvider(),
          start: async (spec: any) => {
            sandboxStarts.push(spec)
            return {
              instanceId: `sb`,
              agentId: spec.agentId,
              workspaceMount: `/workspace`,
              exec: async () => ({
                stdout: (async function* () {})(),
                stderr: (async function* () {})(),
                wait: async () => ({ exitCode: 0 }),
                kill: () => undefined,
              }),
              copyTo: async () => undefined,
            }
          },
        } as any,
        host: {
          ...makeFakeProvider(),
          start: async (spec: any) => {
            hostStarts.push(spec)
            return {
              instanceId: `host:x`,
              agentId: spec.agentId,
              workspaceMount: spec.workspace.hostPath,
              exec: async () => ({
                stdout: (async function* () {})(),
                stderr: (async function* () {})(),
                wait: async () => ({ exitCode: 0 }),
                kill: () => undefined,
              }),
              copyTo: async () => undefined,
            }
          },
        } as any,
      },
      bridge: {
        async runTurn() {
          return { exitCode: 0, finalText: `ok` }
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
      target: `sandbox`,
      pinned: false,
      workspaceIdentity: `bindMount:/tmp/x`,
      workspaceSpec: { type: `bindMount`, hostPath: `/tmp/x` },
      idleTimeoutMs: 1000,
      keepWarm: false,
      instanceId: `old-inst`,
    }
    const { ctx } = makeFakeCtx({
      entityUrl: `/t/coding-agent/x`,
      meta,
      inbox: [
        { key: `i1`, message_type: `convert-target`, payload: { to: `host` } },
        { key: `i2`, message_type: `prompt`, payload: { text: `say hi` } },
      ],
    })
    await handler(ctx, { type: `message_received` } as any)
    expect(hostStarts).toHaveLength(1)
    expect(sandboxStarts).toHaveLength(0)
    expect(ctx.db.collections.sessionMeta.get(`current`).target).toBe(`host`)
  })

  it(`is a no-op when meta.target already matches the requested target`, async () => {
    const lm = new LifecycleManager({
      providers: { sandbox: makeFakeProvider(), host: makeFakeProvider() },
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
      target: `host`,
      pinned: false,
      workspaceIdentity: `bindMount:/tmp/x`,
      workspaceSpec: { type: `bindMount`, hostPath: `/tmp/x` },
      idleTimeoutMs: 1000,
      keepWarm: false,
    }
    const { ctx } = makeFakeCtx({
      entityUrl: `/t/coding-agent/x`,
      meta,
      inbox: [
        { key: `i1`, message_type: `convert-target`, payload: { to: `host` } },
      ],
    })
    await handler(ctx, { type: `message_received` } as any)
    const after = ctx.db.collections.sessionMeta.get(`current`)
    expect(after.target).toBe(`host`)
    const evt = ctx.db.collections.lifecycle.toArray.find(
      (r: any) => r.event === `target.changed`
    )
    expect(evt).toBeUndefined() // no lifecycle row for no-op
  })
})
