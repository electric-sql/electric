---
title: Integrating new providers and kinds
titleTemplate: "Coding Agent - Electric Agents"
description: >-
  Bridge and SandboxProvider interfaces, the conformance contract, and how to add a new CLI kind or sandbox.
outline: [2, 3]
---

# Integrating new providers and kinds

Two seams expose the package for extension: the **CLI side** (a `Bridge` plus per-kind `CodingAgentAdapter` registrations) and the **sandbox side** (a `SandboxProvider` implementation). Both have a single shipped impl plus a `runSandboxProviderConformance` / `runCodingAgentsIntegrationConformance` contract that any new implementation must pass.

## Bridges — adding a new coding-agent kind

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

[`StdioBridge`](https://github.com/electric-sql/electric/blob/main/packages/coding-agents/src/bridge/stdio-bridge.ts) is the only implementation today. It builds argv via the per-kind adapter, pipes the prompt over stdin (or argv), drains stdout, and normalises raw lines into `agent-session-protocol` events. Adding a kind means registering an adapter — the bridge itself doesn't change.

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

  // postMaterialiseCommand?({ homeDir, sessionId }) {     // optional — runs after copyTo writes
  //   return ['sh', '-c', `mycoder import ${target} && rm ${target}`]
  // },
})
```

Plus, if the CLI's stdout isn't already in `agent-session-protocol` shape, wire a normaliser in `bridge/stdio-bridge.ts`. The shipped impls live in [`agents/`](https://github.com/electric-sql/electric/blob/main/packages/coding-agents/src/agents/) — claude/codex use the protocol's `normalize()`; opencode uses a local `normalizeOpencode` because its native shape diverges.

`promptDelivery: 'stdin'` is preferred — it sidesteps `ARG_MAX` (~256 KB on Linux). The bridge enforces an upstream cap of 900 KB per prompt regardless of delivery.

### Per-kind adapter shape

| Field                    | Purpose                                                                          |
| ------------------------ | -------------------------------------------------------------------------------- |
| `kind`                   | `'claude' \| 'codex' \| 'opencode' \| ...` — extends the union via declaration merging. |
| `cliBinary`              | Binary name (must be on PATH inside the sandbox).                                |
| `defaultEnvVars`         | List of env var names to forward from `process.env` to the sandbox per turn.     |
| `buildCliInvocation`     | Builds argv tail and decides `'stdin' \| 'argv'` prompt delivery.                |
| `probeCommand`           | Exit 0 if the resume file exists, 1 if not — used to skip materialise.           |
| `materialiseTargetPath`  | Where to write the captured transcript so the CLI finds it on resume.            |
| `captureCommand`         | Reads the transcript from disk, base64-encodes, outputs to stdout.               |
| `postMaterialiseCommand` | Optional — runs after `copyTo` writes the file (e.g. opencode's `import` step).  |

## Sandbox providers — adding a new sandbox

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
import {
  registerCodingAgent,
  LocalDockerProvider,
  HostProvider,
  StdioBridge,
  createSpritesProviderIfConfigured,
} from '@electric-ax/coding-agents'
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

Widening `target: 'sandbox' | 'host' | 'sprites'` to include a new value is a 3-step change:

1. Schema enum (`entity/collections.ts` + `entity/messages.ts`),
2. `LifecycleManager.providers` shape, and
3. The `RegisterCodingAgentDeps.providers` type.

Forgetting any one of them is a runtime no-op. The conformance test catches it within seconds.

### Provider-side considerations

- **`instanceId` must change across `destroy` + recreate.** L1.2 enforces this. For sprites we use the platform's UUID; for LocalDocker the docker container ID.
- **`start` is idempotent per `agentId`.** L1.1 / L2.2 enforce this. A second call within the same process should return the existing instance without re-running expensive setup.
- **`cloneWorkspace` is optional.** Set `supportsCloneWorkspace: true` on the conformance config to opt in to L1.9.
- **`recover()` should return an empty list if your provider can't enumerate prior sandboxes.** Set `supportsRecovery: false` on the conformance config to skip L1.4.

### Workspace fundamentals (sprites caveat)

For LocalDocker, the workspace is a separate Docker volume — multiple agents can mount the same volume, and the volume survives `destroy()`. For sprites, **the sprite IS the workspace**: each agentId gets its own sprite, the FS lives inside it, and `destroy()` deletes everything. Sprites cannot share workspaces. The L2 conformance fixture has a `supportsSharedWorkspace: false` flag that skips L2.5 (workspace persists across teardown) and L2.6 (shared lease serialisation) for providers with this property.

## Conformance contract

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
| L2.5 | Workspace persists across teardown (gate via `supportsSharedWorkspace`)                                         |
| L2.6 | Shared-workspace lease serialises concurrent runs (gate via `supportsSharedWorkspace`)                         |
| L2.7 | Convert mid-conversation switches kind (claude → codex etc.)                                                    |
| L2.8 | Fork into sibling inherits source events                                                                        |

### Running conformance

```bash
DOCKER=1                                                       pnpm -C packages/coding-agents test test/integration/local-docker-conformance.test.ts
HOST_PROVIDER=1                                                pnpm -C packages/coding-agents test test/integration/host-provider-conformance.test.ts
SPRITES=1 SPRITES_TOKEN=...                                    pnpm -C packages/coding-agents test test/integration/fly-sprites-conformance.test.ts
```

A new provider's test file follows the shipped pattern — declare `createProvider`, `scratchWorkspace`, `target`, and any capability flags (`supportsRecovery`, `supportsCloneWorkspace`, `supportsSharedWorkspace`).
