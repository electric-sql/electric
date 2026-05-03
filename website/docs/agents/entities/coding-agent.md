---
title: Coding Agent
titleTemplate: "... - Electric Agents"
description: >-
  Long-lived, sandboxed coding-agent CLI sessions (claude / codex / opencode) with persistent workspaces.
outline: [2, 3]
---

# Coding Agent

`coding-agent` is the built-in entity type for long-lived, supervised coding-CLI sessions. Each agent owns a persistent workspace and a CLI process — claude, codex, or opencode — wrapped in a state machine that survives idle hibernation, host restart, kind switches, and forks. The runtime exposes a single typed API (`ctx.spawnCodingAgent`) for parent entities to delegate code work and be woken when it completes.

**Sources**

- Entity, lifecycle, providers, bridges: [`packages/coding-agents/src/`](https://github.com/electric-sql/electric/blob/main/packages/coding-agents/src/)
- Runtime API surface: [`packages/agents-runtime/src/types.ts`](https://github.com/electric-sql/electric/blob/main/packages/agents-runtime/src/types.ts)
- Horton tools: [`packages/agents/src/tools/spawn-coding-agent.ts`](https://github.com/electric-sql/electric/blob/main/packages/agents/src/tools/spawn-coding-agent.ts)

## Quick reference

| Aspect            | Values                                                                                       |
| ----------------- | -------------------------------------------------------------------------------------------- |
| Agent kinds       | `claude`, `codex`, `opencode`                                                                |
| Sandbox targets   | `sandbox` (Docker), `host` (no isolation), `sprites` ([sprites.dev](https://sprites.dev))    |
| Workspace types   | `volume` (named Docker volume — sandbox/sprites), `bindMount` (host path — host/sandbox)     |
| Inbox messages    | `prompt`, `pin`, `release`, `stop`, `destroy`, `convert-kind`, `convert-target`              |
| Status states     | `cold`, `starting`, `idle`, `running`, `stopping`, `error`, `destroyed`                      |
| Provider env vars | `ANTHROPIC_API_KEY` (or `CLAUDE_CODE_OAUTH_TOKEN`), `OPENAI_API_KEY`, `SPRITES_TOKEN`        |

## When to use it

| Scenario                                                                              | Use                                                |
| ------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Multi-turn, stateful code edits with filesystem isolation                             | `coding-agent`                                     |
| Multi-file changes that benefit from a CLI's native tool set                          | `coding-agent`                                     |
| A parent entity that delegates coding work and is woken on completion                 | `ctx.spawnCodingAgent`                             |
| Conversational assistant that orchestrates coding as one of many tasks                | Horton + `spawn_coding_agent` tool                 |
| Short one-shot LLM completion or structured extraction                                | `ctx.useAgent` / `worker`                          |
| Running a known shell command in isolation                                            | `worker`                                           |

A `coding-agent` is the right primitive when continuity across turns matters — it can read its own prior work, iterate on a file, run tests, hibernate, and resume losslessly on the next prompt.

## Architecture

The package wires four orthogonal pieces around an entity handler.

```text
              spawnCodingAgent(ctx)               POST /send {type: ...}
                    │                                     │
                    ▼                                     ▼
           ┌──────────────────┐                  ┌──────────────────┐
           │ entity / spawn   │                  │ entity / inbox   │
           └─────────┬────────┘                  └─────────┬────────┘
                     │                                     │
                     ▼                                     ▼
              ┌─────────────────────────────────────────────────┐
              │             coding-agent handler                │  ── packages/coding-agents/src/entity/handler.ts
              │   (sessionMeta / runs / events / lifecycle /    │
              │    nativeJsonl  state collections)              │
              └─────────────────────────────────────────────────┘
                  │                  │                  │
        provider.start /  bridge.runTurn          WorkspaceRegistry
        destroy / status  (per kind)              (per-identity lease)
                  ▼                  ▼                  ▼
        ┌──────────────────┐  ┌────────────────┐  ┌──────────────┐
        │ SandboxProvider  │  │     Bridge     │  │  Workspace   │
        │  ─ LocalDocker   │  │  ─ StdioBridge │  │  Registry    │
        │  ─ Host          │  │     ↓          │  └──────────────┘
        │  ─ FlySprites    │  │  Adapter map   │
        └──────────────────┘  │  ─ claude      │
                              │  ─ codex       │
                              │  ─ opencode    │
                              └────────────────┘
```

**Responsibility split**

- [`entity/handler.ts`](https://github.com/electric-sql/electric/blob/main/packages/coding-agents/src/entity/handler.ts) — first-wake init, inbox dispatch, status machine, run accounting, transcript capture / materialise, fork backfill. Mutates state collections via `ctx.db.actions`.
- [`lifecycle-manager.ts`](https://github.com/electric-sql/electric/blob/main/packages/coding-agents/src/lifecycle-manager.ts) — multiplexes the three providers, runs the idle eviction timer, and tracks the per-agent `pin` refcount.
- [`workspace-registry.ts`](https://github.com/electric-sql/electric/blob/main/packages/coding-agents/src/workspace-registry.ts) — canonicalises workspace identities (`volume:<name>`, `bindMount:<realpath>`, `sprite:<agentId>`) and serialises concurrent runs that share an identity behind a per-identity mutex.
- [`bridge/stdio-bridge.ts`](https://github.com/electric-sql/electric/blob/main/packages/coding-agents/src/bridge/stdio-bridge.ts) — runs one CLI turn: builds argv via the per-kind adapter, pipes prompt, drains stdout, normalises raw lines into `agent-session-protocol` events.
- [`providers/`](https://github.com/electric-sql/electric/blob/main/packages/coding-agents/src/providers/) — three `SandboxProvider` implementations (LocalDocker, Host, FlySprites). The provider surface is small enough that a fourth (Modal, E2B, …) is a few hundred LOC.

## Setup

```bash
# At least one is required. Either may be the OAuth subscription token shape (sk-ant-oat...).
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-proj-...
SPRITES_TOKEN=<bearer-token-from-sprites.dev>   # optional — enables target=sprites
```

`registerCodingAgent`'s default `env()` callback mirrors `ANTHROPIC_API_KEY` → `CLAUDE_CODE_OAUTH_TOKEN` when the value matches the OAuth shape, so a single `ANTHROPIC_API_KEY=sk-ant-oat...` covers both API-key and OAuth-token code paths.

```bash
node packages/electric-ax/bin/dev.mjs up           # spawn full stack on :4437
node packages/electric-ax/bin/dev.mjs restart      # bounce host services (state preserved)
node packages/electric-ax/bin/dev.mjs clear-state  # nuke postgres + volumes + streams
```

`dev.mjs` runs an embedded `DurableStreamTestServer` and persists its data directory to `.local/dev-streams` so existing entities survive `up`-after-`down`.

## Targets and kinds

### Targets

| Target    | Backend                                     | Workspace types     | Cleanup on destroy                                  |
| --------- | ------------------------------------------- | ------------------- | --------------------------------------------------- |
| `sandbox` | `LocalDockerProvider` (Docker)              | volume, bindMount   | container removed; **volume kept for resume safety**|
| `host`    | `HostProvider` (no isolation)               | bindMount only      | nothing to clean up                                 |
| `sprites` | `FlySpriteProvider` ([sprites.dev](https://sprites.dev)) | volume only         | sprite deleted on the platform                      |

**Cross-provider transitions are not supported.** Convert and Fork between `sandbox`↔`sprites` or `host`↔`sprites` are rejected at the server (lifecycle event `target.changed: failed: cross-provider not supported`); the UI also disables those dropdown items. Spawn a fresh agent on the target instead.

`convert-target sandbox → host` requires a bind-mount workspace; volume-backed agents are rejected with `lastError = "convert to host requires a bindMount workspace"`.

### Kinds

| Kind     | CLI binary | Auth                                                              | Notes                                       |
| -------- | ---------- | ----------------------------------------------------------------- | ------------------------------------------- |
| claude   | `claude`   | `ANTHROPIC_API_KEY` (or OAuth via `CLAUDE_CODE_OAUTH_TOKEN`)      | Stream-JSON output; stdin prompt delivery   |
| codex    | `codex`    | `OPENAI_API_KEY`                                                  | Stream-JSON output; stdin prompt delivery   |
| opencode | `opencode` | `ANTHROPIC_API_KEY` and/or `OPENAI_API_KEY` (per-provider routing) | Per-spawn `model` arg required              |

Adding a new kind = registering a `CodingAgentAdapter` (see [Adding a coding-agent kind](#adding-a-coding-agent-kind)).

## Lifecycle

A `coding-agent` cycles through seven states.

```text
                spawn ─────▶ ┌───────┐ ◀── idle-timeout fires (& not pinned)
                             │ COLD  │     or stop/destroy
                             └───┬───┘
                                 │ prompt
                                 ▼
                            ┌────────┐
                            │STARTING│
                            └───┬────┘
            cold-boot fail      │ ready    (sprites: also bootstrap.starting → bootstrap.complete)
              ┌─────────────────┴─────────────────┐
              ▼                                   ▼
          ┌───────┐                          ┌────────┐
          │ ERROR │                          │  IDLE  │ ◀──┐
          └──┬────┘                          └────┬───┘    │ runTurn done
             │ next prompt                        │ prompt │
             ▼                                    ▼        │
          ┌───────┐                          ┌────────┐   │
          │ COLD  │                          │RUNNING │───┘
          └───────┘                          └───┬────┘
                                                 │ stop / destroy
                                                 ▼
                                            ┌────────┐
                                            │STOPPING│ ─── SIGTERM → SIGKILL after 5 s
                                            └───┬────┘
                                                │ destroy completes
                                                ▼
                                          ┌──────────┐
                                          │DESTROYED │ tombstone — Pin/Release/Stop/Convert all gated
                                          └──────────┘
```

### Status states (`sessionMeta.status`)

| State       | Meaning                                                                                              |
| ----------- | ---------------------------------------------------------------------------------------------------- |
| `cold`      | Sandbox is hibernated. Volume / sprite still exists; will wake on next prompt.                       |
| `starting`  | Cold-boot in progress (provider creating container / sprite, bootstrap running).                     |
| `idle`      | Sandbox up, no active turn. Idle timer counts down to eviction unless `keepWarm` or pinned.          |
| `running`   | A prompt is being processed (CLI is executing).                                                      |
| `stopping`  | Currently transitioning down (e.g. response to `stop` message or idle eviction).                     |
| `error`     | Most recent operation failed; `lastError` carries the message.                                       |
| `destroyed` | Permanent. Container removed; `pin`/`release`/`stop`/`convert-*` are no-ops.                         |

### Inbox messages (control plane)

Send these via `POST /coding-agent/<name>/send` with body `{ from: 'user' | ..., type, payload }`.

| Type             | Payload                                                          | Effect                                                                                            |
| ---------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `prompt`         | `{ text: string }`                                               | Run a turn. If cold, triggers sandbox start + bootstrap (sprites only).                           |
| `pin`            | `{}`                                                             | Increment pin refcount; while pinned, idle eviction is suppressed.                                |
| `release`        | `{}`                                                             | Decrement pin refcount; if 0 and idle, re-arms idle timer.                                        |
| `stop`           | `{}`                                                             | Hibernate now. Container removed; status → `cold`. Volume kept for resume.                       |
| `destroy`        | `{}`                                                             | Terminal. Removes container; status → `destroyed`; releases workspace lease.                      |
| `convert-target` | `{ to: 'sandbox' \| 'host' \| 'sprites' }`                        | Move the workspace to a different target. Cross-provider transitions rejected (see Targets).      |
| `convert-kind`   | `{ kind: 'claude' \| 'codex' \| 'opencode'; model?: string }`     | Swap the CLI in place; events history is preserved (see [Convert kind](#convert-kind)).           |

Two internal types are sent self-to-self by the runtime: `lifecycle/idle-eviction-fired` (re-enters the handler after the idle timer fires) and `lifecycle/init` (re-runs first-wake init after a CLI-driven import).

### Idle eviction & keepWarm

After a run completes, an idle timer arms (default 300 s). When it fires, the sandbox container is destroyed and status flips to `cold`. The workspace volume and the entity's durable stream survive — only the in-memory process and the container's tmpfs are discarded.

- **Pin refcount.** `pin` increments a per-agent counter; idle eviction is suppressed while > 0. The first `release` (count → 0) re-arms the timer.
- **`keepWarm`.** Spawning with `keepWarm: true` bypasses idle eviction entirely. Equivalent to a permanent self-pin.

### Lifecycle event vocabulary (`coding-agent.lifecycle`)

```text
sandbox.starting     bootstrap.starting       pin
sandbox.started      bootstrap.complete       release
sandbox.stopped      bootstrap.failed         orphan.detected
sandbox.failed       resume.restored          target.changed
                     import.restored          kind.converted
                     import.failed            kind.convert_failed
                                              kind.forked
```

`bootstrap.*` is sprites-only (per-sprite first-cold-boot install).

## Native API

### `ctx.spawnCodingAgent(opts)`

Defined in [`packages/agents-runtime/src/types.ts`](https://github.com/electric-sql/electric/blob/main/packages/agents-runtime/src/types.ts). Returns a spawn handle whose `.url` is the new entity URL.

```ts
import { nanoid } from 'nanoid'

const coder = await ctx.spawnCodingAgent({
  id: nanoid(10),                                           // stable agent id
  kind: 'claude',                                           // 'claude' | 'codex' | 'opencode'
  target: 'sandbox',                                        // 'sandbox' | 'host' | 'sprites'
  workspace: { type: 'volume' },                            // or { type: 'bindMount', hostPath: '/abs/path' }
  // model: 'openai/gpt-5.4-mini-fast',                     // required for opencode
  initialPrompt: 'Add a sum() helper to src/math.ts.',     // optional first prompt
  wake: { on: 'runFinished', includeResponse: true },       // optional: wake parent on completion
  lifecycle: { idleTimeoutMs: 300_000, keepWarm: false },   // optional: tune idle behaviour
  // from: { agentId: '/coding-agent/source', workspaceMode: 'clone' },  // optional: fork
})
```

| Field           | Description                                                                                                |
| --------------- | ---------------------------------------------------------------------------------------------------------- |
| `id`            | Stable id scoped to the spawning entity. Re-using an id is a no-op (existing agent is observed instead).   |
| `kind`          | Default `claude`.                                                                                          |
| `target`        | Default `sandbox`. `sprites` requires `SPRITES_TOKEN`. `host` requires bindMount.                          |
| `workspace`     | `{ type: 'volume', name?: string }` or `{ type: 'bindMount', hostPath: string }`.                          |
| `model`         | Required for `opencode`; optional for claude/codex.                                                        |
| `initialPrompt` | Queued before first wake — saves a second send.                                                            |
| `wake`          | Async notification: `{ on: 'runFinished', includeResponse?: boolean }`. The parent is woken when this run completes. |
| `lifecycle`     | `{ idleTimeoutMs?: number; keepWarm?: boolean }`. See [Idle eviction & keepWarm](#idle-eviction-keepwarm). |
| `from`          | Fork source: `{ agentId, workspaceMode?: 'share' \| 'clone' \| 'fresh' }`. See [Fork](#fork).              |

### Sending a prompt

```ts
await ctx.send(`/coding-agent/${id}`, { text: 'reply with: ok' }, { type: 'prompt' })
```

### Observing another agent

```ts
const handle = await ctx.observe({
  sourceType: 'entity',
  sourceRef: '/coding-agent/source-id',
})
const sourceEvents = (handle.db?.collections.events.toArray ?? []) as Array<EventRow>
```

The handle provides at-spawn-time snapshot semantics — subsequent source updates are not reflected. Used by `fork` to read the source agent's transcript.

### State collections

`coding-agent` registers five state collections on its entity stream:

| Collection      | Wire type                       | Key                  | Description                                                                              |
| --------------- | ------------------------------- | -------------------- | ---------------------------------------------------------------------------------------- |
| `sessionMeta`   | `coding-agent.sessionMeta`      | `'current'`          | Singleton row: status, kind, target, pinned, workspace identity, last error, model.      |
| `runs`          | `coding-agent.runs`             | `runId` (nanoid)     | One row per turn: status, timestamps, finish reason, response text.                      |
| `events`        | `coding-agent.events`           | `<runId>:<seq>`      | Normalised `agent-session-protocol` events. Used by the timeline and by parent wakes.    |
| `lifecycle`     | `coding-agent.lifecycle`        | `<label>:<ts>-<rand>`| Infrastructure events (sandbox start/stop, pin/release, resume.restored, kind.converted, bootstrap.* ).|
| `nativeJsonl`   | `coding-agent.nativeJsonl`      | `'current'`          | Single-row blob: the CLI's on-disk transcript, captured post-turn. Used only for resume. |

Wire-type constants are exported:

```ts
import {
  CODING_AGENT_SESSION_META_COLLECTION_TYPE, // 'coding-agent.sessionMeta'
  CODING_AGENT_RUNS_COLLECTION_TYPE,         // 'coding-agent.runs'
  CODING_AGENT_EVENTS_COLLECTION_TYPE,       // 'coding-agent.events'
  CODING_AGENT_LIFECYCLE_COLLECTION_TYPE,    // 'coding-agent.lifecycle'
  CODING_AGENT_NATIVE_JSONL_COLLECTION_TYPE, // 'coding-agent.nativeJsonl'
} from '@electric-ax/coding-agents'
```

The handler reads/writes them through standard SDK primitives: `ctx.db.collections.<name>.{get,toArray,rows}` and `ctx.db.actions.<name>_{insert,update}`.

## Convert and Fork

### Convert kind

Send a `convert-kind` inbox message to swap CLIs in place — the agent's events history is preserved by **denormalising** to common protocol events and re-rendering as the new kind's transcript format. The next prompt resumes with `--resume <new-session-id>` against the new CLI binary.

```ts
await ctx.send(`/coding-agent/foo`, { kind: 'codex' }, { type: 'convert-kind' })
```

Cross-kind support: claude ↔ codex and either → opencode (uni-directional in v1; opencode → claude/codex deferred). See `convertNativeJsonl` in [`entity/conversion.ts`](https://github.com/electric-sql/electric/blob/main/packages/coding-agents/src/entity/conversion.ts).

### Convert target

Send a `convert-target` to move the workspace between sandbox / host / sprites. Cross-provider transitions (sandbox/host ↔ sprites) are rejected; for sandbox+volume → host, the workspace must already be bindMount.

```ts
await ctx.send(`/coding-agent/foo`, { to: 'host' }, { type: 'convert-target' })
```

### Fork

Spawn a sibling agent with `from: { agentId, workspaceMode }`. The new agent's events history is backfilled at first-wake (denormalised → renormalised per the new agent's kind), so cross-kind forks "remember" the parent's conversation.

```ts
const fork = await ctx.spawnCodingAgent({
  id: nanoid(10),
  kind: 'codex',
  workspace: { type: 'volume' },
  from: { agentId: '/coding-agent/source', workspaceMode: 'clone' },
})
```

`workspaceMode` defaults: `share` for bind-mount sources (multiple agents on the same host path serialise via the workspace lease), `clone` for volume sources (errors at spawn time if the provider doesn't implement `cloneWorkspace`).

### Provider capability matrix

| Provider              | `cloneWorkspace`                          |
| --------------------- | ----------------------------------------- |
| `LocalDockerProvider` | yes (alpine cp -a)                        |
| `HostProvider`        | no (bind-mount only)                      |
| `FlySpriteProvider`   | no (deferred to v1.5; see TL-S3)          |

## Bridges — integrating a new coding-agent kind

A bridge runs one CLI turn end-to-end. The single ship-able `Bridge` impl is `StdioBridge`; the per-kind variability lives in `CodingAgentAdapter` registrations.

### `Bridge` interface

[`packages/coding-agents/src/types.ts`](https://github.com/electric-sql/electric/blob/main/packages/coding-agents/src/types.ts):

```ts
export interface Bridge {
  runTurn(args: RunTurnArgs): Promise<RunTurnResult>
}

export interface RunTurnArgs {
  sandbox: SandboxInstance
  kind: CodingAgentKind
  prompt: string
  nativeSessionId?: string                                // for resume
  model?: string
  onEvent: (e: NormalizedEvent) => void                   // each parsed event
  onNativeLine?: (line: string) => void                   // raw stdout sidecar
}

export interface RunTurnResult {
  exitCode: number
  finalText?: string                                      // last assistant_message text
  nativeSessionId?: string                                // extracted from session_init
}
```

### Adding a coding-agent kind

Register a `CodingAgentAdapter`:

```ts
import { registerAdapter } from '@electric-ax/coding-agents'

registerAdapter({
  kind: 'mycoder',
  cliBinary: 'mycoder',
  defaultEnvVars: ['MYCODER_API_KEY'],

  buildCliInvocation({ prompt, nativeSessionId, model }) {
    const args = ['chat', '--format', 'jsonl']
    if (model) args.push('--model', model)
    if (nativeSessionId) args.push('--session', nativeSessionId)
    return { args, promptDelivery: 'stdin' }              // or 'argv'
  },

  probeCommand({ homeDir, sessionId }) {                  // exit 0 if transcript exists
    return ['test', '-f', `${homeDir}/.mycoder/sessions/${sessionId}.jsonl`]
  },
  materialiseTargetPath({ homeDir, sessionId }) {
    return `${homeDir}/.mycoder/sessions/${sessionId}.jsonl`
  },
  captureCommand({ homeDir, sessionId }) {                // base64 of the captured transcript on stdout
    const path = `${homeDir}/.mycoder/sessions/${sessionId}.jsonl`
    return ['sh', '-c', `[ -f ${path} ] && base64 -w 0 ${path}`]
  },
})
```

Plus, if the CLI's stdout isn't already in `agent-session-protocol` shape, wire a normaliser in `bridge/stdio-bridge.ts`. The shipped impls live in [`agents/`](https://github.com/electric-sql/electric/blob/main/packages/coding-agents/src/agents/) — claude/codex use the protocol's `normalize()`; opencode uses a local `normalizeOpencode` because its native shape diverges.

`promptDelivery: 'stdin'` is preferred — it sidesteps `ARG_MAX` (~256 KB on Linux). The bridge enforces an upstream cap of 900 KB per prompt regardless of delivery.

## Sandbox providers — integrating a new sandbox

A `SandboxProvider` owns the lifecycle of a single sandbox primitive (a Docker container, a sprite, a Modal Function, …) keyed by `agentId`.

### `SandboxProvider` interface

[`packages/coding-agents/src/types.ts`](https://github.com/electric-sql/electric/blob/main/packages/coding-agents/src/types.ts):

```ts
export interface SandboxProvider {
  readonly name: string

  start(spec: SandboxSpec): Promise<SandboxInstance>            // idempotent per agentId
  stop(instanceId: string): Promise<void>                       // pause (may be no-op)
  destroy(agentId: string): Promise<void>                       // teardown
  status(agentId: string): Promise<'running' | 'stopped' | 'unknown'>
  recover(): Promise<Array<RecoveredSandbox>>                   // adopt prior-process sandboxes

  cloneWorkspace?(opts: { source: WorkspaceSpec; target: WorkspaceSpec }): Promise<void>
}

export interface SandboxInstance {
  instanceId: string                                            // unique per (agentId, this start) — must change after destroy+restart
  agentId: string
  workspaceMount: string                                        // path inside the sandbox where workspace is mounted
  homeDir: string                                               // user $HOME inside the sandbox
  exec(req: ExecRequest): Promise<ExecHandle>                   // spawn a process
  copyTo(args: { destPath: string; content: string; mode?: number }): Promise<void>
}

export interface ExecHandle {
  stdout: AsyncIterable<string>
  stderr: AsyncIterable<string>
  wait(): Promise<{ exitCode: number }>
  kill(signal?: string): void
  writeStdin?(chunk: string): Promise<void>                     // present iff stdin === 'pipe'
  closeStdin?(): Promise<void>
}
```

The contract is exercised by [`runSandboxProviderConformance`](https://github.com/electric-sql/electric/blob/main/packages/coding-agents/src/conformance/provider.ts). See [Conformance contract](#conformance-contract) below.

### Adding a sandbox provider

Implement the interface, register it conditionally on the env var that gates it (mirroring `createSpritesProviderIfConfigured`), and wire the provider into [`packages/agents/src/bootstrap.ts`](https://github.com/electric-sql/electric/blob/main/packages/agents/src/bootstrap.ts):

```ts
import { registerCodingAgent, LocalDockerProvider, HostProvider, StdioBridge,
         createSpritesProviderIfConfigured } from '@electric-ax/coding-agents'
import { MyProvider } from '@your-org/my-sandbox-provider'

registerCodingAgent(registry, {
  providers: {
    sandbox: new LocalDockerProvider(),
    host: new HostProvider(),
    ...(createSpritesProviderIfConfigured()
      ? { sprites: createSpritesProviderIfConfigured()! }
      : {}),
    // mything: process.env.MYTHING_TOKEN ? new MyProvider() : undefined,
  },
  bridge: new StdioBridge(),
  wakeEntity: (agentId) => { /* re-enter handler self-message */ },
})
```

Widening `target: 'sandbox' | 'host' | 'sprites'` to include a new value is a 3-step change: schema enum (`entity/collections.ts` + `entity/messages.ts`), `LifecycleManager.providers` shape, and the `RegisterCodingAgentDeps.providers` type. Forgetting any one of them is a runtime no-op (the conformance test catches it within seconds).

### Conformance contract

Two harnesses verify any new provider matches the runtime's expectations. A new provider with both passing is interchangeable with the shipped ones.

**Provider conformance** ([`runSandboxProviderConformance`](https://github.com/electric-sql/electric/blob/main/packages/coding-agents/src/conformance/provider.ts)):

| ID  | Scenario                                                                                                       |
| --- | -------------------------------------------------------------------------------------------------------------- |
| L1.1 | `start(agentId)` twice returns the same `instanceId` (idempotent)                                              |
| L1.2 | `start(...)` → `destroy(...)` → `start(...)` produces a different `instanceId`                                 |
| L1.3 | `status(agentId)` reflects lifecycle (`unknown` → `running` → `stopped/unknown`)                                |
| L1.4 | `recover()` returns previously-running sandboxes from a prior process (optional; gate via `supportsRecovery`)   |
| L1.5 | `exec` honours `cwd` and `env`                                                                                 |
| L1.6 | `exec` round-trips stdin via `writeStdin`/`closeStdin`                                                         |
| L1.7 | `copyTo` writes content at `destPath` (idempotent)                                                              |
| L1.8 | `sandbox.homeDir` matches what `echo $HOME` prints inside an exec                                              |
| L1.9 | `cloneWorkspace` copies source content into target (optional; gate via `supportsCloneWorkspace`)               |

**Integration conformance** ([`runCodingAgentsIntegrationConformance`](https://github.com/electric-sql/electric/blob/main/packages/coding-agents/src/conformance/integration.ts)):

| ID  | Scenario                                                                                                       |
| --- | -------------------------------------------------------------------------------------------------------------- |
| L2.1 | Cold-boot + first prompt completes; `responseText` matches probe                                                |
| L2.2 | Warm second prompt reuses the sandbox (same `instanceId`, no `sandbox.starting` row)                           |
| L2.3 | Resume after `stop` cold-boots and continues conversation                                                      |
| L2.4 | Reconcile transitions a stale `running` run to `failed: orphaned` after host restart                            |
| L2.5 | Workspace persists across teardown (`destroy` keeps the data; only `clear-state` wipes it)                     |
| L2.6 | Shared-workspace lease serialises concurrent runs                                                               |
| L2.7 | Convert mid-conversation switches kind (claude → codex etc.)                                                    |
| L2.8 | Fork into sibling inherits source events                                                                        |

Run via:

```bash
DOCKER=1                                                       pnpm -C packages/coding-agents test test/integration/local-docker-conformance.test.ts
HOST_PROVIDER=1                                                pnpm -C packages/coding-agents test test/integration/host-provider-conformance.test.ts
SPRITES=1 SPRITES_TOKEN=...                                    pnpm -C packages/coding-agents test test/integration/fly-sprites-conformance.test.ts
```

## UI

The `agents-server-ui` renders coding agents with a status badge, a streaming timeline, and Pin / Release / Stop / Convert-target / Convert-kind / Fork controls — all of which translate to the inbox messages described above. See [`packages/agents-server-ui/src/components/EntityHeader.tsx`](https://github.com/electric-sql/electric/blob/main/packages/agents-server-ui/src/components/EntityHeader.tsx) for the wire-up.

The spawn dialog ([`CodingAgentSpawnDialog.tsx`](https://github.com/electric-sql/electric/blob/main/packages/agents-server-ui/src/components/CodingAgentSpawnDialog.tsx)) auto-disables incompatible workspace types (e.g. bind-mount when `target=sprites`) and surfaces cross-provider Convert/Fork options as visible-but-disabled with a tooltip explaining why.

## Operator scripts

Two cleanup utilities ship in `packages/coding-agents/scripts/`. Both run via Node 24's native TypeScript stripping; no build or extra dependency required.

```bash
SPRITES_TOKEN=... pnpm -C packages/coding-agents cleanup:sprites           # dry-run
SPRITES_TOKEN=... pnpm -C packages/coding-agents cleanup:sprites --delete  # actually delete

pnpm -C packages/coding-agents cleanup:volumes                              # dry-run
pnpm -C packages/coding-agents cleanup:volumes --delete                     # delete unattached volumes
pnpm -C packages/coding-agents cleanup:volumes --in-use                     # also list still-mounted ones
```

`cleanup:sprites` lists/deletes sprites whose name starts with `coding-agent-`, `conf-sprite-`, or `e2e-sprites-`. `cleanup:volumes` lists/deletes `coding-agent-workspace-*` Docker volumes (kept by `LocalDockerProvider.destroy()` for resume safety, orphaned after entity DELETE).

## Defaults

| Setting             | Default                              | Override via                                          |
| ------------------- | ------------------------------------ | ----------------------------------------------------- |
| `idleTimeoutMs`     | 300 000 (5 min)                      | `lifecycle.idleTimeoutMs` in `spawnCodingAgent`       |
| `keepWarm`          | `false`                              | `lifecycle.keepWarm` in `spawnCodingAgent`            |
| `coldBootBudgetMs`  | 30 000 (sandbox/host) / 240 000 (sprites) | `RegisterCodingAgentDeps.defaults.coldBootBudgetMs` |
| `runTimeoutMs`      | 1 800 000 (30 min)                   | `RegisterCodingAgentDeps.defaults.runTimeoutMs`       |
| Sprites idle timeout| 300 s (auto-sleep)                   | `FlySpriteProviderOptions.idleTimeoutSecs`            |

## Tracked limitations

- **TL-S1**: Sprites API is pre-1.0; the protocol has shifted (rc30 docs vs rc43 server) and is expected to keep shifting until 1.0.
- **TL-S2**: Sprites have no custom OCI image input. First cold-boot per agent installs `opencode-ai` (~10 s on the default Ubuntu image, which preinstalls Claude CLI / OpenAI Codex / Gemini CLI / node).
- **TL-S3**: `cloneWorkspace` is not supported on sprites (deferred to v1.5). Workspace files don't transfer on fork-within-sprites; conversation history does.
- **TL-S4**: No cross-provider migration (sandbox/host ↔ sprites). By design.
- **O-1 (mitigated)**: `LocalDockerProvider.destroy()` keeps the workspace volume for resume safety; the volume orphans after the entity's terminal DELETE. Mitigation: `pnpm cleanup:volumes`.

## Examples

### Entity handler: spawn a coding-agent and await its reply

```ts
import { registerCodingAgent, LocalDockerProvider, HostProvider, StdioBridge,
         createSpritesProviderIfConfigured } from '@electric-ax/coding-agents'

// In your server bootstrap (called once):
registerCodingAgent(registry, {
  providers: {
    sandbox: new LocalDockerProvider(),
    host: new HostProvider(),
    ...(createSpritesProviderIfConfigured()
      ? { sprites: createSpritesProviderIfConfigured()! }
      : {}),
  },
  bridge: new StdioBridge(),
})

// In any entity handler:
registry.define('my-orchestrator', {
  async handler(ctx, wake) {
    const coder = await ctx.spawnCodingAgent({
      id: 'feature-impl',
      kind: 'claude',
      workspace: { type: 'volume', name: 'feature-branch' },
      initialPrompt: 'Add a sum() helper to src/math.ts and a test.',
      wake: { on: 'runFinished', includeResponse: true },
    })

    if (wake.source?.entityUrl === coder.url) {
      const responseText = wake.payload?.responseText
      if (responseText && !responseText.includes('test')) {
        await coder.send('Please also add the test in src/math.test.ts.')
      }
    }
  },
})
```

### Horton chat: ask Horton to spawn a coder

With the dev server running (`npx electric-ax agents quickstart`):

```
User: Spawn a coding agent and have it create a hello-world Express server in /workspace.
```

Horton calls `spawn_coding_agent`. The coding-agent runs the task and reports back; Horton is woken with the response and reports the result.

### Importing a host session

To resume a Claude session that's already in progress on the local machine:

```ts
const agent = await ctx.spawnCodingAgent({
  id: 'imported-session',
  kind: 'claude',
  target: 'host',
  workspace: { type: 'bindMount', hostPath: '/path/to/project' },
  importNativeSessionId: 'abc123def456',
})
```

The handler reads `~/.claude/projects/<sanitised-realpath>/<session-id>.jsonl` on first wake, so `claude --resume <session-id>` on the same machine sees the same conversation history that the agent is working with.

CLI shortcut:

```bash
pnpm -C packages/coding-agents build
electric-ax-import-claude --workspace /path/to/proj --session-id <claude-session-id>
```

## Related

- [Horton agent](./agents/horton) — the assistant that uses `spawn_coding_agent` / `prompt_coding_agent`.
- [Worker agent](./agents/worker) — lightweight isolated subagent without session continuity.
- [Spawning and coordinating](/docs/agents/usage/spawning-and-coordinating) — `ctx.spawn`, `ctx.observe`, and wake semantics.
- [Defining entities](/docs/agents/usage/defining-entities) — entity types and state collections.
- [Implementation findings](https://github.com/electric-sql/electric/blob/main/docs/superpowers/plans/2026-05-02-coding-agents-fly-sprites.md#implementation-findings--round-2-2026-05-03) — round-2 sprites fixes, exec protocol details, and the bug-hunt report.
