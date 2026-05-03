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
  /**
   * If false, skips scenarios that require workspace persistence
   * across `destroy` (L2.5) and shared-workspace lease semantics
   * (L2.6). Default `true`. Set to `false` for providers like
   * sprites where the sandbox IS the workspace (each agentId gets
   * its own sprite, FS gone on destroy, can't share).
   */
  supportsSharedWorkspace?: boolean
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
            providers: {
              sandbox: provider,
              host: provider,
              ...(config.target === `sprites` ? { sprites: provider } : {}),
            },
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

        it(`L2.4 reconcile transitions stale running run to failed:orphaned`, async () => {
          const { spec: ws, cleanup } = await config.scratchWorkspace()
          pendingCleanups.push(cleanup)
          const agentId = `/test/coding-agent/${kind}-l2-4-${Date.now().toString(36)}`
          const { ctx, state } = makeFakeCtx(agentId, buildArgs(kind, ws))
          await handler(ctx, { type: `message_received` })

          // Inject a stale run row predating lm.startedAtMs.
          const staleStartedAt = lm.startedAtMs - 10_000
          state.runs.rows.set(`stale`, {
            key: `stale`,
            startedAt: staleStartedAt,
            status: `running`,
            promptInboxKey: `fake`,
          } as RunRow)
          state.sessionMeta.rows.set(`current`, {
            ...(state.sessionMeta.get(`current`) as SessionMetaRow),
            status: `running`,
          })

          // Send a real prompt; reconcile-on-entry should orphan the stale run.
          pushInbox(state, `i1`, `prompt`, { text: probe.prompt })
          await handler(ctx, { type: `message_received` })

          const stale = state.runs.get(`stale`) as RunRow
          expect(stale.status).toBe(`failed`)
          expect(stale.finishReason).toBe(`orphaned`)
          // Plus a real run completed.
          const completed = (
            Array.from(state.runs.rows.values()) as Array<RunRow>
          ).filter((r) => r.status === `completed`)
          expect(completed.length).toBeGreaterThan(0)

          await provider.destroy(agentId).catch(() => undefined)
        }, 180_000)

        const sharedIt = config.supportsSharedWorkspace === false ? it.skip : it
        sharedIt(
          `L2.5 workspace persists across teardown`,
          async () => {
            const { spec: ws, cleanup } = await config.scratchWorkspace()
            pendingCleanups.push(cleanup)

            // Spawn first agent on workspace; run a turn so the sandbox is up.
            const agentIdA = `/test/coding-agent/${kind}-l2-5a-${Date.now().toString(36)}`
            const argsBoth = buildArgs(kind, ws)
            const { ctx: ctxA, state: stateA } = makeFakeCtx(agentIdA, argsBoth)
            await handler(ctxA, { type: `message_received` })
            pushInbox(stateA, `i1`, `prompt`, { text: probe.prompt })
            await handler(ctxA, { type: `message_received` })

            // Use provider.start (idempotent — returns the running instance) to
            // get an instance handle so we can copyTo a sentinel file. The
            // workspace path of this provider may differ from previous agents
            // for the same workspaceIdentity; copyTo writes into the workspace
            // mount.
            const instA = await provider.start({
              agentId: agentIdA,
              kind,
              target: config.target,
              workspace: ws,
              env: kindEnv!,
            })
            const sentinelPath = `${instA.workspaceMount}/sentinel.txt`
            await instA.copyTo({
              destPath: sentinelPath,
              content: `persisted`,
              mode: 0o644,
            })

            // Destroy first agent.
            pushInbox(stateA, `i2`, `destroy`)
            await handler(ctxA, { type: `message_received` })

            // Spawn second agent on SAME workspace.
            const agentIdB = `/test/coding-agent/${kind}-l2-5b-${Date.now().toString(36)}`
            const { ctx: ctxB } = makeFakeCtx(agentIdB, argsBoth)
            await handler(ctxB, { type: `message_received` })
            const instB = await provider.start({
              agentId: agentIdB,
              kind,
              target: config.target,
              workspace: ws,
              env: kindEnv!,
            })

            const h = await instB.exec({
              cmd: [`cat`, `${instB.workspaceMount}/sentinel.txt`],
            })
            // Drain stdout/stderr in parallel with wait(): some providers
            // (e.g. docker exec) don't reliably end the host-side stderr
            // readline iterator until both pipes have been drained, so a
            // sequential `for await stderr` after the inner process exits
            // can hang indefinitely.
            const drain = async (s: AsyncIterable<string>): Promise<string> => {
              let acc = ``
              for await (const line of s) acc += line + `\n`
              return acc
            }
            const discard = async (s: AsyncIterable<string>): Promise<void> => {
              for await (const _ of s) {
                /* discard */
              }
            }
            const [out, , exit] = await Promise.all([
              drain(h.stdout),
              discard(h.stderr),
              h.wait(),
            ])
            expect(exit.exitCode).toBe(0)
            expect(out.trim()).toBe(`persisted`)

            await provider.destroy(agentIdB).catch(() => undefined)
          },
          240_000
        )

        sharedIt(
          `L2.6 shared-workspace lease serialises concurrent runs`,
          async () => {
            const { spec: ws, cleanup } = await config.scratchWorkspace()
            pendingCleanups.push(cleanup)

            const agentIdA = `/test/coding-agent/${kind}-l2-6a-${Date.now().toString(36)}`
            const agentIdB = `/test/coding-agent/${kind}-l2-6b-${Date.now().toString(36)}`
            const args = buildArgs(kind, ws)
            const { ctx: ctxA, state: stateA } = makeFakeCtx(agentIdA, args)
            const { ctx: ctxB, state: stateB } = makeFakeCtx(agentIdB, args)

            // First-wake init for both.
            await handler(ctxA, { type: `message_received` })
            await handler(ctxB, { type: `message_received` })

            pushInbox(stateA, `i1`, `prompt`, { text: probe.prompt })
            pushInbox(stateB, `j1`, `prompt`, { text: probe.prompt })

            // Concurrently process both. The lease serialises through the
            // workspace registry — only one runs at a time.
            await Promise.all([
              handler(ctxA, { type: `message_received` }),
              handler(ctxB, { type: `message_received` }),
            ])

            const runA = (
              Array.from(stateA.runs.rows.values()) as Array<RunRow>
            )[0]!
            const runB = (
              Array.from(stateB.runs.rows.values()) as Array<RunRow>
            )[0]!
            expect(runA.status).toBe(`completed`)
            expect(runB.status).toBe(`completed`)
            // Non-overlap: A.endedAt <= B.startedAt OR B.endedAt <= A.startedAt
            const noOverlap =
              (runA.endedAt ?? 0) <= runB.startedAt ||
              (runB.endedAt ?? 0) <= runA.startedAt
            expect(noOverlap).toBe(true)

            await provider.destroy(agentIdA).catch(() => undefined)
            await provider.destroy(agentIdB).catch(() => undefined)
          },
          360_000
        )

        it(`L2.7 convert mid-conversation switches kind`, async () => {
          const { spec: ws, cleanup } = await config.scratchWorkspace()
          pendingCleanups.push(cleanup)
          const agentId = `/test/coding-agent/${kind}-l2-7-${Date.now().toString(36)}`
          const { ctx, state } = makeFakeCtx(agentId, buildArgs(kind, ws))

          await handler(ctx, { type: `message_received` })
          pushInbox(state, `i1`, `prompt`, { text: probe.prompt })
          await handler(ctx, { type: `message_received` })

          const beforeKind = (
            state.sessionMeta.get(`current`) as SessionMetaRow
          ).kind
          // Pick the *other* kind for the conversion target.
          const otherKind: CodingAgentKind =
            beforeKind === `claude` ? `codex` : `claude`

          pushInbox(state, `i2`, `convert-kind`, { kind: otherKind })
          await handler(ctx, { type: `message_received` })

          const afterMeta = state.sessionMeta.get(`current`) as SessionMetaRow
          expect(afterMeta.kind).toBe(otherKind)
          expect(afterMeta.nativeSessionId).toBeDefined()
          const lifecycle = Array.from(state.lifecycle.rows.values()).map(
            (l: any) => l.event
          )
          expect(lifecycle).toContain(`kind.converted`)

          await provider.destroy(agentId).catch(() => undefined)
        }, 180_000)

        it(`L2.8 fork into sibling inherits source events`, async () => {
          const { spec: ws, cleanup } = await config.scratchWorkspace()
          pendingCleanups.push(cleanup)
          // Source agent: prompt once so events accumulate.
          const sourceId = `/test/coding-agent/${kind}-l2-8s-${Date.now().toString(36)}`
          const { ctx: sourceCtx, state: sourceState } = makeFakeCtx(
            sourceId,
            buildArgs(kind, ws)
          )
          await handler(sourceCtx, { type: `message_received` })
          pushInbox(sourceState, `i1`, `prompt`, { text: probe.prompt })
          await handler(sourceCtx, { type: `message_received` })

          expect(sourceState.events.rows.size).toBeGreaterThan(0)

          // Fork into other kind. Stub observe() to point at sourceState.
          const otherKind: CodingAgentKind =
            kind === `claude` ? `codex` : `claude`
          const forkId = `/test/coding-agent/${otherKind}-l2-8f-${Date.now().toString(36)}`
          const forkArgs = {
            ...buildArgs(otherKind, ws),
            fromAgentId: sourceId,
            fromWorkspaceMode: `share`,
          }
          const { ctx: forkCtx, state: forkState } = makeFakeCtx(
            forkId,
            forkArgs
          )
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

          const native = forkState.nativeJsonl.get(`current`)
          expect(native?.content?.length).toBeGreaterThan(0)
          const lifecycle = Array.from(forkState.lifecycle.rows.values()).map(
            (l: any) => l.event
          )
          expect(lifecycle).toContain(`kind.forked`)

          await provider.destroy(sourceId).catch(() => undefined)
          await provider.destroy(forkId).catch(() => undefined)
        }, 180_000)
      })
    }
  })
}
