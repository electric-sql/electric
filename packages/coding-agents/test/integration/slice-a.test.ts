import { describe, it, expect, beforeAll } from 'vitest'
import {
  LocalDockerProvider,
  StdioBridge,
  WorkspaceRegistry,
  LifecycleManager,
} from '../../src'
import { makeCodingAgentHandler } from '../../src/entity/handler'
import { buildTestImage, TEST_IMAGE_TAG } from '../support/build-image'
import { listAdapters } from '../../src'
import { envForKind, loadTestEnv, probeForKind } from '../support/env'
import { makeFakeCtx, pushInbox } from '../../src/conformance/fake-ctx'

const SHOULD_RUN = process.env.DOCKER === `1`
const describeMaybe = SHOULD_RUN ? describe : describe.skip

describeMaybe(`Slice A — full integration`, () => {
  beforeAll(async () => {
    await buildTestImage()
  }, 600_000)

  for (const adapter of listAdapters()) {
    const kind = adapter.kind
    const env = loadTestEnv()
    const kindEnv = envForKind(env, kind)
    const describeKind = kindEnv ? describe : describe.skip

    describeKind(`lifecycle — ${kind}`, () => {
      it(`spawns, runs prompt, lease-serializes, recovers from crash, destroys`, async () => {
        const provider = new LocalDockerProvider({ image: TEST_IMAGE_TAG })
        const bridge = new StdioBridge()
        const wr = new WorkspaceRegistry()
        const lm = new LifecycleManager({
          providers: { sandbox: provider, host: provider },
          bridge,
        })
        const handler = makeCodingAgentHandler(lm, wr, {
          defaults: {
            idleTimeoutMs: 2000,
            coldBootBudgetMs: 60_000,
            runTimeoutMs: 120_000,
          },
          env: (_kind) => kindEnv!,
        })

        const agentA = `/test/coding-agent/${kind}-a-${Date.now().toString(36)}`
        const sharedName = `slice-a-${kind}-shared-${Date.now().toString(36)}`
        const probe = probeForKind(env, kind)
        const args = {
          kind,
          workspaceType: `volume`,
          workspaceName: sharedName,
          idleTimeoutMs: 2000,
        }
        const { ctx: ctxA, state: stateA } = makeFakeCtx(agentA, args)

        // ── Assertion 1: First-wake init ──────────────────────────────────────────
        await handler(ctxA, { type: `message_received` })
        expect(stateA.sessionMeta.get(`current`).status).toBe(`cold`)

        // ── Assertion 2: Send prompt; cold boot + run completes ───────────────────
        pushInbox(stateA, `i1`, `prompt`, {
          text: probe.prompt,
        })
        await handler(ctxA, { type: `message_received` })

        const metaA1 = stateA.sessionMeta.get(`current`)
        expect(metaA1.status).toBe(`idle`)
        const runsA = Array.from(stateA.runs.rows.values()) as any[]
        expect(runsA).toHaveLength(1)
        expect(runsA[0].status).toBe(`completed`)
        expect((runsA[0].responseText?.length ?? 0) > 0).toBe(true)

        // ── Assertion 3: Pin; sleep past idle timeout; container still running ────
        pushInbox(stateA, `i2`, `pin`)
        await handler(ctxA, { type: `message_received` })
        expect(stateA.sessionMeta.get(`current`).pinned).toBe(true)

        await new Promise((r) => setTimeout(r, 3000))
        expect([`running`]).toContain(await provider.status(agentA))

        // ── Assertion 4: Release; sleep past idle; sandbox stops ─────────────────
        pushInbox(stateA, `i3`, `release`)
        await handler(ctxA, { type: `message_received` })
        await new Promise((r) => setTimeout(r, 3000))
        expect([`stopped`, `unknown`]).toContain(await provider.status(agentA))

        // ── Assertion 5: Second prompt triggers cold-boot path ────────────────────
        pushInbox(stateA, `i4`, `prompt`, { text: probe.prompt })
        await handler(ctxA, { type: `message_received` })
        const runsA2 = Array.from(stateA.runs.rows.values()) as any[]
        expect(runsA2.length).toBeGreaterThanOrEqual(2)
        expect(runsA2[runsA2.length - 1].status).toBe(`completed`)

        // ── Assertion 6: Second agent on same workspace, lease-serialized ─────────
        // Wait past the idle timer so A's container is already stopped before
        // we launch the concurrent test. This ensures no in-flight idle-timer
        // kill can interrupt the concurrent run.
        await new Promise((r) => setTimeout(r, 3000))

        const agentB = `/test/coding-agent/${kind}-b-${Date.now().toString(36)}`
        const { ctx: ctxB, state: stateB } = makeFakeCtx(agentB, args)
        // First-wake init for B
        await handler(ctxB, { type: `message_received` })

        pushInbox(stateB, `j1`, `prompt`, { text: probe.prompt })
        pushInbox(stateA, `i5`, `prompt`, { text: probe.prompt })
        await Promise.all([
          handler(ctxA, { type: `message_received` }),
          handler(ctxB, { type: `message_received` }),
        ])

        const runsAFinal = Array.from(stateA.runs.rows.values()) as any[]
        const runsBFinal = Array.from(stateB.runs.rows.values()) as any[]
        expect(runsAFinal[runsAFinal.length - 1].status).toBe(`completed`)
        expect(runsBFinal[0].status).toBe(`completed`)

        // Lease serialization: A's last run and B's first run must not overlap.
        const lastA = runsAFinal[runsAFinal.length - 1]
        const firstB = runsBFinal[0]
        const noOverlap =
          lastA.endedAt <= firstB.startedAt || firstB.endedAt <= lastA.startedAt
        expect(noOverlap).toBe(true)

        // ── Assertion 7: Crash recovery ───────────────────────────────────────────
        // Simulate a "prior LM crash" by creating lm2 (new startedAtMs).
        // Inject a stale 'running' row predating lm2 into stateA.
        const oldRunStart = Date.now() - 60_000
        stateA.runs.rows.set(`stale`, {
          key: `stale`,
          startedAt: oldRunStart,
          status: `running`,
          promptInboxKey: `fake`,
        } as any)
        stateA.sessionMeta.rows.set(`current`, {
          ...stateA.sessionMeta.get(`current`),
          status: `running`,
        })

        // Small delay to ensure lm2.startedAtMs > oldRunStart
        await new Promise((r) => setTimeout(r, 50))

        const lm2 = new LifecycleManager({
          providers: { sandbox: provider, host: provider },
          bridge,
        })
        const handler2 = makeCodingAgentHandler(lm2, wr, {
          defaults: {
            idleTimeoutMs: 2000,
            coldBootBudgetMs: 60_000,
            runTimeoutMs: 120_000,
          },
          env: (_kind) => kindEnv!,
        })

        pushInbox(stateA, `i6`, `prompt`, { text: probe.prompt })
        await handler2(ctxA, { type: `message_received` })

        // Stale run must be reconciled to orphaned
        expect((stateA.runs.get(`stale`) as any).status).toBe(`failed`)
        expect((stateA.runs.get(`stale`) as any).finishReason).toBe(`orphaned`)
        // A new run must have completed
        const newRuns = (Array.from(stateA.runs.rows.values()) as any[]).filter(
          (r) => r.status === `completed` && r.key !== `stale`
        )
        expect(newRuns.length).toBeGreaterThan(0)

        // ── Assertion 8: Destroy ──────────────────────────────────────────────────
        pushInbox(stateA, `i7`, `destroy`)
        await handler2(ctxA, { type: `message_received` })
        expect(stateA.sessionMeta.get(`current`).status).toBe(`destroyed`)
        expect([`stopped`, `unknown`]).toContain(await provider.status(agentA))

        // Cleanup B
        await provider.destroy(agentB).catch(() => undefined)
      }, 360_000)
    })
  }
})
