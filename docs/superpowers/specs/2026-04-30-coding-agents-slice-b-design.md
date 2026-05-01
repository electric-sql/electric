# Coding Agents — Slice B: Resume + Horton Migration + Legacy Coder Removal + UI Revamp

**Status:** Draft
**Date:** 2026-04-30
**Author:** Valter Balegas
**Parent spec:** `docs/superpowers/specs/2026-04-30-coding-agents-platform-primitive-design.md`
**Predecessors:**

- `docs/superpowers/specs/notes/2026-04-30-coding-agents-mvp-report.md` (MVP — Provider + Bridge)
- `docs/superpowers/specs/2026-04-30-coding-agents-slice-a-design.md` (Slice A — runtime API + entity + lifecycle)
- `docs/superpowers/specs/notes/2026-04-30-coding-agents-slice-a-report.md` (Slice A run report)

## Summary

Slice B finishes the platform-primitive migration. After Slice A, the new `coding-agent` entity exists alongside the legacy `coder`, but cold-boot loses session continuity (every new sandbox starts a fresh CLI session), Horton still spawns the legacy entity, the legacy entity remains in the codebase, and the UI's chat surface is wired only to the legacy entity. Slice B closes all four gaps in one merge:

1. **Resume.** A new `nativeJsonl` collection captures every raw `claude` JSONL line per turn. On cold-boot of an agent that has prior runs, the handler reads the collection, materializes the JSONL into the sandbox's tmpfs, and runs `claude --resume <sessionId>`. Same-kind resume is lossless.
2. **Horton tool migration.** New tools `spawn_coding_agent` / `prompt_coding_agent` mirror the legacy `spawn_coder` / `prompt_coder`'s API but spawn `coding-agent` entities via `ctx.spawnCodingAgent`. Horton's tool list swaps to the new pair.
3. **Legacy `coder` removal.** Delete `packages/agents/src/agents/coding-session.ts`, `spawn-coder.ts`, `prompt-coder.ts`, and the runtime-side `useCodingAgent` / `CodingSessionHandle` types. Remove `registerCodingSession` from the bootstrap.
4. **UI revamp.** New `CodingAgentView` / `CodingAgentTimeline` / `useCodingAgent` / `CodingAgentSpawnDialog` components replace the legacy `CodingSession*` set, wire `coding-agent` collections, extend the status enum, render the `lifecycle` collection as muted timeline rows, and add Pin/Release/Stop buttons in the header.

After Slice B, the new `coding-agent` is the **only** coding-agent type in the codebase, and the runtime, entity, sandbox, bridge, server, UI, and Horton all consume it. The `electric-ax/coding-agent-sandbox:test` image is unchanged.

## Goals

1. **Same-kind resume is lossless.** A second prompt to a `coding-agent` after an idle hibernation produces a CLI session that sees all prior turns. Verified by an integration test that asserts the second response references the first prompt's content.
2. **Horton uses the new entity.** `Spawn a coder` from Horton produces a `coding-agent` entity backed by a Docker sandbox, not a legacy `coder` entity backed by a host child process.
3. **Legacy `coder` is gone from the codebase.** No source files, no runtime types, no UI components, no bootstrap registration, no Horton tool reference.
4. **UI surface for `coding-agent` matches or exceeds the legacy `coder` surface.** Spawn dialog with workspace selector, chat timeline with assistant/user/tool-call rows, status dot covering all six states, Pin/Release/Stop buttons in the header, lifecycle rows rendered as muted entries.
5. **End-to-end runtime test exercises `ctx.spawnCodingAgent` from a parent entity.** Uses a real agents-server in-process; closes the test gap that hid Slice A's two manual-testing bugs (slug, flat-schema).

## Non-goals (Slice B)

- **Codex support.** Bridge still rejects `kind: 'codex'`. Slice C.
- **Cross-kind resume.** Same-kind only. The architecture supports it (events collection is canonical) but no UI affordance and no integration test in Slice B.
- **`provider.recover()` cleanup of orphaned containers.** Containers labeled with `electric-ax.agent-id` whose corresponding entity was never created (or was destroyed) accumulate; manual cleanup. Slice C.
- **Eager `WorkspaceRegistry` rebuild at server boot.** Slice A's lazy populate (per agent on first handler entry) is kept. The eager-rebuild via `boot()` was originally in this slice to support accurate `state().workspace.sharedRefs` after server restart, but the UI indicator that consumes that field — sandbox provenance / "shared with N" header — is also Slice C. Defer eager rebuild to land alongside its consumer.
- **Sandbox provenance and "shared with N" indicators in the header.** Add status enum + Pin/Release/Stop + lifecycle rows. Sandbox provenance display itself defers.
- **Conformance suite parameterized by `SandboxProvider`.** Slice C.
- **Per-event approve/deny for `permission_request`.** CLIs continue to run with `--dangerously-skip-permissions`.
- **Replay / time-travel UI scrubber.** Slice C.

## Architecture

```
                                Entity author code
   ┌──────────────────────────────────────────────────────────────┐
   │  ctx.spawnCodingAgent / ctx.observeCodingAgent (Slice A)     │  ← agents-runtime
   └──────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
   ┌──────────────────────────────────────────────────────────────┐
   │            coding-agent entity                               │  ← coding-agents
   │   collections: sessionMeta, runs, events,                    │
   │                lifecycle, nativeJsonl  ← NEW in Slice B      │
   │   handler now does:                                          │
   │     - capture nativeSessionId from session_init events       │
   │     - after each successful turn, read claude's on-disk      │
   │       transcript via docker exec base64 and store as a       │
   │       single-row blob in nativeJsonl (key='current')         │
   │     - on cold-boot, materialise the blob back into the new   │
   │       sandbox and pass --resume <nativeSessionId>            │
   └──────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
   ┌─────────────────────────┐   ┌─────────────────────────────────┐
   │  StdioBridge (Slice A)  │   │  LifecycleManager (Slice A)     │
   │  + onNativeLine wired   │   │  Unchanged                      │
   │  + --resume <id>        │   │                                 │
   └─────────────────────────┘   └─────────────────────────────────┘
                                  │
                                  ▼
   ┌──────────────────────────────────────────────────────────────┐
   │   LocalDockerProvider (Slice A) — unchanged                  │
   └──────────────────────────────────────────────────────────────┘
```

**Component-level changes from Slice A:**

| Component                         | Change                                                                                                                                                                                                                |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LocalDockerProvider`             | Unchanged.                                                                                                                                                                                                            |
| `StdioBridge`                     | Pass `--resume <id>` when caller provides `nativeSessionId`. (`onNativeLine` is invoked per stdout line but the handler no longer uses it for persistence — see Resume data flow note.)                               |
| `LifecycleManager`                | Unchanged.                                                                                                                                                                                                            |
| `WorkspaceRegistry`               | Unchanged.                                                                                                                                                                                                            |
| `coding-agent` entity             | +`nativeJsonl` collection (single-row blob); capture `nativeSessionId` from `session_init`; post-turn transcript capture via `docker exec base64`; cold-boot resume materialization; `resume.restored` lifecycle row. |
| `agents-runtime`                  | Drop `CodingSessionHandle` + `useCodingAgent`; keep `CodingAgentHandle` + `spawnCodingAgent` / `observeCodingAgent`.                                                                                                  |
| `agents` package                  | Drop `coding-session.ts`, `spawn-coder.ts`, `prompt-coder.ts`. Add `spawn-coding-agent.ts`, `prompt-coding-agent.ts`. Update Horton tool list.                                                                        |
| `agents-server-ui`                | Drop `CodingSession*` components and hook. Add `CodingAgent*` replacements. Extend status dot. Add lifecycle row renderer. Pin/Release/Stop buttons in `EntityHeader`. New `CodingAgentSpawnDialog`.                  |
| `agents-server`                   | Bootstrap calls `registerCodingAgent(...).boot()` after type registration.                                                                                                                                            |
| `agents-server-conformance-tests` | Unchanged in Slice B (parameterized suite is Slice C).                                                                                                                                                                |

## Public types

### Runtime — added (or refined)

```ts
// packages/agents-runtime/src/types.ts

// Slice A's CodingAgentHandle keeps its surface, but events() now actually
// streams (was a snapshot). The `runId` returned by send() promise stays
// `Promise<void>` — the durable run id is exposed via state().runs.
interface CodingAgentHandle {
  readonly url: string
  readonly kind: 'claude'
  send(prompt: string): Promise<void>
  events(opts?: { since?: 'start' | 'now' }): AsyncIterable<NormalizedEvent>
  state(): CodingAgentState
  pin(): Promise<void>
  release(): Promise<void>
  stop(): Promise<void>
  destroy(): Promise<void>
}

// state() now also exposes nativeSessionId for diagnostic visibility
interface CodingAgentState {
  status: CodingAgentSliceAStatus
  pinned: boolean
  workspace: { identity: string; sharedRefs: number }
  lastError?: string
  /** Slice B: the underlying claude session id, when known. */
  nativeSessionId?: string
  runs: ReadonlyArray<CodingAgentRunSummary>
}
```

### Runtime — removed

```ts
// Deleted from packages/agents-runtime/src/types.ts:
//   - interface CodingSessionHandle
//   - HandlerContext.useCodingAgent
//   - All CodingSessionEventRow / CodingSessionMeta / CodingSessionStatus types
//
// Deleted from packages/agents-runtime/src/context-factory.ts:
//   - useCodingAgent implementation
```

The runtime keeps `entityUrl`, `spawn`, `observe`, `spawnCodingAgent`, `observeCodingAgent`, etc. Only the legacy-coder-specific surface is removed.

### Entity collection — added

```ts
// packages/coding-agents/src/entity/collections.ts

export const CODING_AGENT_NATIVE_JSONL_COLLECTION_TYPE =
  'coding-agent.nativeJsonl'

// Single-row blob. Always key='current'. Each successful turn overwrites
// the previous row. Holds the full contents of claude's on-disk transcript
// (~/.claude/projects/<sanitized-cwd>/<sessionId>.jsonl), captured after
// the turn exits, used to materialise the file back on cold-boot resume.
//
// Note: the original plan described per-line rows ({key, runId, seq, line,
// nativeSessionId, kind}). That approach was abandoned because claude's stdout
// wire format cannot reconstruct the on-disk transcript format.
export const nativeJsonlRowSchema = z.object({
  key: z.literal('current'),
  nativeSessionId: z.string(),
  /** Full UTF-8 contents of the claude transcript file. */
  content: z.string(),
})
export type NativeJsonlRow = z.infer<typeof nativeJsonlRowSchema>
```

The collection is registered as a fifth state collection on the entity:

```ts
state: {
  sessionMeta:  { ... },
  runs:         { ... },
  events:       { ... },
  lifecycle:    { ... },
  nativeJsonl:  { schema: nativeJsonlRowSchema,
                  type: CODING_AGENT_NATIVE_JSONL_COLLECTION_TYPE,
                  primaryKey: 'key' },
}
```

### `SessionMetaRow` — extended

```ts
export const sessionMetaRowSchema = z.object({
  // ... all Slice A fields ...
  nativeSessionId: z.string().optional(), // ← NEW: discovered from session_init
})
```

## Resume data flow

> **Note (implementation pivot):** The original plan described a per-line tee approach where
> `StdioBridge` would invoke `onNativeLine` per stdout line and the handler would accumulate
> those lines as individual rows in `nativeJsonl`. This approach does not work — claude's
> `--output-format=stream-json` wire format (stdout) is entirely different from claude's
> on-disk transcript format (`~/.claude/projects/…/<sessionId>.jsonl`); one cannot be
> reconstructed from the other. The shipped implementation pivoted to a blob-after-turn
> capture. See the Slice B run report §"What had to be fixed mid-flight" §2 for details:
> `docs/superpowers/specs/notes/2026-04-30-coding-agents-slice-b-report.md`.

### Transcript capture (after each successful turn)

After `bridge.runTurn()` returns successfully, the handler reads claude's on-disk transcript
out of the sandbox and stores it as a single-row blob in the `nativeJsonl` collection:

```
captureTranscript(sandbox, nativeSessionId):
  projectDir = sanitiseCwd(sandbox.workspaceMount)   // e.g. /workspace → -workspace
  path = ~/.claude/projects/${projectDir}/${nativeSessionId}.jsonl
  // Read file as base64 to avoid stream-drain hangs on docker exec stdio
  handle = sandbox.exec({ cmd: ['sh', '-c', `if [ -f ${path} ]; then base64 -w 0 ${path}; fi`] })
  b64 = drain(handle.stdout)
  return base64Decode(b64)   // returns '' if file not found

handler, after runTurn succeeds:
  content = await captureTranscript(sandbox, nativeSessionId)
  if (content) {
    ctx.db.actions.nativeJsonl_insert({
      key: 'current',
      nativeSessionId,
      content,
    })  // upserts by primary key — subsequent turns overwrite the single row
  }
```

The `nativeJsonl` collection always holds at most one row with `key='current'`. Each
successful turn replaces the previous blob. The `onNativeLine` callback in `RunTurnArgs`
still exists and is still invoked per stdout line by the bridge, but the handler does not
use it for persistence (the per-line approach was the original plan; see note above).

### Materialize path (cold-boot of agent with prior turns)

When the prior `sessionMeta.status` was `cold` and `nativeSessionId` is set, the handler
reads the `nativeJsonl` blob and writes it back into the new container before the run:

```
materialiseResume(sandbox, nativeSessionId, content):
  projectDir = sanitiseCwd(sandbox.workspaceMount)
  b64 = base64Encode(content)
  // Write via printf to avoid shell quoting issues with binary content
  sandbox.exec({
    cmd: ['sh', '-c',
      `mkdir -p ~/.claude/projects/${projectDir} && \
       printf '%s' '${b64}' | base64 -d > ~/.claude/projects/${projectDir}/${nativeSessionId}.jsonl`
    ],
  })

handler, on cold-boot (prior status was cold, nativeSessionId set):
  row = nativeJsonlCol.get('current')
  if (row && row.content) {
    await materialiseResume(sandbox, nativeSessionId, row.content)
    lifecycle.insert({ event: 'resume.restored', detail: `bytes=${row.content.length}` })
  }
```

### Capture `nativeSessionId`

The first `session_init` event of any turn carries the CLI's session id. The handler
captures it the first time it sees one and writes to `sessionMeta.nativeSessionId`:

```ts
onEvent: (e: NormalizedEvent) => {
  if (e.type === 'session_init' && 'sessionId' in e && !meta.nativeSessionId) {
    ctx.db.actions.sessionMeta_update({
      key: 'current',
      updater: (d) => { d.nativeSessionId = e.sessionId },
    })
    meta = sessionMetaCol.get('current')!
  }
  ctx.db.actions.events_insert({ ... })
}
```

### Why blob-after-turn (not per-line tee)

The original design proposed a per-line tee because it would give partial-turn durability
(a crash mid-turn leaves partial rows). This was abandoned because:

- **Format mismatch.** Claude's stdout wire format (`--output-format=stream-json`) is a
  sequence of normalized JSON events. Claude's on-disk transcript uses an entirely different
  internal format (`parentUuid`, `attachment`, `ai-title`, multi-variant assistant entries,
  etc.). These cannot be round-tripped through each other.
- **Simplicity.** A single-row blob (one `docker exec` per turn) is simpler and more robust
  than per-line accumulation and sort-based reassembly.
- **Partial-turn failure is already handled.** If a turn crashes mid-flight the `nativeJsonl`
  blob from the prior turn is still present. `--resume` replays up to that point; the
  failed turn is re-driven from the inbox on next entry.

### Resume semantics

- **Same agent + same kind.** Lossless. Materialize → `--resume` → CLI sees prior turns.
- **Empty `nativeJsonl`.** First turn ever, or all prior turns failed before producing output.
  No materialization, no `--resume` flag. CLI creates a fresh session.
- **Cross-kind.** Out of scope. The handler verifies `meta.kind === args.kind`; mismatch is an error.
- **Mid-resume failure.** If materialization fails (e.g., `docker exec` reports non-zero),
  the handler logs `sandbox.failed`, sets `status='error'`, and returns. Next prompt retries.

## Horton tool migration

### New tools

```ts
// packages/agents/src/tools/spawn-coding-agent.ts

export const spawnCodingAgentTool: AgentTool = {
  type: 'function',
  name: 'spawn_coding_agent',
  description:
    'Spawn a sandboxed coding agent (Claude Code in Docker) and prompt it. ' +
    "Returns the agent's response when the run finishes. Use for non-trivial " +
    'code edits, multi-file changes, or work that needs filesystem isolation.',
  parameters: {
    /* zod schema: prompt: string, workspaceName?: string */
  },
  async execute(args, ctx) {
    const id = nanoid(10)
    const handle = await ctx.spawnCodingAgent({
      id,
      kind: 'claude',
      workspace: args.workspaceName
        ? { type: 'volume', name: args.workspaceName }
        : { type: 'volume' },
      initialPrompt: args.prompt,
      wake: { on: 'runFinished', includeResponse: true },
    })
    // Wait for the run to finish via existing entity-runtime wake flow.
    // The result returns from the parent's runFinished wake payload.
    return {
      content: [{ type: 'text', text: 'Spawned' }],
      details: { spawned: true, codingAgentUrl: handle.url },
    }
  },
}
```

```ts
// packages/agents/src/tools/prompt-coding-agent.ts

export const promptCodingAgentTool: AgentTool = {
  type: 'function',
  name: 'prompt_coding_agent',
  description: 'Send a follow-up prompt to an existing coding-agent.',
  parameters: {
    /* zod schema: codingAgentUrl, prompt */
  },
  async execute(args, ctx) {
    const handle = await ctx.observeCodingAgent(extractId(args.codingAgentUrl))
    await handle.send(args.prompt)
    return {
      content: [{ type: 'text', text: 'Sent' }],
      details: { sent: true, codingAgentUrl: handle.url },
    }
  },
}
```

The new tools' parameter shapes intentionally mirror `spawn_coder` / `prompt_coder` for consumer transparency: a `prompt` field, a optional id-or-url field. The tool result `details` keys are renamed (`coderUrl` → `codingAgentUrl`) to match the new entity name.

### Horton wiring

`packages/agents/src/agents/horton.ts` swaps `spawn_coder` and `prompt_coder` for the new pair in its tool list. Tool descriptions are updated to mention sandboxing and workspace sharing. Existing Horton tests that mock `spawn_coder` are updated to mock `spawn_coding_agent`.

## Legacy `coder` removal

### Files deleted

- `packages/agents/src/agents/coding-session.ts` (~800 LOC)
- `packages/agents/src/tools/spawn-coder.ts`
- `packages/agents/src/tools/prompt-coder.ts`
- `packages/agents-server-ui/src/components/CodingSessionView.tsx`
- `packages/agents-server-ui/src/components/CodingSessionTimeline.tsx`
- `packages/agents-server-ui/src/components/CodingSessionSpawnDialog.tsx`
- `packages/agents-server-ui/src/hooks/useCodingSession.ts`

### Runtime types removed

```ts
// packages/agents-runtime/src/types.ts
//   - interface CodingSessionHandle
//   - HandlerContext.useCodingAgent
//   - CodingSessionMeta, CodingSessionStatus, CodingSessionEventRow
//   - UseCodingAgentOptions
//   - CODING_SESSION_*_COLLECTION_TYPE re-exports
//
// packages/agents-runtime/src/context-factory.ts
//   - useCodingAgent impl in createHandlerContext()
```

### Bootstrap

```ts
// packages/agents/src/bootstrap.ts (after Slice B)
//
// REMOVED:
//   import { registerCodingSession } from './agents/coding-session'
//   registerCodingSession(registry, { defaultWorkingDirectory: cwd })
//   typeNames.push('coder')
//
// KEPT (Slice A):
//   import { registerCodingAgent, LocalDockerProvider, StdioBridge }
//     from '@electric-ax/coding-agents'
//   const codingAgent = registerCodingAgent(registry, {
//     provider: new LocalDockerProvider(),
//     bridge: new StdioBridge(),
//   })
//   typeNames.push('coding-agent')
//
// NOTE: Eager WR rebuild via `boot()` was originally proposed for Slice B,
// but is deferred to Slice C alongside its UI consumer. Slice A's lazy
// per-agent rebuild on first handler entry is kept.
```

### Existing `coder` durable streams

Existing `coder` entities in users' dev environments reference an entity type that no longer exists post-migration. The agents-server returns 404 for unknown types when listing or rendering. The UI's "all entities" sidebar filters out unknown types (already does this for the legacy `worker` entity that's also hidden). No data is migrated; users with active `coder` sessions are informed in the slice's release notes.

## UI revamp

### New components

| Component                | Replaces                   | Wires                                                                                                                                                                       |
| ------------------------ | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CodingAgentView`        | `CodingSessionView`        | `useCodingAgent` hook; renders timeline + input + state explorer panel.                                                                                                     |
| `CodingAgentTimeline`    | `CodingSessionTimeline`    | `events` + `lifecycle` collections; renders both via `EntityTimelineEntry` + new `LifecycleRow`.                                                                            |
| `useCodingAgent`         | `useCodingSession`         | Reads `coding-agent` collections via collection-type wires.                                                                                                                 |
| `CodingAgentSpawnDialog` | `CodingSessionSpawnDialog` | Workspace selector (volume name field, bind-mount path field), kind locked to 'claude'.                                                                                     |
| `LifecycleRow`           | (new)                      | Renders a `lifecycle` collection row (sandbox.start/stopped/failed, pin/release, orphan.detected, resume.restored) as a muted, single-line entry distinct from chat events. |

### Status dot extension

```ts
// packages/agents-server-ui/src/components/StatusDot.tsx
const STATUS_COLORS: Record<EntityStatus, string> = {
  // existing
  spawning: '#eab308', // amber
  idle: '#22c55e', // green
  running: '#3b82f6', // blue
  error: '#ef4444', // red
  // Slice B additions
  cold: '#9ca3af', // gray
  starting: '#eab308', // amber (matches spawning)
  stopping: '#eab308', // amber
  destroyed: '#6b7280', // dim gray
}
```

### Header buttons (when entity type is `coding-agent`)

`EntityHeader.tsx` adds three buttons next to the existing pin/kill controls:

- **Pin** — sends `{}, type: 'pin'` inbox message. Disabled when `meta.pinned`.
- **Release** — sends `{}, type: 'release'`. Disabled when `!meta.pinned`.
- **Stop** — sends `{}, type: 'stop'`. Confirmation dialog on click (the sandbox-stop is reversible by next prompt, but explicit).

The existing global "kill" button is kept for `destroy` (drops the workspace ref + tombstones the entity). The pin/release/stop trio are entity-type-specific affordances.

### Spawn dialog

`CodingAgentSpawnDialog` is a small bespoke dialog (not the generic `SpawnArgsDialog`) because:

- The `creationSchema` is flat from Slice A's flat-schema fix, but a workspace-mode toggle (volume vs bindMount) reads better as a radio than as two separate optional text inputs.
- The dialog can autocomplete existing volume names by querying `docker volume ls --filter label=...` — but this requires server-side support that's out of scope for Slice B. The Slice B dialog is just two radio options + corresponding text inputs.

```
┌──────────── Spawn Coding Agent ─────────────┐
│  Workspace                                  │
│  ◉ Volume   ○ Bind mount                    │
│  Name (optional): [_____________________]   │
│  Defaults to a per-agent slugged name.      │
│                                             │
│  Initial prompt (optional)                  │
│  [_______________________________________]  │
│                                             │
│              [Cancel]  [Spawn]              │
└─────────────────────────────────────────────┘
```

When "Bind mount" is selected, "Name" is replaced with "Host path: [text input, validated as absolute path]".

### Lifecycle row rendering

Lifecycle rows are interleaved with `events` rows by timestamp in the timeline. Visual distinction:

- Muted background (`var(--gray-a3)`).
- One-line summary: e.g. "▸ sandbox started (instance abc-123)".
- Click expands to show `detail` field (if present).

### Router changes

```ts
// packages/agents-server-ui/src/router.tsx (after Slice B)
//
// REMOVED:
//   if (selectedEntity.type === CODING_SESSION_ENTITY_TYPE) { CodingSessionView ... }
//
// REPLACED WITH:
//   if (selectedEntity.type === CODING_AGENT_ENTITY_TYPE) {
//     <CodingAgentView baseUrl={baseUrl} entityUrl={connectUrl} entityStopped={entityStopped} />
//   }
```

### Sidebar changes

`Sidebar.tsx` swaps:

- `setCodingDialogOpen(true)` → `setCodingAgentDialogOpen(true)` for the new entity type.
- Tool-call rendering (`ToolCallView.tsx`): label `spawn_coder` → `spawn_coding_agent`, `prompt_coder` → `prompt_coding_agent`.

## `WorkspaceRegistry` rebuild — deferred

Slice A's lazy populate (per-agent on first handler entry) is kept. Eager rebuild via a new `boot()` callback was scoped here originally but is deferred to Slice C alongside the UI's "shared with N agents" header indicator that consumes `state().workspace.sharedRefs`. Without that consumer, eager rebuild adds runtime contract surface (`scanEntities` dependency) for no user-visible benefit.

## State machine — unchanged from Slice A

The 7-state machine (`cold | starting | idle | running | stopping | error | destroyed`) is the same. Resume materialization happens **inside the `STARTING → IDLE` transition** of `processPrompt`, immediately after `provider.start` succeeds and immediately before the workspace lease is acquired:

```
COLD → STARTING (provider.start)
STARTING → STARTING (resume.materialize, if meta.nativeSessionId set)
STARTING → IDLE
IDLE → RUNNING (lease acquire + recordRun + bridge.runTurn)
RUNNING → IDLE
```

The `resume.restored` lifecycle row is inserted between materialization and lease acquisition.

## Error handling

- **Materialization failure** (docker exec non-zero, broken pipe). Mark `sessionMeta.status='error'`, `lastError`, lifecycle row `sandbox.failed` with `detail='materialize'`. Run is not started. Next prompt retries — same `nativeSessionId`, same `nativeJsonl` rows, fresh attempt.
- **Bridge runs but `--resume` rejects** (claude returns non-zero with "session not found"). The CLI's transcript got out of sync. Clear `sessionMeta.nativeSessionId`, run completes with `failed: cli-exit:resume-rejected`. Next prompt cold-boots a fresh session (no `--resume` flag).
- **`session_init` event missing or has no `sessionId`** (CLI bug or model-API failure). `nativeSessionId` stays `undefined`. The next turn cold-boots fresh (same as a first turn). No data corruption.
- **Eager `boot()` fails** (entity scan errors out, LMDB locked, etc.). Server boot fails fast — better to surface the error than serve traffic with a half-populated registry. The error message includes which entity caused the failure.
- **`boot()` finds entities the runtime can't load** (orphaned coder durable streams post-migration). Skip with a warning; do not abort.

## Testing strategy

### Layer 1 — Unit (no Docker)

- **`resume.test.ts`** — `materializeNativeJsonl(rows, sessionId, exec)` constructs the right `bash -c` argv, pipes the right concatenated content to stdin, calls into a fake `exec` correctly. Idempotency: re-materialize from the same rows produces a byte-identical file.
- **`session-init-capture.test.ts`** — given a fake bridge that emits a `session_init` with `sessionId='abc'`, the handler writes `'abc'` to `sessionMeta.nativeSessionId`. A second `session_init` in the same run is ignored.
- **Existing entity-handler tests** — extended to cover the resume branch: prompt with `meta.nativeSessionId` set → materialization called before lease acquire.
- **`spawn-coding-agent.test.ts`, `prompt-coding-agent.test.ts`** — the new Horton tools; assert they desugar to `ctx.spawnCodingAgent` / `ctx.observeCodingAgent` and return the right `details` shape.
- **UI component tests** — `LifecycleRow` rendering, `StatusDot` color map covers all seven states, `CodingAgentSpawnDialog` form-validation (volume vs bind-mount toggle).
- **Removed:** all legacy `useCodingSession` / `CodingSession*` / `coder` / `spawn-coder` tests.

### Layer 2 — Integration (real Docker, real Claude)

- **`resume-end-to-end.test.ts`** — spawn a `coding-agent`, send "remember the number 42", await runFinished, send a second prompt "what number did I tell you?", await runFinished. Assert second response contains "42". Validates the tee + materialize round-trip.
- **`spawn-end-to-end.test.ts`** — drive an in-process agents-server. Use a parent test entity that calls `ctx.spawnCodingAgent({ workspace: { type: 'volume' } })`. Verify the entity is created with the correct flat creationSchema args, the handler runs, the run completes with response text. **Closes the gap that hid Slice A's slug + flat-schema bugs.**
- **Existing `slice-a.test.ts`** — kept; verifies all Slice A invariants (lease serialization, crash recovery, destroy) still hold post-migration.
- All gated by `DOCKER=1`. Image already cached locally.

### Layer 3 — UI tests

- Component tests for `CodingAgentView`, `CodingAgentTimeline`, `LifecycleRow`, `CodingAgentSpawnDialog`.
- No new e2e browser tests in Slice B (browser e2e is Slice C's conformance suite).

### Manual smoke checklist

- Spawn a fresh `coding-agent` from the UI; send "Reply with the single word: ok"; assert response shows in timeline.
- Send a second message; assert it's resumed (response references the first turn's content).
- Pin → wait > idle timeout → container stays up. Release → wait → container stops.
- Send another prompt → cold-boot path materializes, response received.
- Stop → status flips `cold`. Send another prompt → fresh boot.
- Destroy → entity tombstoned; UI hides it (or shows tombstone marker).
- Have Horton spawn a coder ("write a hello world script") → ✓ produces a `coding-agent` entity (not a legacy `coder`). Visible in sidebar with the new entity type.

## Migration

This is a **destructive migration**. The legacy `coder` entity, its tools, its UI, and its runtime types are all removed in the same merge. There is no shim, no backwards-compat alias, no opt-in flag. Existing `coder` durable streams in dev environments remain in storage but become unreachable (no entity type registered to read them).

**Release notes (for the PR description and CHANGELOG):**

- The `coder` entity type is removed. Use `coding-agent` instead.
- `ctx.useCodingAgent` is removed. Use `ctx.spawnCodingAgent` / `ctx.observeCodingAgent`.
- The `spawn_coder` and `prompt_coder` Horton tools are removed. Use `spawn_coding_agent` and `prompt_coding_agent`.
- Existing `coder` entities in dev environments are dropped. Re-spawn as `coding-agent` after upgrade.
- The wire constants `CODING_SESSION_*_COLLECTION_TYPE` are removed. The new `CODING_AGENT_*_COLLECTION_TYPE` constants are exported by `@electric-ax/coding-agents`.

## Open questions

- **Path-sanitization for the JSONL file location.** Claude transforms the `cwd` into a directory name under `~/.claude/projects/` via a specific algorithm. We must replicate it (or call into a claude-code helper if one exists). Resolve during writing-plans by reading the claude-code source.
- **`scanEntities` API on the runtime.** No longer needed — eager rebuild is deferred to Slice C alongside the UI consumer. (Resolved by deferral.)
- **Lifecycle row collation with events.** The timeline needs to merge two collections by timestamp. Existing `EntityTimeline` reads `events` only; we need to extend it (or have `useCodingAgent` produce a merged feed). Pick during implementation.

## Scope cuts referenced from Slice B

Carried forward, **deferred** to Slice C or beyond:

- Codex support in the bridge.
- Cross-kind resume.
- `provider.recover()` orphan-container cleanup.
- Sandbox provenance display in the header (provider name, "shared with N").
- Workspace volume autocomplete in the spawn dialog.
- Conformance suite parameterized by `SandboxProvider`.
- Per-event approve/deny for `permission_request`.
- Replay / time-travel UI scrubber.
- Workspace file browser.
- Memory-snapshot lifecycle.

## References

- `docs/superpowers/specs/2026-04-30-coding-agents-platform-primitive-design.md` — parent design.
- `docs/superpowers/specs/2026-04-30-coding-agents-slice-a-design.md` — Slice A design.
- `docs/superpowers/specs/notes/2026-04-30-coding-agents-slice-a-report.md` — Slice A run report (with the Slice B priority list this spec executes).
- `packages/coding-agents/src/bridge/stdio-bridge.ts` — bridge with `onNativeLine` already typed (Slice A) but not wired.
- `packages/coding-agents/src/entity/handler.ts` — Slice A handler the resume path extends.
- `packages/agents/src/agents/coding-session.ts` — legacy entity to be removed.
- `packages/agents/src/tools/spawn-coder.ts`, `prompt-coder.ts` — legacy tools to be removed.
- `packages/agents-server-ui/src/components/CodingSession*.tsx`, `useCodingSession.ts` — legacy UI to be removed.
- `packages/agents-server-ui/src/router.tsx:158` — coder-specific routing branch to be replaced.
