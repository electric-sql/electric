# Coding-agents Tier 2 conformance — fuzz + contract tests

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add five cross-cutting test families that catch entire classes of bugs the primary review surfaced one-at-a-time. Each family is a small fuzz or contract harness that runs in CI and fails loudly when invariants regress.

**Architecture:** No production-code changes. New harnesses live under `packages/coding-agents/test/unit/` (fuzz) and `packages/coding-agents/test/contract/` (new directory for adapter contracts). Vitest already supports property-style runs; we use a tiny in-tree generator rather than pulling in fast-check (one transitive dep, predictable seeds).

**Tech stack:** TypeScript, vitest, Node `crypto.randomBytes` for seeded randomness.

**When to run this plan:** After [the post-review follow-up plan](./2026-05-03-coding-agents-post-review-followups.md) lands. These tests are forward-looking — they catch _future_ regressions, not current bugs (the current Critical fixes have already shipped). Run as a separate session.

**Companion to Tier 1:** Tier 1 conformance scenarios (L2.9–L2.13, L1.10–L1.11) live as Phase 0 of the post-review follow-up plan and target _specific_ known issues. Tier 2 here is generative — it stress-tests the surface around those specific cases.

---

## Phase A — Frame fragmentation fuzz

### Task A1: StreamQueue.feed property test

**Files:**

- Create: `packages/coding-agents/test/unit/exec-adapter-fragmentation.test.ts`

**Goal:** Prove `StreamQueue.feed(data)` produces the exact same line sequence regardless of how `data` is split across calls. Catches any future regression of the C2 line-tail-buffer fix in `providers/fly-sprites/exec-adapter.ts`.

**Property:** for any input string `s` and any partition `s = p1 + p2 + ... + pN`, feeding the partitions sequentially into a fresh `StreamQueue` and calling `end()` produces a line sequence identical to feeding `s` whole.

- [ ] **Step 1: Write a seeded random partitioner**

```ts
function partition(s: string, seed: number): Array<string> {
  // Deterministic LCG from seed; produces 0–8 cut points uniformly
  // within s. Empty pieces are allowed (StreamQueue must tolerate them).
  let state = seed >>> 0
  const next = () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state
  }
  const cutCount = next() % 9
  const cuts = Array.from(
    { length: cutCount },
    () => next() % (s.length + 1)
  ).sort((a, b) => a - b)
  const out: Array<string> = []
  let prev = 0
  for (const c of cuts) {
    out.push(s.slice(prev, c))
    prev = c
  }
  out.push(s.slice(prev))
  return out
}
```

- [ ] **Step 2: Reference run — feed `s` whole, collect lines.**

```ts
import { StreamQueue } from '../../src/providers/fly-sprites/exec-adapter'
// (Export StreamQueue from exec-adapter.ts — currently it's module-private.
// One-liner export change.)

async function lineSeq(parts: Array<string>): Promise<Array<string>> {
  const q = new StreamQueue()
  for (const p of parts) q.feed(p)
  q.end()
  const out: Array<string> = []
  for await (const line of { [Symbol.asyncIterator]: () => q.iterator() }) {
    out.push(line)
  }
  return out
}
```

- [ ] **Step 3: Run 1000 random partitions over each canonical fixture**

Use the existing claude / codex / opencode fixture JSONL files in `test/fixtures/{claude,codex,opencode}/*.jsonl` as inputs. Random seeds 1..1000 each.

- [ ] **Step 4: Assert each partitioned run equals the reference.**

```ts
for (let seed = 1; seed <= 1000; seed++) {
  const parts = partition(input, seed)
  expect(await lineSeq(parts)).toEqual(reference)
}
```

- [ ] **Step 5: Commit** (`test(coding-agents): fragmentation fuzz for sprites StreamQueue`).

> **Expected runtime:** sub-second for 1000 iterations on each of 3 fixtures. If it grows, the regression is in StreamQueue's allocation behaviour, not the test.

---

## Phase B — UTF-8 byte-boundary fuzz

### Task B1: Bridge prompt-cap byte-boundary test

**Files:**

- Create: `packages/coding-agents/test/unit/stdio-bridge-prompt-cap.test.ts`

**Goal:** The C5 fix replaced `string.length` with `Buffer.byteLength(prompt, 'utf8')`. Prove the new check is correct at every relevant boundary.

**Property:** for the cap C = 900_000:

- A prompt of byte-length C-1 must be accepted.
- A prompt of byte-length C must be accepted.
- A prompt of byte-length C+1 must throw.
- A prompt of byte-length C+1 where the C+1th byte is the middle of a multibyte char (i.e., the _previous_ byte was the last that fit) must still throw.

- [ ] **Step 1: Build prompts of each target size**

Helper that pads with ASCII to a target byte count, then optionally appends a 4-byte emoji whose first byte falls at the boundary.

```ts
const A = 'a'
const EMOJI = '😀' // 4 bytes UTF-8
function promptOfByteLen(n: number): string {
  return A.repeat(n)
}
```

- [ ] **Step 2: Wire a fake sandbox.exec that records argv and stdin so the bridge runs without a child**

(Reuse the test-bridge pattern from existing `stdio-bridge.test.ts`.)

- [ ] **Step 3: Assert each boundary**

```ts
for (const len of [C - 1, C]) {
  await expect(
    bridge.runTurn({ ...args, prompt: promptOfByteLen(len) })
  ).resolves.toBeDefined()
}
for (const len of [C + 1, C + 4]) {
  await expect(
    bridge.runTurn({ ...args, prompt: promptOfByteLen(len) })
  ).rejects.toThrow(/Prompt exceeds/)
}
// Multibyte boundary: ASCII padding to C-3, then emoji (4 bytes).
// Total = C+1 bytes; the cap should still trip.
const mixed = promptOfByteLen(C - 3) + EMOJI
expect(Buffer.byteLength(mixed, 'utf8')).toBe(C + 1)
await expect(bridge.runTurn({ ...args, prompt: mixed })).rejects.toThrow(
  /Prompt exceeds/
)
```

- [ ] **Step 4: Commit.**

---

## Phase C — Adapter argv stability snapshot

### Task C1: argv snapshot per (kind, fixture-shape)

**Files:**

- Create: `packages/coding-agents/test/contract/adapter-argv.test.ts`
- Create: `packages/coding-agents/test/contract/__snapshots__/adapter-argv.test.ts.snap` (vitest will populate)

**Goal:** Lock in every adapter's `buildCliInvocation` output shape. Would have caught the opencode `--print-logs` accident at compile-time of the test suite, not at L2.1 runtime.

**Property:** for each of the four (small) input shapes — `{}`, `{ model }`, `{ nativeSessionId }`, `{ model, nativeSessionId }` — the argv produced by each adapter is byte-stable against a checked-in snapshot.

- [ ] **Step 1: Enumerate adapters via `listAdapters()` (already exists).**

- [ ] **Step 2: For each adapter, generate the four shapes**

```ts
const inputs = [
  { prompt: 'P' },
  { prompt: 'P', model: 'M' },
  { prompt: 'P', nativeSessionId: 'S' },
  { prompt: 'P', model: 'M', nativeSessionId: 'S' },
]
for (const adapter of listAdapters()) {
  for (const inp of inputs) {
    const inv = adapter.buildCliInvocation(inp)
    expect({
      kind: adapter.kind,
      input: inp,
      args: inv.args,
      delivery: inv.promptDelivery,
    }).toMatchSnapshot()
  }
}
```

- [ ] **Step 3: First run records snapshots; commit them.**

- [ ] **Step 4: Subsequent runs fail any drift; failing test forces an explicit `pnpm test -u` with intent.**

- [ ] **Step 5: Commit both the test and the snapshot file.**

---

## Phase D — Adapter shell-injection corpus

### Task D1: Adversarial input corpus for probe / capture / postMaterialise

**Files:**

- Create: `packages/coding-agents/test/contract/adapter-injection.test.ts`

**Goal:** Generalise the C6 fix (opencode `${sessionId}`) — every adapter's commands that interpolate caller-controlled data into shell strings must treat that data as data, not code.

**Property:** for each adapter and each command (probe, capture, materialiseTargetPath, postMaterialiseCommand) and for each adversarial input from the corpus, the resulting argv either (a) does not contain a literal substring that would shell-exec the adversarial intent, or (b) contains it inside a single-quoted segment.

- [ ] **Step 1: Build the corpus**

```ts
const ADVERSARIAL_IDS = [
  `'; rm -rf /; '`,
  `$(id)`,
  `\`whoami\``,
  `--`,
  `*`,
  `?`,
  `id with space`,
  `\\`,
  `'\\''closed`,
]
```

- [ ] **Step 2: For each adapter and each command + adversarial id, assert the argv is shell-safe**

A simple correctness check: re-shell-parse the joined argv (using a tiny in-test parser) and verify the resulting tokens contain the adversarial input as a single token, not split across shell metacharacters.

```ts
function tokenise(argv: Array<string>): Array<string> {
  // For our purposes: join the sh -c "<script>" segment, then check
  // that ADVERSARIAL_ID appears within a single-quoted '...' run.
  const script = argv[2] ?? ''
  return script.match(/'([^']*)'/g) ?? []
}
for (const adapter of listAdapters()) {
  for (const id of ADVERSARIAL_IDS) {
    const probe = adapter.probeCommand({
      homeDir: '/h',
      cwd: '/w',
      sessionId: id,
    })
    const quoted = tokenise(probe)
    expect(quoted.some((q) => q.includes(id))).toBe(true)
  }
}
```

(The exact assertion shape depends on adapter — some emit raw paths, some emit shell-wrapped commands. The principle: where shell metacharacters could matter, single-quote.)

- [ ] **Step 3: Run; expect green if all adapters use shellQuote consistently.** Any adapter that doesn't will fail loudly.

- [ ] **Step 4: Commit.**

---

## Phase E — Status-transition exhaustive walk

### Task E1: Transition snapshot — assert no undocumented transitions

**Files:**

- Create: `packages/coding-agents/test/contract/status-transitions.test.ts`
- Create: `packages/coding-agents/test/contract/__snapshots__/status-transitions.test.ts.snap`

**Goal:** Document the (status, inboxMsgType) → next-status table and lock it via snapshot. Drift in the handler reveals itself as a snapshot diff that the reviewer must explicitly approve.

**Property:** for each of the seven statuses × each of the seven inbox message types (49 cells), the resulting status set after a single dispatch is stable against a checked-in snapshot.

- [ ] **Step 1: Enumerate the matrix**

```ts
const STATUSES: Array<CodingAgentStatus> = [
  `cold`,
  `starting`,
  `idle`,
  `running`,
  `stopping`,
  `error`,
  `destroyed`,
]
const MESSAGES: Array<{ type: string; payload: any }> = [
  { type: `prompt`, payload: { text: 'p' } },
  { type: `pin`, payload: {} },
  { type: `release`, payload: {} },
  { type: `stop`, payload: {} },
  { type: `destroy`, payload: {} },
  { type: `convert-target`, payload: { to: 'host' } },
  { type: `convert-kind`, payload: { kind: 'codex' } },
]
```

- [ ] **Step 2: For each (status, msg) pair, run a single handler dispatch with a fake-ctx pre-loaded with that meta.status. Capture the resulting (status, lastError-presence, lifecycle-event-emitted) tuple.**

- [ ] **Step 3: Snapshot the full 49-cell table**

```ts
expect(table).toMatchInlineSnapshot(/* generated table */)
```

- [ ] **Step 4: Any future handler change that alters a cell forces an explicit snapshot update — the reviewer must look at the diff and confirm intent.**

- [ ] **Step 5: Commit.**

---

## Self-review

These tests are deliberately strict. The "is this drift desired?" question is the whole point — if a snapshot fails, don't `-u` blindly. Read the diff and confirm the change is intentional.

Run the new harnesses:

```bash
pnpm -C packages/coding-agents test test/unit/exec-adapter-fragmentation.test.ts
pnpm -C packages/coding-agents test test/unit/stdio-bridge-prompt-cap.test.ts
pnpm -C packages/coding-agents test test/contract/
```

After all five phases land, full-package `pnpm test` time should grow by < 5 s (these are unit-level, no Docker/sprites cost).

---

## Out of scope

- **Concurrency stress** (e.g. spinning 50 agents at once and looking for deadlocks). Real-world load tests belong in their own perf plan, not in unit conformance.
- **Property-based testing of LLM CLI behaviour.** Out of scope — third-party.
- **Mutation testing.** Worth doing eventually; separate plan.

---

## Execution

Phases A–E are independent. Recommended order if sessions are limited: **A, B, C, D, E** — easiest to hardest, smallest to largest blast radius. Each phase is a single-session task.
