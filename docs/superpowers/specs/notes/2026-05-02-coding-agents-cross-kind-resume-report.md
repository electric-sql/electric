# Coding Agents Cross-Kind Resume — Run Report

**Date:** 2026-05-02
**Plan:** `docs/superpowers/plans/2026-05-02-coding-agents-cross-kind-resume.md`
**Spec:** `docs/superpowers/specs/2026-05-02-coding-agents-cross-kind-resume-design.md`
**Predecessors:** Slice A, B, C₁, C₂ (codex parity), Conformance suite.
**Validation bar:** Two user-facing capabilities (convert in place, fork into sibling) on one shared mechanism (`events → denormalize → fresh nativeJsonl + sessionId`), with optional provider `cloneWorkspace` capability, header + spawn-dialog UI, built-in tools, conformance scenarios, Layer 4 e2e + Playwright coverage.
**Outcome:** ✅ Mechanically green; one fidelity gap surfaced post-merge and tracked as a follow-up. All shipped surfaces work end-to-end.

## Result

```
✓ packages/coding-agents/test/unit/*           90 passed (incl. fork.test.ts 4/4, convert-kind.test.ts 6/6, conversion.test.ts 3/3)
✓ DOCKER=1 local-docker-conformance            25 passed (L1.1–L1.9, L2.1–L2.8 across both kinds)
✓ HOST_PROVIDER=1 host-provider-conformance    23 passed | 2 skipped (L1.4 + L1.9 correctly skipped)
✓ SLOW=1 fork-kind.e2e.test.ts                 1 passed (real claude → codex fork)
~ SLOW=1 convert-kind.e2e.test.ts              1 failed (lossy denormalize → claude; tracked)
✓ Playwright header-fork-menu.spec.ts           3 passed
✓ Playwright convert-kind.spec.ts               2 passed
✓ Playwright fork-spawn.spec.ts                 3 passed
```

Total package surface: ~25 commits, ~3300 lines of plan/spec/code. Branch: `coding-agents-slice-a` (continued).

## What worked first time

- **Provider capability slot.** Adding optional `cloneWorkspace` to `SandboxProvider` was a clean additive type change. Existing providers (`LocalDocker`, `Host`, fakes) compiled untouched.
- **Conversion handler branch.** `processConvertKind` is a pure data op (no sandbox, no CLI spawn) — read events, denormalize, replace `nativeJsonl`, update `meta`, insert lifecycle row. Closely mirrored the existing `processConvertTarget` pattern. Six unit-test cases covering happy path + same-kind + empty events + unknown kind + queued-after-prompt + failure all passed cleanly with the plan's verbatim code.
- **Fork first-wake flow.** Cross-stream read via `ctx.observe(entity(args.fromAgentId))` returned a handle with the source's `events`/`sessionMeta` collections. Pre-populating the new agent's `nativeJsonl` + `meta.nativeSessionId` before its first turn was straightforward.
- **Default workspace-mode policy.** Branching on source `workspaceSpec.type` for the bind-mount → `share` / volume → `clone` policy worked first try. Provider capability check (error if `clone` requested but provider lacks `cloneWorkspace`) integrated cleanly via a new `LifecycleManager.providerFor(target)` helper.
- **Built-in tools (`convert_coding_agent`, `fork_coding_agent`).** Mirrored the shape of `spawn_coding_agent`/`prompt_coding_agent`. Three unit tests covering arg validation + `ctx.send`/`ctx.spawn` shape passed first try.
- **Conformance L2.7/L2.8/L1.9.** Wired into the existing `for (const adapter of listAdapters())` loop. L1.9 followed the `supportsRecovery` opt-in pattern. All three scenarios passed for both kinds across both providers on first run.

## What had to be fixed mid-flight

### 1. Validator-audit pre-implementation pass caught four issues

Before any code, a secondary `feature-dev:code-architect` agent reviewed the plan against the spec and surfaced:

1. **Task 1 over-scoped** — claimed to "verify cross-stream read pattern" but only smoke-tested an import. Re-scoped to import-shape gate; real verification deferred to Task 13 (L2.8) + Task 18 (Layer 4 e2e).
2. **`meta.model` doesn't exist** — `SessionMetaRow` has no `model` field, but the spec said `processConvertKind` should update it. Reconciled: model is recorded in `lifecycle.detail` only, not on meta. Both spec and plan updated.
3. **Source-missing failure-mode wording** — spec said "spawn fails before any state is written" but the implementation order persists `sessionMeta` first. Reconciled: agent ends in `status: 'error'` with `lastError` set.
4. **`cloneWorkspace` failure-mode wording** — same shape as #3.

Catching these pre-implementation kept the subagent run clean: 7 implementation phases, ~10 implementer subagents, no significant rework.

### 2. The conformance suite caught a real `LocalDockerProvider.cloneWorkspace` bug

Plan-as-written had `cloneWorkspace` operate on raw volume names. But `LocalDockerProvider.start` prefixes volume names with `coding-agent-workspace-` via `mountFlag`. So `provider.start(spec) + provider.cloneWorkspace({ source: spec.workspace })` operated on different names — `cloneWorkspace` would silently miss the volume.

**The L1.9 conformance scenario caught this on first run** (provider-level seed via `provider.start + copyTo` then clone, then verify) — exactly its purpose. Fix folded into the L1.9 commit (`83828fdc4`): `cloneWorkspace` tries the prefixed name first, falls back to raw.

### 3. Three end-to-end-only bugs surfaced after the slice landed

Verified via Playwright over LAN HTTP, not visible to unit tests or conformance:

- **`convertKind` `_insert` race.** The handler used `nativeJsonl_insert` to write the new transcript, but the prior turn's transcript-capture had already inserted a row at `key='current'`. Real runtime threw `"Cannot insert document with ID 'current' because it already exists"`; the conversion silently failed and the agent ended in `status: 'error'`. Manual probe via `curl` reproduced reliably. Fixed by switching to upsert (commit `220ca5b3b`).
- **Fork dropdown self-cloned the source's volume.** The header dropdown was passing the source's `workspaceName` straight through to the new agent's spawn args. So `cloneWorkspace` was asked to copy `coding-agent-fJbboPH7qA → coding-agent-fJbboPH7qA` and Alpine's `cp -a /from/. /to/` errored with `"/from/." and "/to/." are the same file`. Fixed by omitting `workspaceName` for volume sources (commit `b0caf9676`).
- **`crypto.randomUUID` undefined over LAN HTTP.** The browser exposes `crypto.randomUUID` only in secure contexts (HTTPS or localhost). Browsing the UI at `http://192.168.1.80:4437` made `nanoid()` and any other consumer throw `TypeError`, sticking the fork dropdown's `forking` state. Fixed with a `getRandomValues`-based polyfill at the UI entry (same commit).

### 4. The conformance fake-ctx didn't expose `nativeJsonl_update`

When the `convertKind` upsert fix landed, two L2.7 conformance tests broke with `TypeError: ctx.db.actions.nativeJsonl_update is not a function`. The fake-ctx in `packages/coding-agents/src/conformance/fake-ctx.ts` only generated `_insert` actions for that collection. Added `nativeJsonl_update` (commit `bb9bfbf0f`) — quick fix that should have been there from slice B.

### 5. Header Fork same-kind branch surprised users

The dropdown initially routed same-kind picks through the runtime's `POST /fork` (subtree clone) and only used `fromAgentId` for cross-kind. End-to-end: "Fork to claude" on a claude agent produced a fresh CLI session with no conversation context, while "Fork to codex" got full inheritance.

Fixed by unifying both branches through `fromAgentId` (commit `794719fe4`). Same-kind copies the source's raw `nativeJsonl` byte-for-byte and reuses its `sessionId` (lossless when capture is complete); cross-kind still denormalizes. The `(same kind)` annotation was dropped from the menu since the two items now do the same thing under the hood.

### 6. Discovered a deeper capture-path gap

While verifying the unified fork path end-to-end, found that claude's on-disk transcript at `~/.claude/projects/<dir>/<sessionId>.jsonl` in the current CLI version is **not the conversation log** — it's a queue-operation/summary/ai-title bookkeeping file that gets overwritten on each `--resume` invocation. So even with a perfect copy mechanism, same-kind fork (and cold-boot resume, and convert-to-claude) only inherits the most recent turn's metadata.

This is a slice-B-era bug that predates the cross-kind work. Tracked in the plan's `§ Post-merge findings` with severity, root cause, what breaks vs what works despite it, and concrete investigation pointers. Effort estimate 1–3 days, dominated by locating the actual conversation log inside the current claude CLI's filesystem.

## What still doesn't work

- **`SLOW=1 convert-kind.e2e.test.ts` E4** — fails with `expected 'acknowledged.' to contain 'butterfly'`. Same root cause as #6 above. Mechanism is correct (kind flips, lifecycle row, agent runs); fidelity is the gap.

## Architectural notes

### One mechanism, two UX paths

Both convert (in place) and fork (sibling) share `events → denormalize(events, kind, { sessionId, cwd }) → nativeJsonl + meta updates`. The events collection is canonical and never rewritten; only the kind-specific `nativeJsonl` blob is regenerated. This means:

- Convert is a pure data op — no sandbox spawn, no CLI invocation. The next prompt's existing `ensureTranscriptMaterialised` writes the new transcript at the new kind's expected location.
- Fork at first-wake reads the source's events cross-stream via `ctx.observe(entity(sourceId))`. The source agent is untouched.

### Workspace-mode policy

Default per source workspace type:

- `bindMount` → `share` (same hostPath; lease serialises access)
- `volume` → `clone` if provider supports `cloneWorkspace`, else error at spawn

Explicit user override via `from.workspaceMode: 'share' | 'clone' | 'fresh'` in `SpawnCodingAgentOptions`. Bind-mount cloning is intentionally never the default — copying a user's host directory is opt-in only.

### Provider capability matrix

| Provider              | `cloneWorkspace`   | Notes                                                   |
| --------------------- | ------------------ | ------------------------------------------------------- |
| `LocalDockerProvider` | ✅ implemented     | Uses a throwaway `alpine cp -a /from/. /to/` container. |
| `HostProvider`        | ❌ not implemented | Bind-mount only. `clone` errors at spawn time.          |
| Future Modal/Fly/E2B  | depends            | Implement when the provider's primitives allow.         |

### UI surfaces

1. **Header `Convert kind` dropdown** — Pin/Release/Stop neighbour. Dispatches `convert-kind` inbox message.
2. **Header `Fork` dropdown** — replaces the prior single Fork button. Lists "Fork to claude" / "Fork to codex". Both items spawn a new top-level coding-agent with `fromAgentId`.
3. **Spawn dialog `Fork from existing agent` toggle** — reveals source agent picker + workspace mode selector. For power users wanting explicit `share` / `clone` / `fresh` control.
4. **Timeline lifecycle rows** — `kind.converted`, `kind.convert_failed`, `kind.forked` render as muted entries via the existing pattern (`data-event` attribute targeted by Playwright).

## Lessons

- **Validator-audit pre-implementation is high ROI.** Four issues caught before any code was written; would have cost a full implementation cycle each to surface organically.
- **Conformance scenarios catch real bugs.** L1.9 (`cloneWorkspace`) flushed out the volume-name-prefix bug on its first run. The conformance suite did its job.
- **End-to-end via Playwright over LAN catches things unit tests miss.** All three of the post-merge bugs (`_insert` race, self-clone, `crypto.randomUUID`) were invisible to unit + conformance tests because the fake-ctx + jsdom + localhost combo masks the real environment. Worth running Playwright over a non-localhost URL early in the next slice.
- **denormalize round-trips are lossy in the same-kind case.** Same-kind fork copying raw `nativeJsonl` is a strict improvement over `denormalize(claudeEvents, 'claude')` for the case where the source has captured transcript bytes.

## Follow-ups (deferred, in the plan's `§ Post-merge findings`)

- **Non-cumulative claude transcript capture** — the load-bearing issue. Fixing this unlocks Layer 4 E4 and makes same-kind fork actually preserve full conversation context. Medium severity, 1–3 days.
- **Mid-turn-crash sanitisation** — dangling `tool_call` events with no matching `tool_result` are passed through as-is. README documents the limitation; a sanitisation pass is a follow-up if it surfaces in real use.
- **Helpers extraction** — `waitForLastRunCompleted` / `waitForLifecycleEvent` are duplicated across the two new e2e tests. Extract to `test/support/e2e-helpers.ts` next time these patterns get a third caller.
- **Mystery `smoke-XXXX` orchestrator entities** — automated test fixtures or a stale watcher are auto-spawning these into the dev sidebar. Not from this slice. Track down on next clear-state cycle.
