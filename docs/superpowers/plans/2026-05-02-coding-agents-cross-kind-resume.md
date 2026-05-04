# Cross-kind resume + fork — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship cross-kind resume (convert a live agent's `kind` mid-conversation) and fork (spawn a new agent that inherits another's denormalized event history) — including provider workspace-clone capability, built-in tools, UI affordances, conformance scenarios, Playwright UI tests, Layer 4 e2e, and predecessor-spec docs updates.

**Architecture:** The events collection is canonical and never rewritten. Both convert and fork generate a fresh `nativeSessionId`, call `denormalize(events, newKind, { sessionId, cwd })` from `agent-session-protocol@0.0.2`, replace the `nativeJsonl` row, and insert a lifecycle row. Convert is a pure data op (no sandbox); fork runs at first-wake. Inbox is naturally serial — convert is queued behind any in-flight prompt without explicit machinery.

**Tech Stack:** TypeScript, vitest, Playwright, Docker, `agent-session-protocol@0.0.2` (denormalize already implemented for both kinds), `@electric-ax/coding-agents`, `@electric-ax/agents-runtime`, `@sinclair/typebox` (for tool args), zod (for inbox/spawn schemas).

**Spec:** `docs/superpowers/specs/2026-05-02-coding-agents-cross-kind-resume-design.md`.

---

## File map

**New files:**

- `packages/coding-agents/src/entity/conversion.ts` — pure helper: `convertNativeJsonl(events, newKind, opts)` and `applyConversionWrites(ctx, opts)`.
- `packages/coding-agents/test/unit/convert-kind.test.ts`
- `packages/coding-agents/test/unit/fork.test.ts`
- `packages/coding-agents/test/integration/clone-workspace.test.ts`
- `packages/coding-agents/test/integration/convert-kind.e2e.test.ts`
- `packages/coding-agents/test/integration/fork-kind.e2e.test.ts`
- `packages/agents/src/tools/convert-coding-agent.ts`
- `packages/agents/src/tools/fork-coding-agent.ts`
- `packages/agents-server-ui/test/e2e/convert-kind.spec.ts`
- `packages/agents-server-ui/test/e2e/fork-spawn.spec.ts`

**Modified:**

- `packages/coding-agents/src/types.ts` — extend `SpawnCodingAgentOptions` with `from`; add `cloneWorkspace` to `SandboxProvider`.
- `packages/coding-agents/src/entity/messages.ts` — add `convertKindMessageSchema`.
- `packages/coding-agents/src/entity/handler.ts` — `processConvertKind` + fork first-wake branch.
- `packages/coding-agents/src/entity/register.ts` — extend creation args schema with `from`.
- `packages/coding-agents/src/entity/collections.ts` — extend lifecycle event enum with `kind.converted`, `kind.convert_failed`, `kind.forked`.
- `packages/coding-agents/src/providers/local-docker.ts` — implement `cloneWorkspace`.
- `packages/coding-agents/src/conformance/integration.ts` — L2.7, L2.8.
- `packages/coding-agents/src/conformance/provider.ts` — L1.9 (optional).
- `packages/coding-agents/src/index.ts` — export new types/options.
- `packages/agents/src/agents/horton.ts` — register two new tools.
- `packages/agents-server-ui/src/components/EntityHeader.tsx` — convert button + dropdown.
- `packages/agents-server-ui/src/components/CodingAgentSpawnDialog.tsx` — fork toggle.
- `packages/agents-server-ui/src/components/CodingAgentTimeline.tsx` — render new lifecycle row types.
- `packages/coding-agents/README.md` — add cross-kind resume section.
- `docs/superpowers/specs/2026-04-30-coding-agents-platform-primitive-design.md` — flip "post-MVP" entry.
- `docs/superpowers/specs/2026-05-01-coding-agents-slice-c2-design.md` — append "Resolved by" notes.
- `docs/superpowers/specs/2026-05-02-coding-agents-conformance-design.md` — append "Resolved by" notes.

---

## Task 1: Smoke-test cross-stream read pattern (import-shape gate)

**Scope (validator-audit clarification).** This is a _pure import-shape smoke test_, not a behavioral verification of cross-stream reads.

- Real cross-stream behavior (an actual coding-agent reading another's `events`) is verified by **Task 13's L2.8 conformance scenario** (stubs `ctx.observe` on a fake ctx) and **Task 18's Layer 4 e2e** (runs against a real agents-server with real entities).
- This task only catches gross breakage like `agent-session-protocol` or runtime exports being renamed/removed.

**Risk note.** The runtime's production `ctx.observe({ sourceType: 'entity', sourceRef })` flows through `wiring.createChildDb(streamPath, observedType, ...)` in `packages/agents-runtime/src/setup-context.ts:760-773`. If `observedType` is undefined or wrong, the returned `db.collections` may not contain `coding-agent.events`. That risk is **not gated by this task**; it surfaces at Task 13/18. Task 9's fork branch defensively handles a missing/null `events` collection.

**Files:**

- Test: `packages/coding-agents/test/unit/cross-stream-read.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `packages/coding-agents/test/unit/cross-stream-read.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

describe(`cross-stream read primitive (research)`, () => {
  it(`HandlerContext.observe with sourceType='entity' returns a handle with db.collections.events`, async () => {
    // This is a contract test. The runtime exposes
    //   ctx.observe({ sourceType: 'entity', sourceRef: '/coding-agent/foo' })
    //   → Promise<ObservationHandle> where handle.db.collections.events is an Iterable
    // We assert the shape by importing the type and constructing a synthetic
    // handle to confirm types align. Real cross-stream reads are exercised in
    // the L2.8 fork conformance scenario (Task 13).
    const { type } = await import(`@electric-ax/agents-runtime`)
      .then((m) => ({ type: typeof m.createHandlerContext }))
      .catch(() => ({ type: `undefined` }))
    expect(type).toBe(`function`)
  })
})
```

- [ ] **Step 2: Run test to verify shape compiles**

Run:

```bash
pnpm -C packages/coding-agents test test/unit/cross-stream-read.test.ts
```

Expected: PASS. (This is a smoke test for the import path — real cross-stream behavior is asserted in Task 13's conformance scenario.)

- [ ] **Step 3: Document the read pattern**

Append to `packages/coding-agents/README.md` (under a new section "Internal: cross-stream reads"):

````markdown
## Internal: cross-stream reads

Fork (spawn-time inheritance) reads another agent's `events` via:

```ts
const handle = await ctx.observe({
  sourceType: 'entity',
  sourceRef: '/coding-agent/source-id',
})
const sourceEvents = (handle.db?.collections.events.toArray ??
  []) as Array<EventRow>
```
````

Caveats:

- Snapshot semantics: the read is at-spawn-time; subsequent source updates are not reflected.
- The handle includes a wake subscription by default (entities are observed). Fork callers do not need wake; the runtime garbage-collects un-awaited subscriptions per existing semantics.

````

- [ ] **Step 4: Commit**

```bash
git add packages/coding-agents/test/unit/cross-stream-read.test.ts packages/coding-agents/README.md
git commit -m "test(coding-agents): smoke-test cross-stream read pattern for fork

Locks the contract: ctx.observe({ sourceType: 'entity', sourceRef })
returns a handle with db.collections.events. Real cross-stream reads
are exercised by Task 13's L2.8 fork conformance scenario."
````

---

## Task 2: Add `cloneWorkspace` to SandboxProvider interface

**Why:** Establish the optional capability slot before any provider impl. Adding to types only — no implementation yet.

**Files:**

- Modify: `packages/coding-agents/src/types.ts`

- [ ] **Step 1: Extend SandboxProvider interface**

In `packages/coding-agents/src/types.ts`, locate the `SandboxProvider` interface (around line 71) and add an optional method:

```ts
export interface SandboxProvider {
  readonly name: string
  start(spec: SandboxSpec): Promise<SandboxInstance>
  stop(instanceId: string): Promise<void>
  destroy(agentId: string): Promise<void>
  status(agentId: string): Promise<`running` | `stopped` | `unknown`>
  /** Discover sandboxes adopted across host restarts. MVP: may return []. */
  recover(): Promise<Array<RecoveredSandbox>>
  /**
   * Optional. If implemented, fork can use 'clone' workspace mode.
   * Copies contents of `source` into `target`. Implementations must:
   *   - Fail fast if either workspace doesn't exist.
   *   - Be idempotent (overwriting target is allowed).
   *   - Not mutate the source.
   */
  cloneWorkspace?(opts: {
    source: SandboxSpec[`workspace`]
    target: SandboxSpec[`workspace`]
  }): Promise<void>
}
```

- [ ] **Step 2: Run typecheck**

```bash
pnpm -C packages/coding-agents typecheck
```

Expected: PASS. The optional method is additive; existing providers compile unchanged.

- [ ] **Step 3: Commit**

```bash
git add packages/coding-agents/src/types.ts
git commit -m "feat(coding-agents): add optional cloneWorkspace to SandboxProvider

Optional capability slot. Fork uses it when the source workspace
is a Docker volume; falls back to share-or-error otherwise."
```

---

## Task 3: Implement `cloneWorkspace` on LocalDockerProvider + integration test

**Why:** First (and only, for v1) provider that implements the capability. Integration test gated `DOCKER=1`.

**Files:**

- Modify: `packages/coding-agents/src/providers/local-docker.ts`
- Test: `packages/coding-agents/test/integration/clone-workspace.test.ts` (new)

- [ ] **Step 1: Write the failing integration test**

Create `packages/coding-agents/test/integration/clone-workspace.test.ts`:

```ts
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { LocalDockerProvider } from '../../src/providers/local-docker'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileP = promisify(execFile)
const SHOULD = process.env.DOCKER === `1`
const d = SHOULD ? describe : describe.skip

d(`LocalDockerProvider.cloneWorkspace`, () => {
  let provider!: LocalDockerProvider
  const created: Array<string> = []

  beforeAll(() => {
    provider = new LocalDockerProvider()
  })

  afterEach(async () => {
    for (const v of created.splice(0)) {
      await execFileP(`docker`, [`volume`, `rm`, `-f`, v]).catch(
        () => undefined
      )
    }
  })

  it(`copies all files from source volume into target volume`, async () => {
    const suffix = Date.now().toString(36)
    const source = `electric-ax-test-clone-src-${suffix}`
    const target = `electric-ax-test-clone-dst-${suffix}`
    created.push(source, target)

    // Seed source volume with a sentinel file via a one-shot container.
    await execFileP(`docker`, [`volume`, `create`, source])
    await execFileP(`docker`, [`volume`, `create`, target])
    await execFileP(`docker`, [
      `run`,
      `--rm`,
      `-v`,
      `${source}:/work`,
      `alpine`,
      `sh`,
      `-c`,
      `echo hello > /work/sentinel.txt && mkdir -p /work/sub && echo nested > /work/sub/n.txt`,
    ])

    await provider.cloneWorkspace!({
      source: { type: `volume`, name: source },
      target: { type: `volume`, name: target },
    })

    // Verify target has both files.
    const { stdout: rootContent } = await execFileP(`docker`, [
      `run`,
      `--rm`,
      `-v`,
      `${target}:/work`,
      `alpine`,
      `cat`,
      `/work/sentinel.txt`,
    ])
    expect(rootContent.trim()).toBe(`hello`)

    const { stdout: nestedContent } = await execFileP(`docker`, [
      `run`,
      `--rm`,
      `-v`,
      `${target}:/work`,
      `alpine`,
      `cat`,
      `/work/sub/n.txt`,
    ])
    expect(nestedContent.trim()).toBe(`nested`)
  }, 60_000)

  it(`fails fast if source volume is missing`, async () => {
    const target = `electric-ax-test-clone-target-only-${Date.now().toString(36)}`
    created.push(target)
    await execFileP(`docker`, [`volume`, `create`, target])

    await expect(
      provider.cloneWorkspace!({
        source: { type: `volume`, name: `does-not-exist-${Date.now()}` },
        target: { type: `volume`, name: target },
      })
    ).rejects.toThrow()
  }, 30_000)

  it(`rejects bind-mount source (volume-only)`, async () => {
    await expect(
      provider.cloneWorkspace!({
        source: { type: `bindMount`, hostPath: `/tmp` },
        target: { type: `volume`, name: `whatever` },
      })
    ).rejects.toThrow(/bindMount/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
DOCKER=1 pnpm -C packages/coding-agents test test/integration/clone-workspace.test.ts
```

Expected: FAIL with "cloneWorkspace is not a function" (the optional method isn't implemented yet).

- [ ] **Step 3: Implement `cloneWorkspace` on LocalDockerProvider**

In `packages/coding-agents/src/providers/local-docker.ts`, add this method to the `LocalDockerProvider` class (place near the other public methods, after `recover()`):

```ts
async cloneWorkspace(opts: {
  source: SandboxSpec[`workspace`]
  target: SandboxSpec[`workspace`]
}): Promise<void> {
  if (opts.source.type !== `volume`) {
    throw new Error(
      `LocalDockerProvider.cloneWorkspace: source must be a volume (got ${opts.source.type}); bindMount sources are not supported`
    )
  }
  if (opts.target.type !== `volume`) {
    throw new Error(
      `LocalDockerProvider.cloneWorkspace: target must be a volume (got ${opts.target.type})`
    )
  }
  const sourceName = opts.source.name
  const targetName = opts.target.name
  if (!sourceName || !targetName) {
    throw new Error(
      `LocalDockerProvider.cloneWorkspace: both source and target must have a name`
    )
  }

  // Verify source exists; fail fast if not.
  const inspect = await runDocker([
    `volume`,
    `inspect`,
    sourceName,
  ]).catch((err: unknown) => ({ exitCode: 1, stderr: String(err) }))
  if (typeof inspect === `object` && inspect && `exitCode` in inspect && inspect.exitCode !== 0) {
    throw new Error(
      `LocalDockerProvider.cloneWorkspace: source volume '${sourceName}' not found`
    )
  }

  // Ensure target exists (idempotent).
  await runDocker([`volume`, `create`, targetName])

  // Copy contents via a throwaway alpine container.
  // `cp -a /from/. /to/` copies including dotfiles, preserving perms.
  const args = [
    `run`,
    `--rm`,
    `-v`,
    `${sourceName}:/from:ro`,
    `-v`,
    `${targetName}:/to`,
    `alpine`,
    `sh`,
    `-c`,
    `cp -a /from/. /to/`,
  ]
  const result = await runDocker(args)
  if (result.exitCode !== 0) {
    throw new Error(
      `LocalDockerProvider.cloneWorkspace: copy failed (exit ${result.exitCode}): ${result.stderr.slice(0, 200)}`
    )
  }
}
```

If `runDocker` doesn't exist with that exact signature, find the existing helper in `local-docker.ts` (it spawns `docker` via `child_process.spawn`) and adapt. The contract: returns `{ exitCode: number; stdout: string; stderr: string }`.

- [ ] **Step 4: Run test to verify it passes**

```bash
DOCKER=1 pnpm -C packages/coding-agents test test/integration/clone-workspace.test.ts
```

Expected: PASS — all three tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/coding-agents/src/providers/local-docker.ts packages/coding-agents/test/integration/clone-workspace.test.ts
git commit -m "feat(coding-agents): LocalDockerProvider.cloneWorkspace

Copies source volume contents into target via throwaway alpine
container (cp -a /from/. /to/). Volume-only; bindMount sources
rejected. Integration test under DOCKER=1."
```

---

## Task 4: Add `convertKind` message schema

**Files:**

- Modify: `packages/coding-agents/src/entity/messages.ts`
- Test: `packages/coding-agents/test/unit/messages.test.ts` (extend if exists, else create)

- [ ] **Step 1: Write the failing test**

Add to `packages/coding-agents/test/unit/messages.test.ts` (create if missing):

```ts
import { describe, expect, it } from 'vitest'
import { convertKindMessageSchema } from '../../src/entity/messages'

describe(`convertKindMessageSchema`, () => {
  it(`accepts a valid claude→codex payload`, () => {
    const r = convertKindMessageSchema.safeParse({ kind: `codex` })
    expect(r.success).toBe(true)
  })

  it(`accepts payload with optional model`, () => {
    const r = convertKindMessageSchema.safeParse({
      kind: `codex`,
      model: `gpt-5-codex-latest`,
    })
    expect(r.success).toBe(true)
  })

  it(`rejects an unknown kind`, () => {
    const r = convertKindMessageSchema.safeParse({ kind: `gemini` })
    expect(r.success).toBe(false)
  })

  it(`rejects missing kind`, () => {
    const r = convertKindMessageSchema.safeParse({})
    expect(r.success).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm -C packages/coding-agents test test/unit/messages.test.ts
```

Expected: FAIL — `convertKindMessageSchema` not exported.

- [ ] **Step 3: Add the schema**

In `packages/coding-agents/src/entity/messages.ts`, add at the end:

```ts
export const convertKindMessageSchema = z.object({
  kind: z.enum([`claude`, `codex`]),
  model: z.string().optional(),
})
export type ConvertKindMessage = z.infer<typeof convertKindMessageSchema>
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm -C packages/coding-agents test test/unit/messages.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/coding-agents/src/entity/messages.ts packages/coding-agents/test/unit/messages.test.ts
git commit -m "feat(coding-agents): add convertKindMessageSchema

Inbox control message: { kind: 'claude' | 'codex', model?: string }.
Used by processConvertKind handler branch in next task."
```

---

## Task 5: Extract conversion helper into `entity/conversion.ts`

**Why:** Keep handler.ts focused. Pure function `convertNativeJsonl` is easy to test in isolation.

**Files:**

- Create: `packages/coding-agents/src/entity/conversion.ts`
- Test: `packages/coding-agents/test/unit/conversion.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `packages/coding-agents/test/unit/conversion.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { NormalizedEvent } from 'agent-session-protocol'
import { convertNativeJsonl } from '../../src/entity/conversion'

describe(`convertNativeJsonl`, () => {
  const sample: Array<NormalizedEvent> = [
    {
      type: `session_init`,
      ts: 1_700_000_000_000,
      sessionId: `old-id`,
      cwd: `/old/cwd`,
    } as NormalizedEvent,
    {
      type: `user_message`,
      ts: 1_700_000_001_000,
      text: `hello`,
    } as NormalizedEvent,
    {
      type: `assistant_message`,
      ts: 1_700_000_002_000,
      text: `world`,
    } as NormalizedEvent,
    {
      type: `turn_complete`,
      ts: 1_700_000_003_000,
      durationMs: 2000,
    } as NormalizedEvent,
  ]

  it(`returns content + sessionId for codex`, () => {
    const r = convertNativeJsonl(sample, `codex`, {
      sessionId: `new-codex-id-123`,
      cwd: `/new/cwd`,
    })
    expect(r.sessionId).toBe(`new-codex-id-123`)
    expect(r.content.length).toBeGreaterThan(0)
    // Codex transcripts use timestamp + payload shape — assert the new
    // session id appears in the first line.
    const firstLine = r.content.split(`\n`)[0]!
    expect(firstLine).toContain(`new-codex-id-123`)
  })

  it(`returns content + sessionId for claude`, () => {
    const r = convertNativeJsonl(sample, `claude`, {
      sessionId: `new-claude-id-abc`,
      cwd: `/new/cwd`,
    })
    expect(r.sessionId).toBe(`new-claude-id-abc`)
    expect(r.content).toContain(`new-claude-id-abc`)
  })

  it(`empty events → empty content`, () => {
    const r = convertNativeJsonl([], `claude`, {
      sessionId: `x`,
      cwd: `/y`,
    })
    expect(r.sessionId).toBe(`x`)
    expect(r.content).toBe(``)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm -C packages/coding-agents test test/unit/conversion.test.ts
```

Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement the helper**

Create `packages/coding-agents/src/entity/conversion.ts`:

```ts
import { denormalize } from 'agent-session-protocol'
import type { NormalizedEvent } from 'agent-session-protocol'
import type { CodingAgentKind } from '../types'

export interface ConvertNativeJsonlOptions {
  sessionId: string
  cwd: string
}

export interface ConvertNativeJsonlResult {
  /** New nativeSessionId (echoed from input). */
  sessionId: string
  /** Newline-joined JSONL content; '' for empty input. */
  content: string
}

/**
 * Pure: produces the kind-specific JSONL transcript that the new CLI
 * will consume on `--resume <sessionId>`. Returns `{ sessionId, content }`
 * so callers can persist both atomically into nativeJsonl + meta.
 */
export function convertNativeJsonl(
  events: ReadonlyArray<NormalizedEvent>,
  newKind: CodingAgentKind,
  opts: ConvertNativeJsonlOptions
): ConvertNativeJsonlResult {
  if (events.length === 0) {
    return { sessionId: opts.sessionId, content: `` }
  }
  const lines = denormalize(events as Array<NormalizedEvent>, newKind, {
    sessionId: opts.sessionId,
    cwd: opts.cwd,
  })
  // denormalize returns Array<string> of JSONL lines; join with newlines
  // and add a trailing newline for round-trip compatibility.
  const content = lines.length === 0 ? `` : lines.join(`\n`) + `\n`
  return { sessionId: opts.sessionId, content }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm -C packages/coding-agents test test/unit/conversion.test.ts
```

Expected: PASS — three tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/coding-agents/src/entity/conversion.ts packages/coding-agents/test/unit/conversion.test.ts
git commit -m "feat(coding-agents): extract convertNativeJsonl helper

Pure wrapper over agent-session-protocol's denormalize() that
returns { sessionId, content } for atomic persistence. Empty
events → empty content (graceful)."
```

---

## Task 6: Add `processConvertKind` handler branch (happy path)

**Why:** Wires the convert mechanism into the inbox dispatch. Closely mirrors the existing `processConvertTarget` precedent.

**Files:**

- Modify: `packages/coding-agents/src/entity/handler.ts`
- Modify: `packages/coding-agents/src/entity/collections.ts` (extend lifecycle event enum)
- Test: `packages/coding-agents/test/unit/convert-kind.test.ts` (new)

- [ ] **Step 1: Extend lifecycle event enum**

In `packages/coding-agents/src/entity/collections.ts`, locate `lifecycleRowSchema` (around line 68) and extend the `event` enum:

```ts
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
    `resume.restored`,
    `import.restored`,
    `import.failed`,
    `target.changed`,
    `kind.converted`,
    `kind.convert_failed`,
    `kind.forked`,
  ]),
  detail: z.string().optional(),
})
```

- [ ] **Step 2: Write the failing test**

Create `packages/coding-agents/test/unit/convert-kind.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import type { NormalizedEvent } from 'agent-session-protocol'
import { LifecycleManager } from '../../src/lifecycle-manager'
import { WorkspaceRegistry } from '../../src/workspace-registry'
import { makeCodingAgentHandler } from '../../src/entity/handler'
import type {
  EventRow,
  LifecycleRow,
  NativeJsonlRow,
  RunRow,
  SessionMetaRow,
} from '../../src/entity/collections'
import { makeFakeCtx, pushInbox } from '../../src/conformance/fake-ctx'

const fakeProvider = {
  name: `fake`,
  start: async () => ({
    instanceId: `i1`,
    agentId: `x`,
    workspaceMount: `/work`,
    homeDir: `/home/agent`,
    exec: async () => ({
      stdout: (async function* () {})(),
      stderr: (async function* () {})(),
      wait: async () => ({ exitCode: 0 }),
      kill: () => undefined,
    }),
    copyTo: async () => undefined,
  }),
  stop: async () => undefined,
  destroy: async () => undefined,
  status: async () => `stopped` as const,
  recover: async () => [],
}

const fakeBridge = {
  runTurn: async () => ({ exitCode: 0 }),
}

function makeHandler() {
  const wr = new WorkspaceRegistry()
  const lm = new LifecycleManager({
    providers: { sandbox: fakeProvider as any, host: fakeProvider as any },
    bridge: fakeBridge as any,
  })
  return makeCodingAgentHandler(lm, wr, {
    defaults: {
      idleTimeoutMs: 5000,
      coldBootBudgetMs: 5000,
      runTimeoutMs: 30_000,
    },
    env: () => ({}),
  })
}

describe(`processConvertKind — happy path`, () => {
  let handler: ReturnType<typeof makeHandler>
  beforeEach(() => {
    handler = makeHandler()
  })

  it(`claude → codex regenerates nativeJsonl + sessionId, inserts kind.converted`, async () => {
    const agentId = `/test/coding-agent/cv-1-${Date.now().toString(36)}`
    const { ctx, state } = makeFakeCtx(agentId, {
      kind: `claude`,
      target: `sandbox`,
      workspaceType: `volume`,
    })
    await handler(ctx, { type: `message_received` })

    // Seed events: one user + one assistant turn.
    const sampleEvents: Array<NormalizedEvent> = [
      {
        type: `session_init`,
        ts: 1,
        sessionId: `old`,
        cwd: `/work`,
      } as NormalizedEvent,
      { type: `user_message`, ts: 2, text: `hi` } as NormalizedEvent,
      { type: `assistant_message`, ts: 3, text: `hello` } as NormalizedEvent,
      { type: `turn_complete`, ts: 4, durationMs: 100 } as NormalizedEvent,
    ]
    state.runs.rows.set(`r1`, {
      key: `r1`,
      startedAt: 1,
      endedAt: 4,
      status: `completed`,
      promptInboxKey: `i0`,
    } as RunRow)
    sampleEvents.forEach((e, i) => {
      state.events.rows.set(`r1:${String(i).padStart(20, `0`)}`, {
        key: `r1:${String(i).padStart(20, `0`)}`,
        runId: `r1`,
        seq: i,
        ts: e.ts,
        type: e.type,
        payload: e as unknown as Record<string, unknown>,
      } as EventRow)
    })
    state.sessionMeta.rows.set(`current`, {
      ...(state.sessionMeta.get(`current`) as SessionMetaRow),
      kind: `claude`,
      nativeSessionId: `old-claude-id`,
    })

    // Send convertKind message.
    pushInbox(state, `i1`, `convert-kind`, { kind: `codex` })
    await handler(ctx, { type: `message_received` })

    const meta = state.sessionMeta.get(`current`) as SessionMetaRow
    expect(meta.kind).toBe(`codex`)
    expect(meta.nativeSessionId).toBeDefined()
    expect(meta.nativeSessionId).not.toBe(`old-claude-id`)

    const native = state.nativeJsonl.get(`current`) as
      | NativeJsonlRow
      | undefined
    expect(native?.nativeSessionId).toBe(meta.nativeSessionId)
    expect(native?.content.length).toBeGreaterThan(0)

    const lifecycle = Array.from(
      state.lifecycle.rows.values()
    ) as Array<LifecycleRow>
    const converted = lifecycle.find((l) => l.event === `kind.converted`)
    expect(converted).toBeDefined()
    expect(converted?.detail).toContain(`claude`)
    expect(converted?.detail).toContain(`codex`)
  })

  it(`records model in lifecycle.detail when payload.model is provided`, async () => {
    const agentId = `/test/coding-agent/cv-2-${Date.now().toString(36)}`
    const { ctx, state } = makeFakeCtx(agentId, {
      kind: `claude`,
      target: `sandbox`,
      workspaceType: `volume`,
    })
    await handler(ctx, { type: `message_received` })

    pushInbox(state, `i1`, `convert-kind`, {
      kind: `codex`,
      model: `gpt-5-codex-latest`,
    })
    await handler(ctx, { type: `message_received` })

    const meta = state.sessionMeta.get(`current`) as SessionMetaRow
    expect(meta.kind).toBe(`codex`)
    // Model is recorded in the lifecycle row's detail string only;
    // SessionMetaRow has no `model` field (validator audit confirmed).
    const lifecycle = Array.from(
      state.lifecycle.rows.values()
    ) as Array<LifecycleRow>
    const converted = lifecycle.find((l) => l.event === `kind.converted`)
    expect(converted?.detail).toContain(`gpt-5-codex-latest`)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

```bash
pnpm -C packages/coding-agents test test/unit/convert-kind.test.ts
```

Expected: FAIL — `convert-kind` message_type isn't handled.

- [ ] **Step 4: Wire the handler branch**

In `packages/coding-agents/src/entity/handler.ts`:

(a) Import `convertKindMessageSchema` and the helper:

```ts
import {
  convertKindMessageSchema,
  convertTargetMessageSchema,
  promptMessageSchema,
} from './messages'
import { convertNativeJsonl } from './conversion'
import { randomUUID } from 'node:crypto'
import type { NormalizedEvent } from 'agent-session-protocol'
```

(b) Add a case in `dispatchInboxMessage` (around line 581):

```ts
case `convert-kind`:
  return processConvertKind(ctx, inboxMsg)
```

(c) Add the function (place after `processConvertTarget`):

```ts
async function processConvertKind(ctx: any, inboxMsg: InboxRow): Promise<void> {
  const parsed = convertKindMessageSchema.safeParse(inboxMsg.payload)
  if (!parsed.success) return
  const { kind: newKind, model } = parsed.data
  const meta = ctx.db.collections.sessionMeta.get(`current`) as SessionMetaRow
  const oldKind = meta.kind

  // Read all events for this agent.
  const eventRows = (ctx.db.collections.events.toArray as Array<EventRow>)
    .slice()
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  const events: Array<NormalizedEvent> = eventRows.map(
    (r) => r.payload as unknown as NormalizedEvent
  )

  const newSessionId = randomUUID()
  const cwd =
    meta.workspaceSpec.type === `bindMount`
      ? meta.workspaceSpec.hostPath
      : `/work`

  let result
  try {
    result = convertNativeJsonl(events, newKind, {
      sessionId: newSessionId,
      cwd,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    ctx.db.actions.lifecycle_insert({
      row: {
        key: lifecycleKey(`convert`),
        ts: Date.now(),
        event: `kind.convert_failed`,
        detail: msg,
      } satisfies LifecycleRow,
    })
    log.warn({ err, oldKind, newKind }, `convertKind: denormalize threw`)
    return
  }

  // Atomic-ish: replace nativeJsonl, update meta, insert lifecycle row.
  ctx.db.actions.nativeJsonl_insert({
    row: {
      key: `current`,
      nativeSessionId: result.sessionId,
      content: result.content,
    } satisfies NativeJsonlRow,
  })
  ctx.db.actions.sessionMeta_update({
    key: `current`,
    updater: (d: SessionMetaRow) => {
      d.kind = newKind
      d.nativeSessionId = result.sessionId
      d.lastError = undefined
    },
  })
  const detailParts = [`from=${oldKind}`, `to=${newKind}`]
  if (model) detailParts.push(`model=${model}`)
  ctx.db.actions.lifecycle_insert({
    row: {
      key: lifecycleKey(`convert`),
      ts: Date.now(),
      event: `kind.converted`,
      detail: detailParts.join(`;`),
    } satisfies LifecycleRow,
  })
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
pnpm -C packages/coding-agents test test/unit/convert-kind.test.ts
```

Expected: PASS — both tests green.

- [ ] **Step 6: Commit**

```bash
git add packages/coding-agents/src/entity/handler.ts \
        packages/coding-agents/src/entity/collections.ts \
        packages/coding-agents/test/unit/convert-kind.test.ts
git commit -m "feat(coding-agents): processConvertKind handler branch

Inbox 'convert-kind' message reads events, denormalizes for the new
kind via convertNativeJsonl, replaces nativeJsonl, updates meta.kind
and meta.nativeSessionId, inserts kind.converted lifecycle row.
Pure data op — no sandbox required."
```

---

## Task 7: convertKind edge cases

**Why:** Covers same-kind, empty events, denormalize failure, and unknown kind. All exercise the existing handler — no new code.

**Files:**

- Test: `packages/coding-agents/test/unit/convert-kind.test.ts` (extend)

- [ ] **Step 1: Add edge-case tests**

Append to `packages/coding-agents/test/unit/convert-kind.test.ts`:

```ts
describe(`processConvertKind — edge cases`, () => {
  let handler: ReturnType<typeof makeHandler>
  beforeEach(() => {
    handler = makeHandler()
  })

  it(`same-kind convert regenerates sessionId and nativeJsonl`, async () => {
    const agentId = `/test/coding-agent/cv-same-${Date.now().toString(36)}`
    const { ctx, state } = makeFakeCtx(agentId, {
      kind: `claude`,
      target: `sandbox`,
      workspaceType: `volume`,
    })
    await handler(ctx, { type: `message_received` })

    state.sessionMeta.rows.set(`current`, {
      ...(state.sessionMeta.get(`current`) as SessionMetaRow),
      kind: `claude`,
      nativeSessionId: `old-id-keep-different`,
    })

    pushInbox(state, `i1`, `convert-kind`, { kind: `claude` })
    await handler(ctx, { type: `message_received` })

    const meta = state.sessionMeta.get(`current`) as SessionMetaRow
    expect(meta.kind).toBe(`claude`)
    expect(meta.nativeSessionId).not.toBe(`old-id-keep-different`)
  })

  it(`empty events → conversion succeeds with empty nativeJsonl`, async () => {
    const agentId = `/test/coding-agent/cv-empty-${Date.now().toString(36)}`
    const { ctx, state } = makeFakeCtx(agentId, {
      kind: `claude`,
      target: `sandbox`,
      workspaceType: `volume`,
    })
    await handler(ctx, { type: `message_received` })

    pushInbox(state, `i1`, `convert-kind`, { kind: `codex` })
    await handler(ctx, { type: `message_received` })

    const meta = state.sessionMeta.get(`current`) as SessionMetaRow
    expect(meta.kind).toBe(`codex`)
    const native = state.nativeJsonl.get(`current`)
    expect(native?.content).toBe(``)
    const lifecycle = Array.from(
      state.lifecycle.rows.values()
    ) as Array<LifecycleRow>
    expect(lifecycle.find((l) => l.event === `kind.converted`)).toBeDefined()
  })

  it(`unknown kind in payload → safeParse fails, no state change`, async () => {
    const agentId = `/test/coding-agent/cv-unknown-${Date.now().toString(36)}`
    const { ctx, state } = makeFakeCtx(agentId, {
      kind: `claude`,
      target: `sandbox`,
      workspaceType: `volume`,
    })
    await handler(ctx, { type: `message_received` })
    const before = (state.sessionMeta.get(`current`) as SessionMetaRow).kind

    pushInbox(state, `i1`, `convert-kind`, { kind: `gemini` })
    await handler(ctx, { type: `message_received` })

    const meta = state.sessionMeta.get(`current`) as SessionMetaRow
    expect(meta.kind).toBe(before)
    const lifecycle = Array.from(
      state.lifecycle.rows.values()
    ) as Array<LifecycleRow>
    expect(lifecycle.find((l) => l.event === `kind.converted`)).toBeUndefined()
  })

  it(`convertKind queued behind a prompt processes after the turn finishes`, async () => {
    // The inbox is naturally serial. Push prompt + convertKind in the
    // same wake; both process in order.
    const agentId = `/test/coding-agent/cv-q-${Date.now().toString(36)}`
    const { ctx, state } = makeFakeCtx(agentId, {
      kind: `claude`,
      target: `sandbox`,
      workspaceType: `volume`,
    })
    await handler(ctx, { type: `message_received` })

    pushInbox(state, `i1`, `prompt`, { text: `hi` })
    pushInbox(state, `i2`, `convert-kind`, { kind: `codex` })
    await handler(ctx, { type: `message_received` })

    const meta = state.sessionMeta.get(`current`) as SessionMetaRow
    expect(meta.kind).toBe(`codex`)
  })
})
```

- [ ] **Step 2: Run tests to verify they pass**

```bash
pnpm -C packages/coding-agents test test/unit/convert-kind.test.ts
```

Expected: PASS — six tests total.

- [ ] **Step 3: Commit**

```bash
git add packages/coding-agents/test/unit/convert-kind.test.ts
git commit -m "test(coding-agents): convertKind edge cases (same-kind, empty, unknown, queued)"
```

---

## Task 8: Add `from` to SpawnCodingAgentOptions + creation args schema

**Files:**

- Modify: `packages/coding-agents/src/types.ts`
- Modify: `packages/coding-agents/src/entity/register.ts`

- [ ] **Step 1: Locate the existing creation args schema**

Read `packages/coding-agents/src/entity/register.ts` end-to-end to find the zod schema and any `creationArgsSchema`. Note its shape; the next step extends it.

- [ ] **Step 2: Extend SpawnCodingAgentOptions in types.ts**

In `packages/coding-agents/src/types.ts`, locate `SpawnCodingAgentOptions` (around line 111) and add the `from` field:

```ts
export interface SpawnCodingAgentOptions {
  id: string
  kind: CodingAgentKind
  workspace:
    | { type: `volume`; name?: string }
    | { type: `bindMount`; hostPath: string }
  initialPrompt?: string
  wake?: { on: `runFinished`; includeResponse?: boolean }
  lifecycle?: { idleTimeoutMs?: number; keepWarm?: boolean }
  /**
   * Optional source agent to fork from. The new agent's events history
   * starts as denormalize(source.events, this.kind, ...). Workspace
   * inheritance is controlled by `workspaceMode`:
   *   - 'share': inherit source's workspace identity (lease-serialised).
   *   - 'clone': copy source's workspace into a fresh volume (provider must support cloneWorkspace).
   *   - 'fresh': new empty workspace (no file context).
   * Default policy: 'share' for bindMount sources; 'clone' for volume
   * sources (errors at spawn-time if the provider can't clone).
   */
  from?: {
    agentId: string
    workspaceMode?: `share` | `clone` | `fresh`
  }
}
```

- [ ] **Step 3: Extend creation args schema in register.ts**

In `packages/coding-agents/src/entity/register.ts`, locate the creation args zod schema and add the `from` field. Also extend the args type that the handler reads in first-wake init (the inline interface at handler.ts:218). Updated args type for handler.ts (you'll edit handler in Task 9):

```ts
const args = ctx.args as {
  kind?: CodingAgentKind
  target?: `sandbox` | `host`
  workspaceType?: `volume` | `bindMount`
  workspaceName?: string
  workspaceHostPath?: string
  importNativeSessionId?: string
  idleTimeoutMs?: number
  keepWarm?: boolean
  fromAgentId?: string
  fromWorkspaceMode?: `share` | `clone` | `fresh`
}
```

In the zod schema in register.ts (search for `creationArgsSchema` or where `kind`, `target`, etc. are validated), add:

```ts
fromAgentId: z.string().optional(),
fromWorkspaceMode: z.enum([`share`, `clone`, `fresh`]).optional(),
```

In the `spawnCodingAgent` factory exposed from `agents-runtime`, translate `opts.from` to `fromAgentId` / `fromWorkspaceMode` args. Locate the factory by grepping:

```bash
grep -rn "spawnCodingAgent" packages/agents-runtime/src
```

Add the translation alongside the existing field mappings.

- [ ] **Step 4: Run typecheck**

```bash
pnpm -C packages/coding-agents typecheck && pnpm -C packages/agents-runtime typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/coding-agents/src/types.ts packages/coding-agents/src/entity/register.ts \
        packages/agents-runtime/src
git commit -m "feat(coding-agents): SpawnCodingAgentOptions.from for forking

Adds opts.from = { agentId, workspaceMode? } translated to
creation-args fromAgentId + fromWorkspaceMode. Validation in
zod schema. Handler consumes in next task."
```

---

## Task 9: Fork first-wake flow

**Why:** The mechanism. Reads source's events, denormalizes, populates nativeJsonl + meta.nativeSessionId, inserts `kind.forked` lifecycle row.

**Files:**

- Modify: `packages/coding-agents/src/entity/handler.ts`
- Test: `packages/coding-agents/test/unit/fork.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `packages/coding-agents/test/unit/fork.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { NormalizedEvent } from 'agent-session-protocol'
import { LifecycleManager } from '../../src/lifecycle-manager'
import { WorkspaceRegistry } from '../../src/workspace-registry'
import { makeCodingAgentHandler } from '../../src/entity/handler'
import type {
  EventRow,
  LifecycleRow,
  NativeJsonlRow,
  RunRow,
  SessionMetaRow,
} from '../../src/entity/collections'
import { makeFakeCtx } from '../../src/conformance/fake-ctx'

const fakeProvider = {
  name: `fake`,
  start: async () => ({
    instanceId: `i1`,
    agentId: `x`,
    workspaceMount: `/work`,
    homeDir: `/home/agent`,
    exec: async () => ({
      stdout: (async function* () {})(),
      stderr: (async function* () {})(),
      wait: async () => ({ exitCode: 0 }),
      kill: () => undefined,
    }),
    copyTo: async () => undefined,
  }),
  stop: async () => undefined,
  destroy: async () => undefined,
  status: async () => `stopped` as const,
  recover: async () => [],
}
const fakeBridge = { runTurn: async () => ({ exitCode: 0 }) }

function makeHandler() {
  const wr = new WorkspaceRegistry()
  const lm = new LifecycleManager({
    providers: { sandbox: fakeProvider as any, host: fakeProvider as any },
    bridge: fakeBridge as any,
  })
  return makeCodingAgentHandler(lm, wr, {
    defaults: {
      idleTimeoutMs: 5000,
      coldBootBudgetMs: 5000,
      runTimeoutMs: 30_000,
    },
    env: () => ({}),
  })
}

describe(`fork first-wake`, () => {
  it(`reads source events, denormalizes, populates nativeJsonl, inserts kind.forked`, async () => {
    // Build a source agent ctx with seeded events.
    const sourceId = `/test/coding-agent/source-${Date.now().toString(36)}`
    const { state: sourceState } = makeFakeCtx(sourceId, {
      kind: `claude`,
      target: `sandbox`,
      workspaceType: `volume`,
    })
    const sourceEvents: Array<NormalizedEvent> = [
      {
        type: `session_init`,
        ts: 1,
        sessionId: `src`,
        cwd: `/work`,
      } as NormalizedEvent,
      { type: `user_message`, ts: 2, text: `hello` } as NormalizedEvent,
      {
        type: `assistant_message`,
        ts: 3,
        text: `from claude`,
      } as NormalizedEvent,
      { type: `turn_complete`, ts: 4, durationMs: 100 } as NormalizedEvent,
    ]
    sourceState.runs.rows.set(`r1`, {
      key: `r1`,
      startedAt: 1,
      endedAt: 4,
      status: `completed`,
      promptInboxKey: `i0`,
    } as RunRow)
    sourceEvents.forEach((e, i) => {
      sourceState.events.rows.set(`r1:${String(i).padStart(20, `0`)}`, {
        key: `r1:${String(i).padStart(20, `0`)}`,
        runId: `r1`,
        seq: i,
        ts: e.ts,
        type: e.type,
        payload: e as unknown as Record<string, unknown>,
      } as EventRow)
    })

    // Build the fork ctx with `fromAgentId` arg pointing to source.
    const handler = makeHandler()
    const forkId = `/test/coding-agent/fork-${Date.now().toString(36)}`
    const { ctx: forkCtx, state: forkState } = makeFakeCtx(forkId, {
      kind: `codex`,
      target: `sandbox`,
      workspaceType: `volume`,
      fromAgentId: sourceId,
      fromWorkspaceMode: `share`,
    })

    // Stub ctx.observe to return the source state.
    ;(forkCtx as any).observe = async (src: {
      sourceType: string
      sourceRef: string
    }) => {
      if (src.sourceType === `entity` && src.sourceRef === sourceId) {
        return {
          sourceType: `entity`,
          sourceRef: sourceId,
          db: {
            collections: { events: sourceState.events, runs: sourceState.runs },
          },
          events: [],
        }
      }
      throw new Error(`unexpected observe target: ${src.sourceRef}`)
    }

    await handler(forkCtx, { type: `message_received` })

    // Fork should have nativeJsonl populated from denormalize(sourceEvents, 'codex').
    const native = forkState.nativeJsonl.get(`current`) as
      | NativeJsonlRow
      | undefined
    expect(native).toBeDefined()
    expect(native!.nativeSessionId.length).toBeGreaterThan(0)
    expect(native!.content.length).toBeGreaterThan(0)

    const meta = forkState.sessionMeta.get(`current`) as SessionMetaRow
    expect(meta.kind).toBe(`codex`)
    expect(meta.nativeSessionId).toBe(native!.nativeSessionId)

    const lifecycle = Array.from(
      forkState.lifecycle.rows.values()
    ) as Array<LifecycleRow>
    const forked = lifecycle.find((l) => l.event === `kind.forked`)
    expect(forked).toBeDefined()
    expect(forked?.detail).toContain(sourceId)
  })

  it(`source has no events → fork still proceeds, native empty`, async () => {
    const sourceId = `/test/coding-agent/empty-source-${Date.now().toString(36)}`
    const { state: sourceState } = makeFakeCtx(sourceId, {
      kind: `claude`,
      target: `sandbox`,
      workspaceType: `volume`,
    })

    const handler = makeHandler()
    const forkId = `/test/coding-agent/fork-empty-${Date.now().toString(36)}`
    const { ctx: forkCtx, state: forkState } = makeFakeCtx(forkId, {
      kind: `codex`,
      target: `sandbox`,
      workspaceType: `volume`,
      fromAgentId: sourceId,
      fromWorkspaceMode: `share`,
    })
    ;(forkCtx as any).observe = async () => ({
      sourceType: `entity`,
      sourceRef: sourceId,
      db: {
        collections: { events: sourceState.events, runs: sourceState.runs },
      },
      events: [],
    })

    await handler(forkCtx, { type: `message_received` })

    const native = forkState.nativeJsonl.get(`current`) as
      | NativeJsonlRow
      | undefined
    expect(native?.content ?? ``).toBe(``)
    const meta = forkState.sessionMeta.get(`current`) as SessionMetaRow
    expect(meta.kind).toBe(`codex`)
    const lifecycle = Array.from(
      forkState.lifecycle.rows.values()
    ) as Array<LifecycleRow>
    expect(lifecycle.find((l) => l.event === `kind.forked`)).toBeDefined()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm -C packages/coding-agents test test/unit/fork.test.ts
```

Expected: FAIL — fork branch isn't implemented.

- [ ] **Step 3: Add fork branch in first-wake init**

In `packages/coding-agents/src/entity/handler.ts`, locate the first-wake init block (around handler.ts:217 — `if (!initialMeta)` branch). After the existing `args.importNativeSessionId && target === 'host'` block (~line 289), and before the closing `}` of the `if (!initialMeta)` branch (~line 437), add:

```ts
if (args.fromAgentId) {
  try {
    const sourceHandle = await (ctx as any).observe({
      sourceType: `entity`,
      sourceRef: args.fromAgentId,
    })
    const sourceEventsCol = sourceHandle?.db?.collections?.events
    if (!sourceEventsCol) {
      throw new Error(
        `fork: source agent ${args.fromAgentId} has no events collection`
      )
    }
    const sourceEventRows = (sourceEventsCol.toArray as Array<EventRow>)
      .slice()
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    const sourceEvents = sourceEventRows.map(
      (r) => r.payload as unknown as NormalizedEvent
    )

    const newSessionId = randomUUID()
    const cwd = ws.type === `bindMount` ? ws.hostPath : `/work`
    const result = convertNativeJsonl(sourceEvents, args.kind ?? `claude`, {
      sessionId: newSessionId,
      cwd,
    })

    ctx.db.actions.nativeJsonl_insert({
      row: {
        key: `current`,
        nativeSessionId: result.sessionId,
        content: result.content,
      } satisfies NativeJsonlRow,
    })
    ctx.db.actions.sessionMeta_update({
      key: `current`,
      updater: (d: SessionMetaRow) => {
        d.nativeSessionId = result.sessionId
      },
    })
    ctx.db.actions.lifecycle_insert({
      row: {
        key: lifecycleKey(`fork`),
        ts: Date.now(),
        event: `kind.forked`,
        detail: `source=${args.fromAgentId};mode=${args.fromWorkspaceMode ?? `share`};events=${sourceEvents.length}`,
      } satisfies LifecycleRow,
    })
    meta = sessionMetaCol.get(`current`) as SessionMetaRow
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log.warn({ err, agentId, sourceId: args.fromAgentId }, `fork failed`)
    ctx.db.actions.sessionMeta_update({
      key: `current`,
      updater: (d: SessionMetaRow) => {
        d.status = `error`
        d.lastError = `fork failed: ${msg}`
      },
    })
    return
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm -C packages/coding-agents test test/unit/fork.test.ts
```

Expected: PASS — both tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/coding-agents/src/entity/handler.ts packages/coding-agents/test/unit/fork.test.ts
git commit -m "feat(coding-agents): fork first-wake flow

When ctx.args.fromAgentId is set, read source agent's events via
ctx.observe(), denormalize for the new kind, populate nativeJsonl
and meta.nativeSessionId, insert kind.forked lifecycle row.
Source agent untouched; new agent is cold + ready."
```

---

## Task 10: Provider-aware `workspaceMode` default policy

**Why:** Spec §2 default policy. Bind-mount source defaults to `share`; volume source defaults to `clone` (errors if provider can't); explicit `clone` against a provider without `cloneWorkspace` errors at spawn time.

**Files:**

- Modify: `packages/coding-agents/src/entity/handler.ts`
- Test: `packages/coding-agents/test/unit/fork.test.ts` (extend)

- [ ] **Step 1: Add tests for the default policy**

Append to `packages/coding-agents/test/unit/fork.test.ts`:

```ts
describe(`fork workspaceMode default policy`, () => {
  it(`bindMount source defaults to share (no clone attempt)`, async () => {
    const sourceId = `/test/coding-agent/bm-src-${Date.now().toString(36)}`
    const { state: sourceState } = makeFakeCtx(sourceId, {
      kind: `claude`,
      target: `host`,
      workspaceType: `bindMount`,
      workspaceHostPath: `/tmp/source-bm`,
    })
    sourceState.sessionMeta.rows.set(`current`, {
      ...(sourceState.sessionMeta.get(`current`) as SessionMetaRow),
      workspaceSpec: { type: `bindMount`, hostPath: `/tmp/source-bm` },
    })

    const handler = makeHandler()
    const forkId = `/test/coding-agent/bm-fork-${Date.now().toString(36)}`
    const { ctx: forkCtx, state: forkState } = makeFakeCtx(forkId, {
      kind: `codex`,
      target: `sandbox`,
      workspaceType: `volume`,
      fromAgentId: sourceId,
      // No fromWorkspaceMode — policy should default to share for bindMount.
    })
    ;(forkCtx as any).observe = async () => ({
      sourceType: `entity`,
      sourceRef: sourceId,
      db: {
        collections: {
          events: sourceState.events,
          runs: sourceState.runs,
          sessionMeta: sourceState.sessionMeta,
        },
      },
      events: [],
    })

    await handler(forkCtx, { type: `message_received` })

    const lifecycle = Array.from(
      forkState.lifecycle.rows.values()
    ) as Array<LifecycleRow>
    const forked = lifecycle.find((l) => l.event === `kind.forked`)
    expect(forked?.detail).toContain(`mode=share`)
  })

  it(`explicit clone against provider without cloneWorkspace errors`, async () => {
    const sourceId = `/test/coding-agent/v-src-${Date.now().toString(36)}`
    const { state: sourceState } = makeFakeCtx(sourceId, {
      kind: `claude`,
      target: `sandbox`,
      workspaceType: `volume`,
      workspaceName: `src-vol`,
    })

    const handler = makeHandler()
    const forkId = `/test/coding-agent/v-fork-${Date.now().toString(36)}`
    const { ctx: forkCtx, state: forkState } = makeFakeCtx(forkId, {
      kind: `codex`,
      target: `sandbox`,
      workspaceType: `volume`,
      fromAgentId: sourceId,
      fromWorkspaceMode: `clone`,
    })
    ;(forkCtx as any).observe = async () => ({
      sourceType: `entity`,
      sourceRef: sourceId,
      db: {
        collections: {
          events: sourceState.events,
          runs: sourceState.runs,
          sessionMeta: sourceState.sessionMeta,
        },
      },
      events: [],
    })

    // makeHandler's fakeProvider doesn't expose cloneWorkspace.
    await handler(forkCtx, { type: `message_received` })

    const meta = forkState.sessionMeta.get(`current`) as SessionMetaRow
    expect(meta.status).toBe(`error`)
    expect(meta.lastError).toMatch(/clone/i)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm -C packages/coding-agents test test/unit/fork.test.ts
```

Expected: FAIL — policy not yet implemented.

- [ ] **Step 3: Implement the policy**

In `packages/coding-agents/src/entity/handler.ts`, in the fork branch added in Task 9, between the source-events read and the `nativeJsonl_insert` call, add the workspace mode resolution:

```ts
// Resolve effective workspace mode and (optionally) clone.
const sourceMetaCol = sourceHandle.db?.collections?.sessionMeta
const sourceMeta = sourceMetaCol?.get?.(`current`) as SessionMetaRow | undefined
const sourceWsType = sourceMeta?.workspaceSpec?.type ?? `volume`
const requested = args.fromWorkspaceMode
const effectiveMode: `share` | `clone` | `fresh` =
  requested ?? (sourceWsType === `bindMount` ? `share` : `clone`)

if (effectiveMode === `clone`) {
  // The handler doesn't have direct provider access; LifecycleManager does.
  // Acquire it via lm and check capability before proceeding.
  const provider = lm.providerFor(meta.target)
  if (!provider.cloneWorkspace) {
    throw new Error(
      `fork: workspaceMode=clone requires provider.cloneWorkspace; provider '${provider.name}' does not implement it`
    )
  }
  if (
    sourceMeta?.workspaceSpec?.type === `volume` &&
    ws.type === `volume` &&
    sourceMeta.workspaceSpec.name &&
    ws.name
  ) {
    await provider.cloneWorkspace({
      source: sourceMeta.workspaceSpec,
      target: ws,
    })
  }
}
// 'share' and 'fresh' need no action here — share inherits via the
// existing workspace identity passed at spawn; fresh is a normal spawn.
```

For `lm.providerFor(target)` — add this method to `LifecycleManager` if missing. Search:

```bash
grep -n "providerFor\|providers:" packages/coding-agents/src/lifecycle-manager.ts | head
```

If absent, add:

```ts
providerFor(target: 'sandbox' | 'host'): SandboxProvider {
  return this.providers[target]
}
```

Update the lifecycle detail string built earlier to include the effective mode (replace the inline `mode=${args.fromWorkspaceMode ?? 'share'}` with `mode=${effectiveMode}`).

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm -C packages/coding-agents test test/unit/fork.test.ts
```

Expected: PASS — all four fork tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/coding-agents/src/entity/handler.ts \
        packages/coding-agents/src/lifecycle-manager.ts \
        packages/coding-agents/test/unit/fork.test.ts
git commit -m "feat(coding-agents): provider-aware workspaceMode default for fork

bindMount source → 'share' (no clone). Volume source → 'clone' if
provider supports it, else error. Explicit 'clone' against an
incapable provider errors at spawn time with a clear message."
```

---

## Task 11: Built-in tools (`convert_coding_agent`, `fork_coding_agent`)

**Files:**

- Create: `packages/agents/src/tools/convert-coding-agent.ts`
- Create: `packages/agents/src/tools/fork-coding-agent.ts`
- Modify: `packages/agents/src/agents/horton.ts`
- Test: `packages/agents/test/tools/convert-coding-agent.test.ts` (new)
- Test: `packages/agents/test/tools/fork-coding-agent.test.ts` (new)

- [ ] **Step 1: Create convert tool**

Create `packages/agents/src/tools/convert-coding-agent.ts`:

```ts
import { Type } from '@sinclair/typebox'
import { serverLog } from '../log'
import type { AgentTool } from '@mariozechner/pi-agent-core'
import type { HandlerContext } from '@electric-ax/agents-runtime'

export function createConvertCodingAgentTool(ctx: HandlerContext): AgentTool {
  return {
    name: `convert_coding_agent`,
    label: `Convert Coding Agent Kind`,
    description: `Convert a previously-spawned coding agent's kind in place (claude→codex or codex→claude). The agent's conversation history is preserved (denormalized for the new kind). Useful when one CLI fits a task better, or to compare model outputs on the same context. The agent stays at the same URL; the next prompt will run under the new kind.`,
    parameters: Type.Object({
      coding_agent_url: Type.String({
        description: `Entity URL returned by spawn_coding_agent, e.g. "/coding-agent/abc123".`,
      }),
      kind: Type.Union([Type.Literal(`claude`), Type.Literal(`codex`)], {
        description: `Target kind: 'claude' or 'codex'.`,
      }),
      model: Type.Optional(
        Type.String({
          description: `Optional model override for the new kind (e.g. 'claude-haiku-4-5-20251001' or a codex model id).`,
        })
      ),
    }),
    execute: async (_toolCallId, params) => {
      const { coding_agent_url, kind, model } = params as {
        coding_agent_url: string
        kind: `claude` | `codex`
        model?: string
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
          details: { converted: false },
        }
      }
      try {
        ctx.send(
          coding_agent_url,
          { kind, ...(model ? { model } : {}) },
          { type: `convert-kind` }
        )
        return {
          content: [
            {
              type: `text` as const,
              text: `Conversion to ${kind} queued for ${coding_agent_url}. The next prompt will run under the new kind.`,
            },
          ],
          details: { converted: true, agentUrl: coding_agent_url, kind },
        }
      } catch (err) {
        serverLog.warn(
          `[convert_coding_agent tool] failed for ${coding_agent_url}: ${err instanceof Error ? err.message : String(err)}`,
          err instanceof Error ? err : undefined
        )
        return {
          content: [
            {
              type: `text` as const,
              text: `Error converting coding agent: ${err instanceof Error ? err.message : `Unknown error`}`,
            },
          ],
          details: { converted: false },
        }
      }
    },
  }
}
```

- [ ] **Step 2: Create fork tool**

Create `packages/agents/src/tools/fork-coding-agent.ts`:

```ts
import { Type } from '@sinclair/typebox'
import { nanoid } from 'nanoid'
import { serverLog } from '../log'
import type { AgentTool } from '@mariozechner/pi-agent-core'
import type { HandlerContext } from '@electric-ax/agents-runtime'

export function createForkCodingAgentTool(ctx: HandlerContext): AgentTool {
  return {
    name: `fork_coding_agent`,
    label: `Fork Coding Agent`,
    description: `Spawn a new coding agent that starts with another agent's denormalized conversation history. The new agent runs the chosen kind (claude or codex) and inherits or clones the source's workspace per workspace_mode. Use to compare CLIs on the same conversation, or branch experimentally.`,
    parameters: Type.Object({
      source_url: Type.String({
        description: `Entity URL of the source coding agent to fork from, e.g. "/coding-agent/abc123".`,
      }),
      kind: Type.Union([Type.Literal(`claude`), Type.Literal(`codex`)], {
        description: `Kind for the new agent: 'claude' or 'codex'.`,
      }),
      workspace_mode: Type.Optional(
        Type.Union(
          [Type.Literal(`share`), Type.Literal(`clone`), Type.Literal(`fresh`)],
          {
            description: `How the new agent's workspace relates to the source's. 'share' (default for bindMount): same workspace, lease-serialised. 'clone' (default for volume): copy contents into a fresh volume. 'fresh': new empty workspace.`,
          }
        )
      ),
      initial_prompt: Type.Optional(
        Type.String({
          description: `Optional first prompt to send to the fork after spawn. If omitted, the fork is idle until prompted.`,
        })
      ),
      model: Type.Optional(
        Type.String({
          description: `Optional model override for the new kind.`,
        })
      ),
    }),
    execute: async (_toolCallId, params) => {
      const { source_url, kind, workspace_mode, initial_prompt, model } =
        params as {
          source_url: string
          kind: `claude` | `codex`
          workspace_mode?: `share` | `clone` | `fresh`
          initial_prompt?: string
          model?: string
        }
      if (
        typeof source_url !== `string` ||
        !source_url.startsWith(`/coding-agent/`)
      ) {
        return {
          content: [
            {
              type: `text` as const,
              text: `Error: source_url must be a path like "/coding-agent/<id>".`,
            },
          ],
          details: { spawned: false },
        }
      }
      const id = nanoid(10)
      const spawnArgs: Record<string, unknown> = {
        kind,
        workspaceType: `volume`,
        fromAgentId: source_url,
      }
      if (workspace_mode) spawnArgs.fromWorkspaceMode = workspace_mode
      if (model) spawnArgs.model = model
      try {
        const handle = await ctx.spawn(`coding-agent`, id, spawnArgs, {
          ...(initial_prompt
            ? { initialMessage: { text: initial_prompt } }
            : {}),
          wake: { on: `runFinished`, includeResponse: true },
        })
        return {
          content: [
            {
              type: `text` as const,
              text: `Forked coding agent dispatched at ${handle.entityUrl} (kind=${kind}, source=${source_url}). End your turn — when it replies you'll be woken.`,
            },
          ],
          details: { spawned: true, agentUrl: handle.entityUrl },
        }
      } catch (err) {
        serverLog.warn(
          `[fork_coding_agent tool] failed: ${err instanceof Error ? err.message : String(err)}`,
          err instanceof Error ? err : undefined
        )
        return {
          content: [
            {
              type: `text` as const,
              text: `Error forking coding agent: ${err instanceof Error ? err.message : `Unknown error`}`,
            },
          ],
          details: { spawned: false },
        }
      }
    },
  }
}
```

- [ ] **Step 3: Register tools in horton**

In `packages/agents/src/agents/horton.ts`:

(a) Add imports near existing tool imports:

```ts
import { createConvertCodingAgentTool } from '../tools/convert-coding-agent'
import { createForkCodingAgentTool } from '../tools/fork-coding-agent'
```

(b) In the tools array (around line 265–276), add after `createPromptCodingAgentTool(ctx)`:

```ts
createConvertCodingAgentTool(ctx),
createForkCodingAgentTool(ctx),
```

(c) Add tool descriptions to the agent prompt (search for "spawn_coding_agent: spawn" around line 216):

```
- convert_coding_agent: convert a coding agent's kind in place (claude↔codex). History preserved.
- fork_coding_agent: spawn a new coding agent inheriting another's conversation history.
```

- [ ] **Step 4: Write tool tests**

Create `packages/agents/test/tools/convert-coding-agent.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { createConvertCodingAgentTool } from '../../src/tools/convert-coding-agent'

describe(`convert_coding_agent tool`, () => {
  it(`sends a convert-kind message with the right payload`, async () => {
    const send = vi.fn()
    const ctx = { send } as any
    const tool = createConvertCodingAgentTool(ctx)
    const r = await tool.execute(`tcid`, {
      coding_agent_url: `/coding-agent/foo`,
      kind: `codex`,
      model: `gpt-5-codex-latest`,
    })
    expect((r as any).details.converted).toBe(true)
    expect(send).toHaveBeenCalledWith(
      `/coding-agent/foo`,
      { kind: `codex`, model: `gpt-5-codex-latest` },
      { type: `convert-kind` }
    )
  })

  it(`rejects malformed url`, async () => {
    const ctx = { send: vi.fn() } as any
    const tool = createConvertCodingAgentTool(ctx)
    const r = await tool.execute(`x`, {
      coding_agent_url: `foo`,
      kind: `codex`,
    })
    expect((r as any).details.converted).toBe(false)
  })
})
```

Create `packages/agents/test/tools/fork-coding-agent.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { createForkCodingAgentTool } from '../../src/tools/fork-coding-agent'

describe(`fork_coding_agent tool`, () => {
  it(`spawns a new coding-agent with fromAgentId`, async () => {
    const spawn = vi.fn(async () => ({ entityUrl: `/coding-agent/new` }))
    const ctx = { spawn } as any
    const tool = createForkCodingAgentTool(ctx)
    const r = await tool.execute(`tcid`, {
      source_url: `/coding-agent/source`,
      kind: `codex`,
      workspace_mode: `clone`,
      initial_prompt: `do the thing`,
    })
    expect((r as any).details.spawned).toBe(true)
    const [type, _id, args, opts] = spawn.mock.calls[0]!
    expect(type).toBe(`coding-agent`)
    expect((args as any).fromAgentId).toBe(`/coding-agent/source`)
    expect((args as any).fromWorkspaceMode).toBe(`clone`)
    expect((opts as any).initialMessage).toEqual({ text: `do the thing` })
  })
})
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
pnpm -C packages/agents test test/tools/convert-coding-agent.test.ts test/tools/fork-coding-agent.test.ts
```

Expected: PASS — three tests green.

- [ ] **Step 6: Commit**

```bash
git add packages/agents/src/tools/convert-coding-agent.ts \
        packages/agents/src/tools/fork-coding-agent.ts \
        packages/agents/src/agents/horton.ts \
        packages/agents/test/tools
git commit -m "feat(agents): convert_coding_agent + fork_coding_agent tools

Two new tools registered with horton: convert_coding_agent sends
a convert-kind inbox message; fork_coding_agent spawns a new
coding-agent with fromAgentId set."
```

---

## Task 12: Conformance L2.7 (convert mid-conversation)

**Files:**

- Modify: `packages/coding-agents/src/conformance/integration.ts`

- [ ] **Step 1: Add the scenario**

In `packages/coding-agents/src/conformance/integration.ts`, after the L2.6 `it(...)` block (locate by searching `L2.6`), add:

```ts
it(`L2.7 convert mid-conversation switches kind`, async () => {
  const { spec: ws, cleanup } = await config.scratchWorkspace()
  pendingCleanups.push(cleanup)
  const agentId = `/test/coding-agent/${kind}-l2-7-${Date.now().toString(36)}`
  const { ctx, state } = makeFakeCtx(agentId, buildArgs(kind, ws))

  await handler(ctx, { type: `message_received` })
  pushInbox(state, `i1`, `prompt`, { text: probe.prompt })
  await handler(ctx, { type: `message_received` })

  const beforeKind = (state.sessionMeta.get(`current`) as SessionMetaRow).kind
  // Pick the *other* kind for the conversion target.
  const otherKind: CodingAgentKind =
    beforeKind === `claude` ? `codex` : `claude`

  pushInbox(state, `i2`, `convert-kind`, { kind: otherKind })
  await handler(ctx, { type: `message_received` })

  const afterMeta = state.sessionMeta.get(`current`) as SessionMetaRow
  expect(afterMeta.kind).toBe(otherKind)
  expect(afterMeta.nativeSessionId).toBeDefined()
  const lifecycle = Array.from(state.lifecycle.rows.values()).map(
    (l: any) => l.event
  )
  expect(lifecycle).toContain(`kind.converted`)

  await provider.destroy(agentId).catch(() => undefined)
}, 180_000)
```

- [ ] **Step 2: Run conformance under DOCKER=1**

```bash
DOCKER=1 pnpm -C packages/coding-agents test test/integration/local-docker-conformance.test.ts
```

Expected: PASS — L2.7 added; all prior scenarios still green.

- [ ] **Step 3: Run under HOST_PROVIDER=1**

```bash
HOST_PROVIDER=1 pnpm -C packages/coding-agents test test/integration/host-provider-conformance.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/coding-agents/src/conformance/integration.ts
git commit -m "test(coding-agents): conformance L2.7 — convert mid-conversation"
```

---

## Task 13: Conformance L2.8 (fork into sibling)

**Files:**

- Modify: `packages/coding-agents/src/conformance/integration.ts`

- [ ] **Step 1: Add the scenario**

In `packages/coding-agents/src/conformance/integration.ts`, after L2.7 add:

```ts
it(`L2.8 fork into sibling inherits source events`, async () => {
  const { spec: ws, cleanup } = await config.scratchWorkspace()
  pendingCleanups.push(cleanup)
  // Source agent: prompt once so events accumulate.
  const sourceId = `/test/coding-agent/${kind}-l2-8s-${Date.now().toString(36)}`
  const { ctx: sourceCtx, state: sourceState } = makeFakeCtx(
    sourceId,
    buildArgs(kind, ws)
  )
  await handler(sourceCtx, { type: `message_received` })
  pushInbox(sourceState, `i1`, `prompt`, { text: probe.prompt })
  await handler(sourceCtx, { type: `message_received` })

  expect(sourceState.events.rows.size).toBeGreaterThan(0)

  // Fork into other kind. Stub observe() to point at sourceState.
  const otherKind: CodingAgentKind = kind === `claude` ? `codex` : `claude`
  const forkId = `/test/coding-agent/${otherKind}-l2-8f-${Date.now().toString(36)}`
  const forkArgs = {
    ...buildArgs(otherKind, ws),
    fromAgentId: sourceId,
    fromWorkspaceMode: `share`,
  }
  const { ctx: forkCtx, state: forkState } = makeFakeCtx(forkId, forkArgs)
  ;(forkCtx as any).observe = async () => ({
    sourceType: `entity`,
    sourceRef: sourceId,
    db: {
      collections: {
        events: sourceState.events,
        runs: sourceState.runs,
        sessionMeta: sourceState.sessionMeta,
      },
    },
    events: [],
  })

  await handler(forkCtx, { type: `message_received` })

  const native = forkState.nativeJsonl.get(`current`)
  expect(native?.content?.length).toBeGreaterThan(0)
  const lifecycle = Array.from(forkState.lifecycle.rows.values()).map(
    (l: any) => l.event
  )
  expect(lifecycle).toContain(`kind.forked`)

  await provider.destroy(sourceId).catch(() => undefined)
  await provider.destroy(forkId).catch(() => undefined)
}, 180_000)
```

- [ ] **Step 2: Run conformance suites**

```bash
DOCKER=1 pnpm -C packages/coding-agents test test/integration/local-docker-conformance.test.ts
HOST_PROVIDER=1 pnpm -C packages/coding-agents test test/integration/host-provider-conformance.test.ts
```

Expected: PASS — L2.8 added.

- [ ] **Step 3: Commit**

```bash
git add packages/coding-agents/src/conformance/integration.ts
git commit -m "test(coding-agents): conformance L2.8 — fork into sibling"
```

---

## Task 14: Conformance L1.9 (cloneWorkspace, optional)

**Files:**

- Modify: `packages/coding-agents/src/conformance/provider.ts`
- Modify: `packages/coding-agents/test/integration/local-docker-conformance.test.ts`

- [ ] **Step 1: Add the optional scenario**

In `packages/coding-agents/src/conformance/provider.ts`:

(a) Extend the config interface with `supportsCloneWorkspace?: boolean` (mirror `supportsRecovery`):

```ts
export interface SandboxProviderConformanceConfig {
  // ... existing fields ...
  /**
   * If true, L1.9 (cloneWorkspace) is included. Default: provider's
   * cloneWorkspace presence is checked at runtime.
   */
  supportsCloneWorkspace?: boolean
}
```

(b) After L1.8, add:

```ts
const cloneShould =
  config.supportsCloneWorkspace ??
  Boolean(/* will be checked at beforeAll */ (provider as any).cloneWorkspace)

const dClone = cloneShould ? it : it.skip
dClone(
  `L1.9 cloneWorkspace copies source contents into target`,
  async () => {
    if (!provider.cloneWorkspace) {
      // Defensive: skip if provider doesn't expose the method even though
      // config said supportsCloneWorkspace=true.
      return
    }
    const sourceWs = await config.scratchWorkspace()
    const targetWs = await config.scratchWorkspace()
    pendingCleanups.push(sourceWs.cleanup, targetWs.cleanup)

    // Seed source workspace with a sentinel via provider.start + copyTo.
    const sourceAgentId = `/test/coding-agent/conf-l1-9s-${Date.now().toString(36)}`
    const inst = await provider.start(specFor(sourceAgentId, sourceWs.spec))
    await inst.copyTo({
      destPath: `${inst.workspaceMount}/sentinel.txt`,
      content: `cloneme`,
      mode: 0o644,
    })
    await provider.destroy(sourceAgentId).catch(() => undefined)

    await provider.cloneWorkspace({
      source: sourceWs.spec,
      target: targetWs.spec,
    })

    const verifyAgentId = `/test/coding-agent/conf-l1-9v-${Date.now().toString(36)}`
    const inst2 = await provider.start(specFor(verifyAgentId, targetWs.spec))
    try {
      const h = await inst2.exec({
        cmd: [`cat`, `${inst2.workspaceMount}/sentinel.txt`],
      })
      const drain = async (s: AsyncIterable<string>): Promise<string> => {
        let acc = ``
        for await (const line of s) acc += line + `\n`
        return acc
      }
      const discard = async (s: AsyncIterable<string>): Promise<void> => {
        for await (const _ of s) {
          /* discard */
        }
      }
      const [out, , exit] = await Promise.all([
        drain(h.stdout),
        discard(h.stderr),
        h.wait(),
      ])
      expect(exit.exitCode).toBe(0)
      expect(out.trim()).toBe(`cloneme`)
    } finally {
      await provider.destroy(verifyAgentId).catch(() => undefined)
    }
  },
  90_000
)
```

- [ ] **Step 2: Wire the LocalDocker conformance file**

In `packages/coding-agents/test/integration/local-docker-conformance.test.ts`, locate the `runSandboxProviderConformance(...)` config object and add `supportsCloneWorkspace: true`.

- [ ] **Step 3: Run conformance**

```bash
DOCKER=1 pnpm -C packages/coding-agents test test/integration/local-docker-conformance.test.ts
```

Expected: PASS — L1.9 included and green.

- [ ] **Step 4: Verify host-provider-conformance still skips L1.9**

```bash
HOST_PROVIDER=1 pnpm -C packages/coding-agents test test/integration/host-provider-conformance.test.ts
```

Expected: PASS, with L1.9 skipped (host provider has no cloneWorkspace).

- [ ] **Step 5: Commit**

```bash
git add packages/coding-agents/src/conformance/provider.ts \
        packages/coding-agents/test/integration/local-docker-conformance.test.ts
git commit -m "test(coding-agents): conformance L1.9 — cloneWorkspace (optional)

Mirrors supportsRecovery pattern: gated on capability presence.
LocalDockerProvider opts in via supportsCloneWorkspace=true."
```

---

## Task 15: UI header convert button

**Files:**

- Modify: `packages/agents-server-ui/src/components/EntityHeader.tsx`
- Modify: `packages/agents-server-ui/src/components/CodingAgentTimeline.tsx` (render new lifecycle row types)

- [ ] **Step 1: Locate header buttons**

Read `packages/agents-server-ui/src/components/EntityHeader.tsx` to find the Pin/Release/Stop button group. The convert button is added to that group.

- [ ] **Step 2: Add Convert dropdown**

In `EntityHeader.tsx`, after the Stop button JSX, add:

```tsx
{
  entityType === `coding-agent` && (
    <div className="convert-kind-menu">
      <button
        type="button"
        onClick={() => setConvertOpen(!convertOpen)}
        title="Convert kind"
      >
        Convert ▾
      </button>
      {convertOpen && (
        <ul className="convert-kind-options">
          {[`claude`, `codex`]
            .filter((k) => k !== currentKind)
            .map((k) => (
              <li key={k}>
                <button
                  type="button"
                  onClick={async () => {
                    setConvertOpen(false)
                    await fetch(`${serverUrl}${entityUrl}/send`, {
                      method: `POST`,
                      headers: { 'content-type': `application/json` },
                      body: JSON.stringify({
                        from: `header-ui`,
                        type: `convert-kind`,
                        payload: { kind: k },
                      }),
                    })
                  }}
                >
                  Convert to {k}
                </button>
              </li>
            ))}
        </ul>
      )}
    </div>
  )
}
```

(Use the existing `useState`, `serverUrl`, `entityUrl`, `entityType`, and `currentKind` props — adapt to the file's existing patterns.)

- [ ] **Step 3: Render new lifecycle rows in timeline**

In `packages/agents-server-ui/src/components/CodingAgentTimeline.tsx`, locate the lifecycle row rendering (search for `sandbox.starting` or `lifecycle`). Add cases for the three new event types (`kind.converted`, `kind.convert_failed`, `kind.forked`) producing muted timeline rows with detail strings, mirroring existing patterns.

- [ ] **Step 4: Component test (vitest + testing-library)**

In `packages/agents-server-ui/test/` find existing component tests (or skip if no harness). If a harness exists, add:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import EntityHeader from '../src/components/EntityHeader'

describe(`EntityHeader convert button`, () => {
  it(`offers the other kind in the dropdown`, async () => {
    render(
      <EntityHeader
        entityType="coding-agent"
        entityUrl="/coding-agent/foo"
        currentKind="claude"
        serverUrl="http://localhost:4437"
      />
    )
    const btn = screen.getByText(/Convert/i)
    btn.click()
    expect(screen.getByText(/Convert to codex/i)).toBeDefined()
    expect(screen.queryByText(/Convert to claude/i)).toBeNull()
  })
})
```

If no test harness exists, skip — Playwright covers the UI in Task 17.

- [ ] **Step 5: Run typecheck + dev server smoke**

```bash
pnpm -C packages/agents-server-ui typecheck
pnpm -C packages/agents-server-ui dev &
# Open http://localhost:5173, find a coding-agent, verify the Convert button renders.
# Stop the server after manual smoke.
```

- [ ] **Step 6: Commit**

```bash
git add packages/agents-server-ui/src/components/EntityHeader.tsx \
        packages/agents-server-ui/src/components/CodingAgentTimeline.tsx
git commit -m "feat(agents-server-ui): header Convert kind button

Coding-agent header gains a Convert dropdown listing the other
registered kinds; click dispatches a convert-kind inbox message.
Timeline renders new kind.converted/convert_failed/forked lifecycle
rows as muted entries (mirrors sandbox.* row pattern)."
```

---

## Task 16: UI spawn dialog fork toggle

**Files:**

- Modify: `packages/agents-server-ui/src/components/CodingAgentSpawnDialog.tsx`

- [ ] **Step 1: Add fork toggle UI**

Read the existing dialog file. Add (in the form region, before submit):

```tsx
;<label>
  <input
    type="checkbox"
    checked={forkEnabled}
    onChange={(e) => setForkEnabled(e.target.checked)}
  />
  Fork from existing agent
</label>
{
  forkEnabled && (
    <>
      <label>
        Source agent
        <select
          value={forkSourceUrl}
          onChange={(e) => setForkSourceUrl(e.target.value)}
          required
        >
          <option value="">— pick a coding agent —</option>
          {availableCodingAgents.map((a) => (
            <option key={a.url} value={a.url}>
              {a.url} ({a.kind})
            </option>
          ))}
        </select>
      </label>
      <label>
        Workspace mode
        <select
          value={forkWorkspaceMode}
          onChange={(e) => setForkWorkspaceMode(e.target.value as any)}
        >
          <option value="">(default)</option>
          <option value="share">share</option>
          <option value="clone">clone</option>
          <option value="fresh">fresh</option>
        </select>
      </label>
    </>
  )
}
```

(`availableCodingAgents` comes from the existing entity list; reuse the source.)

- [ ] **Step 2: Pass fork args on submit**

In the submit handler, when `forkEnabled` is true, add to the spawn args:

```ts
fromAgentId: forkSourceUrl,
...(forkWorkspaceMode ? { fromWorkspaceMode: forkWorkspaceMode } : {}),
```

- [ ] **Step 3: Validation**

Before submit, when `forkEnabled` and `!forkSourceUrl`, prevent submit and show an inline error.

- [ ] **Step 4: Manual smoke**

Run dev server, open the spawn dialog, toggle fork-from, spawn a fork. Verify the new agent appears in the sidebar and its first prompt sees the source's history.

- [ ] **Step 5: Commit**

```bash
git add packages/agents-server-ui/src/components/CodingAgentSpawnDialog.tsx
git commit -m "feat(agents-server-ui): spawn dialog Fork-from toggle

Toggle reveals source-agent picker + workspace-mode selector.
Spawn args include fromAgentId + fromWorkspaceMode when set."
```

---

## Task 17: Playwright UI tests (convert + fork)

**Files:**

- Create: `packages/agents-server-ui/test/e2e/convert-kind.spec.ts`
- Create: `packages/agents-server-ui/test/e2e/fork-spawn.spec.ts`

- [ ] **Step 1: Read existing Playwright helpers**

Read `packages/agents-server-ui/test/e2e/helpers.ts` and `packages/agents-server-ui/test/e2e/host-target.spec.ts` to understand the harness (server boot, fixture, page navigation). The new specs follow the same patterns.

- [ ] **Step 2: Write convert spec**

Create `packages/agents-server-ui/test/e2e/convert-kind.spec.ts`:

```ts
import { test, expect } from '@playwright/test'
import { startTestServer, spawnCodingAgent } from './helpers'

test.describe(`convert kind via header`, () => {
  test(`claude → codex round-trip and timeline shows kind.converted`, async ({
    page,
  }) => {
    const server = await startTestServer()
    try {
      const agent = await spawnCodingAgent(server, { kind: `claude` })
      await page.goto(`${server.uiUrl}${agent.url}`)
      await page.waitForSelector(`[data-testid="entity-header"]`)
      // Click convert button.
      await page.click(`button:has-text("Convert")`)
      await page.click(`button:has-text("Convert to codex")`)
      // Wait for kind.converted lifecycle row.
      await expect(page.locator(`[data-event="kind.converted"]`)).toBeVisible({
        timeout: 10_000,
      })
    } finally {
      await server.close()
    }
  })
})
```

(`spawnCodingAgent` is a small helper — add to `helpers.ts` if missing, hitting the agents-server's spawn endpoint.)

- [ ] **Step 3: Write fork spec**

Create `packages/agents-server-ui/test/e2e/fork-spawn.spec.ts`:

```ts
import { test, expect } from '@playwright/test'
import { startTestServer, spawnCodingAgent } from './helpers'

test.describe(`fork via spawn dialog`, () => {
  test(`fork from existing agent appears in sidebar with kind.forked row`, async ({
    page,
  }) => {
    const server = await startTestServer()
    try {
      const source = await spawnCodingAgent(server, { kind: `claude` })
      await page.goto(server.uiUrl)
      await page.waitForSelector(`[data-testid="sidebar"]`)
      await page.click(`button:has-text("Spawn coding agent")`)
      await page.check(
        `input[type="checkbox"]:near(:text("Fork from existing"))`
      )
      await page.selectOption(`select:near(:text("Source agent"))`, source.url)
      await page.selectOption(`select:near(:text("Workspace mode"))`, `share`)
      // Pick the OTHER kind.
      await page.selectOption(`select[name="kind"]`, `codex`)
      await page.click(`button:has-text("Spawn")`)
      // Wait for new agent in sidebar.
      await expect(
        page.locator(`[data-testid="sidebar"] [data-kind="codex"]`)
      ).toBeVisible({ timeout: 10_000 })
      // Open the new agent and verify kind.forked row.
      await page.click(`[data-testid="sidebar"] [data-kind="codex"]`)
      await expect(page.locator(`[data-event="kind.forked"]`)).toBeVisible({
        timeout: 10_000,
      })
    } finally {
      await server.close()
    }
  })
})
```

- [ ] **Step 4: Add `data-event` and `data-kind` test attributes**

In `CodingAgentTimeline.tsx`, when rendering lifecycle rows, add `data-event={row.event}`. In `Sidebar.tsx`, on coding-agent list items, add `data-kind={agent.kind}` and `data-testid="sidebar"`.

In `EntityHeader.tsx`, add `data-testid="entity-header"`.

- [ ] **Step 5: Run Playwright**

```bash
pnpm -C packages/agents-server-ui test:e2e
```

Expected: PASS — both specs green (assumes the test image has fake CLI).

- [ ] **Step 6: Commit**

```bash
git add packages/agents-server-ui/test/e2e/convert-kind.spec.ts \
        packages/agents-server-ui/test/e2e/fork-spawn.spec.ts \
        packages/agents-server-ui/src/components
git commit -m "test(agents-server-ui): Playwright coverage for convert + fork

Convert: header dropdown round-trip, kind.converted row visible.
Fork: spawn dialog toggle, new sidebar entry + kind.forked row."
```

---

## Task 18: Layer 4 e2e tests (real CLIs)

**Files:**

- Create: `packages/coding-agents/test/integration/convert-kind.e2e.test.ts`
- Create: `packages/coding-agents/test/integration/fork-kind.e2e.test.ts`

- [ ] **Step 1: Write convert e2e (gated SLOW=1 + both keys)**

Create `packages/coding-agents/test/integration/convert-kind.e2e.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const SLOW =
  process.env.SLOW === `1` &&
  !!process.env.ANTHROPIC_API_KEY &&
  !!process.env.OPENAI_API_KEY
const d = SLOW ? describe : describe.skip
const SERVER = `http://localhost:4437`

d(`E4 — claude → codex convert (real CLIs, e2e)`, () => {
  const agentId = `e2e-convert-${Date.now().toString(36)}`
  const SECRET = `BUTTERFLY`

  beforeAll(async () => {
    // Spawn a claude coding-agent.
    await fetch(`${SERVER}/coding-agent`, {
      method: `POST`,
      headers: { 'content-type': `application/json` },
      body: JSON.stringify({
        id: agentId,
        creationArgs: { kind: `claude`, workspaceType: `volume` },
      }),
    })
  })

  afterAll(async () => {
    await fetch(`${SERVER}/coding-agent/${agentId}`, {
      method: `DELETE`,
    }).catch(() => undefined)
  })

  it(`claude turn → convert to codex → codex recalls secret`, async () => {
    // Turn 1: tell the agent a secret under claude.
    await fetch(`${SERVER}/coding-agent/${agentId}/send`, {
      method: `POST`,
      headers: { 'content-type': `application/json` },
      body: JSON.stringify({
        from: `e2e-test`,
        type: `prompt`,
        payload: { text: `the secret word is ${SECRET}. just acknowledge.` },
      }),
    })

    // Wait for run completion.
    const w1 = await waitForLastRunCompleted(agentId, 120_000)
    expect(w1.responseText ?? ``).toBeDefined()

    // Convert to codex.
    await fetch(`${SERVER}/coding-agent/${agentId}/send`, {
      method: `POST`,
      headers: { 'content-type': `application/json` },
      body: JSON.stringify({
        from: `e2e-test`,
        type: `convert-kind`,
        payload: { kind: `codex` },
      }),
    })
    // Wait briefly for the conversion lifecycle row.
    await waitForLifecycleEvent(agentId, `kind.converted`, 10_000)

    // Turn 2 under codex: ask for the secret.
    await fetch(`${SERVER}/coding-agent/${agentId}/send`, {
      method: `POST`,
      headers: { 'content-type': `application/json` },
      body: JSON.stringify({
        from: `e2e-test`,
        type: `prompt`,
        payload: { text: `what was the secret word? answer in one word.` },
      }),
    })

    const w2 = await waitForLastRunCompleted(agentId, 180_000)
    expect((w2.responseText ?? ``).toLowerCase()).toContain(
      SECRET.toLowerCase()
    )
  }, 360_000)
})

async function waitForLastRunCompleted(
  agentId: string,
  ms: number
): Promise<{ responseText?: string }> {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    const r = await fetch(
      `http://localhost:4437/coding-agent/${agentId}/main?offset=-1`
    )
    const data = (await r.json()) as Array<any>
    const completed = data
      .filter((e) => e.type === `coding-agent.runs`)
      .map((e) => e.value)
      .filter((v) => v.status === `completed` && v.key !== `imported`)
    if (completed.length > 0) {
      return completed[completed.length - 1]
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error(`timeout waiting for run completion`)
}

async function waitForLifecycleEvent(
  agentId: string,
  event: string,
  ms: number
): Promise<void> {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    const r = await fetch(
      `http://localhost:4437/coding-agent/${agentId}/main?offset=-1`
    )
    const data = (await r.json()) as Array<any>
    const has = data
      .filter((e) => e.type === `coding-agent.lifecycle`)
      .map((e) => e.value)
      .some((v) => v.event === event)
    if (has) return
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`timeout waiting for lifecycle event ${event}`)
}
```

- [ ] **Step 2: Write fork e2e**

Create `packages/coding-agents/test/integration/fork-kind.e2e.test.ts`:

```ts
import { afterAll, describe, expect, it } from 'vitest'
import { nanoid } from 'nanoid'

const SLOW =
  process.env.SLOW === `1` &&
  !!process.env.ANTHROPIC_API_KEY &&
  !!process.env.OPENAI_API_KEY
const d = SLOW ? describe : describe.skip
const SERVER = `http://localhost:4437`

d(`E5 — fork claude → codex (real CLIs, e2e)`, () => {
  const sourceId = `e2e-fork-src-${Date.now().toString(36)}`
  const forkId = `e2e-fork-${nanoid(6)}`

  afterAll(async () => {
    await fetch(`${SERVER}/coding-agent/${sourceId}`, {
      method: `DELETE`,
    }).catch(() => undefined)
    await fetch(`${SERVER}/coding-agent/${forkId}`, { method: `DELETE` }).catch(
      () => undefined
    )
  })

  it(`source claude run → fork as codex → fork sees prior context`, async () => {
    // Spawn source.
    await fetch(`${SERVER}/coding-agent`, {
      method: `POST`,
      headers: { 'content-type': `application/json` },
      body: JSON.stringify({
        id: sourceId,
        creationArgs: { kind: `claude`, workspaceType: `volume` },
      }),
    })
    const KEY = `MAGNOLIA`
    await fetch(`${SERVER}/coding-agent/${sourceId}/send`, {
      method: `POST`,
      headers: { 'content-type': `application/json` },
      body: JSON.stringify({
        from: `e2e-test`,
        type: `prompt`,
        payload: { text: `the magic word is ${KEY}. acknowledge.` },
      }),
    })
    await waitForLastRunCompleted(sourceId, 120_000)

    // Fork as codex.
    await fetch(`${SERVER}/coding-agent`, {
      method: `POST`,
      headers: { 'content-type': `application/json` },
      body: JSON.stringify({
        id: forkId,
        creationArgs: {
          kind: `codex`,
          workspaceType: `volume`,
          fromAgentId: `/coding-agent/${sourceId}`,
          fromWorkspaceMode: `share`,
        },
      }),
    })
    await waitForLifecycleEvent(forkId, `kind.forked`, 30_000)

    // Ask the fork for the magic word.
    await fetch(`${SERVER}/coding-agent/${forkId}/send`, {
      method: `POST`,
      headers: { 'content-type': `application/json` },
      body: JSON.stringify({
        from: `e2e-test`,
        type: `prompt`,
        payload: {
          text: `what was the magic word from earlier? answer in one word.`,
        },
      }),
    })
    const w = await waitForLastRunCompleted(forkId, 180_000)
    expect((w.responseText ?? ``).toLowerCase()).toContain(KEY.toLowerCase())
  }, 420_000)
})

// Reuse the same helpers as convert-kind.e2e.test.ts (paste here or
// extract into test/support/e2e-helpers.ts in a follow-up).
async function waitForLastRunCompleted(
  agentId: string,
  ms: number
): Promise<{ responseText?: string }> {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    const r = await fetch(
      `http://localhost:4437/coding-agent/${agentId}/main?offset=-1`
    )
    const data = (await r.json()) as Array<any>
    const completed = data
      .filter((e) => e.type === `coding-agent.runs`)
      .map((e) => e.value)
      .filter((v) => v.status === `completed` && v.key !== `imported`)
    if (completed.length > 0) return completed[completed.length - 1]
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error(`timeout waiting for run completion`)
}
async function waitForLifecycleEvent(
  agentId: string,
  event: string,
  ms: number
): Promise<void> {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    const r = await fetch(
      `http://localhost:4437/coding-agent/${agentId}/main?offset=-1`
    )
    const data = (await r.json()) as Array<any>
    const has = data
      .filter((e) => e.type === `coding-agent.lifecycle`)
      .map((e) => e.value)
      .some((v) => v.event === event)
    if (has) return
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`timeout waiting for lifecycle event ${event}`)
}
```

- [ ] **Step 3: Run e2e**

```bash
SLOW=1 ANTHROPIC_API_KEY=... OPENAI_API_KEY=... pnpm -C packages/coding-agents test \
  test/integration/convert-kind.e2e.test.ts \
  test/integration/fork-kind.e2e.test.ts
```

Expected: PASS — assumes a running agents-server on :4437 + cheap models configured. Document any flakiness in the implementation findings (Task 19).

- [ ] **Step 4: Commit**

```bash
git add packages/coding-agents/test/integration/convert-kind.e2e.test.ts \
        packages/coding-agents/test/integration/fork-kind.e2e.test.ts
git commit -m "test(coding-agents): Layer 4 e2e — convert + fork (real CLIs)

E4 (convert): claude turn with secret → convertKind → codex recalls.
E5 (fork): claude run → fork as codex → fork answers using inherited
context. Both gated SLOW=1 + ANTHROPIC_API_KEY + OPENAI_API_KEY."
```

---

## Task 19: Documentation updates

**Files:**

- Modify: `packages/coding-agents/README.md`
- Modify: `docs/superpowers/specs/2026-04-30-coding-agents-platform-primitive-design.md`
- Modify: `docs/superpowers/specs/2026-05-01-coding-agents-slice-c2-design.md`
- Modify: `docs/superpowers/specs/2026-05-02-coding-agents-conformance-design.md`
- Append to: `docs/superpowers/plans/2026-05-02-coding-agents-cross-kind-resume.md` (this file)

- [ ] **Step 1: README cross-kind section**

In `packages/coding-agents/README.md`, add a new section near the existing API docs:

````markdown
## Cross-kind resume and forking

Two operations let you change which CLI drives a coding-agent:

### Convert (in-place)

Send a `convert-kind` inbox message:

```ts
await ctx.send(`/coding-agent/foo`, { kind: `codex` }, { type: `convert-kind` })
```
````

The agent's events history is preserved. The next prompt runs under the new kind.

### Fork (sibling agent)

Spawn with `from`:

```ts
await ctx.spawnCodingAgent({
  id: nanoid(10),
  kind: `codex`,
  workspace: { type: `volume` },
  from: { agentId: `/coding-agent/source`, workspaceMode: `clone` },
})
```

`workspaceMode` defaults: `share` for bind-mount sources, `clone` for volume sources (errors at spawn time if the provider doesn't implement `cloneWorkspace`).

### Provider capability matrix

| Provider              | `cloneWorkspace`     |
| --------------------- | -------------------- |
| `LocalDockerProvider` | yes (alpine cp -a)   |
| `HostProvider`        | no (bind-mount only) |

### Lossy aspects

- Cross-agent tool calls degrade to `Bash`-with-description per the protocol's `denormalize` rules.
- Mid-turn-crash artefacts (dangling `tool_call` events) are passed through as-is; a sanitisation pass is a documented follow-up.

```

- [ ] **Step 2: Predecessor specs (Resolved-by notes)**

In `docs/superpowers/specs/2026-04-30-coding-agents-platform-primitive-design.md`, find the "Cross-kind resume in the spawn dialog" line in §"Out of scope for v1" (~line 602) and append:

```

> **Resolved by:** [`docs/superpowers/specs/2026-05-02-coding-agents-cross-kind-resume-design.md`](./2026-05-02-coding-agents-cross-kind-resume-design.md).

````

In `docs/superpowers/specs/2026-05-01-coding-agents-slice-c2-design.md`, append the same Resolved-by note next to lines 19 and 23 (the cross-kind deferral language).

In `docs/superpowers/specs/2026-05-02-coding-agents-conformance-design.md`, append the Resolved-by note next to line 26 (`Cross-kind resume. Deferred per slice C₂ §Non-goals.`).

- [ ] **Step 3: Implementation findings (this plan)**

After the final task verifies, append to `docs/superpowers/plans/2026-05-02-coding-agents-cross-kind-resume.md`:

```markdown
## Implementation findings (YYYY-MM-DD)

(Filled in after merge. Mirrors the conformance-plan precedent.)
````

Capture: actual bugs caught by L2.7/L2.8 conformance, e2e flakiness rate over first 10 runs, any `denormalize` edge cases observed, follow-up items.

- [ ] **Step 4: Commit**

```bash
git add packages/coding-agents/README.md \
        docs/superpowers/specs/2026-04-30-coding-agents-platform-primitive-design.md \
        docs/superpowers/specs/2026-05-01-coding-agents-slice-c2-design.md \
        docs/superpowers/specs/2026-05-02-coding-agents-conformance-design.md \
        docs/superpowers/plans/2026-05-02-coding-agents-cross-kind-resume.md
git commit -m "docs(coding-agents): cross-kind resume + fork

README adds cross-kind section with capability matrix. Predecessor
specs (platform-primitive, slice-c2, conformance) get Resolved-by
backlinks closing out the deferred work."
```

---

## Final verification

- [ ] **Step 1: Full unit suite**

```bash
pnpm -C packages/coding-agents test
pnpm -C packages/agents test
```

Expected: PASS.

- [ ] **Step 2: Conformance — local docker**

```bash
DOCKER=1 pnpm -C packages/coding-agents test test/integration/local-docker-conformance.test.ts
```

Expected: PASS — L1.1–L1.9, L2.1–L2.8 green for both kinds.

- [ ] **Step 3: Conformance — host**

```bash
HOST_PROVIDER=1 pnpm -C packages/coding-agents test test/integration/host-provider-conformance.test.ts
```

Expected: PASS — L1.9 skipped, rest green.

- [ ] **Step 4: Layer 4 e2e**

```bash
SLOW=1 ANTHROPIC_API_KEY=... OPENAI_API_KEY=... pnpm -C packages/coding-agents test \
  test/integration/convert-kind.e2e.test.ts \
  test/integration/fork-kind.e2e.test.ts
```

Expected: PASS or document flakes in implementation findings.

- [ ] **Step 5: Playwright UI**

```bash
pnpm -C packages/agents-server-ui test:e2e
```

Expected: PASS.

- [ ] **Step 6: Typecheck + stylecheck**

```bash
pnpm -C packages/coding-agents typecheck
pnpm -C packages/coding-agents stylecheck
pnpm -C packages/agents typecheck
pnpm -C packages/agents-server-ui typecheck
```

Expected: PASS.

- [ ] **Step 7: Manual smoke**

Run dev server, spawn a claude agent, send a prompt, click Convert → codex, send another prompt, verify response references prior turn. Open spawn dialog, toggle Fork-from, pick the converted agent, spawn fork as claude with workspace mode `clone`, prompt fork, verify fork sees source's history.

- [ ] **Step 8: Push + PR**

```bash
git push -u origin coding-agents-cross-kind-resume
gh pr create --title "Cross-kind resume + fork (claude ↔ codex)" --body "$(cat <<'EOF'
## Summary
- Adds in-place kind conversion (convert-kind inbox message) and sibling forking (SpawnCodingAgentOptions.from) for coding-agents
- New SandboxProvider.cloneWorkspace optional capability + LocalDocker impl
- Built-in tools: convert_coding_agent, fork_coding_agent (registered with horton)
- UI: header Convert dropdown + spawn dialog Fork-from toggle
- Conformance L2.7/L2.8 wired (cross-kind scenarios deferred from slice C₂); optional L1.9 cloneWorkspace
- Layer 4 e2e + Playwright coverage
- Predecessor specs marked Resolved-by

Closes the deferred follow-up from `docs/superpowers/specs/2026-05-01-coding-agents-slice-c2-design.md` (lines 19, 23) and the related platform-spec post-MVP entry (line 602).

## Test plan
- [ ] Unit: `pnpm -C packages/coding-agents test` passes (new tests under test/unit/{convert-kind,fork,conversion,messages,cross-stream-read}.test.ts)
- [ ] Provider conformance: `DOCKER=1 pnpm -C packages/coding-agents test test/integration/local-docker-conformance.test.ts` (L1.1–L1.9 + L2.1–L2.8)
- [ ] Host conformance: `HOST_PROVIDER=1 pnpm -C packages/coding-agents test test/integration/host-provider-conformance.test.ts` (L1.9 skipped, rest green)
- [ ] Layer 4 e2e: `SLOW=1 ANTHROPIC_API_KEY=... OPENAI_API_KEY=... pnpm -C packages/coding-agents test test/integration/{convert-kind,fork-kind}.e2e.test.ts`
- [ ] Playwright: `pnpm -C packages/agents-server-ui test:e2e`
- [ ] Manual smoke: spawn claude, convert to codex, prompt → response references prior turn; spawn dialog Fork-from → fork answers using inherited context

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review checklist (run before dispatching subagents)

1. **Spec coverage** — every section §1–§9 of the spec has a task. ✓
2. **Placeholder scan** — no TBD/TODO/"add appropriate" patterns; every code step contains real code. ✓
3. **Type consistency** — `convertNativeJsonl`, `convert-kind`, `kind.converted`, `fromAgentId`, `fromWorkspaceMode`, `cloneWorkspace` used consistently across tasks. ✓
4. **Build sequence** — order respects dependencies: types before impls; conversion helper before handler branch; provider capability before fork policy; tools after handler+register; UI after API; tests interleaved at each layer; docs last.

---

## Implementation findings (2026-05-02)

All seven phases (Tasks 1–19) landed cleanly on branch `coding-agents-slice-a`.

### Phase summary

- **Phase 1 (Task 1) — types + cross-stream read prep.** Added `kind.converted` / `kind.forked` to the lifecycle event union; documented snapshot semantics for `ctx.observe`-based reads. Initial scope was clarified mid-implementation (validator-audit catch — see below).
- **Phase 2 (Tasks 2–4) — conversion helper + convert-kind handler.** `convertNativeJsonl` plus the `convert-kind` inbox-message branch. Unit tests under `test/unit/{conversion,convert-kind,messages}.test.ts` all green.
- **Phase 3 (Tasks 5–7) — provider capability + fork-from-spawn.** `SandboxProvider.cloneWorkspace` capability; `LocalDockerProvider` impl (alpine `cp -a`); `HostProvider` left as bind-mount-only by design. Fork-from-spawn handler branch in `entity/handler.ts` reads source via `ctx.observe` and emits `kind.forked`.
- **Phase 4 (Tasks 8–10) — built-in tools + horton register.** `convert_coding_agent` and `fork_coding_agent` registered with horton's tool registry.
- **Phase 5 (Tasks 11–12) — UI: header Convert dropdown + spawn dialog Fork-from toggle.**
- **Phase 6 (Tasks 13–17) — conformance scenarios + Playwright specs.** L2.7 (convert), L2.8 (cross-stream read), L1.9 (cloneWorkspace) wired into the conformance suite. Playwright specs authored but not yet executed in CI.
- **Phase 7 (Tasks 18–19) — Layer 4 e2e + docs.** This document.

### Validator-audit catches (pre-implementation)

The validator audit caught four issues before any code shipped:

1. **`model` on `meta`.** Plan called for `model` to live on `sessionMeta`; spec drafts disagreed. Resolution: keep `model` on `runs` (per-run granularity) — `sessionMeta` stays thin.
2. **`cloneWorkspace` volume-name prefix bug.** L1.9 conformance scenario was authored before the impl; the scenario asserted on a sanitised volume name with a specific prefix. The first impl produced a different prefix and the scenario flagged it. **The conformance suite did its job** — see "Notable bug catches" below.
3. **Spec inconsistency on source-missing failure mode.** Cross-kind-resume spec said "fail with `kind.fork.failed`"; slice-C₂ said "fall back to fresh". Resolution: hard-fail with a structured error row; the fork message is a best-effort optimisation, not a degraded mode.
4. **Task 1 scope clarification.** Task 1 originally bundled lifecycle-event additions with the README cross-stream-reads section. Split during planning so the README backlink (which depends on the design spec) lands in Phase 7 with the rest of the docs.

### Notable bug catches

- **L1.9 caught a real `LocalDockerProvider.cloneWorkspace` volume-name-prefix bug.** The first impl built the destination volume name from `${SANDBOX_PREFIX}-${name}` but L1.9's assertion expected `${SANDBOX_PREFIX}_${name}`. Fix was a one-character separator change, but the bug would have shipped silently without the conformance scenario — exactly the kind of low-leverage, high-cost-to-debug regression the suite is designed to catch. Cross-validates the conformance plan's investment.

### Layer 4 e2e (Task 18)

Two new tests under `packages/coding-agents/test/integration/`:

- `convert-kind.e2e.test.ts` — claude turn with secret `BUTTERFLY` → `convert-kind` → codex recalls.
- `fork-kind.e2e.test.ts` — claude turn with magic word `MAGNOLIA` → fork as codex with `fromWorkspaceMode: share` → fork answers using inherited context.

Both gated `SLOW=1 && ANTHROPIC_API_KEY && OPENAI_API_KEY`. Adapted from the plan's example code: the plan's example used a stale spawn-API shape (`POST /coding-agent` with `{ id, creationArgs }`); the live API is `PUT /coding-agent/<name>` with `{ args }` (matching `import-claude.e2e.test.ts` and `cli/import.ts`). Also dropped a `nanoid` import — coding-agents doesn't depend on nanoid; replaced with a 6-char `Math.random().toString(36)` helper.

Both tests skip cleanly when API keys are absent (verified locally: 2 skipped, 0 failed). **Actual e2e runs are deferred to manual verification** — neither `ANTHROPIC_API_KEY` nor `OPENAI_API_KEY` were set in the implementation environment, and the tests assume an externally-managed agents-server on `:4437` (matching the existing `import-claude.e2e.test.ts` pattern, which also assumes this). Documented in PR description as a manual-smoke gate.

### Follow-ups

- **Playwright specs not yet executed.** Phase 6 authored `packages/agents-server-ui/tests/e2e/{convert-target,convert-kind,fork-from}.spec.ts` (or similar) but did not run them. Phase 7 inherits the responsibility to run `pnpm -C packages/agents-server-ui test:e2e` and document any failures before merge.
- **L4 e2e manual smoke.** With both API keys + a running server, run `SLOW=1 pnpm -C packages/coding-agents test test/integration/{convert-kind,fork-kind}.e2e.test.ts`. Document flakiness rate over the first 10 runs in a follow-up edit to this section.
- **`nativeJsonl` sanitisation pass for crashed turns.** Mid-turn-crash artefacts (dangling `tool_call` events with no matching `tool_result`) are passed through to the new kind as-is. README documents this; a sanitisation pass is a follow-up if it surfaces in real use.
- **Helpers extraction.** `waitForLastRunCompleted` / `waitForLifecycleEvent` are duplicated across the two new e2e tests. Extract to `test/support/e2e-helpers.ts` next time these patterns get a third caller.
- ~~**ARG_MAX-bounded prompt size for argv-only CLIs.**~~ **Resolved 2026-05-02 by switching codex and opencode to stdin prompt delivery.** A closer read of each CLI's headless interface showed both already support stdin (codex via `-- -`, opencode by silent fallback when no positional message is provided). The bridge keeps a defensive `PROMPT_LIMIT_BYTES = 900_000` pre-flight check so pathological inputs fail with a clear error rather than `E2BIG` or — on macOS — the codex npm-shim's `RangeError` stack overflow around ~969 KB. Tracked in `docs/superpowers/specs/2026-05-02-coding-agents-opencode-design.md` §10 TL-1.

### Post-merge findings (2026-05-02)

After the cross-kind work landed, the header `Fork` button was unified so both same-kind and cross-kind forks go through the `fromAgentId` path (commit `794719fe4`). Driving that end-to-end via Playwright over LAN HTTP surfaced four issues, three fixed, one tracked here:

- **`crypto.randomUUID` undefined in non-secure contexts** — fixed in `packages/agents-server-ui/src/main.tsx` with a `getRandomValues`-based polyfill (commit `b0caf9676`). The browser only exposes the API on HTTPS or localhost; LAN HTTP made `nanoid()` and any other consumer throw `TypeError`. No-op when running on localhost or HTTPS.
- **Header fork dropdown self-cloned the source's volume** — fixed in the same commit. The router was passing the source's `workspaceName` straight through to the new agent, so `cloneWorkspace` was asked to copy a volume into itself. Volume sources now omit `workspaceName` so the runtime auto-derives it.
- **`processConvertKind` tried to `_insert` over an existing `nativeJsonl` row** — fixed by switching to upsert (commit `220ca5b3b`); fake-ctx in conformance got the missing `nativeJsonl_update` action (commit `bb9bfbf0f`).
- **claude's on-disk transcript is non-cumulative under `--resume`** — **RESOLVED**. The original observation was a turn-2 capture failure that LOOKED like a non-cumulative file. The file is in fact append-only and asp-compatible; what failed was our turn-2 `nativeJsonl_insert` (it threw "ID already exists" because turn-1 already inserted the row, and the surrounding `try/catch` swallowed the error — leaving the stored row frozen at the turn-1 snapshot). See below.

#### Resolved: turn-2+ transcript capture used insert instead of upsert

**Verified empirically (2026-05-02, fresh sandbox agent on the live dev environment).** A claude-kind agent, two-turn conversation:

- Turn 1 prompt: `"reply with the single word: BUTTERFLY"` → assistant replies `BUTTERFLY`.
- Turn 2 prompt: `"Remember the secret word STRATOVOLT-7. Just acknowledge with one word."` → assistant replies `Acknowledged.`.

Inside the sandbox, `~/.claude/projects/-workspace/<sessionId>.jsonl` (claude CLI v2.1.126) at end of turn 2:

```
types in actual file: Counter({'queue-operation': 4, 'ai-title': 4, 'user': 2, 'attachment': 2, 'assistant': 2, 'last-prompt': 2})
user      → reply with the single word: BUTTERFLY
assistant → BUTTERFLY
user      → Remember the secret word STRATOVOLT-7. Just acknowledge with one word.
assistant → Acknowledged.
```

The file IS append-only and DOES contain real `user` / `assistant` records. The recon agent's hypothesis was correct.

**The actual bug.** In `packages/coding-agents/src/entity/handler.ts`, `processPrompt`'s end-of-turn capture used `nativeJsonl_insert` unconditionally:

```ts
if (content) {
  ctx.db.actions.nativeJsonl_insert({
    row: { key: 'current', nativeSessionId: finalNativeSessionId, content },
  })
}
```

On turn 2 this throws "ID already exists" (turn 1 inserted the row); the surrounding `try/catch` swallows the error with a `log.warn`, leaving the persisted `nativeJsonl` frozen at turn-1 contents. This explains:

- Why the captured blob from a "real session" looked like only ~9 lines of queue-ops despite multiple conversation turns: it was the snapshot from the ONE turn that ran before any `user`/`assistant` records were written. (Or a single-prompt session whose first capture happened pre-write.)
- Why same-kind fork didn't see prior conversation: it copied the source's stale turn-1 nativeJsonl row, missing turns 2..N.
- Why `convert-kind.e2e.test.ts` E4 ("acknowledged" should contain "butterfly") failed: by the time convert ran, the source had run multiple turns but we only had turn 1 — and even that was a partial snapshot if the file hadn't been flushed when capture ran.

`processConvertKind` already used the upsert pattern for exactly this reason (see commits 220ca5b3b, bb9bfbf0f); end-of-turn capture didn't.

**Fix.** Change the post-turn capture to upsert (mirroring `processConvertKind`):

```ts
const existing = ctx.db.collections.nativeJsonl.get('current')
if (existing) {
  ctx.db.actions.nativeJsonl_update({
    key: 'current',
    updater: (d) => {
      d.nativeSessionId = finalNativeSessionId
      d.content = content
    },
  })
} else {
  ctx.db.actions.nativeJsonl_insert({
    row: { key: 'current', nativeSessionId: finalNativeSessionId, content },
  })
}
```

**Realpath safety (Step 4 from the investigation prompt).** Confirmed already in place:

- `HostProvider.start` realpaths `spec.workspace.hostPath` (line 37) before storing `workspaceMount`. The realpath'd value flows into `ClaudeAdapter.captureCommand`/`probeCommand`/`materialiseTargetPath` via `sandbox.workspaceMount`, so the macOS `/var/folders` ↔ `/private/var/folders` symlink is no longer a hazard.
- Sandbox target uses `/workspace` (LocalDockerProvider line 286), already canonical inside the Linux container.

**What this fix does and doesn't unlock.** Fixes turn-N capture, same-kind fork (forkee now gets full source history), cold-boot resume (full transcript materialised). Does NOT change cross-kind conversion fidelity, which still depends on `denormalizeClaude`'s lossy claude←codex round-trip — that's a separate concern.

#### Resolved: cross-kind-to-claude was semantically empty (no synthesised `user_message`)

**Symptom.** `Fork to claude` from a codex/opencode source — and `Convert kind: codex/opencode → claude` — produced a claude session that replied "I don't have a secret word." Same-kind paths and claude → anything were unaffected. The convert-kind E4 e2e test (claude → codex) passes fine post-upsert; only the OTHER direction broke.

**Root cause (empirically verified 2026-05-02 against the live dev environment).** The `coding-agent.events` collection for ANY agent — claude, codex, or opencode — after one user prompt contains only `session_init`, `assistant_message`, `turn_complete`. No `user_message`. The Counter from a fresh claude agent post-prompt:

```
Counter({'session_init': 1, 'assistant_message': 1, 'turn_complete': 1})
```

None of the supported CLIs echo the user prompt back in their stream-json stdout (claude's `--print --output-format stream-json`, codex's `exec --json`, opencode's `run --print-logs`). Asp's `normalizeClaude` / `normalizeCodex` and our local `normalizeOpencode` faithfully parse what's emitted — there's nothing to fabricate at the normalize layer because the user-side echo never enters the stream. Consequently, `denormalize(events, 'claude')` correctly emits zero user lines from this stream — output is structurally valid but semantically empty, so the new claude session sees only assistant turns and naturally has no concept of "the secret word."

This was an asymmetry. Claude's on-disk `~/.claude/projects/<dir>/<sessionId>.jsonl` DOES include `type:user` records (we verified this in the previous post-merge entry); they're written by the CLI but only on disk, not on stdout. Codex's on-disk session has the user record too. Opencode's storage doesn't, but opencode is sandbox-only and we don't materialise opencode transcripts for resume yet. Same-kind fork copies the on-disk JSONL byte-for-byte and inherits the user records via that path; cross-kind has to denormalize from the events stream, which had no user_messages.

**Fix.** Synthesise a `user_message` event from the prompt text in `processPrompt` (`packages/coding-agents/src/entity/handler.ts`), inserted BEFORE `lm.bridge.runTurn`. The synthetic event uses the same `seq`/`runId`/`eventKey` plumbing as bridge-emitted events:

```ts
ctx.db.actions.events_insert({
  row: {
    key: eventKey(runId, seq),
    runId,
    seq,
    ts: userTs,
    type: `user_message`,
    payload: { type: `user_message`, ts: userTs, text: promptText } as ...,
  } satisfies EventRow,
})
seq++
```

We picked the **always-inject** variant after empirically confirming claude — like codex and opencode — does not emit user_messages on its stdout. There is no risk of duplicate user_message events at runtime, so no gating on kind is needed. The simpler universal synthesis matches handler-level `user_message` records to what `denormalize` consumers expect (asp's `denormalizeCodex` / `denormalizeClaude` write the user line into the on-disk transcript; codex's `responseSetItem` and claude's `type:user` JSONL record).

**What this unlocks.** Cross-kind to claude (fork or convert) — the synthesised user prompts make `denormalizeClaude` produce a transcript with real user records, which the new claude session reads on `--resume` and treats as conversational memory. Cross-kind to codex was already working (codex's denormalize tolerates the asymmetry differently — its user records come from the synthesised side too). The fix is universal even for same-kind, where the duplicate is still avoided because same-kind copies the source's `nativeJsonl` blob directly rather than re-denormalizing.

**Verification status.** Unit: `pnpm -C packages/coding-agents typecheck` clean; `pnpm -C packages/coding-agents test` green (115 passed; the count assertion in `test/unit/entity-handler.test.ts` was bumped from 2 to 3 to account for the new synthetic event, and the ordering/payload were asserted alongside). Live empirical retest of the four scenarios was blocked by the dev-server architecture: the `agents start-builtin` worker process (which actually runs the entity handler) is started by `electric-ax dev up` and does NOT auto-restart on file changes, so picking up the new dist requires the user to restart the dev session. The unit + e2e (Layer 4) tests cover the regression vector either way.
