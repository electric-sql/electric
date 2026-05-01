---
title: Coding Agent
titleTemplate: "... - Electric Agents"
description: >-
  Long-lived, sandboxed Claude Code sessions with persistent Docker workspaces — the coding-agent platform primitive.
outline: [2, 3]
---

# Coding Agent

`coding-agent` is the built-in entity type for long-lived Claude Code sessions. By default each agent runs the `claude` CLI inside a Docker container with a persistent workspace (`target: 'sandbox'`); you can also opt into running directly on the host machine with no isolation (`target: 'host'`), which is useful for importing existing local Claude sessions or for environments where Docker is unavailable.

**Source:**
- Entity, lifecycle, and sandbox: [`packages/coding-agents/src/`](https://github.com/electric-sql/electric/blob/main/packages/coding-agents/src/)
- Runtime API: [`packages/agents-runtime/src/types.ts`](https://github.com/electric-sql/electric/blob/main/packages/agents-runtime/src/types.ts)
- Horton tools: [`packages/agents/src/tools/spawn-coding-agent.ts`](https://github.com/electric-sql/electric/blob/main/packages/agents/src/tools/spawn-coding-agent.ts), [`packages/agents/src/tools/prompt-coding-agent.ts`](https://github.com/electric-sql/electric/blob/main/packages/agents/src/tools/prompt-coding-agent.ts)

## When to use it

| Scenario | Use |
| --- | --- |
| Multi-turn, stateful code edits with filesystem isolation | `coding-agent` |
| Multi-file changes that benefit from Claude Code's native tool set | `coding-agent` |
| A parent entity that needs to delegate coding work and be notified on completion | `ctx.spawnCodingAgent` |
| Conversational assistant that orchestrates coding as one of many tasks | Horton + `spawn_coding_agent` tool |
| Short one-shot LLM completion or structured extraction | `ctx.useAgent` / `worker` |
| Running a known shell command in isolation | `worker` |

Use `coding-agent` when the task benefits from session continuity across turns — the agent can read its own prior work, iterate on a file, run tests, and resume exactly where it left off across idle hibernations.

## Target

Each `coding-agent` can run in one of two targets: **sandbox** (default) or **host**.

**Sandbox** (`target: 'sandbox'`) runs the CLI inside a Docker container with full process and filesystem isolation. The container uses a persistent workspace volume or bind-mount, ensuring the filesystem layout is fresh on each cold-boot. This is the secure default for multi-tenant or untrusted workloads.

**Host** (`target: 'host'`) runs the CLI directly on the host machine as the user running agents-server, with full filesystem and network access. Pick host mode when you want to import a local Claude session (restore an existing workflow), or when sandbox isolation isn't required or isn't possible in your environment (e.g., Docker is unavailable).

**Trust and access:** Host mode runs with the permissions of the agents-server process — typically the user running the server. Sandbox mode isolates the CLI's filesystem and process namespace inside the container.

**Workspace constraints:**
- `target: 'host'` requires `workspaceType: 'bindMount'`. A local Claude session lives at `~/.claude/projects/<sanitised-cwd>/<sessionId>.jsonl` on disk; the host target reads from and writes back to this location after each turn.
- `target: 'sandbox'` supports both `volume` and `bindMount`. Volume workspaces are sandbox-only and do not correspond to a host path.
- **Aligned path for bind-mounts:** When using a bind-mount workspace, the container's cwd matches the host cwd because the bind-mount is mounted at `realpath(hostPath)` inside the container (not at a fixed `/workspace`). This means `~/.claude/projects/<sanitised-cwd>/...` lines up across both targets without rewriting transcripts, allowing seamless session migration. Volume workspaces still mount at `/workspace` (sandbox-only).

## Importing a host session

To resume a Claude session that was already in progress on the local machine, spawn a coding-agent with `target: 'host'` and a bind-mount workspace pointing to the project directory:

```ts
const agent = await ctx.spawnCodingAgent({
  id: 'imported-session',
  kind: 'claude',
  target: 'host',  // Run directly on the host
  workspace: { type: 'bindMount', hostPath: '/path/to/project' },
  importNativeSessionId: '<session-id>',  // e.g., 'abc123def456'
})
```

On first wake, the handler reads `~/.claude/projects/<sanitised-realpath>/<session-id>.jsonl` and the agent resumes that session. The agent reads and writes to the same location that `claude --resume` uses locally, keeping the history in sync.

**CLI shortcut:** After building the agents package, use the import command to spawn an agent that resumes a local session:

```sh
pnpm -C packages/coding-agents build

electric-ax-import-claude \
  --workspace /path/to/proj \
  --session-id <claude-session-id>
```

This is equivalent to calling `ctx.spawnCodingAgent` with the settings above, then sending an initial prompt.

**Note:** Host-target agents capture the transcript after each turn and write it back to `~/.claude/projects/<sanitised-realpath>/<session-id>.jsonl`. Imported sessions stay in sync with the local `claude` CLI — `claude --resume <session-id>` on the machine will see the same conversation history that the agent is working with.

## Lifecycle

A `coding-agent` moves through seven states:

```
                    ┌──────────┐
        spawn ─────▶│   COLD   │◀── idle-timeout fires (& !pinned)
                    └────┬─────┘    or stop() called
                         │ send (prompt received)
                         ▼
                    ┌──────────┐
                    │ STARTING │  provider.start() + resume materialise
                    └────┬─────┘
       cold-boot failed  │ ready
              ┌──────────┴──────────┐
              ▼                     ▼
         ┌────────┐            ┌──────────┐
         │ ERROR  │            │   IDLE   │◀──────┐
         └────┬───┘            └────┬─────┘       │
              │ next prompt         │ send         │ runTurn done
              ▼                     ▼              │
         ┌────────┐            ┌──────────┐        │
         │  COLD  │◀─────┐     │ RUNNING  │────────┘
         └────────┘       │    └────┬─────┘
                          │         │ stop() or destroy()
                          │         ▼
                          │    ┌──────────┐
                          └────│ STOPPING │  SIGTERM → SIGKILL after 5 s
                          COLD └──────────┘
                                    │ destroy() completes
                                    ▼
                              ┌───────────┐
                              │ DESTROYED │  tombstone; no further ops
                              └───────────┘
```

**State transitions:**

| Transition | Trigger |
| --- | --- |
| `COLD → STARTING` | A prompt is received and the sandbox is not running. |
| `STARTING → IDLE` | `provider.start()` succeeds and (if resuming) the transcript is materialised into the sandbox. |
| `STARTING → ERROR` | Cold-boot exceeds `coldBootBudgetMs` (30 s default) or the provider fails. |
| `IDLE → RUNNING` | The workspace lease is acquired and `bridge.runTurn()` starts. |
| `RUNNING → IDLE` | `runTurn()` completes successfully. The idle timer is armed (unless pinned or `keepWarm`). |
| `RUNNING → ERROR` | `runTurn()` exits non-zero or exceeds `runTimeoutMs` (30 min default). |
| `ERROR → COLD` | The next prompt triggers a fresh start attempt. |
| `IDLE/RUNNING/COLD → STOPPING` | `stop()` is called explicitly. |
| `STOPPING → COLD` | The sandbox is torn down. |
| `any → DESTROYED` | `destroy()` completes. The workspace ref is dropped. |

**Idle hibernation.** After a run completes, if the agent is not pinned and `keepWarm` is false, an idle timer arms (default 5 minutes). When it fires, the sandbox container is stopped and status transitions to `COLD`. The workspace volume and the entity's durable stream survive — only the in-memory process and the container's tmpfs (`~/.claude`) are discarded.

**Host target lifecycle note.** For `target: 'host'`, the `STARTING` step is essentially a no-op (there is no container to start), but the state machine still cycles through it for consistency with the sandbox target. The agent transitions from `COLD → STARTING → IDLE` the same way, then runs `claude` directly on the host when prompted.

**Crash recovery.** On `agents-server` restart, `LocalDockerProvider.recover()` scans Docker containers labeled `electric-ax.agent-id`. On the next handler entry per agent, the reconcile step compares durable state against the live container state and marks any orphaned in-flight runs as `failed: orphaned`.

## Workspace types

Each `coding-agent` has a workspace — the filesystem the CLI operates in.

### Named volume

```ts
workspace: { type: 'volume', name: 'my-project' }
// identity: 'volume:my-project'
// Docker volume: 'coding-agent-workspace-my-project'
```

The volume is created if it does not exist and persists until the last referent calls `destroy()`. Omitting `name` generates a slug from the agent id — unique to that agent.

### Bind mount

```ts
workspace: { type: 'bindMount', hostPath: '/Users/me/projects/my-repo' }
// identity: 'bindMount:/Users/me/projects/my-repo'
```

The host directory is mounted at `realpath(hostPath)` inside the container (path-aligned with the host). Volume workspaces mount at `/workspace`. The runtime never deletes a bind-mount path; `destroy()` only drops the registry entry.

### Sharing workspaces

Two agents with the same workspace identity share the volume. Concurrent `IDLE` agents on a shared workspace coexist freely. Concurrent `RUNNING` agents are serialized: the second agent's `runTurn` waits for the first to release the per-identity workspace lease before it can execute.

```ts
// Agent A and Agent B share the same volume
const agentA = await ctx.spawnCodingAgent({ id: 'impl', kind: 'claude',
  workspace: { type: 'volume', name: 'feature-branch' }, ... })

const agentB = await ctx.spawnCodingAgent({ id: 'review', kind: 'claude',
  workspace: { type: 'volume', name: 'feature-branch' }, ... })
// agentB.runTurn waits if agentA is RUNNING
```

## Resume semantics

When a `coding-agent` hibernates (sandbox stopped) and is later prompted again, the prior Claude Code session is restored losslessly:

1. **STARTING:** `provider.start()` creates a fresh container with an empty tmpfs at `~/.claude`.
2. **Resume materialise:** The handler reads the `nativeJsonl` collection, which holds a single blob (`key='current'`) containing the full contents of claude's on-disk transcript from the last successful turn. This blob is written back to `~/.claude/projects/<sanitized-cwd>/<sessionId>.jsonl` inside the new container.
3. **IDLE:** The workspace lease is acquired.
4. **RUNNING:** `bridge.runTurn()` runs `claude --resume <nativeSessionId> ...`. Claude finds the restored transcript file and continues the session from where it left off.

If the `nativeJsonl` collection is empty (first ever turn, or all prior turns failed before producing output), step 2 is skipped and the CLI starts a fresh session.

**"Lossless" means** the CLI sees its own prior turns — including tool calls, tool results, and assistant messages — exactly as it wrote them. The `events` collection (normalized events) is the portable representation consumed by the UI and parent entities; `nativeJsonl` is the CLI-specific representation used only for resume.

**Resume failure modes:**
- If the transcript blob is missing or corrupt: `status='error'`, `lastError` set. Next prompt retries from scratch.
- If `claude --resume` rejects the session ID (returns exit 1 with "No conversation found"): the session ID is cleared and the next prompt cold-boots a fresh session.

## API reference

### `ctx.spawnCodingAgent(opts)`

Available on `HandlerContext` inside any entity handler. Returns a `CodingAgentHandle`.

```ts
interface SpawnCodingAgentOptions {
  /** Stable id, scoped to the spawning entity. Used to route the entity URL. */
  id: string

  /** CLI to run. Currently only 'claude' is supported. */
  kind: 'claude'

  /**
   * Workspace mount.
   *   { type: 'volume', name: 'foo' }    → named Docker volume 'coding-agent-workspace-foo', mounted at /workspace
   *   { type: 'volume' }                 → volume named from the agent id (per-agent default)
   *   { type: 'bindMount', hostPath: P } → host directory mounted at realpath(P) inside the container
   */
  workspace:
    | { type: 'volume'; name?: string }
    | { type: 'bindMount'; hostPath: string }

  /** Runtime target: 'sandbox' (Docker, default) or 'host' (no isolation). */
  target?: 'sandbox' | 'host'

  /** Native session ID to import and resume. Used with target: 'host'. */
  importNativeSessionId?: string

  /** First prompt, queued before the entity's first wake. Optional. */
  initialPrompt?: string

  /**
   * When to wake the parent entity.
   * Only 'runFinished' is supported. Defaults to { on: 'runFinished', includeResponse: true }.
   */
  wake?: { on: 'runFinished'; includeResponse?: boolean }

  /** Lifecycle overrides. */
  lifecycle?: {
    /** Idle timeout in ms before the sandbox hibernates. Default: 300000 (5 min). */
    idleTimeoutMs?: number
    /** Keep the sandbox warm indefinitely — disables idle hibernation. Default: false. */
    keepWarm?: boolean
  }
}
```

### `ctx.observeCodingAgent(id)`

Attach to an existing `coding-agent` without spawning. Returns a `CodingAgentHandle`.

```ts
const handle = await ctx.observeCodingAgent('my-coder-id')
```

### `CodingAgentHandle`

```ts
interface CodingAgentHandle {
  /** Entity URL, e.g. '/coding-agent/abc123'. */
  readonly url: string
  readonly kind: 'claude'

  /** Queue a prompt. Resolves when durably enqueued (not when the CLI replies). */
  send(prompt: string): Promise<void>

  /** Async iterable over normalized events. 'now' (default) tails; 'start' replays from the beginning. */
  events(opts?: { since?: 'start' | 'now' }): AsyncIterable<NormalizedEvent>

  /**
   * Synchronous snapshot of agent state.
   * Note: workspace.sharedRefs is always 1 when called from a client handler context.
   * Server-side handler contexts see the live refcount from WorkspaceRegistry.
   */
  state(): {
    status: 'cold' | 'starting' | 'idle' | 'running' | 'stopping' | 'error' | 'destroyed'
    pinned: boolean
    workspace: { identity: string; sharedRefs: number }
    lastError?: string
    runs: ReadonlyArray<RunSummary>
  }

  /** Increment the pin refcount. Prevents idle hibernation while pinned. */
  pin(): Promise<void>

  /** Decrement the pin refcount. Idle timer re-arms when count reaches zero. */
  release(): Promise<void>

  /** Tear down the sandbox. Status → COLD. Workspace and stream survive. */
  stop(): Promise<void>

  /** stop() + drop workspace refcount + tombstone the entity stream. Irreversible. */
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

## Pin / Release / Stop / Destroy

| Operation | What it does | Status after | Workspace after | Stream after |
| --- | --- | --- | --- | --- |
| `pin()` | Increments in-memory refcount. Cancels any armed idle timer. | Unchanged | Unchanged | Unchanged |
| `release()` | Decrements refcount. Re-arms idle timer when count reaches zero. | Unchanged | Unchanged | Unchanged |
| `stop()` | Tears down the container. | `COLD` | Preserved | Preserved |
| `destroy()` | Tears down the container, drops the workspace refcount (volume deleted when last referent), tombstones the entity stream. | `DESTROYED` | Volume deleted if last ref; bind-mount untouched | Tombstoned |

**Pin is reference-counted.** N calls to `pin()` require N calls to `release()` before the idle timer re-arms. Pin counts are in-memory only and reset to zero on server restart.

**`stop()` is reversible.** The next `send()` cold-boots the sandbox and resumes the session. Use `stop()` to free container resources when you know work is paused. Use `destroy()` only when the agent is no longer needed.

## Horton tools

Users chatting with Horton interact with `coding-agent` through two tools. You do not need these tools when authoring your own entities — use `ctx.spawnCodingAgent` directly.

### `spawn_coding_agent`

Creates a new `coding-agent` entity, sends the first prompt, and wakes Horton when the run finishes.

**Parameters:**

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `prompt` | `string` | Yes | First user message. Be concrete: describe the task, files, and expected output. |
| `workspace_name` | `string` | No | Stable Docker volume name. Reuse the same name across Horton sessions to persist state. |
| `idle_timeout_ms` | `number` | No | Milliseconds before the sandbox hibernates. Default: 300000 (5 min). |

**Example Horton prompt:**
```
Spawn a coder and ask it to add a `sum` function to src/math.ts and write a test for it.
```

Horton calls `spawn_coding_agent` with `prompt` set to your request. The resulting agent's URL is returned in `details.agentUrl` so Horton can send follow-up prompts.

**Source:** [`packages/agents/src/tools/spawn-coding-agent.ts`](https://github.com/electric-sql/electric/blob/main/packages/agents/src/tools/spawn-coding-agent.ts)

### `prompt_coding_agent`

Sends a follow-up prompt to an existing `coding-agent`. The prompt is queued on the entity's inbox and runs as the next CLI turn, resuming from prior context.

**Parameters:**

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `coding_agent_url` | `string` | Yes | Entity URL from `spawn_coding_agent`, e.g. `/coding-agent/abc123`. |
| `prompt` | `string` | Yes | Follow-up message. Reference earlier context rather than restating it. |

**Source:** [`packages/agents/src/tools/prompt-coding-agent.ts`](https://github.com/electric-sql/electric/blob/main/packages/agents/src/tools/prompt-coding-agent.ts)

## UI

The web UI at `http://localhost:4437` renders `coding-agent` entities via dedicated components. The sidebar lists all entities; `coding-agent` entries are created through the **Spawn Coding Agent** dialog.

### Status dot

The colored dot next to an entity name reflects the agent's current lifecycle state:

| Color | State | Meaning |
| --- | --- | --- |
| Gray | `cold` | No container running. Workspace persists. |
| Amber | `starting` | Container is starting or transcript is being materialised. |
| Green | `idle` | Container running, no active CLI turn. |
| Blue | `running` | CLI turn in progress. |
| Amber | `stopping` | Container is being torn down. |
| Red | `error` | Last cold-boot or run failed. `lastError` shown in state explorer. |
| Dim gray | `destroyed` | Entity tombstoned. |

### Spawn dialog

Click **New → Coding Agent** in the sidebar to open the spawn dialog:

- **Workspace — Volume / Bind mount toggle.** Volume: optional name (blank = derived from agent id). Bind mount: absolute host path.
- **Initial prompt.** Optional first message sent before the first wake.

### Header buttons

When a `coding-agent` is selected, three lifecycle buttons appear in the header:

| Button | Action | Enabled when |
| --- | --- | --- |
| **Pin** | `POST /send { from: 'user', type: 'pin' }` — prevents idle hibernation. | `sessionMeta.pinned === false` |
| **Release** | `POST /send { from: 'user', type: 'release' }` — re-arms idle timer. | `sessionMeta.pinned === true` |
| **Stop** | `POST /send { from: 'user', type: 'stop' }` — tears down the sandbox. | Any state |

The `from` field is required by the `/send` endpoint (HTTP 400 if absent). Pass `'user'` for
UI-initiated sends. See the [programmatic client docs](../usage/programmatic-runtime-client#messages)
for the full list of accepted values.

The global **Kill** button (header, far right) sends `{ type: 'destroy' }` — drops the workspace ref and tombstones the entity.

### Chat timeline

The timeline interleaves two collections:

- **`events`** — normalized `agent-session-protocol` events from the CLI. Rendered as conversation rows: user messages, assistant messages, tool calls, tool results, and thinking steps.
- **`lifecycle`** — infrastructure events rendered as muted single-line entries (e.g., "▸ sandbox started", "▸ resume.restored (bytes=4821)", "▸ pin (count=1)"). Click to expand the `detail` field.

The timeline auto-scrolls while a run is in progress and shows a loading indicator when `status === 'starting'` or `status === 'running'`.

### State explorer

The collapsible state panel below the timeline shows the raw `sessionMeta` row, the `runs` table, and a count of `events` and `lifecycle` rows — useful for debugging.

## Examples

### Entity handler: spawn a coding agent and await its reply

```ts
import { registerCodingAgent, LocalDockerProvider, StdioBridge } from '@electric-ax/coding-agents'

// In your server bootstrap (called once):
registerCodingAgent(registry, {
  provider: new LocalDockerProvider(),
  bridge: new StdioBridge(),
})

// In any entity handler:
registry.define('my-orchestrator', {
  async handler(ctx, wake) {
    // Spawn a coding agent for the first prompt, or re-observe if it already exists.
    const coder = await ctx.spawnCodingAgent({
      id: 'feature-impl',
      kind: 'claude',
      workspace: { type: 'volume', name: 'feature-branch' },
      initialPrompt: 'Add a `sum(a, b)` function to src/math.ts and write a test.',
      wake: { on: 'runFinished', includeResponse: true },
    })

    // The handler returns here. The runtime wakes this entity again
    // when the coding agent's first run finishes.

    // On the next wake (from runFinished):
    if (wake.source?.entityUrl === coder.url) {
      const responseText = wake.payload?.responseText
      // inspect the response and send follow-up if needed
      if (responseText && !responseText.includes('test')) {
        await coder.send('Please also add a test in src/math.test.ts.')
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

Horton calls `spawn_coding_agent` with `prompt` set to the task. It ends its turn; when the coding agent's run finishes, Horton is woken with the response and reports the result.

To send a follow-up:

```
User: Now have the same coding agent add a /health endpoint.
```

Horton calls `prompt_coding_agent` with the URL from the prior `spawn_coding_agent` result. The agent resumes its session — the container cold-boots if it has hibernated, but the Claude session is restored losslessly.

## Collections

`coding-agent` registers five state collections on its entity stream:

| Collection | Wire type | Key | Description |
| --- | --- | --- | --- |
| `sessionMeta` | `coding-agent.sessionMeta` | `'current'` | Current lifecycle state: status, kind, pinned, workspace identity, error, native session id. |
| `runs` | `coding-agent.runs` | `runId` (nanoid) | One row per CLI turn: status, timestamps, finish reason, response text. |
| `events` | `coding-agent.events` | `<runId>:<seq>` | Normalized `agent-session-protocol` events in order. Used by the timeline and parent wakes. |
| `lifecycle` | `coding-agent.lifecycle` | `<label>:<ts>-<rand>` | Infrastructure events (sandbox start/stop, pin/release, orphan detection, resume restore). Rendered as muted timeline rows. |
| `nativeJsonl` | `coding-agent.nativeJsonl` | `'current'` | Single-row blob: claude's on-disk transcript captured post-turn. Used only for resume. |

Wire-type constants are exported from `@electric-ax/coding-agents`:

```ts
import {
  CODING_AGENT_SESSION_META_COLLECTION_TYPE, // 'coding-agent.sessionMeta'
  CODING_AGENT_RUNS_COLLECTION_TYPE,          // 'coding-agent.runs'
  CODING_AGENT_EVENTS_COLLECTION_TYPE,        // 'coding-agent.events'
  CODING_AGENT_LIFECYCLE_COLLECTION_TYPE,     // 'coding-agent.lifecycle'
  CODING_AGENT_NATIVE_JSONL_COLLECTION_TYPE,  // 'coding-agent.nativeJsonl'
} from '@electric-ax/coding-agents'
```

## Defaults

| Setting | Default | Override via |
| --- | --- | --- |
| `idleTimeoutMs` | 300000 (5 min) | `lifecycle.idleTimeoutMs` in `spawnCodingAgent` |
| `keepWarm` | `false` | `lifecycle.keepWarm` in `spawnCodingAgent` |
| `coldBootBudgetMs` | 30000 | `RegisterCodingAgentDeps.defaults.coldBootBudgetMs` |
| `runTimeoutMs` | 1800000 (30 min) | `RegisterCodingAgentDeps.defaults.runTimeoutMs` |

## Limitations

- **Claude only.** The bridge rejects `kind: 'codex'`. Codex support is planned for a future release.
- **Local Docker only.** The sandbox provider is `LocalDockerProvider` (subprocess-driven Docker CLI). Remote providers (Modal, Fly, E2B) are designed for but not implemented.
- **No shared-workspace UI indicator.** The "shared with N agents" header display is not yet implemented. `state().workspace.sharedRefs` returns `1` in all client contexts.
- **No orphan-container cleanup.** Containers whose entities were destroyed accumulate until manually removed (`docker rm`). The runtime does not clean them on `recover()`.
- **Pin counts reset on server restart.** In-memory only. Re-pin after a restart if needed.
- **No `ctx.deleteEntityStream`.** `destroy()` tombstones the entity (`status='destroyed'`) but does not physically delete the durable stream.
- **No per-event approve/deny.** CLIs run with `--dangerously-skip-permissions`. Interactive permission grants are not supported.

## Related

- [Horton agent](./agents/horton) — the assistant that uses `spawn_coding_agent` / `prompt_coding_agent`.
- [Worker agent](./agents/worker) — lightweight isolated subagent without session continuity.
- [Spawning and coordinating](/docs/agents/usage/spawning-and-coordinating) — `ctx.spawn`, `ctx.observe`, and wake semantics.
- [Implementation review](https://github.com/electric-sql/electric/blob/main/docs/superpowers/specs/notes/2026-04-30-coding-agents-implementation-review.md) — plan vs. implementation divergences, hot spots, and deferred work.
