# Sandbox Agents Design

Run coding agents (Claude Code, Codex, etc.) inside isolated sandbox environments (Docker, E2B, etc.) with full session streaming via durable streams and agent-session-protocol parsing.

## Goals

1. **Generic sandbox abstraction** — pluggable providers for Docker, E2B, Firecracker, etc.
2. **Full session streaming** — every agent event (tool calls, assistant messages, thinking, errors) captured and rendered in the UI via entity stream collections.
3. **Durable stream I/O** — a single shared durable stream for both input (prompts) and output (agent events). No direct stdin/stdout coupling.
4. **Configurable initial state** — API keys, env vars, volumes injected into the sandbox.
5. **Entity model** — sandbox agents are regular entities, spawned and observed like any other.

## Architecture

### Layered Design

Three independent layers composed by a generic sandbox entity handler:

| Layer | Responsibility |
|---|---|
| **SandboxProvider** | Container lifecycle only — create, destroy. Receives stream URL as config. |
| **SessionProtocolBridge** | Runtime-side: tails the durable stream, parses agent-session-protocol JSONL, writes to entity stream collections. Sends prompts by appending `user_message` events. |
| **SandboxEntity handler** | Composes provider + bridge. Manages lifecycle across wakes. |

A fourth component, the **stream bridge**, runs inside the container and connects the agent CLI's stdio to the durable stream.

### Data Flow

```
Parent Entity                    Runtime                          Container
     │                              │                                │
     │ spawn('sandbox-claude',      │                                │
     │   'sc-1', { prompt })        │                                │
     │─────────────────────────────>│                                │
     │                              │  1. Create durable stream      │
     │                              │  2. provider.create(config)    │
     │                              │───────────────────────────────>│
     │                              │                                │
     │                              │     stream-bridge starts       │
     │                              │     tails stream for prompts   │
     │                              │                                │
     │                              │  3. bridge.sendPrompt(text)    │
     │                              │     (appends user_message      │
     │                              │      to durable stream)        │
     │                              │                                │
     │                              │                   stream-bridge│
     │                              │                   reads prompt │
     │                              │                   pipes to     │
     │                              │                   agent stdin  │
     │                              │                                │
     │                              │                   agent writes │
     │                              │                   JSONL stdout │
     │                              │                                │
     │                              │                   stream-bridge│
     │                              │                   appends to   │
     │                              │<──────────────── durable stream│
     │                              │                                │
     │                              │  4. bridge parses events       │
     │                              │     writes to entity stream    │
     │                              │     collections (runs, steps,  │
     │                              │     toolCalls, texts, etc.)    │
     │                              │                                │
     │  observe → wake on           │                                │
     │  runFinished                 │                                │
     │<─────────────────────────────│                                │
```

## Component Specifications

### SandboxProvider Interface

```typescript
interface SandboxConfig {
  /** Container image (e.g., "my-claude-agent:latest") */
  image: string
  /** Environment variables injected into the container (API keys, etc.) */
  env?: Record<string, string>
  /** Volume mounts for workspace/artifacts */
  volumes?: Array<{ host: string; container: string; mode?: 'ro' | 'rw' }>
  /** Command to run inside the container (e.g., ["claude", "--output-format", "stream-json"]) */
  command: Array<string>
  /** Working directory inside the container */
  workdir?: string
  /** Resource limits */
  limits?: {
    memoryMb?: number
    cpus?: number
    timeoutMs?: number
  }
  /** Single durable stream URL for all I/O (agent-session-protocol JSONL) */
  streamUrl: string
}

interface SandboxInstance {
  /** Unique instance identifier (container ID, VM ID, etc.) */
  id: string
  /** Current status */
  status(): 'running' | 'stopped' | 'failed'
  /** Stop and clean up */
  destroy(): Promise<void>
}

interface SandboxProvider {
  readonly name: string
  /** Create and start a sandbox container */
  create(config: SandboxConfig): Promise<SandboxInstance>
}
```

The provider passes `streamUrl` to the container via the `AGENT_STREAM_URL` environment variable. The container's stream bridge uses this to connect.

### SessionProtocolBridge

Runtime-side component that tails the shared durable stream and maps agent-session-protocol events to entity stream collections.

```typescript
import type { NormalizedEvent, AgentType } from 'agent-session-protocol'

interface SessionProtocolBridgeConfig {
  /** Shared durable stream URL */
  streamUrl: string
  /** The entity's stream DB to write parsed events into */
  db: EntityStreamDBWithActions
  /** Agent type for normalization (claude, codex, etc.) */
  agentType: AgentType
}

interface SessionProtocolBridge {
  /** Start tailing and parsing agent output events */
  start(): Promise<void>
  /** Stop tailing */
  stop(): Promise<void>
  /** Send a prompt — appends a user_message event to the stream */
  sendPrompt(text: string): Promise<void>
}
```

#### Event Mapping

| Protocol Event | Entity Collection | Notes |
|---|---|---|
| `session_init` | `runs` (status: `started`) | New run created |
| `assistant_message` | `texts` + `textDeltas` | Text output streaming |
| `thinking` | `reasoning` | Extended thinking content |
| `tool_call` | `toolCalls` (status: `started`) | Tool name + args |
| `tool_result` | `toolCalls` (status: `completed`/`failed`) | Updates matching tool call by `callId` |
| `permission_request` | `toolCalls` (status update) | Could surface to parent entity |
| `turn_complete` | `steps` (status: `completed`) + usage metadata | Step finalized |
| `turn_aborted` | `steps` + `errors` | Abnormal end |
| `error` | `errors` | Error recorded |
| `session_end` | `runs` (status: `completed`) | Run finalized |

The bridge ignores `user_message` events (those are prompts the runtime itself wrote).

### Sandbox Entity Handler

Factory function that returns an `EntityDefinition`:

```typescript
interface SandboxEntityConfig {
  /** Which provider to use */
  provider: SandboxProvider
  /** Container image */
  image: string
  /** Agent type running inside (claude, codex, etc.) */
  agentType: AgentType
  /** Command to start the agent */
  command: Array<string>
  /** Environment variables (API keys, etc.) */
  env?: Record<string, string>
  /** Volume mounts for workspace/artifacts */
  volumes?: Array<{ host: string; container: string; mode?: 'ro' | 'rw' }>
  /** Resource limits */
  limits?: SandboxConfig['limits']
}

function createSandboxEntity(config: SandboxEntityConfig): EntityDefinition
```

#### Entity Lifecycle

**First wake:**
1. Create durable stream for sandbox I/O
2. Start container via `provider.create()` (stream URL passed in config)
3. Start `SessionProtocolBridge` (tail stream, parse events into entity collections)
4. Send initial prompt from `ctx.args.prompt` via `bridge.sendPrompt()`

**Subsequent wakes (inbox message):**
1. Extract prompt text from inbox message
2. Call `bridge.sendPrompt(text)` (appends `user_message` to the shared stream)

**Shutdown (session_end detected or entity destroyed):**
1. `bridge.stop()`
2. `sandbox.destroy()`
3. Mark run as `completed` in entity stream

#### Registration

```typescript
import { defineEntity } from '@electric-sql/agents-runtime'
import { createSandboxEntity } from '@electric-sql/agents-runtime/sandbox'
import { DockerProvider } from '@electric-sql/agents-runtime/sandbox/docker'

defineEntity('sandbox-claude', createSandboxEntity({
  provider: new DockerProvider(),
  image: 'my-claude-agent:latest',
  agentType: 'claude',
  command: ['claude', '--output-format', 'stream-json'],
  env: { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY! },
  volumes: [{ host: '/tmp/workspaces', container: '/workspace', mode: 'rw' }],
}))
```

#### Usage from Parent Entity

```typescript
const sandbox = await ctx.spawn('sandbox-claude', 'task-1', {
  prompt: 'Fix the authentication bug in src/auth.ts',
})

// Observe for completion
await ctx.observe(sandbox.entityUrl, {
  wake: { on: 'runFinished' },
})

// Send follow-up prompt
ctx.send(sandbox.entityUrl, { text: 'Also add tests for the fix' })
```

### Stream Bridge (In-Container Component)

Runs inside the container as the entrypoint. Bridges the agent CLI's stdio to the durable stream.

```
┌─── Container ─────────────────────────────────┐
│                                               │
│  stream-bridge (entrypoint)                   │
│    ├── tails stream for user_message events   │
│    │   └── pipes prompt text to agent stdin   │
│    ├── reads agent stdout (JSONL)             │
│    │   └── appends events to stream           │
│    └── reads agent stderr                     │
│        └── appends error events to stream     │
│                                               │
│  wraps: claude / codex / any CLI agent        │
│                                               │
└───────────────────────────────────────────────┘
```

**Configuration:** The bridge reads `AGENT_STREAM_URL` from its environment. The agent command is passed as arguments:

```bash
stream-bridge claude --output-format stream-json
```

**Responsibilities:**
- Spawn the agent process with the given command
- Tail the durable stream via SSE for `user_message` events, pipe their `text` to agent stdin
- Read agent stdout line-by-line. If the agent outputs its native format (e.g., Claude Code JSONL), normalize to agent-session-protocol events via `normalize()` before appending to the stream. If the agent already outputs agent-session-protocol JSONL, pass through directly.
- Read agent stderr, emit as `error` events to the stream
- On agent process exit, append `session_end` event

### Docker Provider

First concrete `SandboxProvider` implementation.

```typescript
import Docker from 'dockerode'

interface DockerProviderConfig {
  /** Docker socket path (default: /var/run/docker.sock) */
  socketPath?: string
  /** Docker host URL (alternative to socket) */
  host?: string
  /** Network to attach containers to */
  network?: string
  /** Auto-pull images if not present */
  autoPull?: boolean
}

class DockerProvider implements SandboxProvider {
  readonly name = 'docker'

  constructor(config?: DockerProviderConfig)

  async create(config: SandboxConfig): Promise<SandboxInstance> {
    // 1. Pull image if autoPull && not present locally
    // 2. Create container:
    //    - Env: config.env + { AGENT_STREAM_URL: config.streamUrl }
    //    - Binds: config.volumes as bind mounts
    //    - Cmd: config.command (passed to stream-bridge)
    //    - WorkingDir: config.workdir
    //    - HostConfig.Memory: config.limits.memoryMb * 1024 * 1024
    //    - HostConfig.NanoCpus: config.limits.cpus * 1e9
    //    - NetworkingConfig: provider network if configured
    // 3. Start container
    // 4. Return DockerSandboxInstance wrapping container reference
  }
}
```

## Package Structure

```
packages/agents-runtime/src/sandbox/
  ├── types.ts                 # SandboxProvider, SandboxConfig, SandboxInstance
  ├── sandbox-entity.ts        # createSandboxEntity() — handler factory
  ├── session-bridge.ts        # SessionProtocolBridge — stream tailing + event mapping
  ├── providers/
  │   └── docker.ts            # DockerProvider
  └── index.ts                 # Public exports

packages/stream-bridge/         # Runs inside containers
  ├── src/
  │   ├── cli.ts               # Entrypoint: stream-bridge <agent-command...>
  │   ├── agent-io.ts          # Spawn agent process, manage stdin/stdout/stderr
  │   └── stream-io.ts         # Durable stream read (SSE tail) / write (HTTP append)
  ├── package.json
  └── Dockerfile.base          # Base image with bridge pre-installed
```

### Dependencies

- `agent-session-protocol` — normalize/denormalize agent JSONL, event types
- `dockerode` — Docker provider (optional peer dependency, only needed if using Docker)
- `@electric-sql/client` — durable stream client (used by both runtime bridge and stream-bridge)

### Exports

```typescript
// @electric-sql/agents-runtime/sandbox
export { createSandboxEntity } from './sandbox-entity'
export { SessionProtocolBridge } from './session-bridge'
export type { SandboxProvider, SandboxConfig, SandboxInstance, SandboxEntityConfig } from './types'

// @electric-sql/agents-runtime/sandbox/docker
export { DockerProvider } from './providers/docker'
export type { DockerProviderConfig } from './providers/docker'
```

## Base Docker Image

Users build sandbox images on top of a base that has the stream bridge pre-installed:

```dockerfile
FROM electric-sql/stream-bridge:latest

# Install the coding agent
RUN npm install -g @anthropic-ai/claude-code

# API key injected at runtime via env
ENV ANTHROPIC_API_KEY=""
```

The base image's entrypoint is `stream-bridge`, so the user only needs to ensure their agent CLI is available in PATH. The `command` in `SandboxEntityConfig` is passed as arguments to the bridge.

## Testing Strategy

- **SandboxProvider**: Mock provider for unit tests — returns a fake `SandboxInstance` without Docker.
- **SessionProtocolBridge**: Feed pre-recorded agent-session-protocol JSONL fixtures into the bridge, assert correct entity collection writes.
- **Stream bridge**: Unit test stdin/stdout/stream wiring with a mock agent process and mock durable stream.
- **Integration**: Docker provider + real container + test agent that emits known JSONL → verify end-to-end entity stream population.
