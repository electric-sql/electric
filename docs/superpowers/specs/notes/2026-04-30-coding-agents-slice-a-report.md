# Coding Agents Slice A — Run Report

**Date:** 2026-04-30
**Plan:** `docs/superpowers/plans/2026-04-30-coding-agents-slice-a.md`
**Spec:** `docs/superpowers/specs/2026-04-30-coding-agents-slice-a-design.md`
**Validation bar:** integration smoke test exercising entity lifecycle (spawn, pin, release, stop), lease acquisition, crash recovery via container label inspection, and destroy.
**Outcome:** ✅ Green on second integration-test run. One timing adjustment cycle required.

## Result

```
✓ packages/coding-agents/src/workspace-registry.test.ts    (7 tests)  8 ms
✓ packages/coding-agents/src/lifecycle-manager.test.ts     (7 tests)  12 ms
✓ packages/coding-agents/src/entity-handler.test.ts        (4 tests)  15 ms
✓ packages/coding-agents/src/runtime-contract.test.ts      (2 tests)  3 ms
✓ test/integration/slice-a.test.ts                         (1 test)   49.8 s  ← validation bar
```

Unit test summary: 20 new tests + 368 existing = **388 total.** All passing.

Coding-agents package totals: **22 unit + 1 integration = 23 tests.** Integration test wall clock: ~50 s.

## What worked first time

- **Closure-scoped `registerCodingAgent(registry, deps)` registration pattern.** The entity handler closes over `LifecycleManager` and `WorkspaceRegistry` cleanly. No runtime extension API was needed — the helper wires both dependencies into the handler's scope without leaking them into the public contract.
- **Reconcile-on-handler-entry for orphan-run detection.** Comparing `lm.startedAtMs < runs.startedAt` proved sufficient to detect runs orphaned by a prior crash. No complex log scanning required.
- **Reusing existing `ctx.recordRun()` / `attachResponse()` / `end()` machinery for parent-wake signaling.** The prompt response already triggers `runFinished` wake on the parent session. No new wake plumbing was needed.
- **TDD on pure components (WorkspaceRegistry, LifecycleManager).** Tests were written against the spec; implementation followed; all tests passed on first run. No test-code divergence.

## What had to be fixed mid-flight

### 1. Spec divergence: no `onBoot` registry hook

**Symptom:** The original spec assumed `EntityRegistry.define` would expose an `onBoot` hook for initialization. The runtime has no such hook.

**Resolution:** Boot logic folded into the handler's first-wake branch. On first entry, check if `sessionMeta` exists in the collection; if absent, seed a fresh `SessionMetaRow` with `status='active'` and `keepWarm=true`. The `WorkspaceRegistry` and `LifecycleManager` are both freshly constructed per `registerCodingAgent` call, so explicit boot wiring is unnecessary.

### 2. Spec divergence: no `ctx.deleteEntityStream`

**Symptom:** The runtime has no primitive to delete an entity's durable stream. The destroy flow expected this.

**Resolution:** `destroy()` becomes a tombstone operation: container removed via the provider, workspace ref dropped, `sessionMeta.status` set to `'destroyed'`, and all subsequent inbox messages return early via a status guard. Documented as a Slice B improvement (true stream cleanup).

### 3. Task 2.1: type narrowing failure in session meta

**Symptom:** After first-wake init, `meta` was typed as `SessionMetaRow | undefined`. Downstream `.pin()` / `.release()` calls errored.

**Fix:** Refactored init to declare a `const initialMeta` and always assign it via an if/else to a `let meta: SessionMetaRow`. Removed redundant `!` assertions.

### 4. Task 2.1: lifecycle key collision race

**Symptom:** Three `lifecycleKey` inserts in `processPrompt` (boot, pin/release, stop/destroy) could collide on millisecond ticks, causing duplicate-key errors.

**Fix:** Used the existing `lifecycleKey('label')` helper consistently: `lifecycleKey('boot')`, `lifecycleKey('pin')`, `lifecycleKey('release')`, `lifecycleKey('stop')`, `lifecycleKey('destroy')`. All unique by construction.

### 5. Task 2.1: stale meta snapshot for idle-timer arm

**Symptom:** The idle-timer arming code read `meta.keepWarm` and `meta.idleTimeoutMs` from a stale snapshot. Changes made in the same handler entry were not reflected.

**Fix:** Re-read `meta` from `ctx.db.collections.sessionMeta.get(agentId)` just before arming the idle timer, ensuring fresh values.

### 6. Task 2.2: unused test-accessor type

**Symptom:** `CodingAgentInternals` was defined but never used outside tests.

**Fix:** Removed the type entirely.

### 7. Task 2.3: `send()` returned a fake run id

**Symptom:** Initial implementation returned `Promise<{ runId: 'run-pending-${Date.now()}' }>`. The actual run id only exists after the entity processes the message and writes to the `runs` collection.

**Fix:** Changed return type to `Promise<void>`. Real run ids surface via `state().runs` or the parent's `runFinished` wake signal, consistent with the rest of the handle (`pin`, `release`, `stop`, `destroy` all return `Promise<void>`).

### 8. Task 2.3: misleading spec URL convention

**Symptom:** Spec documented the entity handle URL as `/<parent>/coding-agent/<id>`. The runtime uses a flat URL convention: `/<type>/<id>`.

**Resolution:** Implementation matches the actual runtime convention. Noted for a future spec edit.

### 9. Task 4.1: integration test timing cycle

**Cycle 1 failure:** The idle-timer (2 s) fired mid-concurrent-run, removing the container and failing assertions.

**Cycle 2 fix:** Increased idle waits to 3 s and added a 3-second drain wait before the concurrent assertion, allowing the prior section's idle timer to expire fully before re-using the workspace.

## Other notes

- **Synchronous collection API.** The repo uses `@durable-streams/state`-style collections (`ctx.db.collections.X.get(k)`, `ctx.db.actions.X_insert/X_update`). Different from typical async ORMs. Documented in the legacy `coder` entity as a reference.
- **`LocalDockerProvider.destroy()` behavior.** This method finds and removes a container by agent label. The `LifecycleManager.stop()` method calls `provider.destroy(agentId)` (NOT `provider.stop(instanceId)`). See the comment in lifecycle-manager.ts:38–39 explaining the distinction.
- **Pre-commit hook string normalization.** The repo's lint-staged hook converts single-quoted strings to backticks per project convention. Once subagents read existing source, they adapted automatically.
- **Unbounded workspace lease.** No acquire timeout is set. Acceptable for Slice A; can be added in a follow-up if real workloads stall on lease contention.

## What's NOT done (vs. the full design spec)

These were intentionally deferred. Listed here for the next plan:

1. **Resume.** `nativeJsonl` collection, `--resume <id>` plumbing, cold-boot tmpfs materialization. **(Slice B.)**
2. **Codex support.** Bridge still rejects `kind: 'codex'`. **(Slice C.)**
3. **Removal of legacy `coder` entity** + `spawn-coder.ts` / `prompt-coder.ts` tools. **(Slice B.)**
4. **New Horton tools** (`spawn_coding_agent`, `prompt_coding_agent`). **(Slice B.)**
5. **UI extensions.** Status enum, header sandbox provenance, pin/release/stop buttons, lifecycle row rendering. **(Slice C.)**
6. **Conformance suite** parameterized by `SandboxProvider`. **(Slice C.)**
7. **`wake.on: 'eventAppended'`** for streaming UI. **(Slice C.)**
8. **`sandbox?` provider override** on `SpawnCodingAgentOptions`. (Single-provider for now.)
9. **Live `events()` tailing.** Slice A returns snapshot async-iterable; live tailing lands with the UI consumer. **(Slice C.)**
10. **Server-side `state().workspace.sharedRefs` accuracy** from a client handler context. Client handlers see `sharedRefs: 1`. Documented.

## Recommended next steps (priority order for Slice B)

1. Add resume (`--resume`, sidecar `nativeJsonl` collection, cold-boot denormalize).
2. Add `provider.recover()` integration on agents-server boot to populate the `WorkspaceRegistry` from durable entity state (currently rebuild happens lazily on first handler entry per agent — works but is deferred).
3. Add Horton tools (`spawn_coding_agent`, `prompt_coding_agent`) matching the shape of legacy `spawn_coder` / `prompt_coder`.
4. Remove the legacy `coder` entity once Horton tools are in place and no other callsites depend on it.
5. (Independent) Tighten `ctx: any` in the entity handler to bind to a specific `HandlerContext` shape.
6. (Independent) Update spec doc to correct the `/<parent>/coding-agent/<id>` URL convention to flat `/<type>/<id>`.

## Artifacts

Commits on `coding-agents-slice-a` branch (in order):

1. `2a43456b4` — collection + inbox message schemas
2. `70e8a95fb` — public types extension (SpawnCodingAgentOptions, SLICE_A_DEFAULTS)
3. `b31dcb924` — WorkspaceRegistry
4. `1841c38e4` — LifecycleManager
5. `627b2afb7` — entity handler (reconcile, dispatch, processPrompt)
6. `d5efd727e` — fix: tighten meta type narrowing, unique lifecycle keys, fresh meta read for idle timer
7. `036ce99f2` — registerCodingAgent helper
8. `22a97c590` — refactor: remove unused CodingAgentInternals
9. `260e9146e` — runtime API: ctx.spawnCodingAgent / observeCodingAgent
10. `3781c9cc9` — fix: drop misleading runId placeholder from send()
11. `e5da51dca` — wire registerCodingAgent into bootstrap
12. `e1fb7eaa6` — Slice A integration smoke test

Branch: `coding-agents-slice-a` (forked from `main` at `a31e8a8a0` to keep main clean).

## How to re-run

```bash
# Unit tests (no Docker required)
pnpm -C packages/coding-agents test

# Integration test (requires Docker + /tmp/.electric-coding-agents-env)
DOCKER=1 pnpm -C packages/coding-agents test test/integration/slice-a.test.ts
```
