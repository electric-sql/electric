import { describe, expect, it } from 'vitest'
import type { NormalizedEvent } from 'agent-session-protocol'
import { LifecycleManager } from '../../src/lifecycle-manager'
import { WorkspaceRegistry } from '../../src/workspace-registry'
import { makeCodingAgentHandler } from '../../src/entity/handler'
import type {
  EventRow,
  LifecycleRow,
  NativeJsonlRow,
  RunRow,
  SessionMetaRow,
} from '../../src/entity/collections'
import { makeFakeCtx } from '../../src/conformance/fake-ctx'

const fakeProvider = {
  name: `fake`,
  start: async () => ({
    instanceId: `i1`,
    agentId: `x`,
    workspaceMount: `/work`,
    homeDir: `/home/agent`,
    exec: async () => ({
      stdout: (async function* () {})(),
      stderr: (async function* () {})(),
      wait: async () => ({ exitCode: 0 }),
      kill: () => undefined,
    }),
    copyTo: async () => undefined,
  }),
  stop: async () => undefined,
  destroy: async () => undefined,
  status: async () => `stopped` as const,
  recover: async () => [],
}
const fakeBridge = { runTurn: async () => ({ exitCode: 0 }) }

function makeHandler() {
  const wr = new WorkspaceRegistry()
  const lm = new LifecycleManager({
    providers: { sandbox: fakeProvider as any, host: fakeProvider as any },
    bridge: fakeBridge as any,
  })
  return makeCodingAgentHandler(lm, wr, {
    defaults: {
      idleTimeoutMs: 5000,
      coldBootBudgetMs: 5000,
      runTimeoutMs: 30_000,
    },
    env: () => ({}),
  })
}

describe(`fork first-wake`, () => {
  it(`reads source events, denormalizes, populates nativeJsonl, inserts kind.forked`, async () => {
    // Build a source agent ctx with seeded events.
    const sourceId = `/test/coding-agent/source-${Date.now().toString(36)}`
    const { state: sourceState } = makeFakeCtx(sourceId, {
      kind: `claude`,
      target: `sandbox`,
      workspaceType: `volume`,
    })
    const sourceEvents: Array<NormalizedEvent> = [
      {
        type: `session_init`,
        ts: 1,
        sessionId: `src`,
        cwd: `/work`,
      } as NormalizedEvent,
      { type: `user_message`, ts: 2, text: `hello` } as NormalizedEvent,
      {
        type: `assistant_message`,
        ts: 3,
        text: `from claude`,
      } as NormalizedEvent,
      { type: `turn_complete`, ts: 4, durationMs: 100 } as NormalizedEvent,
    ]
    sourceState.runs.rows.set(`r1`, {
      key: `r1`,
      startedAt: 1,
      endedAt: 4,
      status: `completed`,
      promptInboxKey: `i0`,
    } as RunRow)
    sourceEvents.forEach((e, i) => {
      sourceState.events.rows.set(`r1:${String(i).padStart(20, `0`)}`, {
        key: `r1:${String(i).padStart(20, `0`)}`,
        runId: `r1`,
        seq: i,
        ts: e.ts,
        type: e.type,
        payload: e as unknown as Record<string, unknown>,
      } as EventRow)
    })

    // Build the fork ctx with `fromAgentId` arg pointing to source.
    const handler = makeHandler()
    const forkId = `/test/coding-agent/fork-${Date.now().toString(36)}`
    const { ctx: forkCtx, state: forkState } = makeFakeCtx(forkId, {
      kind: `codex`,
      target: `sandbox`,
      workspaceType: `volume`,
      fromAgentId: sourceId,
      fromWorkspaceMode: `share`,
    })

    // Stub ctx.observe to return the source state.
    ;(forkCtx as any).observe = async (src: {
      sourceType: string
      sourceRef: string
    }) => {
      if (src.sourceType === `entity` && src.sourceRef === sourceId) {
        return {
          sourceType: `entity`,
          sourceRef: sourceId,
          db: {
            collections: { events: sourceState.events, runs: sourceState.runs },
          },
          events: [],
        }
      }
      throw new Error(`unexpected observe target: ${src.sourceRef}`)
    }

    await handler(forkCtx, { type: `message_received` })

    // Fork should have nativeJsonl populated from denormalize(sourceEvents, 'codex').
    const native = forkState.nativeJsonl.get(`current`) as
      | NativeJsonlRow
      | undefined
    expect(native).toBeDefined()
    expect(native!.nativeSessionId.length).toBeGreaterThan(0)
    expect(native!.content.length).toBeGreaterThan(0)

    const meta = forkState.sessionMeta.get(`current`) as SessionMetaRow
    expect(meta.kind).toBe(`codex`)
    expect(meta.nativeSessionId).toBe(native!.nativeSessionId)

    const lifecycle = Array.from(
      forkState.lifecycle.rows.values()
    ) as Array<LifecycleRow>
    const forked = lifecycle.find((l) => l.event === `kind.forked`)
    expect(forked).toBeDefined()
    expect(forked?.detail).toContain(sourceId)
  })

  it(`source has no events → fork still proceeds, native empty`, async () => {
    const sourceId = `/test/coding-agent/empty-source-${Date.now().toString(36)}`
    const { state: sourceState } = makeFakeCtx(sourceId, {
      kind: `claude`,
      target: `sandbox`,
      workspaceType: `volume`,
    })

    const handler = makeHandler()
    const forkId = `/test/coding-agent/fork-empty-${Date.now().toString(36)}`
    const { ctx: forkCtx, state: forkState } = makeFakeCtx(forkId, {
      kind: `codex`,
      target: `sandbox`,
      workspaceType: `volume`,
      fromAgentId: sourceId,
      fromWorkspaceMode: `share`,
    })
    ;(forkCtx as any).observe = async () => ({
      sourceType: `entity`,
      sourceRef: sourceId,
      db: {
        collections: { events: sourceState.events, runs: sourceState.runs },
      },
      events: [],
    })

    await handler(forkCtx, { type: `message_received` })

    const native = forkState.nativeJsonl.get(`current`) as
      | NativeJsonlRow
      | undefined
    expect(native?.content ?? ``).toBe(``)
    const meta = forkState.sessionMeta.get(`current`) as SessionMetaRow
    expect(meta.kind).toBe(`codex`)
    const lifecycle = Array.from(
      forkState.lifecycle.rows.values()
    ) as Array<LifecycleRow>
    expect(lifecycle.find((l) => l.event === `kind.forked`)).toBeDefined()
  })
})

describe(`fork workspaceMode default policy`, () => {
  it(`bindMount source defaults to share (no clone attempt)`, async () => {
    const sourceId = `/test/coding-agent/bm-src-${Date.now().toString(36)}`
    const { state: sourceState } = makeFakeCtx(sourceId, {
      kind: `claude`,
      target: `host`,
      workspaceType: `bindMount`,
      workspaceHostPath: `/tmp/source-bm`,
    })
    sourceState.sessionMeta.rows.set(`current`, {
      ...(sourceState.sessionMeta.get(`current`) as SessionMetaRow),
      workspaceSpec: { type: `bindMount`, hostPath: `/tmp/source-bm` },
    })

    const handler = makeHandler()
    const forkId = `/test/coding-agent/bm-fork-${Date.now().toString(36)}`
    const { ctx: forkCtx, state: forkState } = makeFakeCtx(forkId, {
      kind: `codex`,
      target: `sandbox`,
      workspaceType: `volume`,
      fromAgentId: sourceId,
      // No fromWorkspaceMode — policy should default to share for bindMount.
    })
    ;(forkCtx as any).observe = async () => ({
      sourceType: `entity`,
      sourceRef: sourceId,
      db: {
        collections: {
          events: sourceState.events,
          runs: sourceState.runs,
          sessionMeta: sourceState.sessionMeta,
        },
      },
      events: [],
    })

    await handler(forkCtx, { type: `message_received` })

    const lifecycle = Array.from(
      forkState.lifecycle.rows.values()
    ) as Array<LifecycleRow>
    const forked = lifecycle.find((l) => l.event === `kind.forked`)
    expect(forked?.detail).toContain(`mode=share`)
  })

  it(`explicit clone against provider without cloneWorkspace errors`, async () => {
    const sourceId = `/test/coding-agent/v-src-${Date.now().toString(36)}`
    const { state: sourceState } = makeFakeCtx(sourceId, {
      kind: `claude`,
      target: `sandbox`,
      workspaceType: `volume`,
      workspaceName: `src-vol`,
    })

    const handler = makeHandler()
    const forkId = `/test/coding-agent/v-fork-${Date.now().toString(36)}`
    const { ctx: forkCtx, state: forkState } = makeFakeCtx(forkId, {
      kind: `codex`,
      target: `sandbox`,
      workspaceType: `volume`,
      fromAgentId: sourceId,
      fromWorkspaceMode: `clone`,
    })
    ;(forkCtx as any).observe = async () => ({
      sourceType: `entity`,
      sourceRef: sourceId,
      db: {
        collections: {
          events: sourceState.events,
          runs: sourceState.runs,
          sessionMeta: sourceState.sessionMeta,
        },
      },
      events: [],
    })

    // makeHandler's fakeProvider doesn't expose cloneWorkspace.
    await handler(forkCtx, { type: `message_received` })

    const meta = forkState.sessionMeta.get(`current`) as SessionMetaRow
    expect(meta.status).toBe(`error`)
    expect(meta.lastError).toMatch(/clone/i)
  })
})
