# Coding-agents — Opencode (third agent kind)

**Date:** 2026-05-02
**Status:** Draft (pending implementation)
**Predecessors:** Slice A, B, C₁, C₂ (codex parity), Conformance suite, Cross-kind resume + fork.
**Branch:** `coding-agents-slice-a` (continued).

---

## Why

Slice C₂ designed the `CodingAgentAdapter` registry around the explicit promise: "Adding agent N+1: write `src/agents/<kind>.ts` implementing the adapter, register it in `src/index.ts`, record three fixtures, add an entry to `test/support/env.ts`. Every test layer picks up the new kind automatically." Adding opencode tests that promise.

[opencode-ai](https://github.com/sst/opencode) (sst/opencode, npm package `opencode-ai`) is an actively-maintained open-source coding-agent CLI with a headless `run --format json` mode that maps cleanly onto the existing adapter contract. The reconnaissance pass confirmed:

- Headless invocation: `opencode run --format json --dangerously-skip-permissions [-m provider/model] [-s sessionID] -- <prompt>` (argv-style prompt, codex-shaped).
- Output is newline-delimited JSON with a small event grammar: `step_start`, `text`, `tool_use`, `step_finish`, `reasoning` (5 distinct types).
- Resume via `--continue` (last) or `-s <sessionID>` (specific). Transcripts are **cumulative** across resume invocations (better than claude).
- Storage is **SQLite** at `~/.local/share/opencode/opencode.db`, not a flat file. Round-trip via `opencode export <id>` / `opencode import <file>`.
- Auth via `~/.local/share/opencode/auth.json` (OAuth or API keys), with standard env vars (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, …) honored as per-provider fallback when `auth.json` is missing.

This slice ships **two user-facing capabilities** in opencode's first appearance:

1. **First-class spawnable kind.** Spawn dialog kind picker offers `claude / codex / opencode`. Header lifecycle (Pin / Release / Stop / Convert→Host) works. Bridge runs `opencode run` per turn.
2. **Cold-boot resume.** Per-turn `opencode export` captures the cumulative transcript into the events stream; on cold-boot the prior transcript is materialised back via `opencode import`. Same architectural lane as claude and codex.

## Non-goals (this slice)

- **Cross-kind in/out of opencode.** No `Fork to opencode` / `Convert kind: opencode` from claude/codex, no `Fork from opencode` to other kinds. Deferred to a follow-up slice that includes the upstream `agent-session-protocol` patch + `denormalizeOpencode`. UI gates these visibly with a tooltip.
- **OAuth providers (ChatGPT-Plus etc.).** Auth is env-var-only for v1.
- **Provider auto-detection.** Caller specifies `model` (e.g. `anthropic/claude-haiku-4-5`) at spawn time. No "guess best provider" magic.
- **Persistent opencode data volume.** Tmpfs only; per-turn export/import for resume.
- **HTTP / ACP / serve modes** of opencode. Only the `run` headless subcommand is wrapped.
- **MCP server integration via opencode's own MCP machinery.** Our existing tool plumbing is unchanged.

---

## §1. Adapter contract extension

Add **one optional method** to `CodingAgentAdapter` in `packages/coding-agents/src/agents/registry.ts`:

```ts
interface CodingAgentAdapter {
  // existing fields...
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
}
```

Existing claude + codex adapters omit it (their transcripts are flat files at the materialised path). `OpencodeAdapter` provides:

```ts
postMaterialiseCommand: ({ sessionId }) => [
  `sh`,
  `-c`,
  `opencode import /tmp/opencode-import-${sessionId}.json && rm -f /tmp/opencode-import-${sessionId}.json`,
]
```

**Handler change** (`packages/coding-agents/src/entity/handler.ts:ensureTranscriptMaterialised`):

- After the existing `copyTo` writes captured content to `materialiseTargetPath`, check `adapter.postMaterialiseCommand`.
- If present, execute via `sandbox.exec`, drain stdout/stderr in parallel, assert exit 0.
- On non-zero exit: insert a lifecycle row `resume.import_failed` with the stderr captured to ~200 chars; return `{ written: false }` so subsequent prompts re-attempt the materialise+import flow.
- Existing happy-path remains exact behaviour for claude/codex.

---

## §2. OpencodeAdapter

New file `packages/coding-agents/src/agents/opencode.ts`:

```ts
import type { CodingAgentAdapter } from './registry'
import { registerAdapter } from './registry'

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
    return [
      `sh`,
      `-c`,
      `opencode session list 2>/dev/null | grep -q '${sessionId}'`,
    ]
  },

  captureCommand({ sessionId }) {
    // opencode export prints the session JSON to stdout. base64 to avoid
    // newline/binary corruption on the docker exec stdio pipe.
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

`defaultEnvVars` lists both keys; whichever has a value gets passed in. opencode picks the matching provider at runtime based on the `model` arg.

---

## §3. normalizeOpencode (local, not asp)

`agent-session-protocol@0.0.2`'s `AgentType = 'claude' | 'codex'` is a hard literal union. Extending it requires a fork or upstream PR — out of scope for this slice. Instead, the normalizer lives **inside `packages/coding-agents`** and is invoked directly from the bridge.

New file `packages/coding-agents/src/agents/opencode-normalize.ts`:

```ts
export function normalizeOpencode(
  lines: ReadonlyArray<string>
): Array<NormalizedEvent>
```

### Event mapping

| opencode line                                                    | NormalizedEvent                                                                                                                                                                          | Notes                                                                                                                                                       |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `step_start` (first per session)                                 | `session_init`                                                                                                                                                                           | Read `sessionID` field; emit one event with `sessionId`, `cwd` (from runtime context), `ts`. Subsequent `step_start` events are dropped (slice C₂ pattern). |
| `text` with `metadata.openai.phase === 'final_answer'`           | `assistant_message`                                                                                                                                                                      | `text` field carries content. Multiple `text` parts in one turn concatenate (newline-joined).                                                               |
| `text` (other phases, e.g. intermediate analysis)                | `thinking`                                                                                                                                                                               | Opaque text; renders as muted block in the UI.                                                                                                              |
| `tool_use` (terminal `state.status === 'completed' \| 'failed'`) | **synthesised pair**: `tool_call` (with `tool`, `callId=part.callID`, `input=state.input`) + `tool_result` (with `callId`, `output=state.output`, `isError = state.metadata.exit !== 0`) | opencode emits one event for the entire tool lifecycle; normalize splits it into the canonical request/response pair.                                       |
| `reasoning`                                                      | `thinking`                                                                                                                                                                               | Opaque (encrypted blob preserved as metadata).                                                                                                              |
| `step_finish` with `reason === 'stop'`                           | `turn_complete`                                                                                                                                                                          | `tokens` and `cost` fields preserved as metadata.                                                                                                           |
| `step_finish` with `reason === 'tool-calls'`                     | (none — intermediate)                                                                                                                                                                    | Tool-call rounds within a turn don't emit `turn_complete`; only the terminal `stop` does.                                                                   |

### Bridge wiring

`packages/coding-agents/src/bridge/stdio-bridge.ts` already switches on kind to call `normalize(lines, args.kind)` from asp. Extend:

```ts
const events =
  args.kind === `opencode`
    ? normalizeOpencode(rawLines)
    : normalize(rawLines, args.kind)
```

The handler doesn't care — events are canonical regardless of source kind.

### Future asp migration

A future upstream PR moves `normalizeOpencode` (and the matching `denormalizeOpencode` for cross-kind work) into asp itself, widening `AgentType`. The local function survives the migration unchanged: when `AgentType` accepts `'opencode'`, the bridge can drop the kind-switch and call asp's `normalize(lines, 'opencode')`. The local file becomes a deprecation shim, then deletable.

---

## §4. Image, auth, env policy

### Dockerfile

`packages/coding-agents/docker/Dockerfile`:

```dockerfile
RUN npm install -g \
      @anthropic-ai/claude-code@latest \
      @openai/codex@latest \
      opencode-ai@latest \
    && claude --version && codex --version && opencode --version
```

Pin `opencode-ai` to a known-good version once the build is stable (mirrors the codex pin in slice C₂). Image size delta is roughly +130 MB (acceptable on a ~1 GB base).

### Auth

`OpencodeAdapter.defaultEnvVars = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY']`. The handler's existing `options.env(meta.kind)` callback pipes those into the sandbox per-turn via the slice C₁ env-file mechanism. opencode falls over to env vars when `auth.json` is missing — confirmed via the recon's local probe.

**No `auth.json` provisioning.** A follow-up slice can add OAuth-bearing flows when there's user demand.

### Default provider/model

No hardcoded default in the adapter. The spawn dialog gates on the user choosing a model from a curated list when `kind === 'opencode'`:

```
anthropic/claude-haiku-4-5      (default if ANTHROPIC_API_KEY set)
anthropic/claude-sonnet-4-6
openai/gpt-5.5                  (default if only OPENAI_API_KEY set)
openai/gpt-5.5-fast
```

Stored in `meta.model`. Passed through to `OpencodeAdapter.buildCliInvocation` on every turn.

---

## §5. UI

### `packages/agents-server-ui/src/components/CodingAgentSpawnDialog.tsx`

Add `'opencode'` to the kind radio. When selected:

- Reveal a `<select>` for model from the curated list (§4).
- Default selection based on which API key env var is present (caller-side detection via `entitiesCollection`'s server-side env probe — TBD; v1 fallback is `anthropic/claude-haiku-4-5`).
- Validation: spawn submit disabled when `kind === 'opencode' && !model`.

### `packages/agents-server-ui/src/components/EntityHeader.tsx`

**Convert kind dropdown.** When current kind is `opencode`, list `claude` and `codex` as targets but **disabled** with tooltip: `"Cross-kind support for opencode is deferred — see follow-up slice."`. When current kind is `claude` or `codex`, list opencode as a target also **disabled** with the same tooltip. Existing claude↔codex Convert kind continues to work unchanged.

**Fork dropdown.** Same gate: `Fork to opencode` is disabled with the same tooltip when the source isn't opencode. `Fork to claude` / `Fork to codex` from an opencode source: also disabled with the tooltip.

In v1, opencode is a first-class spawn target only. Cross-kind ops involving opencode are visibly present (so users discover the capability is coming) but disabled.

### `packages/agents-server-ui/src/components/CodingAgentTimeline.tsx`

No changes required for v1 — opencode produces the same canonical event types as claude/codex, so existing renderers handle them.

---

## §6. Testing strategy

### Layer 1 (unit, no Docker, no API keys)

`packages/coding-agents/test/unit/`:

- `opencode-adapter.test.ts` — argv shape (`run --format json --dangerously-skip-permissions` baseline; `-m model` when set; `-s sessionId` when resuming; `--` separator; prompt at end), env vars, probe/capture/materialise/postMaterialise commands.
- `opencode-normalize.test.ts` — feed recorded JSONL fixtures through `normalizeOpencode`, assert canonical event output. Covers each of §3's table rows + ordering invariants (one `session_init` first, `turn_complete` last, etc.).

### Layer 2 (integration, real Docker, fake CLI)

Conformance suites L1.x and L2.x are _parametrised by adapter_. Adding opencode to the registry runs them automatically. Adding opencode to the conformance config:

```ts
probeForKind: (kind) => {
  if (kind === `opencode`) {
    return {
      prompt: `Reply with just: ok`,
      expectsResponseMatching: /ok/i,
      model: `anthropic/claude-haiku-4-5`,
    }
  }
  // ...existing claude / codex probes
}
```

Recorded fixtures: `test/fixtures/opencode/{first-turn,resume-turn,error}.jsonl`. Captured manually from a real opencode run (instructions in `test/fixtures/README.md`).

### Layer 4 (e2e, real CLIs, real keys)

`packages/coding-agents/test/integration/`:

- `spawn-opencode.e2e.test.ts` — gated `SLOW=1 + ANTHROPIC_API_KEY`. Spawn opencode with `model=anthropic/claude-haiku-4-5`, send `"reply with the single word: ok"`, await runFinished, assert response matches `/ok/i`.
- `resume-opencode.e2e.test.ts` — gated similarly. Send a secret in turn 1, restart container, second turn recalls. Mirrors existing claude/codex resume e2e.

### Playwright UI

`packages/agents-server-ui/test/e2e/`:

- `spawn-opencode.spec.ts` — open spawn dialog, select opencode kind, pick model from list, submit, assert new entity in sidebar with `data-kind="opencode"`. Send a prompt via the message input; await timeline update with assistant text.

---

## §7. Build sequence

1. **OpencodeAdapter skeleton** (`opencode.ts` with cliBinary + argv only; no normalize yet). Layer 1 adapter test green. Verify `opencode --help` matches the assumed argv before going further.
2. **`normalizeOpencode`** from recorded fixtures. Layer 1 normalizer test green (against captured JSONL fixtures from a one-off real opencode run).
3. **Bridge wiring** — `stdio-bridge.ts` switches kind to route to `normalizeOpencode`. Existing claude/codex tests stay green.
4. **Adapter contract extension** — optional `postMaterialiseCommand` in `registry.ts`; handler runs it after `copyTo`. Layer 1 handler test green; existing claude/codex paths untouched.
5. **Image bump** — install `opencode-ai` in `docker/Dockerfile`. `pnpm -C packages/coding-agents test:integration:rebuild` to refresh the test image. Verify `opencode --version` runs in-sandbox.
6. **Schema widening** — `kind: z.enum(['claude', 'codex', 'opencode'])` in `collections.ts` and `register.ts`. asp's `AgentType` is unchanged; we cast at the bridge boundary in step 3.
7. **UI** — spawn dialog adds opencode + model selector; Convert/Fork dropdowns list opencode disabled with tooltip.
8. **Conformance** — record fixtures, add probe-for-kind opencode case. L1 + L2 scenarios run for opencode (claude / codex / opencode all green or skipped per available API keys).
9. **Layer 4 e2e** — `spawn-opencode.e2e` and `resume-opencode.e2e`.
10. **Playwright UI** — `spawn-opencode.spec.ts`.
11. **Docs** — `packages/coding-agents/README.md` cross-kind section gains a paragraph noting opencode is spawn-only in v1; platform-primitive design footnote pointing at this design doc.

---

## §8. Risks

- **opencode export/import schema instability.** opencode is actively released (1.14.x at recon time, weekly snapshot tags). Export/import JSON shape isn't formally documented as stable across versions. **Mitigation:** pin `opencode-ai` to a known-good version in the Dockerfile; regression-test export/import compatibility on each opencode bump (re-record `test/fixtures/opencode/`).
- **Reasoning encryption.** OpenAI-provider reasoning parts contain `reasoningEncryptedContent` (opaque blob). `normalizeOpencode` treats these as opaque thinking events; UI renders as collapsed thinking blocks. Lossy by design — accepted.
- **Tool-event granularity.** opencode emits one `tool_use` per call (terminal state only). `normalizeOpencode` synthesises both `tool_call` and `tool_result` from one input event. Tool-call latency timing in the UI is approximate (no separate request/response timestamps).
- ~~**No stdin prompt delivery / ARG_MAX-bounded prompt size.** Argv-only, like codex.~~ Resolved 2026-05-02: both codex and opencode support stdin; adapters now use it. See **§10 TL-1** for the full story and the 900 KB bridge guard.
- **Convert/Fork-to-opencode disabled in UI** but the user's expectation may not match. **Mitigation:** clear tooltip text + spec section in README explaining v1 spawn-only semantics.
- **opencode binary size.** ~129 MB statically-linked. Acceptable for a sandbox image but bumps the cold-start docker pull cost on first use.

---

## §9. Migration

- **Schema widening** is additive (`kind` enum gets a third value). Existing `kind: 'claude'` / `'codex'` rows remain valid. Net-new spawns can use `'opencode'`.
- **Adapter contract extension** is additive (`postMaterialiseCommand` is optional). Existing in-tree adapters compile unchanged.
- **`AgentType` in asp is unchanged.** We cast at the bridge boundary where opencode is encountered. A future asp upstream PR widens it; this slice's local code survives that migration.
- **Image rebuild required** on next pull (operator-side; one-time).
- **Dependency add:** `opencode-ai` global install adds ~130 MB to the sandbox image.
- **No breaking changes** to existing CLIs, runtime APIs, or operator workflows.

---

## §10. Tracked limitations

These are known constraints we ship with — not blockers for v1, but documented so they're visible to operators and to whoever extends the system later.

### TL-1: ~~argv-only prompt delivery (ARG_MAX-bounded)~~ — **resolved 2026-05-02 via stdin delivery**

**Affected kinds:** `codex`, `opencode`. `claude` was already on stdin.

**Status:** Resolved. The original framing of this limitation was based on a wrong premise: a closer reading of each CLI's headless interface showed both codex and opencode support stdin prompt delivery.

- **codex 0.128.0:** `codex exec ... -- -` reads the prompt from stdin. Documented in `--help`: _"If not provided as an argument (or if `-` is used), instructions are read from stdin."_
- **opencode 1.14.31:** silently consumes stdin when invoked without a positional message argument. `opencode run --format json --dangerously-skip-permissions [-m model] [-s sessionId]` (no trailing prompt) plus a piped stdin works.

The adapters were switched to stdin delivery in the same change as this update; the bridge's existing `promptDelivery: 'stdin'` lane (already used for `claude`) writes `args.prompt` into the child stdin and closes it. ARG_MAX is no longer a practical limit for normal prompts on either kind.

**What we kept as a defensive guard.** The bridge has a `PROMPT_LIMIT_BYTES = 900_000` pre-flight check in `runTurn` that throws a clear error before exec when the prompt exceeds the threshold. Conservative on both Linux (~2 MB) and macOS (~1 MB) and below the secondary cliff documented next.

**Codex npm-shim secondary cliff (~969 KB on macOS).** The codex distributed via the `@openai/codex` npm package uses a Node shim launcher that crashes with `RangeError: Maximum call stack size exceeded` somewhere around 969 KB of argv on macOS — well below the kernel's E2BIG. Stdin delivery sidesteps this entirely (no large argv), but the cliff still exists for any future code path that goes back through argv. Documented here for future maintainers; the 900 KB bridge guard sits comfortably under it as belt-and-braces.

**Original framing (kept for archaeology):** Earlier drafts of this spec asserted both CLIs were "argv-only" without verifying against `--help` output. The recon pass that triggered this resolution found stdin support in both, and the empirical 200 KB round-trip (claude / codex / opencode) confirmed it on the live `localhost:4437` stack.

### TL-2: opencode-only — `export`/`import` JSON schema instability

**Affected kinds:** `opencode`.

**Constraint.** opencode is on a weekly snapshot tag cadence. The `opencode export <id>` JSON output (used by our `captureCommand`) and the `opencode import <file>` reader (used by our `postMaterialiseCommand`) are not documented as stable across versions. A `opencode-ai` minor bump that changes the schema breaks our resume mechanism silently — captures succeed but materialise + import fails inside the new container.

**Mitigation paths:**

1. **Pin to a known-good version in the Dockerfile** (`opencode-ai@1.14.31` or whatever's verified). Re-test on bumps.
2. **Schema check at adapter init.** Run `opencode --version` + `opencode export --help` at sandbox start; reject if output shape differs from the captured baseline.
3. **Compat shim layer.** Maintain a translator from older opencode export shapes to the latest. High-maintenance; only worth it if multiple versions are in flight.

**Severity.** Medium. Low likelihood pre-1.0 release of opencode (cadence is volatile), but the failure surface (silent broken resume) is bad. Mitigation 1 is in scope for this slice; 2 + 3 are follow-ups.

### TL-3: opencode-only — convert/fork in/out gated in UI

**Affected kinds:** `opencode` (incoming from claude/codex; outgoing to claude/codex).

**Constraint.** Cross-kind support requires `denormalizeOpencode` + a widened `AgentType` in `agent-session-protocol`. Both are out of scope for this slice. UI exposes the menu items but disables them with a tooltip.

**Mitigation:** Documented as a deferred follow-up slice. Tooltip text + README section in v1.

**Severity.** Low — it's a discoverable absence, not a silent failure.

---

## §11. Acceptance criteria

- `pnpm -C packages/coding-agents test` (unit) green: opencode adapter test, opencode normalizer test, existing claude/codex tests still green.
- `DOCKER=1 pnpm -C packages/coding-agents test:integration` green: L1 + L2 conformance scenarios run for opencode (gated on `ANTHROPIC_API_KEY` for the kind block). 25 + 23 + 2 skipped for the existing suites still pass.
- `HOST_PROVIDER=1 pnpm -C packages/coding-agents test:integration:host` green: opencode also runs on host target (it's just a binary on $PATH).
- `SLOW=1 ANTHROPIC_API_KEY=... pnpm -C packages/coding-agents test test/integration/spawn-opencode.e2e.test.ts test/integration/resume-opencode.e2e.test.ts` green.
- `pnpm -C packages/agents-server-ui test:e2e` green: `spawn-opencode.spec.ts` passes.
- Manual: spawn an opencode agent via the dashboard, pick anthropic/claude-haiku-4-5, send "reply with ok", observe streaming timeline. Restart the server; resume works (turn 2 references turn 1 via `--continue` semantics).
- Convert kind / Fork dropdowns visibly list opencode but disabled with the deferred-cross-kind tooltip.
