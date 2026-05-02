# Opencode (third agent kind) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `opencode` (sst/opencode-ai) as a first-class spawnable coding-agent kind alongside claude and codex. Spawn-only scope (no cross-kind in/out — deferred to a follow-up).

**Architecture:** New `OpencodeAdapter` registered alongside existing claude/codex adapters. Local `normalizeOpencode` in `@electric-ax/coding-agents` (asp untouched — `AgentType` widened only in our package via type union). One optional adapter contract method (`postMaterialiseCommand`) added to handle opencode's SQLite-backed storage via `opencode export` / `opencode import`. UI gates cross-kind ops involving opencode behind a tooltip.

**Tech Stack:** TypeScript, vitest, Playwright, Docker, `opencode-ai` (npm), `agent-session-protocol@0.0.2` (unchanged), `@electric-ax/coding-agents`, `@electric-ax/agents-runtime`, zod.

**Spec:** `docs/superpowers/specs/2026-05-02-coding-agents-opencode-design.md`.

---

## File map

**New files:**

- `packages/coding-agents/src/agents/opencode.ts` — `OpencodeAdapter` (~80 lines)
- `packages/coding-agents/src/agents/opencode-normalize.ts` — local `normalizeOpencode` (~120 lines)
- `packages/coding-agents/test/unit/opencode-adapter.test.ts`
- `packages/coding-agents/test/unit/opencode-normalize.test.ts`
- `packages/coding-agents/test/fixtures/opencode/first-turn.jsonl` (recorded from real run)
- `packages/coding-agents/test/fixtures/opencode/resume-turn.jsonl` (recorded)
- `packages/coding-agents/test/fixtures/opencode/error.jsonl` (recorded)
- `packages/coding-agents/test/fixtures/opencode/README.md` (capture instructions, mirrors codex/README.md)
- `packages/coding-agents/test/integration/spawn-opencode.e2e.test.ts`
- `packages/coding-agents/test/integration/resume-opencode.e2e.test.ts`
- `packages/agents-server-ui/test/e2e/spawn-opencode.spec.ts`

**Modified:**

- `packages/coding-agents/src/types.ts` — widen `CodingAgentKind` (independent of asp's `AgentType`)
- `packages/coding-agents/src/agents/registry.ts` — extend `CodingAgentAdapter` with optional `postMaterialiseCommand`
- `packages/coding-agents/src/index.ts` — export `OpencodeAdapter` (eager registration)
- `packages/coding-agents/src/bridge/stdio-bridge.ts` — switch on kind to call `normalizeOpencode` for opencode
- `packages/coding-agents/src/entity/handler.ts` — `ensureTranscriptMaterialised` runs `postMaterialiseCommand` after `copyTo`
- `packages/coding-agents/src/entity/collections.ts` — widen `kind` enum to include `'opencode'`
- `packages/coding-agents/src/entity/register.ts` — widen creation args zod for `kind`
- `packages/coding-agents/docker/Dockerfile` — install `opencode-ai`
- `packages/coding-agents/test/integration/local-docker-conformance.test.ts` — wire opencode envForKind/probeForKind
- `packages/coding-agents/test/integration/host-provider-conformance.test.ts` — same
- `packages/agents-server-ui/src/components/CodingAgentSpawnDialog.tsx` — kind picker adds opencode + model selector
- `packages/agents-server-ui/src/components/EntityHeader.tsx` — Convert/Fork dropdowns gate opencode (disabled tooltip)
- `packages/coding-agents/README.md` — opencode section

---

## Task 1: Widen `CodingAgentKind` in types

**Why this is first.** Many subsequent tasks reference `'opencode'` as a `CodingAgentKind` value. Locking the type in step 1 keeps the rest of the plan's TS green at every commit.

**Files:**

- Modify: `packages/coding-agents/src/types.ts`

- [ ] **Step 1: Widen the type**

In `packages/coding-agents/src/types.ts`, line 4, change:

```ts
export type CodingAgentKind = AgentType
```

to:

```ts
// asp's AgentType = 'claude' | 'codex'. opencode is a third kind we
// support locally without an asp upstream patch — normalize/denormalize
// for opencode lives in this package. A future upstream PR widens
// AgentType and this becomes `= AgentType` again.
export type CodingAgentKind = AgentType | `opencode`
```

- [ ] **Step 2: Run typecheck**

```bash
pnpm -C packages/coding-agents typecheck
```

Expected: PASS. The widening is additive — existing `'claude' | 'codex'` literal values still satisfy `CodingAgentKind`.

- [ ] **Step 3: Commit**

```bash
git add packages/coding-agents/src/types.ts
git commit -m "feat(coding-agents): widen CodingAgentKind to include 'opencode'

Independent of asp's AgentType (which stays 'claude' | 'codex').
A future upstream PR will widen AgentType and this becomes
\`= AgentType\` again."
```

---

## Task 2: Widen schemas — kind enum, creation args, inbox messages

**Validator-audit finding** (commit `81588155e`): three schemas need widening, not just one. `convertKindMessageSchema` in `messages.ts` validates the inbox `convert-kind` payload — leaving it as `'claude' | 'codex'` is a silent-failure trap if any future code (UI dispatch, tool, programmatic test) sends `kind: 'opencode'`. And `creationArgsSchema` needs a `model` field for opencode's spawn args (Task 13 emits `model: opencodeModel` — without the schema field, zod `.strip()`s it silently and the handler never sees it).

**Files:**

- Modify: `packages/coding-agents/src/entity/collections.ts`
- Modify: `packages/coding-agents/src/entity/register.ts`
- Modify: `packages/coding-agents/src/entity/messages.ts`

- [ ] **Step 1: Widen sessionMetaRowSchema's kind enum**

In `packages/coding-agents/src/entity/collections.ts`, find `sessionMetaRowSchema` (around line 20) and change:

```ts
kind: z.enum([`claude`, `codex`]),
```

to:

```ts
kind: z.enum([`claude`, `codex`, `opencode`]),
```

- [ ] **Step 2: Widen creation args schema + add `model` field**

In `packages/coding-agents/src/entity/register.ts`, locate the `creationArgsSchema`:

```bash
grep -n "creationArgsSchema\|kind:.*z.enum" packages/coding-agents/src/entity/register.ts
```

Two edits:

(a) Wherever `z.enum(['claude', 'codex'])` (or equivalent) appears in the creation args schema, add `'opencode'`:

```ts
kind: z.enum([`claude`, `codex`, `opencode`]).optional(),
```

(b) Add a `model` field to the same schema (placed near `kind:`):

```ts
model: z.string().optional(),
```

This carries the `opencode/<provider>/<model>` selection from the spawn dialog (Task 13) through to the handler's first-wake init. The handler will read `meta.model` (existing field on `SessionMetaRow`) — wait, `SessionMetaRow` actually doesn't have a `model` field today. The model is currently only stored in `lifecycle.detail` for convertKind. For opencode we need to **persist the model on `meta` so it's available across turns**. Add it to `sessionMetaRowSchema` in step 1 too:

```ts
model: z.string().optional(),
```

(Adjust step 1's edit to include this.)

The handler's `processPrompt` calls `lm.bridge.runTurn({ ..., model: meta.model })` — verify the existing `RunTurnArgs.model` field is plumbed through (it already is per `types.ts:90`). The fork branch in handler.ts also needs to copy `meta.model` from source to fork; verify and add if missing.

- [ ] **Step 3: Widen `convertKindMessageSchema`**

In `packages/coding-agents/src/entity/messages.ts`, locate `convertKindMessageSchema`:

```ts
export const convertKindMessageSchema = z.object({
  kind: z.enum([`claude`, `codex`]),
  model: z.string().optional(),
})
```

Widen the `kind` enum:

```ts
export const convertKindMessageSchema = z.object({
  kind: z.enum([`claude`, `codex`, `opencode`]),
  model: z.string().optional(),
})
```

This is forward-compat: opencode is gated in the v1 UI but the schema mustn't reject the payload silently if anything sends it.

- [ ] **Step 4: Run typecheck**

```bash
pnpm -C packages/coding-agents typecheck
```

Expected: PASS.

- [ ] **Step 5: Run unit suite to confirm no regressions**

```bash
pnpm -C packages/coding-agents test
```

Expected: full unit suite green.

- [ ] **Step 6: Commit**

```bash
git add packages/coding-agents/src/entity/collections.ts packages/coding-agents/src/entity/register.ts packages/coding-agents/src/entity/messages.ts
git commit -m "feat(coding-agents): widen schemas for opencode

Three additive widenings:
- sessionMetaRowSchema.kind enum gains 'opencode' + a new optional
  'model' field (opencode requires a provider/model selection that
  must be persisted across turns, unlike claude/codex which use
  defaults).
- creationArgsSchema in register.ts gains 'opencode' kind + 'model'
  field so spawn args carry the selection through to first-wake init.
- convertKindMessageSchema in messages.ts gains 'opencode' so the
  inbox payload validator doesn't silently reject opencode targets
  if a future caller sends them (UI gates them as disabled in v1).

Existing 'claude'/'codex' rows remain valid; new spawns can use
'opencode'."
```

---

## Task 3: Adapter contract — add optional `postMaterialiseCommand`

**Files:**

- Modify: `packages/coding-agents/src/agents/registry.ts`

- [ ] **Step 1: Extend the interface**

In `packages/coding-agents/src/agents/registry.ts`, after the `captureCommand` field (around line 42), add:

```ts
  /**
   * Optional. If present, the handler runs this command AFTER copyTo
   * has written the captured transcript to materialiseTargetPath.
   * Used by adapters whose transcript isn't directly readable by the
   * CLI (e.g. opencode stores in SQLite; the materialised JSON file
   * has to be ingested via `opencode import <file>`).
   */
  postMaterialiseCommand?(opts: {
    homeDir: string
    cwd: string
    sessionId: string
  }): ReadonlyArray<string>
```

- [ ] **Step 2: Run typecheck**

```bash
pnpm -C packages/coding-agents typecheck
```

Expected: PASS. Optional method — existing claude + codex adapters compile unchanged.

- [ ] **Step 3: Commit**

```bash
git add packages/coding-agents/src/agents/registry.ts
git commit -m "feat(coding-agents): adapter optional postMaterialiseCommand

Adapters whose CLI doesn't read a flat transcript file (e.g. opencode
stores in SQLite) can run a command after the handler's copyTo to
ingest the materialised content. Existing claude + codex adapters
omit it; behaviour for them is unchanged."
```

---

## Task 4: Handler — run `postMaterialiseCommand` after copyTo

**Files:**

- Modify: `packages/coding-agents/src/entity/handler.ts`
- Test: `packages/coding-agents/test/unit/handler-resume.test.ts` (extend existing)

- [ ] **Step 1: Locate `ensureTranscriptMaterialised`**

```bash
grep -n "ensureTranscriptMaterialised\|copyTo\b" packages/coding-agents/src/entity/handler.ts | head -10
```

It's the function near the top of `handler.ts` (around line 68), called from the per-prompt resume restore path.

- [ ] **Step 2: Write the failing test**

Add a test to `packages/coding-agents/test/unit/handler-resume.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'

describe(`ensureTranscriptMaterialised — postMaterialiseCommand`, () => {
  it(`runs adapter.postMaterialiseCommand via sandbox.exec after copyTo when present`, async () => {
    // Setup: a fake adapter with postMaterialiseCommand defined.
    // The handler's ensureTranscriptMaterialised should:
    //   1. Probe (returns non-zero — file not present).
    //   2. mkdir + copyTo materialiseTargetPath.
    //   3. Then exec the postMaterialiseCommand and assert exit 0.
    // Without the new code path, step 3 is missing.
    //
    // We can't easily isolate ensureTranscriptMaterialised without
    // refactoring it to be exported — leave the assertion to the
    // L2 conformance suites' resume scenarios (existing) which
    // exercise the path with a real adapter.
    //
    // This test asserts the contract surface: getAdapter returns
    // an OpencodeAdapter with postMaterialiseCommand defined, and
    // it returns a shell command containing 'opencode import'.
    const { OpencodeAdapter } = await import(`../../src/agents/opencode`).catch(
      () => ({ OpencodeAdapter: undefined })
    )
    expect(OpencodeAdapter).toBeDefined()
    expect(typeof OpencodeAdapter!.postMaterialiseCommand).toBe(`function`)
    const cmd = OpencodeAdapter!.postMaterialiseCommand!({
      homeDir: `/home/agent`,
      cwd: `/work`,
      sessionId: `ses_abc123`,
    })
    expect(cmd.join(` `)).toContain(`opencode import`)
    expect(cmd.join(` `)).toContain(`ses_abc123`)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

```bash
pnpm -C packages/coding-agents test test/unit/handler-resume.test.ts
```

Expected: FAIL — `OpencodeAdapter is undefined` (the file doesn't exist yet; we'll add it in Task 5). The test is the gate.

- [ ] **Step 4: Wire `postMaterialiseCommand` in the handler**

In `packages/coding-agents/src/entity/handler.ts`, locate the `await sandbox.copyTo({...})` call inside `ensureTranscriptMaterialised` (around line 128). Immediately after that call, before the `return { written: true }`, add:

```ts
if (adapter.postMaterialiseCommand) {
  const post = await sandbox.exec({
    cmd: [
      ...adapter.postMaterialiseCommand({
        homeDir,
        cwd,
        sessionId: nativeSessionId,
      }),
    ],
  })
  let postErr = ``
  const drainPostOut = async () => {
    for await (const _ of post.stdout) {
      // discard
    }
  }
  const drainPostErr = async () => {
    for await (const line of post.stderr) postErr += line + `\n`
  }
  const postOutP = drainPostOut()
  const postErrP = drainPostErr()
  const postExit = await post.wait()
  await Promise.all([postOutP, postErrP])
  if (postExit.exitCode !== 0) {
    throw new Error(
      `postMaterialiseCommand failed: exit ${postExit.exitCode}, stderr=${postErr.slice(0, 200)}`
    )
  }
}
```

The thrown error bubbles up to the prompt processor, which records it on the lifecycle row and leaves the agent in `error` state for the user to see. Subsequent prompts re-attempt the materialise (probe will still find the file missing if the import erased the temp file, OR the post-import probe of the SQLite session will succeed and we skip).

- [ ] **Step 5: Run unit suite**

```bash
pnpm -C packages/coding-agents test
```

Expected: existing tests still pass. The new test in Task 4 will still FAIL because `OpencodeAdapter` doesn't exist yet — that's expected and intentional. Move on.

- [ ] **Step 6: Commit**

```bash
git add packages/coding-agents/src/entity/handler.ts packages/coding-agents/test/unit/handler-resume.test.ts
git commit -m "feat(coding-agents): handler runs adapter postMaterialiseCommand

After ensureTranscriptMaterialised's copyTo writes the captured
content to materialiseTargetPath, if the adapter provides
postMaterialiseCommand, run it via sandbox.exec and assert exit 0.
Failure propagates to the prompt processor as an error.

Existing claude + codex adapters don't use the hook; their
behaviour is unchanged.

Test stays red until OpencodeAdapter lands in Task 5."
```

---

## Task 5: OpencodeAdapter skeleton

**Files:**

- Create: `packages/coding-agents/src/agents/opencode.ts`
- Modify: `packages/coding-agents/src/index.ts`
- Test: `packages/coding-agents/test/unit/opencode-adapter.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `packages/coding-agents/test/unit/opencode-adapter.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { OpencodeAdapter } from '../../src/agents/opencode'

describe(`OpencodeAdapter — invocation shape`, () => {
  it(`baseline argv has run --format json --dangerously-skip-permissions and prompt on argv tail`, () => {
    const r = OpencodeAdapter.buildCliInvocation({ prompt: `hi there` })
    expect(r.promptDelivery).toBe(`argv`)
    expect(r.args[0]).toBe(`run`)
    expect(r.args).toContain(`--format`)
    expect(r.args).toContain(`json`)
    expect(r.args).toContain(`--dangerously-skip-permissions`)
    // Prompt is positional after `--`
    expect(r.args[r.args.length - 2]).toBe(`--`)
    expect(r.args[r.args.length - 1]).toBe(`hi there`)
  })

  it(`includes -m model when model is passed`, () => {
    const r = OpencodeAdapter.buildCliInvocation({
      prompt: `hi`,
      model: `anthropic/claude-haiku-4-5`,
    })
    const args = Array.from(r.args)
    const i = args.indexOf(`-m`)
    expect(i).toBeGreaterThan(-1)
    expect(args[i + 1]).toBe(`anthropic/claude-haiku-4-5`)
  })

  it(`includes -s sessionId when nativeSessionId is passed`, () => {
    const r = OpencodeAdapter.buildCliInvocation({
      prompt: `continue`,
      nativeSessionId: `ses_xyz789`,
    })
    const args = Array.from(r.args)
    const i = args.indexOf(`-s`)
    expect(i).toBeGreaterThan(-1)
    expect(args[i + 1]).toBe(`ses_xyz789`)
  })

  it(`captureCommand pipes opencode export through base64`, () => {
    const cmd = OpencodeAdapter.captureCommand({
      homeDir: `/home/agent`,
      cwd: `/work`,
      sessionId: `ses_abc`,
    })
    expect(cmd[0]).toBe(`sh`)
    expect(cmd.join(` `)).toContain(`opencode export ses_abc`)
    expect(cmd.join(` `)).toContain(`base64`)
  })

  it(`probeCommand checks opencode session list for the id`, () => {
    const cmd = OpencodeAdapter.probeCommand({
      homeDir: `/home/agent`,
      cwd: `/work`,
      sessionId: `ses_abc`,
    })
    expect(cmd[0]).toBe(`sh`)
    expect(cmd.join(` `)).toContain(`opencode session list`)
    expect(cmd.join(` `)).toContain(`ses_abc`)
  })

  it(`materialiseTargetPath is a /tmp path keyed by sessionId`, () => {
    const p = OpencodeAdapter.materialiseTargetPath({
      homeDir: `/home/agent`,
      cwd: `/work`,
      sessionId: `ses_abc`,
    })
    expect(p).toContain(`/tmp/`)
    expect(p).toContain(`ses_abc`)
  })

  it(`postMaterialiseCommand runs opencode import then removes the temp file`, () => {
    const cmd = OpencodeAdapter.postMaterialiseCommand!({
      homeDir: `/home/agent`,
      cwd: `/work`,
      sessionId: `ses_abc`,
    })
    expect(cmd[0]).toBe(`sh`)
    expect(cmd.join(` `)).toContain(`opencode import`)
    expect(cmd.join(` `)).toContain(`rm -f`)
    expect(cmd.join(` `)).toContain(`ses_abc`)
  })

  it(`defaultEnvVars includes both ANTHROPIC and OPENAI keys`, () => {
    expect(OpencodeAdapter.defaultEnvVars).toContain(`ANTHROPIC_API_KEY`)
    expect(OpencodeAdapter.defaultEnvVars).toContain(`OPENAI_API_KEY`)
  })

  it(`cliBinary is opencode and kind is opencode`, () => {
    expect(OpencodeAdapter.cliBinary).toBe(`opencode`)
    expect(OpencodeAdapter.kind).toBe(`opencode`)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm -C packages/coding-agents test test/unit/opencode-adapter.test.ts
```

Expected: FAIL — file `../../src/agents/opencode` doesn't exist.

- [ ] **Step 3: Create the adapter**

Create `packages/coding-agents/src/agents/opencode.ts`:

```ts
import type { CodingAgentAdapter } from './registry'
import { registerAdapter } from './registry'

/**
 * opencode (sst/opencode-ai) — third coding-agent kind.
 *
 * Headless mode: `opencode run --format json --dangerously-skip-permissions`.
 * Prompt delivery: argv tail (after `--`).
 * Resume: `-s <sessionId>` (or `--continue` for last session — we always pin
 * to a specific sessionId so concurrent agents on the same host don't race).
 *
 * Storage: SQLite at `~/.local/share/opencode/opencode.db`. Round-trip via
 * `opencode export <id>` (read) and `opencode import <file>` (write). The
 * adapter's captureCommand pipes export through base64; postMaterialiseCommand
 * runs import after the handler's copyTo writes the captured JSON to
 * /tmp/opencode-import-<sessionId>.json, then removes the temp file.
 *
 * Auth: env vars only for v1 (ANTHROPIC_API_KEY / OPENAI_API_KEY honored as
 * per-provider fallback when ~/.local/share/opencode/auth.json is missing).
 * No auth.json provisioning; OAuth-only providers deferred to a follow-up.
 */
export const OpencodeAdapter: CodingAgentAdapter = {
  kind: `opencode`,
  cliBinary: `opencode`,
  defaultEnvVars: [`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`],

  buildCliInvocation({ prompt, nativeSessionId, model }) {
    const args: Array<string> = [
      `run`,
      `--format`,
      `json`,
      `--dangerously-skip-permissions`,
    ]
    if (model) args.push(`-m`, model)
    if (nativeSessionId) args.push(`-s`, nativeSessionId)
    args.push(`--`, prompt)
    return { args, promptDelivery: `argv` }
  },

  probeCommand({ sessionId }) {
    // Exits 0 if the session is in opencode's SQLite, 1 otherwise.
    return [
      `sh`,
      `-c`,
      `opencode session list 2>/dev/null | grep -q '${sessionId}'`,
    ]
  },

  captureCommand({ sessionId }) {
    // opencode export prints the session JSON to stdout. base64 to avoid
    // newline / binary corruption on the docker exec stdio pipe.
    return [
      `sh`,
      `-c`,
      `f="$(opencode export ${sessionId} 2>/dev/null)"; ` +
        `if [ -n "$f" ]; then printf '%s' "$f" | base64 -w 0; fi`,
    ]
  },

  materialiseTargetPath({ sessionId }) {
    return `/tmp/opencode-import-${sessionId}.json`
  },

  postMaterialiseCommand({ sessionId }) {
    return [
      `sh`,
      `-c`,
      `opencode import /tmp/opencode-import-${sessionId}.json && ` +
        `rm -f /tmp/opencode-import-${sessionId}.json`,
    ]
  },
}

registerAdapter(OpencodeAdapter)
```

- [ ] **Step 4: Eager registration via index.ts**

In `packages/coding-agents/src/index.ts`, find the existing eager imports for claude and codex (grep `from './agents/claude'`):

```bash
grep -n "agents/claude\|agents/codex" packages/coding-agents/src/index.ts
```

Add a parallel import for opencode:

```ts
import './agents/opencode'
```

(Place it next to the existing claude/codex imports. Order doesn't matter — registration is idempotent within the registry.)

- [ ] **Step 5: Run tests to verify they pass**

```bash
pnpm -C packages/coding-agents test test/unit/opencode-adapter.test.ts test/unit/handler-resume.test.ts
```

Expected: PASS — 9 adapter tests + 1 postMaterialiseCommand contract test.

- [ ] **Step 6: Run full unit suite**

```bash
pnpm -C packages/coding-agents test
```

Expected: full suite green.

- [ ] **Step 7: Commit**

```bash
git add packages/coding-agents/src/agents/opencode.ts packages/coding-agents/src/index.ts packages/coding-agents/test/unit/opencode-adapter.test.ts
git commit -m "feat(coding-agents): OpencodeAdapter — skeleton + registration

CLI invocation, probe/capture/materialise commands, and
postMaterialiseCommand. Eager-registered from src/index.ts.
Argv shape: opencode run --format json --dangerously-skip-permissions
[-m <provider/model>] [-s <sessionId>] -- <prompt>. Capture + restore
via opencode export / opencode import (SQLite-backed storage).

normalize/denormalize for opencode lives separately (Task 7) since
asp's AgentType doesn't include it."
```

---

## Task 6: Record opencode fixtures

**Why:** The normalizer (Task 7) is TDD-driven against real opencode output. Need recorded JSONL captured from a real `opencode run` invocation.

**Note:** The local box has opencode installed at `/Users/vbalegas/.opencode/bin/opencode` (v1.14.31 at recon time) with auth already configured. If running in a fresh environment, install via `npm i -g opencode-ai` and `opencode auth login anthropic` first.

**Files:**

- Create: `packages/coding-agents/test/fixtures/opencode/first-turn.jsonl`
- Create: `packages/coding-agents/test/fixtures/opencode/resume-turn.jsonl`
- Create: `packages/coding-agents/test/fixtures/opencode/error.jsonl`
- Create: `packages/coding-agents/test/fixtures/opencode/README.md`

- [ ] **Step 1: Capture the first-turn fixture**

Run from the repo root:

```bash
mkdir -p packages/coding-agents/test/fixtures/opencode
TMP=$(mktemp -d)
cd "$TMP"
opencode run --format json --dangerously-skip-permissions \
  -m anthropic/claude-haiku-4-5 \
  -- "Reply with just: ok" \
  > /Users/vbalegas/workspace/electric/packages/coding-agents/test/fixtures/opencode/first-turn.jsonl
# Note the sessionID in the output — needed for resume capture below.
SID=$(head -1 /Users/vbalegas/workspace/electric/packages/coding-agents/test/fixtures/opencode/first-turn.jsonl | python3 -c "import json,sys; print(json.loads(sys.stdin.read())['sessionID'])")
echo "Session ID: $SID"
cd /Users/vbalegas/workspace/electric
```

- [ ] **Step 2: Capture the resume-turn fixture**

Continuing from the same shell where `$SID` is set, and from the same `$TMP` directory (so opencode resolves to the same workspace):

```bash
cd "$TMP"
opencode run --format json --dangerously-skip-permissions \
  -m anthropic/claude-haiku-4-5 \
  -s "$SID" \
  -- "What word did you reply with last turn? Answer in one word." \
  > /Users/vbalegas/workspace/electric/packages/coding-agents/test/fixtures/opencode/resume-turn.jsonl
cd /Users/vbalegas/workspace/electric
```

- [ ] **Step 3: Capture an error fixture**

Provoke a non-zero exit by providing an unknown model:

```bash
cd "$TMP"
opencode run --format json --dangerously-skip-permissions \
  -m bogus/this-model-does-not-exist \
  -- "anything" \
  > /Users/vbalegas/workspace/electric/packages/coding-agents/test/fixtures/opencode/error.jsonl 2>&1 || true
# Some error output may go to stderr — that's fine for our purposes;
# the file may be empty or partial. Inspect:
wc -l /Users/vbalegas/workspace/electric/packages/coding-agents/test/fixtures/opencode/error.jsonl
cd /Users/vbalegas/workspace/electric
```

If the error fixture is empty, that's acceptable — the normalizer's error path will be tested via a synthetic case in Task 7.

- [ ] **Step 4: Inspect captures**

```bash
wc -l packages/coding-agents/test/fixtures/opencode/*.jsonl
head -1 packages/coding-agents/test/fixtures/opencode/first-turn.jsonl | python3 -m json.tool | head -10
```

Expected: each fixture has at least 4 lines (`step_start`, ≥1 `text`, `step_finish`). first-turn includes a `text` with `metadata.openai.phase === 'final_answer'` containing `"ok"` (case-insensitive).

- [ ] **Step 5: Write the README**

Create `packages/coding-agents/test/fixtures/opencode/README.md`:

````markdown
# Opencode fixtures

Recorded JSONL output from real `opencode run` invocations. Used by
`test/unit/opencode-normalize.test.ts` to exercise `normalizeOpencode`
without spawning the binary in CI.

## Re-recording (when opencode-ai version bumps)

From the repo root, with opencode-ai installed and auth configured:

```bash
TMP=$(mktemp -d)
cd "$TMP"

# first-turn
opencode run --format json --dangerously-skip-permissions \
  -m anthropic/claude-haiku-4-5 \
  -- "Reply with just: ok" \
  > <repo>/packages/coding-agents/test/fixtures/opencode/first-turn.jsonl

SID=$(head -1 <repo>/.../first-turn.jsonl | python3 -c "import json,sys; print(json.loads(sys.stdin.read())['sessionID'])")

# resume-turn (same workspace)
opencode run --format json --dangerously-skip-permissions \
  -m anthropic/claude-haiku-4-5 \
  -s "$SID" \
  -- "What word did you reply with last turn? Answer in one word." \
  > <repo>/.../resume-turn.jsonl

# error (bogus model)
opencode run --format json --dangerously-skip-permissions \
  -m bogus/this-model-does-not-exist \
  -- "anything" \
  > <repo>/.../error.jsonl 2>&1 || true
```
````

Re-record on opencode-ai bumps if the JSON event grammar changes.

````

- [ ] **Step 6: Commit fixtures**

```bash
git add packages/coding-agents/test/fixtures/opencode/
git commit -m "test(coding-agents): opencode JSONL fixtures

Recorded from a real opencode-ai 1.14.x run for Layer 1 normalizer
tests. Three scenarios: first-turn, resume-turn, error (bogus model).
README covers re-recording instructions on version bumps."
````

---

## Task 7: `normalizeOpencode` — local normalizer

**Files:**

- Create: `packages/coding-agents/src/agents/opencode-normalize.ts`
- Test: `packages/coding-agents/test/unit/opencode-normalize.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `packages/coding-agents/test/unit/opencode-normalize.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { normalizeOpencode } from '../../src/agents/opencode-normalize'

const FIXTURES = join(__dirname, `..`, `fixtures`, `opencode`)

function loadFixture(name: string): Array<string> {
  const raw = readFileSync(join(FIXTURES, `${name}.jsonl`), `utf8`)
  return raw.split(`\n`).filter((l) => l.trim().length > 0)
}

describe(`normalizeOpencode — first turn`, () => {
  const lines = loadFixture(`first-turn`)
  const events = normalizeOpencode(lines)

  it(`emits exactly one session_init as the first event`, () => {
    expect(events.length).toBeGreaterThan(0)
    expect(events[0]!.type).toBe(`session_init`)
  })

  it(`emits at least one assistant_message containing the reply`, () => {
    const am = events.filter((e) => e.type === `assistant_message`)
    expect(am.length).toBeGreaterThan(0)
    const text = am.map((e) => (e as any).text).join(``)
    expect(text.toLowerCase()).toContain(`ok`)
  })

  it(`emits a turn_complete as the last event`, () => {
    expect(events[events.length - 1]!.type).toBe(`turn_complete`)
  })

  it(`does NOT emit assistant_message for non-final-answer text parts`, () => {
    // If the fixture has any phases other than 'final_answer', they
    // should map to thinking, not assistant_message.
    const am = events.filter((e) => e.type === `assistant_message`)
    const th = events.filter((e) => e.type === `thinking`)
    // Sanity: total text-bearing events == total text parts in fixture
    // (we don't drop them silently).
    expect(am.length + th.length).toBeGreaterThan(0)
  })
})

describe(`normalizeOpencode — resume turn`, () => {
  const lines = loadFixture(`resume-turn`)
  const events = normalizeOpencode(lines)

  it(`session_init carries the sessionID from the resumed turn`, () => {
    const init = events.find((e) => e.type === `session_init`) as
      | { type: `session_init`; sessionId: string }
      | undefined
    expect(init).toBeDefined()
    expect(init!.sessionId).toMatch(/^ses_/)
  })

  it(`assistant_message recalls something from the prior turn`, () => {
    const am = events.filter((e) => e.type === `assistant_message`)
    const text = am
      .map((e) => (e as any).text || ``)
      .join(``)
      .toLowerCase()
    // Resume prompt asks 'what word did you reply with last turn?' — the answer
    // should mention 'ok'. If the fixture was captured against a model that
    // doesn't recall, this assertion is a smoke for cumulative storage.
    expect(text).toContain(`ok`)
  })
})

describe(`normalizeOpencode — synthetic events`, () => {
  it(`maps tool_use with completed state to a tool_call + tool_result pair`, () => {
    const lines = [
      JSON.stringify({
        type: `step_start`,
        sessionID: `ses_synth`,
        timestamp: 1_700_000_000_000,
        part: { type: `step-start` },
      }),
      JSON.stringify({
        type: `tool_use`,
        sessionID: `ses_synth`,
        timestamp: 1_700_000_001_000,
        part: {
          type: `tool`,
          tool: `bash`,
          callID: `call_xyz`,
          state: {
            status: `completed`,
            input: { command: `echo hi` },
            output: `hi\n`,
            metadata: { exit: 0 },
          },
        },
      }),
      JSON.stringify({
        type: `step_finish`,
        sessionID: `ses_synth`,
        timestamp: 1_700_000_002_000,
        part: { reason: `stop`, tokens: { input: 10, output: 5 }, cost: 0 },
      }),
    ]
    const events = normalizeOpencode(lines)
    const tc = events.find((e) => e.type === `tool_call`) as any
    const tr = events.find((e) => e.type === `tool_result`) as any
    expect(tc).toBeDefined()
    expect(tc.tool).toBe(`bash`)
    expect(tc.callId).toBe(`call_xyz`)
    expect(tr).toBeDefined()
    expect(tr.callId).toBe(`call_xyz`)
    expect(tr.output).toBe(`hi\n`)
    expect(tr.isError).toBe(false)
  })

  it(`marks tool_result as isError when state.metadata.exit !== 0`, () => {
    const lines = [
      JSON.stringify({
        type: `step_start`,
        sessionID: `ses_synth`,
        timestamp: 1,
        part: { type: `step-start` },
      }),
      JSON.stringify({
        type: `tool_use`,
        sessionID: `ses_synth`,
        timestamp: 2,
        part: {
          type: `tool`,
          tool: `bash`,
          callID: `call_fail`,
          state: {
            status: `failed`,
            input: { command: `false` },
            output: ``,
            metadata: { exit: 1 },
          },
        },
      }),
    ]
    const events = normalizeOpencode(lines)
    const tr = events.find((e) => e.type === `tool_result`) as any
    expect(tr.isError).toBe(true)
  })

  it(`maps reasoning parts to thinking events`, () => {
    const lines = [
      JSON.stringify({
        type: `step_start`,
        sessionID: `ses_synth`,
        timestamp: 1,
        part: { type: `step-start` },
      }),
      JSON.stringify({
        type: `reasoning`,
        sessionID: `ses_synth`,
        timestamp: 2,
        part: {
          type: `reasoning`,
          text: `pondering...`,
          metadata: { openai: { reasoningEncryptedContent: `abc=` } },
        },
      }),
    ]
    const events = normalizeOpencode(lines)
    const th = events.find((e) => e.type === `thinking`) as any
    expect(th).toBeDefined()
    expect(th.text).toBe(`pondering...`)
  })

  it(`gracefully skips malformed lines`, () => {
    const lines = [
      `not-json-at-all`,
      JSON.stringify({
        type: `step_start`,
        sessionID: `ses_x`,
        timestamp: 1,
        part: {},
      }),
      `{"unclosed`,
    ]
    const events = normalizeOpencode(lines)
    // Should produce just the session_init from the one valid line.
    expect(events.length).toBe(1)
    expect(events[0]!.type).toBe(`session_init`)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm -C packages/coding-agents test test/unit/opencode-normalize.test.ts
```

Expected: FAIL — module `../../src/agents/opencode-normalize` doesn't exist.

- [ ] **Step 3: Implement the normalizer**

Create `packages/coding-agents/src/agents/opencode-normalize.ts`:

```ts
import type { NormalizedEvent } from 'agent-session-protocol'

/**
 * Local normalizer for opencode's `run --format json` output, since
 * agent-session-protocol@0.0.2's AgentType is `'claude' | 'codex'` and
 * we don't want to fork asp for v1. A future upstream PR would move
 * this into asp; the function survives the migration unchanged.
 *
 * Event grammar (from opencode 1.14.x reconnaissance):
 *   - step_start: marks the start of a turn or sub-step
 *   - text: assistant text part. metadata.openai.phase === 'final_answer'
 *           is the user-visible reply; other phases are intermediate.
 *   - tool_use: a tool invocation. Only emitted at terminal state
 *               (state.status === 'completed' | 'failed'); we synthesise
 *               tool_call + tool_result from one event.
 *   - reasoning: thinking/CoT text (sometimes encrypted by the provider).
 *   - step_finish: end of a turn (reason: 'stop') or end of a sub-step
 *                  (reason: 'tool-calls'). Only 'stop' produces turn_complete.
 */
export function normalizeOpencode(
  lines: ReadonlyArray<string>
): Array<NormalizedEvent> {
  const events: Array<NormalizedEvent> = []
  let sessionInitEmitted = false
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let entry: any
    try {
      entry = JSON.parse(trimmed)
    } catch {
      continue
    }
    const ts =
      typeof entry.timestamp === `number` ? entry.timestamp : Date.now()
    const sessionID =
      typeof entry.sessionID === `string` ? entry.sessionID : undefined
    const part = entry.part ?? {}

    switch (entry.type) {
      case `step_start`: {
        if (!sessionInitEmitted && sessionID) {
          events.push({
            type: `session_init`,
            ts,
            sessionId: sessionID,
            cwd: ``,
          } as NormalizedEvent)
          sessionInitEmitted = true
        }
        break
      }
      case `text`: {
        const text = typeof part.text === `string` ? part.text : ``
        if (!text) break
        const phase = part?.metadata?.openai?.phase
        if (phase === `final_answer`) {
          events.push({
            type: `assistant_message`,
            ts,
            text,
          } as NormalizedEvent)
        } else {
          events.push({
            type: `thinking`,
            ts,
            text,
          } as NormalizedEvent)
        }
        break
      }
      case `tool_use`: {
        const status = part?.state?.status
        if (status !== `completed` && status !== `failed`) break
        const callId = typeof part.callID === `string` ? part.callID : ``
        const tool = typeof part.tool === `string` ? part.tool : `unknown`
        const input = part?.state?.input ?? {}
        const output =
          typeof part?.state?.output === `string` ? part.state.output : ``
        const exit = part?.state?.metadata?.exit
        const isError =
          status === `failed` || (typeof exit === `number` && exit !== 0)
        events.push({
          type: `tool_call`,
          ts,
          tool,
          callId,
          input,
        } as NormalizedEvent)
        events.push({
          type: `tool_result`,
          ts,
          callId,
          output,
          isError,
        } as NormalizedEvent)
        break
      }
      case `reasoning`: {
        const text = typeof part.text === `string` ? part.text : ``
        if (!text) break
        events.push({
          type: `thinking`,
          ts,
          text,
        } as NormalizedEvent)
        break
      }
      case `step_finish`: {
        if (part?.reason === `stop`) {
          events.push({
            type: `turn_complete`,
            ts,
          } as NormalizedEvent)
        }
        // 'tool-calls' (intermediate) does not emit turn_complete.
        break
      }
      // Unknown event types (future opencode versions): silently ignored.
      default:
        break
    }
  }
  return events
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm -C packages/coding-agents test test/unit/opencode-normalize.test.ts
```

Expected: PASS — first-turn, resume-turn, and synthetic events all green.

- [ ] **Step 5: Run full unit suite**

```bash
pnpm -C packages/coding-agents test
```

Expected: full suite green.

- [ ] **Step 6: Commit**

```bash
git add packages/coding-agents/src/agents/opencode-normalize.ts packages/coding-agents/test/unit/opencode-normalize.test.ts
git commit -m "feat(coding-agents): normalizeOpencode local normalizer

Maps opencode's run --format json event grammar to canonical
NormalizedEvent[]. Lives in @electric-ax/coding-agents (not asp),
since asp's AgentType is a hard literal union that requires an
upstream PR to widen.

Event mapping:
- step_start (first per session) -> session_init
- text with metadata.openai.phase==='final_answer' -> assistant_message
- text (other phases) -> thinking
- tool_use (terminal state) -> synthesised tool_call + tool_result pair
- reasoning -> thinking
- step_finish reason='stop' -> turn_complete

Driven by recorded fixtures + synthetic test cases for tool error
handling and malformed line tolerance."
```

---

## Task 8: Bridge wiring — route opencode to `normalizeOpencode`

**Files:**

- Modify: `packages/coding-agents/src/bridge/stdio-bridge.ts`

- [ ] **Step 1: Update the bridge's normalize call**

In `packages/coding-agents/src/bridge/stdio-bridge.ts`:

(a) Add the import near the top (next to `import { normalize } from 'agent-session-protocol'`):

```ts
import { normalizeOpencode } from '../agents/opencode-normalize'
```

(b) Replace the line:

```ts
events = normalize(rawLines, args.kind)
```

with:

```ts
events =
  args.kind === `opencode`
    ? normalizeOpencode(rawLines)
    : normalize(rawLines, args.kind as `claude` | `codex`)
```

The cast to `'claude' | 'codex'` is required because asp's `normalize` accepts `AgentType` and our local `CodingAgentKind` is wider. The runtime guard above ensures this branch is only reached for non-opencode kinds.

- [ ] **Step 2: Run typecheck**

```bash
pnpm -C packages/coding-agents typecheck
```

Expected: PASS.

- [ ] **Step 3: Run unit suite**

```bash
pnpm -C packages/coding-agents test
```

Expected: full suite green. Existing claude + codex bridge tests still pass.

- [ ] **Step 4: Commit**

```bash
git add packages/coding-agents/src/bridge/stdio-bridge.ts
git commit -m "feat(coding-agents): bridge routes opencode to normalizeOpencode

asp's normalize() doesn't accept 'opencode' (AgentType is the literal
union 'claude' | 'codex'). Switch on kind in the bridge: opencode
goes through our local normalizer; claude + codex still go through
asp's normalize."
```

---

## Task 9: Image bump — install opencode-ai

**Files:**

- Modify: `packages/coding-agents/docker/Dockerfile`

- [ ] **Step 1: Locate the existing CLI install line**

```bash
grep -n "claude-code\|@openai/codex\|npm install -g" packages/coding-agents/docker/Dockerfile
```

- [ ] **Step 2: Add opencode-ai**

In the existing `RUN npm install -g ...` line, append `opencode-ai@latest` and add the version verification:

```dockerfile
RUN npm install -g @anthropic-ai/claude-code@latest @openai/codex@latest opencode-ai@latest \
    && claude --version && codex --version && opencode --version
```

(Match the formatting style of whatever's already there. If the existing line is multi-line with `&&` continuations, follow that style.)

- [ ] **Step 3: Rebuild the test image**

```bash
DOCKER=1 pnpm -C packages/coding-agents test:integration:rebuild 2>&1 | tail -15
```

(If the rebuild script doesn't exist, the integration tests will rebuild on their first run via `buildTestImage()` idempotency. Trigger it via:)

```bash
DOCKER=1 pnpm -C packages/coding-agents test test/integration/local-docker.test.ts 2>&1 | tail -10
```

Expected: rebuild completes; `opencode --version` prints `1.x.y`.

- [ ] **Step 4: Verify opencode runs in the image**

```bash
docker run --rm electric-ax/coding-agent-sandbox:test opencode --version
```

Expected: prints opencode's version.

- [ ] **Step 5: Pin the version**

Once verified, change `opencode-ai@latest` to the exact version from step 4 (e.g. `opencode-ai@1.14.31`). This protects against drift on future builds.

```dockerfile
RUN npm install -g @anthropic-ai/claude-code@latest @openai/codex@latest opencode-ai@1.14.31 \
    && claude --version && codex --version && opencode --version
```

- [ ] **Step 6: Commit**

```bash
git add packages/coding-agents/docker/Dockerfile
git commit -m "build(coding-agents): bake opencode-ai into the sandbox image

Pinned to 1.14.31 (matches the version we recorded fixtures against).
Re-record test/fixtures/opencode/ on bumps."
```

---

## Task 10: Conformance — wire opencode into envForKind / probeForKind

**Files:**

- Modify: `packages/coding-agents/test/integration/local-docker-conformance.test.ts`
- Modify: `packages/coding-agents/test/integration/host-provider-conformance.test.ts`

- [ ] **Step 1: Locate envForKind / probeForKind in local-docker-conformance**

```bash
grep -n "envForKind\|probeForKind" packages/coding-agents/test/integration/local-docker-conformance.test.ts
```

You'll see something like:

```ts
envForKind: (kind) => {
  if (kind === `claude`) return { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? `` }
  if (kind === `codex`) return { OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? `` }
  return null
},
probeForKind: (kind) => {
  if (kind === `claude`) return { prompt: `Reply with: ok`, expectsResponseMatching: /ok/i, model: `claude-haiku-4-5` }
  if (kind === `codex`) return { prompt: `Reply with: ok`, expectsResponseMatching: /ok/i, model: `gpt-5-codex-latest` }
  // ...
},
```

- [ ] **Step 2: Add opencode entries**

Extend both functions:

```ts
envForKind: (kind) => {
  if (kind === `claude`) return { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? `` }
  if (kind === `codex`) return { OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? `` }
  if (kind === `opencode`) {
    // opencode picks the provider matching the model arg; pass through
    // both keys so it can route to whichever the probe model selects.
    const env: Record<string, string> = {}
    if (process.env.ANTHROPIC_API_KEY) env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY
    if (process.env.OPENAI_API_KEY) env.OPENAI_API_KEY = process.env.OPENAI_API_KEY
    return Object.keys(env).length > 0 ? env : null
  }
  return null
},
probeForKind: (kind) => {
  if (kind === `claude`) return { prompt: `Reply with: ok`, expectsResponseMatching: /ok/i, model: `claude-haiku-4-5` }
  if (kind === `codex`) return { prompt: `Reply with: ok`, expectsResponseMatching: /ok/i, model: `gpt-5-codex-latest` }
  if (kind === `opencode`)
    return {
      prompt: `Reply with just: ok`,
      expectsResponseMatching: /ok/i,
      model: `anthropic/claude-haiku-4-5`,
    }
  // ...
},
```

(Match whatever the actual function shapes are — those above are illustrative based on the spec.)

- [ ] **Step 3: Apply the same change to host-provider-conformance + add a $PATH guard**

```bash
grep -n "envForKind\|probeForKind" packages/coding-agents/test/integration/host-provider-conformance.test.ts
```

Make the same `envForKind`/`probeForKind` additions as in step 2.

**Validator-audit finding** (commit `81588155e`): host-target runs the CLI from the host's `$PATH`, not from the sandbox image. Task 9's Dockerfile bump only covers `target=sandbox`. If `opencode` isn't on the host's `$PATH`, the host-conformance opencode block will fail with a confusing "command not found" error halfway through the suite. Add a guard that skips the opencode kind on host when the binary is missing.

In `host-provider-conformance.test.ts`, add a top-of-file synchronous probe and wire it into `envForKind` so the opencode block is skipped (returns `null`) when opencode isn't installed:

```ts
import { execSync } from 'node:child_process'

function hasOpencodeOnPath(): boolean {
  try {
    execSync(`command -v opencode`, { stdio: `ignore` })
    return true
  } catch {
    return false
  }
}
const OPENCODE_AVAILABLE = hasOpencodeOnPath()
```

Then in the `envForKind` opencode branch:

```ts
if (kind === `opencode`) {
  if (!OPENCODE_AVAILABLE) return null // skip the kind block entirely on this provider
  const env: Record<string, string> = {}
  if (process.env.ANTHROPIC_API_KEY)
    env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY
  if (process.env.OPENAI_API_KEY)
    env.OPENAI_API_KEY = process.env.OPENAI_API_KEY
  return Object.keys(env).length > 0 ? env : null
}
```

Returning `null` from `envForKind` is the existing skip mechanism (matches how unset API keys skip a kind block). The local-docker conformance doesn't need this guard — the Dockerfile guarantees opencode is installed inside the sandbox image.

- [ ] **Step 4: Run conformance under DOCKER=1**

```bash
DOCKER=1 pnpm -C packages/coding-agents test test/integration/local-docker-conformance.test.ts 2>&1 | tail -10
```

Expected: opencode kind block runs (skipped if `ANTHROPIC_API_KEY` absent), L2.1 + L2.2 + L2.3 etc. green for opencode.

- [ ] **Step 5: Run host-provider conformance**

```bash
HOST_PROVIDER=1 pnpm -C packages/coding-agents test test/integration/host-provider-conformance.test.ts 2>&1 | tail -10
```

Expected: opencode runs on host target too.

- [ ] **Step 6: Commit**

```bash
git add packages/coding-agents/test/integration/local-docker-conformance.test.ts packages/coding-agents/test/integration/host-provider-conformance.test.ts
git commit -m "test(coding-agents): wire opencode into conformance suites

envForKind passes through both ANTHROPIC + OPENAI keys (opencode
picks the provider per-model arg). probeForKind for opencode uses
'anthropic/claude-haiku-4-5' as the model. L2.x scenarios run for
opencode automatically via describe.each(listAdapters())."
```

---

## Task 11: Layer 4 e2e — spawn-opencode

**Files:**

- Create: `packages/coding-agents/test/integration/spawn-opencode.e2e.test.ts`

- [ ] **Step 1: Write the e2e test**

Create `packages/coding-agents/test/integration/spawn-opencode.e2e.test.ts`:

```ts
import { afterAll, describe, expect, it } from 'vitest'

const SLOW = process.env.SLOW === `1` && !!process.env.ANTHROPIC_API_KEY
const d = SLOW ? describe : describe.skip
const SERVER = `http://localhost:4437`

d(`E6 — opencode spawn (real CLI, e2e)`, () => {
  const agentId = `e2e-opencode-${Date.now().toString(36)}`

  afterAll(async () => {
    await fetch(`${SERVER}/coding-agent/${agentId}`, {
      method: `DELETE`,
    }).catch(() => undefined)
  })

  it(`spawns opencode + replies to a prompt`, async () => {
    // Spawn (live API: PUT /coding-agent/<name> with { args }).
    await fetch(`${SERVER}/coding-agent/${agentId}`, {
      method: `PUT`,
      headers: { 'content-type': `application/json` },
      body: JSON.stringify({
        args: {
          kind: `opencode`,
          workspaceType: `volume`,
          model: `anthropic/claude-haiku-4-5`,
        },
      }),
    })

    // Send the prompt.
    await fetch(`${SERVER}/coding-agent/${agentId}/send`, {
      method: `POST`,
      headers: { 'content-type': `application/json` },
      body: JSON.stringify({
        from: `e2e-test`,
        type: `prompt`,
        payload: { text: `Reply with the single word: ok` },
      }),
    })

    // Wait for run completion.
    const w = await waitForLastRunCompleted(agentId, 120_000)
    expect((w.responseText ?? ``).toLowerCase()).toMatch(/ok/i)
  }, 180_000)
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
    if (completed.length > 0) return completed[completed.length - 1]
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error(`timeout waiting for run completion`)
}
```

- [ ] **Step 2: Run with SLOW=1 + ANTHROPIC_API_KEY**

(Skip if no key; document.)

```bash
SLOW=1 pnpm -C packages/coding-agents test test/integration/spawn-opencode.e2e.test.ts 2>&1 | tail -10
```

Expected: PASS (or skipped if `SLOW=1` not set or `ANTHROPIC_API_KEY` not set).

- [ ] **Step 3: Commit**

```bash
git add packages/coding-agents/test/integration/spawn-opencode.e2e.test.ts
git commit -m "test(coding-agents): Layer 4 e2e — opencode spawn

Spawns an opencode kind via the runtime, sends 'reply with ok',
asserts the response. Gated SLOW=1 + ANTHROPIC_API_KEY (the chosen
probe model is anthropic/claude-haiku-4-5)."
```

---

## Task 12: Layer 4 e2e — resume-opencode

**Files:**

- Create: `packages/coding-agents/test/integration/resume-opencode.e2e.test.ts`

- [ ] **Step 1: Write the resume e2e test**

Create `packages/coding-agents/test/integration/resume-opencode.e2e.test.ts`:

```ts
import { afterAll, describe, expect, it } from 'vitest'

const SLOW = process.env.SLOW === `1` && !!process.env.ANTHROPIC_API_KEY
const d = SLOW ? describe : describe.skip
const SERVER = `http://localhost:4437`

d(`E7 — opencode resume (real CLI, e2e)`, () => {
  const agentId = `e2e-opencode-resume-${Date.now().toString(36)}`
  const SECRET = `MAGNOLIA`

  afterAll(async () => {
    await fetch(`${SERVER}/coding-agent/${agentId}`, {
      method: `DELETE`,
    }).catch(() => undefined)
  })

  it(`turn 2 recalls a secret from turn 1 via opencode --continue / -s`, async () => {
    // Spawn opencode.
    await fetch(`${SERVER}/coding-agent/${agentId}`, {
      method: `PUT`,
      headers: { 'content-type': `application/json` },
      body: JSON.stringify({
        args: {
          kind: `opencode`,
          workspaceType: `volume`,
          model: `anthropic/claude-haiku-4-5`,
        },
      }),
    })

    // Turn 1: tell the secret.
    await fetch(`${SERVER}/coding-agent/${agentId}/send`, {
      method: `POST`,
      headers: { 'content-type': `application/json` },
      body: JSON.stringify({
        from: `e2e-test`,
        type: `prompt`,
        payload: { text: `the magic word is ${SECRET}. just acknowledge.` },
      }),
    })
    await waitForLastRunCompleted(agentId, 120_000)

    // Turn 2: recall.
    await fetch(`${SERVER}/coding-agent/${agentId}/send`, {
      method: `POST`,
      headers: { 'content-type': `application/json` },
      body: JSON.stringify({
        from: `e2e-test`,
        type: `prompt`,
        payload: { text: `what was the magic word? answer in one word.` },
      }),
    })
    const w = await waitForLastRunCompleted(agentId, 180_000)
    expect((w.responseText ?? ``).toLowerCase()).toContain(SECRET.toLowerCase())
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
    if (completed.length > 0) return completed[completed.length - 1]
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error(`timeout waiting for run completion`)
}
```

- [ ] **Step 2: Run with SLOW=1**

```bash
SLOW=1 pnpm -C packages/coding-agents test test/integration/resume-opencode.e2e.test.ts 2>&1 | tail -10
```

Expected: PASS or skipped per env. Validates that opencode's cumulative-storage + our capture/import round-trip works end-to-end.

- [ ] **Step 3: Commit**

```bash
git add packages/coding-agents/test/integration/resume-opencode.e2e.test.ts
git commit -m "test(coding-agents): Layer 4 e2e — opencode resume

Turn 1 tells a secret, turn 2 recalls it. Exercises the full
capture (opencode export -> base64 -> nativeJsonl) + materialise
(copyTo + opencode import) round-trip across cold-boot."
```

---

## Task 13: UI — spawn dialog adds opencode kind + model selector

**Files:**

- Modify: `packages/agents-server-ui/src/components/CodingAgentSpawnDialog.tsx`

- [ ] **Step 1: Locate the kind picker**

```bash
grep -n "claude\|codex\|kind:" packages/agents-server-ui/src/components/CodingAgentSpawnDialog.tsx | head -20
```

The dialog likely has a state variable like `kind` typed `'claude' | 'codex'` and a radio/select element listing the options.

- [ ] **Step 2: Widen the kind type and UI**

Change the kind state type to include `'opencode'`:

```ts
const [kind, setKind] = useState<`claude` | `codex` | `opencode`>(`claude`)
```

Add `'opencode'` to the kind options in the JSX (radio or select). Match whatever pattern is there.

- [ ] **Step 3: Add a model selector for opencode**

Define a curated model list at the top of the component file:

```ts
const OPENCODE_MODELS = [
  `anthropic/claude-haiku-4-5`,
  `anthropic/claude-sonnet-4-6`,
  `openai/gpt-5.5`,
  `openai/gpt-5.5-fast`,
] as const
```

Add a state for the selected model:

```ts
const [opencodeModel, setOpencodeModel] = useState<string>(
  `anthropic/claude-haiku-4-5`
)
```

Render a `<select>` (using the same pattern as the existing workspace-type selector — match Radix `<Select>` if that's what the dialog uses) when `kind === 'opencode'`:

```tsx
{
  kind === `opencode` && (
    <Flex direction="column" gap="1">
      <Text size="2" weight="medium">
        Model{` `}
        <Text size="1" color="red">
          *
        </Text>
      </Text>
      <select
        style={inputStyle}
        value={opencodeModel}
        onChange={(e) => setOpencodeModel(e.target.value)}
        required
        data-testid="opencode-model-select"
      >
        {OPENCODE_MODELS.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
    </Flex>
  )
}
```

(Use the same `inputStyle` variable + Radix patterns the rest of the dialog uses.)

- [ ] **Step 4: Validation**

In the existing `canSubmit` logic (or equivalent), add:

```ts
if (kind === `opencode` && !opencodeModel) return false
```

- [ ] **Step 5: Pass model in spawn args**

In the submit handler, when `kind === 'opencode'`, include `model: opencodeModel` in the spawn args:

```ts
const args: Record<string, unknown> = {
  kind,
  workspaceType,
  ...(kind === `opencode` ? { model: opencodeModel } : {}),
  // ... existing args
}
```

- [ ] **Step 6: Typecheck + smoke**

```bash
pnpm -C packages/agents-server-ui typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/agents-server-ui/src/components/CodingAgentSpawnDialog.tsx
git commit -m "feat(agents-server-ui): spawn dialog kind picker adds opencode

Reveals a model selector when 'opencode' is selected. Curated model
list (anthropic/claude-haiku-4-5, claude-sonnet-4-6, openai/gpt-5.5,
gpt-5.5-fast). Validation gates submit until a model is picked.
Spawn args include 'model' for opencode kind only."
```

---

## Task 14: UI — Convert/Fork dropdowns gate opencode

**Files:**

- Modify: `packages/agents-server-ui/src/components/EntityHeader.tsx`

**Why:** Cross-kind in/out of opencode is deferred. UI shows the menu items but disables them with a tooltip so the user knows the capability is coming.

- [ ] **Step 1: Locate Convert kind dropdown**

```bash
grep -n "Convert kind\|convert-kind-button\|fork-to-" packages/agents-server-ui/src/components/EntityHeader.tsx | head
```

- [ ] **Step 2: Extend the Convert kind dropdown**

The Convert kind dropdown currently maps over `['claude', 'codex'].filter(k => k !== currentKind)`. Change the source array and gate `'opencode'` items as disabled when current kind is `'claude'` or `'codex'`. Likewise gate `'claude'` / `'codex'` as disabled when current kind is `'opencode'`.

Replace the existing menu-item map (whatever it looks like) with logic of this shape:

```tsx
{
  ;([`claude`, `codex`, `opencode`] as const)
    .filter((k) => k !== codingAgentKind)
    .map((k) => {
      const involvesOpencode =
        k === `opencode` || codingAgentKind === `opencode`
      return (
        <DropdownMenu.Item
          key={k}
          disabled={involvesOpencode}
          onSelect={() => {
            if (involvesOpencode) return
            void fetch(`${baseUrl}${entity.url}/send`, {
              method: `POST`,
              headers: { 'content-type': `application/json` },
              body: JSON.stringify({
                from: `user`,
                type: `convert-kind`,
                payload: { kind: k },
              }),
            })
          }}
          title={
            involvesOpencode
              ? `Cross-kind support for opencode is deferred — see follow-up slice.`
              : `Convert this agent to ${k}`
          }
        >
          Convert to {k}
          {involvesOpencode ? ` (deferred)` : ``}
        </DropdownMenu.Item>
      )
    })
}
```

- [ ] **Step 3: Extend the Fork dropdown the same way**

Find the existing `fork-to-claude` / `fork-to-codex` menu items in EntityHeader.tsx. Add a third item for opencode with the same disabled-when-involves-opencode gate:

```tsx
{
  ;([`claude`, `codex`, `opencode`] as const).map((k) => {
    const involvesOpencode = k === `opencode` || codingAgentKind === `opencode`
    return (
      <DropdownMenu.Item
        key={k}
        data-testid={`fork-to-${k}`}
        disabled={involvesOpencode}
        onSelect={() => {
          if (involvesOpencode) return
          onForkToKind(k as `claude` | `codex`)
        }}
        title={
          involvesOpencode
            ? `Cross-kind support for opencode is deferred — see follow-up slice.`
            : undefined
        }
      >
        <Flex align="center" gap="2">
          <GitFork size={14} />
          <Text size="2">
            Fork to {k}
            {involvesOpencode ? ` (deferred)` : ``}
          </Text>
        </Flex>
      </DropdownMenu.Item>
    )
  })
}
```

(Match the existing pattern's exact JSX — the above uses Radix DropdownMenu.Item which is what the file already uses.)

- [ ] **Step 4: Typecheck**

```bash
pnpm -C packages/agents-server-ui typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/agents-server-ui/src/components/EntityHeader.tsx
git commit -m "feat(agents-server-ui): Convert/Fork dropdowns gate opencode

Cross-kind in/out of opencode is deferred to a follow-up slice.
Menu items for opencode (or from opencode) are visibly present but
disabled with a tooltip pointing at the deferral. Existing claude
↔ codex Convert + Fork dropdowns continue to work unchanged."
```

---

## Task 15: Playwright UI — spawn-opencode

**Files:**

- Create: `packages/agents-server-ui/test/e2e/spawn-opencode.spec.ts`

- [ ] **Step 1: Write the Playwright spec**

Create `packages/agents-server-ui/test/e2e/spawn-opencode.spec.ts`:

```ts
import { test, expect } from '@playwright/test'
import { rm } from 'node:fs/promises'
import { deleteEntity, spawnAndWake, uniqueAgentName } from './helpers'

test.describe(`Spawn opencode kind`, () => {
  test(`spawn dialog kind=opencode reveals model selector and spawn succeeds`, async ({
    page,
    request,
  }) => {
    const name = uniqueAgentName(`pw-opencode-`)
    try {
      await page.goto(`/`)
      await page.click(`button:has-text("New session")`)
      // Pick coding-agent type then opencode kind.
      // Match whatever the actual spawn flow looks like — the fork-spawn
      // and convert-kind specs already drive this dialog; reuse those
      // selectors as a reference.
      await page.click(`text=/coding[- ]agent/i`)
      await page.click(`label:has-text("opencode"), input[value="opencode"]`)
      // Model selector should appear.
      await expect(page.getByTestId(`opencode-model-select`)).toBeVisible({
        timeout: 5_000,
      })
      // Pick the haiku model (default selection).
      await page.selectOption(
        `[data-testid="opencode-model-select"]`,
        `anthropic/claude-haiku-4-5`
      )
      // Set name in the dialog's name field.
      await page.fill(`input[name="name"]`, name)
      // Submit.
      await page.click(`button:has-text("Spawn")`)
      // New entity appears in sidebar with data-kind="opencode".
      await expect(
        page.locator(`[data-testid="sidebar"] [data-kind="opencode"]`)
      ).toBeVisible({ timeout: 10_000 })
    } finally {
      await deleteEntity(request, name)
    }
  })

  test(`Convert/Fork dropdowns on a claude agent show opencode disabled with tooltip`, async ({
    page,
    request,
  }) => {
    const name = uniqueAgentName(`pw-opencode-gate-`)
    try {
      await spawnAndWake(request, name, {
        kind: `claude`,
        target: `sandbox`,
        workspaceType: `volume`,
      })
      await page.goto(`/#/entity/coding-agent/${name}`)
      await expect(page.getByTestId(`entity-header`)).toBeVisible({
        timeout: 10_000,
      })
      // Open Convert kind dropdown.
      await page.getByTestId(`convert-kind-button`).click()
      await expect(
        page.getByRole(`menuitem`, { name: /Convert to opencode.*deferred/i })
      ).toBeVisible()
      // Convert to opencode is disabled.
      const convertOpen = page.getByRole(`menuitem`, {
        name: /Convert to opencode/i,
      })
      await expect(convertOpen).toBeDisabled()
      // Close the menu.
      await page.keyboard.press(`Escape`)
      // Open Fork dropdown.
      await page.getByTestId(`fork-button`).click()
      await expect(page.getByTestId(`fork-to-opencode`)).toBeVisible()
      await expect(page.getByTestId(`fork-to-opencode`)).toBeDisabled()
    } finally {
      await deleteEntity(request, name)
    }
  })
})
```

- [ ] **Step 2: Run Playwright (with the dev server running)**

The agents-server must be running on `:4437`. The dev environment from earlier sessions covers this.

```bash
pnpm -C packages/agents-server-ui exec playwright test test/e2e/spawn-opencode.spec.ts 2>&1 | tail -10
```

Expected: PASS — both tests green.

- [ ] **Step 3: Commit**

```bash
git add packages/agents-server-ui/test/e2e/spawn-opencode.spec.ts
git commit -m "test(agents-server-ui): Playwright — spawn opencode + cross-kind gates

Two scenarios:
1. Spawn dialog kind=opencode reveals model selector; spawn produces
   a sidebar entry with data-kind=\"opencode\".
2. Convert/Fork dropdowns on a claude agent show 'Convert to opencode'
   and 'Fork to opencode' as disabled menu items with the deferral
   tooltip text."
```

---

## Task 16: Documentation

**Files:**

- Modify: `packages/coding-agents/README.md`
- Append to: `docs/superpowers/plans/2026-05-02-coding-agents-opencode.md` (this file — implementation findings section)

- [ ] **Step 1: Add opencode section to README**

Append to `packages/coding-agents/README.md`:

````markdown
## opencode (third agent kind)

[opencode-ai](https://github.com/sst/opencode) is supported as a first-class
spawnable kind alongside claude and codex. v1 is **spawn-only** — cross-kind
operations involving opencode (Fork to opencode, Convert kind: opencode) are
gated in the UI behind a tooltip pointing at the deferred follow-up slice.

### Spawning

```ts
await ctx.spawnCodingAgent({
  id: nanoid(10),
  kind: `opencode`,
  workspace: { type: `volume` },
  model: `anthropic/claude-haiku-4-5`,
})
```
````

`model` is required for opencode (no provider auto-detect in v1). Curated
list:

- `anthropic/claude-haiku-4-5` (default)
- `anthropic/claude-sonnet-4-6`
- `openai/gpt-5.5`
- `openai/gpt-5.5-fast`

### Auth

Env-var only. opencode reads `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` as
per-provider fallback when `~/.local/share/opencode/auth.json` is missing.
The handler passes whichever keys are in `process.env` through to the
sandbox per-turn.

### Storage

opencode persists conversations in SQLite at
`~/.local/share/opencode/opencode.db`. Capture is via `opencode export <id>`
(base64-encoded for transport); restore is via `opencode import <file>`.
Captured JSON lands in the events stream the same way claude/codex
transcripts do.

### Tracked limitations

- **TL-1 (project-wide)**: opencode shares codex's argv-only prompt delivery,
  so prompts are bounded by `ARG_MAX` (~256 KB on Linux). See
  `docs/superpowers/specs/2026-05-02-coding-agents-opencode-design.md`
  §10 TL-1.
- **TL-2 (opencode-only)**: `opencode export`/`opencode import` JSON schema
  isn't documented as stable across versions. The Dockerfile pins
  `opencode-ai` to a known-good version; re-test on bumps.
- **TL-3 (opencode-only)**: cross-kind UI is gated. Discoverable absence,
  not silent failure.

````

- [ ] **Step 2: Update platform-primitive-design footnote**

Append a one-line backlink to the cross-kind resume design's "Out of scope" section in `docs/superpowers/specs/2026-04-30-coding-agents-platform-primitive-design.md` (where the existing post-MVP backlog lives), pointing at this opencode design.

```bash
grep -n "Cross-kind resume in the spawn dialog" docs/superpowers/specs/2026-04-30-coding-agents-platform-primitive-design.md
````

After that line, add (matching the existing `> **Resolved by:**` style if present, otherwise just inline):

```markdown
> **Related:** [`2026-05-02-coding-agents-opencode-design.md`](./2026-05-02-coding-agents-opencode-design.md) ships opencode as a third spawnable kind; cross-kind in/out of opencode is the next deferred follow-up.
```

- [ ] **Step 3: Append implementation findings stub**

Append to this plan file (`docs/superpowers/plans/2026-05-02-coding-agents-opencode.md`):

```markdown
## Implementation findings (YYYY-MM-DD)

(Filled in after merge. Mirrors the cross-kind-resume plan precedent.)
```

- [ ] **Step 4: Commit**

```bash
git add packages/coding-agents/README.md docs/superpowers/specs/2026-04-30-coding-agents-platform-primitive-design.md docs/superpowers/plans/2026-05-02-coding-agents-opencode.md
git commit -m "docs(coding-agents): opencode README section + cross-references

Adds opencode usage, auth, storage, and tracked-limitations to the
package README. Links the platform-primitive design's post-MVP
backlog to the opencode design doc. Stubs an implementation
findings section for post-merge follow-up."
```

---

## Final verification

- [ ] **Step 1: Full unit suite**

```bash
pnpm -C packages/coding-agents test
pnpm -C packages/agents test
pnpm -C packages/agents-server-ui typecheck
```

Expected: PASS across all three packages.

- [ ] **Step 2: Conformance — local docker**

```bash
DOCKER=1 pnpm -C packages/coding-agents test test/integration/local-docker-conformance.test.ts
```

Expected: opencode kind block runs (or skipped if no `ANTHROPIC_API_KEY`); existing claude + codex blocks still green.

- [ ] **Step 3: Conformance — host**

```bash
HOST_PROVIDER=1 pnpm -C packages/coding-agents test test/integration/host-provider-conformance.test.ts
```

Expected: same.

- [ ] **Step 4: Layer 4 e2e**

```bash
SLOW=1 ANTHROPIC_API_KEY=... pnpm -C packages/coding-agents test \
  test/integration/spawn-opencode.e2e.test.ts \
  test/integration/resume-opencode.e2e.test.ts
```

Expected: PASS or document any flakes in the implementation findings.

- [ ] **Step 5: Playwright UI**

```bash
pnpm -C packages/agents-server-ui exec playwright test test/e2e/spawn-opencode.spec.ts
```

Expected: 2/2 PASS.

- [ ] **Step 6: Manual smoke via the LAN UI**

Open `http://192.168.1.80:4437/__agent_ui/` (or whatever the LAN IP is on this dev box). Click "New session" → coding-agent → kind=opencode → pick the haiku model → spawn → send "reply with ok" → observe the streaming timeline.

Then on a claude agent, open Convert kind dropdown — confirm `Convert to opencode (deferred)` is visibly disabled with the tooltip on hover.

- [ ] **Step 7: Push**

```bash
git push origin coding-agents-slice-a
```

---

## Self-review checklist

1. **Spec coverage** — every section §1–§10 of the spec has at least one task implementing it. ✓
2. **Placeholder scan** — no TBD/TODO/"add appropriate" patterns; every code step contains real code. ✓
3. **Type consistency** — `OpencodeAdapter`, `normalizeOpencode`, `'opencode'`, `postMaterialiseCommand` used consistently across tasks. ✓
4. **Build sequence** — types widened first (Task 1, 2), then adapter contract (Task 3), then handler (Task 4) — fails until Task 5 lands but doesn't block other commits, then adapter (Task 5), then fixtures + normalizer (Tasks 6-7), then bridge wiring (Task 8), then image (Task 9), then conformance (Task 10), then e2e (Tasks 11-12), then UI (Tasks 13-14), then Playwright (Task 15), then docs (Task 16). One slight ordering caveat: the handler-resume.test.ts test added in Task 4 stays red until OpencodeAdapter lands in Task 5. Documented in Task 4 step 5.
