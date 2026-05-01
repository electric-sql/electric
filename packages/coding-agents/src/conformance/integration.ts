import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import type {
  Bridge,
  CodingAgentKind,
  SandboxProvider,
  SandboxSpec,
} from '../types'
import { LifecycleManager } from '../lifecycle-manager'
import { WorkspaceRegistry } from '../workspace-registry'
import { listAdapters } from '../agents/registry'
import { makeCodingAgentHandler } from '../entity/handler'
import type { RunRow, SessionMetaRow } from '../entity/collections'
import { makeFakeCtx, pushInbox } from './fake-ctx'

export interface CodingAgentsIntegrationConformanceConfig {
  /** Constructs a fresh provider instance. Called once per test file. */
  createProvider: () => SandboxProvider | Promise<SandboxProvider>
  /** Returns a scratch workspace + cleanup for each test that needs one. */
  scratchWorkspace: () => Promise<{
    spec: SandboxSpec[`workspace`]
    cleanup: () => Promise<void>
  }>
  /** Bridge under test. */
  bridge: () => Bridge
  /** Per-kind env. Returning null skips that kind's blocks. */
  envForKind: (kind: CodingAgentKind) => Record<string, string> | null
  /** Per-kind probe: minimal echo prompt + expected response matcher. */
  probeForKind: (kind: CodingAgentKind) => {
    prompt: string
    expectsResponseMatching: RegExp
    model?: string
  }
  /** target the provider is known to support. */
  target: SandboxSpec[`target`]
  /** Skip the entire suite if this returns truthy. */
  skipIf?: () => boolean
}

export function runCodingAgentsIntegrationConformance(
  name: string,
  config: CodingAgentsIntegrationConformanceConfig
): void {
  const should = !config.skipIf?.()
  const d = should ? describe : describe.skip
  d(`Coding-agents integration conformance — ${name}`, () => {
    let provider!: SandboxProvider
    let bridge!: Bridge
    const pendingCleanups: Array<() => Promise<void>> = []

    beforeAll(async () => {
      provider = await config.createProvider()
      bridge = config.bridge()
    })

    afterEach(async () => {
      for (const c of pendingCleanups.splice(0)) {
        await c().catch(() => undefined)
      }
    })

    function buildArgs(
      kind: CodingAgentKind,
      ws: SandboxSpec[`workspace`]
    ): Record<string, unknown> {
      const args: Record<string, unknown> = {
        kind,
        target: config.target,
      }
      if (ws.type === `volume`) {
        args.workspaceType = `volume`
        if (ws.name !== undefined) args.workspaceName = ws.name
      } else {
        args.workspaceType = `bindMount`
        args.workspaceHostPath = ws.hostPath
      }
      return args
    }

    for (const adapter of listAdapters()) {
      const kind = adapter.kind
      const kindEnv = config.envForKind(kind)
      const dKind = kindEnv ? describe : describe.skip
      dKind(`lifecycle — ${kind}`, () => {
        let lm!: LifecycleManager
        let wr!: WorkspaceRegistry
        let handler!: ReturnType<typeof makeCodingAgentHandler>
        const probe = config.probeForKind(kind)

        beforeAll(() => {
          wr = new WorkspaceRegistry()
          lm = new LifecycleManager({
            providers: { sandbox: provider, host: provider },
            bridge,
          })
          handler = makeCodingAgentHandler(lm, wr, {
            defaults: {
              idleTimeoutMs: 5_000,
              coldBootBudgetMs: 60_000,
              runTimeoutMs: 120_000,
            },
            env: () => kindEnv!,
          })
        })

        it(`L2.1 cold-boot + first prompt completes`, async () => {
          const { spec: ws, cleanup } = await config.scratchWorkspace()
          pendingCleanups.push(cleanup)
          const agentId = `/test/coding-agent/${kind}-l2-1-${Date.now().toString(36)}`
          const { ctx, state } = makeFakeCtx(agentId, buildArgs(kind, ws))

          // First-wake init.
          await handler(ctx, { type: `message_received` })
          // Send first prompt.
          pushInbox(state, `i1`, `prompt`, { text: probe.prompt })
          await handler(ctx, { type: `message_received` })

          const meta = state.sessionMeta.get(`current`) as SessionMetaRow
          expect(meta.status).toBe(`idle`)
          const runs = Array.from(state.runs.rows.values()) as Array<RunRow>
          expect(runs).toHaveLength(1)
          expect(runs[0]!.status).toBe(`completed`)
          expect(runs[0]!.responseText ?? ``).toMatch(
            probe.expectsResponseMatching
          )

          await provider.destroy(agentId).catch(() => undefined)
        }, 180_000)

        it(`L2.2 warm second prompt reuses sandbox`, async () => {
          const { spec: ws, cleanup } = await config.scratchWorkspace()
          pendingCleanups.push(cleanup)
          const agentId = `/test/coding-agent/${kind}-l2-2-${Date.now().toString(36)}`
          const { ctx, state } = makeFakeCtx(agentId, buildArgs(kind, ws))
          await handler(ctx, { type: `message_received` })
          pushInbox(state, `i1`, `prompt`, { text: probe.prompt })
          await handler(ctx, { type: `message_received` })
          const firstInstanceId = (
            state.sessionMeta.get(`current`) as SessionMetaRow
          ).instanceId

          // Clear lifecycle rows so we can detect new sandbox.starting/started.
          state.lifecycle.rows.clear()

          pushInbox(state, `i2`, `prompt`, { text: probe.prompt })
          await handler(ctx, { type: `message_received` })

          const meta = state.sessionMeta.get(`current`) as SessionMetaRow
          expect(meta.status).toBe(`idle`)
          // Same sandbox reused.
          expect(meta.instanceId).toBe(firstInstanceId)

          const lcEvents = Array.from(state.lifecycle.rows.values()).map(
            (l: any) => l.event
          )
          expect(lcEvents).not.toContain(`sandbox.starting`)
          expect(lcEvents).not.toContain(`sandbox.started`)

          await provider.destroy(agentId).catch(() => undefined)
        }, 180_000)

        it(`L2.3 resume after stop cold-boots and continues conversation`, async () => {
          const { spec: ws, cleanup } = await config.scratchWorkspace()
          pendingCleanups.push(cleanup)
          const agentId = `/test/coding-agent/${kind}-l2-3-${Date.now().toString(36)}`
          const { ctx, state } = makeFakeCtx(agentId, buildArgs(kind, ws))

          await handler(ctx, { type: `message_received` })
          pushInbox(state, `i1`, `prompt`, { text: probe.prompt })
          await handler(ctx, { type: `message_received` })

          // Stop.
          pushInbox(state, `i2`, `stop`)
          await handler(ctx, { type: `message_received` })
          const cold = state.sessionMeta.get(`current`) as SessionMetaRow
          expect(cold.status).toBe(`cold`)
          expect(cold.instanceId).toBeUndefined()

          // Second prompt cold-boots fresh sandbox.
          pushInbox(state, `i3`, `prompt`, { text: probe.prompt })
          await handler(ctx, { type: `message_received` })
          const meta = state.sessionMeta.get(`current`) as SessionMetaRow
          expect(meta.status).toBe(`idle`)
          const runs = Array.from(state.runs.rows.values()) as Array<RunRow>
          expect(runs).toHaveLength(2)
          expect(runs[runs.length - 1]!.status).toBe(`completed`)

          await provider.destroy(agentId).catch(() => undefined)
        }, 180_000)
      })
    }
  })
}
