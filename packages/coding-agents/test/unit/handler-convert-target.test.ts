import { describe, expect, it } from 'vitest'
import { LifecycleManager } from '../../src/lifecycle-manager'
import { WorkspaceRegistry } from '../../src/workspace-registry'
import { makeCodingAgentHandler } from '../../src/entity/handler'
import { makeFakeCtx, pushInbox } from '../../src/conformance/fake-ctx'
import type { SessionMetaRow, LifecycleRow } from '../../src/entity/collections'

const fakeProvider = {
  name: `fake`,
  start: async () => ({}) as any,
  stop: async () => undefined,
  destroy: async () => undefined,
  status: async () => `stopped` as const,
  recover: async () => [],
}
const fakeBridge = { runTurn: async () => ({ exitCode: 0 }) }

function makeHandler() {
  const wr = new WorkspaceRegistry()
  const lm = new LifecycleManager({
    providers: {
      sandbox: fakeProvider as any,
      host: fakeProvider as any,
      sprites: fakeProvider as any,
    },
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

describe(`processConvertTarget — sprites cross-provider gates`, () => {
  it(`rejects sandbox → sprites`, async () => {
    const handler = makeHandler()
    const agentId = `/test/coding-agent/cv-sb-sprites-${Date.now().toString(36)}`
    const { ctx, state } = makeFakeCtx(agentId, {
      kind: `claude`,
      target: `sandbox`,
      workspaceType: `volume`,
    })
    await handler(ctx, { type: `message_received` })
    pushInbox(state, `i1`, `convert-target`, { to: `sprites` })
    await handler(ctx, { type: `message_received` })

    const meta = state.sessionMeta.get(`current`) as SessionMetaRow
    // Target stayed at sandbox; lastError set.
    expect(meta.target).toBe(`sandbox`)
    expect(meta.lastError).toMatch(/cross-provider/i)
    const lifecycle = Array.from(
      state.lifecycle.rows.values()
    ) as Array<LifecycleRow>
    const failed = lifecycle.find((l) => l.event === `target.changed`)
    expect(failed?.detail).toMatch(/failed.*cross-provider/i)
  })

  it(`rejects sprites → host`, async () => {
    const handler = makeHandler()
    const agentId = `/test/coding-agent/cv-sprites-host-${Date.now().toString(36)}`
    const { ctx, state } = makeFakeCtx(agentId, {
      kind: `claude`,
      target: `sprites`,
      workspaceType: `volume`,
    })
    await handler(ctx, { type: `message_received` })
    pushInbox(state, `i1`, `convert-target`, { to: `host` })
    await handler(ctx, { type: `message_received` })

    const meta = state.sessionMeta.get(`current`) as SessionMetaRow
    expect(meta.target).toBe(`sprites`)
    expect(meta.lastError).toMatch(/cross-provider/i)
  })

  it(`still allows sandbox ↔ host (existing behavior)`, async () => {
    const handler = makeHandler()
    const agentId = `/test/coding-agent/cv-sb-host-${Date.now().toString(36)}`
    const { ctx, state } = makeFakeCtx(agentId, {
      kind: `claude`,
      target: `sandbox`,
      workspaceType: `bindMount`,
      workspaceHostPath: process.cwd(),
    })
    await handler(ctx, { type: `message_received` })
    pushInbox(state, `i1`, `convert-target`, { to: `host` })
    await handler(ctx, { type: `message_received` })

    const meta = state.sessionMeta.get(`current`) as SessionMetaRow
    expect(meta.target).toBe(`host`)
  })
})
