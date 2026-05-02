# Coding-agents Conformance Suite — Design

**Date:** 2026-05-02
**Status:** Draft (pending implementation)
**Predecessors:** Slice C₂ (`2026-05-01-coding-agents-slice-c2-design.md`).
**Branch:** `coding-agents-slice-a`.

---

## Why

Slices A → C₂ shipped a working coding-agent platform primitive with two providers (`LocalDockerProvider`, `HostProvider`) and two agent kinds (`claude`, `codex`). The integration tests in `packages/coding-agents/test/integration/` cover lifecycle end-to-end for both kinds, but each is hardcoded to a specific provider. A future Modal / Fly / E2B provider would have no executable contract to satisfy — the only way to know whether a new provider is "correct" is to wire it through the entire stack and re-run all integration tests by hand.

The platform spec (`2026-04-30-coding-agents-platform-primitive-design.md §Testing strategy §Layer 3`) calls for a parameterized provider-agnostic conformance suite. This spec designs that suite and documents how it composes with the existing tests.

## Goals

1. **Document the `SandboxProvider` contract executably** (Layer 1). A new provider author runs the contract suite against their implementation and gets a concrete pass/fail per invariant.
2. **Capture the bridge+handler+provider integration contract** (Layer 2). The current integration tests verify behaviour for two specific providers; extracting them into a parameterized helper means a new provider gets the same coverage by writing one call-site.
3. **Cover the highest-value end-to-end paths with real CLIs** (Layer 4 / §9). Native session import, codex resume materialise, and tool execution side-effects — the surprising failure modes that integration tests with mocked CLIs miss.
4. **Stay small.** v1 is one happy-path test per scenario. No edge-case fuzzing, no large-file `copyTo`, no concurrency stress. Edge cases land incrementally as remote-provider authors surface them.

## Non-goals

- **Full edge-case coverage.** Stress tests, large-payload paths, concurrency races — out of scope for v1.
- **Cross-kind resume.** Deferred per slice C₂ §Non-goals. **Resolved by:** [`docs/superpowers/specs/2026-05-02-coding-agents-cross-kind-resume-design.md`](./2026-05-02-coding-agents-cross-kind-resume-design.md).
- **Performance benchmarks.** Wall-clock thresholds are intentionally absent; the suite asserts correctness, not speed.
- **Tests for the bridge in isolation** (without a provider). The bridge already has unit tests via `FakeSandbox`; conformance scenarios always involve a real provider since that's what authors need to verify.
- **A separate published package.** v1 lives in-tree under `packages/coding-agents/src/conformance/` and is exported via a sub-path. No new npm artefact.

---

## §1. Architecture overview

Two parameterized test functions, both exported from `@electric-ax/coding-agents/conformance`:

```ts
// packages/coding-agents/src/conformance/index.ts
import type {
  SandboxProvider,
  SandboxSpec,
  Bridge,
  CodingAgentKind,
} from '../types'

export interface SandboxProviderConformanceConfig {
  /** Constructs a fresh provider instance. Called once per test file. */
  createProvider: () => SandboxProvider | Promise<SandboxProvider>
  /**
   * Returns a scratch workspace plus a cleanup. The suite calls cleanup
   * in an afterEach for the test that consumed it, even on failure.
   */
  scratchWorkspace: () => Promise<{
    spec: SandboxSpec[`workspace`]
    cleanup: () => Promise<void>
  }>
  /** Skip the entire suite if this returns truthy. */
  skipIf?: () => boolean | Promise<boolean>
  /**
   * If false, L1.4 (`recover` adopts running instances) is `it.skip`'d
   * because the provider's `recover()` is documented to return `[]`.
   * HostProvider sets this false; LocalDocker leaves the default true.
   */
  supportsRecovery?: boolean
}

export function runSandboxProviderConformance(
  name: string,
  config: SandboxProviderConformanceConfig
): void

export interface CodingAgentsIntegrationConformanceConfig
  extends SandboxProviderConformanceConfig {
  /** Bridge under test (StdioBridge today; future ShimBridge). */
  bridge: () => Bridge
  /** Per-kind env. Returning null skips that kind's blocks. */
  envForKind: (kind: CodingAgentKind) => Record<string, string> | null
  /** Per-kind probe: minimal echo prompt + expected response matcher. */
  probeForKind: (kind: CodingAgentKind) => {
    prompt: string
    expectsResponseMatching: RegExp
    model?: string
  }
  /** target the provider is known to support ('sandbox' | 'host'). */
  target: SandboxSpec[`target`]
}

export function runCodingAgentsIntegrationConformance(
  name: string,
  config: CodingAgentsIntegrationConformanceConfig
): void
```

**Test files become thin call-sites:**

```ts
// packages/coding-agents/test/integration/local-docker-conformance.test.ts
import {
  runSandboxProviderConformance,
  runCodingAgentsIntegrationConformance,
} from '../../src/conformance'
import { LocalDockerProvider, StdioBridge } from '../../src'
import { buildTestImage, TEST_IMAGE_TAG } from '../support/build-image'
import { envForKind, loadTestEnv, probeForKind } from '../support/env'

const SHOULD_RUN = process.env.DOCKER === `1`
const env = loadTestEnv()

beforeAll(async () => {
  if (SHOULD_RUN) await buildTestImage()
}, 600_000)

runSandboxProviderConformance(`LocalDockerProvider`, {
  createProvider: () => new LocalDockerProvider({ image: TEST_IMAGE_TAG }),
  scratchWorkspace: async () => ({
    spec: {
      type: `volume`,
      name: `conf-${Math.random().toString(36).slice(2)}`,
    },
    cleanup: async () => undefined, // volumes auto-clean via docker
  }),
  skipIf: () => !SHOULD_RUN,
})

runCodingAgentsIntegrationConformance(`LocalDockerProvider`, {
  createProvider: () => new LocalDockerProvider({ image: TEST_IMAGE_TAG }),
  scratchWorkspace: async () => ({
    spec: {
      type: `volume`,
      name: `conf-int-${Math.random().toString(36).slice(2)}`,
    },
    cleanup: async () => undefined,
  }),
  bridge: () => new StdioBridge(),
  envForKind: (kind) => envForKind(env, kind),
  probeForKind: (kind) => probeForKind(env, kind),
  target: `sandbox`,
  skipIf: () => !SHOULD_RUN,
})
```

`HostProvider` gets an analogous file with `target: 'host'` and `tmpdir` bind-mounts. Future Modal/Fly impls add their own file with no other code to write.

**Why two functions, not one:** the contract suite (Layer 1) needs no real CLI or API key — it can run in any CI without secrets. The integration suite (Layer 2) gates on `DOCKER=1` + per-kind keys. Decoupling means a remote-provider author can verify the contract first, then plug into the integration suite once they've wired their CLI runner.

---

## §2. Layer 1 — `SandboxProvider` contract

Eight scenarios. Each is one `it(...)` per provider, no parameterization by kind (provider is kind-agnostic). Run in `describe('SandboxProvider conformance — <name>', ...)`.

| #    | Scenario                              | What it asserts                                                                                                                                                           |
| ---- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L1.1 | `start` is idempotent on agentId      | Calling `start(spec)` twice with the same `spec.agentId` returns the same `instanceId` (no second sandbox spawned).                                                       |
| L1.2 | `start` after `destroy` creates fresh | After `destroy(agentId)`, a subsequent `start(spec)` for that agentId yields a new `instanceId`.                                                                          |
| L1.3 | `status` reflects lifecycle           | `status` returns `unknown` before first start, `running` after start, `stopped` after destroy (or `unknown` if the provider drops the record).                            |
| L1.4 | `recover()` adopts running instances  | Start an instance with provider A; construct a fresh provider B with the same image config; `B.recover()` returns an entry whose `agentId` and `target` match A's.        |
| L1.5 | `exec` honours `cwd` and `env`        | Run `pwd` with `cwd` set; assert stdout matches. Run `printenv FOO` with `env: { FOO: 'bar' }`; assert stdout is `bar`.                                                   |
| L1.6 | `exec` stdin pipe round-trip          | `exec({ cmd: ['cat'], stdin: 'pipe' })`, write `'hello'`, close, drain stdout, expect `'hello'`.                                                                          |
| L1.7 | `copyTo` round-trip                   | `copyTo({ destPath: '/tmp/x', content: 'abc' })`, then `exec(['cat', '/tmp/x'])`, expect `'abc'`. Also asserts mode 0o600 by reading `stat -c %a` (Linux only — guarded). |
| L1.8 | `homeDir` matches exec view           | `exec(['sh', '-c', 'echo $HOME'])` stdout equals `sandbox.homeDir`.                                                                                                       |

**What's deliberately not tested at this layer:**

- Concurrent `start` for different agentIds (would be Important but adds non-determinism for v1).
- Large-file `copyTo` (covered by existing slice-c1 integration test).
- `exec` kill / signal handling (covered by existing local-docker.test.ts).
- `destroy(unknownAgentId)` idempotency — covered implicitly by L1.2.

Each test creates one fresh provider, runs its scenario, calls `provider.destroy(agentId)` in a `try/finally`. No shared state between tests.

---

## §3. Layer 2 — Integration (provider + bridge + handler)

Six scenarios. Each runs once per `kind` registered with the adapter registry, gated by `envForKind(kind) !== null`. Built on top of a minimal in-memory ctx similar to `slice-a.test.ts`'s `makeFakeCtx` (extracted to `src/conformance/fake-ctx.ts`).

| #    | Scenario                             | What it asserts                                                                                                                                                                                                                                                                                                                                                    |
| ---- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| L2.1 | Cold-boot + first prompt completes   | First prompt → `running` → bridge runs → `idle`; one `runs` row with `status='completed'`; events collection contains `session_init` + `assistant_message`.                                                                                                                                                                                                        |
| L2.2 | Warm second prompt reuses sandbox    | Second prompt while `idle` reuses the same `instanceId`; `sandbox.starting`/`sandbox.started` lifecycle rows NOT emitted (warm path).                                                                                                                                                                                                                              |
| L2.3 | Resume after `stop` cold-boots       | `stop` → `cold` + `instanceId` cleared; next prompt emits new lifecycle starting/started; `--resume <id>` argv contains the prior session id (claude) or `resume <id>` subcommand (codex).                                                                                                                                                                         |
| L2.4 | Crash recovery / orphan run          | Inject a stale `runs` row with `status='running'` whose `startedAt < lm.startedAtMs`; reconcile transitions it to `failed:orphaned`; next prompt succeeds normally.                                                                                                                                                                                                |
| L2.5 | Workspace persists across teardown   | Use the provider's `copyTo` to seed a sentinel file in the workspace BEFORE the first agent spawns. Run a prompt; destroy the agent. Re-spawn a fresh agent on the same `workspaceIdentity`; the test asserts via `provider.exec(['cat', '/workspace/sentinel.txt'])` that the file is still there. (Avoids relying on the LLM to write a file deterministically.) |
| L2.6 | Shared-workspace lease serialisation | Two agents on the same `workspaceIdentity`; prompts to both concurrently; assert their runs do not overlap (run A's `endedAt ≤` run B's `startedAt` or vice versa).                                                                                                                                                                                                |

**Why these six exactly:** they're the scenarios from the platform spec §Testing strategy §Layer 3 minus cross-kind resume. They map 1:1 to the existing `slice-a.test.ts` body — extracting them is largely a refactor, not new test authoring.

**What's deliberately not at this layer:**

- Idle-eviction roundtrip (`slice-c1.test.ts`) — stays where it is. The roundtrip exercises `LifecycleManager.armIdleTimer` + `wakeEntity` callback, which are runtime wiring, not provider semantics.
- Native-session import (`slice-b.test.ts`) — claude-specific path math; not a provider invariant.
- `recover()` rehydration after a "real" agents-server restart — needs full bootstrap; out of scope for the suite.

Each scenario uses a synthetic `ctx` and constructs `LifecycleManager` + `WorkspaceRegistry` + handler in the test, just like `slice-a.test.ts` does today. The conformance helper extracts that boilerplate so each scenario is ~15 lines of assertions.

---

## §4. Packaging — sub-path export

`packages/coding-agents/package.json` gains a sub-path entry:

```json
"exports": {
  ".": {
    "import": { "types": "./dist/index.d.ts", "default": "./dist/index.js" },
    "require": { "types": "./dist/index.d.cts", "default": "./dist/index.cjs" }
  },
  "./conformance": {
    "import": { "types": "./dist/conformance/index.d.ts", "default": "./dist/conformance/index.js" },
    "require": { "types": "./dist/conformance/index.d.cts", "default": "./dist/conformance/index.cjs" }
  },
  "./package.json": "./package.json"
}
```

`tsdown.config.ts` adds the conformance entry alongside the existing CLI entry:

```ts
{
  entry: [`./src/conformance/index.ts`],
  outDir: `dist/conformance`,
  format: [`esm`, `cjs`],
  dts: true,
  sourcemap: true,
}
```

`vitest` is the only test-only dependency the conformance entry imports. Two options:

- **(a)** Add `vitest` to `peerDependencies` (with `peerDependenciesMeta.optional: true`). Consumers must install vitest themselves to use the suite. Aligns with how `@anthropic-ai/sdk/testing` works.
- **(b)** Move `vitest` from `devDependencies` to `dependencies`. Simpler for consumers; pulls vitest into prod node_modules even when the conformance entry isn't imported.

**Decision: (a).** The conformance entry is opt-in and test-time. Bundling vitest into prod deps would inflate every consumer of `@electric-ax/coding-agents` for a feature 99% of consumers don't use.

---

## §5. Migration of existing tests

The existing integration tests aren't deleted; they keep their adapter-parameterized loops. Where they overlap with the new conformance suite, the conformance helper imports the same scenario logic and the legacy file becomes a thin call-site:

| Existing file                            | Action                                                                                                                                                                                        |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test/integration/slice-a.test.ts`       | Replace its `it(...)` body with `runCodingAgentsIntegrationConformance('LocalDockerProvider', {...})`. The `describe.each(listAdapters())` outer loop becomes part of the conformance helper. |
| `test/integration/host-provider.test.ts` | Same: call `runSandboxProviderConformance` + `runCodingAgentsIntegrationConformance` with `target: 'host'` config.                                                                            |
| `test/integration/smoke.test.ts`         | Stays as-is. Smoke is "minimum viable end-to-end check"; the integration conformance suite supersedes it for routine CI but smoke remains a quick sanity.                                     |
| `test/integration/slice-b.test.ts`       | Stays — covers claude-specific transcript materialisation that isn't a provider invariant.                                                                                                    |
| `test/integration/slice-c1.test.ts`      | Stays — covers C₁ idle-eviction roundtrip.                                                                                                                                                    |

The new conformance test files:

- `test/integration/local-docker-conformance.test.ts` — calls both Layer 1 and Layer 2 functions for `LocalDockerProvider`. Replaces most of `slice-a.test.ts`'s body.
- `test/integration/host-provider-conformance.test.ts` — same for `HostProvider` with `target: 'host'`. Replaces most of `host-provider.test.ts`.

Net: ~150 LOC of integration-test code consolidated into ~250 LOC of reusable conformance helpers + ~50 LOC per provider call-site. Slight LOC growth, but the extracted helpers are imported by external provider authors so the cost is paid once.

---

## §6. Skip semantics

A scenario can be inapplicable for a provider:

- `HostProvider` doesn't support `volume` workspaces — the suite's scratchWorkspace returns a `bindMount`. Layer 1's `recover()` test (L1.4) is meaningful for HostProvider only if its `recover` returns non-empty; current impl returns `[]`, so L1.4 should `it.skip` for any provider whose `recover()` is documented to return `[]`. The config gains an optional `supportsRecovery?: boolean` flag (default `true`).
- Layer 2's L2.6 (shared-workspace lease) requires a workspace type that supports sharing — `volume` for docker, `bindMount` for host. The suite uses whatever `scratchWorkspace` returns; if the provider can't create two agents on the same workspace, the test fails informatively.

Per-scenario skip conditions live in the suite (gated on `config.target === 'host' ? ... : ...` etc.). Avoids each provider author having to know which scenarios apply.

---

## §7. Failure-mode contract

When a scenario fails, the assertion message must be **diagnostic for a provider author**, not just say "expected X got Y". Examples:

- L1.1 idempotency failure: `"start() returned a fresh instanceId for the same agentId. Provider must reuse running instances. Got: instance1='abc' instance2='def'."`
- L1.4 recover failure: `"provider.recover() returned no entry for agentId X after starting. recover() must surface previously-started instances; relevant for crash-recovery and idle-eviction wakeup."`
- L2.4 orphan failure: `"reconcile didn't transition stale 'running' run to 'failed:orphaned'. Check that LifecycleManager.startedAtMs is captured at construction and runs whose startedAt predate it are reconciled."`

This is enforced at writing time (review during implementation) rather than schema-level. A note in the suite header reminds future contributors.

---

## §8. Acceptance criteria

- New `packages/coding-agents/src/conformance/index.ts` exports `runSandboxProviderConformance` + `runCodingAgentsIntegrationConformance`.
- `package.json` `./conformance` sub-path is built by tsdown and resolves correctly.
- `pnpm -C packages/coding-agents test test/integration/local-docker-conformance.test.ts` (gated on `DOCKER=1`) — all Layer 1 + Layer 2 scenarios pass for both kinds when keys present.
- `pnpm -C packages/coding-agents test test/integration/host-provider-conformance.test.ts` (gated on `HOST_PROVIDER=1`) — Layer 1 + Layer 2 pass for both kinds.
- `slice-a.test.ts` and `host-provider.test.ts` reduced to call-site stubs (or removed if entirely subsumed).
- `slice-b.test.ts`, `slice-c1.test.ts`, `smoke.test.ts` unchanged.
- Manual sanity: a hypothetical third provider in 50 LOC of stub returning canned ExecHandle objects compiles and reports each Layer 1 scenario as fail with diagnostic messages.
- F1, E1, E2, E3 from §9 land in the same slice. F1 verified by codex test runs visibly using `gpt-5-codex-mini`. E1/E2/E3 pass `@slow` runs against real CLIs.

---

## §9. Layer 4 — End-to-end smoke (real CLIs, side effects)

The conformance suite (Layers 1+2) verifies provider correctness and integration semantics. Layer 4 verifies the most surprising failure modes in production: native session import, codex resume materialise, and tool execution actually mutating the workspace. These are kind-specific (paths, tool argv, file-write semantics differ between claude and codex), so they aren't parameterized — each is its own dedicated test file.

All Layer 4 tests are `@slow`-tagged, gated on the relevant API key, and intended for nightly + post-merge CI rather than every push.

### F1 — Cheap-model fix in CodexAdapter

Pre-requisite, not a test. `CodexAdapter.buildCliInvocation` currently ignores the `model` parameter (`model: _model`). Codex 0.128.0 doesn't read `OPENAI_MODEL` from env; it picks model from `~/.codex/config.toml` (default `gpt-5-codex` — expensive) or from `-c model="<id>"` flag. Fix:

```ts
buildCliInvocation({ prompt, nativeSessionId, model }) {
  const codexArgs: Array<string> = [`exec`, `--skip-git-repo-check`, `--json`]
  if (model) codexArgs.unshift(`-c`, `model="${model}"`)
  if (nativeSessionId) codexArgs.push(`resume`, nativeSessionId)
  codexArgs.push(`--`, prompt)
  // ... rest unchanged
}
```

The bridge already passes `args.model` through; integration tests already supply `OPENAI_MODEL` via `probeForKind`. After F1, codex test turns visibly run on the cheap model in `codex --version`-style logs (or, when not, codex-cli prints a config-source line that surfaces the override). Quick to verify by checking the cost dashboard before/after.

This fix is real-production behaviour, not a test concern — codex agents spawned by Horton today silently use the default model. F1 should land before or with the Layer 4 tests so the e2e runs are themselves cheap.

### E1 — Native session import end-to-end

Two test files: `test/integration/import-claude.e2e.test.ts`, `test/integration/import-codex.e2e.test.ts`. Each:

1. Pre-stage a JSONL transcript on the host's filesystem at the kind's expected location (claude: `~/.claude/projects/<sanitised>/<id>.jsonl`; codex: `~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<id>.jsonl`). Content: a 3-message conversation ending with assistant saying `"the secret word is ELEPHANT"`.
2. Invoke the CLI: `node packages/coding-agents/dist/cli/import.js --agent <kind> --workspace <ws> --session-id <id> --server <url>`.
3. Wait for entity status (poll `/coding-agent/<name>` until `status` reflects the imported state).
4. Assert: (a) `sessionMeta.nativeSessionId === <id>`, (b) `events` collection contains the backfilled `assistant_message` events including the ELEPHANT message.
5. Send a follow-up prompt: `"what was the secret word? answer in one word."`.
6. Wait for `runs` to show `status='completed'`.
7. Assert: response text contains `ELEPHANT` (case-insensitive). Confirms `--resume` actually picked up the imported context.
8. Cleanup: destroy the agent, remove the staged JSONL.

Gated on `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` respectively. ~80 LOC per kind including helper extraction.

### E2 — Codex resume materialise (deferred from code review I-4)

`test/integration/codex-resume.e2e.test.ts`. Two-turn codex flow:

1. Spawn a codex agent with bind-mount workspace, send turn 1 prompt: `"remember the word PINEAPPLE — reply with just OK"`.
2. Wait for run completion.
3. Force the sandbox down (`provider.destroy(agentId)`) to drop the in-memory state.
4. Assert: `sessionMeta.nativeSessionId` is set; `nativeJsonl.content` is non-empty.
5. Send turn 2: `"what word should you remember?"`.
6. Wait for run completion.
7. Assert: response text contains `PINEAPPLE` (case-insensitive). Verifies the codex resume materialise path: `find ~/.codex/sessions -name "*-<id>.jsonl"` probe → not found → write captured blob → `codex exec resume <id>` finds it.

Gated on `OPENAI_API_KEY`. ~50 LOC.

### E3 — Tool execution + workspace side-effect

Two test files: `test/integration/tool-execution-claude.e2e.test.ts`, `test/integration/tool-execution-codex.e2e.test.ts`. Each:

1. Spawn agent with a fresh empty workspace.
2. Send prompt: `"create a file called hello.txt with the single word 'world'. then reply with: done."`.
3. Wait for run completion.
4. Assert: (a) at least one `tool_call` event with the file-write tool name (claude: `Write`/`Edit`; codex: `apply_patch` or `function_call` with name `write_file` — exact strings depend on CLI version, so use a regex `/write|edit|apply_patch/i`), (b) at least one `tool_result` event with `isError === false`.
5. Read the workspace from the host: `provider.exec(['cat', '/workspace/hello.txt'])` (sandbox) or `fs.readFile(<bindMount>/hello.txt)` (host).
6. Assert: file contents match `/world/i`.
7. Cleanup workspace.

This is the Layer 4 test from the platform spec verbatim. Catches: (a) CLI-version argv drift for tool names, (b) sandbox FS write permission regressions, (c) bridge `tool_call`/`tool_result` event normalisation gaps, (d) the codex `function_call_output.isError` parsing fix from slice C₂ post-review.

Gated on the relevant key. ~70 LOC per kind.

### Layer 4 packaging

These tests live in `packages/coding-agents/test/integration/` alongside the existing files but have a `.e2e.test.ts` suffix to make CI scheduling explicit:

- `pnpm test` → unit only, fast (no API keys, no docker).
- `DOCKER=1 pnpm test test/integration/{smoke,slice-*,host-provider}.test.ts` → existing integration. Cheap models.
- `DOCKER=1 SLOW=1 pnpm test test/integration/*.e2e.test.ts` → Layer 4 only. Requires keys, costs real money. Nightly CI gate.

Vitest gating: a `describe.skip(SLOW !== '1' ? "skip-slow" : "run-slow")` wrapper at file scope.

### Layer 4 cost estimate

Per nightly run: 2 imports × 3 turns + 1 codex resume × 2 turns + 2 tool-exec × 2 turns ≈ 12 turns of which ~10 are claude (~$0.05) and ~4 are codex (~$0.30 with F1's mini model). Total ~$0.35/night, ~$10/month.

---

## Open questions

None. Two were addressed in scoping:

- _Scope of v1_: happy-path per scenario (option C from brainstorming).
- _Packaging_: sub-path export from the existing package (option C from brainstorming).
