import { describe, it, expect, vi } from 'vitest'
import { makeCodingAgentHandler } from '../../src/entity/handler'
import type { LifecycleManager } from '../../src/lifecycle-manager'
import type { SandboxInstance } from '../../src/types'
import type {
  NativeJsonlRow,
  SessionMetaRow,
} from '../../src/entity/collections'

function makeExecHandle(stdoutLines: string[], exitCode = 0) {
  return {
    stdout: (async function* () {
      for (const l of stdoutLines) yield l
    })(),
    stderr: (async function* () {})(),
    writeStdin: vi.fn().mockResolvedValue(undefined),
    closeStdin: vi.fn().mockResolvedValue(undefined),
    wait: vi.fn().mockResolvedValue({ exitCode }),
  }
}

function makeSandbox(
  stdoutLines: string[]
): SandboxInstance & { execCalls: any[]; copyToCalls: any[] } {
  const execCalls: any[] = []
  const copyToCalls: any[] = []
  return {
    instanceId: `inst-1`,
    workspaceMount: `/workspace`,
    exec: vi.fn(async (req) => {
      execCalls.push(req)
      // Probe-and-materialise: 'test -f <path>' returns non-zero when
      // the transcript file is missing (the case we want to exercise).
      if (req.cmd?.[0] === `test` && req.cmd?.[1] === `-f`) {
        return makeExecHandle(stdoutLines, 1)
      }
      return makeExecHandle(stdoutLines, 0)
    }),
    copyTo: vi.fn(async (args) => {
      copyToCalls.push(args)
    }),
    destroy: vi.fn(),
    execCalls,
    copyToCalls,
  } as any
}

function makeMinimalLm(sandbox: SandboxInstance) {
  const lm = {
    startedAtMs: Date.now(),
    statusFor: vi.fn().mockResolvedValue(`stopped`),
    bridge: {
      runTurn: vi.fn().mockResolvedValue({
        nativeSessionId: `native-1`,
        finalText: `reply`,
        exitCode: 0,
      }),
    },
    ensureRunning: vi.fn().mockResolvedValue(sandbox),
    stopFor: vi.fn().mockResolvedValue(undefined),
    destroyFor: vi.fn().mockResolvedValue(undefined),
    destroyAndForget: vi.fn().mockResolvedValue(undefined),
    pin: vi.fn().mockReturnValue({ count: 1 }),
    release: vi.fn().mockReturnValue({ count: 0 }),
    pinCount: vi.fn().mockReturnValue(0),
    armIdleTimer: vi.fn(),
  }
  return lm as unknown as LifecycleManager
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

describe(`handler resume materialisation`, () => {
  it(`calls sandbox.exec to materialise nativeJsonl rows on cold-boot when nativeSessionId is set`, async () => {
    const sandbox = makeSandbox([])
    const lm = makeMinimalLm(sandbox)
    const { ctx, state } = makeFakeCtx(`/test/ca/resume-1`, {
      kind: `claude`,
      workspaceType: `volume`,
      workspaceName: `vol-1`,
    })
    const { WorkspaceRegistry } = await import(`../../src/workspace-registry`)
    const wr = new WorkspaceRegistry()

    const handler = makeCodingAgentHandler(lm, wr, {
      defaults: {
        idleTimeoutMs: 500,
        coldBootBudgetMs: 30_000,
        runTimeoutMs: 60_000,
      },
      env: () => ({}),
    })

    await handler(ctx, { type: `message_received` })

    state.sessionMeta.rows.set(`current`, {
      ...(state.sessionMeta.get(`current`) as SessionMetaRow),
      nativeSessionId: `native-sess-xyz`,
    })
    state.nativeJsonl.rows.set(`current`, {
      key: `current`,
      nativeSessionId: `native-sess-xyz`,
      content: `{"type":"user","message":{"role":"user","content":"prior"}}\n`,
    } satisfies NativeJsonlRow)

    state.inbox.rows.set(`i1`, {
      key: `i1`,
      message_type: `prompt`,
      payload: { text: `second prompt` },
    })
    await handler(ctx, { type: `message_received` })

    // Probe-and-materialise: handler must probe `test -f <transcript>`,
    // see it missing, then call copyTo with the absolute path.
    const probeCalls = (
      sandbox.exec as ReturnType<typeof vi.fn>
    ).mock.calls.filter(
      (c: any[]) => c[0]?.cmd?.[0] === `test` && c[0]?.cmd?.[1] === `-f`
    )
    expect(probeCalls.length).toBeGreaterThan(0)
    expect(probeCalls[0][0].cmd[2]).toContain(`native-sess-xyz.jsonl`)

    expect(sandbox.copyToCalls.length).toBe(1)
    expect(sandbox.copyToCalls[0].destPath).toContain(`native-sess-xyz.jsonl`)
    expect(sandbox.copyToCalls[0].content).toContain(`prior`)
  })

  it(`adds a resume.restored lifecycle row after materialisation`, async () => {
    const sandbox = makeSandbox([])
    const lm = makeMinimalLm(sandbox)
    const { ctx, state } = makeFakeCtx(`/test/ca/resume-2`, {
      kind: `claude`,
      workspaceType: `volume`,
      workspaceName: `vol-2`,
    })
    const { WorkspaceRegistry } = await import(`../../src/workspace-registry`)
    const wr = new WorkspaceRegistry()

    const handler = makeCodingAgentHandler(lm, wr, {
      defaults: {
        idleTimeoutMs: 500,
        coldBootBudgetMs: 30_000,
        runTimeoutMs: 60_000,
      },
      env: () => ({}),
    })

    await handler(ctx, { type: `message_received` })

    state.sessionMeta.rows.set(`current`, {
      ...(state.sessionMeta.get(`current`) as SessionMetaRow),
      nativeSessionId: `native-sess-abc`,
    })
    state.nativeJsonl.rows.set(`current`, {
      key: `current`,
      nativeSessionId: `native-sess-abc`,
      content: `{"type":"user","message":{"role":"user","content":"prior"}}\n`,
    } satisfies NativeJsonlRow)

    state.inbox.rows.set(`i1`, {
      key: `i1`,
      message_type: `prompt`,
      payload: { text: `hello again` },
    })
    await handler(ctx, { type: `message_received` })

    const lifecycleRows = Array.from(state.lifecycle.rows.values()) as any[]
    const resumeRow = lifecycleRows.find((r) => r.event === `resume.restored`)
    expect(resumeRow).toBeDefined()
    expect(resumeRow.detail).toMatch(/^bytes=\d+$/)
  })

  it(`skips copyTo and lifecycle row when transcript file already exists`, async () => {
    // Sandbox where the probe (`test -f`) returns exit 0 (file exists).
    const execCalls: any[] = []
    const copyToCalls: any[] = []
    const sandbox = {
      instanceId: `inst-1`,
      workspaceMount: `/workspace`,
      exec: vi.fn(async (req: any) => {
        execCalls.push(req)
        return makeExecHandle([], 0) // probe returns 0 = file exists
      }),
      copyTo: vi.fn(async (args: any) => {
        copyToCalls.push(args)
      }),
    } as any
    const lm = makeMinimalLm(sandbox)
    const { ctx, state } = makeFakeCtx(`/test/ca/resume-3`, {
      kind: `claude`,
      workspaceType: `volume`,
      workspaceName: `vol-3`,
    })
    const { WorkspaceRegistry } = await import(`../../src/workspace-registry`)
    const wr = new WorkspaceRegistry()

    const handler = makeCodingAgentHandler(lm, wr, {
      defaults: {
        idleTimeoutMs: 500,
        coldBootBudgetMs: 30_000,
        runTimeoutMs: 60_000,
      },
      env: () => ({}),
    })

    await handler(ctx, { type: `message_received` })
    state.sessionMeta.rows.set(`current`, {
      ...(state.sessionMeta.get(`current`) as SessionMetaRow),
      nativeSessionId: `native-sess-warm`,
    })
    state.nativeJsonl.rows.set(`current`, {
      key: `current`,
      nativeSessionId: `native-sess-warm`,
      content: `{"type":"user","message":{"role":"user","content":"prior"}}\n`,
    } satisfies NativeJsonlRow)

    state.inbox.rows.set(`i1`, {
      key: `i1`,
      message_type: `prompt`,
      payload: { text: `another` },
    })
    await handler(ctx, { type: `message_received` })

    expect(copyToCalls.length).toBe(0)
    const lifecycleRows = Array.from(state.lifecycle.rows.values()) as any[]
    expect(
      lifecycleRows.find((r) => r.event === `resume.restored`)
    ).toBeUndefined()
  })
})
