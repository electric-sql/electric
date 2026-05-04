import { beforeEach, describe, expect, it } from 'vitest'
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
import { makeFakeCtx, pushInbox } from '../../src/conformance/fake-ctx'

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

const fakeBridge = {
  runTurn: async () => ({ exitCode: 0 }),
}

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

describe(`processConvertKind — happy path`, () => {
  let handler: ReturnType<typeof makeHandler>
  beforeEach(() => {
    handler = makeHandler()
  })

  it(`claude → codex regenerates nativeJsonl + sessionId, inserts kind.converted`, async () => {
    const agentId = `/test/coding-agent/cv-1-${Date.now().toString(36)}`
    const { ctx, state } = makeFakeCtx(agentId, {
      kind: `claude`,
      target: `sandbox`,
      workspaceType: `volume`,
    })
    await handler(ctx, { type: `message_received` })

    // Seed events: one user + one assistant turn.
    const sampleEvents: Array<NormalizedEvent> = [
      {
        type: `session_init`,
        ts: 1,
        sessionId: `old`,
        cwd: `/work`,
      } as NormalizedEvent,
      { type: `user_message`, ts: 2, text: `hi` } as NormalizedEvent,
      { type: `assistant_message`, ts: 3, text: `hello` } as NormalizedEvent,
      { type: `turn_complete`, ts: 4, durationMs: 100 } as NormalizedEvent,
    ]
    state.runs.rows.set(`r1`, {
      key: `r1`,
      startedAt: 1,
      endedAt: 4,
      status: `completed`,
      promptInboxKey: `i0`,
    } as RunRow)
    sampleEvents.forEach((e, i) => {
      state.events.rows.set(`r1:${String(i).padStart(20, `0`)}`, {
        key: `r1:${String(i).padStart(20, `0`)}`,
        runId: `r1`,
        seq: i,
        ts: e.ts,
        type: e.type,
        payload: e as unknown as Record<string, unknown>,
      } as EventRow)
    })
    state.sessionMeta.rows.set(`current`, {
      ...(state.sessionMeta.get(`current`) as SessionMetaRow),
      kind: `claude`,
      nativeSessionId: `old-claude-id`,
    })

    // Send convertKind message.
    pushInbox(state, `i1`, `convert-kind`, { kind: `codex` })
    await handler(ctx, { type: `message_received` })

    const meta = state.sessionMeta.get(`current`) as SessionMetaRow
    expect(meta.kind).toBe(`codex`)
    expect(meta.nativeSessionId).toBeDefined()
    expect(meta.nativeSessionId).not.toBe(`old-claude-id`)

    const native = state.nativeJsonl.get(`current`) as
      | NativeJsonlRow
      | undefined
    expect(native?.nativeSessionId).toBe(meta.nativeSessionId)
    expect(native?.content.length).toBeGreaterThan(0)

    const lifecycle = Array.from(
      state.lifecycle.rows.values()
    ) as Array<LifecycleRow>
    const converted = lifecycle.find((l) => l.event === `kind.converted`)
    expect(converted).toBeDefined()
    expect(converted?.detail).toContain(`claude`)
    expect(converted?.detail).toContain(`codex`)
  })

  it(`records model in lifecycle.detail when payload.model is provided`, async () => {
    const agentId = `/test/coding-agent/cv-2-${Date.now().toString(36)}`
    const { ctx, state } = makeFakeCtx(agentId, {
      kind: `claude`,
      target: `sandbox`,
      workspaceType: `volume`,
    })
    await handler(ctx, { type: `message_received` })

    pushInbox(state, `i1`, `convert-kind`, {
      kind: `codex`,
      model: `gpt-5-codex-latest`,
    })
    await handler(ctx, { type: `message_received` })

    const meta = state.sessionMeta.get(`current`) as SessionMetaRow
    expect(meta.kind).toBe(`codex`)
    // Model is recorded in the lifecycle row's detail string only;
    // SessionMetaRow has no `model` field (validator audit confirmed).
    const lifecycle = Array.from(
      state.lifecycle.rows.values()
    ) as Array<LifecycleRow>
    const converted = lifecycle.find((l) => l.event === `kind.converted`)
    expect(converted?.detail).toContain(`gpt-5-codex-latest`)
  })
})

describe(`processConvertKind — edge cases`, () => {
  let handler: ReturnType<typeof makeHandler>
  beforeEach(() => {
    handler = makeHandler()
  })

  it(`same-kind convert regenerates sessionId and nativeJsonl`, async () => {
    const agentId = `/test/coding-agent/cv-same-${Date.now().toString(36)}`
    const { ctx, state } = makeFakeCtx(agentId, {
      kind: `claude`,
      target: `sandbox`,
      workspaceType: `volume`,
    })
    await handler(ctx, { type: `message_received` })

    state.sessionMeta.rows.set(`current`, {
      ...(state.sessionMeta.get(`current`) as SessionMetaRow),
      kind: `claude`,
      nativeSessionId: `old-id-keep-different`,
    })

    pushInbox(state, `i1`, `convert-kind`, { kind: `claude` })
    await handler(ctx, { type: `message_received` })

    const meta = state.sessionMeta.get(`current`) as SessionMetaRow
    expect(meta.kind).toBe(`claude`)
    expect(meta.nativeSessionId).not.toBe(`old-id-keep-different`)
  })

  it(`empty events → conversion succeeds with empty nativeJsonl`, async () => {
    const agentId = `/test/coding-agent/cv-empty-${Date.now().toString(36)}`
    const { ctx, state } = makeFakeCtx(agentId, {
      kind: `claude`,
      target: `sandbox`,
      workspaceType: `volume`,
    })
    await handler(ctx, { type: `message_received` })

    pushInbox(state, `i1`, `convert-kind`, { kind: `codex` })
    await handler(ctx, { type: `message_received` })

    const meta = state.sessionMeta.get(`current`) as SessionMetaRow
    expect(meta.kind).toBe(`codex`)
    const native = state.nativeJsonl.get(`current`)
    expect(native?.content).toBe(``)
    const lifecycle = Array.from(
      state.lifecycle.rows.values()
    ) as Array<LifecycleRow>
    expect(lifecycle.find((l) => l.event === `kind.converted`)).toBeDefined()
  })

  it(`unknown kind in payload → safeParse fails, no state change`, async () => {
    const agentId = `/test/coding-agent/cv-unknown-${Date.now().toString(36)}`
    const { ctx, state } = makeFakeCtx(agentId, {
      kind: `claude`,
      target: `sandbox`,
      workspaceType: `volume`,
    })
    await handler(ctx, { type: `message_received` })
    const before = (state.sessionMeta.get(`current`) as SessionMetaRow).kind

    pushInbox(state, `i1`, `convert-kind`, { kind: `gemini` })
    await handler(ctx, { type: `message_received` })

    const meta = state.sessionMeta.get(`current`) as SessionMetaRow
    expect(meta.kind).toBe(before)
    const lifecycle = Array.from(
      state.lifecycle.rows.values()
    ) as Array<LifecycleRow>
    expect(lifecycle.find((l) => l.event === `kind.converted`)).toBeUndefined()
  })

  it(`convertKind queued behind a prompt processes after the turn finishes`, async () => {
    // The inbox is naturally serial. Push prompt + convertKind in the
    // same wake; both process in order.
    const agentId = `/test/coding-agent/cv-q-${Date.now().toString(36)}`
    const { ctx, state } = makeFakeCtx(agentId, {
      kind: `claude`,
      target: `sandbox`,
      workspaceType: `volume`,
    })
    await handler(ctx, { type: `message_received` })

    pushInbox(state, `i1`, `prompt`, { text: `hi` })
    pushInbox(state, `i2`, `convert-kind`, { kind: `codex` })
    await handler(ctx, { type: `message_received` })

    const meta = state.sessionMeta.get(`current`) as SessionMetaRow
    expect(meta.kind).toBe(`codex`)
  })
})
