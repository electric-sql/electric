# Coding Agents — Platform Primitive

**Status:** Draft
**Date:** 2026-04-30
**Author:** Valter Balegas
**Scope:** Add a first-class platform primitive for spawning and observing coding agents (Claude Code, Codex) inside managed sandboxes, with the durable stream as the source of truth.

## Summary

Introduce a typed `ctx.spawnCodingAgent()` primitive on `HandlerContext`. The primitive wraps a built-in `coding-agent` entity that runs a CLI (Claude Code or Codex) inside a managed sandbox. The agent's full event history lives in a single durable stream; the sandbox is cattle (recreatable from the stream); workspace state lives in a per-workspace volume that can be shared across agents under a single-writer lease.

A new `@electric-ax/coding-agents` package owns the sandbox provider, the CLI bridge, and the lifecycle manager. The local-first MVP ships with a Docker provider and a stdio bridge. Remote providers (Modal, Fly, E2B) and a shim-based bridge are designed-for but out of scope for v1.

The existing `coder` entity (`packages/agents/src/agents/coding-session.ts`) and its tools (`spawn-coder.ts`, `prompt-coder.ts`) are removed and replaced.

## Goals

1. **Decouple agent state from compute.** The full event history of a coding agent lives in an append-only durable stream. The sandbox can die at any time; the agent can be reconstructed.
2. **Sandbox isolation.** CLIs run inside a sandbox, not as host child processes. The sandbox provider is pluggable.
3. **Durable resume.** A new sandbox materializes the prior session at the same logical point. Same-kind resume is lossless; cross-kind is semantic.
4. **Native observability.** The entire history surfaces in the existing StreamDB / agents-server-ui flow, with no new sync mechanism.
5. **Composable.** Other entities can spawn coding agents, observe them, send prompts, and react to their events.
6. **Multi-agent ready.** Two coding agents can share a working tree safely (lease-serialized), so a parent entity can run, e.g., a `claude` implementation pass and a `codex` review pass on the same checkout.

## Non-goals (v1)

- Remote sandbox providers (Modal, Fly, E2B, Cloudflare). Designed-for; not implemented.
- Shim-in-sandbox bridge. Designed-for; not implemented.
- ACP (Agent Client Protocol) external adapter.
- Replay / time-travel UI scrubber.
- Per-event approve/deny UI for `permission_request`.
- Workspace file browser in the UI.
- Memory-snapshot lifecycle.
- Pre-warmed sandbox pools.
- Multi-tenant authorization beyond what `agents-server` already enforces.

## Background

The repo already ships a `coder` entity in `packages/agents/src/agents/coding-session.ts`. It runs `claude` / `codex` as a host child process, mirrors normalized events from the CLI's JSONL transcript into the entity's StreamDB collections via `agent-session-protocol`, and supports `spawn` / `send` from other entities. Its limitations:

- The CLI runs on the host. No isolation. No per-task filesystem.
- The on-disk JSONL in `~/.claude/projects/...` is the resumable truth, not the durable stream. If the host's home directory is wiped, a session can't be resumed.
- The entity is registered as user-level code in `@electric-ax/agents`, not as a platform primitive. There is no typed API for entity authors.

The new design treats coding agents as a first-class platform concept, like `useAgent` is for the LLM loop.

## Architecture

```
                                       Entity author code
   ┌──────────────────────────────────────────────────────────────┐
   │  ctx.spawnCodingAgent({ kind, workspace, sandbox? })         │
   │  ctx.observeCodingAgent(id)                                  │
   └──────────────────────────────────────────────────────────────┘
                                  │  exposed by @electric-ax/agents-runtime
                                  ▼
   ┌──────────────────────────────────────────────────────────────┐
   │            CodingAgentHandle  ·  built-in `coding-agent`     │
   │            entity registered by @electric-ax/coding-agents   │
   └──────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
   ┌─────────────────────────┐   ┌─────────────────────────────────┐
   │  Bridge (StdioBridge)   │   │  LifecycleManager               │
   │  runTurn → events       │   │  state machine, idle timers,    │
   │  via agent-session-     │   │  pin/release, workspace lease   │
   │  protocol normalize     │   └─────────────────────────────────┘
   └─────────────────────────┘
                                  │
                                  ▼
   ┌──────────────────────────────────────────────────────────────┐
   │     SandboxProvider — LocalDockerProvider in v1              │
   │     start · stop · destroy · status · recover                │
   └──────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
   ┌──────────────────────────────────────────────────────────────┐
   │   Durable Stream (entity log)  ·  Workspace volume (shared)  │
   └──────────────────────────────────────────────────────────────┘
```

### Packages

| Package                                      | Role                                                                                                                                                                                |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@electric-ax/agents-runtime` (existing)     | Adds `ctx.spawnCodingAgent` / `ctx.observeCodingAgent` and the `CodingAgentHandle` type. No Docker / CLI knowledge.                                                                 |
| `@electric-ax/coding-agents` (new)           | The plumbing: built-in entity, `SandboxProvider`, `Bridge`, `LifecycleManager`, integration with `agent-session-protocol`. Imported and registered by `agents-server`'s entrypoint. |
| `@electric-ax/agents-server-ui` (existing)   | Extends existing `CodingSession*` components for the new status states, header provenance, pin/stop, lifecycle events, and shared-workspace indicator.                              |
| `agents-server` (existing)                   | Unchanged. The new entity type slots into existing wake/observe/spawn machinery.                                                                                                    |
| `agents-server-conformance-tests` (existing) | Gains a `coding-agent` suite, parameterized by provider.                                                                                                                            |

### Removed

- `packages/agents/src/agents/coding-session.ts` (the `coder` entity)
- `packages/agents/src/tools/spawn-coder.ts`
- `packages/agents/src/tools/prompt-coder.ts`

Replaced by the new primitive plus tools `spawn_coding_agent` / `prompt_coding_agent` that wrap it for use by Horton.

## Platform primitive API

```ts
// Exposed on HandlerContext from @electric-ax/agents-runtime

interface HandlerContext {
  // ... existing fields

  spawnCodingAgent(options: SpawnCodingAgentOptions): Promise<CodingAgentHandle>
  observeCodingAgent(id: string): Promise<CodingAgentHandle>
}

interface SpawnCodingAgentOptions {
  /** Stable id, scoped to the spawning entity. */
  id: string

  /** Which CLI to run. */
  kind: 'claude' | 'codex'

  /**
   * Workspace mount. Workspace identity is the lease key:
   *   - { type: 'volume', name: 'foo' }      → "volume:foo"
   *   - { type: 'volume' }                   → "volume:<agentId>" (default)
   *   - { type: 'bindMount', hostPath: P }   → "bindMount:<realpath(P)>"
   *
   * Two agents that resolve to the same identity share the volume and
   * are serialized at runTurn boundaries by the workspace lease.
   */
  workspace:
    | { type: 'volume'; name?: string }
    | { type: 'bindMount'; hostPath: string }

  /**
   * Optional sandbox provider override (provider name from the registry).
   * Defaults to the agents-server platform config (`local-docker` for v1).
   */
  sandbox?: string

  /** Initial prompt; queued before the first wake. */
  initialPrompt?: string

  /** When to wake the parent. */
  wake?: { on: 'runFinished' | 'eventAppended'; includeResponse?: boolean }

  /** Lifecycle overrides. */
  lifecycle?: { idleTimeoutMs?: number; keepWarm?: boolean }
}

interface CodingAgentHandle {
  /** Stable URL: /coding-agent/<id> */
  readonly url: string
  readonly kind: 'claude' | 'codex'

  /** Queue a prompt. Resolves once durably enqueued (not when CLI replies). */
  send(prompt: string): Promise<{ runId: string }>

  /** Async iterable over normalized events for this agent. */
  events(opts?: { since?: 'start' | 'now' }): AsyncIterable<NormalizedEvent>

  /**
   * Synchronous snapshot of state.
   *
   * `status`, `pinned`, `lastError`, `runs` come from the entity's
   * StreamDB collections. `workspace.sharedRefs` is read from the
   * agents-server's in-memory workspace registry — not from StreamDB —
   * so it reflects live cross-agent sharing without an extra stream.
   */
  state(): {
    status: 'cold' | 'starting' | 'idle' | 'running' | 'stopping' | 'error'
    pinned: boolean
    workspace: { identity: string; sharedRefs: number }
    lastError?: string
    runs: ReadonlyArray<RunSummary>
  }

  /** Lifecycle escape hatches. */
  pin(): Promise<void>
  release(): Promise<void>
  stop(): Promise<void> // tear down sandbox; state survives in stream
  destroy(): Promise<void> // tear down + drop refcount on workspace + delete entity stream
}

type NormalizedEvent = // re-exported from agent-session-protocol

    | SessionInitEvent
    | UserMessageEvent
    | AssistantMessageEvent
    | ThinkingEvent
    | ToolCallEvent
    | ToolResultEvent
    | TurnCompleteEvent
    | TurnAbortedEvent
    | CompactionEvent
    | PermissionRequestEvent
    | PermissionResponseEvent
    | ErrorEvent
    | SessionEndEvent

interface RunSummary {
  runId: string
  startedAt: number
  endedAt?: number
  status: 'running' | 'completed' | 'failed'
  promptInboxKey: string
  responseText?: string
}
```

### Wake semantics

- `wake: { on: 'runFinished' }` — parent woken once the CLI exits a turn.
- `wake: { on: 'eventAppended' }` — finer-grained streaming wakes.

### Why a typed primitive (not `ctx.spawn('coding-agent', ...)`)

- Static `kind` typing with autocomplete.
- Coding-agent-specific affordances (`pin`, `release`, `state.runs`) without leaking entity internals.
- Workspace shape validated at spawn time, not at first wake.
- Internally still resolves to an entity URL and reuses all spawn/observe/wake machinery — sugar with type safety.

### Internal entity type

The runtime registers a built-in `coding-agent` entity type. Authors cannot `defineEntity('coding-agent', …)` themselves; the type is reserved.

### How handle methods desugar onto the entity

`send(prompt)`, `pin()`, `release()`, `stop()`, `destroy()` all desugar to typed inbox messages on the underlying `coding-agent` entity (`message_type: 'prompt' | 'pin' | 'release' | 'stop' | 'destroy'`). The built-in handler interprets each message type. This keeps the platform primitive on top of existing entity machinery — no new transport, no new wake type. The same messages are dispatched by the UI's pin/release/stop buttons.

## Sandbox provider

```ts
// @electric-ax/coding-agents/src/sandbox-provider.ts

interface SandboxProvider {
  readonly name: string // 'local-docker' | 'modal' | 'fly' | ...

  /**
   * Boot a sandbox for the given coding-agent identity.
   * Idempotent: if a sandbox for `agentId` is running, return it.
   * Workspace volume is attached at /workspace.
   * The CLI's session dir (~/.claude or ~/.codex) is on tmpfs inside
   * the container — populated on start by the runtime from the
   * entity's nativeJsonl collection.
   */
  start(spec: SandboxSpec): Promise<SandboxInstance>

  /** Stop a sandbox. Workspace volume is preserved. */
  stop(instanceId: string): Promise<void>

  /** Drop refcount on workspace; delete only when last referent. */
  destroy(agentId: string): Promise<void>

  /** Current state for an agent. */
  status(agentId: string): Promise<'running' | 'stopped' | 'unknown'>

  /** On agents-server boot: discover agent's sandboxes by container labels. */
  recover(): Promise<Array<RecoveredSandbox>>
}

interface SandboxSpec {
  agentId: string // /coding-agent/<id>
  kind: 'claude' | 'codex'
  workspace:
    | { type: 'volume'; name: string } // resolved name (not the optional from the API)
    | { type: 'bindMount'; hostPath: string }
  env: Record<string, string> // ANTHROPIC_API_KEY etc.
}

interface SandboxInstance {
  instanceId: string
  agentId: string
  workspaceMount: string // '/workspace' inside the sandbox
  exec(args: ExecRequest): Promise<ExecHandle>
}

interface ExecRequest {
  cmd: string[]
  cwd?: string
  env?: Record<string, string>
  stdin?: 'pipe' | 'ignore'
}

interface ExecHandle {
  stdout: AsyncIterable<string> // line-by-line
  stderr: AsyncIterable<string>
  stdin?: WritableStream<string>
  wait(): Promise<{ exitCode: number }>
  kill(signal?: NodeJS.Signals): void
}

interface RecoveredSandbox {
  agentId: string
  instanceId: string
  status: 'running' | 'stopped'
}
```

### `LocalDockerProvider` (v1)

- Wraps `dockerode` (or `child_process` `docker` CLI).
- Image: `electricsql/coding-agent-sandbox:<version>` — Debian-slim Node base with `claude` and `codex` baked in. Single image, two CLIs. Published from the same release that ships `@electric-ax/coding-agents`. Version pinned in the package.
- Container PID 1 is `tail -f /dev/null` (kept alive for `docker exec`); each turn runs as a fresh `docker exec`.
- Volume conventions:
  - `coding-agent-workspace-<name>` (or `<agentId>` if `name` omitted) → mounted at `/workspace`.
  - `~/.claude` and `~/.codex` are tmpfs mounts inside the container.
- Bind-mount mode mounts the host path at `/workspace` instead. Same lifecycle.
- Container labels: `electric-ax.agent-id`, `electric-ax.kind`, `electric-ax.parent-entity`, `electric-ax.workspace-name`. Used by `recover()` and refcount queries.
- `recover()` runs `docker ps -a --filter label=electric-ax.agent-id` and returns instances matched against the entity manifest.

## Bridge

```ts
// @electric-ax/coding-agents/src/bridge.ts

interface Bridge {
  /**
   * Run one CLI turn. Returns when the CLI exits.
   * Streams events as they arrive; caller persists them.
   * Holds the workspace lease for the duration.
   */
  runTurn(args: RunTurnArgs): Promise<RunTurnResult>
}

interface RunTurnArgs {
  sandbox: SandboxInstance
  kind: 'claude' | 'codex'
  /** Native session id for resume. Undefined on the first turn. */
  nativeSessionId?: string
  prompt: string
  /** Sink for events parsed off CLI stdout. */
  onEvent: (e: NormalizedEvent) => void
  /** Sink for raw native JSONL lines (tee'd to nativeJsonl collection). */
  onNativeLine: (line: string) => void
}

interface RunTurnResult {
  nativeSessionId: string
  exitCode: number
  finalText?: string
}
```

### `StdioBridge` (v1)

- Spawns the CLI inside the sandbox via `sandbox.exec`:
  - **Claude:** `claude [-r <id>] --dangerously-skip-permissions -p` (prompt on stdin), `--output-format=stream-json`.
  - **Codex:** `codex exec --skip-git-repo-check --json [resume <id>] <prompt>` (prompt on argv).
- Reads stdout line-by-line, normalizes via `agent-session-protocol`'s `normalize()`, emits via `onEvent`. Each raw line is also tee'd via `onNativeLine`.
- On exit non-zero: throws with captured stdout/stderr (truncated to 4 KB each).
- Unparseable line: logged, dropped, doesn't fail the turn.
- ~120 LOC plus normalizer.

### `ShimBridge` (out of scope for v1)

The same `Bridge` interface accommodates a future shim implementation: a small Node process running as the sandbox's main process subscribes to a "commands" sub-stream and writes to a "results" sub-stream. The entity-facing API is unchanged. Designed-for, not built.

## State model

### Per coding-agent state

| Where                                     | What                                                                                                                                            |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **Durable stream** (the entity's own log) | Single append-only stream backing all collections.                                                                                              |
| **`sessionMeta`** collection (singleton)  | `{ kind, nativeSessionId?, status, pinned, error?, workspaceIdentity }`.                                                                        |
| **`runs`** collection                     | One row per CLI turn: `{ runId, startedAt, endedAt?, status, promptInboxKey, responseText? }`.                                                  |
| **`events`** collection                   | Projection of `NormalizedEvent`s, indexed by `(runId, ts)` for UI / live queries.                                                               |
| **`nativeJsonl`** collection              | Raw `claude` / `codex` JSONL lines, per-kind. Used only for cold-boot resume.                                                                   |
| **`lifecycle`** collection                | Sandbox-infra events (`sandbox.started`, `sandbox.stopped`, `resume.restored`) for muted timeline rendering. Not part of the conversation.      |
| **Workspace volume**                      | `coding-agent-workspace-<name>` (Docker named volume) or bind-mount path. Shared across agents. Out-of-band on purpose: workspaces can be huge. |

Total: **one durable stream per agent**. **Zero-or-one workspace volumes per workspace identity** (zero for bind-mount; shared across all agents using the same identity). No session volume — `~/.claude` / `~/.codex` is tmpfs, materialized from `nativeJsonl` on every container start.

### Workspace identity & sharing

Workspace identity is the lease key:

- `{ type: 'volume', name: 'foo' }` → `volume:foo`
- `{ type: 'volume' }` → `volume:<agentId>` (per-agent default)
- `{ type: 'bindMount', hostPath: P }` → `bindMount:<realpath(P)>`

Multiple agents that resolve to the same identity share the volume and are serialized at `runTurn` boundaries by the workspace lease (a per-identity mutex on the lifecycle manager). Concurrent `IDLE` agents on a shared workspace coexist freely; only `RUNNING` is serialized.

### Refcount on workspace volumes

- Tracked by an in-memory registry on agents-server: `workspaceIdentity → Set<agentId>`.
- Authoritative source on restart is the entity manifest (which agents exist and what workspace identity each declares in its `sessionMeta`). Container labels (`electric-ax.workspace-name`) are a cross-check for adoption but not a primary source of truth.
- `destroy()` decrements; the volume is removed only when the last referent is destroyed.
- Bind-mount paths are **never** deleted by the runtime — they are host-owned. `destroy()` only drops the registry entry.
- Volume names validated against `[a-z0-9-]{1,63}`. Runtime prefixes `coding-agent-workspace-`.

## Lifecycle

```
                          ┌──────────┐
              spawn ──────▶│   COLD   │◀──── idle-timeout fires
                          └────┬─────┘       (& !pinned)
                               │ send()
                               ▼
                          ┌──────────┐
                          │ STARTING │  provider.start()
                          └────┬─────┘  + tmpfs restore
              start failed     │ ready
                  ┌────────────┴────────────┐
                  ▼                         ▼
             ┌────────┐                ┌──────────┐
             │ ERROR  │                │   IDLE   │◀───┐
             └────┬───┘                └────┬─────┘    │
                  │ next send                │ send()   │ runTurn
                  ▼                          ▼          │ done
             ┌────────┐                 ┌──────────┐    │
             │  COLD  │◀──────┐         │ RUNNING  │────┘
             └────────┘       │         └────┬─────┘
                              │              │ stop()
                              │              ▼
                              │         ┌──────────┐
                              └─────────│ STOPPING │  drain & SIGTERM,
                              SIGKILL   └──────────┘  flush partial events
                              after 5 s
```

### Rules

- `COLD → STARTING → IDLE` is the cold-boot path. The first `send()` after hibernation pays this cost; warm prompts go `IDLE → RUNNING → IDLE`.
- The idle timer fires only in `IDLE`, only if `!pinned`. Workspace + entity stream survive; in-memory CLI process and tmpfs die.
- `pin()` clears the timer and prevents auto-stop. `release()` re-arms it. `pin()` is reference-counted: N pins need N releases.
- `stop()` is explicit teardown — moves directly to `COLD` even from `RUNNING` (SIGTERM → SIGKILL after 5 s grace). Partial events flushed before kill.
- `destroy()` is `stop()` + drop workspace refcount + delete entity stream. Irreversible.
- `ERROR` is terminal for the current attempt. The next `send()` retries `start()`. `lastError` is exposed on `state()`.

### Concurrency

- **One running CLI per workspace**, enforced by the workspace lease. Held across `bridge.runTurn` only; not across `IDLE` windows.
- **Per-agent inbox queue**: a second `send()` while the agent is `RUNNING` queues on the inbox (existing entity machinery — no new code).
- **Per-workspace queue**: a `send()` to agent A while agent B (same workspace) is `RUNNING` causes A's `runTurn` to await the lease.
- The bind-mount lease key is `realpath(hostPath)` — symlinks cannot bypass the lease.

### Crash recovery

- On agents-server boot, `LocalDockerProvider.recover()` adopts containers labeled `electric-ax.agent-id`. Status is queried; running ones reattach (entity rehydrates `sessionMeta` from stream); stopped ones become `COLD`.
- An orphaned in-flight run (`runs` row with `status=running` but no terminating event) is detected and marked `failed` with `reason=orphaned`. Workspace lease is released.
- This is the failure mode where the future `ShimBridge` wins — the host's stdio handle is gone after a crash. v1 accepts this for local dev.

### Defaults (config-tunable)

| Setting                  | Default                         |
| ------------------------ | ------------------------------- |
| `idleTimeoutMs`          | 5 × 60 000                      |
| `coldBootBudgetMs`       | 30 000                          |
| `runTimeoutMs`           | 30 × 60 000                     |
| `keepWarm`               | `false`                         |
| `maxConcurrentSandboxes` | 8 (per-server; queue otherwise) |

## Resume flow

```
parent entity              runtime / coding-agent           sandbox provider             CLI
   │                              │                              │                          │
   │  send("fix bug")             │                              │                          │
   │─────────────────────────────▶│  enqueue prompt              │                          │
   │                              │  status="starting"           │                          │
   │                              │  start(spec) ─────────────────▶  pull image             │
   │                              │                              │  attach workspace volume  │
   │                              │                              │  → SandboxInstance        │
   │                              │  read nativeJsonl coll       │                          │
   │                              │  denormalize → tmpfs         │                          │
   │                              │  (skip if files present)     │                          │
   │                              │                              │                          │
   │                              │  acquire workspace lease     │                          │
   │                              │  bridge.runTurn ──────────────▶  exec claude --resume   │
   │                              │                              │  <id> --print            │
   │                              │                              │  --output-format=        │
   │                              │                              │  stream-json             │──▶ run
   │                              │  stdout JSONL line ◀─────────│◀─────────────────────────│
   │                              │  append → nativeJsonl coll                              │
   │                              │  normalize → events coll                                │
   │                              │  (live UI updates here)                                 │
   │                              │  exit 0                                                 │
   │                              │  release workspace lease                                │
   │                              │  status="idle"                                          │
   │                              │  schedule idle timer                                    │
   │  wake(runFinished, text) ◀──│                              │                          │
   │                              │  ⏱ idle timeout fires                                   │
   │                              │  if !pinned: provider.stop()                            │
   │                              │  status="cold"                                          │
```

### Two resume paths

- **Same-kind (lossless).** `nativeJsonl` collection (filtered by kind) → `denormalize` → write JSONL into tmpfs → CLI runs `--resume` and sees the file. The CLI writes new events to the same JSONL; the bridge tees them back into the collection.
- **Cross-kind (semantic).** When `kind` changes (e.g., user forks claude→codex on the same agent): `events` (canonical) collection → `denormalize` for the new kind → write into a fresh tmpfs JSONL → start CLI with new id. Tool-call shapes become generically represented; same-conversation semantics preserved.

### Why `nativeJsonl` AND `events`?

- `events` is portable, stable, cross-kind: what entities, the UI, and parent wakes consume.
- `nativeJsonl` is the resumable truth for the CLI: rich, kind-specific, lossless. Without it, same-kind resume would drift on tool-call vendor fields.

This dichotomy is the same as the `agent-session-protocol` model — we inherit it for free.

## Observability & UI

### Reused from existing `agents-server-ui`

- `CodingSessionTimeline.tsx` — renders normalized events. Vocabulary already matches.
- `CodingSessionView.tsx`, `useCodingSession.ts` — bind collections, handle pending rows.
- `CodingSessionSpawnDialog.tsx` — spawn UI.
- `Sidebar.tsx`, `EntityTimeline.tsx`, `EntityHeader.tsx`, `MessageInput.tsx`, `stateExplorer/*` — generic.
- `CODING_SESSION_*_COLLECTION_TYPE` constants are kept stable (aliased from new symbols) to avoid breaking storage.

### New in v1

1. **Status enum extended** — `cold | starting | idle | running | stopping | error`. Extend `StatusDot` color map.
2. **Header gets sandbox provenance** — provider name, workspace identity, "shared with N other agents" indicator (when refcount > 1), pinned indicator.
3. **Header action buttons** — Pin / Release / Stop, dispatched as control messages on the entity inbox.
4. **Spawn dialog adds `workspace` selector** — volume (with optional name) or bind-mount (with hostPath). Provider selector is post-MVP.
5. **Lifecycle events render as muted timeline rows** — `sandbox.started`, `sandbox.stopped`, `resume.restored`. Sourced from the new `lifecycle` collection (separate from `events` because they're not conversation history).

### Out of v1 UI

- Multi-agent diff view (compare claude vs codex on same prompt).
- Replay scrubber / time-travel.
- Per-event approve/deny for `permission_request` (CLIs run with skip-permissions flags).
- Workspace file browser.
- "Open workspace in editor" link.

### Telemetry

OpenTelemetry spans for `sandbox.start`, `bridge.runTurn`, `resume.restore` (already wired into agents-server's Jaeger setup). Per-agent metrics: cold-boot latency, turn latency, event throughput, idle hibernations. No new dashboards in v1.

## Built-in agent tools

Horton (`packages/agents/src/agents/horton.ts`) currently uses `spawn_coder` / `prompt_coder`. These are replaced by:

- `spawn_coding_agent` — wraps `ctx.spawnCodingAgent` with the same UX as the current `spawn_coder` (initialMessage + `wake: { on: 'runFinished', includeResponse: true }`). New parameter: optional workspace name to enable sharing.
- `prompt_coding_agent` — wraps `ctx.observeCodingAgent(id).send(prompt)`.

The tool descriptions are updated to mention sandboxing and workspace sharing.

## Testing strategy

### Layer 1 — Unit (no Docker, no API keys)

- `LifecycleManager` state-machine transitions, idle timer, pin reference counting, concurrent `send` queueing. Backed by `FakeSandboxProvider` (in-memory) and `FakeBridge` (scripted events).
- `ResumeRestore`: given a sidecar of recorded events, asserts correct `denormalize` output is written to the right tmpfs path, with idempotency.
- `CodingAgentHandle` API-shape tests; `spawnCodingAgent` option validation; `observeCodingAgent` rebinds without re-spawning.
- Workspace identity resolution: `volume:foo`, `bindMount:realpath`, default-to-agentId.
- Workspace lease: per-identity mutex, IDLE coexistence, RUNNING serialization.
- Vitest. Sub-second.

### Layer 2 — Integration (real Docker, fake CLI)

- `LocalDockerProvider`: `start` creates the right labels/volumes/env, `start` is idempotent, `stop`/`destroy` clean up correctly with refcount, `recover()` adopts labeled containers after a simulated host restart.
- `StdioBridge` against a `fake-cli` binary baked into a test image — a tiny Node script that reads a fixture name from env and emits a recorded JSONL transcript on stdout. Tests JSONL parsing, exit codes, error capture, streaming order.
- Recorded fixtures in `test/fixtures/{claude,codex}/{first-turn, resume-turn, tool-call, error}.jsonl`. Captured once from real CLIs; checked in.
- Gated by `DOCKER=1` env (skipped otherwise).

### Layer 3 — Conformance suite (provider-agnostic)

- New `coding-agent` suite in `packages/agents-server-conformance-tests`. Parameterized by `SandboxProvider`.
- Scenarios: cold-boot + first prompt, warm second prompt, resume after `stop`, crash-recovery / orphaned run, workspace persists across teardown, cross-kind resume, shared-workspace lease serialization.
- v1 runs against `LocalDockerProvider` only. Future Modal / Fly impls reuse the suite.

### Layer 4 — End-to-end smoke (real CLIs, real keys)

- Single test per kind: parent entity spawns coding agent, sends `"echo hello and create hello.txt"`, awaits `runFinished` wake, asserts response contains "hello" and `hello.txt` exists in the workspace.
- Tagged `@slow`. Requires `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`. Runs nightly + post-merge to `main`. Catches CLI-version drift.

### UI tests

- Component tests for `StatusDot` color mapping across the seven states, `CodingSessionSpawnDialog` workspace validation, header pin/release dispatch.
- No new e2e browser tests in v1.

### Manual smoke checklist (PR description)

- Spawn agent via UI → send prompt → see streaming timeline.
- Pin → wait > idle timeout → confirm sandbox stays up.
- Release → wait > idle timeout → confirm container stops, status flips `COLD`.
- Send another prompt → confirm resume works (claude session id matches across the gap).
- Bind-mount mode: edits land on the host filesystem.
- Spawn second agent on the same workspace name → confirm shared-refs indicator → run prompt on agent A while sending to agent B → confirm B's lease wait.
- `docker kill` agents-server while CLI is running → restart server → confirm in-flight run is `failed`, container reaped, next prompt works.

## MVP scope

### v1 ships

- `@electric-ax/coding-agents` package: `SandboxProvider`, `Bridge`, `LocalDockerProvider`, `StdioBridge`, `LifecycleManager`, workspace-lease registry.
- `ctx.spawnCodingAgent` / `ctx.observeCodingAgent` on `HandlerContext`.
- Built-in `coding-agent` entity registered automatically when `@electric-ax/coding-agents` is imported by the server entrypoint.
- Two CLIs: `claude` and `codex`.
- Image `electricsql/coding-agent-sandbox:<version>` published from the same release; pinned in the package.
- One durable stream per agent. Zero-or-one shareable workspace volumes per workspace identity. No session volume; `~/.claude` and `~/.codex` are tmpfs.
- Cold-boot resume via tmpfs materialization from `nativeJsonl` collection.
- Lifecycle: idle hibernation, pin/release, stop/destroy, refcount-aware workspace cleanup, container-label crash recovery.
- UI: extend existing `CodingSession*` components per §Observability & UI.
- Tools: `spawn_coding_agent`, `prompt_coding_agent` for Horton.
- Tests: unit + integration + conformance + E2E smoke per §Testing strategy.
- Removal of `coder` entity, `spawn-coder.ts`, `prompt-coder.ts`. Collection-type wire strings kept stable; aliased from new symbols.

### Out of scope for v1

- `ShimBridge` and remote provider impls (Modal / Fly / E2B / Cloudflare).
- ACP adapter.
- Cross-kind resume in the spawn dialog (works programmatically; no UI affordance yet).
- Per-event approve/deny UI for `permission_request`.
- Replay / time-travel UI scrubber.
- Workspace file browser.
- Multi-tenant authorization on coding-agent endpoints (inherits agents-server's existing).
- Memory-snapshot lifecycle.
- Pre-warmed sandbox pools.
- "Open workspace in editor" link.
- Telemetry dashboard (spans emitted; no dashboard work).

### Migration

The `coder` entity is removed in the same release. No backwards-compat shim — internal feature, no external consumers depend on the API. Existing in-flight `coder` sessions on running dev environments are dropped.

## Open questions

- **API key injection.** Inherits agents-server's existing env handling; no new surface in this design. Confirm during implementation that `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` flow into `SandboxSpec.env` cleanly without ending up in container labels or stream events.
- **Workspace cleanup grace period.** Currently the volume is deleted immediately when the last referent is `destroy()`'d. Consider a grace period (e.g., 10 minutes) before delete in case the operator regrets it. Decide during implementation; either default is defensible.

## References

- `packages/agents/src/agents/coding-session.ts` — existing `coder` entity (to be removed).
- `node_modules/.pnpm/agent-session-protocol@0.0.2/node_modules/agent-session-protocol/README.md` — full asp spec.
- `packages/agents-runtime/src/define-entity.ts` — entity registry.
- `packages/agents-server/src/electric-agents-manager.ts` — server orchestration.
- `packages/agents-server-ui/src/components/CodingSessionTimeline.tsx` — existing timeline renderer (reused).
- [Agent Session Protocol](https://github.com/kevin-dp/agent-session-protocol).
- [mattpocock/sandcastle](https://github.com/mattpocock/sandcastle) — reference impl for stdin/stdout JSONL bridge.
- [OpenHands runtime](https://docs.openhands.dev/usage/architecture/runtime) — reference impl for server-in-sandbox + EventStream.
- [Anthropic Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview).
- [OpenAI Codex non-interactive mode](https://developers.openai.com/codex/noninteractive).
- [Agent Client Protocol](https://agentclientprotocol.com/) — designed-for ACP adapter (out of scope).
