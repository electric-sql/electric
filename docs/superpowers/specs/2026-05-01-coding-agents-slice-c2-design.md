# Coding-agents Slice C₂ — Codex parity + per-agent test harness

**Date:** 2026-05-01
**Status:** Draft (pending implementation)
**Predecessors:** Slice A, Slice B, Slice C₁, host-target/native-import.
**Branch:** `coding-agents-slice-a` (continued).

---

## Why

Slices A → C₁ shipped a working coding-agent platform primitive, but only for `claude`. The bridge rejects `kind: 'codex'`. Every kind-specific surface (CLI argv, transcript paths, env vars, image, import CLI) is hardcoded to claude. Adding a second agent today requires touching ~6 files; a third agent would compound the cost.

This slice does two things in one merge:

1. **Adds codex parity.** Bridge runs codex turns; image bakes codex; host provider runs codex on the host; lifecycle (cold-boot, resume, lease serialisation, crash recovery, destroy) works identically for codex.
2. **Refactors the test harness so agent N+1 is cheap.** A single registry of `CodingAgentAdapter`s drives bridge, handler, CLI, and tests. Every test layer is parameterized by adapter; adding a new agent means writing one adapter file, recording three transcript fixtures, and dropping in an API key.

Cross-kind resume (claude → codex on the same agent) is **out of scope** — deferred to a follow-up. The architecture supports it (events collection is canonical) but the test surface and `denormalize` correctness work belong in their own slice.

## Non-goals

- **Cross-kind resume.** Programmatic conversion of an agent's `kind` after spawn. Deferred.
- **`SandboxProvider` conformance suite.** Provider-parameterized tests (Modal/Fly/E2B). Deferred — orthogonal axis.
- **UI affordance for codex.** The kind enum widens, so the existing spawn dialog renders codex automatically; no new dialog work in this slice.
- **Codex authentication via `codex login`.** Operators provide `OPENAI_API_KEY`; ChatGPT-login flow not supported.
- **Operator gate to disable codex.** Both kinds always available.

---

## §1. Adapter interface and registry

New module `packages/coding-agents/src/agents/registry.ts`:

```ts
import type { AgentType } from 'agent-session-protocol'

export type CodingAgentKind = AgentType // 'claude' | 'codex'

export interface CodingAgentAdapter {
  readonly kind: CodingAgentKind

  /** CLI binary name on $PATH inside the sandbox/host. */
  readonly cliBinary: string

  /** Env vars sourced from process.env and forwarded to the CLI. */
  readonly defaultEnvVars: ReadonlyArray<string>

  /**
   * Build argv plus how the prompt is delivered.
   *   claude → stdin
   *   codex  → argv tail
   */
  buildCliInvocation(opts: {
    prompt: string
    nativeSessionId?: string
    model?: string
  }): { args: ReadonlyArray<string>; promptDelivery: 'stdin' | 'argv' }

  /**
   * Path the CLI will read on `--resume <sessionId>` inside the sandbox.
   * Probed by the handler before each turn; written from nativeJsonl.content
   * if missing.
   */
  resumeTranscriptPath(opts: {
    homeDir: string
    cwd: string
    sessionId: string
  }): string

  /**
   * Shell command that prints the transcript the CLI just wrote,
   * base64-encoded with no line breaks, to stdout. Empty stdout means
   * "no transcript found" (treated as no-op by the handler). The base64
   * wrapping is part of the adapter's contract because it lets the
   * handler use a single drain-and-decode path regardless of kind, and
   * avoids stream-drain hangs observed on the Slice A docker exec stdio
   * path with raw binary output.
   *
   * Claude: `sh -c 'if [ -f <path> ]; then base64 -w 0 <path>; fi'`.
   * Codex:  `sh -c 'f=$(find ~/.codex/sessions -name "*-<id>.jsonl" |
   *                  head -1); if [ -n "$f" ]; then base64 -w 0 "$f"; fi'`.
   */
  captureCommand(opts: {
    homeDir: string
    cwd: string
    sessionId: string
  }): ReadonlyArray<string>

  /** Optional kind-specific post-import setup (e.g. claude history.jsonl). */
  postImport?(opts: {
    homeDir: string
    cwd: string
    sessionId: string
    transcriptContent: string
  }): Promise<void> | void
}

const adapters = new Map<CodingAgentKind, CodingAgentAdapter>()
export function registerAdapter(a: CodingAgentAdapter): void
export function getAdapter(k: CodingAgentKind): CodingAgentAdapter
export function listAdapters(): ReadonlyArray<CodingAgentAdapter>
```

Implementations:

- `src/agents/claude.ts` — `ClaudeAdapter`. Extracts the argv currently in `stdio-bridge.ts` (`--print --output-format=stream-json --verbose --dangerously-skip-permissions`, optional `--model`/`--resume`), prompt on stdin. `resumeTranscriptPath` returns `${homeDir}/.claude/projects/${sanitiseCwd(cwd)}/${sessionId}.jsonl`. `captureCommand` is `['cat', resumeTranscriptPath(...)]` wrapped in `sh -c` to swallow ENOENT cleanly.
- `src/agents/codex.ts` — `CodexAdapter`. argv `['exec', '--skip-git-repo-check', '--json']` plus `['resume', sessionId]` when resuming, prompt appended to argv, no model flag (codex uses `OPENAI_*` env). `resumeTranscriptPath` returns a write target reconstructed from the captured content's first JSONL line (codex's first line carries the rollout timestamp). The handler still probes via `find ~/.codex/sessions -name "*-<sessionId>.jsonl"` to decide whether materialise is needed; codex's resume command resolves sessionId by scanning, so the YYYY/MM/DD subpath only has to exist, not match the original creation date. **Reconstruction-failure fallback:** if the captured blob's first line does not parse as JSON or lacks a recognisable timestamp field, write under today's date — `${homeDir}/.codex/sessions/${todayYYYY}/${todayMM}/${todayDD}/rollout-${ts}-${sessionId}.jsonl` with `ts` = ISO timestamp at materialise time. The session is still findable by codex's resume scan.

Both adapters registered eagerly when `src/index.ts` is loaded.

**Why a registry vs. hardcoded imports.** Tests iterate (`describe.each(listAdapters())`); a future internal adapter can be registered without changing imports. Adding agent N+1 is a localised diff: one file, one registration, no other surface touched.

**Why an `AgentType`-aligned `kind` rather than a fresh enum.** Reusing the protocol package's vocabulary keeps `normalize(lines, kind)` and `denormalize(events, kind)` calls type-safe across the boundary; future protocol additions auto-flow.

---

## §2. Component changes

### `src/types.ts`

```ts
import type { AgentType } from 'agent-session-protocol'
export type CodingAgentKind = AgentType // was: 'claude' | 'codex' (literal)
// SpawnCodingAgentOptions.kind widens from `'claude'` to CodingAgentKind.
```

### `src/bridge/stdio-bridge.ts`

Drops the `if (args.kind !== 'claude')` guard. Replaces hardcoded argv with:

```ts
const adapter = getAdapter(args.kind)
const { args: cliArgs, promptDelivery } = adapter.buildCliInvocation({
  prompt: args.prompt,
  nativeSessionId: args.nativeSessionId,
  model: args.model,
})
const handle = await args.sandbox.exec({
  cmd: [adapter.cliBinary, ...cliArgs],
  cwd: args.sandbox.workspaceMount,
  stdin: promptDelivery === 'stdin' ? 'pipe' : 'ignore',
})
if (promptDelivery === 'stdin') {
  if (!handle.writeStdin || !handle.closeStdin) throw new Error(...)
  await handle.writeStdin(args.prompt)
  await handle.closeStdin()
}
// stdout/stderr drain unchanged
const events = normalize(rawLines, args.kind)
```

`normalize(rawLines, args.kind)` already handles both kinds in `agent-session-protocol`.

### `src/entity/handler.ts`

`ensureTranscriptMaterialised` switches from claude-hardcoded path math to adapter-driven:

```ts
const adapter = getAdapter(meta.kind)
const fullPath = adapter.resumeTranscriptPath({
  homeDir: '/home/agent',
  cwd: sandbox.workspaceMount,
  sessionId: nativeSessionId,
})
// existing test -f / mkdir -p / copyTo flow unchanged
```

`captureTranscript` swaps the inline `sh -c "if [ -f .. ]; then base64 -w 0 ..."` for `adapter.captureCommand(...)`. The base64 round-trip is now part of the adapter's command contract (see §1) — handler runs the command raw and decodes stdout as a single base64 string. Empty stdout means "no transcript found" and is treated as no-op.

First-wake `importNativeSessionId` flow: home-side path is now adapter-aware. For claude, the deterministic path is reconstructed exactly as today. For codex, the import flow uses `agent-session-protocol`'s `findSessionPath('codex', sessionId)` to locate the source file on the host before reading.

### `src/entity/collections.ts`

```ts
kind: z.enum(['claude', 'codex']),  // was: z.enum(['claude'])
```

Existing rows with `kind: 'claude'` remain valid. No data migration; codex agents are net-new.

### `src/entity/register.ts`

`creationArgsSchema.kind` widens to `z.enum(['claude', 'codex']).optional()`. `RegisterCodingAgentDeps.env` signature changes:

```ts
env?: (kind: CodingAgentKind) => Record<string, string>
```

Default implementation:

```ts
const env =
  deps.env ??
  ((kind) => {
    const adapter = getAdapter(kind)
    const out: Record<string, string> = {}
    for (const k of adapter.defaultEnvVars) {
      const v = process.env[k]
      if (v) out[k] = v
    }
    return out
  })
```

Handler call sites pass `options.env(meta.kind)` instead of `options.env()`.

### `src/cli/import-claude.ts` → `src/cli/import.ts`

Renamed; gains `--agent claude|codex` (default `claude`). Path validation delegates to per-kind logic:

- claude: existing `~/.claude/projects/<sanitised-cwd>/<id>.jsonl` deterministic check.
- codex: `findSessionPath('codex', id)` from `agent-session-protocol`.

`package.json`:

```json
"bin": {
  "electric-ax-import": "./dist/cli/import.js"
}
```

Clean break: `electric-ax-import-claude` is removed. The CLI was added recently (commit `f539a8d51` on this branch, pre-1.0) and has no documented external consumers, so a one-release back-compat shim isn't justified. Anyone calling the old name updates to `electric-ax-import --agent claude`.

---

## §3. Docker image and env policy

### `docker/Dockerfile`

```dockerfile
RUN npm install -g @anthropic-ai/claude-code@latest @openai/codex@latest \
    && claude --version && codex --version
```

`@openai/codex@latest` pinned to a known-good version after step 1 of build sequence verifies argv shape against the spec. Both `~/.claude` and `~/.codex` exist under `/home/agent` once the user runs each CLI for the first time; the handler's existing `mkdir -p <parent>` before `copyTo` covers codex's nested date directories.

### Env policy

`SandboxSpec.env: Record<string, string>` is opaque to providers; no provider changes. Per-kind population happens at the handler call site via `options.env(meta.kind)`. `defaultEnvVars`:

- `ClaudeAdapter`: `['ANTHROPIC_API_KEY']` (matches existing behaviour).
- `CodexAdapter`: `['OPENAI_API_KEY']`.

The slice-C₁ env-file path (`/run/agent.env` via `--env-file`) is unaffected: env reaches the file the same way regardless of kind.

---

## §4. Test harness parameterization

The load-bearing payoff. Every test layer is `describe.each(listAdapters())`-parameterized so adding agent N+1 picks up the suite for free.

### Unit (no Docker, no API keys)

- **`test/unit/stdio-bridge.test.ts`** — restructured as:
  ```ts
  describe.each(listAdapters().map((a) => [a.kind, a] as const))(
    `StdioBridge — %s`,
    (kind, adapter) => {
      it(`builds expected argv`, async () => {
        // Drive through bridge with FakeSandbox
        // Assert cmd[0] === adapter.cliBinary, snapshot the rest
      })
      it(`delivers prompt via ${adapter promptDelivery}`, async () => { ... })
      it(`passes --resume / resume <id> when nativeSessionId set`, async () => { ... })
      it(`throws with stderr on non-zero exit`, async () => { ... })
    }
  )
  ```
- **`test/unit/cli-import.test.ts`** — `describe.each` over `(--agent claude|codex)`. Asserts request body shape and per-kind on-disk path validation against a temp homedir.
- **`test/unit/entity-handler.test.ts`** — adds `import-codex+host` validation case mirroring the existing claude one; widens existing `kind` assertions to be value-based rather than literal.
- **`test/unit/agents-registry.test.ts`** (new) — sanity contract: every adapter has non-empty `cliBinary`, `defaultEnvVars`, returns argv array, returns string from `resumeTranscriptPath`. Catches drift if a future adapter forgets a method.

### Recorded fixtures

Directory layout: `test/fixtures/<kind>/<scenario>.jsonl`.

Scenarios per kind:

- `first-turn.jsonl` — session_init + assistant_message + result, no resume.
- `resume-turn.jsonl` — session_init with the resumed id, assistant_message referencing prior turn.
- `error.jsonl` — non-zero exit case (CLI prints stderr; stdout has partial JSONL).

Fixtures are captured **once** from a real CLI run (manual; instructions in `test/fixtures/README.md`) and checked in. The bridge unit test feeds them through `StdioBridge` using a `FakeSandbox` whose `stdout` async-iterates the fixture lines — exercising real `normalize()` per kind without Docker or API keys.

Why fixtures: lets the unit suite assert end-to-end normalize behaviour per kind in CI without paying for API calls or Docker. New agent → record three fixtures, drop in a folder.

### Integration (`DOCKER=1`)

- **`test/integration/slice-a.test.ts`** — body lifted into a function `runSliceALifecycle(adapter)` and called via `describe.each(listAdapters())`. Each adapter contributes a `testProbe`:
  ```ts
  interface AdapterTestProbe {
    minimalEchoPrompt: string // e.g. 'Reply with the single word: ok'
    expectsResponseMatching: RegExp // /ok/i
    cheapModel?: string // claude-haiku for claude; codex's smallest for codex
  }
  ```
  Exposed off the adapter (or a sibling `adapter-test-support.ts` per kind to keep production code lean). Every existing assertion (cold-boot completes, idle stops the sandbox, lease-serialised concurrent runs, orphan reconciliation, destroy) runs once per registered adapter.
- **`test/integration/host-provider.test.ts`** — same pattern, gated by `HOST_PROVIDER=1`.
- **`test/integration/smoke.test.ts`** — same pattern, gated by `DOCKER=1`.

### API-key handling

`test/support/env.ts`:

```ts
export interface TestEnv {
  ANTHROPIC_API_KEY?: string
  ANTHROPIC_MODEL?: string
  OPENAI_API_KEY?: string
  OPENAI_MODEL?: string
}
export function loadTestEnv(): TestEnv
export function requireKeyForKind(env: TestEnv, kind: CodingAgentKind): string
```

The `describe.each` blocks call `requireKeyForKind` inside `beforeAll`; missing key for a kind makes that kind's block skip (not fail) with a clear console message. CI workflows that have one key but not the other still run the kind they have keys for.

### The "easy to add agents" promise

Adding agent N+1:

1. Write `src/agents/<kind>.ts` implementing `CodingAgentAdapter`.
2. Register it in `src/index.ts`.
3. Record three fixtures under `test/fixtures/<kind>/`.
4. Add an entry to `test/support/env.ts` `requireKeyForKind` switch.
5. (Optional) Add the CLI to `docker/Dockerfile`.

Every existing test layer picks up the new kind automatically. No edits to bridge, handler, register, or any test scaffolding.

---

## §5. Build sequence

1. **Adapter scaffold.** Add `src/agents/{registry.ts,claude.ts,codex.ts}`. Register both at index load. Add `test/unit/agents-registry.test.ts`. Verify `codex --help` matches the assumed argv before pinning `@openai/codex` version.
2. **Bridge refactor.** Replace hardcoded argv in `stdio-bridge.ts` with adapter calls. Existing claude unit tests stay green (assertions now route through `getAdapter('claude')`).
3. **Handler refactor.** Switch `ensureTranscriptMaterialised` and `captureTranscript` to adapter-driven paths. Existing claude integration tests stay green.
4. **Schema widening.** `kind` enum to `['claude', 'codex']` in `collections.ts`, `register.ts`, `types.ts`. `env` callback signature change with defaults derived from adapter.
5. **Image bump.** Update `docker/Dockerfile` to install codex. Test image rebuild covered by existing `buildTestImage()` idempotency.
6. **CLI refactor.** Rename `cli/import-claude.ts` → `cli/import.ts` with `--agent` flag. Drop the old `electric-ax-import-claude` bin entry. Update `package.json` bin map.
7. **Unit-test parameterization.** Convert `stdio-bridge.test.ts`, `cli-import.test.ts`, `entity-handler.test.ts` to `describe.each(listAdapters())`. Record codex fixtures under `test/fixtures/codex/`.
8. **Integration-test parameterization.** Convert `slice-a.test.ts`, `host-provider.test.ts`, `smoke.test.ts` similarly. Wire `OPENAI_API_KEY`/`OPENAI_MODEL` into env loader.
9. **Verify.** `pnpm test` (unit). `DOCKER=1 pnpm test:integration` with both keys present. `HOST_PROVIDER=1` with both keys present. Manual UI smoke: spawn a codex agent via the dashboard, send a prompt, observe streaming timeline.

---

## Risks

- **Codex CLI argv drift.** The platform spec's stated form (`codex exec --skip-git-repo-check --json [resume <id>] <prompt>`) was written months ago. Step 1 verifies against installed `codex --help`; spec amendment if drift found.
- **`@openai/codex` version churn.** `latest` may pull a major with breaking changes. Pin to a known-good version (e.g. `@openai/codex@~0.x.y`) once verified.
- **Codex transcript-capture timing.** The `find` command requires the CLI to have flushed the file by the time the bridge runs `captureCommand`. Codex flushes on exit; bridge runs capture _after_ `wait()` resolves, so this is safe by construction. Document the invariant.
- **Codex transcript date-subdir reconstruction on materialise.** When writing the captured blob back to the sandbox for resume, the YYYY/MM/DD subpath is reconstructed from the blob's first JSONL line. If the line is malformed, the slice falls back to today's date — codex's resume scans by sessionId, so the date doesn't strictly need to match the original. Verify on real codex output during step 1.
- **Diff size.** This slice touches ~12 files. Each step is independently reviewable; sequence keeps existing claude tests green at every step.

---

## Migration

- **No data migration.** Existing `kind: 'claude'` rows remain valid. Codex agents are net-new spawns.
- **`electric-ax-import-claude` bin** removed. Callers migrate to `electric-ax-import --agent claude`. No backwards-compat shim — pre-1.0, no documented external consumers.
- **Image tag** unchanged (`electric-ax/coding-agent-sandbox:test`); operators rebuild on next pull.
- **`RegisterCodingAgentDeps.env` signature change** is breaking for any external bootstrap. Internal-only API today; in-tree call sites updated in step 4. No external consumers.

---

## Acceptance criteria

- `pnpm -C packages/coding-agents test` (unit) green: every `describe.each(listAdapters())` block runs for both kinds; no claude-only assertions.
- `DOCKER=1 pnpm -C packages/coding-agents test:integration` green for both kinds (when both keys present).
- `HOST_PROVIDER=1 pnpm -C packages/coding-agents test:integration:host` green for both kinds.
- Manual: spawn a codex agent via the agents-server-ui, send "reply with ok", observe streaming timeline. Restart the server; resume works (turn 2 references turn 1).
- Manual: `electric-ax-import --agent codex --workspace <path> --session-id <id>` imports a host codex session.
- `electric-ax-import` (`--agent claude`) handles the previous claude-import use cases; old `electric-ax-import-claude` bin no longer exists.
- Adding a hypothetical third agent requires touching only `src/agents/`, `test/fixtures/`, and `test/support/env.ts` — confirmed by the build sequence's locality.
