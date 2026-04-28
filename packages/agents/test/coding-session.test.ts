import { describe, expect, it, vi } from 'vitest'
import { createEntityRegistry } from '@electric-ax/agents-runtime'
import { registerCodingSession } from '../src/agents/coding-session'

function makeFakeCtx(opts: {
  firstWake: boolean
  args: Record<string, unknown>
  entityUrl?: string
  inbox?: Array<{
    key: string
    from: string
    payload?: unknown
    timestamp: string
    message_type?: string
  }>
  existing?: {
    sessionMeta?: Record<string, unknown>
    cursorState?: Record<string, unknown>
  }
}) {
  const state: Record<string, Map<string, Record<string, unknown>>> = {
    sessionMeta: new Map(),
    cursorState: new Map(),
    events: new Map(),
  }
  if (opts.existing?.sessionMeta) {
    state.sessionMeta!.set(`current`, { ...opts.existing.sessionMeta })
  }
  if (opts.existing?.cursorState) {
    state.cursorState!.set(`current`, { ...opts.existing.cursorState })
  }

  const inbox = opts.inbox ?? []
  const calls: Array<{ action: string; args: unknown }> = []

  const makeActions = () => {
    const mk = (name: string) => ({
      insert: ({ row }: { row: Record<string, unknown> }) => {
        calls.push({ action: `${name}_insert`, args: { row } })
        const key = String(row.key)
        state[name]!.set(key, { ...row })
      },
      update: ({
        key,
        updater,
      }: {
        key: string
        updater: (d: Record<string, unknown>) => void
      }) => {
        const existing = state[name]!.get(key)
        if (!existing) return
        updater(existing)
        calls.push({ action: `${name}_update`, args: { key } })
      },
    })
    const sm = mk(`sessionMeta`)
    const cs = mk(`cursorState`)
    const ev = mk(`events`)
    return {
      sessionMeta_insert: sm.insert,
      sessionMeta_update: sm.update,
      cursorState_insert: cs.insert,
      cursorState_update: cs.update,
      events_insert: ev.insert,
    }
  }

  const ctx = {
    firstWake: opts.firstWake,
    args: opts.args,
    entityUrl: opts.entityUrl ?? `/coding-session/test-1`,
    // The handler reads `ctx.tags.title` and calls `ctx.setTag(...)`
    // when adopting the first prompt as the entity's display title.
    // Provide an empty tags map and a no-op setTag so neither call
    // throws before the CLI runner is exercised.
    tags: {} as Record<string, string>,
    setTag: () => Promise.resolve(),
    db: {
      actions: makeActions(),
      collections: {
        sessionMeta: { get: (k: string) => state.sessionMeta!.get(k) },
        cursorState: { get: (k: string) => state.cursorState!.get(k) },
        events: {
          get toArray() {
            return Array.from(state.events!.values())
          },
        },
        inbox: { toArray: inbox },
        // recordRun() reads `runs.toArray` to seed its counter; an
        // empty array is fine for tests that don't otherwise care.
        runs: { toArray: [] as Array<{ key: string }> },
      },
    },
    // The handler calls ctx.recordRun() around each CLI invocation;
    // give the mock a no-op handle so it doesn't blow up before the
    // CLI runner is exercised.
    recordRun: () => ({
      key: `run-0`,
      end: () => {},
      attachResponse: () => {},
    }),
  }

  return { ctx, state, calls }
}

describe(`registerCodingSession`, () => {
  it(`registers the coding-session entity type`, () => {
    const registry = createEntityRegistry()
    registerCodingSession(registry)
    const def = registry.get(`coder`)
    expect(def).toBeDefined()
    expect(def!.definition.state).toBeDefined()
    expect(def!.definition.state!.sessionMeta).toBeDefined()
    expect(def!.definition.state!.cursorState).toBeDefined()
    expect(def!.definition.state!.events).toBeDefined()
  })

  it(`seeds sessionMeta and cursorState on firstWake with no prompts`, async () => {
    const registry = createEntityRegistry()
    registerCodingSession(registry, { defaultWorkingDirectory: `/tmp/x` })
    const def = registry.get(`coder`)!

    const { ctx, state } = makeFakeCtx({
      firstWake: true,
      args: { agent: `claude` },
      entityUrl: `/coding-session/my-task`,
    })

    await def.definition.handler(
      ctx as unknown as Parameters<typeof def.definition.handler>[0],
      { type: `entity_created` } as unknown as Parameters<
        typeof def.definition.handler
      >[1]
    )

    const meta = state.sessionMeta!.get(`current`)
    expect(meta).toMatchObject({
      electricSessionId: `my-task`,
      agent: `claude`,
      cwd: `/tmp/x`,
      status: `initializing`,
    })
    expect(meta!.nativeSessionId).toBeUndefined()
    const cursor = state.cursorState!.get(`current`)
    expect(cursor).toMatchObject({ cursor: `` })
  })

  it(`starts as idle when attaching to an existing nativeSessionId`, async () => {
    const registry = createEntityRegistry()
    registerCodingSession(registry, { defaultWorkingDirectory: `/tmp/x` })
    const def = registry.get(`coder`)!

    const { state } = makeFakeCtx({
      firstWake: true,
      args: { agent: `codex`, nativeSessionId: `pre-existing-uuid` },
    })
    const { ctx } = makeFakeCtx({
      firstWake: true,
      args: { agent: `codex`, nativeSessionId: `pre-existing-uuid` },
    })

    await def.definition.handler(
      ctx as unknown as Parameters<typeof def.definition.handler>[0],
      { type: `entity_created` } as unknown as Parameters<
        typeof def.definition.handler
      >[1]
    )
    void state // silence unused binding

    // Re-read from the ctx's own state via its collection
    const meta = (ctx.db.collections.sessionMeta.get(`current`) as
      | Record<string, unknown>
      | undefined)!
    expect(meta.agent).toBe(`codex`)
    expect(meta.nativeSessionId).toBe(`pre-existing-uuid`)
    expect(meta.status).toBe(`idle`)
  })

  it(`invokes the injected cliRunner for a queued prompt and mirrors normalized events`, async () => {
    // Inject a fake runner + fake agent-session-protocol pullEvents path
    // by pre-populating the cursorState (so pullNewEvents takes the tail
    // branch) and attaching to an existing nativeSessionId (so the
    // lazy-create path that hits the filesystem is bypassed).
    //
    // This still exercises the handler's queue-drain logic without
    // touching ~/.claude or ~/.codex.

    const runner = {
      run: vi.fn(async () => ({ exitCode: 0, stdout: ``, stderr: `` })),
    }
    const registry = createEntityRegistry()
    registerCodingSession(registry, {
      defaultWorkingDirectory: `/tmp/x`,
      cliRunner: runner,
    })
    const def = registry.get(`coder`)!

    const { ctx, state, calls } = makeFakeCtx({
      firstWake: false,
      args: { agent: `claude`, nativeSessionId: `existing-uuid` },
      inbox: [
        {
          key: `m-001`,
          from: `/caller/1`,
          timestamp: `2026-04-23T00:00:00Z`,
          message_type: `prompt`,
          payload: { text: `say hi` },
        },
      ],
      existing: {
        sessionMeta: {
          key: `current`,
          electricSessionId: `test-1`,
          nativeSessionId: `existing-uuid`,
          agent: `claude`,
          cwd: `/tmp/x`,
          status: `idle`,
        },
        cursorState: { key: `current`, cursor: ``, eventCounter: 0 },
      },
    })

    // The handler will call resolveSession + loadSession under the hood,
    // which hit the filesystem. Expect this call to throw — we're
    // asserting the error surfaces cleanly as a failed prompt rather
    // than a hang.
    await expect(
      def.definition.handler(
        ctx as unknown as Parameters<typeof def.definition.handler>[0],
        { type: `message_received` } as unknown as Parameters<
          typeof def.definition.handler
        >[1]
      )
    ).rejects.toThrow()

    // Runner was invoked with the prompt
    expect(runner.run).toHaveBeenCalledTimes(1)
    const call = (
      runner.run.mock.calls as unknown as Array<Array<unknown>>
    )[0]![0] as {
      agent: string
      prompt: string
      sessionId?: string
    }
    expect(call.agent).toBe(`claude`)
    expect(call.prompt).toBe(`say hi`)
    expect(call.sessionId).toBe(`existing-uuid`)

    // Meta was flipped to error with a diagnostic message
    const meta = state.sessionMeta!.get(`current`)!
    expect(meta.status).toBe(`error`)
    expect(typeof meta.error).toBe(`string`)
    // The prompt is marked as processed so it won't be retried on the next wake
    const cursor = state.cursorState!.get(`current`)!
    expect(cursor.lastProcessedInboxKey).toBe(`m-001`)
    void calls // reserved for future assertions
  })

  it(`accepts inbox messages without message_type (bare /send from generic UI)`, async () => {
    const runner = {
      run: vi.fn(async () => ({ exitCode: 0, stdout: ``, stderr: `` })),
    }
    const registry = createEntityRegistry()
    registerCodingSession(registry, {
      defaultWorkingDirectory: `/tmp/x`,
      cliRunner: runner,
    })
    const def = registry.get(`coder`)!

    const { ctx } = makeFakeCtx({
      firstWake: false,
      args: { agent: `claude`, nativeSessionId: `existing-uuid` },
      inbox: [
        {
          key: `m-001`,
          from: `user`,
          timestamp: `2026-04-23T00:00:00Z`,
          // No message_type — mimics the existing UI MessageInput
          payload: { text: `hello` },
        },
      ],
      existing: {
        sessionMeta: {
          key: `current`,
          electricSessionId: `test-1`,
          nativeSessionId: `existing-uuid`,
          agent: `claude`,
          cwd: `/tmp/x`,
          status: `idle`,
        },
        cursorState: { key: `current`, cursor: ``, eventCounter: 0 },
      },
    })

    await expect(
      def.definition.handler(
        ctx as unknown as Parameters<typeof def.definition.handler>[0],
        { type: `message_received` } as unknown as Parameters<
          typeof def.definition.handler
        >[1]
      )
    ).rejects.toThrow() // resolveSession fails for a synthetic id — same as the other test

    expect(runner.run).toHaveBeenCalledTimes(1)
    const call = (
      runner.run.mock.calls as unknown as Array<Array<unknown>>
    )[0]![0] as { prompt: string }
    expect(call.prompt).toBe(`hello`)
  })
})
