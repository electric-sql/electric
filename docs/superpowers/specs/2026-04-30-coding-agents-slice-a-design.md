# Coding Agents — Slice A: Runtime API + Built-in Entity + Lifecycle

**Status:** Draft
**Date:** 2026-04-30
**Author:** Valter Balegas
**Parent spec:** `docs/superpowers/specs/2026-04-30-coding-agents-platform-primitive-design.md`
**Predecessor:** `docs/superpowers/specs/notes/2026-04-30-coding-agents-mvp-report.md` (the Provider + Bridge MVP)

## Summary

Slice A is the second iteration of the coding-agents platform primitive. The MVP shipped a `LocalDockerProvider` and a `StdioBridge` in `@electric-ax/coding-agents`. Slice A wires those into a first-class runtime primitive: a built-in `coding-agent` entity, a `LifecycleManager` that runs the state machine, a `WorkspaceRegistry` that serializes shared volumes, and the typed `ctx.spawnCodingAgent` / `ctx.observeCodingAgent` API on `HandlerContext`.

After Slice A, an entity author can write `await ctx.spawnCodingAgent({ kind: 'claude', workspace: { type: 'volume' }, initialPrompt: 'fix the bug' })`, await a `runFinished` wake on the parent with the response text, and exercise pin/release/stop/destroy lifecycle controls — all backed by a Docker sandbox with proper crash recovery.

The legacy `coder` entity (`packages/agents/src/agents/coding-session.ts`) is **not** removed in Slice A; it coexists under a different entity type name and disjoint collection-type wires. Removal is Slice B.

## Goals

1. **Typed primitive on `ctx`.** `ctx.spawnCodingAgent({ ... })` returns a `CodingAgentHandle`. Mirrors the existing `ctx.useCodingAgent` pattern (typed wrapper over `ctx.spawn(<type>, ...)`).
2. **Built-in entity.** A `coding-agent` entity type registered at server bootstrap, with `sessionMeta` / `runs` / `events` / `lifecycle` collections. Authors cannot `defineEntity('coding-agent', …)`.
3. **Lifecycle correctness.** The 6-state machine (`cold` / `starting` / `idle` / `running` / `stopping` / `error`) is enforced. Idle hibernation works. Pin/release works.
4. **Multi-agent ready.** Two agents on the same workspace identity coexist while idle and serialize at `runTurn` boundaries.
5. **Crash-recoverable.** Server restart adopts running containers via `provider.recover()`. Orphaned in-flight runs are reconciled to `failed` on the next handler entry. **Goal: dev iteration doesn't require manual `docker rm` between server restarts.**
6. **Test coverage.** Unit suite for `LifecycleManager` + `WorkspaceRegistry` + entity handler. One real-Docker integration test exercising the full flow including crash recovery and lease serialization.

## Non-goals (Slice A)

- **Resume.** `nativeJsonl` collection writes, `--resume <id>` plumbing, cold-boot tmpfs materialization. Each cold boot starts a fresh CLI session. **(Slice B.)**
- **Codex support.** Bridge still rejects `kind: 'codex'`. **(Slice C.)**
- **Removing the legacy `coder` entity** + its tools (`spawn-coder.ts`, `prompt-coder.ts`). **(Slice B.)**
- **New Horton tools** (`spawn_coding_agent`, `prompt_coding_agent`). **(Slice B.)**
- **UI extensions** — status enum extension, header sandbox provenance, pin/release/stop buttons, lifecycle row rendering. **(Slice C.)**
- **Conformance suite** parameterized by `SandboxProvider`. **(Slice C.)**
- **`wake.on: 'eventAppended'`.** Slice A wakes only on `runFinished`. (No streaming UI consumer yet.)
- **`sandbox?` provider override on `SpawnCodingAgentOptions`.** Only one provider exists.
- **Per-event approve/deny for `permission_request`.** CLIs run with `--dangerously-skip-permissions`.

## Architecture

```
                              Entity author code
   ┌──────────────────────────────────────────────────────────────┐
   │  ctx.spawnCodingAgent({ kind, workspace, ... })              │  ← @electric-ax/agents-runtime
   │  ctx.observeCodingAgent(id)                                  │
   └──────────────────────────────────────────────────────────────┘
                                  │ desugars to ctx.spawn('coding-agent', ...)
                                  ▼
   ┌──────────────────────────────────────────────────────────────┐
   │  Built-in `coding-agent` entity (registerCodingAgent)        │  ← @electric-ax/coding-agents
   │  · handler.ts drives the state machine                       │
   │  · collections: sessionMeta, runs, events, lifecycle         │
   │  · inbox messages: prompt | pin | release | stop | destroy   │
   └──────────────────────────────────────────────────────────────┘
                                  │ closure-scoped deps
                                  ▼
   ┌─────────────────────────┐   ┌─────────────────────────────────┐
   │  Bridge (StdioBridge)   │   │  LifecycleManager               │
   │  runTurn → events       │   │  · in-process state             │
   │  (Slice MVP)            │   │  · idle timer (setTimeout)      │
   └─────────────────────────┘   │  · pin refcount (in-memory)     │
              │                  │  · armIdleTimer/ensureRunning   │
              │                  └─────────────────────────────────┘
              │                                  │
              │                                  ▼
              │                  ┌─────────────────────────────────┐
              │                  │  WorkspaceRegistry              │
              │                  │  · identity → ref-set           │
              │                  │  · per-identity mutex (acquire) │
              │                  └─────────────────────────────────┘
              ▼
   ┌──────────────────────────────────────────────────────────────┐
   │  SandboxProvider (LocalDockerProvider — Slice MVP)           │
   │  · recover() returns adopted containers on server boot       │
   └──────────────────────────────────────────────────────────────┘
```

### Package boundary rules

- `@electric-ax/agents-runtime` knows the entity _type name_ `'coding-agent'` and the _handle shape_ `CodingAgentHandle`. **Does not** import `@electric-ax/coding-agents`.
- `@electric-ax/coding-agents` is the only place Docker / CLI / lifecycle logic lives. Owns `LifecycleManager`, `WorkspaceRegistry`, the entity handler, and the registration helper.
- `agents-server` bootstrap is the seam: it instantiates `LocalDockerProvider` + `StdioBridge`, calls `registerCodingAgent(registry, { provider, bridge })`, and proceeds.
- The legacy `coder` entity coexists. Different entity type name (`'coding-agent'` vs `'coder'`); disjoint collection-type wires (`CODING_AGENT_*_COLLECTION_TYPE`).

## File layout

```
packages/coding-agents/                  ← extend existing
├── src/
│   ├── index.ts                         ← +export registerCodingAgent and new types
│   ├── types.ts                         ← +SpawnCodingAgentOptions, CodingAgentStatus, RunSummary
│   ├── providers/local-docker.ts        ← (existing) +recover() filter on agentId prefix
│   ├── bridge/stdio-bridge.ts           ← (existing)
│   ├── lifecycle-manager.ts             ← NEW
│   ├── workspace-registry.ts            ← NEW
│   ├── log.ts                           ← (existing)
│   └── entity/
│       ├── register.ts                  ← NEW: registerCodingAgent(registry, deps)
│       ├── handler.ts                   ← NEW: the entity handler
│       ├── collections.ts               ← NEW: schemas + collection-type wire constants
│       └── messages.ts                  ← NEW: inbox message types and zod schemas
└── test/
    ├── unit/
    │   ├── lifecycle-manager.test.ts    ← NEW
    │   ├── workspace-registry.test.ts   ← NEW
    │   ├── entity-handler.test.ts       ← NEW
    │   └── (existing unit tests stay)
    └── integration/
        ├── smoke.test.ts                ← (existing — kept)
        └── slice-a.test.ts              ← NEW: full e2e

packages/agents-runtime/
└── src/
    ├── types.ts                         ← +HandlerContext.spawnCodingAgent / observeCodingAgent
    ├── context-factory.ts               ← +spawnCodingAgent / observeCodingAgent impl
    └── (CodingAgentHandle co-located in types.ts)

packages/agents-server/
└── src/entrypoint-lib.ts (or wherever bootstrap lives)
                                         ← +call registerCodingAgent(registry, { provider, bridge })

packages/agents/                         ← UNCHANGED in Slice A
```

## Public types

### Runtime API (added to `HandlerContext`)

```ts
// packages/agents-runtime/src/types.ts

interface HandlerContext {
  // ... existing fields

  spawnCodingAgent(opts: SpawnCodingAgentOptions): Promise<CodingAgentHandle>
  observeCodingAgent(id: string): Promise<CodingAgentHandle>
}

interface SpawnCodingAgentOptions {
  /** Stable id, scoped to the spawning entity. */
  id: string

  /** Slice A: 'claude' only. */
  kind: 'claude'

  /**
   * Workspace mount. Identity is the lease key:
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

interface CodingAgentHandle {
  /** Stable URL: /coding-agent/<id> */
  readonly url: string
  readonly kind: 'claude'

  /** Queue a prompt. Resolves once durably enqueued. */
  send(prompt: string): Promise<{ runId: string }>

  /**
   * Async iterable over normalized events for this agent.
   * `since: 'start'` replays from the first persisted event.
   * `since: 'now'` (default) tails from the current tail.
   */
  events(opts?: { since?: 'start' | 'now' }): AsyncIterable<NormalizedEvent>

  /** Sync snapshot. */
  state(): {
    status: 'cold' | 'starting' | 'idle' | 'running' | 'stopping' | 'error'
    pinned: boolean
    workspace: { identity: string; sharedRefs: number }
    lastError?: string
    runs: ReadonlyArray<RunSummary>
  }

  pin(): Promise<void>
  release(): Promise<void>
  stop(): Promise<void>
  destroy(): Promise<void>
}

interface RunSummary {
  runId: string
  startedAt: number
  endedAt?: number
  status: 'running' | 'completed' | 'failed'
  promptInboxKey: string
  responseText?: string
}
```

### Inbox messages (entity-internal)

```ts
// packages/coding-agents/src/entity/messages.ts

type CodingAgentInboxMessage =
  | { type: 'prompt'; text: string }
  | { type: 'pin' }
  | { type: 'release' }
  | { type: 'stop' }
  | { type: 'destroy' }
```

`CodingAgentHandle.send(prompt)` desugars to `{ type: 'prompt', text: prompt }`. `pin/release/stop/destroy` desugar to their respective bare-message types. Each is dispatched on the entity inbox via the runtime's existing `ctx.send(entityUrl, message)` machinery.

### Collections

```ts
// packages/coding-agents/src/entity/collections.ts

export const CODING_AGENT_SESSION_META_COLLECTION_TYPE =
  'coding-agent.sessionMeta'
export const CODING_AGENT_RUNS_COLLECTION_TYPE = 'coding-agent.runs'
export const CODING_AGENT_EVENTS_COLLECTION_TYPE = 'coding-agent.events'
export const CODING_AGENT_LIFECYCLE_COLLECTION_TYPE = 'coding-agent.lifecycle'

interface SessionMetaRow {
  key: 'current'
  status: 'cold' | 'starting' | 'idle' | 'running' | 'stopping' | 'error'
  kind: 'claude'
  pinned: boolean
  workspaceIdentity: string // 'volume:foo' | 'bindMount:/abs/p'
  workspaceSpec: // raw input, for re-resolve on rehydrate
  | { type: 'volume'; name: string } // resolved name (may equal agentId)
    | { type: 'bindMount'; hostPath: string }
  idleTimeoutMs: number
  keepWarm: boolean
  instanceId?: string // current sandbox instance, when present
  lastError?: string
  currentPromptInboxKey?: string
}

interface RunRow {
  key: string // runId (nanoid)
  startedAt: number
  endedAt?: number
  status: 'running' | 'completed' | 'failed'
  finishReason?: string // 'cli-exit-N' | 'timeout' | 'orphaned' | 'stopped'
  promptInboxKey: string
  responseText?: string
}

interface EventRow {
  key: string // <runId>:<seq>
  runId: string
  seq: number
  ts: number
  type: NormalizedEvent['type']
  payload: NormalizedEvent
}

interface LifecycleRow {
  key: string // <runId>:<event>:<seq> (or 'startup:<n>' for non-run)
  ts: number
  event:
    | 'sandbox.starting'
    | 'sandbox.started'
    | 'sandbox.stopped'
    | 'sandbox.failed'
    | 'pin'
    | 'release'
    | 'orphan.detected'
  detail?: string
}
```

The `lifecycle` collection is **separate** from `events` because lifecycle rows are infrastructure provenance, not conversation history. Slice C will render them as muted timeline rows; Slice A persists them anyway so the data is there when the UI lands.

## Component design

### `LifecycleManager` — `src/lifecycle-manager.ts`

In-process singleton, instantiated once per `registerCodingAgent` call. Owned by the registration helper's closure.

```ts
class LifecycleManager {
  constructor(deps: { provider: SandboxProvider; bridge: Bridge })

  // Sandbox lifecycle (called by handler)
  async ensureRunning(spec: SandboxSpec): Promise<SandboxInstance>
  async stop(agentId: string): Promise<void>
  async destroy(agentId: string): Promise<void>

  // Idle timer (in-memory)
  armIdleTimer(agentId: string, ms: number, onFire: () => void): void
  cancelIdleTimer(agentId: string): void

  // Pin refcount (in-memory; durable boolean is sessionMeta.pinned)
  pin(agentId: string): { count: number }
  release(agentId: string): { count: number }
  pinCount(agentId: string): number
  resetPinCount(agentId: string): void // called on registration helper boot

  // Recovery
  async adoptRunningContainers(): Promise<RecoveredSandbox[]> // wraps provider.recover()
}
```

**`onFire` callback** is how the LM tells the handler to do post-timeout work. Since the handler can't run between invocations, the callback's job is to:

- Call `provider.stop(instanceId)` (this is the LM's own job, actually — runs synchronously on timer fire).
- Optionally enqueue an inbox `_idle_fired` self-message **(NOT done in Slice A)** — instead, the next real handler invocation reconciles via `provider.status()`.

So in practice `onFire` just emits a log and updates an in-memory `Map<agentId, 'cold'>` shadow. The handler's reconcile step queries the provider directly on next entry. **No out-of-handler stream writes.**

**`pinCount` is in-memory.** On server restart, all pin counts reset to 0. Holders that wanted to keep their pins must re-pin. `sessionMeta.pinned` is `pinCount > 0`.

### `WorkspaceRegistry` — `src/workspace-registry.ts`

In-process singleton. Two responsibilities: refcount tracking, per-identity mutex.

```ts
class WorkspaceRegistry {
  /** Resolve a SpawnCodingAgentOptions.workspace into a stable identity. */
  static async resolveIdentity(
    agentId: string,
    spec: SpawnCodingAgentOptions['workspace']
  ): Promise<{ identity: string; resolved: ResolvedWorkspaceSpec }>

  // Refcount
  register(identity: string, agentId: string): void
  release(identity: string, agentId: string): void
  refs(identity: string): number

  // Per-identity mutex
  acquire(identity: string): Promise<() => void> // returns release fn

  // Bulk rebuild on server boot
  rebuild(snapshots: Array<{ identity: string; agentId: string }>): void
}
```

**Mutex implementation.** A simple `Map<identity, Promise>`: `acquire` chains a new promise; the returned release fn resolves the chain. Unbounded queue; FIFO ordering.

**`rebuild`** is called by the registration helper at boot, after the helper scans existing `coding-agent` entities' `sessionMeta.workspaceIdentity`. Pending mutex waiters from before the restart are not preserved (no work was lost — they were waiting between turns).

### Entity handler — `src/entity/handler.ts`

Single function, ~250 LOC. Pseudocode (Slice A):

The `lm` and `wr` are closed over by the handler at registration time — see `registerCodingAgent` below. They are **not** added to `HandlerContext`; only the entity-handler closure references them.

```ts
function makeCodingAgentHandler(lm: LifecycleManager, wr: WorkspaceRegistry) {
  return async function handleCodingAgentEntity(
    ctx: HandlerContext,
    wake: Wake
  ) {
    const agentId = ctx.entityUrl
    const meta = await ctx.collections.sessionMeta.get('current')

    // (1) RECONCILE — apply the table rules from §Lifecycle state machine
    if (meta) {
      await reconcile(ctx, lm, meta)
    }

    // (2) DISPATCH
    switch (wake.message.type) {
      case 'prompt':
        return processPrompt(ctx, lm, wr, wake.message)
      case 'pin':
        return processPin(ctx, lm, agentId)
      case 'release':
        return processRelease(ctx, lm, agentId)
      case 'stop':
        return processStop(ctx, lm, agentId)
      case 'destroy':
        return processDestroy(ctx, lm, wr, agentId)
    }
  }
}
```

`reconcile()` reads `provider.status(agentId)` and the open `runs` row, then applies the table to update `sessionMeta` and (if orphaned) the run row + a `lifecycle` row. It is the single durable side-effect path on entry.

`processPrompt` is the heavy one:

```ts
async function processPrompt(
  ctx: HandlerContext,
  lm: LifecycleManager,
  wr: WorkspaceRegistry,
  msg: { type: 'prompt'; text: string; _inboxKey: string }
) {
  const agentId = ctx.entityUrl
  const meta = await ctx.collections.sessionMeta.get('current') // !undefined post-init
  const env = bridgeEnvFromServerConfig() // ANTHROPIC_API_KEY etc., from server bootstrap

  // Cold-boot: ensure sandbox started
  await ctx.collections.sessionMeta.update('current', { status: 'starting' })
  await ctx.collections.lifecycle.insert({
    event: 'sandbox.starting',
    ts: Date.now(),
    key: `boot:${Date.now()}`,
  })

  let sandbox: SandboxInstance
  try {
    sandbox = await raceTimeout(
      lm.ensureRunning({
        agentId,
        kind: meta.kind,
        workspace: meta.workspaceSpec,
        env,
      }),
      coldBootBudgetMs
    )
  } catch (err) {
    await ctx.collections.sessionMeta.update('current', {
      status: 'error',
      lastError: String(err),
    })
    await ctx.collections.lifecycle.insert({
      event: 'sandbox.failed',
      ts: Date.now(),
      key: `boot:${Date.now()}`,
      detail: String(err),
    })
    return
  }

  await ctx.collections.sessionMeta.update('current', {
    status: 'idle',
    instanceId: sandbox.instanceId,
  })
  await ctx.collections.lifecycle.insert({
    event: 'sandbox.started',
    ts: Date.now(),
    key: `boot:${Date.now()}`,
  })

  // Acquire workspace lease (waits if another agent holds it)
  const releaseLease = await wr.acquire(meta.workspaceIdentity)

  try {
    await ctx.collections.sessionMeta.update('current', {
      status: 'running',
      currentPromptInboxKey: msg._inboxKey,
    })
    const run = ctx.recordRun()
    const runId = run.key
    await ctx.collections.runs.insert({
      key: runId,
      startedAt: Date.now(),
      status: 'running',
      promptInboxKey: msg._inboxKey,
    })

    let seq = 0
    try {
      const result = await raceTimeout(
        lm.bridge.runTurn({
          sandbox,
          kind: meta.kind,
          prompt: msg.text,
          onEvent: async (e) => {
            await ctx.collections.events.insert({
              key: `${runId}:${seq}`,
              runId,
              seq,
              ts: Date.now(),
              type: e.type,
              payload: e,
            })
            seq++
          },
        }),
        runTimeoutMs
      )
      await ctx.collections.runs.update(runId, {
        status: 'completed',
        endedAt: Date.now(),
        responseText: result.finalText,
      })
      run.attachResponse(result.finalText ?? '')
      run.end({ status: 'completed' })
    } catch (err) {
      const reason =
        err.name === 'TimeoutError'
          ? 'timeout'
          : `cli-exit:${String(err).slice(0, 200)}`
      await ctx.collections.runs.update(runId, {
        status: 'failed',
        endedAt: Date.now(),
        finishReason: reason,
      })
      await ctx.collections.sessionMeta.update('current', {
        status: 'error',
        lastError: String(err),
      })
      run.end({ status: 'failed' })
      return
    }

    await ctx.collections.sessionMeta.update('current', {
      status: 'idle',
      currentPromptInboxKey: undefined,
    })
    if (!meta.keepWarm) {
      lm.armIdleTimer(agentId, meta.idleTimeoutMs, () =>
        lm.provider.stop(sandbox.instanceId)
      )
    }
  } finally {
    releaseLease()
  }
}
```

`processPin`, `processRelease` manage the LM's in-memory refcount and idle timer; update `sessionMeta.pinned`. `processStop` calls `lm.stop`, sets `status='cold'`. `processDestroy` calls `lm.destroy`, `wr.release`, then `ctx.deleteEntityStream()`.

### Runtime helper — `packages/agents-runtime/src/context-factory.ts`

Mirrors the existing `useCodingAgent` (lines 561-629 of `context-factory.ts`):

```ts
async function spawnCodingAgent(
  ctx,
  opts: SpawnCodingAgentOptions
): Promise<CodingAgentHandle> {
  const handle = await ctx.spawn(
    'coding-agent',
    opts.id,
    {
      kind: opts.kind,
      workspace: opts.workspace,
      lifecycle: opts.lifecycle,
    },
    {
      initialMessage: opts.initialPrompt
        ? { type: 'prompt', text: opts.initialPrompt }
        : undefined,
      wake: opts.wake ?? { on: 'runFinished', includeResponse: true },
    }
  )
  return makeHandle(ctx, handle.url)
}

async function observeCodingAgent(ctx, id: string): Promise<CodingAgentHandle> {
  const url = scopedUrl(ctx, 'coding-agent', id)
  await ctx.observe(url)
  return makeHandle(ctx, url)
}

function makeHandle(ctx, url: string): CodingAgentHandle {
  return {
    url,
    kind: 'claude',
    send: (text) => ctx.send(url, { type: 'prompt', text }),
    pin: () => ctx.send(url, { type: 'pin' }),
    release: () => ctx.send(url, { type: 'release' }),
    stop: () => ctx.send(url, { type: 'stop' }),
    destroy: () => ctx.send(url, { type: 'destroy' }),
    state: () => readState(ctx, url),
    events: (o) => tailEvents(ctx, url, o?.since ?? 'now'),
  }
}
```

The `state()` reader needs `WorkspaceRegistry.refs(identity)`, which is in-process state on `agents-server`. The runtime accesses it via a small reader function injected at server bootstrap (one-line dependency on the server side; runtime exposes a setter). On the client side, `state().workspace.sharedRefs` falls back to `1` (the agent itself). Slice A documents this client/server asymmetry; Slice C may surface a server-side query API.

### Registration helper — `src/entity/register.ts`

```ts
export interface RegisterCodingAgentDeps {
  provider: SandboxProvider
  bridge: Bridge
  /** Override defaults; used by tests. */
  defaults?: {
    idleTimeoutMs?: number
    coldBootBudgetMs?: number
    runTimeoutMs?: number
  }
}

export function registerCodingAgent(
  registry: EntityRegistry,
  deps: RegisterCodingAgentDeps
): void {
  const lm = new LifecycleManager(deps)
  const wr = new WorkspaceRegistry()
  registry.define('coding-agent', {
    collections: { sessionMeta, runs, events, lifecycle },
    inboxSchema: codingAgentInboxSchema,
    handler: makeCodingAgentHandler(lm, wr),
    onBoot: async ({ scanEntities }) => {
      // Rebuild workspace registry from durable state
      const all = await scanEntities('coding-agent')
      wr.rebuild(
        all.map((e) => ({
          identity: e.sessionMeta.workspaceIdentity,
          agentId: e.url,
        }))
      )
      // Adopt running containers; do not write durable state —
      // reconcile happens on next handler entry per agent.
      await lm.adoptRunningContainers()
    },
  })
}
```

**`onBoot` hook.** Slice A introduces a per-type `onBoot` hook on the registry definition. It receives a small context with `scanEntities(type)` (returns the per-entity sessionMeta + url for all entities of `type`). The hook is fired once per server process at registry initialization, before any handler runs.

If the existing `EntityRegistry` doesn't have this hook, Slice A adds it (one method on `define-entity.ts`, one boot-time call in `electric-agents-manager.ts`). Confirmed scope-add during writing-plans by reading those files. (Listed under §Open questions for explicit confirmation.)

## Lifecycle state machine

```
                    ┌──────────┐
        spawn ─────▶│   COLD   │◀── reconcile: provider says stopped
                    └────┬─────┘
                         │ prompt
                         ▼
                    ┌──────────┐
                    │ STARTING │  provider.start (idempotent; reattach if running)
                    └────┬─────┘
       cold-boot timeout │ ready
              ┌──────────┴──────────┐
              ▼                     ▼
         ┌────────┐            ┌──────────┐
         │ ERROR  │            │   IDLE   │◀───────┐
         └────┬───┘            └────┬─────┘        │
              │ next prompt         │ prompt        │ runTurn
              ▼                     ▼               │ done
         ┌────────┐            ┌──────────┐         │
         │  COLD  │◀─────┐     │ RUNNING  │─────────┘
         └────────┘      │     └────┬─────┘
                         │          │ stop/destroy
                         │          ▼
                         │     ┌──────────┐
                         │     │ STOPPING │  SIGTERM → SIGKILL after 5s
                         └─────└──────────┘
                         idle-timer fire
                         (provider.stop direct)
```

**Reconcile rules** (every handler entry, before dispatch). The handler queries `provider.status(agentId)` and inspects the open `runs` row (if any), then applies:

```
let openRun = await runs.findOpen()                      // status === 'running' && !endedAt
let isOrphaned = openRun && openRun.startedAt < lm.startedAtMs
                                                          // run started before THIS process started
                                                          // ⇒ left over from a prior process
```

| Durable `meta.status`  | `provider.status()`   | `isOrphaned`? | Action                                                                      |
| ---------------------- | --------------------- | ------------- | --------------------------------------------------------------------------- |
| `running`              | `running`             | true          | mark openRun `failed: orphaned`; `meta.status='idle'` (sandbox kept)        |
| `running`              | `running`             | false         | leave (genuinely in-flight in this process)                                 |
| `running`              | `stopped` / `unknown` | n/a           | mark openRun `failed: orphaned`; `meta.status='cold'`; clear `instanceId`   |
| `idle`                 | `stopped`             | n/a           | `meta.status='cold'`; clear `instanceId` (idle timer fired between entries) |
| `idle`                 | `running`             | n/a           | leave                                                                       |
| `cold`                 | `running`             | n/a           | leave (orphaned container; cleaned on next stop/destroy)                    |
| `cold`                 | `stopped` / `unknown` | n/a           | leave                                                                       |
| `error`                | any                   | n/a           | leave; next `prompt` retries `start`                                        |
| `starting`, `stopping` | `running`             | n/a           | `meta.status='idle'`                                                        |
| `starting`, `stopping` | `stopped` / `unknown` | n/a           | `meta.status='cold'`                                                        |

`lm.startedAtMs` is the wall-clock millisecond timestamp captured when the `LifecycleManager` is instantiated (i.e., at server boot). Any `runs` row with `startedAt < lm.startedAtMs` and `status='running'` definitionally cannot be tracked by the current process.

## Workspace identity & lease

| Spec input                           | Identity                  |
| ------------------------------------ | ------------------------- |
| `{ type: 'volume', name: 'foo' }`    | `volume:foo`              |
| `{ type: 'volume' }` (no name)       | `volume:<agentId>`        |
| `{ type: 'bindMount', hostPath: P }` | `bindMount:<realpath(P)>` |

Stored on `sessionMeta.workspaceIdentity` so it survives reconcile and server restart.

**Ref tracking.** `WorkspaceRegistry.register(identity, agentId)` is called once per agent during `processPrompt`'s cold-boot path (idempotent). Decremented in `processDestroy`. Consumed by `state().workspace.sharedRefs`.

**Mutex.** `acquire(identity)` returns a release fn. Held only across `bridge.runTurn`. Two `IDLE` agents on the same identity coexist freely; only `RUNNING` is serialized.

**Lease wait is unbounded in Slice A.** No deadlock possible — every holder finishes a turn (timeout or completion). Acceptable for dev workloads. A bound can be added later.

## Crash recovery

**On `agents-server` boot** (`registerCodingAgent.onBoot`):

1. Scan all `coding-agent` entities, rebuild `WorkspaceRegistry`.
2. Call `provider.recover()` → list of `{ agentId, instanceId, status }`.
3. Do **not** mutate durable state at this point. The first handler entry per agent does it.

**On first handler entry per agent after restart** — the reconcile step (see the table in §Lifecycle state machine) handles all cases. The two crash-relevant rows are:

- `meta=running, provider=running, isOrphaned=true` → mark orphan, transition to `idle`. The container is still up; the bridge handle from the dead process is gone. Next prompt re-execs.
- `meta=running, provider=stopped/unknown` → mark orphan, transition to `cold`. Next prompt cold-boots a fresh container.

**Validation:** the integration test simulates server restart by tearing down the LM/registry and re-creating from scratch with the container still running.

## Defaults

| Setting            | Default              |
| ------------------ | -------------------- |
| `idleTimeoutMs`    | 5 × 60 000 (5 min)   |
| `coldBootBudgetMs` | 30 000               |
| `runTimeoutMs`     | 30 × 60 000 (30 min) |
| `keepWarm`         | `false`              |

All overridable per-spawn via `lifecycle?:` and via `RegisterCodingAgentDeps.defaults` for tests.

## Error handling

- **`provider.start` fails / cold-boot timeout** → `meta.status='error'`, `lastError=msg`, force-remove partial container. Next prompt retries.
- **`bridge.runTurn` non-zero exit** → run `failed: cli-exit:<msg>`, `meta.status='error'`. Sandbox kept up.
- **Run timeout** → `kill('SIGTERM')`, 5 s grace, `kill('SIGKILL')`. Run `failed: timeout`. Sandbox kept up.
- **Sandbox crashes mid-turn** (container dies) → bridge throws on stream close → run `failed: cli-exit:<msg>`. Reconcile on next entry sets cold.
- **Server crashes mid-turn** → orphan reconcile on next handler entry.
- **Lease wait** → unbounded. Documented.
- **`stop()` while running** → SIGTERM exec; `provider.stop`; release lease. Run `failed: stopped`.
- **`destroy()` while running** → `stop()` then `provider.destroy(agentId)`; `wr.release`; `ctx.deleteEntityStream()`. Idempotent on partial failure.

## Testing strategy

### Layer 1 — Unit (no Docker)

- **`lifecycle-manager.test.ts`** — state transitions through cold/starting/idle/running, idle timer arm/cancel, pin refcount (n pins need n releases, idle timer suspended while pinned), error transition. Backed by `FakeSandboxProvider` + `FakeBridge` (in-memory, scripted).
- **`workspace-registry.test.ts`** — three identity resolutions, refcount add/sub, mutex serialization (assert only one `acquire` resolved at a time), realpath on bindMount, `rebuild` from snapshot.
- **`entity-handler.test.ts`** — per-message dispatch (prompt/pin/release/stop/destroy do the right ops), reconcile-on-entry across the matrix above, durable-status reconciliation when provider says `stopped`.
- **`runtime-handle.test.ts`** (`packages/agents-runtime/test/`) — `ctx.spawnCodingAgent` desugars correctly, handle methods desugar to inbox messages, `state()` reads three collections.

Vitest. Sub-second per file.

### Layer 2 — Integration (real Docker, real Claude)

Single file `slice-a.test.ts`. Reuses the existing test image. Gated by `DOCKER=1`. ~3 min wall time target.

Sequence:

1. Bootstrap a minimal `agents-server` instance with `registerCodingAgent` wired in.
2. Spawn parent test entity that calls `ctx.spawnCodingAgent({ kind: 'claude', workspace: { type: 'volume' }, initialPrompt: 'reply: ok' })` and awaits `runFinished` wake. Assert response text matches.
3. Call `handle.pin()`, sleep past `idleTimeoutMs=2s` (overridden), assert `provider.status === 'running'`.
4. Call `handle.release()`, sleep past idle, assert `provider.status === 'stopped'`.
5. Call `handle.send('reply: again')`, assert cold-boot path executes, response received.
6. Spawn second agent on same workspace name; concurrently send prompts to both; assert second agent's run starts only after first's run ends (lease serialization).
7. Mid-turn, `provider.stop` the container directly; assert run flips to `failed`; next prompt works.
8. Server-restart simulation: dispose LM/registry/handle, re-`registerCodingAgent`, re-acquire handle via `observeCodingAgent`; assert `recover()` finds the container, orphan-run is detected on next handler entry, fresh prompt succeeds.
9. `handle.destroy()`; assert container removed, volume removed (no other refs), entity stream gone.

### Out of Slice A

- No conformance suite (Slice C).
- No browser/UI tests (Slice C).
- No legacy `coder` removal regression suite (Slice B).

## Migration

No removals in Slice A. The legacy `coder` entity (`packages/agents/src/agents/coding-session.ts`) and its tools are unchanged.

`agents-server` registers both at boot:

```ts
registerCodingSession(registry) // existing 'coder' type — UNCHANGED
registerCodingAgent(registry, {
  // NEW 'coding-agent' type
  provider: new LocalDockerProvider(),
  bridge: new StdioBridge(),
})
```

The two type names and disjoint collection-type wires guarantee no storage conflict. UI continues to work against `coder` until Slice C extends it for `coding-agent`.

## Open questions

- **`onBoot` registry hook.** Does `EntityRegistry` already expose a per-type `onBoot`? If not, this slice adds one (small change, scoped to `define-entity.ts` + `electric-agents-manager.ts`). Resolve during writing-plans by reading those files.
- **`ctx.deleteEntityStream` shape.** Used in `processDestroy`. Confirm during implementation that the runtime exposes a primitive for "drop all collections + halt observation". If not, fall back to "mark stream tombstone" semantic.
- **`workspace.sharedRefs` from a client `ctx`.** The client-side runtime can't see server-side `WorkspaceRegistry`. Slice A clients see `sharedRefs: 1`. Document; Slice C may add a server query.
- **Pin survival across server restart.** Slice A: pin counts are in-memory only. Slice B may persist refcount-by-key if real workloads need it.

## Scope cuts referenced from full design spec

Carried forward from the parent spec, **deferred**:

- Resume (`nativeJsonl` + `--resume`).
- Codex.
- `wake.on: 'eventAppended'`.
- `sandbox?` provider override.
- UI (status enum extension, header provenance, pin/release/stop buttons, lifecycle row rendering, spawn dialog workspace selector).
- Tools (`spawn_coding_agent`, `prompt_coding_agent`).
- Removal of legacy `coder` entity.
- Conformance suite (provider-parameterized).
- Cross-kind resume.

## References

- `docs/superpowers/specs/2026-04-30-coding-agents-platform-primitive-design.md` — parent design.
- `docs/superpowers/specs/notes/2026-04-30-coding-agents-mvp-report.md` — predecessor report.
- `packages/agents-runtime/src/context-factory.ts:561-629` — `useCodingAgent` template to mirror.
- `packages/agents/src/agents/coding-session.ts` — legacy `coder` entity (coexists; not removed).
- `packages/agents-runtime/src/define-entity.ts` — entity registration mechanism.
- `packages/agents-server/src/electric-agents-manager.ts` — server-side type registration.
