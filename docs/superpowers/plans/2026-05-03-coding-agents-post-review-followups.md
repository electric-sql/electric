# Coding-agents post-review follow-ups

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Burn down the Important findings from the multi-agent PR review of `coding-agents-slice-a` (PR review 2026-05-03), close the Layer-4 e2e infrastructure gap, and resolve the one product-quality signal Layer-4 surfaced (opencode empty-response). Critical findings already landed in commit `59e2b2534`.

**Architecture:** No new subsystems. Each task is a localised diff against the existing code paths flagged by the review, plus one fixture-style addition (boot `agents-server` from a vitest hook) to make Layer-4 e2e self-contained.

**Tech stack:** TypeScript, vitest, Node child_process, Playwright (UI specs), Docker, sprites.dev REST/WS.

**Calibration vs Critical fix-list:** Important issues do not block merge. Treat the phase order below as priority, not as gating; phases 1–4 are independent and can be parallelised across sessions if needed.

---

## Phase 1 — Handler + lifecycle correctness (R2 findings)

### Task 1: WorkspaceRegistry chain leak under concurrent acquirers

**Files:**

- Modify: `packages/coding-agents/src/workspace-registry.ts`
- Test: `packages/coding-agents/test/unit/workspace-registry.test.ts`

**Issue (R2 #5):** `acquire()` reads `chainByIdentity.get(identity)` once and links onto it. Two concurrent acquirers read the same `prior` value, both append a `next` link, but only the second's link wins the `set()`. The first's release branch (`if (this.chainByIdentity.get(identity) === link)`) never fires, leaving stale promise pointers in the map for the lifetime of the workspace. Memory grows; release ordering is wrong.

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect } from 'vitest'
import { WorkspaceRegistry } from '../../src/workspace-registry'

describe(`WorkspaceRegistry — concurrent acquire FIFO`, () => {
  it(`releases all acquirers in order without leaking chain entries`, async () => {
    const wr = new WorkspaceRegistry()
    const id = `volume:test`
    wr.register(id, `agent-a`)

    const r1 = await wr.acquire(id, `agent-a`)
    const p2 = wr.acquire(id, `agent-a`)
    const p3 = wr.acquire(id, `agent-a`)

    // Both p2 and p3 should be queued; releasing r1 should let p2 resolve.
    expect((wr as any).chainByIdentity.size).toBe(1)
    r1()
    const r2 = await p2
    r2()
    const r3 = await p3
    r3()
    // After all releases the map entry must be gone.
    expect((wr as any).chainByIdentity.has(id)).toBe(false)
  })
})
```

- [ ] **Step 2: Run; expect FAIL**

`pnpm -C packages/coding-agents exec vitest run test/unit/workspace-registry.test.ts`

- [ ] **Step 3: Replace chain-of-thens with a proper FIFO queue**

In `workspace-registry.ts`, replace the per-identity promise chain with a per-identity `queue: Array<() => void>`. `acquire()` pushes a resolver if the queue is non-empty (or there's an active holder); `release()` shifts the next resolver. When the queue empties **and** no holder is active, delete the map entry.

- [ ] **Step 4: Run; expect PASS**

- [ ] **Step 5: Commit**

```bash
git add packages/coding-agents/src/workspace-registry.ts packages/coding-agents/test/unit/workspace-registry.test.ts
git commit -m "fix(coding-agents): WorkspaceRegistry — proper FIFO queue, no chain leak"
```

---

### Task 2: Reconcile + processPrompt clear `error` status on next prompt

**Files:**

- Modify: `packages/coding-agents/src/entity/handler.ts` (processPrompt)
- Test: `packages/coding-agents/test/unit/handler-error-recovery.test.ts` (new)

**Issue (R2 #7):** A prior turn that left `meta.status = 'error'` blocks the next prompt's `wasCold` branch (`status === 'cold'`); the handler doesn't emit `sandbox.starting`, doesn't transition through `starting`, and writes `running` directly. The state-machine paper claims `error → cold → starting → running`; reality is `error → running`. Either reconcile or processPrompt entry must clear `lastError` and treat `error` as `cold`.

- [ ] **Step 1: Write failing test**

(Mock fake-ctx with sessionMeta.status='error', lastError set; assert next processPrompt call writes status='starting' before 'running' and clears lastError.)

- [ ] **Step 2: Run; expect FAIL**

- [ ] **Step 3: Add at top of processPrompt (after cancelIdleTimer):**

```ts
if (meta.status === `error`) {
  ctx.db.actions.sessionMeta_update({
    key: `current`,
    updater: (d: SessionMetaRow) => {
      d.status = `cold`
      d.lastError = undefined
    },
  })
  meta = sessionMetaCol.get(`current`) as SessionMetaRow
}
```

- [ ] **Step 4: Run; expect PASS**

- [ ] **Step 5: Commit**

```bash
git add packages/coding-agents/src/entity/handler.ts packages/coding-agents/test/unit/handler-error-recovery.test.ts
git commit -m "fix(coding-agents): processPrompt clears error status on retry"
```

---

### Task 3: Block fork from a non-quiescent source

**Files:**

- Modify: `packages/coding-agents/src/entity/handler.ts` (firstWakeFork or wherever observe-source meta is read)
- Test: `packages/coding-agents/test/unit/fork.test.ts` (extend)

**Issue (R2 #9):** Fork copies events + nativeJsonl unconditionally. If the source is `running|starting|stopping`, events are still streaming; convertNativeJsonl produces a transcript ending mid-assistant-message. Resume from that transcript can corrupt state.

- [ ] **Step 1: Write failing test**

(Mock observed source with sessionMeta.status='running'; assert fork rejects with a `fork.failed: source not quiescent` lifecycle row and does not insert nativeJsonl.)

- [ ] **Step 2: Run; expect FAIL**

- [ ] **Step 3: Guard in fork code path**

```ts
if (
  sourceMeta?.status === `running` ||
  sourceMeta?.status === `starting` ||
  sourceMeta?.status === `stopping`
) {
  ctx.db.actions.lifecycle_insert({
    row: {
      key: lifecycleKey(`fork`),
      ts: Date.now(),
      event: `kind.convert_failed`,
      detail: `fork rejected: source status=${sourceMeta.status}`,
    } satisfies LifecycleRow,
  })
  ctx.db.actions.sessionMeta_update({
    key: `current`,
    updater: (d: SessionMetaRow) => {
      d.lastError = `cannot fork while source status=${sourceMeta.status}`
      d.status = `error`
    },
  })
  return
}
```

- [ ] **Step 4: Run; expect PASS**

- [ ] **Step 5: Commit**

---

### Task 4: Tighten L2.4 conformance test to assert final status

**Files:**

- Modify: `packages/coding-agents/src/conformance/integration.ts` (L2.4 scenario)

**Issue (R2 #8):** L2.4 only asserts `runs[runs.length-1].status === 'completed'`. A provider that returns `'running'` for a stale agent reaches the `isOrphaned` branch that flips status to `idle` instead of `cold`; the test still passes because it doesn't check final meta.status. Add an explicit assertion.

- [ ] **Step 1: Read current L2.4** (`grep -n "L2.4" packages/coding-agents/src/conformance/integration.ts`)

- [ ] **Step 2: Add assertion**

```ts
const finalMeta = ctx.db.collections.sessionMeta.get(
  `current`
) as SessionMetaRow
expect(finalMeta.status).toMatch(/^(cold|idle)$/)
```

- [ ] **Step 3: Run all three conformance suites; all should still pass.**

```bash
DOCKER=1                            pnpm -C packages/coding-agents test test/integration/local-docker-conformance.test.ts
HOST_PROVIDER=1                     pnpm -C packages/coding-agents test test/integration/host-provider-conformance.test.ts
SPRITES=1 SPRITES_TOKEN=...         pnpm -C packages/coding-agents test test/integration/fly-sprites-conformance.test.ts
```

- [ ] **Step 4: Commit**

---

## Phase 2 — Provider plane defensive fixes (R1 findings)

### Task 5: Sprites POST stdin guards (writeStdin after close, double closeStdin)

**Files:**

- Modify: `packages/coding-agents/src/providers/fly-sprites/index.ts` (`execWithStdinViaPost` block)
- Test: `packages/coding-agents/test/unit/fly-sprites.test.ts` (extend, mock fetch)

**Issue (R1 #4):** `writeStdin` appends to `stdinBuf` with no guard; calls after `closeStdin` are silently lost. `closeStdin` calls `void start()` and re-firing is OK, but should still no-op explicitly.

- [ ] **Step 1: Add `closed = false` flag; throw on writeStdin-after-close; make closeStdin idempotent.**

- [ ] **Step 2: Add unit test using a mocked fetch.**

- [ ] **Step 3: Commit**

---

### Task 6: Sprites per-call env via wrapper, not query param

**Files:**

- Modify: `packages/coding-agents/src/providers/fly-sprites/index.ts` (`wrapWithAgentEnv`)

**Issue (R1 #5):** Per-call `req.env` flows only via the (unstable) `?env=` query param. When sprites strips that for shell-wrapped cmds, the env never reaches the child. Move per-call env into the wrapper script as `export FOO=...` lines.

- [ ] **Step 1: Update wrapWithAgentEnv signature: `wrapWithAgentEnv(cmd, cwd?, env?)`**

```ts
function wrapWithAgentEnv(
  cmd: ReadonlyArray<string>,
  cwd?: string,
  env?: Record<string, string>
): Array<string> {
  const parts = [
    `if [ -r /run/agent.env ]; then set -a; . /run/agent.env; set +a; fi`,
  ]
  if (env) {
    for (const [k, v] of Object.entries(env)) {
      parts.push(`export ${k}=${shellEscape(v)}`)
    }
  }
  if (cwd) parts.push(`cd ${shellEscape(cwd)}`)
  parts.push(`exec "$@"`)
  return [`/bin/sh`, `-c`, parts.join(`; `), `agent-env-wrapper`, ...cmd]
}
```

- [ ] **Step 2: Drop `env: req.env` from openExecWebSocket / execWithStdinViaPost call sites; thread `req.env` into wrapWithAgentEnv instead.**

- [ ] **Step 3: Re-run sprites conformance L1.5 (`exec honours cwd and env`).**

- [ ] **Step 4: Commit**

---

### Task 7: Sprites listSprites pagination guard

**Files:**

- Modify: `packages/coding-agents/src/providers/fly-sprites/index.ts` (`findExisting`)
- Modify: `packages/coding-agents/src/providers/fly-sprites/api-client.ts` (expose pagination response fields if not already)

**Issue (R1 #7):** `listSprites({ namePrefix })` returns one page. A sprite with the exact name buried past the first page is missed; `createSprite` then fails with 409. Either follow `next_continuation_token` until exhausted or warn-log when `has_more` is true.

- [ ] **Step 1: Inspect the listSprites response shape.**

- [ ] **Step 2: Loop until `!has_more` (or `!next_token`).**

- [ ] **Step 3: Commit**

---

### Task 8: HostProvider tracks per-turn child PIDs for stop()

**Files:**

- Modify: `packages/coding-agents/src/providers/host.ts`
- Test: `packages/coding-agents/test/unit/host-provider.test.ts` (new)

**Issue (R1 #9):** `provider.stop(instanceId)` is a no-op if a child is mid-turn; the SandboxProvider contract doesn't say "between turns only". A `stop` request during an in-flight CLI turn lets the child keep running.

- [ ] **Step 1: Track child PIDs in `AgentRecord.activeChildren: Set<ChildProcess>`.**

- [ ] **Step 2: Register on each `exec()`; unregister on child `exit`.**

- [ ] **Step 3: SIGTERM all active children in `stop()` and `destroy()`; SIGKILL after 5 s if still alive.**

- [ ] **Step 4: Unit test.**

- [ ] **Step 5: Commit**

---

## Phase 3 — Bridge + adapter hardening (R3 findings)

### Task 9: Bridge accepts `AbortSignal` for turn timeout

**Files:**

- Modify: `packages/coding-agents/src/types.ts` (RunTurnArgs)
- Modify: `packages/coding-agents/src/bridge/stdio-bridge.ts`
- Modify: `packages/coding-agents/src/entity/handler.ts` (pass signal from runTimeoutMs)
- Test: `packages/coding-agents/test/unit/stdio-bridge.test.ts`

**Issue (R3):** A hung CLI hangs the bridge forever. Today the handler races `runTurn` against `runTimeoutMs` via `raceTimeout`, but the loser's child stays around. Plumbing an AbortSignal lets the bridge kill the child cleanly when the timeout fires.

- [ ] **Step 1: Add `signal?: AbortSignal` to RunTurnArgs.**

- [ ] **Step 2: In runTurn, register `signal.addEventListener('abort', () => handle.kill('SIGTERM'))`.**

- [ ] **Step 3: In handler, create AbortController bound to runTimeoutMs and pass `controller.signal`.**

- [ ] **Step 4: Test that abort kills the child and runTurn rejects.**

- [ ] **Step 5: Commit**

---

### Task 10: Codex model arg validation + sessionId glob safety

**Files:**

- Modify: `packages/coding-agents/src/agents/codex.ts`
- Test: `packages/coding-agents/test/unit/codex-adapter.test.ts`

**Issue (R3):** `--model "${model}"` allows config-injection (`gpt-4";evil="x`). `find -name '*-${sessionId}.jsonl'` glob-matches when sessionId contains `*` or `?`.

- [ ] **Step 1: Validate model `^[A-Za-z0-9._/:-]+$`; reject otherwise with clear error.**

- [ ] **Step 2: Validate sessionId `^[A-Za-z0-9-]+$` (matches asp's findSessionPath assumption).**

- [ ] **Step 3: Unit tests for each rejection path.**

- [ ] **Step 4: Commit**

---

### Task 11: Tighten import CLI sessionId regex + isMain heuristic

**Files:**

- Modify: `packages/coding-agents/src/cli/import.ts`
- Test: `packages/coding-agents/test/unit/cli-import.test.ts`

**Issue (R3):** `^[A-Za-z0-9_-]+$` permits leading dashes (downstream surprise). `process.argv[1]?.endsWith('import.js')` matches any consumer file ending in `import.js`.

- [ ] **Step 1: Reject leading dashes (`/^[A-Za-z0-9][A-Za-z0-9_-]*$/`).**

- [ ] **Step 2: Replace endsWith heuristic with `path.basename(process.argv[1] ?? '') === 'import.js'`.**

- [ ] **Step 3: Update existing tests + add a leading-dash rejection case.**

- [ ] **Step 4: Commit**

---

## Phase 4 — Runtime + UI invariants (R4 findings)

### Task 12: Spawn dialog `canSubmit` enforces target ⇄ workspace invariants

**Files:**

- Modify: `packages/agents-server-ui/src/components/CodingAgentSpawnDialog.tsx`
- Test: `packages/agents-server-ui/test/e2e/spawn-dialog-invariants.spec.ts` (new)

**Issue (R4):** Click-handlers force the right workspace when toggling target, but `canSubmit` itself doesn't assert `target=host ⇒ workspaceMode='bindMount'` and `target=sprites ⇒ workspaceMode='volume'`. A future refactor or strict-mode double-render could submit a bad combo.

- [ ] **Step 1: Add invariant checks in canSubmit.**

- [ ] **Step 2: Playwright spec asserts the submit button is disabled when state is forced into an invalid combo.**

- [ ] **Step 3: Commit**

---

### Task 13: Convert/Fork dropdowns gate `cold` and `error` states

**Files:**

- Modify: `packages/agents-server-ui/src/components/EntityHeader.tsx`

**Issue (R4):** `inFlight` predicate covers `running|starting|stopping`. `cold` and `error` aren't blocked. Convert-target while `cold` requires the entity to materialise the agent first; `error` should require the user to retry-and-recover before converting.

- [ ] **Step 1: Add `cold` + `error` to gated set with a tooltip explaining why.**

- [ ] **Step 2: Update host-target.spec.ts and any related Playwright tests.**

- [ ] **Step 3: Commit**

---

### Task 14: Playwright `wakeHandlerWithPin` polls for entity init

**Files:**

- Modify: `packages/agents-server-ui/test/e2e/helpers.ts`

**Issue (R4):** `pin` lands before the entity registers server-side; the message is silently dropped. Several specs chain spawnAndWake → page.goto and race the timeline assertions.

- [ ] **Step 1: Replace direct send with a poll on `GET /coding-agent/<name>` for sessionMeta to be observable, then send the pin.**

- [ ] **Step 2: Run the full Playwright suite to ensure no flakes regress.**

- [ ] **Step 3: Commit**

---

## Phase 5 — Test coverage gaps + Layer-4 infrastructure (R5 findings)

### Task 15: Recapture opencode JSONL fixture without `--print-logs`

**Files:**

- Replace: `packages/coding-agents/test/fixtures/opencode/first-turn.jsonl`
- Modify: `packages/coding-agents/test/unit/opencode-normalize.test.ts` if needed

**Issue (R5 Important #4):** Existing fixture appears to have been captured with `--print-logs`; the bridge invokes `opencode run --format json` which omits `metadata.openai.phase`. The regression test is doing the heavy lifting; freshness of the fixture is wrong.

- [ ] **Step 1: Run a real opencode CLI invocation matching the bridge's argv; capture stdout to a fresh fixture.**

- [ ] **Step 2: Update tests to assert against the new fixture; pre-existing assertions about `assistant_message` / `thinking` still hold.**

- [ ] **Step 3: Commit**

---

### Task 16: Layer-4 e2e fixture — boot agents-server from vitest

**Files:**

- Create: `packages/coding-agents/test/integration/_e2e-fixture.ts`
- Modify: e2e specs that need it (8 files: spawn-sprites-\*, fork-on-sprites, convert-kind-on-sprites, sprites-wiring, convert-kind, fork-kind, import-claude)

**Issue:** Layer-4 e2e tests currently fail (13/15) when run in isolation because they depend on a running `agents-server` on :4437. Either gate them with `skipIf: !devServerRunning` or boot one from a vitest `beforeAll`.

- [ ] **Step 1: Write the fixture: spawn `node packages/electric-ax/bin/dev.mjs up` on a per-suite ephemeral port; wait for `/health`; tear down in afterAll.**

- [ ] **Step 2: Each affected spec imports the fixture (Vitest globalSetup) and reads its base URL from the fixture's exported handle.**

- [ ] **Step 3: Re-run the full Layer-4 suite. Target: ≥13/15 pass (excluding any product-level failures unblocked by Tasks 17/18 below).**

- [ ] **Step 4: Commit**

---

### Task 17: Debug opencode empty-response in Layer-4 spawn

**Files:**

- Read: `packages/coding-agents/test/integration/spawn-opencode.e2e.test.ts`
- Read: `packages/coding-agents/src/agents/opencode.ts`

**Issue:** Layer-2 conformance L2.1 opencode passes (responseText non-empty). Layer-4 spawn-opencode and resume-opencode return empty responseText. The conformance harness uses the same StdioBridge → OpencodeAdapter path; difference is environmental (env vars, model, container vs host).

- [ ] **Step 1: Reproduce with the e2e test's exact argv via a minimal driver script.**

- [ ] **Step 2: Capture raw opencode stdout; run it through `normalizeOpencode` directly to isolate whether the bug is in the bridge or in the test's response-extraction.**

- [ ] **Step 3: Fix root cause. If it's a bridge bug, add a Layer-2 reproduction; if it's a test issue, fix the test.**

- [ ] **Step 4: Commit**

---

### Task 18: Add coverage for status='error' recovery, mid-fork crash, convert-during-prompt

**Files:**

- Extend: `packages/coding-agents/test/unit/handler-error-recovery.test.ts` (created in Task 2)
- Extend: `packages/coding-agents/test/unit/fork.test.ts`
- Extend: `packages/coding-agents/test/unit/convert-kind.test.ts`

**Issue (R5):** No test for: error→prompt retry path (now covered by Task 2), partial fork (source.observe throws after some events), or convert-during-in-flight-prompt (the Task 3 guard returns; verify nativeJsonl is unchanged).

- [ ] **Step 1: Mid-fork: mock observe to yield 2 events then throw; assert fork-side handler writes lifecycle row and doesn't corrupt nativeJsonl.**

- [ ] **Step 2: Convert-during-prompt: mock processPrompt-in-flight (status='running'); assert processConvertKind no-ops with `kind.convert_failed: in-flight (status=running)`.**

- [ ] **Step 3: Commit**

---

### Task 19: Slice-\* legacy tests — tighten flaky sleeps

**Files:**

- Modify: `packages/coding-agents/test/integration/slice-b.test.ts:149`
- Modify: `packages/coding-agents/test/integration/slice-c1.test.ts` (idle timer assertion)

**Issue (R5):** Fixed `setTimeout(2500)` then assert `[stopped, unknown]`. On slow CI, the sequence takes >2.5 s and the assertion fires before destruction → false-pass on `running`.

- [ ] **Step 1: Replace with a poll loop (await `provider.status` until it transitions, max 30 s).**

- [ ] **Step 2: Commit**

---

## Phase 6 — Cleanup

### Task 20: Delete legacy `slice-a.test.ts` stub

**Files:**

- Delete: `packages/coding-agents/test/integration/slice-a.test.ts`

**Issue:** R5 confirms it's already a no-op stub (the file's own comment says "delete after one cycle"). Conformance harness covers everything.

- [ ] **Step 1: Confirm there are no test cases in the file (just a smoke describe.skip or comment).**

- [ ] **Step 2: Delete the file; remove any references.**

- [ ] **Step 3: Commit**

---

## Self-review

After completing each phase, run:

```bash
cd packages/coding-agents
pnpm test                                          # full unit suite
DOCKER=1 pnpm test test/integration/local-docker-conformance.test.ts
HOST_PROVIDER=1 pnpm test test/integration/host-provider-conformance.test.ts
SPRITES=1 SPRITES_TOKEN=... pnpm test test/integration/fly-sprites-conformance.test.ts
```

A regression in any of these means re-open the just-completed phase.

After Phase 5 Task 16 lands, also re-run Layer-4:

```bash
SLOW=1 DOCKER=1 SPRITES=1 pnpm exec vitest run e2e.test
```

Target: ≥14/15 pass (one slot reserved for Task 17's investigation result).

---

## Out of scope

These were flagged in the review but deliberately deferred — they're either incremental polish or large enough to merit their own plan:

- Lifecycle key collision after process restart (R2 #4 — latent only; needs durable seq baseline).
- LocalDocker `recover()` reporting `paused` containers as `stopped` (R1 #3 — current contract is fine).
- Per-page docs review polish (already mostly applied).
- Splitting `entity-handler.test.ts` (1052 lines) by concern (R5 Minor).
- Adapter `registerAdapter` warn-on-duplicate (R3 Minor).

---

## Execution

This plan is independent across phases (no inter-task type drift). Recommended ordering:

1. **Phase 1 first** — handler correctness has the broadest blast radius.
2. **Phase 2 + Phase 3 in parallel** if multiple sessions are available — different files, no overlap.
3. **Phase 4** — UI work, low coupling to backend changes above.
4. **Phase 5 Task 16 before 17/18** — fixture unlocks Layer-4 visibility.
5. **Phase 6** — finalisation.
