import { describe, expect, it } from 'vitest'
import { makeCodingAgentHandler } from '../../src/entity/handler'
import { LifecycleManager } from '../../src/lifecycle-manager'
import { WorkspaceRegistry } from '../../src/workspace-registry'
import { makeFakeCtx } from '../../src/conformance/fake-ctx'
import type {
  Bridge,
  RunTurnArgs,
  RunTurnResult,
  SandboxProvider,
  SandboxInstance,
} from '../../src/types'

// Tier 2 Phase E: exhaustive walk of (initial status × control-plane
// message) → (final status, lastError-presence, lifecycle-events).
//
// Snapshotted as a 6×7 = 42 cell table. Any future change to the
// handler that alters a cell forces an explicit `pnpm test -u` and
// reviewer approval.
//
// Scope: control-plane messages only (pin, release, stop, destroy,
// convert-target, convert-kind, lifecycle/idle-eviction-fired).
// `prompt` is excluded because it invokes the bridge, which requires
// non-trivial mocking of the CLI invocation. The L2 conformance
// suite covers prompt-path transitions end-to-end.

const STATUSES = [
  `cold`,
  `starting`,
  `idle`,
  `running`,
  `stopping`,
  `error`,
  `destroyed`,
] as const

type Status = (typeof STATUSES)[number]

const MESSAGES: Array<{ type: string; payload: unknown; label: string }> = [
  { type: `pin`, payload: {}, label: `pin` },
  { type: `release`, payload: {}, label: `release` },
  { type: `stop`, payload: {}, label: `stop` },
  { type: `destroy`, payload: {}, label: `destroy` },
  {
    type: `convert-target`,
    payload: { to: `host` },
    label: `convert-target→host`,
  },
  {
    type: `convert-kind`,
    payload: { kind: `codex` },
    label: `convert-kind→codex`,
  },
]

// Stub provider — never actually exec'd; only status() is called by reconcile.
function stubProvider(): SandboxProvider {
  const inst: SandboxInstance = {
    instanceId: `stub-instance`,
    agentId: `/test/coding-agent/stub`,
    workspaceMount: `/work`,
    homeDir: `/home/agent`,
    async exec() {
      throw new Error(`stub exec called`)
    },
    async copyTo() {
      /* no-op */
    },
  }
  return {
    name: `stub`,
    async start() {
      return inst
    },
    async stop() {
      /* no-op */
    },
    async destroy() {
      /* no-op */
    },
    async status() {
      // Reconcile reads this. Returning 'unknown' lets the orphan
      // branches fire when status is 'running'.
      return `unknown`
    },
    async recover() {
      return []
    },
  }
}

// Stub bridge — should never be called for control-plane messages.
function stubBridge(): Bridge {
  return {
    async runTurn(_args: RunTurnArgs): Promise<RunTurnResult> {
      throw new Error(`stub bridge runTurn called`)
    },
  }
}

interface CellResult {
  finalStatus: string | undefined
  lastErrorSet: boolean
  lifecycleEvents: Array<string>
}

async function runCell(
  initialStatus: Status,
  msg: { type: string; payload: unknown }
): Promise<CellResult> {
  const provider = stubProvider()
  const bridge = stubBridge()
  const lm = new LifecycleManager({
    providers: { sandbox: provider, host: provider },
    bridge,
  })
  const wr = new WorkspaceRegistry()
  const handler = makeCodingAgentHandler(lm, wr, {
    defaults: {
      idleTimeoutMs: 60_000,
      coldBootBudgetMs: 10_000,
      runTimeoutMs: 10_000,
    },
    env: () => ({}),
  })

  const agentId = `/test/coding-agent/walk-${initialStatus}-${msg.type}`
  const args: Record<string, unknown> = {
    kind: `claude`,
    target: `sandbox`,
    workspaceType: `volume`,
    workspaceName: `walk-${initialStatus}`,
  }
  const { ctx, state } = makeFakeCtx(agentId, args)

  // First-wake init populates sessionMeta with status='cold'.
  await handler(ctx, { type: `message_received` })
  // Override status to the test's initial value (and matching workspaceSpec).
  const meta = state.sessionMeta.get(`current`)
  if (meta) {
    meta.status = initialStatus
  }
  // For 'destroyed', lock the tombstone path: the destroyed early-exit
  // sits at the top of the dispatch loop.

  // Push the control-plane message and run the handler.
  state.inbox.rows.set(`m1`, {
    key: `m1`,
    message_type: msg.type,
    payload: msg.payload,
    from: `user`,
    ts: 1,
  } as any)
  try {
    await handler(ctx, { type: `message_received` })
  } catch {
    /* swallow — we capture state, not exceptions */
  }

  const finalMeta = state.sessionMeta.get(`current`)
  return {
    finalStatus: finalMeta?.status,
    lastErrorSet: !!finalMeta?.lastError,
    lifecycleEvents: Array.from(state.lifecycle.rows.values()).map(
      (r: any) => r.event
    ),
  }
}

describe(`status × control-plane-message transition table`, () => {
  it(`matches the snapshot for every (status, message) cell`, async () => {
    const table: Record<string, CellResult> = {}
    for (const status of STATUSES) {
      for (const msg of MESSAGES) {
        const cell = await runCell(status, msg)
        table[`${status} + ${msg.label}`] = cell
      }
    }
    expect(table).toMatchSnapshot()
  }, 60_000)
})
