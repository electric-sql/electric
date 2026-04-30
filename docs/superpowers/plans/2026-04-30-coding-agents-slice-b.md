# Coding Agents — Slice B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the coding-agent platform-primitive migration: wire resume (nativeJsonl collection + `--resume` flag), swap Horton from legacy `coder` to `coding-agent`, delete the legacy `coder` entity and all legacy runtime types, and ship a `CodingAgentView` / `CodingAgentTimeline` / `CodingAgentSpawnDialog` UI surface wired to the new entity's collections. Validation bar: unit tests for resume materialisation, Horton tool swap verified by handler unit test, and an integration test that sends two prompts to the same `coding-agent` and asserts the second run's response references the first prompt's content (proving resume is lossless).

**Architecture:** `nativeJsonl` is a new fifth collection on the `coding-agent` entity. The handler tees each raw JSONL line from `bridge.runTurn` into the collection via `onNativeLine`. On cold-boot of an agent with prior `nativeJsonl` rows, the handler calls `sandbox.exec` to write the lines into `/tmp/resume.jsonl`, extracts `nativeSessionId` from `sessionMeta`, and passes `--resume <nativeSessionId>` to `StdioBridge.runTurn`. `StdioBridge` no longer warns; it passes the id through. Horton's `createHortonTools` switches from `createSpawnCoderTool` / `createPromptCoderTool` (legacy `coder`) to new `createSpawnCodingAgentTool` / `createPromptCodingAgentTool` (new `coding-agent`). Legacy files (`coding-session.ts`, `spawn-coder.ts`) and their runtime types are deleted. UI adds `CodingAgentView`, `useCodingAgent`, `CodingAgentTimeline`, `CodingAgentSpawnDialog`; router and sidebar switch on `'coding-agent'` instead of `CODING_SESSION_ENTITY_TYPE`.

**Spec divergences (resolved):**

- **`onNativeLine` already wired in `StdioBridge`.** Lines 51-56 of `bridge/stdio-bridge.ts` already call `args.onNativeLine(line)` in `drainStdout`. Task 1.1 needs only a unit test (not a re-implementation). Task 1.2 adds the actual `--resume` argument.
- **Horton tool validation string in `prompt_coding_agent`.** Legacy `prompt_coder` validated `coder_url.startsWith('/coder/')`. New tool validates `coding_agent_url.startsWith('/coding-agent/')`.
- **UI "Pin/Release/Stop" buttons ship as message sends**, not as a special RPC. They call `ctx.db.actions` on the inbox of the entity to send `pin`, `release`, or `stop` messages (same as the test's `pushInbox`). The `EntityHeader` receives the `db` object when `entity.type === 'coding-agent'`.
- **E2E test uses the FakeCtx pattern** from `test/integration/slice-a.test.ts` extended with a `nativeJsonl` collection stub, not the `agents-server` docker-compose harness. The `agents-server` harness requires an external postgres+electric stack and is out of scope for Slice B.

**Tech Stack:** TypeScript, Vitest, React, `@radix-ui/themes`, `lucide-react`, `zod`, Docker (integration test only).

**Reference spec:** `docs/superpowers/specs/2026-04-30-coding-agents-slice-b-design.md`

---

## File Structure

```
packages/coding-agents/                          ← extend
├── src/
│   ├── index.ts                                 ← +CODING_AGENT_NATIVE_JSONL_COLLECTION_TYPE
│   ├── entity/
│   │   ├── collections.ts                       ← +nativeJsonl schema, +nativeSessionId on sessionMeta
│   │   ├── handler.ts                           ← +tee onNativeLine, +resume materialisation, +nativeSessionId capture
│   │   └── register.ts                          ← +nativeJsonl state entry
│   └── bridge/stdio-bridge.ts                   ← remove warning, add --resume when nativeSessionId present
└── test/
    ├── unit/
    │   ├── stdio-bridge-resume.test.ts          ← NEW: --resume arg wired unit test
    │   └── handler-resume.test.ts               ← NEW: tee + materialise unit tests
    └── integration/
        └── slice-b.test.ts                      ← NEW: lossless resume integration test

packages/agents/src/
├── bootstrap.ts                                 ← remove registerCodingSession + 'coder' push
├── tools/
│   ├── spawn-coder.ts                           ← DELETE (legacy)
│   ├── spawn-coding-agent.ts                    ← NEW
│   └── prompt-coding-agent.ts                  ← NEW
└── agents/
    ├── coding-session.ts                        ← DELETE (legacy)
    └── horton.ts                                ← swap imports + tool list + system prompt

packages/agents-runtime/src/
├── types.ts                                     ← delete legacy Coding Session types/interface
├── context-factory.ts                           ← delete useCodingAgent impl
└── index.ts                                     ← remove legacy exports

packages/agents-server-ui/src/
├── components/
│   ├── StatusDot.tsx                            ← +coding-agent status colors
│   ├── EntityHeader.tsx                         ← +Pin/Release/Stop for coding-agent
│   ├── ToolCallView.tsx                         ← +spawn_coding_agent, prompt_coding_agent cases
│   ├── CodingAgentView.tsx                      ← NEW
│   ├── CodingAgentTimeline.tsx                  ← NEW
│   └── CodingAgentSpawnDialog.tsx               ← NEW
├── hooks/
│   └── useCodingAgent.ts                        ← NEW
└── router.tsx                                   ← swap CODING_SESSION_ENTITY_TYPE → 'coding-agent'

packages/agents-server-ui/src/components/Sidebar.tsx  ← swap coder dialog → CodingAgentSpawnDialog

docs/superpowers/specs/notes/
└── 2026-04-30-coding-agents-slice-b-report.md   ← NEW (Phase 8)
```

---

## Phase Plan

| Phase | Tasks              | Parallelism                                          | Depends on |
| ----- | ------------------ | ---------------------------------------------------- | ---------- |
| 0     | 0.1                | sequential                                           | —          |
| 1     | 1.1, 1.2, 1.3, 1.4 | 1.1 + 1.2 parallel; 1.3 after 1.1+1.2; 1.4 after 1.3 | Phase 0    |
| 2     | 2.1, 2.2, 2.3      | sequential                                           | Phase 1    |
| 3     | 3.1, 3.2           | parallel (2 independent agents)                      | Phase 2    |
| 4     | 4.1, 4.2, 4.3, 4.4 | 4.1–4.3 parallel; 4.4 after all                      | Phase 3    |
| 5     | 5.1                | sequential                                           | Phase 4    |
| 6     | 6.1                | sequential                                           | Phase 5    |
| 7     | 7.1                | sequential                                           | Phase 6    |
| 8     | 8.1 (report)       | sequential                                           | Phase 7    |

Total tasks: 15 (excluding report). Estimated wall time per task: 15-40 min.

---

## Phase 0 — Extend collections + sessionMeta schema (sequential)

### Task 0.1 — Add `nativeJsonl` collection and `nativeSessionId` to `sessionMeta`

**Files:**

- Modify: `packages/coding-agents/src/entity/collections.ts`
- Modify: `packages/coding-agents/src/index.ts`

- [ ] **Step 1: Edit `packages/coding-agents/src/entity/collections.ts`**

Add the constant, schema, and type after the existing `lifecycleRowSchema`. Also add `nativeSessionId` to `sessionMetaRowSchema`.

```ts
// packages/coding-agents/src/entity/collections.ts
import { z } from 'zod'

export const CODING_AGENT_SESSION_META_COLLECTION_TYPE = `coding-agent.sessionMeta`
export const CODING_AGENT_RUNS_COLLECTION_TYPE = `coding-agent.runs`
export const CODING_AGENT_EVENTS_COLLECTION_TYPE = `coding-agent.events`
export const CODING_AGENT_LIFECYCLE_COLLECTION_TYPE = `coding-agent.lifecycle`
export const CODING_AGENT_NATIVE_JSONL_COLLECTION_TYPE = `coding-agent.nativeJsonl`

export const codingAgentStatusSchema = z.enum([
  `cold`,
  `starting`,
  `idle`,
  `running`,
  `stopping`,
  `error`,
  `destroyed`,
])
export type CodingAgentStatus = z.infer<typeof codingAgentStatusSchema>

export const sessionMetaRowSchema = z.object({
  key: z.literal(`current`),
  status: codingAgentStatusSchema,
  kind: z.enum([`claude`]),
  pinned: z.boolean(),
  workspaceIdentity: z.string(),
  workspaceSpec: z.discriminatedUnion(`type`, [
    z.object({
      type: z.literal(`volume`),
      name: z.string(),
    }),
    z.object({
      type: z.literal(`bindMount`),
      hostPath: z.string(),
    }),
  ]),
  idleTimeoutMs: z.number(),
  keepWarm: z.boolean(),
  instanceId: z.string().optional(),
  lastError: z.string().optional(),
  currentPromptInboxKey: z.string().optional(),
  lastInboxKey: z.string().optional(),
  nativeSessionId: z.string().optional(), // ← NEW in Slice B
})
export type SessionMetaRow = z.infer<typeof sessionMetaRowSchema>

export const runRowSchema = z.object({
  key: z.string(),
  startedAt: z.number(),
  endedAt: z.number().optional(),
  status: z.enum([`running`, `completed`, `failed`]),
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
    `sandbox.starting`,
    `sandbox.started`,
    `sandbox.stopped`,
    `sandbox.failed`,
    `pin`,
    `release`,
    `orphan.detected`,
    `resume.restored`, // ← NEW in Slice B
  ]),
  detail: z.string().optional(),
})
export type LifecycleRow = z.infer<typeof lifecycleRowSchema>

// ─── nativeJsonl — NEW in Slice B ────────────────────────────────────────────

export const nativeJsonlRowSchema = z.object({
  key: z.string(), // `${runId}:${seq}` — sortable
  runId: z.string(),
  seq: z.number(),
  line: z.string(), // raw JSONL line from claude CLI stdout
})
export type NativeJsonlRow = z.infer<typeof nativeJsonlRowSchema>
```

- [ ] **Step 2: Edit `packages/coding-agents/src/index.ts`**

Add `CODING_AGENT_NATIVE_JSONL_COLLECTION_TYPE` to the existing collection-type re-exports:

```ts
export {
  CODING_AGENT_SESSION_META_COLLECTION_TYPE,
  CODING_AGENT_RUNS_COLLECTION_TYPE,
  CODING_AGENT_EVENTS_COLLECTION_TYPE,
  CODING_AGENT_LIFECYCLE_COLLECTION_TYPE,
  CODING_AGENT_NATIVE_JSONL_COLLECTION_TYPE, // ← add this line
} from './entity/collections'
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd packages/coding-agents && npx tsc --noEmit
```

**Commit:**

```
git add packages/coding-agents/src/entity/collections.ts packages/coding-agents/src/index.ts
git commit -m "feat(coding-agents): add nativeJsonl collection schema and nativeSessionId to sessionMeta"
```

---

## Phase 1 — StdioBridge resume wiring + handler tee + capture + materialise (sequential-ish)

### Task 1.1 — Unit test for existing `onNativeLine` wiring (already implemented)

**Context:** `onNativeLine` is already wired in `bridge/stdio-bridge.ts` lines 51-56:

```ts
if (args.onNativeLine) args.onNativeLine(line)
```

This task only adds a unit test to lock the behaviour.

**Files:**

- Create: `packages/coding-agents/test/unit/stdio-bridge-resume.test.ts`

- [ ] **Step 1: Write the unit test**

```ts
// packages/coding-agents/test/unit/stdio-bridge-resume.test.ts
import { describe, it, expect, vi } from 'vitest'
import { StdioBridge } from '../../src/bridge/stdio-bridge'
import type { SandboxInstance, RunTurnArgs } from '../../src/types'

/**
 * Minimal sandbox double: exec returns a fake handle whose stdout
 * yields the lines we supply, stderr is empty, and wait() returns 0.
 */
function makeFakeSandbox(stdoutLines: string[]): SandboxInstance {
  const handle = {
    stdout: (async function* () {
      for (const l of stdoutLines) yield l
    })(),
    stderr: (async function* () {})(),
    writeStdin: vi.fn().mockResolvedValue(undefined),
    closeStdin: vi.fn().mockResolvedValue(undefined),
    wait: vi.fn().mockResolvedValue({ exitCode: 0 }),
  }
  return {
    instanceId: `fake-instance`,
    workspaceMount: `/workspace`,
    exec: vi.fn().mockResolvedValue(handle),
    destroy: vi.fn(),
  } as unknown as SandboxInstance
}

describe(`StdioBridge — onNativeLine`, () => {
  it(`calls onNativeLine for every non-empty stdout line`, async () => {
    // Minimal valid claude stream-json: session_init + result line.
    const lines = [
      JSON.stringify({
        type: `system`,
        subtype: `init`,
        session_id: `sess-1`,
        tools: [],
        mcp_servers: [],
      }),
      JSON.stringify({
        type: `result`,
        subtype: `success`,
        result: `ok`,
        session_id: `sess-1`,
        is_error: false,
      }),
    ]
    const sandbox = makeFakeSandbox(lines)
    const bridge = new StdioBridge()
    const received: string[] = []

    await bridge.runTurn({
      sandbox,
      kind: `claude`,
      prompt: `hello`,
      onEvent: () => undefined,
      onNativeLine: (l) => received.push(l),
    } as RunTurnArgs)

    expect(received).toEqual(lines)
  })

  it(`does not call onNativeLine for empty lines`, async () => {
    const lines = [
      ``,
      JSON.stringify({
        type: `result`,
        subtype: `success`,
        result: `ok`,
        session_id: `s`,
        is_error: false,
      }),
    ]
    const sandbox = makeFakeSandbox(lines)
    const bridge = new StdioBridge()
    const received: string[] = []

    await bridge.runTurn({
      sandbox,
      kind: `claude`,
      prompt: `hi`,
      onEvent: () => undefined,
      onNativeLine: (l) => received.push(l),
    } as RunTurnArgs)

    // Empty string should have been skipped by the `if (!line) continue` guard.
    expect(received.every((l) => l.length > 0)).toBe(true)
  })
})
```

- [ ] **Step 2: Run the unit test to confirm it passes**

```bash
cd packages/coding-agents && npx vitest run test/unit/stdio-bridge-resume.test.ts
```

**Commit:**

```
git add packages/coding-agents/test/unit/stdio-bridge-resume.test.ts
git commit -m "test(coding-agents): unit test — onNativeLine already wired in StdioBridge"
```

---

### Task 1.2 — Wire `--resume <nativeSessionId>` in `StdioBridge`

**Files:**

- Modify: `packages/coding-agents/src/bridge/stdio-bridge.ts`

- [ ] **Step 1: Replace the warning block and add `--resume` to `cliArgs`**

Current code (lines 13-18):

```ts
if (args.nativeSessionId) {
  log.warn(
    { nativeSessionId: args.nativeSessionId },
    `StdioBridge MVP does not implement resume — running fresh turn`
  )
}
```

Replace with nothing (delete the block), and after the `cliArgs` array definition add:

```ts
if (args.nativeSessionId) cliArgs.push(`--resume`, args.nativeSessionId)
```

Full resulting file:

```ts
// packages/coding-agents/src/bridge/stdio-bridge.ts
import { normalize } from 'agent-session-protocol'
import type { NormalizedEvent } from 'agent-session-protocol'
import { log } from '../log'
import type { Bridge, RunTurnArgs, RunTurnResult } from '../types'

export class StdioBridge implements Bridge {
  async runTurn(args: RunTurnArgs): Promise<RunTurnResult> {
    if (args.kind !== `claude`) {
      throw new Error(
        `StdioBridge MVP supports only 'claude', got '${args.kind}'`
      )
    }

    const cliArgs: Array<string> = [
      `--print`,
      `--output-format=stream-json`,
      `--verbose`,
      `--dangerously-skip-permissions`,
    ]
    if (args.model) cliArgs.push(`--model`, args.model)
    if (args.nativeSessionId) cliArgs.push(`--resume`, args.nativeSessionId)

    const handle = await args.sandbox.exec({
      cmd: [`claude`, ...cliArgs],
      cwd: args.sandbox.workspaceMount,
      stdin: `pipe`,
    })

    if (!handle.writeStdin || !handle.closeStdin) {
      throw new Error(
        `StdioBridge requires stdin pipe but ExecHandle lacks one`
      )
    }
    await handle.writeStdin(args.prompt)
    await handle.closeStdin()

    const rawLines: Array<string> = []
    const stderrLines: Array<string> = []

    const drainStderr = async () => {
      for await (const line of handle.stderr) {
        stderrLines.push(line)
      }
    }
    const drainStdout = async () => {
      for await (const line of handle.stdout) {
        if (!line) continue
        rawLines.push(line)
        if (args.onNativeLine) args.onNativeLine(line)
      }
    }

    await Promise.all([drainStdout(), drainStderr()])
    const exitInfo = await handle.wait()

    if (exitInfo.exitCode !== 0) {
      const stderrPreview = stderrLines.join(`\n`).slice(0, 800) || `<empty>`
      throw new Error(
        `claude CLI exited ${exitInfo.exitCode}. stderr=${stderrPreview}`
      )
    }

    let events: Array<NormalizedEvent> = []
    try {
      events = normalize(rawLines, `claude`)
    } catch (err) {
      log.error({ err, sample: rawLines.slice(0, 3) }, `normalize failed`)
      throw err
    }

    for (const e of events) args.onEvent(e)

    const sessionInit = events.find((e) => e.type === `session_init`)
    const lastAssistant = [...events]
      .reverse()
      .find((e) => e.type === `assistant_message`)

    return {
      nativeSessionId:
        sessionInit && `sessionId` in sessionInit
          ? (sessionInit as { sessionId?: string }).sessionId
          : undefined,
      exitCode: exitInfo.exitCode,
      finalText:
        lastAssistant && `text` in lastAssistant
          ? (lastAssistant as { text?: string }).text
          : undefined,
    }
  }
}
```

- [ ] **Step 2: Add unit test for `--resume` arg in `stdio-bridge-resume.test.ts`**

Append this test to the existing `stdio-bridge-resume.test.ts`:

```ts
describe(`StdioBridge — --resume`, () => {
  it(`passes --resume <id> to exec cmd when nativeSessionId is provided`, async () => {
    const lines = [
      JSON.stringify({
        type: `result`,
        subtype: `success`,
        result: `ok`,
        session_id: `s`,
        is_error: false,
      }),
    ]
    const sandbox = makeFakeSandbox(lines)
    const bridge = new StdioBridge()

    await bridge.runTurn({
      sandbox,
      kind: `claude`,
      prompt: `hi`,
      onEvent: () => undefined,
      nativeSessionId: `native-sess-abc`,
    } as RunTurnArgs)

    const execCall = (sandbox.exec as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(execCall.cmd).toContain(`--resume`)
    expect(execCall.cmd).toContain(`native-sess-abc`)
  })

  it(`does not pass --resume when nativeSessionId is absent`, async () => {
    const lines = [
      JSON.stringify({
        type: `result`,
        subtype: `success`,
        result: `ok`,
        session_id: `s`,
        is_error: false,
      }),
    ]
    const sandbox = makeFakeSandbox(lines)
    const bridge = new StdioBridge()

    await bridge.runTurn({
      sandbox,
      kind: `claude`,
      prompt: `hi`,
      onEvent: () => undefined,
    } as RunTurnArgs)

    const execCall = (sandbox.exec as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(execCall.cmd).not.toContain(`--resume`)
  })
})
```

- [ ] **Step 3: Run all stdio-bridge tests**

```bash
cd packages/coding-agents && npx vitest run test/unit/stdio-bridge-resume.test.ts
```

**Commit:**

```
git add packages/coding-agents/src/bridge/stdio-bridge.ts packages/coding-agents/test/unit/stdio-bridge-resume.test.ts
git commit -m "feat(coding-agents): wire --resume <nativeSessionId> in StdioBridge"
```

---

### Task 1.3 — Handler: tee `onNativeLine` into `nativeJsonl` collection + capture `nativeSessionId`

**Files:**

- Modify: `packages/coding-agents/src/entity/handler.ts`

The changes are in `processPrompt`. There are two distinct changes:

**A) Tee raw lines into `nativeJsonl` inside the `runTurn` call.**

Replace the `runTurn` call (currently lines 371-389 of the original) with a version that adds `onNativeLine`:

```ts
// Inside processPrompt, in the try block after runs_insert:
let nativeLineSeq = 0
const result = await raceTimeout(
  lm.bridge.runTurn({
    sandbox,
    kind: meta.kind,
    prompt: promptText,
    nativeSessionId: meta.nativeSessionId, // pass stored id (may be undefined on first run)
    onNativeLine: (line: string) => {
      ctx.db.actions.nativeJsonl_insert({
        row: {
          key: eventKey(runId, nativeLineSeq),
          runId,
          seq: nativeLineSeq,
          line,
        } satisfies NativeJsonlRow,
      })
      nativeLineSeq++
    },
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
```

**B) Capture `nativeSessionId` from the result and persist it in `sessionMeta`.**

After the `result = await raceTimeout(...)` resolves and before the `runs_update completed` block:

```ts
// Persist nativeSessionId from this turn if we don't have one yet.
if (result.nativeSessionId && !meta.nativeSessionId) {
  ctx.db.actions.sessionMeta_update({
    key: `current`,
    updater: (d: SessionMetaRow) => {
      d.nativeSessionId = result.nativeSessionId
    },
  })
}
```

- [ ] **Step 1: Add `NativeJsonlRow` import at top of handler.ts**

```ts
import type {
  RunRow,
  SessionMetaRow,
  EventRow,
  LifecycleRow,
  NativeJsonlRow, // ← add
} from './collections'
```

- [ ] **Step 2: Apply changes A and B to `processPrompt`**

The full updated `processPrompt` run block (replacing from `let seq = 0` to the `recordedRun.end({ status: 'completed' })` call):

```ts
let seq = 0
let nativeLineSeq = 0
let finalText: string | undefined
try {
  const result = await raceTimeout(
    lm.bridge.runTurn({
      sandbox,
      kind: meta.kind,
      prompt: promptText,
      nativeSessionId: meta.nativeSessionId,
      onNativeLine: (line: string) => {
        ctx.db.actions.nativeJsonl_insert({
          row: {
            key: eventKey(runId, nativeLineSeq),
            runId,
            seq: nativeLineSeq,
            line,
          } satisfies NativeJsonlRow,
        })
        nativeLineSeq++
      },
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

  // Persist nativeSessionId from this turn if we don't have one yet.
  if (result.nativeSessionId && !meta.nativeSessionId) {
    ctx.db.actions.sessionMeta_update({
      key: `current`,
      updater: (d: SessionMetaRow) => {
        d.nativeSessionId = result.nativeSessionId
      },
    })
  }

  ctx.db.actions.runs_update({
    key: runId,
    updater: (d: RunRow) => {
      d.status = `completed`
      d.endedAt = Date.now()
      d.responseText = finalText
    },
  })
  if (finalText) recordedRun.attachResponse(finalText)
  recordedRun.end({ status: `completed` })
} catch (err) {
  // ... (rest of catch block unchanged)
```

- [ ] **Step 3: TypeScript check**

```bash
cd packages/coding-agents && npx tsc --noEmit
```

**Commit:**

```
git add packages/coding-agents/src/entity/handler.ts
git commit -m "feat(coding-agents): tee onNativeLine into nativeJsonl and capture nativeSessionId per turn"
```

---

### Task 1.4 — Handler: cold-boot materialise prior `nativeJsonl` for resume

**Files:**

- Modify: `packages/coding-agents/src/entity/handler.ts`

On cold-boot, before calling `lm.bridge.runTurn`, if `meta.nativeSessionId` is set and `nativeJsonl` rows exist, write them to `/tmp/resume.jsonl` inside the sandbox and pass that path to `--resume` via the already-wired `nativeSessionId` field.

**Note on path:** `claude --resume` expects the native session id (the UUID), not a file path. The CLI looks for the session's JSONL file in `~/.claude/projects/<sanitized-cwd>/`. The sanitised path of `/workspace` is `-workspace` (replace `/` → `-`, strip leading `-` → net result: `workspace`, but the claude CLI converts `/workspace` to `-workspace` by replacing every `/` with `-` and prepending nothing; actually `~/.claude/projects/` + replace(`/workspace`, `/`, `-`) = `-workspace`). So we must write the materialized file to `~/.claude/projects/-workspace/<nativeSessionId>.jsonl` inside the container.

The exec command to materialise:

```
sandbox.exec({ cmd: ['sh', '-c', `mkdir -p ~/.claude/projects/-workspace && cat > ~/.claude/projects/-workspace/<id>.jsonl <<'__JSONL__'\n<lines>\n__JSONL__`] })
```

Because the lines may contain special characters, it is safer to write the file via a base64-encoded payload piped through `base64 -d`:

```ts
const b64 = Buffer.from(lines.join('\n') + '\n').toString('base64')
await sandbox.exec({
  cmd: [
    'sh',
    '-c',
    `mkdir -p ~/.claude/projects/-workspace && printf '%s' '${b64}' | base64 -d > ~/.claude/projects/-workspace/${nativeSessionId}.jsonl`,
  ],
  cwd: sandbox.workspaceMount,
})
```

- [ ] **Step 1: Add materialise helper function at the top of `handler.ts` (after imports)**

```ts
/**
 * Sanitise an absolute path for use as the claude project directory name
 * under ~/.claude/projects/. The CLI replaces every `/` with `-`, producing
 * e.g. `/workspace` → `-workspace`.
 */
function sanitiseCwd(cwd: string): string {
  return cwd.replace(/\//g, `-`)
}

/**
 * Materialise nativeJsonl rows into the container's ~/.claude/projects/ so
 * that `claude --resume <sessionId>` finds its session file.
 */
async function materialiseResume(
  sandbox: SandboxInstance,
  nativeSessionId: string,
  lines: string[]
): Promise<void> {
  if (lines.length === 0) return
  const projectDir = sanitiseCwd(sandbox.workspaceMount)
  const jsonlContent = lines.join(`\n`) + `\n`
  // Base64-encode to avoid quoting issues with special chars in JSONL lines.
  const b64 = Buffer.from(jsonlContent).toString(`base64`)
  await sandbox.exec({
    cmd: [
      `sh`,
      `-c`,
      `mkdir -p ~/.claude/projects/${projectDir} && printf '%s' '${b64}' | base64 -d > ~/.claude/projects/${projectDir}/${nativeSessionId}.jsonl`,
    ],
    cwd: sandbox.workspaceMount,
  })
}
```

- [ ] **Step 2: Add `SandboxInstance` import**

The handler already imports from lifecycle-manager and workspace-registry. Add the `SandboxInstance` type import:

```ts
import type { SandboxInstance } from '../types'
```

- [ ] **Step 3: Call `materialiseResume` inside `processPrompt`, after the sandbox is up**

After the `ctx.db.actions.lifecycle_insert` for `sandbox.started` and before `wr.acquire`:

```ts
// Resume materialisation: if we have a prior nativeSessionId and nativeJsonl
// rows, write them into the container so --resume finds the session file.
if (meta.nativeSessionId) {
  const nativeJsonlCol = ctx.db.collections.nativeJsonl
  const allLines: string[] = (nativeJsonlCol.toArray as Array<NativeJsonlRow>)
    .slice()
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .map((r) => r.line)

  if (allLines.length > 0) {
    await materialiseResume(sandbox, meta.nativeSessionId, allLines)
    ctx.db.actions.lifecycle_insert({
      row: {
        key: lifecycleKey(`resume`),
        ts: Date.now(),
        event: `resume.restored`,
        detail: `lines=${allLines.length}`,
      } satisfies LifecycleRow,
    })
  }
}
```

- [ ] **Step 4: TypeScript check**

```bash
cd packages/coding-agents && npx tsc --noEmit
```

- [ ] **Step 5: Write unit test for materialise**

Create `packages/coding-agents/test/unit/handler-resume.test.ts`:

```ts
// packages/coding-agents/test/unit/handler-resume.test.ts
import { describe, it, expect, vi } from 'vitest'

// Pull the helper via a small re-export shim if it's not exported,
// or test it indirectly via the handler. Here we test it indirectly
// by asserting that sandbox.exec receives the right cmd.

// Since materialiseResume is not exported, we exercise it through
// processPrompt via makeFakeCtx (adapted from slice-a.test.ts).

import { makeCodingAgentHandler } from '../../src/entity/handler'
import type { LifecycleManager } from '../../src/lifecycle-manager'
import type { SandboxInstance } from '../../src/types'
import type {
  NativeJsonlRow,
  SessionMetaRow,
} from '../../src/entity/collections'

// ---------- minimal doubles --------------------------------------------------

function makeExecHandle(stdoutLines: string[]) {
  return {
    stdout: (async function* () {
      for (const l of stdoutLines) yield l
    })(),
    stderr: (async function* () {})(),
    writeStdin: vi.fn().mockResolvedValue(undefined),
    closeStdin: vi.fn().mockResolvedValue(undefined),
    wait: vi.fn().mockResolvedValue({ exitCode: 0 }),
  }
}

function makeSandbox(
  stdoutLines: string[]
): SandboxInstance & { execCalls: any[] } {
  const execCalls: any[] = []
  return {
    instanceId: `inst-1`,
    workspaceMount: `/workspace`,
    exec: vi.fn(async (req) => {
      execCalls.push(req)
      return makeExecHandle(stdoutLines)
    }),
    destroy: vi.fn(),
    execCalls,
  } as any
}

function makeMinimalLm(sandbox: SandboxInstance) {
  const lm = {
    startedAtMs: Date.now(),
    provider: {
      status: vi.fn().mockResolvedValue(`stopped`),
      destroy: vi.fn().mockResolvedValue(undefined),
    },
    bridge: {
      runTurn: vi.fn().mockResolvedValue({
        nativeSessionId: `native-1`,
        finalText: `reply`,
        exitCode: 0,
      }),
    },
    ensureRunning: vi.fn().mockResolvedValue(sandbox),
    stop: vi.fn().mockResolvedValue(undefined),
    destroy: vi.fn().mockResolvedValue(undefined),
    pin: vi.fn().mockReturnValue({ count: 1 }),
    release: vi.fn().mockReturnValue({ count: 0 }),
    pinCount: vi.fn().mockReturnValue(0),
    armIdleTimer: vi.fn(),
  }
  return lm as unknown as LifecycleManager
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

function makeFakeCtx(entityUrl: string, args: Record<string, unknown>) {
  const state = {
    sessionMeta: makeCollection(),
    runs: makeCollection(),
    events: makeCollection(),
    lifecycle: makeCollection(),
    nativeJsonl: makeCollection(),
    inbox: makeCollection(),
  }
  let runCounter = 0
  const ctx: any = {
    entityUrl,
    entityType: `coding-agent`,
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
        nativeJsonl_insert: ({ row }: any) =>
          state.nativeJsonl.rows.set(row.key, row),
      },
    },
    recordRun() {
      const key = `run-${++runCounter}`
      const ent: any = { key, status: undefined, response: `` }
      state.runs.rows.set(key, ent)
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

// ---------- tests ------------------------------------------------------------

describe(`handler resume materialisation`, () => {
  it(`calls sandbox.exec to materialise nativeJsonl rows on cold-boot when nativeSessionId is set`, async () => {
    const sandbox = makeSandbox([])
    const lm = makeMinimalLm(sandbox)

    // Pre-seed nativeJsonl rows and sessionMeta with a nativeSessionId.
    const { ctx, state } = makeFakeCtx(`/test/ca/resume-1`, {
      kind: `claude`,
      workspaceType: `volume`,
      workspaceName: `vol-1`,
    })
    const { WorkspaceRegistry } = await import('../../src/workspace-registry')
    const wr = new WorkspaceRegistry()

    const handler = makeCodingAgentHandler(lm, wr, {
      defaults: {
        idleTimeoutMs: 500,
        coldBootBudgetMs: 30_000,
        runTimeoutMs: 60_000,
      },
      env: () => ({}),
    })

    // First wake — initialises sessionMeta (status: cold)
    await handler(ctx, { type: `message_received` })

    // Manually inject nativeSessionId and nativeJsonl rows (simulating a prior run).
    state.sessionMeta.rows.set(`current`, {
      ...(state.sessionMeta.get(`current`) as SessionMetaRow),
      nativeSessionId: `native-sess-xyz`,
    })
    const fakeJsonlLine = JSON.stringify({
      type: `result`,
      subtype: `success`,
      result: `prior`,
      session_id: `native-sess-xyz`,
      is_error: false,
    })
    state.nativeJsonl.rows.set(`run-1:000000000000000`, {
      key: `run-1:000000000000000`,
      runId: `run-1`,
      seq: 0,
      line: fakeJsonlLine,
    } satisfies NativeJsonlRow)

    // Second wake with a prompt — should trigger materialise.
    state.inbox.rows.set(`i1`, {
      key: `i1`,
      message_type: `prompt`,
      payload: { text: `second prompt` },
    })
    await handler(ctx, { type: `message_received` })

    // sandbox.exec should have been called at least twice:
    // once for materialise, once for the claude CLI invocation.
    // The materialise call has a shell command containing base64.
    const shellCalls = (
      sandbox.exec as ReturnType<typeof vi.fn>
    ).mock.calls.filter((c: any[]) => c[0]?.cmd?.[0] === `sh`)
    expect(shellCalls.length).toBeGreaterThan(0)
    const cmd = shellCalls[0][0].cmd.join(` `)
    expect(cmd).toContain(`native-sess-xyz.jsonl`)
    expect(cmd).toContain(`base64`)
  })

  it(`adds a resume.restored lifecycle row after materialisation`, async () => {
    const sandbox = makeSandbox([])
    const lm = makeMinimalLm(sandbox)
    const { ctx, state } = makeFakeCtx(`/test/ca/resume-2`, {
      kind: `claude`,
      workspaceType: `volume`,
      workspaceName: `vol-2`,
    })
    const { WorkspaceRegistry } = await import('../../src/workspace-registry')
    const wr = new WorkspaceRegistry()

    const handler = makeCodingAgentHandler(lm, wr, {
      defaults: {
        idleTimeoutMs: 500,
        coldBootBudgetMs: 30_000,
        runTimeoutMs: 60_000,
      },
      env: () => ({}),
    })

    await handler(ctx, { type: `message_received` })

    state.sessionMeta.rows.set(`current`, {
      ...(state.sessionMeta.get(`current`) as SessionMetaRow),
      nativeSessionId: `native-sess-abc`,
    })
    state.nativeJsonl.rows.set(`run-1:0`, {
      key: `run-1:0`,
      runId: `run-1`,
      seq: 0,
      line: `{"type":"result","subtype":"success","result":"x","session_id":"native-sess-abc","is_error":false}`,
    } satisfies NativeJsonlRow)

    state.inbox.rows.set(`i1`, {
      key: `i1`,
      message_type: `prompt`,
      payload: { text: `hello again` },
    })
    await handler(ctx, { type: `message_received` })

    const lifecycleRows = Array.from(state.lifecycle.rows.values()) as any[]
    const resumeRow = lifecycleRows.find((r) => r.event === `resume.restored`)
    expect(resumeRow).toBeDefined()
    expect(resumeRow.detail).toMatch(/lines=1/)
  })
})
```

- [ ] **Step 6: Run unit tests**

```bash
cd packages/coding-agents && npx vitest run test/unit/handler-resume.test.ts
```

**Commit:**

```
git add packages/coding-agents/src/entity/handler.ts packages/coding-agents/test/unit/handler-resume.test.ts
git commit -m "feat(coding-agents): materialise nativeJsonl on cold-boot for --resume"
```

---

## Phase 2 — Add `nativeJsonl` to `register.ts` + update `FakeCtx` helper (sequential)

### Task 2.1 — Register `nativeJsonl` collection in entity definition

**Files:**

- Modify: `packages/coding-agents/src/entity/register.ts`

- [ ] **Step 1: Add `CODING_AGENT_NATIVE_JSONL_COLLECTION_TYPE` and `nativeJsonlRowSchema` imports**

```ts
import {
  CODING_AGENT_EVENTS_COLLECTION_TYPE,
  CODING_AGENT_LIFECYCLE_COLLECTION_TYPE,
  CODING_AGENT_NATIVE_JSONL_COLLECTION_TYPE, // ← add
  CODING_AGENT_RUNS_COLLECTION_TYPE,
  CODING_AGENT_SESSION_META_COLLECTION_TYPE,
  eventRowSchema,
  lifecycleRowSchema,
  nativeJsonlRowSchema, // ← add
  runRowSchema,
  sessionMetaRowSchema,
} from './collections'
```

- [ ] **Step 2: Add `nativeJsonl` entry to the `state` object in `registry.define`**

```ts
state: {
  sessionMeta: {
    schema: sessionMetaRowSchema,
    type: CODING_AGENT_SESSION_META_COLLECTION_TYPE,
    primaryKey: `key`,
  },
  runs: {
    schema: runRowSchema,
    type: CODING_AGENT_RUNS_COLLECTION_TYPE,
    primaryKey: `key`,
  },
  events: {
    schema: eventRowSchema,
    type: CODING_AGENT_EVENTS_COLLECTION_TYPE,
    primaryKey: `key`,
  },
  lifecycle: {
    schema: lifecycleRowSchema,
    type: CODING_AGENT_LIFECYCLE_COLLECTION_TYPE,
    primaryKey: `key`,
  },
  nativeJsonl: {                               // ← NEW
    schema: nativeJsonlRowSchema,
    type: CODING_AGENT_NATIVE_JSONL_COLLECTION_TYPE,
    primaryKey: `key`,
  },
},
```

- [ ] **Step 3: TypeScript check**

```bash
cd packages/coding-agents && npx tsc --noEmit
```

**Commit:**

```
git add packages/coding-agents/src/entity/register.ts
git commit -m "feat(coding-agents): register nativeJsonl collection in coding-agent entity definition"
```

---

### Task 2.2 — Integration test: lossless resume (Docker-gated)

**Files:**

- Create: `packages/coding-agents/test/integration/slice-b.test.ts`

This test extends the FakeCtx pattern from `slice-a.test.ts` with `nativeJsonl` collection support. It is Docker-gated (`DOCKER=1`).

The test verifies: after a first prompt completes and the sandbox goes idle, a second prompt on the same agent (which triggers a cold-boot) references the prior response — proving `--resume` is working.

- [ ] **Step 1: Write the test**

```ts
// packages/coding-agents/test/integration/slice-b.test.ts
import { describe, it, expect, beforeAll } from 'vitest'
import {
  LocalDockerProvider,
  StdioBridge,
  WorkspaceRegistry,
  LifecycleManager,
} from '../../src'
import { makeCodingAgentHandler } from '../../src/entity/handler'
import { buildTestImage, TEST_IMAGE_TAG } from '../support/build-image'
import { loadTestEnv } from '../support/env'

const SHOULD_RUN = process.env.DOCKER === `1`
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
    get(k: string) {
      return rows.get(k)
    },
    get toArray(): Array<any> {
      return Array.from(rows.values())
    },
  }
}

function makeFakeCtx(entityUrl: string, args: Record<string, unknown>) {
  const state = {
    sessionMeta: makeCollection(),
    runs: makeCollection(),
    events: makeCollection(),
    lifecycle: makeCollection(),
    nativeJsonl: makeCollection(),
    inbox: makeCollection(),
  }
  let runCounter = 0
  const ctx: any = {
    entityUrl,
    entityType: `coding-agent`,
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
        nativeJsonl_insert: ({ row }: any) =>
          state.nativeJsonl.rows.set(row.key, row),
      },
    },
    recordRun() {
      const key = `run-${++runCounter}`
      const ent: any = { key, status: undefined, response: `` }
      state.runs.rows.set(key, ent)
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

describeMaybe(`Slice B — resume integration`, () => {
  beforeAll(async () => {
    await buildTestImage()
  }, 600_000)

  it(`second prompt references prior turn content (lossless resume)`, async () => {
    const env = loadTestEnv()
    const provider = new LocalDockerProvider({ image: TEST_IMAGE_TAG })
    const bridge = new StdioBridge()
    const wr = new WorkspaceRegistry()
    const lm = new LifecycleManager({ provider, bridge })
    const handler = makeCodingAgentHandler(lm, wr, {
      defaults: {
        idleTimeoutMs: 1500,
        coldBootBudgetMs: 60_000,
        runTimeoutMs: 120_000,
      },
      env: () => ({ ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY }),
    })

    const agentId = `/test/coding-agent/resume-${Date.now().toString(36)}`
    const args = {
      kind: `claude`,
      workspaceType: `volume`,
      workspaceName: `slice-b-resume-${Date.now().toString(36)}`,
      idleTimeoutMs: 1500,
    }
    const { ctx, state } = makeFakeCtx(agentId, args)

    // ── First wake: init ──────────────────────────────────────────────────────
    await handler(ctx, { type: `message_received` })
    expect(state.sessionMeta.get(`current`).status).toBe(`cold`)

    // ── First prompt: establish a memorable fact ───────────────────────────────
    state.inbox.rows.set(`i1`, {
      key: `i1`,
      message_type: `prompt`,
      payload: {
        text: `Remember the secret code word: BANANA. Reply with "Acknowledged: BANANA" and nothing else.`,
      },
    })
    await handler(ctx, { type: `message_received` })

    const meta1 = state.sessionMeta.get(`current`)
    expect(meta1.status).toBe(`idle`)
    expect(meta1.nativeSessionId).toBeDefined()

    const runs1 = Array.from(state.runs.rows.values()) as any[]
    expect(runs1).toHaveLength(1)
    expect(runs1[0].status).toBe(`completed`)

    // Verify nativeJsonl rows were collected.
    const nativeRows = Array.from(state.nativeJsonl.rows.values()) as any[]
    expect(nativeRows.length).toBeGreaterThan(0)

    // ── Wait past idle timeout so sandbox stops ───────────────────────────────
    await new Promise((r) => setTimeout(r, 2500))
    expect([`stopped`, `unknown`]).toContain(await provider.status(agentId))

    // ── Second prompt: ask about the fact from the first turn ─────────────────
    state.inbox.rows.set(`i2`, {
      key: `i2`,
      message_type: `prompt`,
      payload: {
        text: `What was the secret code word I asked you to remember? Reply with just the word.`,
      },
    })
    await handler(ctx, { type: `message_received` })

    const runs2 = Array.from(state.runs.rows.values()) as any[]
    expect(runs2.length).toBeGreaterThanOrEqual(2)
    const lastRun = runs2[runs2.length - 1]
    expect(lastRun.status).toBe(`completed`)

    // ── Assert lossless resume: response must contain BANANA ──────────────────
    expect(lastRun.responseText?.toUpperCase()).toContain(`BANANA`)

    // ── Verify resume.restored lifecycle row was emitted ─────────────────────
    const lifecycleRows = Array.from(state.lifecycle.rows.values()) as any[]
    const resumeRow = lifecycleRows.find(
      (r: any) => r.event === `resume.restored`
    )
    expect(resumeRow).toBeDefined()

    // Cleanup
    await provider.destroy(agentId).catch(() => undefined)
  }, 360_000)
})
```

- [ ] **Step 2: Run (skip if not in Docker environment)**

```bash
# Without Docker (skips):
cd packages/coding-agents && npx vitest run test/integration/slice-b.test.ts

# With Docker (real run):
DOCKER=1 cd packages/coding-agents && npx vitest run test/integration/slice-b.test.ts
```

**Commit:**

```
git add packages/coding-agents/test/integration/slice-b.test.ts
git commit -m "test(coding-agents): integration test for lossless resume (Slice B)"
```

---

### Task 2.3 — Full coding-agents test suite pass

- [ ] **Step 1: Run all unit tests**

```bash
cd packages/coding-agents && npx vitest run test/unit/
```

- [ ] **Step 2: Verify no TypeScript errors across the package**

```bash
cd packages/coding-agents && npx tsc --noEmit
```

**Commit:** (no new files; fix any failures discovered)

---

## Phase 3 — Horton tool migration (parallel agents)

### Task 3.1 — Create `spawn-coding-agent.ts` and `prompt-coding-agent.ts`

**Files:**

- Create: `packages/agents/src/tools/spawn-coding-agent.ts`
- Create: `packages/agents/src/tools/prompt-coding-agent.ts`

- [ ] **Step 1: Write `spawn-coding-agent.ts`**

```ts
// packages/agents/src/tools/spawn-coding-agent.ts
import { Type } from '@sinclair/typebox'
import { nanoid } from 'nanoid'
import { serverLog } from '../log'
import type { AgentTool } from '@mariozechner/pi-agent-core'
import type { HandlerContext } from '@electric-ax/agents-runtime'

export function createSpawnCodingAgentTool(ctx: HandlerContext): AgentTool {
  return {
    name: `spawn_coding_agent`,
    label: `Spawn Coding Agent`,
    description: `Spawn a coding-agent subagent that drives a Claude Code CLI session inside a Docker sandbox with its own persistent workspace. Use when the user asks for code changes, file edits, debugging, or any task that benefits from a real coding agent with full tool access. The coding-agent is long-lived — its URL stays valid across many turns, so keep prompting it via prompt_coding_agent without re-spawning. End your turn after spawning; you'll be woken when the coding-agent finishes its first reply.`,
    parameters: Type.Object({
      prompt: Type.String({
        description: `First user message sent to the coding agent. This kicks off the run — be concrete: describe the task, mention the files/paths involved, and what form of answer you want back.`,
      }),
      workspace_name: Type.Optional(
        Type.String({
          description: `Optional stable name for the Docker volume workspace. If omitted, a name is derived from the agent id. Reuse the same name across sessions to persist state.`,
        })
      ),
      idle_timeout_ms: Type.Optional(
        Type.Number({
          description: `Milliseconds of inactivity after which the sandbox is hibernated. Defaults to 300000 (5 min). The workspace persists; the next prompt cold-boots the container.`,
        })
      ),
    }),
    execute: async (_toolCallId, params) => {
      const { prompt, workspace_name, idle_timeout_ms } = params as {
        prompt: string
        workspace_name?: string
        idle_timeout_ms?: number
      }
      if (typeof prompt !== `string` || prompt.length === 0) {
        return {
          content: [
            {
              type: `text` as const,
              text: `Error: prompt is required and must be a non-empty string.`,
            },
          ],
          details: { spawned: false },
        }
      }

      const id = nanoid(10)
      const spawnArgs: Record<string, unknown> = {
        kind: `claude`,
        workspaceType: `volume`,
      }
      if (workspace_name) spawnArgs.workspaceName = workspace_name
      if (idle_timeout_ms != null) spawnArgs.idleTimeoutMs = idle_timeout_ms

      try {
        const handle = await ctx.spawn(`coding-agent`, id, spawnArgs, {
          initialMessage: { text: prompt },
          wake: { on: `runFinished`, includeResponse: true },
        })
        const agentUrl = handle.entityUrl

        return {
          content: [
            {
              type: `text` as const,
              text: `Coding agent dispatched at ${agentUrl}. End your turn — when the coding agent finishes its current reply you'll be woken with the response. To send follow-up prompts to the same agent, call prompt_coding_agent with this URL.`,
            },
          ],
          details: { spawned: true, agentUrl },
        }
      } catch (err) {
        serverLog.warn(
          `[spawn_coding_agent tool] failed to spawn coding-agent ${id}: ${err instanceof Error ? err.message : String(err)}`,
          err instanceof Error ? err : undefined
        )
        return {
          content: [
            {
              type: `text` as const,
              text: `Error spawning coding agent: ${err instanceof Error ? err.message : `Unknown error`}`,
            },
          ],
          details: { spawned: false },
        }
      }
    },
  }
}
```

- [ ] **Step 2: Write `prompt-coding-agent.ts`**

```ts
// packages/agents/src/tools/prompt-coding-agent.ts
import { Type } from '@sinclair/typebox'
import { serverLog } from '../log'
import type { AgentTool } from '@mariozechner/pi-agent-core'
import type { HandlerContext } from '@electric-ax/agents-runtime'

export function createPromptCodingAgentTool(ctx: HandlerContext): AgentTool {
  return {
    name: `prompt_coding_agent`,
    label: `Prompt Coding Agent`,
    description: `Send a follow-up prompt to a coding agent you previously spawned. The prompt is queued on the agent's inbox and runs as the next CLI turn (resuming from prior context). End your turn after calling — you'll be woken when the agent's reply lands.`,
    parameters: Type.Object({
      coding_agent_url: Type.String({
        description: `Entity URL returned by spawn_coding_agent, e.g. "/coding-agent/abc123". Must be the URL of a coding agent you previously spawned in this conversation.`,
      }),
      prompt: Type.String({
        description: `Follow-up message to send to the coding agent. Reference earlier context the agent already saw rather than restating it from scratch.`,
      }),
    }),
    execute: async (_toolCallId, params) => {
      const { coding_agent_url, prompt } = params as {
        coding_agent_url: string
        prompt: string
      }
      if (
        typeof coding_agent_url !== `string` ||
        !coding_agent_url.startsWith(`/coding-agent/`)
      ) {
        return {
          content: [
            {
              type: `text` as const,
              text: `Error: coding_agent_url must be a path like "/coding-agent/<id>".`,
            },
          ],
          details: { sent: false },
        }
      }
      if (typeof prompt !== `string` || prompt.length === 0) {
        return {
          content: [
            {
              type: `text` as const,
              text: `Error: prompt is required and must be a non-empty string.`,
            },
          ],
          details: { sent: false },
        }
      }

      try {
        ctx.send(coding_agent_url, { text: prompt })
        return {
          content: [
            {
              type: `text` as const,
              text: `Prompt queued for ${coding_agent_url}. End your turn — you'll be woken when the coding agent's reply lands.`,
            },
          ],
          details: { sent: true, agentUrl: coding_agent_url },
        }
      } catch (err) {
        serverLog.warn(
          `[prompt_coding_agent tool] failed to send to ${coding_agent_url}: ${err instanceof Error ? err.message : String(err)}`,
          err instanceof Error ? err : undefined
        )
        return {
          content: [
            {
              type: `text` as const,
              text: `Error sending prompt to coding agent: ${err instanceof Error ? err.message : `Unknown error`}`,
            },
          ],
          details: { sent: false },
        }
      }
    },
  }
}
```

**Commit:**

```
git add packages/agents/src/tools/spawn-coding-agent.ts packages/agents/src/tools/prompt-coding-agent.ts
git commit -m "feat(agents): add spawn_coding_agent and prompt_coding_agent tools"
```

---

### Task 3.2 — Update Horton: swap tool list + system prompt + imports

**Files:**

- Modify: `packages/agents/src/agents/horton.ts`

- [ ] **Step 1: Replace legacy import**

Old:

```ts
import {
  createPromptCoderTool,
  createSpawnCoderTool,
} from '../tools/spawn-coder'
```

New:

```ts
import { createSpawnCodingAgentTool } from '../tools/spawn-coding-agent'
import { createPromptCodingAgentTool } from '../tools/prompt-coding-agent'
```

- [ ] **Step 2: Update `createHortonTools` return array**

Old:

```ts
createSpawnCoderTool(ctx),
createPromptCoderTool(ctx),
```

New:

```ts
createSpawnCodingAgentTool(ctx),
createPromptCodingAgentTool(ctx),
```

- [ ] **Step 3: Update system prompt tool list (lines ~218-219)**

Old:

```
- spawn_coder: spawn a long-lived coding agent (Claude Code or Codex CLI) for code changes, file edits, debugging
- prompt_coder: send a follow-up prompt to a coder you previously spawned
```

New:

```
- spawn_coding_agent: spawn a long-lived coding agent (Claude Code CLI) in a Docker sandbox for code changes, file edits, debugging
- prompt_coding_agent: send a follow-up prompt to a coding agent you previously spawned
```

- [ ] **Step 4: Update "When to spawn a coder" section (~lines 247-252)**

Old:

```
# When to spawn a coder
Spawn a coder when the user asks for code changes, file edits, debugging, or any task that benefits from a real coding agent with full tool access (bash, file edits, etc.). A coder runs Claude Code or Codex CLI under the hood.

Unlike a worker, a coder is **long-lived**: its URL stays valid across many turns. Spawn once with spawn_coder, then keep prompting it via prompt_coder for follow-ups — don't spawn a new coder for each turn. Treat the coder URL like a chat handle.

After calling spawn_coder or prompt_coder, end your turn. When the coder's reply lands, you'll be woken with the response in the wake message — relay it (or a summary) back to the user, and call prompt_coder again if there's a follow-up.
```

New:

```
# When to spawn a coding agent
Spawn a coding agent when the user asks for code changes, file edits, debugging, or any task that benefits from a real coding agent with full tool access (bash, file edits, etc.). A coding agent runs Claude Code CLI inside a Docker sandbox with a persistent workspace.

Unlike a worker, a coding agent is **long-lived**: its URL stays valid across many turns and its session context carries over (via resume). Spawn once with spawn_coding_agent, then keep prompting it via prompt_coding_agent for follow-ups — don't spawn a new agent for each turn. Treat the coding agent URL like a chat handle.

After calling spawn_coding_agent or prompt_coding_agent, end your turn. When the agent's reply lands, you'll be woken with the response in the wake message — relay it (or a summary) back to the user, and call prompt_coding_agent again if there's a follow-up.
```

- [ ] **Step 5: TypeScript check**

```bash
cd packages/agents && npx tsc --noEmit
```

**Commit:**

```
git add packages/agents/src/agents/horton.ts
git commit -m "feat(agents): migrate Horton from spawn_coder/prompt_coder to spawn_coding_agent/prompt_coding_agent"
```

---

## Phase 4 — Legacy deletion (parallel agents)

### Task 4.1 — Delete `coding-session.ts` and `spawn-coder.ts`

**Files:**

- Delete: `packages/agents/src/agents/coding-session.ts`
- Delete: `packages/agents/src/tools/spawn-coder.ts`

- [ ] **Step 1: Delete files**

```bash
rm packages/agents/src/agents/coding-session.ts
rm packages/agents/src/tools/spawn-coder.ts
```

- [ ] **Step 2: Remove `registerCodingSession` from `bootstrap.ts`**

In `packages/agents/src/bootstrap.ts`:

Remove line 12:

```ts
import { registerCodingSession } from './agents/coding-session'
```

Remove line 124:

```ts
registerCodingSession(registry, { defaultWorkingDirectory: cwd })
```

Remove line 125:

```ts
typeNames.push('coder')
```

- [ ] **Step 3: TypeScript check**

```bash
cd packages/agents && npx tsc --noEmit
```

**Commit:**

```
git add packages/agents/src/bootstrap.ts
git rm packages/agents/src/agents/coding-session.ts packages/agents/src/tools/spawn-coder.ts
git commit -m "feat(agents): remove legacy coder entity (coding-session.ts, spawn-coder.ts) and unregister from bootstrap"
```

---

### Task 4.2 — Remove legacy runtime types from `agents-runtime`

**Files:**

- Modify: `packages/agents-runtime/src/types.ts`
- Modify: `packages/agents-runtime/src/context-factory.ts`
- Modify: `packages/agents-runtime/src/index.ts`

The legacy types to remove from `types.ts` (lines 734-818 in the current file):

- `CodingSessionStatus`
- `CodingSessionEventRow`
- `CodingSessionMeta`
- `CodingSessionMetaRow`
- `UseCodingAgentOptions`
- `CodingSessionHandle`

The `HandlerContext` interface method to remove (`useCodingAgent` at line 1002).

The `useCodingAgent` implementation in `context-factory.ts` (lines 566-634).

- [ ] **Step 1: Delete legacy type blocks from `types.ts`**

Remove the entire block from `export type CodingSessionStatus` through the closing `}` of `CodingSessionHandle`. Keep everything from `// ─── Coding Agent (Slice A) ───` onward.

- [ ] **Step 2: Remove `useCodingAgent` from `HandlerContext` interface in `types.ts`**

Find and remove the `useCodingAgent(id: string, opts: UseCodingAgentOptions): CodingSessionHandle` line (and any JSDoc above it) from the `HandlerContext` interface.

- [ ] **Step 3: Remove `useCodingAgent` implementation from `context-factory.ts`**

Remove the `useCodingAgent` function body (lines 566-634) and its surrounding infrastructure. Also remove the imports of `CodingSessionEventRow`, `CodingSessionHandle`, `CodingSessionMeta`, `CodingSessionStatus`, `UseCodingAgentOptions` from the types import at the top of `context-factory.ts`.

Remove `CODING_SESSION_ENTITY_TYPE` and `codingSessionEntityUrl` imports from `context-factory.ts` if they are only used by `useCodingAgent`.

- [ ] **Step 4: Remove legacy exports from `index.ts`**

In `packages/agents-runtime/src/index.ts`:

Remove from the type export block (lines 24-41 area):

- `CodingSessionEventRow`
- `CodingSessionHandle`
- `CodingSessionMeta`
- `CodingSessionMetaRow`
- `CodingSessionStatus`
- `UseCodingAgentOptions`

Remove from the observation-sources export block (lines 198-210 area):

- `CODING_SESSION_ENTITY_TYPE`
- `CODING_SESSION_META_COLLECTION_TYPE`
- `CODING_SESSION_CURSOR_COLLECTION_TYPE`
- `CODING_SESSION_EVENT_COLLECTION_TYPE`
- `codingSession`
- `codingSessionEntityUrl`

**Note:** Keep `CODING_SESSION_*` constants in `observation-sources.ts` itself for now (they may be referenced by existing entity streams in the database). Only remove them from the public re-export in `index.ts`.

- [ ] **Step 5: TypeScript check across all affected packages**

```bash
cd packages/agents-runtime && npx tsc --noEmit
cd packages/agents && npx tsc --noEmit
```

**Commit:**

```
git add packages/agents-runtime/src/types.ts packages/agents-runtime/src/context-factory.ts packages/agents-runtime/src/index.ts
git commit -m "feat(agents-runtime): remove legacy CodingSession types and useCodingAgent implementation"
```

---

### Task 4.3 — UI: extend `StatusDot` + `ToolCallView`

**Files:**

- Modify: `packages/agents-server-ui/src/components/StatusDot.tsx`
- Modify: `packages/agents-server-ui/src/components/ToolCallView.tsx`

- [ ] **Step 1: Add coding-agent status colors to `StatusDot.tsx`**

```ts
const STATUS_COLORS: Record<string, string> = {
  active: `#3b82f6`,
  running: `#3b82f6`,
  idle: `#22c55e`,
  spawning: `#eab308`,
  stopped: `#cbd5e1`,
  // coding-agent statuses (Slice B)
  cold: `#9ca3af`,
  starting: `#eab308`,
  stopping: `#eab308`,
  error: `#ef4444`,
  destroyed: `#6b7280`,
}
```

Also update `STATUS_COLOR` in `EntityHeader.tsx` to match:

```ts
const STATUS_COLOR: Record<
  string,
  `blue` | `green` | `amber` | `gray` | `red`
> = {
  active: `blue`,
  running: `blue`,
  idle: `green`,
  spawning: `amber`,
  stopped: `gray`,
  cold: `gray`,
  starting: `amber`,
  stopping: `amber`,
  error: `red`,
  destroyed: `gray`,
}
```

- [ ] **Step 2: Add `spawn_coding_agent` and `prompt_coding_agent` cases to `ToolCallView.tsx`**

In `getSummary`, after the `prompt_coder` case:

```ts
case `spawn_coding_agent`:
case `prompt_coding_agent`:
  return truncate((args.prompt as string) ?? ``, 60)
```

**Commit:**

```
git add packages/agents-server-ui/src/components/StatusDot.tsx packages/agents-server-ui/src/components/EntityHeader.tsx packages/agents-server-ui/src/components/ToolCallView.tsx
git commit -m "feat(agents-server-ui): extend status colors for coding-agent states and add new tool cases"
```

---

### Task 4.4 — UI: create `CodingAgentView`, `useCodingAgent`, `CodingAgentTimeline`, `CodingAgentSpawnDialog`

**Files:**

- Create: `packages/agents-server-ui/src/hooks/useCodingAgent.ts`
- Create: `packages/agents-server-ui/src/components/CodingAgentView.tsx`
- Create: `packages/agents-server-ui/src/components/CodingAgentTimeline.tsx`
- Create: `packages/agents-server-ui/src/components/CodingAgentSpawnDialog.tsx`

- [ ] **Step 1: Write `useCodingAgent.ts`**

```ts
// packages/agents-server-ui/src/hooks/useCodingAgent.ts
import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from '@tanstack/react-db'
import {
  CODING_AGENT_SESSION_META_COLLECTION_TYPE,
  CODING_AGENT_RUNS_COLLECTION_TYPE,
  CODING_AGENT_EVENTS_COLLECTION_TYPE,
  CODING_AGENT_LIFECYCLE_COLLECTION_TYPE,
} from '@electric-ax/coding-agents'
import { connectEntityStream } from '../lib/entity-connection'
import type { EntityStreamDBWithActions } from '@electric-ax/agents-runtime'

export type CodingAgentSliceAStatus =
  | `cold`
  | `starting`
  | `idle`
  | `running`
  | `stopping`
  | `error`
  | `destroyed`

export interface SessionMetaRow {
  key: string
  status: CodingAgentSliceAStatus
  kind: `claude`
  pinned: boolean
  workspaceIdentity: string
  idleTimeoutMs: number
  keepWarm: boolean
  instanceId?: string
  lastError?: string
  nativeSessionId?: string
}

export interface RunRow {
  key: string
  startedAt: number
  endedAt?: number
  status: `running` | `completed` | `failed`
  finishReason?: string
  promptInboxKey: string
  responseText?: string
}

export interface EventRow {
  key: string
  runId: string
  seq: number
  ts: number
  type: string
  payload: Record<string, unknown>
}

export interface LifecycleRow {
  key: string
  ts: number
  event: string
  detail?: string
}

const CODING_AGENT_STATE = {
  sessionMeta: {
    type: CODING_AGENT_SESSION_META_COLLECTION_TYPE,
    primaryKey: `key`,
  },
  runs: {
    type: CODING_AGENT_RUNS_COLLECTION_TYPE,
    primaryKey: `key`,
  },
  events: {
    type: CODING_AGENT_EVENTS_COLLECTION_TYPE,
    primaryKey: `key`,
  },
  lifecycle: {
    type: CODING_AGENT_LIFECYCLE_COLLECTION_TYPE,
    primaryKey: `key`,
  },
} as const

export interface UseCodingAgentResult {
  db: EntityStreamDBWithActions | null
  meta: SessionMetaRow | undefined
  runs: Array<RunRow>
  events: Array<EventRow>
  lifecycle: Array<LifecycleRow>
  loading: boolean
  error: string | null
}

export function useCodingAgent(
  baseUrl: string | null,
  entityUrl: string | null
): UseCodingAgentResult {
  const [db, setDb] = useState<EntityStreamDBWithActions | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const closeRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    setDb(null)
    setError(null)

    if (!baseUrl || !entityUrl) {
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)

    connectEntityStream({
      baseUrl,
      entityUrl,
      customState: CODING_AGENT_STATE,
    })
      .then((result) => {
        if (cancelled) {
          result.close()
          return
        }
        closeRef.current = result.close
        setDb(result.db)
        setLoading(false)
      })
      .catch((err) => {
        if (!cancelled) {
          console.error(`Failed to connect coding-agent stream`, {
            baseUrl,
            entityUrl,
            error: err,
          })
          setError(err instanceof Error ? err.message : String(err))
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
      closeRef.current?.()
      closeRef.current = null
    }
  }, [baseUrl, entityUrl])

  const metaCollection = db?.collections.sessionMeta
  const runsCollection = db?.collections.runs
  const eventsCollection = db?.collections.events
  const lifecycleCollection = db?.collections.lifecycle

  const { data: metaRows = [] } = useLiveQuery(
    (q) => (metaCollection ? q.from({ m: metaCollection }) : undefined),
    [metaCollection]
  )
  const { data: runRows = [] } = useLiveQuery(
    (q) =>
      runsCollection
        ? q.from({ r: runsCollection }).orderBy(({ r }) => r.$key, `asc`)
        : undefined,
    [runsCollection]
  )
  const { data: eventRows = [] } = useLiveQuery(
    (q) =>
      eventsCollection
        ? q.from({ e: eventsCollection }).orderBy(({ e }) => e.$key, `asc`)
        : undefined,
    [eventsCollection]
  )
  const { data: lifecycleRows = [] } = useLiveQuery(
    (q) =>
      lifecycleCollection
        ? q.from({ l: lifecycleCollection }).orderBy(({ l }) => l.$key, `asc`)
        : undefined,
    [lifecycleCollection]
  )

  const meta = useMemo(
    () => (metaRows as unknown as Array<SessionMetaRow>)[0],
    [metaRows]
  )
  const runs = useMemo(() => runRows as unknown as Array<RunRow>, [runRows])
  const events = useMemo(
    () => eventRows as unknown as Array<EventRow>,
    [eventRows]
  )
  const lifecycle = useMemo(
    () => lifecycleRows as unknown as Array<LifecycleRow>,
    [lifecycleRows]
  )

  return { db, meta, runs, events, lifecycle, loading, error }
}
```

- [ ] **Step 2: Write `CodingAgentTimeline.tsx`**

```tsx
// packages/agents-server-ui/src/components/CodingAgentTimeline.tsx
import { memo, useMemo, useState } from 'react'
import { Badge, Flex, ScrollArea, Text } from '@radix-ui/themes'
import { Streamdown } from 'streamdown'
import { createCodePlugin } from '../lib/codeHighlighter'
import type {
  SessionMetaRow,
  RunRow,
  EventRow,
  LifecycleRow,
} from '../hooks/useCodingAgent'

const codePluginSingleton = createCodePlugin()
const streamdownPlugins = { code: codePluginSingleton }

export function CodingAgentTimeline({
  meta,
  runs,
  events,
  lifecycle,
  loading,
  error,
}: {
  meta: SessionMetaRow | undefined
  runs: Array<RunRow>
  events: Array<EventRow>
  lifecycle: Array<LifecycleRow>
  loading: boolean
  error: string | null
}): React.ReactElement {
  const items = useMemo(
    () => renderItems(events, lifecycle),
    [events, lifecycle]
  )

  return (
    <ScrollArea style={{ flex: 1, width: `100%` }}>
      <Flex
        direction="column"
        gap="3"
        style={{
          maxWidth: `72ch`,
          width: `100%`,
          margin: `0 auto`,
          padding: `16px 40px`,
          boxSizing: `border-box`,
        }}
      >
        {meta && <AgentMetaRow meta={meta} runs={runs} />}
        {error && (
          <Text size="2" color="red">
            {error}
          </Text>
        )}
        {!loading &&
          events.length === 0 &&
          lifecycle.length === 0 &&
          !error && (
            <Text size="1" color="gray" align="center">
              No events yet. Send a prompt to start the agent.
            </Text>
          )}
        {items}
      </Flex>
    </ScrollArea>
  )
}

function AgentMetaRow({
  meta,
  runs,
}: {
  meta: SessionMetaRow
  runs: Array<RunRow>
}): React.ReactElement {
  const completedRuns = runs.filter((r) => r.status === `completed`).length
  const failedRuns = runs.filter((r) => r.status === `failed`).length
  return (
    <Flex gap="2" align="center" wrap="wrap">
      <Badge color="gray" variant="outline">
        {meta.kind}
      </Badge>
      <Badge color="gray" variant="outline">
        {meta.workspaceIdentity}
      </Badge>
      {completedRuns > 0 && (
        <Badge color="green" variant="soft">
          {completedRuns} run{completedRuns !== 1 ? `s` : ``}
        </Badge>
      )}
      {failedRuns > 0 && (
        <Badge color="red" variant="soft">
          {failedRuns} failed
        </Badge>
      )}
      {meta.pinned && (
        <Badge color="blue" variant="soft">
          pinned
        </Badge>
      )}
    </Flex>
  )
}

function renderItems(
  events: Array<EventRow>,
  lifecycle: Array<LifecycleRow>
): Array<React.ReactNode> {
  // Pair tool_call with tool_result by callId.
  const resultsByCallId = new Map<string, EventRow>()
  const callsByCallId = new Map<string, EventRow>()
  for (const e of events) {
    const callId = e.payload.callId as string | undefined
    if (!callId) continue
    if (e.type === `tool_result`) resultsByCallId.set(callId, e)
    else if (e.type === `tool_call`) callsByCallId.set(callId, e)
  }

  const rendered = new Set<string>()
  const items: Array<React.ReactNode> = []

  // Merge events + lifecycle, sorted by timestamp.
  type MergedItem =
    | { kind: `event`; ts: number; key: string; e: EventRow }
    | { kind: `lifecycle`; ts: number; key: string; l: LifecycleRow }

  const merged: MergedItem[] = [
    ...events.map((e) => ({
      kind: `event` as const,
      ts: e.ts,
      key: `e:${e.key}`,
      e,
    })),
    ...lifecycle.map((l) => ({
      kind: `lifecycle` as const,
      ts: l.ts,
      key: `l:${l.key}`,
      l,
    })),
  ].sort((a, b) => a.ts - b.ts)

  for (const item of merged) {
    if (item.kind === `lifecycle`) {
      items.push(<LifecycleEventRow key={item.key} row={item.l} />)
      continue
    }

    const e = item.e
    const key = e.key
    if (rendered.has(key)) continue

    switch (e.type) {
      case `session_init`:
        items.push(<SessionInitRow key={key} event={e} />)
        rendered.add(key)
        break
      case `user_message`:
        items.push(<UserMessageRow key={key} event={e} />)
        rendered.add(key)
        break
      case `assistant_message`:
        items.push(<AssistantMessageRow key={key} event={e} />)
        rendered.add(key)
        break
      case `tool_call`: {
        const callId = e.payload.callId as string | undefined
        const result = callId ? resultsByCallId.get(callId) : undefined
        if (result) rendered.add(result.key)
        items.push(<ToolCallRow key={key} call={e} result={result} />)
        rendered.add(key)
        break
      }
      case `tool_result`: {
        const callId = e.payload.callId as string | undefined
        if (callId && callsByCallId.has(callId)) {
          // Will be rendered with its tool_call.
          rendered.add(key)
          break
        }
        // Orphan result (call is before tail cursor).
        items.push(<OrphanResultRow key={key} event={e} />)
        rendered.add(key)
        break
      }
      case `turn_complete`:
      case `session_end`:
      case `compaction`:
        items.push(<SystemEventRow key={key} event={e} />)
        rendered.add(key)
        break
      default:
        rendered.add(key)
    }
  }

  return items
}

function LifecycleEventRow({ row }: { row: LifecycleRow }): React.ReactElement {
  const label: Record<string, string> = {
    'sandbox.starting': `Sandbox starting`,
    'sandbox.started': `Sandbox started`,
    'sandbox.stopped': `Sandbox stopped`,
    'sandbox.failed': `Sandbox failed`,
    pin: `Pinned`,
    release: `Released`,
    'orphan.detected': `Orphan detected`,
    'resume.restored': `Session resumed`,
  }
  return (
    <Flex gap="2" align="center" style={{ opacity: 0.55 }}>
      <Text size="1" color="gray">
        {new Date(row.ts).toLocaleTimeString()}
      </Text>
      <Text size="1" color="gray">
        {label[row.event] ?? row.event}
        {row.detail ? ` — ${row.detail}` : ``}
      </Text>
    </Flex>
  )
}

function SessionInitRow({ event }: { event: EventRow }): React.ReactElement {
  const sessionId = event.payload.sessionId as string | undefined
  return (
    <Flex gap="2" align="center" style={{ opacity: 0.6 }}>
      <Text size="1" color="gray">
        Session started{sessionId ? ` (${sessionId.slice(0, 8)}…)` : ``}
      </Text>
    </Flex>
  )
}

const AssistantMessageRow = memo(function AssistantMessageRow({
  event,
}: {
  event: EventRow
}): React.ReactElement {
  const text = (event.payload.text as string | undefined) ?? ``
  return (
    <Flex direction="column" gap="1">
      <Text size="1" color="gray" weight="medium">
        Assistant
      </Text>
      <div style={{ fontSize: `var(--font-size-2)` }}>
        <Streamdown content={text} plugins={streamdownPlugins} />
      </div>
    </Flex>
  )
})

function UserMessageRow({ event }: { event: EventRow }): React.ReactElement {
  const text = (event.payload.text as string | undefined) ?? ``
  const pending = !!event.payload._pending
  return (
    <Flex
      direction="column"
      gap="1"
      style={{
        alignSelf: `flex-end`,
        maxWidth: `80%`,
        opacity: pending ? 0.6 : 1,
      }}
    >
      <Text size="1" color="gray" weight="medium" align="right">
        You{pending ? ` (queued)` : ``}
      </Text>
      <div
        style={{
          background: `var(--accent-a3)`,
          padding: `8px 12px`,
          borderRadius: `var(--radius-3)`,
          fontSize: `var(--font-size-2)`,
          whiteSpace: `pre-wrap`,
          wordBreak: `break-word`,
        }}
      >
        {text}
      </div>
    </Flex>
  )
}

function ToolCallRow({
  call,
  result,
}: {
  call: EventRow
  result: EventRow | undefined
}): React.ReactElement {
  const [open, setOpen] = useState(false)
  const toolName = (call.payload.toolName as string | undefined) ?? `tool`
  const args = call.payload.args as Record<string, unknown> | undefined
  return (
    <Flex
      direction="column"
      gap="1"
      style={{
        background: `var(--gray-a2)`,
        border: `1px solid var(--gray-a4)`,
        borderRadius: `var(--radius-2)`,
        padding: 8,
        cursor: `pointer`,
      }}
      onClick={() => setOpen((o) => !o)}
    >
      <Flex align="center" gap="2">
        <Badge color="gray" variant="soft" size="1">
          {toolName}
        </Badge>
        {result && (
          <Badge color="green" variant="soft" size="1">
            done
          </Badge>
        )}
      </Flex>
      {open && (
        <pre
          style={{
            margin: 0,
            fontSize: `var(--font-size-1)`,
            fontFamily: `var(--font-mono)`,
            whiteSpace: `pre-wrap`,
            wordBreak: `break-word`,
            maxHeight: 240,
            overflow: `auto`,
          }}
        >
          {JSON.stringify(args, null, 2)}
        </pre>
      )}
    </Flex>
  )
}

function OrphanResultRow({ event }: { event: EventRow }): React.ReactElement {
  return (
    <Flex gap="2" align="center" style={{ opacity: 0.5 }}>
      <Text size="1" color="gray">
        Tool result (call before window)
      </Text>
    </Flex>
  )
}

function SystemEventRow({ event }: { event: EventRow }): React.ReactElement {
  const label: Record<string, string> = {
    turn_complete: `Turn complete`,
    session_end: `Session ended`,
    compaction: `Context compacted`,
  }
  return (
    <Flex gap="2" align="center" style={{ opacity: 0.5 }}>
      <Text size="1" color="gray">
        {label[event.type] ?? event.type}
      </Text>
    </Flex>
  )
}
```

- [ ] **Step 3: Write `CodingAgentView.tsx`**

```tsx
// packages/agents-server-ui/src/components/CodingAgentView.tsx
import { Flex } from '@radix-ui/themes'
import { useCodingAgent } from '../hooks/useCodingAgent'
import { CodingAgentTimeline } from './CodingAgentTimeline'
import { MessageInput } from './MessageInput'

export function CodingAgentView({
  baseUrl,
  entityUrl,
  entityStopped,
}: {
  baseUrl: string
  entityUrl: string
  entityStopped: boolean
}): React.ReactElement {
  const { db, meta, runs, events, lifecycle, loading, error } = useCodingAgent(
    baseUrl,
    entityUrl
  )

  return (
    <Flex direction="column" flexGrow="1" style={{ minHeight: 0 }}>
      <CodingAgentTimeline
        meta={meta}
        runs={runs}
        events={events}
        lifecycle={lifecycle}
        loading={loading}
        error={error}
      />
      <MessageInput
        db={db}
        baseUrl={baseUrl}
        entityUrl={entityUrl}
        disabled={entityStopped}
      />
    </Flex>
  )
}
```

- [ ] **Step 4: Write `CodingAgentSpawnDialog.tsx`**

```tsx
// packages/agents-server-ui/src/components/CodingAgentSpawnDialog.tsx
import { useCallback, useMemo, useState } from 'react'
import { Button, Dialog, Flex, Text } from '@radix-ui/themes'

type WorkspaceMode = `volume` | `bindMount`

interface CodingAgentSpawnDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSpawn: (args: Record<string, unknown>) => void
}

export function CodingAgentSpawnDialog({
  open,
  onOpenChange,
  onSpawn,
}: CodingAgentSpawnDialogProps): React.ReactElement {
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>(`volume`)
  const [workspaceName, setWorkspaceName] = useState(``)
  const [hostPath, setHostPath] = useState(``)
  const [initialPrompt, setInitialPrompt] = useState(``)

  const canSubmit = useMemo(() => {
    if (workspaceMode === `bindMount`) return hostPath.trim().length > 0
    return true
  }, [workspaceMode, hostPath])

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()
      if (!canSubmit) return
      const args: Record<string, unknown> = {
        kind: `claude`,
        workspaceType: workspaceMode,
      }
      if (workspaceMode === `volume` && workspaceName.trim()) {
        args.workspaceName = workspaceName.trim()
      }
      if (workspaceMode === `bindMount`) {
        args.workspaceHostPath = hostPath.trim()
      }
      if (initialPrompt.trim()) {
        args._initialPrompt = initialPrompt.trim()
      }
      onSpawn(args)
    },
    [canSubmit, workspaceMode, workspaceName, hostPath, initialPrompt, onSpawn]
  )

  const inputStyle: React.CSSProperties = {
    width: `100%`,
    padding: `6px 8px`,
    borderRadius: `var(--radius-2)`,
    border: `1px solid var(--gray-a7)`,
    background: `var(--gray-a2)`,
    fontSize: `var(--font-size-2)`,
    fontFamily: `var(--default-font-family)`,
    color: `var(--gray-12)`,
    boxSizing: `border-box`,
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content maxWidth="480px">
        <Dialog.Title>New coding agent</Dialog.Title>
        <Dialog.Description size="2" color="gray" mb="4">
          Spawn a Claude Code CLI session inside a Docker sandbox with a
          persistent workspace.
        </Dialog.Description>

        <form onSubmit={handleSubmit}>
          <Flex direction="column" gap="3">
            <Flex direction="column" gap="1">
              <Text size="2" weight="medium">
                Workspace type
              </Text>
              <Flex gap="2">
                <Button
                  type="button"
                  variant={workspaceMode === `volume` ? `solid` : `soft`}
                  color="gray"
                  size="2"
                  onClick={() => setWorkspaceMode(`volume`)}
                >
                  Volume
                </Button>
                <Button
                  type="button"
                  variant={workspaceMode === `bindMount` ? `solid` : `soft`}
                  color="gray"
                  size="2"
                  onClick={() => setWorkspaceMode(`bindMount`)}
                >
                  Bind mount
                </Button>
              </Flex>
            </Flex>

            {workspaceMode === `volume` && (
              <Flex direction="column" gap="1">
                <Text size="2" weight="medium">
                  Volume name{` `}
                  <Text size="1" color="gray">
                    (optional — leave blank to auto-generate)
                  </Text>
                </Text>
                <input
                  style={inputStyle}
                  type="text"
                  value={workspaceName}
                  onChange={(e) => setWorkspaceName(e.target.value)}
                  placeholder="my-project"
                />
              </Flex>
            )}

            {workspaceMode === `bindMount` && (
              <Flex direction="column" gap="1">
                <Text size="2" weight="medium">
                  Host path{` `}
                  <Text size="1" color="red">
                    *
                  </Text>
                </Text>
                <input
                  style={inputStyle}
                  type="text"
                  required
                  value={hostPath}
                  onChange={(e) => setHostPath(e.target.value)}
                  placeholder="/Users/me/my-project"
                />
              </Flex>
            )}

            <Flex direction="column" gap="1">
              <Text size="2" weight="medium">
                Initial prompt{` `}
                <Text size="1" color="gray">
                  (optional)
                </Text>
              </Text>
              <textarea
                style={{
                  ...inputStyle,
                  minHeight: 80,
                  resize: `vertical`,
                }}
                value={initialPrompt}
                onChange={(e) => setInitialPrompt(e.target.value)}
                placeholder="What should the agent work on first?"
              />
            </Flex>

            <Flex justify="end" gap="2" mt="2">
              <Dialog.Close>
                <Button type="button" variant="soft" color="gray">
                  Cancel
                </Button>
              </Dialog.Close>
              <Button type="submit" disabled={!canSubmit}>
                Spawn
              </Button>
            </Flex>
          </Flex>
        </form>
      </Dialog.Content>
    </Dialog.Root>
  )
}
```

**Commit:**

```
git add packages/agents-server-ui/src/hooks/useCodingAgent.ts packages/agents-server-ui/src/components/CodingAgentView.tsx packages/agents-server-ui/src/components/CodingAgentTimeline.tsx packages/agents-server-ui/src/components/CodingAgentSpawnDialog.tsx
git commit -m "feat(agents-server-ui): add CodingAgentView, useCodingAgent, CodingAgentTimeline, CodingAgentSpawnDialog"
```

---

## Phase 5 — Wire UI into router and sidebar (sequential)

### Task 5.1 — Update router, sidebar, and EntityHeader

**Files:**

- Modify: `packages/agents-server-ui/src/router.tsx`
- Modify: `packages/agents-server-ui/src/components/Sidebar.tsx`
- Modify: `packages/agents-server-ui/src/components/EntityHeader.tsx`

**Sub-task A: Router**

- [ ] **Step 1: In `router.tsx`, add import for `CodingAgentView`**

```ts
import { CodingAgentView } from './components/CodingAgentView'
```

- [ ] **Step 2: Remove import of `CODING_SESSION_ENTITY_TYPE` from agents-runtime (if only used for the view switch)**

- [ ] **Step 3: Replace the `CodingSessionView` render block with a parallel block for `coding-agent`**

Old:

```tsx
{selectedEntity.type === CODING_SESSION_ENTITY_TYPE && connectUrl ? (
  <CodingSessionView
    baseUrl={baseUrl}
    entityUrl={connectUrl}
    entityStopped={entityStopped}
  />
) : (
  <GenericEntityBody ... />
)}
```

New:

```tsx
{
  selectedEntity.type === `coding-agent` && connectUrl ? (
    <CodingAgentView
      baseUrl={baseUrl}
      entityUrl={connectUrl}
      entityStopped={entityStopped}
    />
  ) : (
    <GenericEntityBody
      baseUrl={baseUrl}
      entityUrl={connectUrl}
      entityStopped={entityStopped}
      isSpawning={isSpawning}
    />
  )
}
```

**Sub-task B: Sidebar**

- [ ] **Step 1: Add import for `CodingAgentSpawnDialog`**

```ts
import { CodingAgentSpawnDialog } from './CodingAgentSpawnDialog'
```

- [ ] **Step 2: Add `codingAgentDialogOpen` state**

```ts
const [codingAgentDialogOpen, setCodingAgentDialogOpen] = useState(false)
```

- [ ] **Step 3: Update `handleNewSession` to open `CodingAgentSpawnDialog` for `coding-agent`**

```ts
const handleNewSession = useCallback(
  (entityType: ElectricEntityType) => {
    if (entityType.name === `coding-agent`) {
      setCodingAgentDialogOpen(true)
      return
    }
    if (entityType.name === CODING_SESSION_ENTITY_TYPE) {
      setCodingDialogOpen(true)
      return
    }
    if (hasSchemaProperties(entityType.creation_schema)) {
      setSpawnDialogType(entityType)
    } else {
      doSpawn(entityType.name)
    }
  },
  [doSpawn]
)
```

- [ ] **Step 4: Add `CodingAgentSpawnDialog` render below the existing `CodingSessionSpawnDialog`**

```tsx
<CodingAgentSpawnDialog
  open={codingAgentDialogOpen}
  onOpenChange={setCodingAgentDialogOpen}
  onSpawn={(args) => {
    doSpawn(`coding-agent`, args)
    setCodingAgentDialogOpen(false)
  }}
/>
```

**Sub-task C: EntityHeader — Pin/Release/Stop buttons**

The header needs to send inbox messages when `entity.type === 'coding-agent'`. The `db` object must be passed in from the router. Since `db` is only available once `useCodingAgent` connects, the header receives it as an optional prop.

- [ ] **Step 1: Update `EntityHeader` props to accept optional `db` and `entityType`**

```ts
export function EntityHeader({
  entity,
  pinned,
  onTogglePin,
  onFork,
  onKill,
  killError,
  forkError,
  forking,
  stateExplorerOpen,
  onToggleStateExplorer,
  db,                           // ← new optional
}: {
  entity: ElectricEntity
  pinned: boolean
  onTogglePin: () => void
  onFork?: () => void
  onKill: () => void
  killError?: string | null
  forkError?: string | null
  forking?: boolean
  stateExplorerOpen?: boolean
  onToggleStateExplorer?: () => void
  db?: EntityStreamDBWithActions | null   // ← new optional
}): React.ReactElement {
```

Add import for `EntityStreamDBWithActions`:

```ts
import type { EntityStreamDBWithActions } from '@electric-ax/agents-runtime'
```

- [ ] **Step 2: Add Pin/Release/Stop buttons to the header for `coding-agent`**

Inside the `<Flex ml="auto" ...>` block, after the `onFork` button and before the state explorer toggle:

```tsx
{
  entity.type === `coding-agent` && db && (
    <>
      <Button
        variant="soft"
        size="1"
        onClick={() => {
          const key = `pin:${Date.now()}`
          db.actions.inbox_insert?.({
            row: { key, message_type: `pin`, payload: {} },
          })
        }}
        title="Pin — keep sandbox alive past idle timeout"
      >
        Pin
      </Button>
      <Button
        variant="soft"
        size="1"
        onClick={() => {
          const key = `release:${Date.now()}`
          db.actions.inbox_insert?.({
            row: { key, message_type: `release`, payload: {} },
          })
        }}
        title="Release — allow idle hibernation"
      >
        Release
      </Button>
      <Button
        variant="soft"
        size="1"
        color="orange"
        onClick={() => {
          const key = `stop:${Date.now()}`
          db.actions.inbox_insert?.({
            row: { key, message_type: `stop`, payload: {} },
          })
        }}
        title="Stop — hibernate the sandbox now"
      >
        Stop
      </Button>
    </>
  )
}
```

- [ ] **Step 3: Pass `db` from router into `EntityHeader`**

In `router.tsx`, where `EntityHeader` is rendered, the `db` from `useCodingAgent` is available when `selectedEntity.type === 'coding-agent'`. Thread it through:

```tsx
// Near the top of the component that renders EntityHeader:
const codingAgentHook = useCodingAgent(
  selectedEntity?.type === `coding-agent` ? baseUrl : null,
  selectedEntity?.type === `coding-agent` ? connectUrl : null
)

// Then in the EntityHeader render:
<EntityHeader
  ...
  db={selectedEntity?.type === `coding-agent` ? codingAgentHook.db : undefined}
/>
```

- [ ] **Step 4: TypeScript check**

```bash
cd packages/agents-server-ui && npx tsc --noEmit
```

**Commit:**

```
git add packages/agents-server-ui/src/router.tsx packages/agents-server-ui/src/components/Sidebar.tsx packages/agents-server-ui/src/components/EntityHeader.tsx
git commit -m "feat(agents-server-ui): wire CodingAgentView, CodingAgentSpawnDialog, and Pin/Release/Stop buttons into router and sidebar"
```

---

## Phase 6 — Full build verification (sequential)

### Task 6.1 — Cross-package build and unit test pass

- [ ] **Step 1: Build all packages from repo root**

```bash
pnpm -r build 2>&1 | tail -40
```

- [ ] **Step 2: Run all coding-agents unit tests**

```bash
cd packages/coding-agents && npx vitest run test/unit/
```

- [ ] **Step 3: Run all agents unit tests**

```bash
cd packages/agents && npx vitest run 2>/dev/null || echo "no unit tests"
```

- [ ] **Step 4: TypeScript across all changed packages**

```bash
cd packages/coding-agents && npx tsc --noEmit
cd packages/agents && npx tsc --noEmit
cd packages/agents-runtime && npx tsc --noEmit
cd packages/agents-server-ui && npx tsc --noEmit
```

Fix any errors discovered. Commit fixes with descriptive messages.

---

## Phase 7 — Integration test (optional, Docker-gated)

### Task 7.1 — Run the Slice B integration test

- [ ] **Step 1: Ensure Docker image is built**

```bash
cd packages/coding-agents && node scripts/build-image.mjs
```

- [ ] **Step 2: Run Slice B integration test**

```bash
cd packages/coding-agents && DOCKER=1 npx vitest run test/integration/slice-b.test.ts --timeout 400000
```

Expected result: the test passes, proving `BANANA` is retrieved on the second turn.

- [ ] **Step 3: Run Slice A integration test to ensure no regressions**

```bash
cd packages/coding-agents && DOCKER=1 npx vitest run test/integration/slice-a.test.ts --timeout 400000
```

**Commit:** (fix any integration failures discovered)

---

## Phase 8 — Report

### Task 8.1 — Write Slice B run report

- [ ] **Step 1: Create `docs/superpowers/specs/notes/2026-04-30-coding-agents-slice-b-report.md`**

Write a brief run report covering:

- Status: `DONE` / `DONE_WITH_CONCERNS` / `BLOCKED`
- Phases completed and any deviations
- Unit test results (pass/fail counts)
- Integration test result (BANANA test pass/skip)
- Any spec deviations not already documented at top of plan
- Commit SHAs for each phase

**Commit:**

```
git add docs/superpowers/specs/notes/2026-04-30-coding-agents-slice-b-report.md
git commit -m "docs(coding-agents): Slice B run report"
```

---

## Key implementation notes for the executing agent

1. **`onNativeLine` is already wired** in `bridge/stdio-bridge.ts` line 55. Task 1.1 only writes a unit test — do not re-implement.

2. **`--resume` flag is NOT yet wired.** Task 1.2 must remove the warning block (lines 13-18 of `stdio-bridge.ts`) and add `if (args.nativeSessionId) cliArgs.push('--resume', args.nativeSessionId)` after the `cliArgs` array definition.

3. **`processPrompt` in `handler.ts` must read `nativeJsonl` from `ctx.db.collections.nativeJsonl`**, not from a parameter. The collection name in the FakeCtx must be `nativeJsonl` to match `ctx.db.collections.nativeJsonl`.

4. **`materialiseResume` uses base64** to avoid shell-quoting issues with JSONL content (which contains `"`, `{`, `}` characters). The `printf '%s' '<b64>' | base64 -d >` pattern works in both `busybox` sh and `bash`.

5. **The claude project directory under `~/.claude/projects/`** is derived by replacing every `/` in the cwd with `-`. For cwd `/workspace`, the directory name is `-workspace`. Confirm this against the actual `claude` CLI behaviour in the test image if the resume test fails — the sanitisation rule may differ.

6. **Legacy `coding-session.ts` deletion:** Before deleting, grep for any other imports of this file beyond `bootstrap.ts`:

   ```bash
   grep -r "coding-session" packages/ --include="*.ts" --include="*.tsx" -l
   ```

   Fix any additional import sites before deleting.

7. **`useCodingAgent` in `context-factory.ts`** must be removed carefully. The function references `CODING_SESSION_ENTITY_TYPE` and `codingSessionEntityUrl` from `observation-sources.ts`. After removal, check whether those symbols are used elsewhere in `context-factory.ts`. If not, remove their imports too.

8. **`EntityHeader` Pin/Release/Stop buttons** call `db.actions.inbox_insert`. Verify the action name matches what the runtime exposes for the inbox collection (it may be `inbox_insert` or another name — check `agents-runtime/src/context-factory.ts` for the inbox action naming convention).

9. **Router `useCodingAgent` call:** The hook must be called unconditionally (React rules of hooks). Use `null` args when not a coding-agent entity — the hook skips `connectEntityStream` when `baseUrl` or `entityUrl` is null, so there is no real connection overhead.

10. **Slice A tests must still pass** after all changes. Run `npx vitest run test/unit/` in `packages/coding-agents` at the end of Phase 6 to confirm.
