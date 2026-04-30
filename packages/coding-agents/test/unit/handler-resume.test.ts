import { describe, it, expect, vi } from 'vitest'
import { makeCodingAgentHandler } from '../../src/entity/handler'
import type { LifecycleManager } from '../../src/lifecycle-manager'
import type { SandboxInstance } from '../../src/types'
import type {
  NativeJsonlRow,
  SessionMetaRow,
} from '../../src/entity/collections'

function makeExecHandle(stdoutLines: string[]) {
  return {
    stdout: (async function* () {
      for (const l of stdoutLines) yield l
    })(),
    stderr: (async function* () {})(),
    writeStdin: vi.fn().mockResolvedValue(undefined),
    closeStdin: vi.fn().mockResolvedValue(undefined),
    wait: vi.fn().mockResolvedValue({ exitCode: 0 }),
  }
}

function makeSandbox(
  stdoutLines: string[]
): SandboxInstance & { execCalls: any[] } {
  const execCalls: any[] = []
  return {
    instanceId: `inst-1`,
    workspaceMount: `/workspace`,
    exec: vi.fn(async (req) => {
      execCalls.push(req)
      return makeExecHandle(stdoutLines)
    }),
    destroy: vi.fn(),
    execCalls,
  } as any
}

function makeMinimalLm(sandbox: SandboxInstance) {
  const lm = {
    startedAtMs: Date.now(),
    provider: {
      status: vi.fn().mockResolvedValue(`stopped`),
      destroy: vi.fn().mockResolvedValue(undefined),
    },
    bridge: {
      runTurn: vi.fn().mockResolvedValue({
        nativeSessionId: `native-1`,
        finalText: `reply`,
        exitCode: 0,
      }),
    },
    ensureRunning: vi.fn().mockResolvedValue(sandbox),
    stop: vi.fn().mockResolvedValue(undefined),
    destroy: vi.fn().mockResolvedValue(undefined),
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
    const fakeJsonlLine = JSON.stringify({
      type: `result`,
      subtype: `success`,
      result: `prior`,
      session_id: `native-sess-xyz`,
      is_error: false,
    })
    state.nativeJsonl.rows.set(`run-1:000000000000000`, {
      key: `run-1:000000000000000`,
      runId: `run-1`,
      seq: 0,
      line: fakeJsonlLine,
    } satisfies NativeJsonlRow)

    state.inbox.rows.set(`i1`, {
      key: `i1`,
      message_type: `prompt`,
      payload: { text: `second prompt` },
    })
    await handler(ctx, { type: `message_received` })

    const shellCalls = (
      sandbox.exec as ReturnType<typeof vi.fn>
    ).mock.calls.filter((c: any[]) => c[0]?.cmd?.[0] === `sh`)
    expect(shellCalls.length).toBeGreaterThan(0)
    const cmd = shellCalls[0][0].cmd.join(` `)
    expect(cmd).toContain(`native-sess-xyz.jsonl`)
    expect(cmd).toContain(`base64`)
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
    state.nativeJsonl.rows.set(`run-1:0`, {
      key: `run-1:0`,
      runId: `run-1`,
      seq: 0,
      line: `{"type":"result","subtype":"success","result":"x","session_id":"native-sess-abc","is_error":false}`,
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
    expect(resumeRow.detail).toMatch(/lines=1/)
  })
})
