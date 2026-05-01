# Coding-agents Slice C₂ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add codex parity to `@electric-ax/coding-agents` and refactor the test harness so adding agent N+1 is a localised diff (one adapter file, three transcript fixtures, one env-loader entry). Spec: `docs/superpowers/specs/2026-05-01-coding-agents-slice-c2-design.md`.

**Architecture:** A single registry of `CodingAgentAdapter`s (`src/agents/registry.ts` + `claude.ts` + `codex.ts`) holds every kind-specific concern: CLI binary, argv shape, prompt-delivery channel, env vars, transcript probe / materialise / capture commands. The bridge, handler, and import CLI dispatch through the registry; tests parameterize via `describe.each(listAdapters())`. Existing claude integration tests stay green throughout. No cross-kind resume in this slice; no provider conformance suite (deferred).

**Tech Stack:** TypeScript, Node.js child_process spawn, vitest, Docker CLI, `agent-session-protocol@0.0.2` (already supports both kinds via `normalize` / `denormalize` / `findSessionPath`).

---

## Spec deviation

The design doc's adapter has `resumeTranscriptPath` doing double duty as both probe target and materialise target. Codex's path embeds a wall-clock timestamp so a single deterministic path cannot serve as the probe. This plan splits the responsibility into three explicit methods on the adapter — `probeCommand`, `materialiseTargetPath`, `captureCommand` — to keep each adapter self-describing and the handler dispatch flat. Same outcomes; cleaner interface.

---

## File Structure

**New files:**

- `packages/coding-agents/src/agents/registry.ts` — `CodingAgentAdapter` interface + module-level registry (`registerAdapter`, `getAdapter`, `listAdapters`).
- `packages/coding-agents/src/agents/claude.ts` — `ClaudeAdapter` implementation. Extracts argv currently in `stdio-bridge.ts` and path math currently in `handler.ts`.
- `packages/coding-agents/src/agents/codex.ts` — `CodexAdapter` implementation. `codex exec --skip-git-repo-check --json [resume <id>] <prompt>`; `~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<sessionId>.jsonl` path math.
- `packages/coding-agents/src/cli/import.ts` — generalized CLI accepting `--agent claude|codex`. Replaces the old `import-claude.ts`.
- `packages/coding-agents/test/unit/agents-registry.test.ts` — adapter-contract sanity test.
- `packages/coding-agents/test/fixtures/README.md` — instructions for recording new fixtures.
- `packages/coding-agents/test/fixtures/claude/first-turn.jsonl`
- `packages/coding-agents/test/fixtures/claude/resume-turn.jsonl`
- `packages/coding-agents/test/fixtures/claude/error.jsonl`
- `packages/coding-agents/test/fixtures/codex/first-turn.jsonl`
- `packages/coding-agents/test/fixtures/codex/resume-turn.jsonl`
- `packages/coding-agents/test/fixtures/codex/error.jsonl`

**Modified files:**

- `packages/coding-agents/src/types.ts` — `CodingAgentKind` re-exports `AgentType` from `agent-session-protocol`. `SpawnCodingAgentOptions.kind` widens to `CodingAgentKind`.
- `packages/coding-agents/src/index.ts` — eagerly import the two adapter modules so the registry is populated for all consumers.
- `packages/coding-agents/src/bridge/stdio-bridge.ts` — replace hardcoded argv + claude-only guard with `getAdapter(args.kind)` calls.
- `packages/coding-agents/src/entity/handler.ts` — replace inline path math in `ensureTranscriptMaterialised` and `captureTranscript` with adapter calls. Update `CodingAgentHandlerOptions.env` signature.
- `packages/coding-agents/src/entity/collections.ts` — widen `kind` enum to `['claude', 'codex']` in `sessionMetaRowSchema`.
- `packages/coding-agents/src/entity/register.ts` — widen `creationArgsSchema.kind`; change `RegisterCodingAgentDeps.env` signature.
- `packages/coding-agents/docker/Dockerfile` — add `@openai/codex` install.
- `packages/coding-agents/package.json` — bin map: drop `electric-ax-import-claude`, add `electric-ax-import`.
- `packages/coding-agents/test/support/env.ts` — load `OPENAI_API_KEY` / `OPENAI_MODEL`; export `requireKeyForKind` helper.
- `packages/coding-agents/test/unit/stdio-bridge.test.ts` — `describe.each` parameterization.
- `packages/coding-agents/test/unit/stdio-bridge-resume.test.ts` — `describe.each` parameterization.
- `packages/coding-agents/test/unit/cli-import.test.ts` — `describe.each` parameterization.
- `packages/coding-agents/test/unit/entity-handler.test.ts` — add codex-import validation case.
- `packages/coding-agents/test/integration/slice-a.test.ts` — extract body to `runSliceALifecycle(adapter)`; `describe.each`.
- `packages/coding-agents/test/integration/host-provider.test.ts` — `describe.each`.
- `packages/coding-agents/test/integration/smoke.test.ts` — `describe.each`.

**Deleted files:**

- `packages/coding-agents/src/cli/import-claude.ts` — content moved to `import.ts`.

---

## Task 1: Adapter registry interface and `ClaudeAdapter`

**Files:**

- Create: `packages/coding-agents/src/agents/registry.ts`
- Create: `packages/coding-agents/src/agents/claude.ts`
- Create: `packages/coding-agents/test/unit/agents-registry.test.ts`
- Modify: `packages/coding-agents/src/types.ts`
- Modify: `packages/coding-agents/src/index.ts`

- [ ] **Step 1: Widen `CodingAgentKind` in `types.ts` to re-export `AgentType` from agent-session-protocol**

Replace lines 1-4 of `packages/coding-agents/src/types.ts`:

```ts
import type { AgentType, NormalizedEvent } from 'agent-session-protocol'
import type { CodingAgentStatus } from './entity/collections'

export type CodingAgentKind = AgentType
```

(Removes the literal `\`claude\` | \`codex\``definition and pulls from the protocol package instead — the value set is identical, but downstream`normalize(\_, kind)` calls type-check correctly.)

- [ ] **Step 2: Widen `SpawnCodingAgentOptions.kind`**

In `packages/coding-agents/src/types.ts`, find:

```ts
export interface SpawnCodingAgentOptions {
  /** Stable id, scoped to the spawning entity. */
  id: string
  /** Slice A: 'claude' only. */
  kind: `claude`
```

Replace with:

```ts
export interface SpawnCodingAgentOptions {
  /** Stable id, scoped to the spawning entity. */
  id: string
  kind: CodingAgentKind
```

- [ ] **Step 3: Create the registry module**

Create `packages/coding-agents/src/agents/registry.ts`:

```ts
import type { CodingAgentKind } from '../types'

/**
 * Per-kind adapter. Holds every CLI-specific concern so the bridge,
 * handler, and import CLI stay kind-agnostic.
 */
export interface CodingAgentAdapter {
  readonly kind: CodingAgentKind
  /** CLI binary on $PATH inside the sandbox/host. */
  readonly cliBinary: string
  /** Env vars sourced from process.env when the handler builds spec.env. */
  readonly defaultEnvVars: ReadonlyArray<string>

  /** Build the argv tail and decide where the prompt is delivered. */
  buildCliInvocation(opts: {
    prompt: string
    nativeSessionId?: string
    model?: string
  }): { args: ReadonlyArray<string>; promptDelivery: `stdin` | `argv` }

  /** Argv whose exit code reports whether the resume transcript exists. */
  probeCommand(opts: {
    homeDir: string
    cwd: string
    sessionId: string
  }): ReadonlyArray<string>

  /** Where to write `nativeJsonl.content` so `--resume <id>` will find it. */
  materialiseTargetPath(opts: {
    homeDir: string
    cwd: string
    sessionId: string
    /** Captured transcript bytes; codex needs this to reconstruct YYYY/MM/DD. */
    content?: string
  }): string

  /** Argv that prints the transcript base64-encoded with no line breaks. */
  captureCommand(opts: {
    homeDir: string
    cwd: string
    sessionId: string
  }): ReadonlyArray<string>
}

const adapters = new Map<CodingAgentKind, CodingAgentAdapter>()

export function registerAdapter(a: CodingAgentAdapter): void {
  adapters.set(a.kind, a)
}

export function getAdapter(kind: CodingAgentKind): CodingAgentAdapter {
  const a = adapters.get(kind)
  if (!a) throw new Error(`unknown coding-agent kind: ${kind}`)
  return a
}

export function listAdapters(): ReadonlyArray<CodingAgentAdapter> {
  return Array.from(adapters.values())
}
```

- [ ] **Step 4: Create the claude adapter**

Create `packages/coding-agents/src/agents/claude.ts`:

```ts
import type { CodingAgentAdapter } from './registry'
import { registerAdapter } from './registry'

function sanitiseCwd(cwd: string): string {
  return cwd.replace(/\//g, `-`)
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

export const ClaudeAdapter: CodingAgentAdapter = {
  kind: `claude`,
  cliBinary: `claude`,
  defaultEnvVars: [`ANTHROPIC_API_KEY`],

  buildCliInvocation({ prompt: _prompt, nativeSessionId, model }) {
    const args: Array<string> = [
      `--print`,
      `--output-format=stream-json`,
      `--verbose`,
      `--dangerously-skip-permissions`,
    ]
    if (model) args.push(`--model`, model)
    if (nativeSessionId) args.push(`--resume`, nativeSessionId)
    return { args, promptDelivery: `stdin` }
  },

  probeCommand({ homeDir, cwd, sessionId }) {
    const path = `${homeDir}/.claude/projects/${sanitiseCwd(cwd)}/${sessionId}.jsonl`
    return [`test`, `-f`, path]
  },

  materialiseTargetPath({ homeDir, cwd, sessionId }) {
    return `${homeDir}/.claude/projects/${sanitiseCwd(cwd)}/${sessionId}.jsonl`
  },

  captureCommand({ homeDir, cwd, sessionId }) {
    const path = `${homeDir}/.claude/projects/${sanitiseCwd(cwd)}/${sessionId}.jsonl`
    return [
      `sh`,
      `-c`,
      `if [ -f ${shellQuote(path)} ]; then base64 -w 0 ${shellQuote(path)}; fi`,
    ]
  },
}

registerAdapter(ClaudeAdapter)
```

- [ ] **Step 5: Wire the adapter module into the package entrypoint**

Modify `packages/coding-agents/src/index.ts`. After the existing exports, append:

```ts
// Register built-in adapters by importing for side effects.
import './agents/claude'

export { getAdapter, listAdapters, registerAdapter } from './agents/registry'
export type { CodingAgentAdapter } from './agents/registry'
```

- [ ] **Step 6: Write the registry contract test**

Create `packages/coding-agents/test/unit/agents-registry.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { listAdapters, getAdapter } from '../../src'

describe(`agents registry`, () => {
  it(`registers at least one adapter on import`, () => {
    expect(listAdapters().length).toBeGreaterThan(0)
  })

  it.each(listAdapters().map((a) => [a.kind, a] as const))(
    `%s adapter satisfies the contract`,
    (_kind, adapter) => {
      expect(adapter.cliBinary.length).toBeGreaterThan(0)
      expect(adapter.defaultEnvVars.length).toBeGreaterThan(0)

      const inv = adapter.buildCliInvocation({ prompt: `hi` })
      expect(Array.isArray(inv.args)).toBe(true)
      expect([`stdin`, `argv`]).toContain(inv.promptDelivery)

      const probe = adapter.probeCommand({
        homeDir: `/home/agent`,
        cwd: `/workspace`,
        sessionId: `abc`,
      })
      expect(Array.isArray(probe)).toBe(true)
      expect(probe.length).toBeGreaterThan(0)

      const target = adapter.materialiseTargetPath({
        homeDir: `/home/agent`,
        cwd: `/workspace`,
        sessionId: `abc`,
      })
      expect(typeof target).toBe(`string`)
      expect(target.length).toBeGreaterThan(0)

      const capture = adapter.captureCommand({
        homeDir: `/home/agent`,
        cwd: `/workspace`,
        sessionId: `abc`,
      })
      expect(Array.isArray(capture)).toBe(true)
      expect(capture.length).toBeGreaterThan(0)
    }
  )

  it(`getAdapter('claude') returns the claude adapter`, () => {
    expect(getAdapter(`claude`).kind).toBe(`claude`)
  })

  it(`getAdapter throws on unknown kinds`, () => {
    // @ts-expect-error intentional: testing runtime behaviour
    expect(() => getAdapter(`nope`)).toThrow(/unknown coding-agent kind/)
  })
})
```

- [ ] **Step 7: Run unit tests; expect green**

```bash
pnpm -C packages/coding-agents test test/unit/agents-registry.test.ts
```

Expected: PASS. The `it.each` block runs once for `claude`.

- [ ] **Step 8: Commit**

```bash
git add packages/coding-agents/src/agents \
        packages/coding-agents/src/types.ts \
        packages/coding-agents/src/index.ts \
        packages/coding-agents/test/unit/agents-registry.test.ts
git commit -m "feat(coding-agents): adapter registry interface + ClaudeAdapter"
```

---

## Task 2: `CodexAdapter`

**Files:**

- Create: `packages/coding-agents/src/agents/codex.ts`
- Modify: `packages/coding-agents/src/index.ts`

- [ ] **Step 1: Verify codex CLI argv shape**

```bash
docker run --rm node:22-bookworm-slim sh -c 'npm install -g @openai/codex && codex --help && codex exec --help'
```

Confirm flags exist:

- `codex exec` accepts `--skip-git-repo-check`, `--json` (or equivalent stream-json flag).
- A `resume` subcommand or `--resume` flag accepts a sessionId followed by a prompt.

If the actual flags differ from this plan's assumptions, **stop** and update both the spec (`docs/superpowers/specs/2026-05-01-coding-agents-slice-c2-design.md` §1) and Step 2 of this task before proceeding. Pin the version that matches the recorded shape (e.g. `@openai/codex@0.x.y`).

- [ ] **Step 2: Create the codex adapter**

Create `packages/coding-agents/src/agents/codex.ts`:

```ts
import type { CodingAgentAdapter } from './registry'
import { registerAdapter } from './registry'

/**
 * Codex stores transcripts at:
 *   ~/.codex/sessions/YYYY/MM/DD/rollout-<ISOts>-<sessionId>.jsonl
 * The date subdir embeds wall-clock time at session creation. We can't
 * reconstruct the original date from sessionId alone, so:
 *   - probe = scan with `find` (sessionId is a UUID, no collisions)
 *   - capture = same scan, then base64
 *   - materialise = best-effort: parse the captured blob's first JSONL
 *     line for a timestamp; fall back to today's date. Codex's resume
 *     looks up by sessionId via a scan, so the date subdir only has
 *     to exist on disk — it doesn't have to match the original.
 */

interface RolloutMeta {
  yyyy: string
  mm: string
  dd: string
  ts: string
}

function todayMeta(): RolloutMeta {
  const now = new Date()
  const yyyy = String(now.getFullYear())
  const mm = String(now.getMonth() + 1).padStart(2, `0`)
  const dd = String(now.getDate()).padStart(2, `0`)
  const ts = now.toISOString().replace(/[:.]/g, `-`).slice(0, 19)
  return { yyyy, mm, dd, ts }
}

/**
 * Try to extract a timestamp from the captured transcript's first line.
 * Codex's first line is a session-init record carrying the rollout
 * timestamp; parse failures fall back to today.
 */
function metaFromContent(content?: string): RolloutMeta {
  if (!content) return todayMeta()
  const firstNl = content.indexOf(`\n`)
  const firstLine = firstNl >= 0 ? content.slice(0, firstNl) : content
  try {
    const parsed = JSON.parse(firstLine) as Record<string, unknown>
    const candidate =
      (typeof parsed.timestamp === `string` && parsed.timestamp) ||
      (typeof parsed.ts === `string` && parsed.ts) ||
      (typeof parsed.created_at === `string` && parsed.created_at) ||
      null
    if (!candidate) return todayMeta()
    const d = new Date(candidate)
    if (Number.isNaN(d.getTime())) return todayMeta()
    return {
      yyyy: String(d.getFullYear()),
      mm: String(d.getMonth() + 1).padStart(2, `0`),
      dd: String(d.getDate()).padStart(2, `0`),
      ts: d.toISOString().replace(/[:.]/g, `-`).slice(0, 19),
    }
  } catch {
    return todayMeta()
  }
}

export const CodexAdapter: CodingAgentAdapter = {
  kind: `codex`,
  cliBinary: `codex`,
  defaultEnvVars: [`OPENAI_API_KEY`],

  buildCliInvocation({ prompt, nativeSessionId, model: _model }) {
    const args: Array<string> = [`exec`, `--skip-git-repo-check`, `--json`]
    if (nativeSessionId) args.push(`resume`, nativeSessionId)
    args.push(prompt)
    return { args, promptDelivery: `argv` }
  },

  probeCommand({ homeDir, sessionId }) {
    return [
      `sh`,
      `-c`,
      `[ -n "$(find ${homeDir}/.codex/sessions -name "*-${sessionId}.jsonl" 2>/dev/null | head -1)" ]`,
    ]
  },

  materialiseTargetPath({ homeDir, sessionId, content }) {
    const m = metaFromContent(content)
    return `${homeDir}/.codex/sessions/${m.yyyy}/${m.mm}/${m.dd}/rollout-${m.ts}-${sessionId}.jsonl`
  },

  captureCommand({ homeDir, sessionId }) {
    return [
      `sh`,
      `-c`,
      `f="$(find ${homeDir}/.codex/sessions -name "*-${sessionId}.jsonl" 2>/dev/null | head -1)"; if [ -n "$f" ]; then base64 -w 0 "$f"; fi`,
    ]
  },
}

registerAdapter(CodexAdapter)
```

- [ ] **Step 3: Wire the adapter into the package entrypoint**

Modify `packages/coding-agents/src/index.ts`. Add the codex import next to the claude one:

```ts
import './agents/claude'
import './agents/codex'
```

- [ ] **Step 4: Run the registry contract test; expect both adapters now exercised**

```bash
pnpm -C packages/coding-agents test test/unit/agents-registry.test.ts
```

Expected: PASS. The `it.each` block runs twice (once per kind).

- [ ] **Step 5: Commit**

```bash
git add packages/coding-agents/src/agents/codex.ts \
        packages/coding-agents/src/index.ts
git commit -m "feat(coding-agents): CodexAdapter — codex exec --json + ~/.codex transcript path math"
```

---

## Task 3: `StdioBridge` consumes the adapter

**Files:**

- Modify: `packages/coding-agents/src/bridge/stdio-bridge.ts`
- Modify: `packages/coding-agents/test/unit/stdio-bridge.test.ts`
- Modify: `packages/coding-agents/test/unit/stdio-bridge-resume.test.ts`

- [ ] **Step 1: Replace bridge body with adapter-driven invocation**

Rewrite `packages/coding-agents/src/bridge/stdio-bridge.ts` in full:

```ts
import { normalize } from 'agent-session-protocol'
import type { NormalizedEvent } from 'agent-session-protocol'
import { getAdapter } from '../agents/registry'
import { log } from '../log'
import type { Bridge, RunTurnArgs, RunTurnResult } from '../types'

export class StdioBridge implements Bridge {
  async runTurn(args: RunTurnArgs): Promise<RunTurnResult> {
    const adapter = getAdapter(args.kind)
    const { args: cliArgs, promptDelivery } = adapter.buildCliInvocation({
      prompt: args.prompt,
      nativeSessionId: args.nativeSessionId,
      model: args.model,
    })

    const handle = await args.sandbox.exec({
      cmd: [adapter.cliBinary, ...cliArgs],
      cwd: args.sandbox.workspaceMount,
      stdin: promptDelivery === `stdin` ? `pipe` : `ignore`,
    })

    if (promptDelivery === `stdin`) {
      if (!handle.writeStdin || !handle.closeStdin) {
        throw new Error(
          `StdioBridge requires stdin pipe but ExecHandle lacks one`
        )
      }
      await handle.writeStdin(args.prompt)
      await handle.closeStdin()
    }

    const rawLines: Array<string> = []
    const stderrLines: Array<string> = []

    const drainStderr = async () => {
      for await (const line of handle.stderr) stderrLines.push(line)
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
        `${adapter.cliBinary} CLI exited ${exitInfo.exitCode}. stderr=${stderrPreview}`
      )
    }

    let events: Array<NormalizedEvent> = []
    try {
      events = normalize(rawLines, args.kind)
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
          ? (sessionInit as { sessionId?: string }).sessionId || undefined
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

(Diff vs. before: removes the `if (args.kind !== 'claude')` guard, replaces hardcoded argv with `adapter.buildCliInvocation(...)`, makes the stderr error message use `adapter.cliBinary` so codex failures say "codex CLI exited" not "claude CLI exited".)

- [ ] **Step 2: Update the existing claude-only bridge unit test**

The test "rejects non-claude kinds" no longer applies (the bridge defers to the registry; unknown kinds throw via `getAdapter`).

In `packages/coding-agents/test/unit/stdio-bridge.test.ts`, delete the test:

```ts
it(`rejects non-claude kinds`, async () => { ... })
```

Replace the whole `describe('StdioBridge', () => { ... })` block with:

```ts
import { describe, expect, it } from 'vitest'
import { StdioBridge } from '../../src/bridge/stdio-bridge'
import { listAdapters } from '../../src'
import type { ExecHandle, ExecRequest, SandboxInstance } from '../../src/types'

function fakeSandbox(opts: {
  stdoutLines: Array<string>
  stderrLines?: Array<string>
  exitCode?: number
  onCmd?: (cmd: ReadonlyArray<string>) => void
  onStdin?: (chunk: string) => void
}): SandboxInstance {
  return {
    instanceId: `fake`,
    agentId: `/x/coding-agent/y`,
    workspaceMount: `/workspace`,
    async exec(req: ExecRequest): Promise<ExecHandle> {
      opts.onCmd?.(req.cmd)
      const stdoutLines = opts.stdoutLines.slice()
      const stderrLines = (opts.stderrLines ?? []).slice()
      return {
        stdout: (async function* () {
          for (const l of stdoutLines) yield l
        })(),
        stderr: (async function* () {
          for (const l of stderrLines) yield l
        })(),
        writeStdin: async (chunk) => {
          opts.onStdin?.(chunk)
        },
        closeStdin: async () => undefined,
        wait: async () => ({ exitCode: opts.exitCode ?? 0 }),
        kill: () => undefined,
      }
    },
    async copyTo() {
      /* not used */
    },
  }
}

describe.each(listAdapters().map((a) => [a.kind, a] as const))(
  `StdioBridge — %s`,
  (kind, adapter) => {
    it(`runs the right CLI binary and argv`, async () => {
      let cmd: ReadonlyArray<string> = []
      const b = new StdioBridge()
      const initLine =
        kind === `claude`
          ? `{"type":"system","subtype":"init","session_id":"abc"}`
          : `{"type":"session_meta","timestamp":"2026-05-01T12:00:00Z","session_id":"abc"}`
      await b.runTurn({
        sandbox: fakeSandbox({
          stdoutLines: [initLine],
          onCmd: (c) => (cmd = c),
        }),
        kind,
        prompt: `hello world`,
        onEvent: () => undefined,
      })
      expect(cmd[0]).toBe(adapter.cliBinary)
    })

    it(`throws with stderr when CLI exits non-zero`, async () => {
      const b = new StdioBridge()
      await expect(
        b.runTurn({
          sandbox: fakeSandbox({
            stdoutLines: [],
            stderrLines: [`fatal: bad thing`],
            exitCode: 1,
          }),
          kind,
          prompt: `x`,
          onEvent: () => undefined,
        })
      ).rejects.toThrow(/CLI exited 1.*fatal: bad thing/)
    })
  }
)

describe(`StdioBridge — claude-specific argv`, () => {
  it(`passes the prompt through stdin and adds claude flags`, async () => {
    let cmd: ReadonlyArray<string> = []
    let stdin = ``
    const b = new StdioBridge()
    await b.runTurn({
      sandbox: fakeSandbox({
        stdoutLines: [`{"type":"system","subtype":"init","session_id":"abc"}`],
        onCmd: (c) => (cmd = c),
        onStdin: (s) => (stdin = s),
      }),
      kind: `claude`,
      prompt: `hello world`,
      model: `claude-haiku-4-5-20251001`,
      onEvent: () => undefined,
    })
    expect(cmd).toContain(`--print`)
    expect(cmd).toContain(`--output-format=stream-json`)
    expect(cmd).toContain(`--verbose`)
    expect(cmd).toContain(`--dangerously-skip-permissions`)
    expect(cmd).toContain(`--model`)
    expect(cmd).toContain(`claude-haiku-4-5-20251001`)
    expect(stdin).toBe(`hello world`)
  })
})

describe(`StdioBridge — codex-specific argv`, () => {
  it(`puts the prompt on argv and passes codex exec flags`, async () => {
    let cmd: ReadonlyArray<string> = []
    let stdin = ``
    const b = new StdioBridge()
    await b.runTurn({
      sandbox: fakeSandbox({
        stdoutLines: [
          `{"type":"session_meta","timestamp":"2026-05-01T12:00:00Z","session_id":"abc"}`,
        ],
        onCmd: (c) => (cmd = c),
        onStdin: (s) => (stdin = s),
      }),
      kind: `codex`,
      prompt: `hello codex`,
      onEvent: () => undefined,
    })
    expect(cmd[0]).toBe(`codex`)
    expect(cmd).toContain(`exec`)
    expect(cmd).toContain(`--skip-git-repo-check`)
    expect(cmd).toContain(`--json`)
    expect(cmd[cmd.length - 1]).toBe(`hello codex`)
    expect(stdin).toBe(``) // codex doesn't take prompt on stdin
  })

  it(`passes 'resume <id>' before the prompt when nativeSessionId set`, async () => {
    let cmd: ReadonlyArray<string> = []
    const b = new StdioBridge()
    await b.runTurn({
      sandbox: fakeSandbox({
        stdoutLines: [
          `{"type":"session_meta","timestamp":"2026-05-01T12:00:00Z","session_id":"abc"}`,
        ],
        onCmd: (c) => (cmd = c),
      }),
      kind: `codex`,
      prompt: `keep going`,
      nativeSessionId: `prior-session-id`,
      onEvent: () => undefined,
    })
    const resumeIdx = cmd.indexOf(`resume`)
    expect(resumeIdx).toBeGreaterThan(0)
    expect(cmd[resumeIdx + 1]).toBe(`prior-session-id`)
    expect(cmd.indexOf(`keep going`)).toBeGreaterThan(resumeIdx)
  })
})
```

- [ ] **Step 3: Update `stdio-bridge-resume.test.ts` to parameterize by adapter**

Rewrite `packages/coding-agents/test/unit/stdio-bridge-resume.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { StdioBridge } from '../../src/bridge/stdio-bridge'
import { listAdapters } from '../../src'
import type { SandboxInstance, RunTurnArgs } from '../../src/types'

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
    agentId: `/x/coding-agent/y`,
    workspaceMount: `/workspace`,
    exec: vi.fn().mockResolvedValue(handle),
    destroy: vi.fn(),
  } as unknown as SandboxInstance
}

const initLineFor = (kind: string) =>
  kind === `claude`
    ? JSON.stringify({
        type: `system`,
        subtype: `init`,
        session_id: `sess-1`,
        tools: [],
        mcp_servers: [],
      })
    : JSON.stringify({
        type: `session_meta`,
        timestamp: `2026-05-01T12:00:00Z`,
        session_id: `sess-1`,
      })

describe.each(listAdapters().map((a) => [a.kind] as const))(
  `StdioBridge — onNativeLine — %s`,
  (kind) => {
    it(`calls onNativeLine for every non-empty stdout line`, async () => {
      const lines = [initLineFor(kind), `{"type":"placeholder"}`]
      const sandbox = makeFakeSandbox(lines)
      const bridge = new StdioBridge()
      const received: string[] = []

      await bridge.runTurn({
        sandbox,
        kind,
        prompt: `hi`,
        onEvent: () => undefined,
        onNativeLine: (l) => received.push(l),
      } as RunTurnArgs)

      expect(received).toEqual(lines)
    })

    it(`does not call onNativeLine for empty lines`, async () => {
      const lines = [``, initLineFor(kind)]
      const sandbox = makeFakeSandbox(lines)
      const bridge = new StdioBridge()
      const received: string[] = []

      await bridge.runTurn({
        sandbox,
        kind,
        prompt: `hi`,
        onEvent: () => undefined,
        onNativeLine: (l) => received.push(l),
      } as RunTurnArgs)

      expect(received.every((l) => l.length > 0)).toBe(true)
    })
  }
)
```

- [ ] **Step 4: Run the bridge unit tests**

```bash
pnpm -C packages/coding-agents test test/unit/stdio-bridge
```

Expected: PASS — both `claude` and `codex` `describe.each` blocks run; the kind-specific blocks each pass.

- [ ] **Step 5: Commit**

```bash
git add packages/coding-agents/src/bridge/stdio-bridge.ts \
        packages/coding-agents/test/unit/stdio-bridge.test.ts \
        packages/coding-agents/test/unit/stdio-bridge-resume.test.ts
git commit -m "refactor(coding-agents): bridge dispatches via adapter; tests parameterized by kind"
```

---

## Task 4: Widen `kind` enums and `env` callback signature

**Files:**

- Modify: `packages/coding-agents/src/entity/collections.ts`
- Modify: `packages/coding-agents/src/entity/register.ts`
- Modify: `packages/coding-agents/src/entity/handler.ts` (signature only — body changes in Task 5)

- [ ] **Step 1: Widen the sessionMeta `kind` enum**

In `packages/coding-agents/src/entity/collections.ts`, find:

```ts
kind: z.enum([`claude`]),
```

Replace with:

```ts
kind: z.enum([`claude`, `codex`]),
```

- [ ] **Step 2: Widen the creation args `kind` enum and change the `env` signature**

In `packages/coding-agents/src/entity/register.ts`, find:

```ts
const creationArgsSchema = z.object({
  kind: z.enum([`claude`]).optional(),
```

Replace with:

```ts
const creationArgsSchema = z.object({
  kind: z.enum([`claude`, `codex`]).optional(),
```

In the same file, find the `env` field:

```ts
  /** Per-turn env supplier. Defaults to forwarding ANTHROPIC_API_KEY from process.env. */
  env?: () => Record<string, string>
```

Replace with:

```ts
  /**
   * Per-turn env supplier, called once the handler knows the agent's
   * kind. Default forwards each adapter's `defaultEnvVars` from
   * process.env.
   */
  env?: (kind: import('../types').CodingAgentKind) => Record<string, string>
```

- [ ] **Step 3: Update the default `env` implementation**

Still in `register.ts`, find the default:

```ts
const env =
  deps.env ??
  (() => {
    const out: Record<string, string> = {}
    const k = process.env.ANTHROPIC_API_KEY
    if (k) out.ANTHROPIC_API_KEY = k
    return out
  })
```

Replace with:

```ts
const env =
  deps.env ??
  ((kind: import('../types').CodingAgentKind) => {
    const adapter = getAdapter(kind)
    const out: Record<string, string> = {}
    for (const k of adapter.defaultEnvVars) {
      const v = process.env[k]
      if (v) out[k] = v
    }
    return out
  })
```

Add the `getAdapter` import at the top of the file:

```ts
import { getAdapter } from '../agents/registry'
```

- [ ] **Step 4: Update the handler's options type**

In `packages/coding-agents/src/entity/handler.ts`, find:

```ts
/** Called per-turn to source CLI env (e.g. ANTHROPIC_API_KEY). */
env: () => Record<string, string>
```

Replace with:

```ts
/** Called per-turn (with the agent kind) to source CLI env. */
env: (kind: import('../types').CodingAgentKind) => Record<string, string>
```

Inside `processPrompt` (and any other call site of `options.env(...)` in the file), find:

```ts
        env: options.env(),
```

Replace with:

```ts
        env: options.env(meta.kind),
```

- [ ] **Step 5: Update unit tests that supply an `env` callback**

In `packages/coding-agents/test/unit/entity-handler.test.ts` and `packages/coding-agents/test/integration/slice-a.test.ts`, find every occurrence of:

```ts
env: () => ({
```

Replace with:

```ts
env: (_kind) => ({
```

(Tests don't need per-kind divergence; they pass the same env regardless. Underscore prefix avoids unused-arg lint.)

Also check `packages/coding-agents/test/integration/slice-b.test.ts` and `slice-c1.test.ts` if they construct an env supplier.

- [ ] **Step 6: Run unit tests; expect green**

```bash
pnpm -C packages/coding-agents test test/unit
```

Expected: PASS. Schema widening is back-compatible with the existing `kind: 'claude'` rows.

- [ ] **Step 7: Commit**

```bash
git add packages/coding-agents/src/entity \
        packages/coding-agents/test/unit/entity-handler.test.ts \
        packages/coding-agents/test/integration/slice-a.test.ts \
        packages/coding-agents/test/integration/slice-b.test.ts \
        packages/coding-agents/test/integration/slice-c1.test.ts
git commit -m "refactor(coding-agents): widen kind enums; env callback receives kind"
```

---

## Task 5: Handler probe / materialise / capture via adapter

**Files:**

- Modify: `packages/coding-agents/src/entity/handler.ts`

- [ ] **Step 1: Replace `ensureTranscriptMaterialised` with an adapter-driven version**

In `packages/coding-agents/src/entity/handler.ts`, find the current `ensureTranscriptMaterialised` function (~lines 71-127). Replace its entire body with:

```ts
async function ensureTranscriptMaterialised(
  sandbox: SandboxInstance,
  kind: import('../types').CodingAgentKind,
  nativeSessionId: string,
  content: string
): Promise<{ written: boolean }> {
  if (!content) return { written: false }
  const adapter = getAdapter(kind)
  const homeDir = `/home/agent`
  const cwd = sandbox.workspaceMount

  // Probe: does the transcript already exist?
  const probe = await sandbox.exec({
    cmd: adapter.probeCommand({ homeDir, cwd, sessionId: nativeSessionId }),
  })
  void (async () => {
    for await (const _ of probe.stdout) {
      // discard
    }
  })()
  void (async () => {
    for await (const _ of probe.stderr) {
      // discard
    }
  })()
  const probeExit = await probe.wait()
  if (probeExit.exitCode === 0) return { written: false }

  const fullPath = adapter.materialiseTargetPath({
    homeDir,
    cwd,
    sessionId: nativeSessionId,
    content,
  })

  // Ensure parent directory exists, then write content via copyTo.
  const parent = fullPath.slice(0, fullPath.lastIndexOf(`/`))
  const mkdir = await sandbox.exec({
    cmd: [`mkdir`, `-p`, parent],
  })
  void (async () => {
    for await (const _ of mkdir.stdout) {
      // discard
    }
  })()
  let mkdirErr = ``
  const drainMkdirErr = async () => {
    for await (const line of mkdir.stderr) mkdirErr += line + `\n`
  }
  const mkdirErrPromise = drainMkdirErr()
  const mkdirExit = await mkdir.wait()
  await mkdirErrPromise
  if (mkdirExit.exitCode !== 0) {
    throw new Error(
      `mkdir for transcript failed: exit ${mkdirExit.exitCode}, stderr=${mkdirErr.slice(0, 200)}`
    )
  }

  await sandbox.copyTo({
    destPath: fullPath,
    content,
    mode: 0o600,
  })
  return { written: true }
}
```

Key changes vs. before:

1. Takes `kind` parameter; looks up adapter.
2. Probe argv comes from `adapter.probeCommand`.
3. Target path comes from `adapter.materialiseTargetPath` (with `content` so codex can reconstruct YYYY/MM/DD).
4. Parent dir derived from final path's last `/`.

- [ ] **Step 2: Replace `captureTranscript` with an adapter-driven version**

Find the current `captureTranscript` function (~lines 139-164). Replace its entire body with:

```ts
async function captureTranscript(
  sandbox: SandboxInstance,
  kind: import('../types').CodingAgentKind,
  nativeSessionId: string
): Promise<string> {
  const adapter = getAdapter(kind)
  const handle = await sandbox.exec({
    cmd: adapter.captureCommand({
      homeDir: `/home/agent`,
      cwd: sandbox.workspaceMount,
      sessionId: nativeSessionId,
    }),
    cwd: sandbox.workspaceMount,
  })
  let b64 = ``
  const drain = async () => {
    for await (const line of handle.stdout) b64 += line
  }
  const drainErr = async () => {
    for await (const _ of handle.stderr) {
      // discard
    }
  }
  const exit = handle.wait()
  await Promise.all([drain(), drainErr(), exit])
  if (!b64) return ``
  return Buffer.from(b64, `base64`).toString(`utf8`)
}
```

- [ ] **Step 3: Update the callers of `ensureTranscriptMaterialised` and `captureTranscript`**

In `processPrompt` inside `handler.ts`, find:

```ts
const { written } = await ensureTranscriptMaterialised(
  sandbox,
  meta.nativeSessionId,
  transcript.content
)
```

Replace with:

```ts
const { written } = await ensureTranscriptMaterialised(
  sandbox,
  meta.kind,
  meta.nativeSessionId,
  transcript.content
)
```

Find:

```ts
const content = await captureTranscript(sandbox, finalNativeSessionId)
```

Replace with:

```ts
const content = await captureTranscript(
  sandbox,
  meta.kind,
  finalNativeSessionId
)
```

- [ ] **Step 4: Drop the now-unused inline `sanitiseCwd` helper**

The handler's local `sanitiseCwd` function (~lines 62-64) is no longer referenced after the refactor. Find:

```ts
function sanitiseCwd(cwd: string): string {
  return cwd.replace(/\//g, `-`)
}
```

Delete it. **Important:** the handler's first-wake init path uses `sanitiseCwd(realWorkspace)` to resolve the on-host import path:

```ts
const projectDir = sanitiseCwd(realWorkspace)
const sessionPath = path.join(
  home,
  `.claude`,
  `projects`,
  projectDir,
  `${args.importNativeSessionId}.jsonl`
)
```

Keep that block but inline the slug expression locally (the import path is fundamentally on the host, not the sandbox):

```ts
const projectDir = realWorkspace.replace(/\//g, `-`)
const sessionPath = path.join(
  home,
  `.claude`,
  `projects`,
  projectDir,
  `${args.importNativeSessionId}.jsonl`
)
```

(This claude-import code path stays claude-only in this slice; codex-import lands when we generalize the CLI in Task 7.)

- [ ] **Step 5: Add the `getAdapter` import**

At the top of `packages/coding-agents/src/entity/handler.ts`, add:

```ts
import { getAdapter } from '../agents/registry'
```

- [ ] **Step 6: Run all unit tests; expect green**

```bash
pnpm -C packages/coding-agents test
```

Expected: PASS. Existing claude handler tests still work because the adapter-driven path produces identical commands for claude.

- [ ] **Step 7: Commit**

```bash
git add packages/coding-agents/src/entity/handler.ts
git commit -m "refactor(coding-agents): handler probe/materialise/capture dispatch via adapter"
```

---

## Task 6: Bake codex into the sandbox image

**Files:**

- Modify: `packages/coding-agents/docker/Dockerfile`

- [ ] **Step 1: Add `@openai/codex` to the global npm install**

In `packages/coding-agents/docker/Dockerfile`, find:

```dockerfile
RUN npm install -g @anthropic-ai/claude-code@latest \
    && claude --version
```

Replace with:

```dockerfile
RUN npm install -g @anthropic-ai/claude-code@latest @openai/codex@latest \
    && claude --version \
    && codex --version
```

- [ ] **Step 2: Rebuild the test image**

```bash
docker build -t electric-ax/coding-agent-sandbox:test \
  -f packages/coding-agents/docker/Dockerfile \
  packages/coding-agents
```

Expected: build succeeds; final layer prints both `claude --version` and `codex --version` outputs.

- [ ] **Step 3: Verify codex argv shape inside the image**

```bash
docker run --rm electric-ax/coding-agent-sandbox:test sh -c 'codex --help && codex exec --help'
```

Expected: `codex exec` lists `--skip-git-repo-check` and `--json` (or whatever current equivalents are). If the flags differ, **stop and update Task 2's `CodexAdapter.buildCliInvocation`** + the spec, then re-run.

- [ ] **Step 4: Pin `@openai/codex` to the verified version**

After confirming the version that works, replace `@openai/codex@latest` with `@openai/codex@<verified-version>` (e.g. `@openai/codex@^0.30.0`).

- [ ] **Step 5: Commit**

```bash
git add packages/coding-agents/docker/Dockerfile
git commit -m "build(coding-agents): bake codex CLI into sandbox image"
```

---

## Task 7: Generalize the import CLI

**Files:**

- Create: `packages/coding-agents/src/cli/import.ts`
- Delete: `packages/coding-agents/src/cli/import-claude.ts`
- Modify: `packages/coding-agents/package.json`
- Modify: `packages/coding-agents/test/unit/cli-import.test.ts`

- [ ] **Step 1: Create the generalized CLI**

Create `packages/coding-agents/src/cli/import.ts`:

```ts
#!/usr/bin/env node
import { parseArgs } from 'node:util'
import { stat, access } from 'node:fs/promises'
import { findSessionPath } from 'agent-session-protocol'
import type { AgentType } from 'agent-session-protocol'
import { realpath } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

export interface RunImportCliOptions {
  argv: Array<string>
  homeDir?: string
  fetchFn?: typeof fetch
}

export interface RunImportCliResult {
  exitCode: number
  stdout: string
  stderr: string
}

function sanitiseCwd(p: string): string {
  return p.replace(/\//g, `-`)
}

function slugifyForName(s: string): string {
  return s
    .replace(/[^a-zA-Z0-9_.-]/g, `-`)
    .replace(/-+/g, `-`)
    .replace(/^[-_.]+/, ``)
    .replace(/[-_.]+$/, ``)
}

async function locateSessionFile(
  agent: AgentType,
  workspace: string,
  sessionId: string,
  homeDir: string
): Promise<{ path: string } | { error: string }> {
  if (agent === `claude`) {
    const real = await realpath(workspace)
    const p = path.join(
      homeDir,
      `.claude`,
      `projects`,
      sanitiseCwd(real),
      `${sessionId}.jsonl`
    )
    try {
      await access(p)
      return { path: p }
    } catch {
      return { error: `session JSONL not found at ${p}` }
    }
  }
  // codex: use asp's scanner since the path embeds a wall-clock timestamp.
  const found = await findSessionPath(`codex`, sessionId)
  if (!found)
    return {
      error: `codex session ${sessionId} not found under ${homeDir}/.codex/sessions`,
    }
  return { path: found }
}

export async function runImportCli(
  opts: RunImportCliOptions
): Promise<RunImportCliResult> {
  const { values } = parseArgs({
    args: opts.argv,
    options: {
      agent: { type: `string` }, // 'claude' | 'codex'
      workspace: { type: `string` },
      'session-id': { type: `string` },
      'agent-id': { type: `string` },
      server: { type: `string` },
    },
    allowPositionals: false,
  })

  const agentRaw = values.agent ?? `claude`
  if (agentRaw !== `claude` && agentRaw !== `codex`) {
    return {
      exitCode: 2,
      stdout: ``,
      stderr: `--agent must be 'claude' or 'codex'; got ${JSON.stringify(agentRaw)}\n`,
    }
  }
  const agent: AgentType = agentRaw

  const workspace = values.workspace
  const sessionId = values[`session-id`]
  if (!workspace || !sessionId) {
    return {
      exitCode: 2,
      stdout: ``,
      stderr: `usage: electric-ax-import [--agent claude|codex] --workspace <path> --session-id <id> [--agent-id <name>] [--server <url>]\n`,
    }
  }

  if (!/^[A-Za-z0-9_-]+$/.test(sessionId)) {
    return {
      exitCode: 1,
      stdout: ``,
      stderr: `--session-id must be alphanumeric (with - or _); got ${JSON.stringify(sessionId)}\n`,
    }
  }

  const home = opts.homeDir ?? os.homedir()
  const fetchFn = opts.fetchFn ?? fetch

  // Validate workspace exists.
  try {
    const s = await stat(workspace)
    if (!s.isDirectory()) {
      return {
        exitCode: 1,
        stdout: ``,
        stderr: `workspace is not a directory: ${workspace}\n`,
      }
    }
  } catch {
    return {
      exitCode: 1,
      stdout: ``,
      stderr: `workspace not accessible: ${workspace}\n`,
    }
  }

  const located = await locateSessionFile(agent, workspace, sessionId, home)
  if (`error` in located) {
    return { exitCode: 1, stdout: ``, stderr: `${located.error}\n` }
  }

  const agentName = values[`agent-id`] ?? `import-${slugifyForName(sessionId)}`
  const server = values.server ?? `http://localhost:4437`
  const url = `${server.replace(/\/$/, ``)}/coding-agent/${agentName}`

  const body = {
    kind: agent,
    target: `host`,
    workspaceType: `bindMount`,
    workspaceHostPath: workspace,
    importNativeSessionId: sessionId,
  }

  const res = await fetchFn(url, {
    method: `PUT`,
    headers: { 'content-type': `application/json` },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => ``)
    return {
      exitCode: 1,
      stdout: ``,
      stderr: `spawn request failed: ${res.status} ${text}\n`,
    }
  }

  return {
    exitCode: 0,
    stdout: `imported as /coding-agent/${agentName}\n`,
    stderr: ``,
  }
}

const isMain =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith(`import.js`)
if (isMain) {
  runImportCli({ argv: process.argv.slice(2) }).then(
    (r) => {
      if (r.stdout) process.stdout.write(r.stdout)
      if (r.stderr) process.stderr.write(r.stderr)
      process.exit(r.exitCode)
    },
    (err) => {
      process.stderr.write(`unexpected error: ${err}\n`)
      process.exit(1)
    }
  )
}
```

- [ ] **Step 2: Delete the old CLI**

```bash
rm packages/coding-agents/src/cli/import-claude.ts
```

- [ ] **Step 3: Update `package.json` bin entries**

In `packages/coding-agents/package.json`, find:

```json
  "bin": {
    "electric-ax-import-claude": "./dist/cli/import-claude.js"
  },
```

Replace with:

```json
  "bin": {
    "electric-ax-import": "./dist/cli/import.js"
  },
```

- [ ] **Step 4: Rewrite the import CLI test as `describe.each`**

Replace the entire content of `packages/coding-agents/test/unit/cli-import.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runImportCli } from '../../src/cli/import'
import { listAdapters } from '../../src'

describe.each(listAdapters().map((a) => [a.kind] as const))(
  `runImportCli — %s`,
  (kind) => {
    it(`builds the correct PUT body and URL`, async () => {
      const home = await mkdtemp(join(tmpdir(), `cli-home-`))
      const ws = await mkdtemp(join(tmpdir(), `cli-ws-`))
      let sessionPath: string
      if (kind === `claude`) {
        const sanitised = (await realpath(ws)).replace(/\//g, `-`)
        const projectDir = join(home, `.claude`, `projects`, sanitised)
        await mkdir(projectDir, { recursive: true })
        sessionPath = join(projectDir, `s1.jsonl`)
        await writeFile(sessionPath, `{"k":"v"}\n`)
      } else {
        // codex: write under ~/.codex/sessions/<date>/rollout-<ts>-<id>.jsonl
        const day = join(home, `.codex`, `sessions`, `2026`, `05`, `01`)
        await mkdir(day, { recursive: true })
        sessionPath = join(day, `rollout-2026-05-01T12-00-00-s1.jsonl`)
        await writeFile(
          sessionPath,
          `{"timestamp":"2026-05-01T12:00:00Z","session_id":"s1"}\n`
        )
      }

      const fetchMock = vi.fn(async () => new Response(`{}`, { status: 200 }))

      try {
        // For codex, we need agent-session-protocol's findSessionPath to look
        // under our test home, not the real $HOME. asp uses os.homedir() so
        // override $HOME for this call.
        const origHome = process.env.HOME
        process.env.HOME = home
        try {
          const result = await runImportCli({
            argv: [
              `--agent`,
              kind,
              `--workspace`,
              ws,
              `--session-id`,
              `s1`,
              `--server`,
              `http://localhost:9999`,
              `--agent-id`,
              `imp-1`,
            ],
            homeDir: home,
            fetchFn: fetchMock as any,
          })
          expect(result.exitCode).toBe(0)
        } finally {
          if (origHome === undefined) delete process.env.HOME
          else process.env.HOME = origHome
        }
        expect(fetchMock).toHaveBeenCalledTimes(1)
        const [url, init] = fetchMock.mock.calls[0]!
        expect(url).toMatch(/\/coding-agent\/imp-1$/)
        expect(init.method).toBe(`PUT`)
        const body = JSON.parse(init.body)
        expect(body.kind).toBe(kind)
        expect(body.target).toBe(`host`)
        expect(body.workspaceType).toBe(`bindMount`)
        expect(body.workspaceHostPath).toBe(ws)
        expect(body.importNativeSessionId).toBe(`s1`)
      } finally {
        await rm(home, { recursive: true, force: true })
        await rm(ws, { recursive: true, force: true })
      }
    })

    it(`rejects --session-id with path traversal characters`, async () => {
      const fetchMock = vi.fn()
      const result = await runImportCli({
        argv: [
          `--agent`,
          kind,
          `--workspace`,
          `/tmp`,
          `--session-id`,
          `../etc/passwd`,
        ],
        fetchFn: fetchMock as any,
      })
      expect(result.exitCode).not.toBe(0)
      expect(result.stderr).toMatch(/alphanumeric/i)
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it(`fails fast when the session file is missing on disk`, async () => {
      const home = await mkdtemp(join(tmpdir(), `cli-home-`))
      const ws = await mkdtemp(join(tmpdir(), `cli-ws-`))
      const fetchMock = vi.fn()
      try {
        const origHome = process.env.HOME
        process.env.HOME = home
        try {
          const result = await runImportCli({
            argv: [`--agent`, kind, `--workspace`, ws, `--session-id`, `nope`],
            homeDir: home,
            fetchFn: fetchMock as any,
          })
          expect(result.exitCode).not.toBe(0)
          expect(result.stderr).toMatch(/not found/)
          expect(fetchMock).not.toHaveBeenCalled()
        } finally {
          if (origHome === undefined) delete process.env.HOME
          else process.env.HOME = origHome
        }
      } finally {
        await rm(home, { recursive: true, force: true })
        await rm(ws, { recursive: true, force: true })
      }
    })
  }
)

describe(`runImportCli — defaults and validation`, () => {
  it(`defaults to --agent claude when omitted`, async () => {
    const home = await mkdtemp(join(tmpdir(), `cli-home-`))
    const ws = await mkdtemp(join(tmpdir(), `cli-ws-`))
    try {
      const sanitised = (await realpath(ws)).replace(/\//g, `-`)
      await mkdir(join(home, `.claude`, `projects`, sanitised), {
        recursive: true,
      })
      await writeFile(
        join(home, `.claude`, `projects`, sanitised, `s1.jsonl`),
        `{}\n`
      )
      const fetchMock = vi.fn(async () => new Response(`{}`, { status: 200 }))
      const result = await runImportCli({
        argv: [
          `--workspace`,
          ws,
          `--session-id`,
          `s1`,
          `--server`,
          `http://localhost:9999`,
        ],
        homeDir: home,
        fetchFn: fetchMock as any,
      })
      expect(result.exitCode).toBe(0)
      const body = JSON.parse(fetchMock.mock.calls[0]![1].body)
      expect(body.kind).toBe(`claude`)
    } finally {
      await rm(home, { recursive: true, force: true })
      await rm(ws, { recursive: true, force: true })
    }
  })

  it(`rejects unknown --agent values`, async () => {
    const fetchMock = vi.fn()
    const result = await runImportCli({
      argv: [`--agent`, `gemini`, `--workspace`, `/tmp`, `--session-id`, `s1`],
      fetchFn: fetchMock as any,
    })
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toMatch(/must be 'claude' or 'codex'/)
  })
})
```

- [ ] **Step 5: Run unit tests; expect green**

```bash
pnpm -C packages/coding-agents test test/unit/cli-import.test.ts
```

Expected: PASS for both kinds.

- [ ] **Step 6: Build and verify the bin entry**

```bash
pnpm -C packages/coding-agents build
node packages/coding-agents/dist/cli/import.js 2>&1 | head -5 || true
```

Expected: prints the usage banner via stderr (no args ⇒ usage error).

- [ ] **Step 7: Commit**

```bash
git add packages/coding-agents/src/cli \
        packages/coding-agents/package.json \
        packages/coding-agents/test/unit/cli-import.test.ts
git rm packages/coding-agents/src/cli/import-claude.ts 2>/dev/null || true
git commit -m "feat(coding-agents): generalize import CLI; drop electric-ax-import-claude bin"
```

---

## Task 8: Recorded fixtures

**Files:**

- Create: `packages/coding-agents/test/fixtures/README.md`
- Create: `packages/coding-agents/test/fixtures/{claude,codex}/{first-turn,resume-turn,error}.jsonl`

- [ ] **Step 1: Create the fixtures README**

Create `packages/coding-agents/test/fixtures/README.md`:

````markdown
# Test fixtures

Recorded JSONL transcripts driving unit-level bridge tests. Captured once
from real CLIs; re-record only when the upstream CLI's stream format
changes.

## Layout

`<kind>/<scenario>.jsonl` — one fixture per (kind, scenario) pair.

Scenarios:

- `first-turn.jsonl` — minimal session (init + assistant_message + result),
  no resume.
- `resume-turn.jsonl` — session_init carrying a prior session id, plus
  a follow-up assistant_message.
- `error.jsonl` — non-zero exit case (CLI prints a partial transcript
  before failing).

## Recording a new fixture

```sh
# Claude:
claude --print --output-format=stream-json --verbose \
  --dangerously-skip-permissions \
  <<<"reply with the single word: ok" \
  | tee fixtures/claude/first-turn.jsonl

# Codex:
codex exec --skip-git-repo-check --json \
  "reply with the single word: ok" \
  | tee fixtures/codex/first-turn.jsonl
```
````

Strip any session-id mentions you don't want checked in (use a placeholder
like `sess-fixture-1`).

## Adding a new agent

1. `mkdir test/fixtures/<new-kind>`.
2. Capture three fixtures with the recipes above (substitute the new CLI's
   stream-json invocation).
3. The unit `describe.each(listAdapters())` blocks pick them up
   automatically once the adapter is registered.

````

- [ ] **Step 2: Record the claude fixtures**

Run from a host with `claude` installed and `ANTHROPIC_API_KEY` set:

```bash
mkdir -p packages/coding-agents/test/fixtures/claude

claude --print --output-format=stream-json --verbose \
  --dangerously-skip-permissions \
  <<<"reply with the single word: ok" \
  > packages/coding-agents/test/fixtures/claude/first-turn.jsonl

# Capture the session id from first-turn for resume:
SID=$(jq -r 'select(.type=="system" and .subtype=="init") | .session_id' \
       packages/coding-agents/test/fixtures/claude/first-turn.jsonl | head -1)

claude --print --output-format=stream-json --verbose \
  --dangerously-skip-permissions \
  --resume "$SID" \
  <<<"and the second word: yes" \
  > packages/coding-agents/test/fixtures/claude/resume-turn.jsonl

# Error fixture: send a malformed prompt to a non-existent model.
ANTHROPIC_API_KEY="invalid" claude --print --output-format=stream-json \
  --verbose --dangerously-skip-permissions \
  <<<"hi" \
  > packages/coding-agents/test/fixtures/claude/error.jsonl 2>&1 || true
````

- [ ] **Step 3: Record the codex fixtures**

Run from a host with `codex` installed and `OPENAI_API_KEY` set:

```bash
mkdir -p packages/coding-agents/test/fixtures/codex

codex exec --skip-git-repo-check --json \
  "reply with the single word: ok" \
  > packages/coding-agents/test/fixtures/codex/first-turn.jsonl

# Capture session id from the first-turn output (codex's first JSONL
# line carries it in `session_id`).
SID=$(jq -r 'select(.session_id) | .session_id' \
       packages/coding-agents/test/fixtures/codex/first-turn.jsonl | head -1)

codex exec --skip-git-repo-check --json resume "$SID" \
  "and the second word: yes" \
  > packages/coding-agents/test/fixtures/codex/resume-turn.jsonl

OPENAI_API_KEY="invalid" codex exec --skip-git-repo-check --json \
  "hi" \
  > packages/coding-agents/test/fixtures/codex/error.jsonl 2>&1 || true
```

- [ ] **Step 4: Commit fixtures**

```bash
git add packages/coding-agents/test/fixtures
git commit -m "test(coding-agents): recorded JSONL fixtures for claude + codex"
```

---

## Task 9: Integration-test parameterization

**Files:**

- Modify: `packages/coding-agents/test/support/env.ts`
- Modify: `packages/coding-agents/test/integration/slice-a.test.ts`
- Modify: `packages/coding-agents/test/integration/host-provider.test.ts`
- Modify: `packages/coding-agents/test/integration/smoke.test.ts`

- [ ] **Step 1: Extend the env loader for both kinds**

Replace the entire content of `packages/coding-agents/test/support/env.ts`:

```ts
import { readFileSync } from 'node:fs'
import type { CodingAgentKind } from '../../src/types'

const KEY_FILE = `/tmp/.electric-coding-agents-env`

export interface TestEnv {
  ANTHROPIC_API_KEY?: string
  ANTHROPIC_MODEL?: string
  OPENAI_API_KEY?: string
  OPENAI_MODEL?: string
}

let cached: TestEnv | null = null

export function loadTestEnv(): TestEnv {
  if (cached) return cached
  let raw: string
  try {
    raw = readFileSync(KEY_FILE, `utf-8`)
  } catch {
    cached = {}
    return cached
  }
  const out: TestEnv = {}
  for (const line of raw.split(`\n`)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith(`#`)) continue
    const eq = trimmed.indexOf(`=`)
    if (eq < 0) continue
    const k = trimmed.slice(0, eq) as keyof TestEnv
    const v = trimmed.slice(eq + 1)
    if (
      k === `ANTHROPIC_API_KEY` ||
      k === `ANTHROPIC_MODEL` ||
      k === `OPENAI_API_KEY` ||
      k === `OPENAI_MODEL`
    ) {
      out[k] = v
    }
  }
  // Defaults.
  if (!out.ANTHROPIC_MODEL) out.ANTHROPIC_MODEL = `claude-haiku-4-5-20251001`
  cached = out
  return cached
}

/**
 * Return the env map a sandbox should run with for a given kind, or
 * `null` if the required key is missing. Tests use the null return
 * to skip a kind's `describe.each` block cleanly.
 */
export function envForKind(
  env: TestEnv,
  kind: CodingAgentKind
): Record<string, string> | null {
  if (kind === `claude`) {
    if (!env.ANTHROPIC_API_KEY) return null
    return {
      ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
      ...(env.ANTHROPIC_MODEL ? { ANTHROPIC_MODEL: env.ANTHROPIC_MODEL } : {}),
    }
  }
  if (kind === `codex`) {
    if (!env.OPENAI_API_KEY) return null
    return {
      OPENAI_API_KEY: env.OPENAI_API_KEY,
      ...(env.OPENAI_MODEL ? { OPENAI_MODEL: env.OPENAI_MODEL } : {}),
    }
  }
  return null
}

/**
 * A minimal "respond with this word" probe per kind, used by
 * integration tests to assert the bridge round-trips successfully.
 */
export interface AdapterTestProbe {
  prompt: string
  expectsResponseMatching: RegExp
  model?: string
}

export function probeForKind(
  env: TestEnv,
  kind: CodingAgentKind
): AdapterTestProbe {
  if (kind === `claude`) {
    return {
      prompt: `Reply with the single word: ok`,
      expectsResponseMatching: /ok/i,
      model: env.ANTHROPIC_MODEL,
    }
  }
  return {
    prompt: `Reply with the single word: ok`,
    expectsResponseMatching: /ok/i,
    model: env.OPENAI_MODEL,
  }
}
```

- [ ] **Step 2: Refactor `smoke.test.ts` to `describe.each(listAdapters())`**

Replace the body of `packages/coding-agents/test/integration/smoke.test.ts`:

```ts
import { describe, expect, beforeAll, afterAll, it } from 'vitest'
import type { NormalizedEvent } from 'agent-session-protocol'
import { LocalDockerProvider } from '../../src/providers/local-docker'
import { StdioBridge } from '../../src/bridge/stdio-bridge'
import { listAdapters } from '../../src'
import { buildTestImage, TEST_IMAGE_TAG } from '../support/build-image'
import { envForKind, loadTestEnv, probeForKind } from '../support/env'

const SHOULD_RUN = process.env.DOCKER === `1`
const describeMaybe = SHOULD_RUN ? describe : describe.skip

describeMaybe(`coding-agents smoke (real Docker)`, () => {
  beforeAll(async () => {
    await buildTestImage()
  }, 600_000)

  for (const adapter of listAdapters()) {
    const kind = adapter.kind
    const env = loadTestEnv()
    const kindEnv = envForKind(env, kind)
    const describeKind = kindEnv ? describe : describe.skip

    describeKind(`smoke — ${kind}`, () => {
      const provider = new LocalDockerProvider({ image: TEST_IMAGE_TAG })
      const bridge = new StdioBridge()
      const agentId = `/test/coding-agent/${kind}-${Date.now().toString(36)}`
      const events: Array<NormalizedEvent> = []

      afterAll(async () => {
        await provider.destroy(agentId).catch(() => undefined)
      })

      it(`runs ${kind} CLI; captures session_init + assistant_message`, async () => {
        const sandbox = await provider.start({
          agentId,
          kind,
          target: `sandbox`,
          workspace: {
            type: `volume`,
            name: agentId.replace(/[^a-z0-9-]/gi, `-`),
          },
          env: kindEnv!,
        })
        const probe = probeForKind(env, kind)
        const result = await bridge.runTurn({
          sandbox,
          kind,
          prompt: probe.prompt,
          model: probe.model,
          onEvent: (e) => events.push(e),
        })
        expect(result.exitCode).toBe(0)
        expect(events.find((e) => e.type === `session_init`)).toBeTruthy()
        expect(events.find((e) => e.type === `assistant_message`)).toBeTruthy()
        expect((result.finalText ?? ``).length).toBeGreaterThan(0)
        expect(result.finalText ?? ``).toMatch(probe.expectsResponseMatching)
      }, 180_000)
    })
  }
})
```

- [ ] **Step 3: Refactor `host-provider.test.ts` to `describe.each(listAdapters())`**

Replace the body of `packages/coding-agents/test/integration/host-provider.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HostProvider } from '../../src/providers/host'
import { StdioBridge } from '../../src/bridge/stdio-bridge'
import { listAdapters } from '../../src'
import { envForKind, loadTestEnv, probeForKind } from '../support/env'

const SHOULD_RUN = process.env.HOST_PROVIDER === `1`
const describeMaybe = SHOULD_RUN ? describe : describe.skip

describeMaybe(`HostProvider integration`, () => {
  for (const adapter of listAdapters()) {
    const kind = adapter.kind
    const env = loadTestEnv()
    const kindEnv = envForKind(env, kind)
    const describeKind = kindEnv ? describe : describe.skip

    describeKind(`host — ${kind}`, () => {
      it(`runs a one-turn ${kind} prompt on the host with a bind-mount workspace`, async () => {
        const ws = await mkdtemp(join(tmpdir(), `host-int-${kind}-`))
        const provider = new HostProvider()
        const bridge = new StdioBridge()
        const agentId = `/test/coding-agent/host-int-${kind}-${Date.now().toString(36)}`
        try {
          const sandbox = await provider.start({
            agentId,
            kind,
            target: `host`,
            workspace: { type: `bindMount`, hostPath: ws },
            env: kindEnv!,
          })
          const events: any[] = []
          const probe = probeForKind(env, kind)
          const result = await bridge.runTurn({
            sandbox,
            kind,
            prompt: probe.prompt,
            model: probe.model,
            onEvent: (e) => events.push(e),
          })
          expect(result.exitCode).toBe(0)
          expect(result.nativeSessionId).toBeTruthy()
          const assistant = events.find((e) => e.type === `assistant_message`)
          expect(assistant).toBeDefined()
        } finally {
          await provider.destroy(agentId)
          await rm(ws, { recursive: true, force: true })
        }
      }, 120_000)
    })
  }
})
```

- [ ] **Step 4: Parameterize `slice-a.test.ts` by adapter**

Open `packages/coding-agents/test/integration/slice-a.test.ts`.

**Edit 1 — imports.** After the existing imports, add:

```ts
import { listAdapters } from '../../src'
import { envForKind, probeForKind } from '../support/env'
```

**Edit 2 — `describeMaybe` outer wrap.** Find the line:

```ts
describeMaybe(`Slice A — full integration`, () => {
  beforeAll(async () => {
    await buildTestImage()
  }, 600_000)

  it(`spawns, runs prompt, lease-serializes, recovers from crash, destroys`, async () => {
```

Replace with:

```ts
describeMaybe(`Slice A — full integration`, () => {
  beforeAll(async () => {
    await buildTestImage()
  }, 600_000)

  for (const adapter of listAdapters()) {
    const kind = adapter.kind
    const env = loadTestEnv()
    const kindEnv = envForKind(env, kind)
    const describeKind = kindEnv ? describe : describe.skip

    describeKind(`lifecycle — ${kind}`, () => {
      it(`spawns, runs prompt, lease-serializes, recovers from crash, destroys`, async () => {
```

**Edit 3 — close brackets.** At the bottom of the file, find:

```ts
  }, 360_000)
})
```

Replace with:

```ts
      }, 360_000)
    })
  }
})
```

(Adds a `})` for `describeKind` and a `}` for the `for` loop.)

**Edit 4 — env construction.** Find:

```ts
const env = loadTestEnv()
const provider = new LocalDockerProvider({ image: TEST_IMAGE_TAG })
```

Replace with (note: the outer `env`/`kindEnv` are now in scope from edit 2):

```ts
const provider = new LocalDockerProvider({ image: TEST_IMAGE_TAG })
```

Find the first handler's env supplier:

```ts
      env: () => ({
        ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
        ANTHROPIC_MODEL: env.ANTHROPIC_MODEL,
      }),
```

Replace with:

```ts
      env: (_kind) => kindEnv!,
```

Find the second handler's env supplier (inside `lm2` setup near the bottom):

```ts
      env: () => ({ ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY }),
```

Replace with:

```ts
      env: (_kind) => kindEnv!,
```

**Edit 5 — replace claude-literal `kind` and prompt strings.** Find:

```ts
const args = {
  kind: `claude`,
  workspaceType: `volume`,
  workspaceName: sharedName,
  idleTimeoutMs: 2000,
}
```

Replace with:

```ts
const probe = probeForKind(env, kind)
const args = {
  kind,
  workspaceType: `volume`,
  workspaceName: sharedName,
  idleTimeoutMs: 2000,
}
```

Find each `pushInbox(...)` call with a hardcoded prompt and swap the prompt text for `probe.prompt`. The current file has these prompts:

- `text: 'Reply with the single word: ok'` → `text: probe.prompt`
- `text: 'Reply: again'` → `text: probe.prompt`
- `text: 'Reply: B'` → `text: probe.prompt`
- `text: 'Reply: A'` → `text: probe.prompt`
- `text: 'after crash'` → `text: probe.prompt`

The assertions are about run completion and lease serialisation, not response-text content. Using the same probe across all turns is fine.

**Edit 6 — agent IDs.** To keep concurrent runs across kinds isolated, suffix the agent ids with `${kind}`:

Find:

```ts
const agentA = `/test/coding-agent/a-${Date.now().toString(36)}`
```

Replace with:

```ts
const agentA = `/test/coding-agent/${kind}-a-${Date.now().toString(36)}`
```

Find:

```ts
const sharedName = `slice-a-shared-${Date.now().toString(36)}`
```

Replace with:

```ts
const sharedName = `slice-a-${kind}-shared-${Date.now().toString(36)}`
```

Find:

```ts
const agentB = `/test/coding-agent/b-${Date.now().toString(36)}`
```

Replace with:

```ts
const agentB = `/test/coding-agent/${kind}-b-${Date.now().toString(36)}`
```

- [ ] **Step 5: Run claude-only integration to confirm green**

```bash
DOCKER=1 pnpm -C packages/coding-agents test test/integration/slice-a.test.ts
```

Expected: PASS for claude. Codex block skips if `OPENAI_API_KEY` not in `/tmp/.electric-coding-agents-env`.

- [ ] **Step 6: Run smoke + host-provider integrations to confirm green**

```bash
DOCKER=1 pnpm -C packages/coding-agents test test/integration/smoke.test.ts
HOST_PROVIDER=1 pnpm -C packages/coding-agents test test/integration/host-provider.test.ts
```

Expected: PASS for claude. Codex blocks skip absent `OPENAI_API_KEY`.

- [ ] **Step 7: Add `OPENAI_API_KEY` to `/tmp/.electric-coding-agents-env` and re-run codex**

```bash
echo 'OPENAI_API_KEY=sk-...' >> /tmp/.electric-coding-agents-env
echo 'OPENAI_MODEL=gpt-4o-mini' >> /tmp/.electric-coding-agents-env  # or current cheap codex model
chmod 600 /tmp/.electric-coding-agents-env
DOCKER=1 pnpm -C packages/coding-agents test test/integration/smoke.test.ts
```

Expected: both `claude` and `codex` smoke blocks now run and pass.

- [ ] **Step 8: Commit**

```bash
git add packages/coding-agents/test/support/env.ts \
        packages/coding-agents/test/integration
git commit -m "test(coding-agents): integration tests parameterized by adapter; add OPENAI env loader"
```

---

## Task 10: End-to-end verification

**Files:** none (manual verification).

- [ ] **Step 1: Full unit suite**

```bash
pnpm -C packages/coding-agents test
```

Expected: all green. Both `claude` and `codex` `describe.each` blocks run for unit tests.

- [ ] **Step 2: Full integration suite (DOCKER=1, both keys present)**

```bash
DOCKER=1 pnpm -C packages/coding-agents test:integration
```

Expected: every kind-parameterized block runs for both kinds.

- [ ] **Step 3: Host-provider integration (both keys present)**

```bash
HOST_PROVIDER=1 pnpm -C packages/coding-agents test:integration:host
```

Expected: both kinds pass.

- [ ] **Step 4: Manual UI smoke**

Start the agents-server + UI per `AGENTS.md` §"Developing Electric Agents":

```bash
docker compose -f packages/agents-server/docker-compose.dev.yml up -d
pnpm -C packages/agents-runtime dev    # terminal 1
pnpm -C packages/agents-server dev     # terminal 2
pnpm -C packages/agents dev            # terminal 3
DATABASE_URL=postgresql://electric_agents:electric_agents@localhost:5432/electric_agents \
  ELECTRIC_AGENTS_ELECTRIC_URL=http://localhost:3060 \
  ELECTRIC_INSECURE=true \
  ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY \
  OPENAI_API_KEY=$OPENAI_API_KEY \
  node packages/agents-server/dist/entrypoint.js  # terminal 4
ELECTRIC_AGENTS_SERVER_URL=http://localhost:4437 \
  node packages/agents/dist/entrypoint.js         # terminal 5
pnpm -C packages/agents-server-ui dev             # terminal 6
```

In the dashboard:

1. Spawn a coding-agent with `kind: codex`, `target: sandbox`, volume workspace.
2. Send "reply with ok".
3. Confirm streaming events render in the timeline (session_init, assistant_message).
4. Wait past idle timeout; send another prompt; confirm resume works (`session_id` is the same across turns).

- [ ] **Step 5: Manual import-codex smoke**

On a host with a real codex session in `~/.codex/sessions/...`:

```bash
SID="<a real codex session id>"
node packages/coding-agents/dist/cli/import.js \
  --agent codex --workspace "$PWD" --session-id "$SID" \
  --server http://localhost:4437
```

Expected: prints `imported as /coding-agent/import-<slug>`. The new agent appears in the dashboard with the imported transcript loaded.

- [ ] **Step 6: Confirm `--agent claude` import still works**

```bash
node packages/coding-agents/dist/cli/import.js \
  --agent claude --workspace "$PWD" --session-id "<a real claude session id>" \
  --server http://localhost:4437
```

Expected: same behaviour as `electric-ax-import-claude` had before this slice. The old bin name no longer exists; callers must use `--agent claude` explicitly (or rely on the default, since claude is the default agent).

- [ ] **Step 7: Final commit / push**

If any test or manual fix landed in step 1-6, commit it. Otherwise the slice is done.

```bash
git log --oneline coding-agents-slice-a..HEAD
```

Confirm the commit list matches Tasks 1-9.

---

## Self-review notes

- Task 4 changes the public-ish type `RegisterCodingAgentDeps.env` from `() => …` to `(kind) => …`. Any external bootstrap supplying a custom `env` callback breaks. In-tree call sites are `packages/agents/src/bootstrap.ts` and tests; both updated. No other consumers exist (internal package).
- Task 6's verification step depends on `@openai/codex@latest` accepting the assumed argv. If verification fails, the spec needs amendment **before** Task 7's CLI tests can be written correctly. The plan's order (image bump _before_ CLI generalization) is intentional for this reason.
- Task 8 requires manually recording fixtures with real CLI keys. CI cannot regenerate them; if upstream JSONL formats change, a maintainer re-records.
- Task 9 uses `process.env.HOME` overrides in the cli-import test for codex's `findSessionPath` lookup. This is a targeted shim; safer than monkey-patching asp.

If the engineer hits ambiguity in any step, prefer the spec (`docs/superpowers/specs/2026-05-01-coding-agents-slice-c2-design.md`) as the source of truth and update this plan inline.

---

## Known runtime gap (deferred to follow-up slice)

**Symptom:** When an entity is created via PUT alone (no `initialMessage` in the request body), the agents-runtime fires a wake but its orchestrator skips invoking the handler with the log line:

```
[/coding-agent/<name>] skipping initial handler pass: no fresh wake input in catch-up; entering idle (5s timeout)
```

The wake-skip heuristic decides there's "nothing for the handler to do" because no `message_received` event accompanied the wake. But for the coding-agent (and any entity type whose first-wake init seeds `sessionMeta` from `ctx.args`), this means **spawn args never reach the handler**, so the entity silently runs with defaults on the first prompt that arrives later — `firstWake=false` is hard-set by then, the init block is gated on `!sessionMeta`, and the args window has closed.

**Workaround in this slice:** the import CLI POSTs a no-op `lifecycle/init` inbox message immediately after the PUT (see `packages/coding-agents/src/cli/import.ts`). The nudge gives the runtime "fresh wake input"; the handler runs first-wake init normally. This is a localised CLI-side mitigation; the underlying invariant — "first-wake of a fresh entity must invoke the handler regardless of input" — is still violated.

**The same gap affects the spawn dialog** when the user spawns without an initial prompt. The dialog already passes an optional `initialMessage` only if the user fills the prompt field; a blank-prompt spawn produces an entity that sits in limbo with un-applied args until the first user prompt — at which point the handler treats it as a non-first wake. The user's `sDINGv6fIv` agent appeared to work because a follow-up "ping" prompt happened to fire wake #1 with input; if the user had clicked Spawn and idled, args would have been dropped exactly like the CLI case.

**Recommended fix (follow-up slice):** narrow the runtime's wake-skip heuristic so the **very first wake** of a freshly-created entity always invokes the handler (e.g. gate on `epoch === 1 && firstWake === true` regardless of input event count). After first-wake, current input-gated semantics apply. Cost is one extra handler call per entity ever (negligible), no rehydrate-on-restart amplification (rehydrates have `epoch > 1`).

**Alternatives considered, rejected:**

- Always invoke the handler on every wake regardless of input. Performance hit at startup (every persisted entity runs its full reconcile block on rehydrate), idempotency contract widens for every entity-type author, larger blast radius for a corner case.
- Sentinel flag passed through the runtime API. Requires both runtime change and handler change; redundant with the narrower "first-wake always invokes" rule.

**Follow-up tracking:** open issue / next slice should:

1. Tighten the runtime wake-skip rule.
2. Remove the `lifecycle/init` no-op message type from `coding-agents` (it becomes redundant once the runtime guarantees first-wake invocation).
3. Update the import CLI to drop the post-PUT nudge call.
4. Update the spawn dialog so blank-prompt spawns no longer rely on luck.
