import { describe, expect, it, vi } from 'vitest'
import {
  createEntityRegistry,
  codingSessionResourceId,
} from '@electric-ax/agents-runtime'
import { registerCodingSession } from '../src/agents/coding-session'
import type { NormalizedEvent } from 'agent-session-protocol'

/**
 * Build a fake HandlerContext rich enough to drive the coder entity
 * end-to-end without a real runtime. The fake provides:
 *   - entity-local state collections (`runStatus`, `inboxCursor`)
 *   - a fake `mkdb` + `observe` pair that returns a SharedStateHandle
 *     wired to in-memory Maps (one per resource id)
 *   - a `setTag` capture so tests can assert on the resource pointer
 *
 * Tests exercise this via `state.entity.runStatus` /
 * `state.resource.events` / `state.tags.coderResource` etc.
 */
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
    runStatus?: Record<string, unknown>
    inboxCursor?: Record<string, unknown>
    sessionInfo?: Record<string, unknown>
    transcript?: Array<Record<string, unknown>>
  }
}) {
  const entityState: Record<string, Map<string, Record<string, unknown>>> = {
    runStatus: new Map(),
    inboxCursor: new Map(),
  }
  if (opts.existing?.runStatus) {
    entityState.runStatus!.set(`current`, { ...opts.existing.runStatus })
  }
  if (opts.existing?.inboxCursor) {
    entityState.inboxCursor!.set(`current`, { ...opts.existing.inboxCursor })
  }

  const resourceStores: Record<
    string,
    Record<string, Map<string, Record<string, unknown>>>
  > = {}
  const ensureResource = (id: string) => {
    if (!resourceStores[id]) {
      resourceStores[id] = {
        sessionInfo: new Map(),
        transcript: new Map(),
      }
    }
    return resourceStores[id]!
  }

  const inbox = opts.inbox ?? []
  const tags: Record<string, string> = {}

  const makeEntityActions = () => {
    const mk = (name: string) => ({
      insert: ({ row }: { row: Record<string, unknown> }) => {
        entityState[name]!.set(String(row.key), { ...row })
      },
      update: ({
        key,
        updater,
      }: {
        key: string
        updater: (d: Record<string, unknown>) => void
      }) => {
        const existing = entityState[name]!.get(key)
        if (!existing) return
        updater(existing)
      },
    })
    const rs = mk(`runStatus`)
    const ic = mk(`inboxCursor`)
    return {
      runStatus_insert: rs.insert,
      runStatus_update: rs.update,
      inboxCursor_insert: ic.insert,
      inboxCursor_update: ic.update,
    }
  }

  const buildCollectionProxy = (map: Map<string, Record<string, unknown>>) => ({
    insert: (row: Record<string, unknown>) => {
      map.set(String(row.key), { ...row })
      return undefined
    },
    update: (key: string, updater: (d: Record<string, unknown>) => void) => {
      const existing = map.get(key)
      if (!existing) return undefined
      updater(existing)
      return undefined
    },
    get: (key: string) => map.get(key),
    delete: (key: string) => {
      map.delete(key)
      return undefined
    },
    get toArray() {
      return Array.from(map.values())
    },
  })

  const buildResourceHandle = (id: string) => {
    const store = ensureResource(id)
    return {
      id,
      sessionInfo: buildCollectionProxy(store.sessionInfo!),
      transcript: buildCollectionProxy(store.transcript!),
    }
  }

  if (opts.existing?.sessionInfo) {
    const id = codingSessionResourceId(
      (opts.entityUrl ?? `/coder/test-1`).split(`/`).pop() ?? ``
    )
    ensureResource(id).sessionInfo.set(`current`, {
      ...opts.existing.sessionInfo,
    })
  }
  if (opts.existing?.transcript) {
    const id = codingSessionResourceId(
      (opts.entityUrl ?? `/coder/test-1`).split(`/`).pop() ?? ``
    )
    const map = ensureResource(id).transcript
    for (const ev of opts.existing.transcript) {
      map.set(String(ev.key), { ...ev })
    }
  }

  const ctx = {
    firstWake: opts.firstWake,
    args: opts.args,
    entityUrl: opts.entityUrl ?? `/coder/test-1`,
    tags,
    setTag: (key: string, value: string) => {
      tags[key] = value
      return Promise.resolve()
    },
    db: {
      actions: makeEntityActions(),
      collections: {
        runStatus: { get: (k: string) => entityState.runStatus!.get(k) },
        inboxCursor: { get: (k: string) => entityState.inboxCursor!.get(k) },
        inbox: { toArray: inbox },
        // recordRun() reads `runs.toArray` to seed its counter; an
        // empty array is fine for tests that don't otherwise care.
        runs: { toArray: [] as Array<{ key: string }> },
      },
    },
    mkdb: (id: string) => buildResourceHandle(id),
    observe: vi.fn(async (source: { sourceRef: string }) => {
      return buildResourceHandle(source.sourceRef)
    }),
    recordRun: () => ({
      key: `run-0`,
      end: () => {},
      attachResponse: () => {},
    }),
  }

  return { ctx, entityState, resourceStores, tags }
}

describe(`registerCodingSession`, () => {
  it(`registers the coder entity type with runStatus + inboxCursor state`, () => {
    const registry = createEntityRegistry()
    registerCodingSession(registry)
    const def = registry.get(`coder`)
    expect(def).toBeDefined()
    expect(def!.definition.state).toBeDefined()
    expect(def!.definition.state!.runStatus).toBeDefined()
    expect(def!.definition.state!.inboxCursor).toBeDefined()
    // sessionMeta / cursorState / events are gone — they live on the resource
    expect(def!.definition.state!.sessionMeta).toBeUndefined()
    expect(def!.definition.state!.transcript).toBeUndefined()
  })

  it(`creates a resource and tags the entity on first wake`, async () => {
    const registry = createEntityRegistry()
    registerCodingSession(registry, { defaultWorkingDirectory: `/tmp/x` })
    const def = registry.get(`coder`)!

    const { ctx, entityState, resourceStores, tags } = makeFakeCtx({
      firstWake: true,
      args: { agent: `claude` },
      entityUrl: `/coder/my-task`,
    })

    await def.definition.handler(
      ctx as unknown as Parameters<typeof def.definition.handler>[0],
      { type: `entity_created` } as unknown as Parameters<
        typeof def.definition.handler
      >[1]
    )

    const expectedResourceId = `coder-session/my-task`
    expect(tags.coderResource).toBe(expectedResourceId)

    const resource = resourceStores[expectedResourceId]!
    const sessionInfo = resource.sessionInfo!.get(`current`)!
    expect(sessionInfo).toMatchObject({
      agent: `claude`,
      cwd: `/tmp/x`,
      electricSessionId: `my-task`,
    })
    expect(sessionInfo.nativeSessionId).toBeUndefined()

    const runStatus = entityState.runStatus!.get(`current`)!
    expect(runStatus.status).toBe(`initializing`)
    expect(entityState.inboxCursor!.get(`current`)).toBeDefined()
  })

  it(`starts as idle when attaching to an existing nativeSessionId`, async () => {
    const registry = createEntityRegistry()
    registerCodingSession(registry, { defaultWorkingDirectory: `/tmp/x` })
    const def = registry.get(`coder`)!

    const { ctx, entityState, resourceStores } = makeFakeCtx({
      firstWake: true,
      args: { agent: `codex`, nativeSessionId: `pre-existing-uuid` },
      entityUrl: `/coder/attached-1`,
    })

    // The attach path calls loadSession internally, which would touch
    // the filesystem. The resource starts empty so `events.length === 0`
    // would trigger the initial mirror — but since we're not actually
    // configuring loadSession to succeed here, the catch handler logs
    // an error on runStatus and continues. We just verify the seed.
    await def.definition.handler(
      ctx as unknown as Parameters<typeof def.definition.handler>[0],
      { type: `entity_created` } as unknown as Parameters<
        typeof def.definition.handler
      >[1]
    )

    const sessionInfo =
      resourceStores[`coder-session/attached-1`]!.sessionInfo!.get(`current`)!
    expect(sessionInfo.agent).toBe(`codex`)
    expect(sessionInfo.nativeSessionId).toBe(`pre-existing-uuid`)
    expect(entityState.runStatus!.get(`current`)!.status).toBe(`idle`)
  })

  it(`runs a queued prompt and writes events into the resource`, async () => {
    const runner = {
      run: vi.fn(
        async (callArgs: {
          onEvent?: (ev: NormalizedEvent) => void
          onSessionId?: (id: string) => void
        }) => {
          callArgs.onEvent?.({
            v: 1,
            ts: 1714000000000,
            type: `assistant_message`,
            text: `hi back`,
          })
          return { exitCode: 0, stdout: `hi back`, stderr: `` }
        }
      ),
    }
    const registry = createEntityRegistry()
    registerCodingSession(registry, {
      defaultWorkingDirectory: `/tmp/x`,
      cliRunner: runner,
    })
    const def = registry.get(`coder`)!

    const { ctx, entityState, resourceStores } = makeFakeCtx({
      firstWake: false,
      args: { agent: `claude`, nativeSessionId: `existing-uuid` },
      entityUrl: `/coder/run-1`,
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
        runStatus: { key: `current`, status: `idle` },
        inboxCursor: { key: `current` },
        sessionInfo: {
          key: `current`,
          agent: `claude`,
          cwd: `/tmp/x`,
          electricSessionId: `run-1`,
          nativeSessionId: `existing-uuid`,
          createdAt: 1714000000000,
        },
        // Pre-seed at least one transcript row so the initial-mirror
        // branch is skipped (otherwise loadSession would be invoked
        // against the filesystem).
        transcript: [
          {
            key: `0000000000000000_seed_aaaa`,
            ts: 0,
            type: `seed`,
            payload: {},
          },
        ],
      },
    })

    await def.definition.handler(
      ctx as unknown as Parameters<typeof def.definition.handler>[0],
      { type: `message_received` } as unknown as Parameters<
        typeof def.definition.handler
      >[1]
    )

    expect(runner.run).toHaveBeenCalledTimes(1)
    const call = (
      runner.run.mock.calls as unknown as Array<Array<unknown>>
    )[0]![0] as { agent: string; prompt: string; sessionId?: string }
    expect(call.agent).toBe(`claude`)
    expect(call.prompt).toBe(`say hi`)
    expect(call.sessionId).toBe(`existing-uuid`)

    // Streamed event landed in the resource transcript (not the entity)
    const transcript = resourceStores[`coder-session/run-1`]!.transcript!
    expect(transcript.size).toBe(2) // seed + assistant_message
    const types = Array.from(transcript.values()).map((e) => e.type)
    expect(types).toContain(`assistant_message`)

    // Run state cleaned up
    const runStatus = entityState.runStatus!.get(`current`)!
    expect(runStatus.status).toBe(`idle`)
    expect(entityState.inboxCursor!.get(`current`)!.lastProcessedInboxKey).toBe(
      `m-001`
    )
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
      entityUrl: `/coder/bare-1`,
      inbox: [
        {
          key: `m-001`,
          from: `user`,
          timestamp: `2026-04-23T00:00:00Z`,
          payload: { text: `hello` },
        },
      ],
      existing: {
        runStatus: { key: `current`, status: `idle` },
        inboxCursor: { key: `current` },
        sessionInfo: {
          key: `current`,
          agent: `claude`,
          cwd: `/tmp/x`,
          electricSessionId: `bare-1`,
          nativeSessionId: `existing-uuid`,
          createdAt: 1714000000000,
        },
        transcript: [
          {
            key: `0000000000000000_seed_aaaa`,
            ts: 0,
            type: `seed`,
            payload: {},
          },
        ],
      },
    })

    await def.definition.handler(
      ctx as unknown as Parameters<typeof def.definition.handler>[0],
      { type: `message_received` } as unknown as Parameters<
        typeof def.definition.handler
      >[1]
    )

    expect(runner.run).toHaveBeenCalledTimes(1)
    const call = (
      runner.run.mock.calls as unknown as Array<Array<unknown>>
    )[0]![0] as { prompt: string }
    expect(call.prompt).toBe(`hello`)
  })
})
