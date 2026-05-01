# Coding-agents — host target & native session import

**Status:** design approved 2026-05-01
**Audience:** implementers extending `packages/coding-agents`
**Slice:** follows Slice C₁ (no formal slice number — single design sized for one plan)

## Context

The coding-agents subsystem currently runs every `claude` turn inside a Docker
sandbox via `LocalDockerProvider`. This design adds a second execution target
that runs `claude` directly on the host machine, opt-in per spawn, and a way
to import an existing local Claude session (one created by the user running
`claude` natively, outside electric-ax) as the starting state of a coding-agent.

### Motivation

Two related needs:

1. An **escape hatch** for environments where the Docker sandbox is undesirable
   or unavailable (e.g., dev iteration, restricted hosts). Selected per spawn;
   the user accepts that the agent runs without filesystem isolation.
2. **Importing local Claude sessions** captured under `~/.claude/projects/<dir>/`
   into electric-ax, so existing on-host conversations can become long-lived
   coding-agents managed through the agents-server.

These compose: an imported session was created with a host cwd, so the natural
target for resuming it is host mode at that same cwd. The transcript path math
matches and `claude --resume <id>` works without rewriting the JSONL.

### Non-goals

- Cross-target conversion of a session already in flight on a target other
  than its native one (we get this _for free_ in the bind-mount case, but
  there is no UI affordance to deliberately switch targets across runs in
  this slice).
- Host-target support for the `volume` workspace type. Host mode is bind-mount
  only by design.
- Operator-level gating of host mode. Per the user's call, host is always an
  available target; the user makes the trust decision per spawn.
- A browse/pick UI for selecting an existing local session to import. The
  primitive (spawn-time field) and a CLI shortcut land first; a UI affordance
  is a follow-up.

## Decisions

### D1. Per-spawn `target` field

`spawnCodingAgent` arguments gain `target: 'sandbox' | 'host'`, default
`'sandbox'`. `target: 'host'` requires `workspaceType: 'bindMount'`; volume
workspaces are sandbox-only.

### D2. Aligned bind-mount cwd

The Docker sandbox's bind-mount target changes from the hard-coded `/workspace`
to `realpath(hostPath)`. Volume workspaces still mount at `/workspace`. The
container's cwd then matches the host cwd whenever the workspace is a
bind-mount, so:

- Claude's per-cwd transcript dir name (`~/.claude/projects/<sanitised-cwd>/`)
  matches across targets.
- The cwd field embedded in the JSONL matches across targets.
- Cross-target resume of bind-mount agents works without rewriting the
  transcript.

This is a behavior change for existing sandbox+bindMount agents. Per the
user's decision, no migration: pre-existing transcripts captured under the
old `-workspace/` dir are dropped and not carried forward.

### D3. New `HostProvider`

A new `SandboxProvider` implementation that runs `claude` directly on the
host. Bind-mount only. Uses `child_process.spawn` for `exec`, `fs` for
`copyTo`, and an in-memory `Map<agentId, …>` for status. `recover()`
returns `[]`.

Provider env policy matches the docker provider: only `spec.env` plus
per-call `req.env` are exposed to the child, with one exception — `PATH`
is forwarded from `process.env` if not provided, so the `claude` binary
is discoverable.

### D4. Multi-provider routing

`registerCodingAgent` now takes
`providers: { sandbox: SandboxProvider; host: SandboxProvider }`
instead of a single `provider`. The handler always knows the target at
the call site (it has `meta.target` available immediately after first-wake
init), so `LifecycleManager` methods take `target` explicitly:
`ensureRunning(spec)` reads `spec.target`; `status(agentId, target)`,
`destroy(agentId, target)`, and `stop(agentId, target)` resolve the
right provider per call. No internal map needed — the source of truth
is `sessionMeta.target` in the handler's state.

`adoptRunningContainers` polls both providers on startup and returns the
merged `RecoveredSandbox[]` (each entry tagged with its `target`). This
is the only path where the lifecycle layer learns about agents whose
`sessionMeta` it hasn't yet read.

`SandboxSpec` gains `target: 'sandbox' | 'host'` so call sites that
construct a spec carry the routing information; `RecoveredSandbox` gains
`target` for the same reason.

No back-compat shim for the old `provider` field — package is pre-1.0.

### D5. Native session import via `importNativeSessionId`

Spawn args gain `importNativeSessionId?: string`. Required to be paired
with `target: 'host'` (cross-target import isn't in scope: the file lives
on the host's `~/.claude` and must be readable from where the
agents-server runs).

On first wake, if `importNativeSessionId` is set, the handler:

1. Computes the expected on-disk path:
   `~/.claude/projects/<sanitiseCwd(realpath(hostPath))>/<id>.jsonl`.
2. Reads the file. If missing or unreadable → transition `sessionMeta`
   to `error` with a clear `lastError`, append a `lifecycle` row with
   `event: 'import.failed'` and a detail string, and stop.
3. Inserts the bytes into the existing `nativeJsonl` collection
   (key `'current'`, the same row shape used by the post-turn capture
   path).
4. Sets `sessionMeta.nativeSessionId = importNativeSessionId`.
5. Appends a `lifecycle` row with `event: 'import.restored'` and
   `detail: \`bytes=${content.length}\``.

The existing `materialiseResume` path then runs unchanged — for host
mode it writes back into the user's real `~/.claude/projects/...` dir,
which is exactly where `claude --resume` will read from. For an imported
session this overwrites the source file with identical bytes, which is
harmless.

### D6. CLI: `electric-ax-import-claude`

A small TypeScript script at `packages/coding-agents/src/cli/import-claude.ts`,
built by the existing tsdown setup into `dist/cli/import-claude.js`,
with a `bin` entry in `package.json`:

```
electric-ax-import-claude \
  --workspace <hostPath> \
  --session-id <id> \
  [--agent-id <id>] \
  [--server <url>]
```

Behavior: a thin wrapper that calls the existing entity-spawn endpoint
(`PUT /coding-agent/<name>`, see `agents-server/electric-agents-routes.ts`)
with body `{ target: 'host', workspaceType: 'bindMount', workspaceHostPath,
importNativeSessionId }`. The `<name>` defaults to a slug derived from the
session id when `--agent-id` is omitted. Server URL defaults to
`http://localhost:4437` (the dev default in `AGENTS.md`).

Validation up front (so the CLI fails before hitting the server when the
input is obviously wrong):

- `--workspace` exists and is a directory.
- `~/.claude/projects/<sanitiseCwd(realpath(workspace))>/<sessionId>.jsonl`
  exists and is readable. (The handler re-checks server-side; this is just
  an early friendly error.)

## Components

### `packages/coding-agents/src/providers/host.ts` (new)

```ts
export class HostProvider implements SandboxProvider {
  readonly name = 'host'
  async start(spec: SandboxSpec): Promise<SandboxInstance>
  async stop(instanceId: string): Promise<void>
  async destroy(agentId: string): Promise<void>
  async status(agentId: string): Promise<'running' | 'stopped' | 'unknown'>
  async recover(): Promise<RecoveredSandbox[]>
}
```

- Rejects non-bindMount workspaces in `start()`.
- `start()` is idempotent: a second call with the same `agentId` returns
  the previously-recorded instance unchanged.
- Returned `SandboxInstance.instanceId` is `host:<agentId>` for log
  ergonomics.
- `stop` and `destroy` simply remove from the in-memory map. There is
  no long-lived process to kill between turns; the bridge's per-turn
  child has already exited.

### `packages/coding-agents/src/providers/local-docker.ts` (modified)

Two surgical changes:

1. `mountFlag(spec)` — for bind-mount, target = `realpath(hostPath)`
   instead of `/workspace`. Returns the resolved mount path so the caller
   can record it as `workspaceMount`.
2. `makeInstance(...)` — `workspaceMount` is the resolved mount path
   (the realpath for bind-mount, `/workspace` for volume) instead of a
   hard-coded `/workspace`.

The Dockerfile is unchanged. The leftover `/workspace` chown and
`WORKDIR /workspace` are harmless for the volume case and ignored in
the bind-mount case (Docker creates the mount target at run-time).

### `packages/coding-agents/src/lifecycle-manager.ts` (modified)

- Constructor takes `providers: { sandbox; host }` instead of `provider`.
- `ensureRunning(spec)` picks the provider by reading `spec.target`.
- `status/destroy/stop` take an explicit `target: 'sandbox' | 'host'`
  parameter; callers pass `meta.target` from the handler's state.
- `adoptRunningContainers` polls both providers and returns the merged
  list, each entry tagged with its `target`.

### `packages/coding-agents/src/types.ts` (modified)

- `SandboxSpec` gains `target: 'sandbox' | 'host'`.
- `RecoveredSandbox` gains `target: 'sandbox' | 'host'`.

### `packages/coding-agents/src/entity/collections.ts` (modified)

`SessionMetaRow` gains `target: 'sandbox' | 'host'` as a **required**
field (persisted source of truth for routing). Pre-existing rows that
lack this field will fail to validate; per the "drop existing sessions"
decision, this is intentional — operators starting up against the new
package are expected to wipe prior coding-agent state.

### `packages/coding-agents/src/entity/register.ts` (modified)

`creationArgsSchema` gains:

```ts
target: z.enum(['sandbox', 'host']).optional()
importNativeSessionId: z.string().optional()
```

`RegisterCodingAgentDeps` changes:

```ts
providers: {
  sandbox: SandboxProvider
  host: SandboxProvider
}
```

### `packages/coding-agents/src/entity/handler.ts` (modified)

First-wake init block:

- Reads `target` from args (defaulting to `'sandbox'`); persists into
  `sessionMeta.target`.
- Validates `target === 'host' → workspaceType === 'bindMount'` and
  `importNativeSessionId → target === 'host'`. Failures transition meta
  to `error` with a clear `lastError`.
- If `importNativeSessionId` is set, runs the import flow described in
  D5.

`processPrompt`:

- Passes `target: meta.target` through `SandboxSpec` to `lm.ensureRunning`.

All other code paths (reconcile, materialiseResume, captureTranscript,
pin/release/stop/destroy, idle timer) are unchanged.

### `packages/coding-agents/src/cli/import-claude.ts` (new)

Thin Node CLI per D6. Uses `process.argv` parsing (no extra dep) or
`node:util.parseArgs`. Calls the spawn endpoint via `fetch`. Logs the
returned agent URL on success; exits non-zero on failure.

### `packages/coding-agents/package.json` (modified)

- `bin` entry: `"electric-ax-import-claude": "./dist/cli/import-claude.js"`
  (the CLI is built into `dist/` by the existing tsdown setup).

## Data flow

### Fresh spawn, `target: 'host'`, no import

```
spawn → handler init: persist target='host', sessionMeta.status='cold'
↓ inbox: prompt
processPrompt:
  cold → starting (lifecycle: sandbox.starting — name kept for consistency)
  lm.ensureRunning(spec{target:'host'}) → HostProvider.start
    → checks bindMount, resolves realpath, records in map
  starting → idle (lifecycle: sandbox.started)
  bridge.runTurn(sandbox, prompt, nativeSessionId=undefined)
    → exec spawns `claude --print --output-format=stream-json --verbose
      --dangerously-skip-permissions` directly on host with
      cwd=realpath(hostPath)
  events stream into events collection
  on completion: capture transcript from
    `~/.claude/projects/<sanitised-realpath>/<sessionId>.jsonl`
  → nativeJsonl row (key 'current')
  idle → idle, idle timer armed
```

### Cold-boot resume, `target: 'host'`

```
processPrompt (wasCold=true):
  HostProvider.start → records, returns instance
  if meta.nativeSessionId and nativeJsonl row exists:
    materialiseResume → writes
      `~/.claude/projects/<sanitised-realpath>/<id>.jsonl`
      (overwriting any stale on-host file with our captured copy)
    lifecycle: resume.restored
  bridge.runTurn(... nativeSessionId=meta.nativeSessionId) → claude --resume
```

### Import flow

```
CLI: electric-ax-import-claude --workspace P --session-id S
  → PUT /coding-agent/<name>
       { target: 'host', workspaceType: 'bindMount',
         workspaceHostPath: P, importNativeSessionId: S }
handler init (first wake):
  validate: target=host, bindMount, importNativeSessionId set
  read ~/.claude/projects/<sanitiseCwd(realpath(P))>/S.jsonl
    → nativeJsonl_insert({ key:'current', nativeSessionId:S, content })
    → sessionMeta.nativeSessionId = S
    → lifecycle: import.restored bytes=N
  (no inbox messages yet — entity sits cold until first prompt)
```

### Cross-target resume (bind-mount)

In this slice `target` is set at spawn and not mutated afterward. The
aligned-cwd choice (D2) is a _property of the data_ that enables future
cross-target use without transcript surgery: bind-mount transcripts
captured under one target are at the same `~/.claude/projects/...` path
math as the other target, so a future "convert target" operation
(deferred) wouldn't need to rewrite JSONL bodies.

## Error handling

- Bad spawn args (e.g., `target='host'` + `workspaceType='volume'`) →
  `sessionMeta.status = 'error'`, `lastError = 'host target requires bindMount workspace'`,
  no inbox processed. Surfaces in the agents-server-ui as a clear error.
- Import file missing → `error` with `'imported session file not found at <path>'`.
- HostProvider.start() with non-bindMount → throws `Error('HostProvider requires a bindMount workspace')`,
  caught by the existing cold-boot error path and recorded as
  `sandbox.failed`.
- Workspace dir missing or not a directory → `error` with a clear path
  in the message.

## Testing

### Unit (`packages/coding-agents/test/unit/`)

- `host-provider.test.ts` (new): construction; reject volume; `start`
  resolves realpath; `status` reflects map across `start`/`destroy`;
  `exec` runs a node child and drains stdout; env policy (only explicit
  env + PATH); `copyTo` writes file with mode; `recover` returns `[]`.
- `local-docker.test.ts` (modified): `workspaceMount === realpath(hostPath)`
  for bindMount; `'/workspace'` for volume.
- `lifecycle-manager.test.ts` (modified): multi-provider routing; map
  populated by `ensureRunning`; `status/destroy/stop` route correctly
  per `target`.
- `entity-handler.test.ts` (modified): host+volume → error;
  importNativeSessionId+sandbox → error; import path seeds nativeJsonl
  and nativeSessionId from a mocked filesystem read.
- `cli-import.test.ts` (new): arg parsing; request body shape against a
  mock fetch.

### Integration (`packages/coding-agents/test/integration/`)

- `host-provider.test.ts` (new, gated by `HOST_PROVIDER=1`): spawn host
  agent, run a turn that writes a file inside the bind-mount tmpdir,
  verify on-disk transcript appears at the expected location.
- Cross-target resume scenario (gated by `DOCKER=1 HOST_PROVIDER=1`):
  spawn host → run turn → run another turn under a sandbox provider
  with the same bindMount; assert the second turn can recall the first.
- Import flow: pre-create a synthetic JSONL on disk, spawn with
  `importNativeSessionId`, assert nativeJsonl is seeded and the agent
  can run its first turn against that resumed session.

## Documentation

- `website/docs/agents/entities/coding-agent.md` — update the opener,
  add a "Target" subsection (sandbox vs. host with the trust tradeoff
  spelled out), update spawn-arg docs, add an "Importing a host session"
  section covering both the spawn-arg flow and the CLI shortcut.
  One-line note in the lifecycle diagram that `STARTING` is a noop for
  host but the state still transitions through it for consistency.
- `docs/agents-development.md` — one paragraph mentioning the host
  target option for dev iteration without docker.
- No README is created in `packages/coding-agents/` (per project
  convention; no README exists today).

## Out of scope (named explicitly)

- Volume workspaces in host mode.
- Operator-level gate (env var) to disable host mode.
- Browse/pick UI for selecting a host session to import (option B from
  brainstorming — leave as a future follow-up on top of the spawn-time
  primitive).
- Mid-life-cycle conversion of an agent's `target` after spawn. The data
  model permits it (cross-target resume just works for bind-mount); the
  UI affordance is deferred.
- Migration of existing transcripts captured under `-workspace/` for
  pre-existing sandbox+bindMount agents.
