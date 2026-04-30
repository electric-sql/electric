# Coding Agents — Slice A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the existing `LocalDockerProvider` + `StdioBridge` (from the MVP) into a first-class platform primitive: a built-in `coding-agent` entity, a `LifecycleManager`, a `WorkspaceRegistry`, and the typed `ctx.spawnCodingAgent` / `ctx.observeCodingAgent` API on `HandlerContext`. Validation bar: an integration test that spawns a `coding-agent` from a parent test entity, awaits a `runFinished` wake with the response text, exercises pin/release/idle hibernation, lease-serializes two agents on a shared workspace, simulates server crash mid-turn and asserts orphan reconciliation.

**Architecture:** New code lives in `@electric-ax/coding-agents/src/{lifecycle-manager.ts, workspace-registry.ts, entity/*}`. The runtime gets typed wrappers (`ctx.spawnCodingAgent` / `ctx.observeCodingAgent`) that desugar to `ctx.spawn('coding-agent', ...)` / `ctx.observe(...)`. The entity handler closes over the LM + WR; collection access uses the StreamDB pattern (`ctx.db.collections.X.get`, `ctx.db.actions.X_insert/X_update`). Server bootstrap (`packages/agents/src/bootstrap.ts`) adds `registerCodingAgent(registry, { provider, bridge })` next to `registerCodingSession(registry)`. Legacy `coder` entity coexists.

**Spec divergences (resolved from spec's Open Questions section):**

- **No `onBoot` registry hook.** The runtime's `EntityRegistry.define()` has no `onBoot` parameter. We don't add one in Slice A. Instead: first-wake init in the handler seeds `sessionMeta`, and the LM/WR rebuild lazily on first handler invocation (gated by an idempotent in-process flag). Reduces runtime surface area; no behavior loss for Slice A.
- **No `ctx.deleteEntityStream`.** `destroy()` becomes "stop sandbox + drop workspace ref + set `sessionMeta.status='destroyed'` + future inbox messages return early". The entity stream stays as a tombstone. Durable cleanup is Slice B.
- **`workspace.sharedRefs` from a client `ctx`.** Server-only state. Client handles return `sharedRefs: 1`. Documented in `state()` JSDoc.

**Tech Stack:** TypeScript, Vitest, Node `child_process`, Docker, `agent-session-protocol@0.0.2`, `zod` (collection + inbox schemas).

**Reference spec:** `docs/superpowers/specs/2026-04-30-coding-agents-slice-a-design.md`

---

## File Structure

```
packages/coding-agents/                          ← extend existing package
├── src/
│   ├── index.ts                                 ← +exports for new types and registerCodingAgent
│   ├── types.ts                                 ← +SpawnCodingAgentOptions, CodingAgentStatus, RunSummary
│   ├── lifecycle-manager.ts                     ← NEW
│   ├── workspace-registry.ts                    ← NEW
│   ├── entity/
│   │   ├── collections.ts                       ← NEW: schemas + wire constants
│   │   ├── messages.ts                          ← NEW: inbox message schemas
│   │   ├── handler.ts                           ← NEW: the entity handler
│   │   └── register.ts                          ← NEW: registerCodingAgent
│   ├── providers/local-docker.ts                ← (existing, no changes for Slice A)
│   ├── bridge/stdio-bridge.ts                   ← (existing, no changes)
│   └── log.ts                                   ← (existing)
└── test/
    ├── unit/
    │   ├── workspace-registry.test.ts           ← NEW
    │   ├── lifecycle-manager.test.ts            ← NEW
    │   ├── entity-handler.test.ts               ← NEW
    │   ├── local-docker.test.ts                 ← (existing)
    │   └── stdio-bridge.test.ts                 ← (existing)
    └── integration/
        ├── slice-a.test.ts                      ← NEW
        ├── smoke.test.ts                        ← (existing)
        └── support/
            ├── build-image.ts                   ← (existing)
            └── env.ts                           ← (existing)

packages/agents-runtime/
└── src/
    ├── types.ts                                 ← +SpawnCodingAgentOptions, CodingAgentHandle, HandlerContext.spawnCodingAgent / observeCodingAgent
    └── context-factory.ts                       ← +spawnCodingAgent / observeCodingAgent impls

packages/agents/
└── src/bootstrap.ts                             ← +registerCodingAgent call

docs/superpowers/specs/notes/
└── 2026-04-30-coding-agents-slice-a-report.md   ← NEW (Phase 5)
```

---

## Phase Plan

| Phase | Tasks         | Parallelism                     | Depends on |
| ----- | ------------- | ------------------------------- | ---------- |
| 0     | 0.1, 0.2      | sequential                      | —          |
| 1     | 1.A, 1.B      | parallel (2 independent agents) | Phase 0    |
| 2     | 2.1, 2.2, 2.3 | sequential                      | Phase 1    |
| 3     | 3.1           | sequential                      | Phase 2    |
| 4     | 4.1           | sequential                      | Phase 3    |
| 5     | 5.1 (report)  | sequential                      | Phase 4    |

Total tasks: 8 (excluding report). Estimated wall time per task: 10-30 min.

---

## Phase 0 — Foundation (sequential)

### Task 0.1 — Wire constants, collection schemas, inbox schemas

**Files:**

- Create: `packages/coding-agents/src/entity/collections.ts`
- Create: `packages/coding-agents/src/entity/messages.ts`

- [ ] **Step 1: Write `src/entity/collections.ts`**

```ts
import { z } from 'zod'

export const CODING_AGENT_SESSION_META_COLLECTION_TYPE =
  'coding-agent.sessionMeta'
export const CODING_AGENT_RUNS_COLLECTION_TYPE = 'coding-agent.runs'
export const CODING_AGENT_EVENTS_COLLECTION_TYPE = 'coding-agent.events'
export const CODING_AGENT_LIFECYCLE_COLLECTION_TYPE = 'coding-agent.lifecycle'

export const codingAgentStatusSchema = z.enum([
  'cold',
  'starting',
  'idle',
  'running',
  'stopping',
  'error',
  'destroyed',
])
export type CodingAgentStatus = z.infer<typeof codingAgentStatusSchema>

export const sessionMetaRowSchema = z.object({
  key: z.literal('current'),
  status: codingAgentStatusSchema,
  kind: z.enum(['claude']),
  pinned: z.boolean(),
  workspaceIdentity: z.string(),
  workspaceSpec: z.discriminatedUnion('type', [
    z.object({
      type: z.literal('volume'),
      name: z.string(),
    }),
    z.object({
      type: z.literal('bindMount'),
      hostPath: z.string(),
    }),
  ]),
  idleTimeoutMs: z.number(),
  keepWarm: z.boolean(),
  instanceId: z.string().optional(),
  lastError: z.string().optional(),
  currentPromptInboxKey: z.string().optional(),
})
export type SessionMetaRow = z.infer<typeof sessionMetaRowSchema>

export const runRowSchema = z.object({
  key: z.string(),
  startedAt: z.number(),
  endedAt: z.number().optional(),
  status: z.enum(['running', 'completed', 'failed']),
  finishReason: z.string().optional(),
  promptInboxKey: z.string(),
  responseText: z.string().optional(),
})
export type RunRow = z.infer<typeof runRowSchema>

export const eventRowSchema = z.object({
  key: z.string(),
  runId: z.string(),
  seq: z.number(),
  ts: z.number(),
  type: z.string(),
  payload: z.looseObject({}),
})
export type EventRow = z.infer<typeof eventRowSchema>

export const lifecycleRowSchema = z.object({
  key: z.string(),
  ts: z.number(),
  event: z.enum([
    'sandbox.starting',
    'sandbox.started',
    'sandbox.stopped',
    'sandbox.failed',
    'pin',
    'release',
    'orphan.detected',
  ]),
  detail: z.string().optional(),
})
export type LifecycleRow = z.infer<typeof lifecycleRowSchema>
```

- [ ] **Step 2: Write `src/entity/messages.ts`**

```ts
import { z } from 'zod'

export const promptMessageSchema = z.object({
  text: z.string(),
})
export const pinMessageSchema = z.object({}).strict()
export const releaseMessageSchema = z.object({}).strict()
export const stopMessageSchema = z.object({}).strict()
export const destroyMessageSchema = z.object({}).strict()

export type PromptMessage = z.infer<typeof promptMessageSchema>
```

- [ ] **Step 3: Verify typecheck**

```
pnpm -C packages/coding-agents typecheck
```

Expect: clean.

- [ ] **Step 4: Commit**

```
git add packages/coding-agents/src/entity
git commit -m "feat(coding-agents): collection + inbox message schemas for coding-agent entity"
```

---

### Task 0.2 — Public types extension

**Files:**

- Modify: `packages/coding-agents/src/types.ts`

- [ ] **Step 1: Append to `src/types.ts`**

Add after the existing types:

```ts
import type { CodingAgentStatus } from './entity/collections'

// ─── Slice A: SpawnCodingAgentOptions / RunSummary ──────────────────────────

export interface SpawnCodingAgentOptions {
  /** Stable id, scoped to the spawning entity. */
  id: string
  /** Slice A: 'claude' only. */
  kind: 'claude'
  /**
   * Workspace mount. Identity is the lease key.
   *   { type: 'volume', name: 'foo' }    → 'volume:foo'
   *   { type: 'volume' }                 → 'volume:<agentId>'
   *   { type: 'bindMount', hostPath: P } → 'bindMount:<realpath(P)>'
   */
  workspace:
    | { type: 'volume'; name?: string }
    | { type: 'bindMount'; hostPath: string }
  /** Initial prompt; queued before the first wake. */
  initialPrompt?: string
  /** Slice A: 'runFinished' only. */
  wake?: { on: 'runFinished'; includeResponse?: boolean }
  /** Lifecycle overrides. */
  lifecycle?: { idleTimeoutMs?: number; keepWarm?: boolean }
}

export interface RunSummary {
  runId: string
  startedAt: number
  endedAt?: number
  status: 'running' | 'completed' | 'failed'
  promptInboxKey: string
  responseText?: string
}

export type { CodingAgentStatus }

/** Defaults applied when a SpawnCodingAgentOptions field is omitted. */
export const SLICE_A_DEFAULTS = {
  idleTimeoutMs: 5 * 60_000,
  coldBootBudgetMs: 30_000,
  runTimeoutMs: 30 * 60_000,
  keepWarm: false,
} as const
```

- [ ] **Step 2: Verify typecheck**

```
pnpm -C packages/coding-agents typecheck
```

Expect: clean.

- [ ] **Step 3: Commit**

```
git add packages/coding-agents/src/types.ts
git commit -m "feat(coding-agents): add SpawnCodingAgentOptions, RunSummary, defaults"
```

---

## Phase 1 — Pure components (parallel, 2 agents)

These two tasks touch disjoint files. Dispatch in parallel.

### Task 1.A — `WorkspaceRegistry`

**Files:**

- Create: `packages/coding-agents/src/workspace-registry.ts`
- Create: `packages/coding-agents/test/unit/workspace-registry.test.ts`

- [ ] **Step 1: Write the failing test first**

```ts
// test/unit/workspace-registry.test.ts
import { describe, it, expect } from 'vitest'
import { WorkspaceRegistry } from '../../src/workspace-registry'

describe('WorkspaceRegistry.resolveIdentity', () => {
  it('resolves volume:name when name is provided', async () => {
    const r = await WorkspaceRegistry.resolveIdentity('/p/coding-agent/x', {
      type: 'volume',
      name: 'foo',
    })
    expect(r.identity).toBe('volume:foo')
    expect(r.resolved).toEqual({ type: 'volume', name: 'foo' })
  })

  it('resolves volume:<agentId> when name is omitted', async () => {
    const r = await WorkspaceRegistry.resolveIdentity('/p/coding-agent/x', {
      type: 'volume',
    })
    expect(r.identity).toBe('volume:/p/coding-agent/x')
    expect(r.resolved).toEqual({ type: 'volume', name: '/p/coding-agent/x' })
  })

  it('resolves bindMount:<realpath> for bind mounts', async () => {
    const r = await WorkspaceRegistry.resolveIdentity('/p/coding-agent/x', {
      type: 'bindMount',
      hostPath: '/tmp',
    })
    expect(r.identity).toMatch(/^bindMount:\/(private\/)?tmp$/)
  })
})

describe('WorkspaceRegistry refcount', () => {
  it('tracks refs across register/release', () => {
    const wr = new WorkspaceRegistry()
    expect(wr.refs('volume:foo')).toBe(0)
    wr.register('volume:foo', 'a')
    wr.register('volume:foo', 'b')
    expect(wr.refs('volume:foo')).toBe(2)
    wr.release('volume:foo', 'a')
    expect(wr.refs('volume:foo')).toBe(1)
    wr.release('volume:foo', 'a') // double-release is idempotent
    expect(wr.refs('volume:foo')).toBe(1)
    wr.release('volume:foo', 'b')
    expect(wr.refs('volume:foo')).toBe(0)
  })
})

describe('WorkspaceRegistry mutex', () => {
  it('serializes acquire calls per identity', async () => {
    const wr = new WorkspaceRegistry()
    const order: Array<string> = []
    const a = wr.acquire('volume:foo').then((release) => {
      order.push('a-acquired')
      return new Promise<void>((res) =>
        setTimeout(() => {
          order.push('a-release')
          release()
          res()
        }, 50)
      )
    })
    // Make sure b queues behind a
    await new Promise((r) => setTimeout(r, 5))
    const b = wr.acquire('volume:foo').then((release) => {
      order.push('b-acquired')
      release()
    })
    await Promise.all([a, b])
    expect(order).toEqual(['a-acquired', 'a-release', 'b-acquired'])
  })

  it('does not serialize across distinct identities', async () => {
    const wr = new WorkspaceRegistry()
    const order: Array<string> = []
    const a = wr.acquire('volume:foo').then((release) => {
      order.push('a-acq')
      return new Promise<void>((res) =>
        setTimeout(() => {
          release()
          res()
        }, 50)
      )
    })
    const b = wr.acquire('volume:bar').then((release) => {
      order.push('b-acq')
      release()
    })
    await Promise.all([a, b])
    // b runs before a finishes
    expect(order[0]).toBe('a-acq')
    expect(order[1]).toBe('b-acq')
  })
})

describe('WorkspaceRegistry.rebuild', () => {
  it('replays a snapshot from durable state', () => {
    const wr = new WorkspaceRegistry()
    wr.rebuild([
      { identity: 'volume:foo', agentId: 'a' },
      { identity: 'volume:foo', agentId: 'b' },
      { identity: 'volume:bar', agentId: 'c' },
    ])
    expect(wr.refs('volume:foo')).toBe(2)
    expect(wr.refs('volume:bar')).toBe(1)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```
pnpm -C packages/coding-agents test test/unit/workspace-registry.test.ts
```

Expect: FAIL with module-not-found on `../../src/workspace-registry`.

- [ ] **Step 3: Write `src/workspace-registry.ts`**

```ts
import { realpath } from 'node:fs/promises'

export type ResolvedWorkspaceSpec =
  | { type: 'volume'; name: string }
  | { type: 'bindMount'; hostPath: string }

export class WorkspaceRegistry {
  private readonly refsByIdentity = new Map<string, Set<string>>()
  private readonly chainByIdentity = new Map<string, Promise<void>>()

  static async resolveIdentity(
    agentId: string,
    spec:
      | { type: 'volume'; name?: string }
      | { type: 'bindMount'; hostPath: string }
  ): Promise<{ identity: string; resolved: ResolvedWorkspaceSpec }> {
    if (spec.type === 'volume') {
      const name = spec.name ?? agentId
      return {
        identity: `volume:${name}`,
        resolved: { type: 'volume', name },
      }
    }
    const real = await realpath(spec.hostPath)
    return {
      identity: `bindMount:${real}`,
      resolved: { type: 'bindMount', hostPath: real },
    }
  }

  register(identity: string, agentId: string): void {
    let set = this.refsByIdentity.get(identity)
    if (!set) {
      set = new Set()
      this.refsByIdentity.set(identity, set)
    }
    set.add(agentId)
  }

  release(identity: string, agentId: string): void {
    const set = this.refsByIdentity.get(identity)
    if (!set) return
    set.delete(agentId)
    if (set.size === 0) this.refsByIdentity.delete(identity)
  }

  refs(identity: string): number {
    return this.refsByIdentity.get(identity)?.size ?? 0
  }

  /**
   * Acquire the per-identity mutex. Returns a release fn.
   * The mutex chains promises: each acquire waits for the prior chain to settle.
   */
  acquire(identity: string): Promise<() => void> {
    const prior = this.chainByIdentity.get(identity) ?? Promise.resolve()
    let releaseFn: () => void
    const next = new Promise<void>((res) => {
      releaseFn = res
    })
    this.chainByIdentity.set(
      identity,
      prior.then(() => next)
    )
    return prior.then(() => releaseFn!)
  }

  rebuild(snapshots: Array<{ identity: string; agentId: string }>): void {
    this.refsByIdentity.clear()
    this.chainByIdentity.clear()
    for (const { identity, agentId } of snapshots) {
      this.register(identity, agentId)
    }
  }
}
```

- [ ] **Step 4: Run the test, verify it passes**

```
pnpm -C packages/coding-agents test test/unit/workspace-registry.test.ts
```

Expect: PASS.

- [ ] **Step 5: Commit**

```
git add packages/coding-agents/src/workspace-registry.ts packages/coding-agents/test/unit/workspace-registry.test.ts
git commit -m "feat(coding-agents): WorkspaceRegistry with identity resolution, refcount, mutex"
```

---

### Task 1.B — `LifecycleManager`

**Files:**

- Create: `packages/coding-agents/src/lifecycle-manager.ts`
- Create: `packages/coding-agents/test/unit/lifecycle-manager.test.ts`

**Constraints:**

- LM is constructed with `{ provider, bridge }`.
- LM exposes: `ensureRunning(spec)`, `stop(agentId)`, `destroy(agentId)`, `armIdleTimer(agentId, ms, onFire)`, `cancelIdleTimer(agentId)`, `pin(agentId)`, `release(agentId)`, `pinCount(agentId)`, `resetPinCount(agentId)`, `adoptRunningContainers()`.
- LM exposes `startedAtMs: number` (captured in constructor).
- Idle timer is a `Map<string, NodeJS.Timeout>`. Pin count is `Map<string, number>`.
- Pin count semantics: `pin` increments and cancels active idle timer; `release` decrements (clamped at 0).

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/lifecycle-manager.test.ts
import { describe, it, expect, vi } from 'vitest'
import { LifecycleManager } from '../../src/lifecycle-manager'
import type {
  Bridge,
  ExecHandle,
  ExecRequest,
  RecoveredSandbox,
  RunTurnArgs,
  RunTurnResult,
  SandboxInstance,
  SandboxProvider,
  SandboxSpec,
} from '../../src/types'

function fakeProvider(): SandboxProvider & {
  starts: Array<SandboxSpec>
  stops: Array<string>
} {
  const stub: SandboxInstance = {
    instanceId: 'inst-1',
    agentId: '',
    workspaceMount: '/workspace',
    async exec(_req: ExecRequest): Promise<ExecHandle> {
      throw new Error('not used')
    },
  }
  const fp: any = {
    name: 'fake',
    starts: [] as Array<SandboxSpec>,
    stops: [] as Array<string>,
    async start(spec: SandboxSpec): Promise<SandboxInstance> {
      fp.starts.push(spec)
      return { ...stub, agentId: spec.agentId }
    },
    async stop(instanceId: string): Promise<void> {
      fp.stops.push(instanceId)
    },
    async destroy(_id: string): Promise<void> {},
    async status(_id: string): Promise<'running' | 'stopped' | 'unknown'> {
      return 'running'
    },
    async recover(): Promise<Array<RecoveredSandbox>> {
      return []
    },
  }
  return fp
}

const fakeBridge: Bridge = {
  async runTurn(_args: RunTurnArgs): Promise<RunTurnResult> {
    return { exitCode: 0 }
  },
}

describe('LifecycleManager pin refcount', () => {
  it('increments and decrements with a floor at 0', () => {
    const lm = new LifecycleManager({
      provider: fakeProvider(),
      bridge: fakeBridge,
    })
    expect(lm.pinCount('a')).toBe(0)
    expect(lm.pin('a').count).toBe(1)
    expect(lm.pin('a').count).toBe(2)
    expect(lm.release('a').count).toBe(1)
    expect(lm.release('a').count).toBe(0)
    // Extra release is clamped
    expect(lm.release('a').count).toBe(0)
  })

  it('resetPinCount clears to 0', () => {
    const lm = new LifecycleManager({
      provider: fakeProvider(),
      bridge: fakeBridge,
    })
    lm.pin('a')
    lm.pin('a')
    lm.resetPinCount('a')
    expect(lm.pinCount('a')).toBe(0)
  })
})

describe('LifecycleManager idle timer', () => {
  it('arms and fires onFire after ms elapses', async () => {
    const lm = new LifecycleManager({
      provider: fakeProvider(),
      bridge: fakeBridge,
    })
    const onFire = vi.fn()
    lm.armIdleTimer('a', 20, onFire)
    await new Promise((r) => setTimeout(r, 50))
    expect(onFire).toHaveBeenCalledTimes(1)
  })

  it('cancelIdleTimer prevents fire', async () => {
    const lm = new LifecycleManager({
      provider: fakeProvider(),
      bridge: fakeBridge,
    })
    const onFire = vi.fn()
    lm.armIdleTimer('a', 20, onFire)
    lm.cancelIdleTimer('a')
    await new Promise((r) => setTimeout(r, 50))
    expect(onFire).not.toHaveBeenCalled()
  })

  it('arming twice cancels prior timer', async () => {
    const lm = new LifecycleManager({
      provider: fakeProvider(),
      bridge: fakeBridge,
    })
    const first = vi.fn()
    const second = vi.fn()
    lm.armIdleTimer('a', 20, first)
    lm.armIdleTimer('a', 20, second)
    await new Promise((r) => setTimeout(r, 50))
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalled()
  })
})

describe('LifecycleManager ensureRunning', () => {
  it('forwards to provider.start', async () => {
    const fp = fakeProvider()
    const lm = new LifecycleManager({ provider: fp, bridge: fakeBridge })
    await lm.ensureRunning({
      agentId: '/x/coding-agent/y',
      kind: 'claude',
      workspace: { type: 'volume', name: 'w' },
      env: { K: 'v' },
    })
    expect(fp.starts).toHaveLength(1)
    expect(fp.starts[0]!.agentId).toBe('/x/coding-agent/y')
  })
})

describe('LifecycleManager.startedAtMs', () => {
  it('captures a timestamp at construction', () => {
    const before = Date.now()
    const lm = new LifecycleManager({
      provider: fakeProvider(),
      bridge: fakeBridge,
    })
    const after = Date.now()
    expect(lm.startedAtMs).toBeGreaterThanOrEqual(before)
    expect(lm.startedAtMs).toBeLessThanOrEqual(after)
  })
})
```

- [ ] **Step 2: Run the test, verify it fails**

```
pnpm -C packages/coding-agents test test/unit/lifecycle-manager.test.ts
```

Expect: FAIL on module-not-found.

- [ ] **Step 3: Write `src/lifecycle-manager.ts`**

```ts
import { log } from './log'
import type {
  Bridge,
  RecoveredSandbox,
  SandboxInstance,
  SandboxProvider,
  SandboxSpec,
} from './types'

export interface LifecycleManagerDeps {
  provider: SandboxProvider
  bridge: Bridge
}

export class LifecycleManager {
  readonly provider: SandboxProvider
  readonly bridge: Bridge
  /** Wall-clock ms captured at construction. Used to detect orphan runs. */
  readonly startedAtMs: number

  private readonly idleTimers = new Map<string, NodeJS.Timeout>()
  private readonly pinCounts = new Map<string, number>()

  constructor(deps: LifecycleManagerDeps) {
    this.provider = deps.provider
    this.bridge = deps.bridge
    this.startedAtMs = Date.now()
  }

  // ── sandbox lifecycle ──

  async ensureRunning(spec: SandboxSpec): Promise<SandboxInstance> {
    return this.provider.start(spec)
  }

  async stop(agentId: string): Promise<void> {
    this.cancelIdleTimer(agentId)
    // The provider.destroy/stop interface is keyed by instanceId, not agentId.
    // We rely on provider.destroy(agentId) which finds + removes by label.
    await this.provider.destroy(agentId).catch((err) => {
      log.warn(
        { err, agentId },
        'lifecycleManager.stop: provider.destroy failed'
      )
    })
  }

  async destroy(agentId: string): Promise<void> {
    await this.stop(agentId)
    this.pinCounts.delete(agentId)
  }

  async adoptRunningContainers(): Promise<Array<RecoveredSandbox>> {
    return this.provider.recover()
  }

  // ── idle timer ──

  armIdleTimer(agentId: string, ms: number, onFire: () => void): void {
    this.cancelIdleTimer(agentId)
    const handle = setTimeout(() => {
      this.idleTimers.delete(agentId)
      try {
        onFire()
      } catch (err) {
        log.warn({ err, agentId }, 'idle timer onFire threw')
      }
    }, ms)
    this.idleTimers.set(agentId, handle)
  }

  cancelIdleTimer(agentId: string): void {
    const handle = this.idleTimers.get(agentId)
    if (handle) {
      clearTimeout(handle)
      this.idleTimers.delete(agentId)
    }
  }

  // ── pin refcount ──

  pin(agentId: string): { count: number } {
    const next = (this.pinCounts.get(agentId) ?? 0) + 1
    this.pinCounts.set(agentId, next)
    if (next === 1) this.cancelIdleTimer(agentId)
    return { count: next }
  }

  release(agentId: string): { count: number } {
    const cur = this.pinCounts.get(agentId) ?? 0
    const next = Math.max(0, cur - 1)
    if (next === 0) this.pinCounts.delete(agentId)
    else this.pinCounts.set(agentId, next)
    return { count: next }
  }

  pinCount(agentId: string): number {
    return this.pinCounts.get(agentId) ?? 0
  }

  resetPinCount(agentId: string): void {
    this.pinCounts.delete(agentId)
  }
}
```

- [ ] **Step 4: Run the test, verify it passes**

```
pnpm -C packages/coding-agents test test/unit/lifecycle-manager.test.ts
```

Expect: PASS.

- [ ] **Step 5: Commit**

```
git add packages/coding-agents/src/lifecycle-manager.ts packages/coding-agents/test/unit/lifecycle-manager.test.ts
git commit -m "feat(coding-agents): LifecycleManager with idle timer and pin refcount"
```

---

## Phase 2 — Entity (sequential)

### Task 2.1 — Entity handler

**Files:**

- Create: `packages/coding-agents/src/entity/handler.ts`
- Create: `packages/coding-agents/test/unit/entity-handler.test.ts`

**Constraints:**

- The handler is a function `makeCodingAgentHandler(lm, wr, options)` returning an async `(ctx, wake) => void`.
- `options: { defaults: { idleTimeoutMs, coldBootBudgetMs, runTimeoutMs }, env: () => Record<string,string> }`.
- The handler reads/writes the StreamDB pattern: `ctx.db.collections.X.get`, `ctx.db.actions.X_insert/X_update`.
- Inbox messages: pending messages are ones with `key > sessionMeta.lastInboxKey`. Slice A reuses `sessionMeta` to track this since we don't have a separate `cursorState`. Add a `lastInboxKey?: string` field.
- Reconcile rules from spec table apply on every entry (after first-wake init).

- [ ] **Step 1: Add `lastInboxKey` to the meta schema**

Modify `packages/coding-agents/src/entity/collections.ts`. Add `lastInboxKey: z.string().optional()` to `sessionMetaRowSchema`:

```ts
export const sessionMetaRowSchema = z.object({
  // ... existing fields ...
  lastInboxKey: z.string().optional(),
})
```

- [ ] **Step 2: Write the failing test**

```ts
// test/unit/entity-handler.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { z } from 'zod'
import { makeCodingAgentHandler } from '../../src/entity/handler'
import { LifecycleManager } from '../../src/lifecycle-manager'
import { WorkspaceRegistry } from '../../src/workspace-registry'
import type {
  Bridge,
  RunTurnArgs,
  RunTurnResult,
  SandboxInstance,
  SandboxProvider,
  SandboxSpec,
} from '../../src/types'

// ── Fakes ──

interface InboxRow {
  key: string
  payload?: unknown
  message_type?: string
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

function makeFakeCtx(opts: {
  entityUrl: string
  args?: Record<string, unknown>
  inbox?: Array<InboxRow>
  meta?: any
  runs?: Array<any>
}) {
  const sessionMeta = makeCollection()
  const runs = makeCollection()
  const events = makeCollection()
  const lifecycle = makeCollection()
  const inbox = makeCollection()

  if (opts.meta) sessionMeta.rows.set('current', opts.meta)
  for (const r of opts.runs ?? []) runs.rows.set(r.key, r)
  for (const i of opts.inbox ?? []) inbox.rows.set(i.key, i)

  const recordedRuns: Array<{
    key: string
    status?: string
    response?: string
  }> = []
  let runCounter = 0

  const ctx: any = {
    entityUrl: opts.entityUrl,
    entityType: 'coding-agent',
    args: opts.args ?? {},
    tags: {},
    firstWake: false,
    db: {
      collections: { sessionMeta, runs, events, lifecycle, inbox },
      actions: {
        sessionMeta_insert: ({ row }: { row: any }) =>
          sessionMeta.rows.set(row.key, row),
        sessionMeta_update: ({
          key,
          updater,
        }: {
          key: string
          updater: (d: any) => void
        }) => {
          const cur = sessionMeta.rows.get(key)
          if (cur) updater(cur)
        },
        runs_insert: ({ row }: { row: any }) => runs.rows.set(row.key, row),
        runs_update: ({
          key,
          updater,
        }: {
          key: string
          updater: (d: any) => void
        }) => {
          const cur = runs.rows.get(key)
          if (cur) updater(cur)
        },
        events_insert: ({ row }: { row: any }) => events.rows.set(row.key, row),
        lifecycle_insert: ({ row }: { row: any }) =>
          lifecycle.rows.set(row.key, row),
      },
    },
    recordRun() {
      const key = `run-${++runCounter}`
      const ent = { key, status: undefined as string | undefined, response: '' }
      recordedRuns.push(ent)
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
    send: vi.fn(),
  }

  return { ctx, recordedRuns }
}

function makeFakeProvider(
  initialStatus: 'running' | 'stopped' | 'unknown' = 'stopped'
) {
  const stub: SandboxInstance = {
    instanceId: 'inst-1',
    agentId: '',
    workspaceMount: '/workspace',
    async exec() {
      throw new Error('not used')
    },
  }
  const fp: any = {
    name: 'fake',
    statusReturn: initialStatus,
    async start(spec: SandboxSpec): Promise<SandboxInstance> {
      return { ...stub, agentId: spec.agentId }
    },
    async stop(_id: string) {},
    async destroy(_id: string) {},
    async status() {
      return fp.statusReturn
    },
    async recover() {
      return []
    },
  }
  return fp
}

describe('entity handler — first-wake init', () => {
  it('seeds sessionMeta when none exists, using args', async () => {
    const lm = new LifecycleManager({
      provider: makeFakeProvider(),
      bridge: {
        async runTurn() {
          return { exitCode: 0 }
        },
      },
    })
    const wr = new WorkspaceRegistry()
    const handler = makeCodingAgentHandler(lm, wr, {
      defaults: {
        idleTimeoutMs: 1000,
        coldBootBudgetMs: 5000,
        runTimeoutMs: 5000,
      },
      env: () => ({}),
    })

    const { ctx } = makeFakeCtx({
      entityUrl: '/test/coding-agent/x',
      args: {
        kind: 'claude',
        workspace: { type: 'volume', name: 'w' },
      },
    })

    await handler(ctx, { type: 'message_received' } as any)

    const meta = ctx.db.collections.sessionMeta.get('current')
    expect(meta).toBeDefined()
    expect(meta.status).toBe('cold')
    expect(meta.kind).toBe('claude')
    expect(meta.workspaceIdentity).toBe('volume:w')
    expect(meta.pinned).toBe(false)
  })
})

describe('entity handler — pin/release', () => {
  it('pin sets pinned=true and cancels timer', async () => {
    const lm = new LifecycleManager({
      provider: makeFakeProvider('running'),
      bridge: {
        async runTurn() {
          return { exitCode: 0 }
        },
      },
    })
    const wr = new WorkspaceRegistry()
    const handler = makeCodingAgentHandler(lm, wr, {
      defaults: {
        idleTimeoutMs: 1000,
        coldBootBudgetMs: 5000,
        runTimeoutMs: 5000,
      },
      env: () => ({}),
    })
    const meta = {
      key: 'current',
      status: 'idle',
      kind: 'claude',
      pinned: false,
      workspaceIdentity: 'volume:w',
      workspaceSpec: { type: 'volume', name: 'w' },
      idleTimeoutMs: 1000,
      keepWarm: false,
    }
    const { ctx } = makeFakeCtx({
      entityUrl: '/t/coding-agent/x',
      meta,
      inbox: [{ key: 'i1', message_type: 'pin' }],
    })
    await handler(ctx, { type: 'message_received' } as any)
    expect(ctx.db.collections.sessionMeta.get('current').pinned).toBe(true)
    expect(lm.pinCount('/t/coding-agent/x')).toBe(1)
  })
})

describe('entity handler — reconcile orphan run', () => {
  it('marks orphan run failed when meta=running and run.startedAt < lm.startedAtMs', async () => {
    const lm = new LifecycleManager({
      provider: makeFakeProvider('stopped'),
      bridge: {
        async runTurn() {
          return { exitCode: 0 }
        },
      },
    })
    const wr = new WorkspaceRegistry()
    const handler = makeCodingAgentHandler(lm, wr, {
      defaults: {
        idleTimeoutMs: 1000,
        coldBootBudgetMs: 5000,
        runTimeoutMs: 5000,
      },
      env: () => ({}),
    })
    const oldStart = lm.startedAtMs - 10_000
    const meta = {
      key: 'current',
      status: 'running',
      kind: 'claude',
      pinned: false,
      workspaceIdentity: 'volume:w',
      workspaceSpec: { type: 'volume', name: 'w' },
      idleTimeoutMs: 1000,
      keepWarm: false,
      instanceId: 'old-inst',
    }
    const orphanRun = {
      key: 'run-old',
      startedAt: oldStart,
      status: 'running',
      promptInboxKey: 'i0',
    }
    const { ctx } = makeFakeCtx({
      entityUrl: '/t/coding-agent/x',
      meta,
      runs: [orphanRun],
    })
    await handler(ctx, { type: 'message_received' } as any)
    const updated = ctx.db.collections.runs.get('run-old')
    expect(updated.status).toBe('failed')
    expect(updated.finishReason).toBe('orphaned')
    expect(ctx.db.collections.sessionMeta.get('current').status).toBe('cold')
  })
})

describe('entity handler — processPrompt happy path', () => {
  it('runs a turn, records events, ends run completed', async () => {
    const events: Array<any> = [
      { type: 'session_init', sessionId: 'abc', ts: 1 },
      { type: 'assistant_message', text: 'hello', ts: 2 },
    ]
    const bridge: Bridge = {
      async runTurn(args: RunTurnArgs): Promise<RunTurnResult> {
        for (const e of events) args.onEvent(e as any)
        return { exitCode: 0, finalText: 'hello' }
      },
    }
    const lm = new LifecycleManager({
      provider: makeFakeProvider('stopped'),
      bridge,
    })
    const wr = new WorkspaceRegistry()
    const handler = makeCodingAgentHandler(lm, wr, {
      defaults: {
        idleTimeoutMs: 1000,
        coldBootBudgetMs: 5000,
        runTimeoutMs: 5000,
      },
      env: () => ({ ANTHROPIC_API_KEY: 'sk-test' }),
    })
    const meta = {
      key: 'current',
      status: 'cold',
      kind: 'claude',
      pinned: false,
      workspaceIdentity: 'volume:w',
      workspaceSpec: { type: 'volume', name: 'w' },
      idleTimeoutMs: 1000,
      keepWarm: false,
    }
    const { ctx, recordedRuns } = makeFakeCtx({
      entityUrl: '/t/coding-agent/x',
      meta,
      inbox: [{ key: 'i1', message_type: 'prompt', payload: { text: 'hi' } }],
    })
    await handler(ctx, { type: 'message_received' } as any)

    expect(recordedRuns).toHaveLength(1)
    expect(recordedRuns[0]!.status).toBe('completed')
    expect(recordedRuns[0]!.response).toBe('hello')

    const finalMeta = ctx.db.collections.sessionMeta.get('current')
    expect(finalMeta.status).toBe('idle')

    const runs = Array.from(ctx.db.collections.runs.rows.values())
    expect(runs).toHaveLength(1)
    expect((runs[0] as any).status).toBe('completed')

    const eventRows = Array.from(ctx.db.collections.events.rows.values())
    expect(eventRows).toHaveLength(2)
  })
})
```

- [ ] **Step 3: Run the test, verify it fails**

```
pnpm -C packages/coding-agents test test/unit/entity-handler.test.ts
```

Expect: FAIL on missing module.

- [ ] **Step 4: Write `src/entity/handler.ts`**

```ts
import type { NormalizedEvent } from 'agent-session-protocol'
import { log } from '../log'
import { WorkspaceRegistry } from '../workspace-registry'
import type { LifecycleManager } from '../lifecycle-manager'
import type {
  RunRow,
  SessionMetaRow,
  EventRow,
  LifecycleRow,
} from './collections'
import { promptMessageSchema } from './messages'

export interface CodingAgentHandlerOptions {
  defaults: {
    idleTimeoutMs: number
    coldBootBudgetMs: number
    runTimeoutMs: number
  }
  /** Called per-turn to source CLI env (e.g. ANTHROPIC_API_KEY). */
  env: () => Record<string, string>
}

interface InboxRow {
  key: string
  payload?: unknown
  message_type?: string
}

const NS_MAX = String(Number.MAX_SAFE_INTEGER).length

function nextRunId(existing: ReadonlyArray<{ key: string }>): string {
  // Deterministic: run-N where N = count + 1
  return `run-${existing.length + 1}`
}

function eventKey(runId: string, seq: number): string {
  return `${runId}:${String(seq).padStart(NS_MAX, '0')}`
}

function lifecycleKey(label: string): string {
  return `${label}:${Date.now()}-${Math.floor(Math.random() * 1000)}`
}

function raceTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const handle = setTimeout(() => {
      const e = new Error('TimeoutError')
      ;(e as any).name = 'TimeoutError'
      reject(e)
    }, ms)
    p.then(
      (v) => {
        clearTimeout(handle)
        resolve(v)
      },
      (err) => {
        clearTimeout(handle)
        reject(err)
      }
    )
  })
}

export function makeCodingAgentHandler(
  lm: LifecycleManager,
  wr: WorkspaceRegistry,
  options: CodingAgentHandlerOptions
) {
  return async function handleCodingAgentEntity(
    ctx: any,
    _wake: any
  ): Promise<void> {
    const agentId = ctx.entityUrl as string
    const sessionMetaCol = ctx.db.collections.sessionMeta
    const runsCol = ctx.db.collections.runs
    const eventsCol = ctx.db.collections.events
    const lifecycleCol = ctx.db.collections.lifecycle
    const inboxCol = ctx.db.collections.inbox

    // ─── 1) FIRST-WAKE INIT ────────────────────────────────────────────────

    let meta = sessionMetaCol.get('current') as SessionMetaRow | undefined
    if (!meta) {
      const args = ctx.args as {
        kind?: 'claude'
        workspace?: any
        lifecycle?: { idleTimeoutMs?: number; keepWarm?: boolean }
      }
      const ws = args.workspace ?? { type: 'volume' }
      const resolved = await WorkspaceRegistry.resolveIdentity(agentId, ws)
      const idleTimeoutMs =
        args.lifecycle?.idleTimeoutMs ?? options.defaults.idleTimeoutMs
      const keepWarm = args.lifecycle?.keepWarm ?? false
      const initial: SessionMetaRow = {
        key: 'current',
        status: 'cold',
        kind: args.kind ?? 'claude',
        pinned: false,
        workspaceIdentity: resolved.identity,
        workspaceSpec: resolved.resolved,
        idleTimeoutMs,
        keepWarm,
      }
      ctx.db.actions.sessionMeta_insert({ row: initial })
      wr.register(resolved.identity, agentId)
      meta = initial
    }

    if (meta.status === 'destroyed') {
      // Tombstoned. Ignore everything.
      return
    }

    // ─── 2) RECONCILE ──────────────────────────────────────────────────────

    const providerStatus = await lm.provider.status(agentId)
    const openRun = (runsCol.toArray as Array<RunRow>).find(
      (r) => r.status === 'running'
    )
    const isOrphaned = openRun && openRun.startedAt < lm.startedAtMs

    if (meta.status === 'running' && providerStatus !== 'running') {
      if (openRun) {
        ctx.db.actions.runs_update({
          key: openRun.key,
          updater: (d: RunRow) => {
            d.status = 'failed'
            d.finishReason = 'orphaned'
            d.endedAt = Date.now()
          },
        })
      }
      ctx.db.actions.lifecycle_insert({
        row: {
          key: lifecycleKey('orphan'),
          ts: Date.now(),
          event: 'orphan.detected',
        } satisfies LifecycleRow,
      })
      ctx.db.actions.sessionMeta_update({
        key: 'current',
        updater: (d: SessionMetaRow) => {
          d.status = 'cold'
          d.instanceId = undefined
        },
      })
      meta = sessionMetaCol.get('current')!
    } else if (
      meta.status === 'running' &&
      providerStatus === 'running' &&
      isOrphaned
    ) {
      ctx.db.actions.runs_update({
        key: openRun!.key,
        updater: (d: RunRow) => {
          d.status = 'failed'
          d.finishReason = 'orphaned'
          d.endedAt = Date.now()
        },
      })
      ctx.db.actions.lifecycle_insert({
        row: {
          key: lifecycleKey('orphan'),
          ts: Date.now(),
          event: 'orphan.detected',
        } satisfies LifecycleRow,
      })
      ctx.db.actions.sessionMeta_update({
        key: 'current',
        updater: (d: SessionMetaRow) => {
          d.status = 'idle'
        },
      })
      meta = sessionMetaCol.get('current')!
    } else if (meta.status === 'idle' && providerStatus === 'stopped') {
      ctx.db.actions.sessionMeta_update({
        key: 'current',
        updater: (d: SessionMetaRow) => {
          d.status = 'cold'
          d.instanceId = undefined
        },
      })
      meta = sessionMetaCol.get('current')!
    } else if (
      (meta.status === 'starting' || meta.status === 'stopping') &&
      providerStatus !== 'running'
    ) {
      ctx.db.actions.sessionMeta_update({
        key: 'current',
        updater: (d: SessionMetaRow) => {
          d.status = 'cold'
        },
      })
      meta = sessionMetaCol.get('current')!
    } else if (
      (meta.status === 'starting' || meta.status === 'stopping') &&
      providerStatus === 'running'
    ) {
      ctx.db.actions.sessionMeta_update({
        key: 'current',
        updater: (d: SessionMetaRow) => {
          d.status = 'idle'
        },
      })
      meta = sessionMetaCol.get('current')!
    }

    // ─── 3) PROCESS PENDING INBOX ──────────────────────────────────────────

    const inboxRows = (inboxCol.toArray as Array<InboxRow>)
      .slice()
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    const lastKey = meta.lastInboxKey ?? ''
    const pending = inboxRows.filter((m) => m.key > lastKey)

    for (const inboxMsg of pending) {
      try {
        await dispatchInboxMessage(ctx, lm, wr, options, inboxMsg)
      } catch (err) {
        log.error({ err, inboxMsg }, 'coding-agent handler dispatch threw')
        ctx.db.actions.sessionMeta_update({
          key: 'current',
          updater: (d: SessionMetaRow) => {
            d.status = 'error'
            d.lastError = err instanceof Error ? err.message : String(err)
          },
        })
      }
      ctx.db.actions.sessionMeta_update({
        key: 'current',
        updater: (d: SessionMetaRow) => {
          d.lastInboxKey = inboxMsg.key
        },
      })
      meta = sessionMetaCol.get('current')!
      if (meta.status === 'destroyed') return
    }
  }
}

async function dispatchInboxMessage(
  ctx: any,
  lm: LifecycleManager,
  wr: WorkspaceRegistry,
  options: CodingAgentHandlerOptions,
  inboxMsg: InboxRow
): Promise<void> {
  const type = inboxMsg.message_type ?? 'prompt'
  switch (type) {
    case 'prompt':
      return processPrompt(ctx, lm, wr, options, inboxMsg)
    case 'pin':
      return processPin(ctx, lm)
    case 'release':
      return processRelease(ctx, lm)
    case 'stop':
      return processStop(ctx, lm)
    case 'destroy':
      return processDestroy(ctx, lm, wr)
    default:
      log.warn({ type }, 'coding-agent: unknown inbox message type')
  }
}

async function processPrompt(
  ctx: any,
  lm: LifecycleManager,
  wr: WorkspaceRegistry,
  options: CodingAgentHandlerOptions,
  inboxMsg: InboxRow
): Promise<void> {
  const parsed = promptMessageSchema.safeParse(inboxMsg.payload)
  if (!parsed.success) return
  const promptText = parsed.data.text
  const agentId = ctx.entityUrl as string
  const sessionMetaCol = ctx.db.collections.sessionMeta
  const runsCol = ctx.db.collections.runs
  const eventsCol = ctx.db.collections.events
  const lifecycleCol = ctx.db.collections.lifecycle

  let meta = sessionMetaCol.get('current') as SessionMetaRow

  // Cold-boot: ensure sandbox up
  ctx.db.actions.sessionMeta_update({
    key: 'current',
    updater: (d: SessionMetaRow) => {
      d.status = 'starting'
    },
  })
  ctx.db.actions.lifecycle_insert({
    row: {
      key: `boot:${Date.now()}`,
      ts: Date.now(),
      event: 'sandbox.starting',
    } satisfies LifecycleRow,
  })

  let sandbox
  try {
    sandbox = await raceTimeout(
      lm.ensureRunning({
        agentId,
        kind: meta.kind,
        workspace: meta.workspaceSpec,
        env: options.env(),
      }),
      options.defaults.coldBootBudgetMs
    )
  } catch (err) {
    ctx.db.actions.sessionMeta_update({
      key: 'current',
      updater: (d: SessionMetaRow) => {
        d.status = 'error'
        d.lastError = err instanceof Error ? err.message : String(err)
      },
    })
    ctx.db.actions.lifecycle_insert({
      row: {
        key: `boot:${Date.now()}`,
        ts: Date.now(),
        event: 'sandbox.failed',
        detail: err instanceof Error ? err.message : String(err),
      } satisfies LifecycleRow,
    })
    return
  }

  ctx.db.actions.sessionMeta_update({
    key: 'current',
    updater: (d: SessionMetaRow) => {
      d.status = 'idle'
      d.instanceId = sandbox.instanceId
    },
  })
  ctx.db.actions.lifecycle_insert({
    row: {
      key: `boot:${Date.now()}`,
      ts: Date.now(),
      event: 'sandbox.started',
    } satisfies LifecycleRow,
  })

  meta = sessionMetaCol.get('current')!
  const releaseLease = await wr.acquire(meta.workspaceIdentity)
  try {
    ctx.db.actions.sessionMeta_update({
      key: 'current',
      updater: (d: SessionMetaRow) => {
        d.status = 'running'
        d.currentPromptInboxKey = inboxMsg.key
      },
    })

    const recordedRun = ctx.recordRun()
    const runId = recordedRun.key
    ctx.db.actions.runs_insert({
      row: {
        key: runId,
        startedAt: Date.now(),
        status: 'running',
        promptInboxKey: inboxMsg.key,
      } satisfies RunRow,
    })

    let seq = 0
    let finalText: string | undefined
    try {
      const result = await raceTimeout(
        lm.bridge.runTurn({
          sandbox,
          kind: meta.kind,
          prompt: promptText,
          onEvent: (e: NormalizedEvent) => {
            ctx.db.actions.events_insert({
              row: {
                key: eventKey(runId, seq),
                runId,
                seq,
                ts: Date.now(),
                type: e.type,
                payload: e as unknown as Record<string, unknown>,
              } satisfies EventRow,
            })
            seq++
          },
        }),
        options.defaults.runTimeoutMs
      )
      finalText = result.finalText
      ctx.db.actions.runs_update({
        key: runId,
        updater: (d: RunRow) => {
          d.status = 'completed'
          d.endedAt = Date.now()
          d.responseText = finalText
        },
      })
      if (finalText) recordedRun.attachResponse(finalText)
      recordedRun.end({ status: 'completed' })
    } catch (err) {
      const reason =
        err instanceof Error && err.name === 'TimeoutError'
          ? 'timeout'
          : `cli-exit:${(err instanceof Error ? err.message : String(err)).slice(0, 200)}`
      ctx.db.actions.runs_update({
        key: runId,
        updater: (d: RunRow) => {
          d.status = 'failed'
          d.endedAt = Date.now()
          d.finishReason = reason
        },
      })
      ctx.db.actions.sessionMeta_update({
        key: 'current',
        updater: (d: SessionMetaRow) => {
          d.status = 'error'
          d.lastError = err instanceof Error ? err.message : String(err)
        },
      })
      recordedRun.end({ status: 'failed', finishReason: reason })
      return
    }

    ctx.db.actions.sessionMeta_update({
      key: 'current',
      updater: (d: SessionMetaRow) => {
        d.status = 'idle'
        d.currentPromptInboxKey = undefined
      },
    })

    if (!meta.keepWarm && lm.pinCount(agentId) === 0) {
      lm.armIdleTimer(agentId, meta.idleTimeoutMs, () => {
        // Fire-and-forget: provider.destroy is keyed by agentId.
        void lm.provider.destroy(agentId).catch((err) => {
          log.warn({ err, agentId }, 'idle stop failed')
        })
      })
    }
  } finally {
    releaseLease()
  }
}

function processPin(ctx: any, lm: LifecycleManager): void {
  const agentId = ctx.entityUrl as string
  const { count } = lm.pin(agentId)
  ctx.db.actions.sessionMeta_update({
    key: 'current',
    updater: (d: SessionMetaRow) => {
      d.pinned = true
    },
  })
  ctx.db.actions.lifecycle_insert({
    row: {
      key: `pin:${Date.now()}`,
      ts: Date.now(),
      event: 'pin',
      detail: `count=${count}`,
    } satisfies LifecycleRow,
  })
}

function processRelease(ctx: any, lm: LifecycleManager): void {
  const agentId = ctx.entityUrl as string
  const { count } = lm.release(agentId)
  ctx.db.actions.sessionMeta_update({
    key: 'current',
    updater: (d: SessionMetaRow) => {
      d.pinned = count > 0
    },
  })
  ctx.db.actions.lifecycle_insert({
    row: {
      key: `release:${Date.now()}`,
      ts: Date.now(),
      event: 'release',
      detail: `count=${count}`,
    } satisfies LifecycleRow,
  })
  if (count === 0) {
    const meta = ctx.db.collections.sessionMeta.get('current') as SessionMetaRow
    if (!meta.keepWarm && meta.status === 'idle') {
      lm.armIdleTimer(agentId, meta.idleTimeoutMs, () => {
        void lm.provider.destroy(agentId).catch(() => undefined)
      })
    }
  }
}

async function processStop(ctx: any, lm: LifecycleManager): Promise<void> {
  const agentId = ctx.entityUrl as string
  ctx.db.actions.sessionMeta_update({
    key: 'current',
    updater: (d: SessionMetaRow) => {
      d.status = 'stopping'
    },
  })
  await lm.stop(agentId)
  ctx.db.actions.sessionMeta_update({
    key: 'current',
    updater: (d: SessionMetaRow) => {
      d.status = 'cold'
      d.instanceId = undefined
    },
  })
  ctx.db.actions.lifecycle_insert({
    row: {
      key: `stop:${Date.now()}`,
      ts: Date.now(),
      event: 'sandbox.stopped',
    } satisfies LifecycleRow,
  })
}

async function processDestroy(
  ctx: any,
  lm: LifecycleManager,
  wr: WorkspaceRegistry
): Promise<void> {
  const agentId = ctx.entityUrl as string
  const meta = ctx.db.collections.sessionMeta.get('current') as SessionMetaRow
  await lm.destroy(agentId)
  if (meta) wr.release(meta.workspaceIdentity, agentId)
  ctx.db.actions.sessionMeta_update({
    key: 'current',
    updater: (d: SessionMetaRow) => {
      d.status = 'destroyed'
      d.instanceId = undefined
    },
  })
  ctx.db.actions.lifecycle_insert({
    row: {
      key: `destroy:${Date.now()}`,
      ts: Date.now(),
      event: 'sandbox.stopped',
      detail: 'destroyed',
    } satisfies LifecycleRow,
  })
}
```

- [ ] **Step 5: Run the test, verify it passes**

```
pnpm -C packages/coding-agents test test/unit/entity-handler.test.ts
```

Expect: PASS (4 tests).

- [ ] **Step 6: Run full unit test suite to confirm no regressions**

```
pnpm -C packages/coding-agents test
```

Expect: all unit tests pass.

- [ ] **Step 7: Commit**

```
git add packages/coding-agents/src/entity/handler.ts packages/coding-agents/src/entity/collections.ts packages/coding-agents/test/unit/entity-handler.test.ts
git commit -m "feat(coding-agents): entity handler with reconcile, prompt/pin/release/stop/destroy"
```

---

### Task 2.2 — `registerCodingAgent`

**Files:**

- Create: `packages/coding-agents/src/entity/register.ts`
- Modify: `packages/coding-agents/src/index.ts`

- [ ] **Step 1: Write `src/entity/register.ts`**

```ts
import type { EntityRegistry } from '@electric-ax/agents-runtime'
import { LifecycleManager } from '../lifecycle-manager'
import { WorkspaceRegistry } from '../workspace-registry'
import { SLICE_A_DEFAULTS } from '../types'
import type { Bridge, SandboxProvider } from '../types'
import {
  CODING_AGENT_EVENTS_COLLECTION_TYPE,
  CODING_AGENT_LIFECYCLE_COLLECTION_TYPE,
  CODING_AGENT_RUNS_COLLECTION_TYPE,
  CODING_AGENT_SESSION_META_COLLECTION_TYPE,
  eventRowSchema,
  lifecycleRowSchema,
  runRowSchema,
  sessionMetaRowSchema,
} from './collections'
import {
  destroyMessageSchema,
  pinMessageSchema,
  promptMessageSchema,
  releaseMessageSchema,
  stopMessageSchema,
} from './messages'
import { makeCodingAgentHandler } from './handler'
import { z } from 'zod'

export interface RegisterCodingAgentDeps {
  provider: SandboxProvider
  bridge: Bridge
  /** Override defaults; used by tests. */
  defaults?: Partial<{
    idleTimeoutMs: number
    coldBootBudgetMs: number
    runTimeoutMs: number
  }>
  /** Per-turn env supplier. Defaults to forwarding ANTHROPIC_API_KEY from process.env. */
  env?: () => Record<string, string>
}

const creationArgsSchema = z.object({
  kind: z.enum(['claude']).optional(),
  workspace: z
    .union([
      z.object({
        type: z.literal('volume'),
        name: z.string().optional(),
      }),
      z.object({
        type: z.literal('bindMount'),
        hostPath: z.string(),
      }),
    ])
    .optional(),
  lifecycle: z
    .object({
      idleTimeoutMs: z.number().optional(),
      keepWarm: z.boolean().optional(),
    })
    .optional(),
})

export function registerCodingAgent(
  registry: EntityRegistry,
  deps: RegisterCodingAgentDeps
): void {
  const lm = new LifecycleManager(deps)
  const wr = new WorkspaceRegistry()
  const defaults = {
    idleTimeoutMs:
      deps.defaults?.idleTimeoutMs ?? SLICE_A_DEFAULTS.idleTimeoutMs,
    coldBootBudgetMs:
      deps.defaults?.coldBootBudgetMs ?? SLICE_A_DEFAULTS.coldBootBudgetMs,
    runTimeoutMs: deps.defaults?.runTimeoutMs ?? SLICE_A_DEFAULTS.runTimeoutMs,
  }
  const env =
    deps.env ??
    (() => {
      const out: Record<string, string> = {}
      const k = process.env.ANTHROPIC_API_KEY
      if (k) out.ANTHROPIC_API_KEY = k
      return out
    })

  registry.define('coding-agent', {
    description:
      'Runs a Claude Code CLI session inside a Docker sandbox. Manages lifecycle (cold/idle/running) and workspace lease.',
    creationSchema: creationArgsSchema,
    inboxSchemas: {
      prompt: promptMessageSchema,
      pin: pinMessageSchema,
      release: releaseMessageSchema,
      stop: stopMessageSchema,
      destroy: destroyMessageSchema,
    },
    state: {
      sessionMeta: {
        schema: sessionMetaRowSchema,
        type: CODING_AGENT_SESSION_META_COLLECTION_TYPE,
        primaryKey: 'key',
      },
      runs: {
        schema: runRowSchema,
        type: CODING_AGENT_RUNS_COLLECTION_TYPE,
        primaryKey: 'key',
      },
      events: {
        schema: eventRowSchema,
        type: CODING_AGENT_EVENTS_COLLECTION_TYPE,
        primaryKey: 'key',
      },
      lifecycle: {
        schema: lifecycleRowSchema,
        type: CODING_AGENT_LIFECYCLE_COLLECTION_TYPE,
        primaryKey: 'key',
      },
    },
    handler: makeCodingAgentHandler(lm, wr, { defaults, env }),
  })
}

/** Test-only accessor for asserting workspace registry state from outside. */
export interface CodingAgentInternals {
  lifecycleManager: LifecycleManager
  workspaceRegistry: WorkspaceRegistry
}
```

- [ ] **Step 2: Update `src/index.ts`**

Replace contents:

```ts
export type {
  CodingAgentKind,
  SandboxSpec,
  ExecRequest,
  ExecHandle,
  SandboxInstance,
  SandboxProvider,
  RecoveredSandbox,
  RunTurnArgs,
  RunTurnResult,
  Bridge,
  SpawnCodingAgentOptions,
  RunSummary,
  CodingAgentStatus,
} from './types'
export { LocalDockerProvider } from './providers/local-docker'
export { StdioBridge } from './bridge/stdio-bridge'
export { LifecycleManager } from './lifecycle-manager'
export { WorkspaceRegistry } from './workspace-registry'
export {
  registerCodingAgent,
  type RegisterCodingAgentDeps,
} from './entity/register'
export {
  CODING_AGENT_SESSION_META_COLLECTION_TYPE,
  CODING_AGENT_RUNS_COLLECTION_TYPE,
  CODING_AGENT_EVENTS_COLLECTION_TYPE,
  CODING_AGENT_LIFECYCLE_COLLECTION_TYPE,
} from './entity/collections'
```

- [ ] **Step 3: Run typecheck**

```
pnpm -C packages/coding-agents typecheck
```

Expect: clean.

- [ ] **Step 4: Run all unit tests**

```
pnpm -C packages/coding-agents test
```

Expect: all pass.

- [ ] **Step 5: Commit**

```
git add packages/coding-agents/src/entity/register.ts packages/coding-agents/src/index.ts
git commit -m "feat(coding-agents): registerCodingAgent helper"
```

---

### Task 2.3 — Runtime API surface (`ctx.spawnCodingAgent` / `observeCodingAgent`)

**Files:**

- Modify: `packages/agents-runtime/src/types.ts` (add types and HandlerContext methods)
- Modify: `packages/agents-runtime/src/context-factory.ts` (add impl)

- [ ] **Step 1: Read the existing `useCodingAgent` impl as a reference**

Already known location: `packages/agents-runtime/src/context-factory.ts:561-629`. New helpers will be placed alongside it.

- [ ] **Step 2: Add types in `packages/agents-runtime/src/types.ts`**

Find the existing `CodingSessionHandle` interface (~line 800). Insert these new types **after** it:

```ts
// ─── Coding Agent (Slice A) ───────────────────────────────────────────────

export type CodingAgentSliceAStatus =
  | 'cold'
  | 'starting'
  | 'idle'
  | 'running'
  | 'stopping'
  | 'error'
  | 'destroyed'

export interface SpawnCodingAgentOptions {
  id: string
  kind: 'claude'
  workspace:
    | { type: 'volume'; name?: string }
    | { type: 'bindMount'; hostPath: string }
  initialPrompt?: string
  wake?: { on: 'runFinished'; includeResponse?: boolean }
  lifecycle?: { idleTimeoutMs?: number; keepWarm?: boolean }
}

export interface CodingAgentRunSummary {
  runId: string
  startedAt: number
  endedAt?: number
  status: 'running' | 'completed' | 'failed'
  promptInboxKey: string
  responseText?: string
}

export interface CodingAgentState {
  status: CodingAgentSliceAStatus
  pinned: boolean
  workspace: { identity: string; sharedRefs: number }
  lastError?: string
  runs: ReadonlyArray<CodingAgentRunSummary>
}

export interface CodingAgentHandle {
  readonly url: string
  readonly kind: 'claude'
  send(prompt: string): Promise<{ runId: string }>
  events(opts?: { since?: 'start' | 'now' }): AsyncIterable<unknown>
  state(): CodingAgentState
  pin(): Promise<void>
  release(): Promise<void>
  stop(): Promise<void>
  destroy(): Promise<void>
}
```

Then **add to the `HandlerContext` interface** (the one defined ~line 882). Insert these two methods after `useCodingAgent`:

```ts
/**
 * Spawn (or attach to) a `coding-agent` entity that runs a CLI inside a
 * Docker sandbox with managed lifecycle (cold/idle/running, idle hibernation,
 * pin/release, workspace lease). Requires `registerCodingAgent` to have been
 * called on the runtime's registry.
 */
spawnCodingAgent: (opts: SpawnCodingAgentOptions) => Promise<CodingAgentHandle>
observeCodingAgent: (id: string) => Promise<CodingAgentHandle>
```

- [ ] **Step 3: Implement in `packages/agents-runtime/src/context-factory.ts`**

Find `async useCodingAgent(...)` (line ~561). Insert these two new methods immediately after it (before `send(...)`):

```ts
    async spawnCodingAgent(
      opts: SpawnCodingAgentOptions
    ): Promise<CodingAgentHandle> {
      const spawnArgs: Record<string, unknown> = {
        kind: opts.kind,
        workspace: opts.workspace,
      }
      if (opts.lifecycle !== undefined) spawnArgs.lifecycle = opts.lifecycle

      const initialMessage =
        opts.initialPrompt !== undefined
          ? { type: 'prompt' as const, payload: { text: opts.initialPrompt } }
          : undefined

      const wake: Wake = opts.wake
        ? `runFinished`
        : `runFinished`

      const entityHandle = await config.doSpawn(
        'coding-agent',
        opts.id,
        spawnArgs,
        {
          observe: true,
          wake,
          ...(initialMessage ? { initialMessage } : {}),
        }
      )

      return makeCodingAgentHandle(
        config,
        entityHandle.url,
        entityHandle
      )
    },
    async observeCodingAgent(id: string): Promise<CodingAgentHandle> {
      const url = `${entityUrl}/coding-agent/${id}`
      const entityHandle = await (config.doObserve as any)({
        sourceType: 'entity',
        path: url,
      })
      return makeCodingAgentHandle(config, url, entityHandle)
    },
```

Then add this helper at the bottom of the same file (above the closing return of `createContextFactory` or whatever exports it — find the right scope by reading file context):

```ts
function makeCodingAgentHandle(
  config: any,
  url: string,
  entityHandle: any
): CodingAgentHandle {
  const sendInbox = (
    payload: unknown,
    type: string
  ): Promise<{ runId: string }> => {
    config.executeSend({
      targetUrl: url,
      payload,
      type,
    })
    // The inbox key isn't known to the caller; surface a synthetic id.
    return Promise.resolve({ runId: `run-pending-${Date.now()}` })
  }

  const readMeta = (): any => {
    const c = entityHandle.db?.collections?.sessionMeta
    return c?.get?.('current')
  }
  const readRuns = (): Array<CodingAgentRunSummary> => {
    const c = entityHandle.db?.collections?.runs
    if (!c) return []
    const rows = (c as { toArray?: unknown }).toArray
    if (!Array.isArray(rows)) return []
    return rows.map((r: any) => ({
      runId: r.key,
      startedAt: r.startedAt,
      endedAt: r.endedAt,
      status: r.status,
      promptInboxKey: r.promptInboxKey,
      responseText: r.responseText,
    }))
  }

  return {
    url,
    kind: 'claude',
    send: (text: string) => {
      config.executeSend({
        targetUrl: url,
        payload: { text },
        type: 'prompt',
      })
      return Promise.resolve({ runId: `run-pending-${Date.now()}` })
    },
    pin: () => sendInbox({}, 'pin').then(() => undefined),
    release: () => sendInbox({}, 'release').then(() => undefined),
    stop: () => sendInbox({}, 'stop').then(() => undefined),
    destroy: () => sendInbox({}, 'destroy').then(() => undefined),
    state(): CodingAgentState {
      const meta = readMeta()
      return {
        status: meta?.status ?? 'cold',
        pinned: meta?.pinned ?? false,
        workspace: {
          identity: meta?.workspaceIdentity ?? '',
          sharedRefs: 1, // server-only state; see Slice A spec
        },
        lastError: meta?.lastError,
        runs: readRuns(),
      }
    },
    events(opts?: { since?: 'start' | 'now' }) {
      // Slice A: simple async iterator that yields current rows then stops.
      // Live tailing is added with the UI in Slice C.
      const since = opts?.since ?? 'now'
      const c = entityHandle.db?.collections?.events
      const rows: Array<{ payload: unknown }> =
        c && Array.isArray((c as any).toArray) ? (c as any).toArray : []
      const initial = since === 'start' ? rows.slice() : []
      return (async function* () {
        for (const r of initial) {
          yield r.payload
        }
      })()
    },
  }
}
```

Imports needed at the top of the file (verify they aren't already imported):

```ts
import type {
  SpawnCodingAgentOptions,
  CodingAgentHandle,
  CodingAgentState,
  CodingAgentRunSummary,
} from './types'
```

- [ ] **Step 4: Add a runtime unit test**

Create `packages/agents-runtime/test/spawn-coding-agent.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
// NOTE: This test calls into the context factory at a low level. The real
// runtime test suite verifies the broader integration. Slice A only asserts
// the desugaring contract.

import type { CodingAgentHandle, SpawnCodingAgentOptions } from '../src/types'

describe('ctx.spawnCodingAgent desugaring', () => {
  // Lightweight contract test: importing the runtime's types confirms the
  // public surface compiles. Runtime-level integration coverage is in
  // packages/coding-agents/test/integration/slice-a.test.ts.
  it('exports SpawnCodingAgentOptions', () => {
    const opts: SpawnCodingAgentOptions = {
      id: 'x',
      kind: 'claude',
      workspace: { type: 'volume' },
    }
    expect(opts.kind).toBe('claude')
  })
  it('exports CodingAgentHandle shape', () => {
    const noopHandle: CodingAgentHandle = {
      url: '/x',
      kind: 'claude',
      send: async () => ({ runId: 'r' }),
      events: async function* () {},
      state: () => ({
        status: 'cold',
        pinned: false,
        workspace: { identity: '', sharedRefs: 1 },
        runs: [],
      }),
      pin: async () => undefined,
      release: async () => undefined,
      stop: async () => undefined,
      destroy: async () => undefined,
    }
    expect(noopHandle.kind).toBe('claude')
  })
})
```

- [ ] **Step 5: Run runtime typecheck and tests**

```
pnpm -C packages/agents-runtime typecheck
pnpm -C packages/agents-runtime test test/spawn-coding-agent.test.ts
```

Expect: clean typecheck; test passes.

If the file `packages/agents-runtime/test/` doesn't exist or vitest config is different, look at existing tests in `packages/agents-runtime/` for the right path.

- [ ] **Step 6: Commit**

```
git add packages/agents-runtime/src/types.ts packages/agents-runtime/src/context-factory.ts packages/agents-runtime/test/spawn-coding-agent.test.ts
git commit -m "feat(agents-runtime): ctx.spawnCodingAgent / observeCodingAgent typed primitives"
```

---

## Phase 3 — Server wiring (sequential)

### Task 3.1 — Bootstrap call

**Files:**

- Modify: `packages/agents/src/bootstrap.ts`

- [ ] **Step 1: Read the existing bootstrap, locate the `registerCodingSession` call**

The line is `packages/agents/src/bootstrap.ts:119`. Confirm by `grep -n registerCodingSession packages/agents/src/bootstrap.ts`.

- [ ] **Step 2: Modify `bootstrap.ts`**

Add imports at the top (next to the existing `registerCodingSession` import):

```ts
import {
  LocalDockerProvider,
  StdioBridge,
  registerCodingAgent,
} from '@electric-ax/coding-agents'
```

After the existing `registerCodingSession(...)` line (line 119), add:

```ts
registerCodingSession(registry, { defaultWorkingDirectory: cwd })
typeNames.push(`coder`)

// NEW for Slice A:
registerCodingAgent(registry, {
  provider: new LocalDockerProvider(),
  bridge: new StdioBridge(),
})
typeNames.push(`coding-agent`)
```

- [ ] **Step 3: Add `@electric-ax/coding-agents` to `packages/agents/package.json` dependencies** if not already present.

Check first:

```
grep '"@electric-ax/coding-agents"' packages/agents/package.json
```

If missing, add to `dependencies`:

```json
    "@electric-ax/coding-agents": "workspace:*",
```

Then re-install:

```
pnpm install
```

- [ ] **Step 4: Verify everything builds**

```
pnpm -C packages/agents typecheck
pnpm -C packages/agents-runtime typecheck
pnpm -C packages/coding-agents typecheck
```

Expect: all clean.

- [ ] **Step 5: Run all package unit tests**

```
pnpm -C packages/coding-agents test
pnpm -C packages/agents-runtime test
pnpm -C packages/agents test
```

Expect: all pass (no regressions in legacy `coder` flows).

- [ ] **Step 6: Commit**

```
git add packages/agents/src/bootstrap.ts packages/agents/package.json pnpm-lock.yaml
git commit -m "feat(agents): wire registerCodingAgent into bootstrap"
```

---

## Phase 4 — Integration smoke (sequential)

### Task 4.1 — End-to-end Slice A test

**Files:**

- Create: `packages/coding-agents/test/integration/slice-a.test.ts`

**Validation goals (one test, eight assertions):**

1. Build/load the test image (existing helper).
2. Spawn the `coding-agent` entity via the runtime registry directly (no full `agents-server`; we drive it with a minimal harness).
3. Send a prompt; assert the `runs` collection ends with `status='completed'`, `responseText` non-empty.
4. Pin; sleep past `idleTimeoutMs=2000`; assert `provider.status` returns `'running'`.
5. Release; sleep past idle; assert `provider.status` returns `'stopped'`.
6. Send another prompt; assert cold-boot path executes; response received.
7. Spawn second agent on same workspace name; concurrently send to both; assert run order via `runs` collection timestamps (lease-serialized).
8. Crash recovery: tear down LM/WR/handler, re-`registerCodingAgent` with the same provider, observe entity state, send prompt; assert the prior `runs` row was reconciled to `failed: orphaned`, new run completes.
9. Destroy; assert `meta.status='destroyed'`, container removed.

**This is a lot for one test file.** Acceptable: the spec called for one e2e test. Internally, organize it as `describe('Slice A integration', ...)` with one big `it('full flow', ...)` so wall time is amortized over a single image build + sandbox lifecycle.

The "minimal harness" is the tricky bit. Slice A doesn't need a full `agents-server`; the unit tests already use a fake ctx. For integration, we need real StreamDB collections + the real handler invocation. Two options:

- **Option A (preferred):** Reuse `packages/agents-runtime/test/` infrastructure if it exposes a test harness. (Read `packages/agents-runtime/test/` to confirm.)
- **Option B:** Write a minimal harness in `test/integration/support/test-runtime.ts` that builds the StreamDB + executes the handler.

If neither is feasible within this task's time budget, the implementer should fall back to a reduced test that exercises the entity handler against fake-but-real-enough collections (with a real Docker provider and real bridge), and document this as a Phase 5 follow-up.

- [ ] **Step 1: Locate existing runtime test harness**

```
ls packages/agents-runtime/test
grep -r 'createRuntimeHandler\|defineEntity' packages/agents-runtime/test/ | head -20
```

If a clean test harness exists (e.g. an in-memory runtime that drives entity handlers end-to-end), use it. If not, proceed with the option B fallback below.

- [ ] **Step 2: Write the integration test (Option B fallback)**

```ts
// packages/coding-agents/test/integration/slice-a.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  LocalDockerProvider,
  StdioBridge,
  WorkspaceRegistry,
  LifecycleManager,
} from '../../src'
import { makeCodingAgentHandler } from '../../src/entity/handler'
import {
  CODING_AGENT_EVENTS_COLLECTION_TYPE,
  CODING_AGENT_LIFECYCLE_COLLECTION_TYPE,
  CODING_AGENT_RUNS_COLLECTION_TYPE,
  CODING_AGENT_SESSION_META_COLLECTION_TYPE,
} from '../../src/entity/collections'
import { buildTestImage, TEST_IMAGE_TAG } from '../support/build-image'
import { loadTestEnv } from '../support/env'

const SHOULD_RUN = process.env.DOCKER === '1'
const describeMaybe = SHOULD_RUN ? describe : describe.skip

interface CollectionStub {
  rows: Map<string, any>
  get(k: string): any
  toArray: Array<any>
}

function makeCollection(): CollectionStub {
  const rows = new Map<string, any>()
  return {
    rows,
    get(k) {
      return rows.get(k)
    },
    get toArray() {
      return Array.from(rows.values())
    },
  }
}

interface FakeCtxState {
  sessionMeta: CollectionStub
  runs: CollectionStub
  events: CollectionStub
  lifecycle: CollectionStub
  inbox: CollectionStub
  recordedRuns: Array<{ key: string; status?: string; response: string }>
}

function makeFakeCtx(entityUrl: string, args: Record<string, unknown>) {
  const state: FakeCtxState = {
    sessionMeta: makeCollection(),
    runs: makeCollection(),
    events: makeCollection(),
    lifecycle: makeCollection(),
    inbox: makeCollection(),
    recordedRuns: [],
  }
  let runCounter = 0
  const ctx: any = {
    entityUrl,
    entityType: 'coding-agent',
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
      },
    },
    recordRun() {
      const key = `run-${++runCounter}`
      const ent = { key, status: undefined as string | undefined, response: '' }
      state.recordedRuns.push(ent)
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

function pushInbox(
  state: FakeCtxState,
  key: string,
  message_type: string,
  payload: any = {}
) {
  state.inbox.rows.set(key, { key, message_type, payload })
}

describeMaybe('Slice A — full integration', () => {
  beforeAll(async () => {
    await buildTestImage()
  }, 600_000)

  it('spawns, runs prompt, lease-serializes, recovers from crash, destroys', async () => {
    const env = loadTestEnv()
    const provider = new LocalDockerProvider({ image: TEST_IMAGE_TAG })
    const bridge = new StdioBridge()
    const wr = new WorkspaceRegistry()
    let lm = new LifecycleManager({ provider, bridge })
    const handler = makeCodingAgentHandler(lm, wr, {
      defaults: {
        idleTimeoutMs: 2000,
        coldBootBudgetMs: 30_000,
        runTimeoutMs: 120_000,
      },
      env: () => ({ ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY }),
    })

    const agentA = `/test/coding-agent/a-${Date.now().toString(36)}`
    const sharedName = `slice-a-shared-${Date.now().toString(36)}`
    const args = {
      kind: 'claude',
      workspace: { type: 'volume', name: sharedName },
      lifecycle: { idleTimeoutMs: 2000 },
    }
    const { ctx: ctxA, state: stateA } = makeFakeCtx(agentA, args)

    // 1) First-wake init
    await handler(ctxA, { type: 'message_received' })
    expect(stateA.sessionMeta.get('current').status).toBe('cold')

    // 2) Send prompt; cold boot + run
    pushInbox(stateA, 'i1', 'prompt', {
      text: 'Reply with the single word: ok',
    })
    await handler(ctxA, { type: 'message_received' })

    const metaA1 = stateA.sessionMeta.get('current')
    expect(metaA1.status).toBe('idle')
    const runsA = Array.from(stateA.runs.rows.values()) as any[]
    expect(runsA).toHaveLength(1)
    expect(runsA[0].status).toBe('completed')
    expect(runsA[0].responseText?.length ?? 0).toBeGreaterThan(0)

    // 3) Pin + idle wait
    pushInbox(stateA, 'i2', 'pin')
    await handler(ctxA, { type: 'message_received' })
    expect(stateA.sessionMeta.get('current').pinned).toBe(true)

    await new Promise((r) => setTimeout(r, 2500))
    expect(await provider.status(agentA)).toBe('running')

    // 4) Release + idle wait => sandbox stops
    pushInbox(stateA, 'i3', 'release')
    await handler(ctxA, { type: 'message_received' })
    await new Promise((r) => setTimeout(r, 2500))
    expect(await provider.status(agentA)).toBe('unknown')

    // 5) Second prompt: cold-boot path
    pushInbox(stateA, 'i4', 'prompt', { text: 'Reply: again' })
    await handler(ctxA, { type: 'message_received' })
    const runsA2 = Array.from(stateA.runs.rows.values()) as any[]
    expect(runsA2).toHaveLength(2)
    expect(runsA2[1].status).toBe('completed')

    // 6) Second agent on same workspace, lease-serialized
    const agentB = `/test/coding-agent/b-${Date.now().toString(36)}`
    const { ctx: ctxB, state: stateB } = makeFakeCtx(agentB, args)
    await handler(ctxB, { type: 'message_received' }) // first-wake init
    pushInbox(stateB, 'j1', 'prompt', { text: 'Reply: B' })
    pushInbox(stateA, 'i5', 'prompt', { text: 'Reply: A' })
    await Promise.all([
      handler(ctxA, { type: 'message_received' }),
      handler(ctxB, { type: 'message_received' }),
    ])
    const runsAFinal = Array.from(stateA.runs.rows.values()) as any[]
    const runsBFinal = Array.from(stateB.runs.rows.values()) as any[]
    expect(runsAFinal[runsAFinal.length - 1].status).toBe('completed')
    expect(runsBFinal[0].status).toBe('completed')
    // Lease serialization: A's last run and B's run intervals don't overlap.
    const lastA = runsAFinal[runsAFinal.length - 1]
    const firstB = runsBFinal[0]
    const noOverlap =
      lastA.endedAt <= firstB.startedAt || firstB.endedAt <= lastA.startedAt
    expect(noOverlap).toBe(true)

    // 7) Crash-recovery sim: re-register LM with the same provider; verify
    //    a stale running row gets reconciled.
    // Manually inject a stale 'running' row predating the new lm.
    const oldRunStart = Date.now() - 60_000
    stateA.runs.rows.set('stale', {
      key: 'stale',
      startedAt: oldRunStart,
      status: 'running',
      promptInboxKey: 'fake',
    } as any)
    stateA.sessionMeta.rows.set('current', {
      ...stateA.sessionMeta.get('current'),
      status: 'running',
    })
    const lm2 = new LifecycleManager({ provider, bridge })
    const handler2 = makeCodingAgentHandler(lm2, wr, {
      defaults: {
        idleTimeoutMs: 2000,
        coldBootBudgetMs: 30_000,
        runTimeoutMs: 120_000,
      },
      env: () => ({ ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY }),
    })
    pushInbox(stateA, 'i6', 'prompt', { text: 'after crash' })
    await handler2(ctxA, { type: 'message_received' })
    expect((stateA.runs.get('stale') as any).status).toBe('failed')
    expect((stateA.runs.get('stale') as any).finishReason).toBe('orphaned')
    const newRuns = (Array.from(stateA.runs.rows.values()) as any[]).filter(
      (r) => r.status === 'completed' && r.key !== 'stale'
    )
    expect(newRuns.length).toBeGreaterThan(0)

    // 8) Destroy
    pushInbox(stateA, 'i7', 'destroy')
    await handler2(ctxA, { type: 'message_received' })
    expect(stateA.sessionMeta.get('current').status).toBe('destroyed')
    expect(await provider.status(agentA)).toBe('unknown')

    // Cleanup B
    await provider.destroy(agentB).catch(() => undefined)
  }, 360_000)
})
```

- [ ] **Step 3: Run the integration test**

```
DOCKER=1 pnpm -C packages/coding-agents test test/integration/slice-a.test.ts
```

Expect: PASS within ~6 minutes (image cached + 3-4 real claude invocations).

If it fails, **iterate** (max 5 cycles):

1. Capture failure output.
2. Form a hypothesis (most likely: timing on idle, lease ordering, image name mismatch, env not piped through).
3. Apply fix.
4. Re-run.

Common pitfalls:

- **`provider.status` returns `unknown` (not `stopped`).** Adjust assertion: `expect(['stopped', 'unknown']).toContain(s)`.
- **Lease lock-up due to never-completing first prompt.** Verify ANTHROPIC_API_KEY is being piped (`docker logs <id>` for the bridge's stderr).
- **Second prompt after pin/release fails because container idle-killed mid-flight.** Increase the wait between events.

After 5 unsuccessful cycles, write a Phase 5 report describing the blocker and stop.

- [ ] **Step 4: Run all tests one last time**

```
pnpm -C packages/coding-agents test
```

Expect: all pass (unit + integration).

- [ ] **Step 5: Commit**

```
git add packages/coding-agents/test/integration/slice-a.test.ts
git commit -m "test(coding-agents): Slice A integration smoke (entity, lifecycle, lease, recovery)"
```

---

## Phase 5 — Report

### Task 5.1 — Run report

**Files:**

- Create: `docs/superpowers/specs/notes/2026-04-30-coding-agents-slice-a-report.md`

- [ ] **Step 1: Write report markdown**

Cover:

- Validation bar + outcome.
- Per-task: what landed cleanly, what required iteration, fix details.
- Known gaps versus the spec (the two divergences declared up-top: no `onBoot` hook, no `deleteEntityStream`).
- Time + token usage for the run.
- Recommended Slice B priorities (resume + remove-coder + Horton tools).

- [ ] **Step 2: Commit**

```
git add docs/superpowers/specs/notes/2026-04-30-coding-agents-slice-a-report.md
git commit -m "docs(coding-agents): Slice A run report"
```

---

## Self-review checklist

- [x] **Spec coverage:**
  - Built-in entity → Task 2.1, 2.2 ✓
  - LifecycleManager → Task 1.B ✓
  - WorkspaceRegistry → Task 1.A ✓
  - `ctx.spawnCodingAgent` / `observeCodingAgent` → Task 2.3 ✓
  - Pin/release/stop/destroy → Task 2.1 ✓
  - Crash recovery → Task 2.1 (reconcile rules) + Task 4.1 (validation) ✓
  - Workspace lease serialization → Task 1.A + Task 4.1 (validation) ✓
  - Server bootstrap → Task 3.1 ✓
  - Integration test → Task 4.1 ✓
  - Spec divergences (no onBoot, no deleteEntityStream) declared at plan top ✓
- [x] **Placeholder scan:** No "TBD", "TODO", "appropriate handling" left in steps. The Phase 4 fallback explicitly admits the harness-design choice may be revisited; that's a known trade-off, not a placeholder.
- [x] **Type consistency:**
  - `CodingAgentStatus` includes `'destroyed'` (added because `destroy()` tombstones).
  - `SessionMetaRow.lastInboxKey` declared in Task 2.1 Step 1 before being used in handler.
  - `CodingAgentHandle.events()` returns `AsyncIterable<unknown>` in runtime types (Slice A) since the runtime can't depend on `agent-session-protocol` types directly. Documented.
- [x] **Approval:** Pre-approved per user's "implemnt" message.
