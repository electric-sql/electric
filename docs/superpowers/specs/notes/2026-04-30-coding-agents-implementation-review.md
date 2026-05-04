# Coding Agents — Implementation Review

**Date:** 2026-05-01
**Author:** Valter Balegas
**Covers:** MVP + Slice A + Slice B (all landed on `coding-agents-slice-a` branch)
**Run reports:**

- `docs/superpowers/specs/notes/2026-04-30-coding-agents-mvp-report.md`
- `docs/superpowers/specs/notes/2026-04-30-coding-agents-slice-a-report.md`
- `docs/superpowers/specs/notes/2026-04-30-coding-agents-slice-b-report.md`

---

## 1. Where the plans diverged from what shipped

### MVP

No significant plan-vs-ship divergences; the MVP landed cleanly on first run. Three mid-flight bugs were encountered:

- `tsconfig.json` `rootDir` conflicted with `include: ["test/**/*"]` — removed `rootDir` in consolidation commit `27ee432a2`.
- `useradd -u 1000` collided with the base image's built-in `node` user — added `userdel -r node` before the `useradd`.
- `entrypoint.sh` did not forward positional args (`$@`), causing `docker run image cmd` to hang on `tail` — added arg-aware dispatch.

All three were infrastructure/tooling issues, not spec deviations.

### Slice A

**Divergence 1: No `onBoot` registry hook.**
The spec (`2026-04-30-coding-agents-slice-a-design.md §Registration helper`) defined an `onBoot` callback on `registry.define(...)` for rebuilding the `WorkspaceRegistry` and adopting containers at server boot. The runtime's `EntityRegistry.define()` has no such hook and adding one was out of scope. **Resolution:** first-wake init in the handler seeds `sessionMeta` if absent; the LM and WR are freshly constructed per `registerCodingAgent` call (no explicit boot wiring needed for Slice A semantics). The `WorkspaceRegistry.rebuild()` method exists but is only called on first handler entry per agent rather than eagerly at boot.

**Divergence 2: No `ctx.deleteEntityStream`.**
The spec's `destroy()` flow expected a runtime primitive to tombstone the entity's durable stream. It does not exist. **Resolution:** `processDestroy` sets `sessionMeta.status = 'destroyed'` and returns early on all subsequent handler entries. The entity stream persists as a tombstone. Noted for future runtime work.

**Divergence 3: `CodingAgentHandle.send()` return type.**
The spec and Slice A design both typed `send()` as `Promise<{ runId: string }>`, where the `runId` would be the durable run id. The actual run id only exists after the entity processes the message and writes to the `runs` collection — not when the message is enqueued. **Resolution:** return type changed to `Promise<void>`. Run ids are visible via `state().runs` or the parent's `runFinished` wake payload. This also affected the `spawn_coding_agent` tool, which had initially returned a `runId` placeholder (fixed in commit `3781c9cc9`, then the tools themselves in Slice B).

**Divergence 4: Entity URL convention.**
The spec documented `/<parent-entity>/coding-agent/<id>` as the entity URL shape. The runtime uses a flat convention: `/<type>/<id>`. Spec was not amended.

**Divergence 5: `initialPrompt` message shape.**
A post-Slice-A review caught that `spawnCodingAgent({ initialPrompt })` wrapped the initial message as `{ type: 'prompt', payload: { text } }`. The runtime stores `initialMessage` verbatim as the inbox row payload, so `promptMessageSchema.safeParse` received `{ type: 'prompt', payload: { text } }` instead of `{ text }` and silently dropped it. Fixed in commit `c65276ea0` by flattening to `{ text }` — matching the legacy `spawn_coder` pattern.

**Mid-flight fixes (Slice A):**

- Type narrowing failure for `meta` after first-wake init (commit `d5efd727e`).
- Lifecycle key collision on millisecond ticks — used `lifecycleKey('label')` helper consistently.
- Stale meta snapshot for idle-timer arm — re-read `meta` from the collection before arming.
- Integration test timing: idle timer (2s) fired mid-concurrent-run; increased waits to 3s.

### Slice B

**Divergence 1 (Critical): Resume mechanism pivoted mid-implementation.**
The Slice B spec and plan describe a **per-line tee** approach: `StdioBridge` invokes `onNativeLine` for each stdout line; the handler appends each line to the `nativeJsonl` collection (schema: `{key: '<runId>:<seq>', runId, seq, line, nativeSessionId, kind}`); on cold-boot, the handler reads these rows, joins them, and writes the resulting string to the tmpfs path. **This does not work.** `claude --resume` reads the on-disk transcript at `~/.claude/projects/<sanitized-cwd>/<sessionId>.jsonl`, which is claude's _internal bookkeeping format_ — not the `--output-format=stream-json` wire format emitted on stdout. The two formats are completely different (internal format includes `parentUuid`, `attachment`, `ai-title`, multi-variant assistant entries, etc.).

**What shipped instead:** After each successful turn, the handler reads claude's actual on-disk transcript via `docker exec sh -c 'base64 -w 0 <path>'`, decodes the base64, and stores the full content as a single-row blob `{key: 'current', nativeSessionId, content}`. On cold-boot, `materialiseResume` writes the blob back via the same base64 round-trip. The `nativeJsonlRowSchema` in `collections.ts` reflects this (single-row blob shape, not per-line rows). The `onNativeLine` callback in `RunTurnArgs` still exists and is still invoked by the bridge, but the handler no longer uses it.

**Divergence 2: `agent-session-protocol@0.0.2` bug — `session_id` not extracted.**
`normalizeClaude()` reads `entry.sessionId` (camelCase) but claude emits `session_id` (snake_case). The bridge now scans the raw stdout JSONL for the `system/init` line and reads `session_id` directly, bypassing the library for this field. The upstream library still has the bug.

**Divergence 3: `spawn_coding_agent` tool implementation.**
The Slice B spec shows a tool that calls `ctx.spawnCodingAgent(...)` and returns a `CodingAgentHandle`. The actual implementation calls `ctx.spawn('coding-agent', id, spawnArgs, { initialMessage, wake })` directly (the lower-level primitive), not `ctx.spawnCodingAgent`. This is equivalent but bypasses the typed helper. Source: `packages/agents/src/tools/spawn-coding-agent.ts`.

**Divergence 4: Pin/Release/Stop button dispatch.**
The spec and initial plan wired EntityHeader buttons to `db.actions.inbox_insert?(...)`. The `inbox_insert` action is not generated by `createEntityStreamDB` — `inbox` is a built-in collection, not a custom state collection. The optional chain swallowed the failure; buttons were silent no-ops. **Resolution:** buttons POST to `${baseUrl}${entity.url}/send` via REST (same pattern as `MessageInput.tsx`). Commit `14062bc01`.

**Divergence 5: `CodingAgentSpawnDialog` initial prompt.**
The spec specified `initialPrompt` in the spawn dialog would be forwarded to the entity as a creation arg. Initial implementation set `args._initialPrompt`, which the handler ignores (prompts flow through `SpawnInput.initialMessage`, not creation args). **Resolution:** dialog's `onSpawn` callback takes an optional `initialMessage: { text }` second argument; `Sidebar.doSpawn` forwards it to `spawnEntity({ type, name, args, initialMessage })`. Commit `14062bc01`.

**Divergence 6: UI SSE double-connect.**
If both `EntityHeader` and `CodingAgentView` called `useCodingAgent`, two SSE streams would open for the same entity. **Resolution:** `CodingAgentView` accepts `agent: UseCodingAgentResult` as a prop; the router calls `useCodingAgent` once and passes the result to both children. Single connection.

---

## 2. Spec amendments needed

The following spec documents describe designs that were superseded during implementation. Items 1 and 2 were corrected in the follow-up commit on `coding-agents-slice-a`; items 3–5 remain open.

1. **`2026-04-30-coding-agents-slice-b-design.md` §Resume data flow / §Why per-line tee.** ✅ RESOLVED
   Rewritten to describe the shipped blob-after-turn capture mechanism (`captureTranscript` / `materialiseResume`). `nativeJsonlRowSchema` in the spec now matches the codebase (single-row blob with `{key: 'current', nativeSessionId, content}`). "Why per-line tee" section replaced with "Why blob-after-turn". Architecture note and component table updated.

2. **`2026-04-30-coding-agents-platform-primitive-design.md` and `2026-04-30-coding-agents-slice-a-design.md` §Entity URL convention.** ✅ RESOLVED
   Both specs corrected from `/<parent-entity>/coding-agent/<id>` to `/coding-agent/<id>` (the actual flat convention used by the runtime).

3. **`2026-04-30-coding-agents-slice-a-design.md` §Runtime helper.**
   States `send()` returns `Promise<{ runId: string }>`. Shipped as `Promise<void>`.

4. **`2026-04-30-coding-agents-platform-primitive-design.md` §Platform primitive API `CodingAgentHandle.send`.**
   Same as above.

5. **`2026-04-30-coding-agents-slice-b-design.md` §New tools.**
   Tool `execute` shows `ctx.spawnCodingAgent(...)`. Actual code calls `ctx.spawn('coding-agent', ...)` directly.

---

## 3. Hot spots / known landmines for future contributors

### `ctx: any` in the entity handler

`packages/coding-agents/src/entity/handler.ts:134` — the handler is typed as `(ctx: any, _wake: any)`. All collection access (`ctx.db.collections.X`, `ctx.db.actions.X_insert`) is untyped. A typo in a collection name fails silently at runtime. Slice A report noted this under "Recommended next steps / Tighten `ctx: any`". Slice B did not address it.

### ~~`agent-session-protocol@0.0.2` `sessionId` bug~~ ✅ RESOLVED

`normalizeClaude()` now reads `entry.session_id ?? entry.sessionId` in both the ESM
(`dist/src-8t6qdcZ0.js`) and CJS (`dist/src-Det_CZei.cjs`) bundles — patched via
`patches/agent-session-protocol@0.0.2.patch` using `pnpm patch`. The raw-JSONL workaround
in `packages/coding-agents/src/bridge/stdio-bridge.ts` has been removed; `nativeSessionId`
is now read from the `session_init` event produced by `normalize()` directly.

### Transcript path sanitization

`handler.ts:47` — `sanitiseCwd(cwd: string)` replaces `/` with `-` to produce the claude project directory name. This is reverse-engineered from observed claude behaviour and not guaranteed to be stable across claude versions. If claude changes the path-sanitization algorithm, resume will silently write to the wrong path, and `claude --resume` will exit with "No conversation found". Test coverage: only the integration test (`slice-b.test.ts`) exercises the full round-trip; there is no unit test for `sanitiseCwd`.

### Workspace volume naming / slugification

`workspace-registry.ts:12` — `slugifyForVolumeName` replaces characters not in `[a-zA-Z0-9_.-]` with `-`. Entity IDs containing sequences of invalid characters produce long hyphen runs that are normalized away. Two different entity IDs can produce the same slug (e.g., `/coding-agent/a/b` and `/coding-agent/a-b`). In practice this is unlikely for the default nanoid-based IDs, but workspace sharing could be incorrectly triggered if it happened.

### `nativeJsonl_insert` vs. upsert

`handler.ts:503` — transcript capture calls `nativeJsonl_insert`. If the row with `key='current'` already exists (from a prior turn), this is an upsert by primary key in the StreamDB model. Confirmed by existing tests. However, the semantics depend on how `_insert` handles duplicate primary keys in the underlying `@durable-streams/state` implementation — if the store ever switches to "reject duplicate" semantics, transcript capture will fail silently (the `catch` at line 511 logs a warning but does not fail the run).

### Pin counts do not survive server restart

`LifecycleManager.pinCounts` is a `Map<string, number>` in memory. After a server restart all pin counts reset to zero. `sessionMeta.pinned` is read from the durable stream, so the UI shows "pinned", but the idle timer is no longer suppressed. The next prompt's idle-timer arm (`lm.pinCount(agentId) === 0` guard) will schedule a hibernation. Documented in both the Slice A design (§Open questions) and the Slice A report.

---

## 4. Deferred items by slice

### Slice C priority queue

The following items were deferred from Slice A or Slice B and are targeted at Slice C:

1. **Codex support.** Bridge rejects `kind: 'codex'` with an explicit error. Requires bundling the codex CLI in the sandbox image and adding a separate arg-set in `StdioBridge`. Cross-kind resume follows almost for free once both CLIs capture transcripts.

2. **UI status enum extension and header sandbox provenance.** `StatusDot` colors ship for all 7 states. The "shared with N agents" indicator and provider name in the header are deferred. `state().workspace.sharedRefs` returns `1` for all clients because `WorkspaceRegistry` is in-process server state not exposed via a query API.

3. **Eager `WorkspaceRegistry` rebuild at server boot.** Currently the WR is populated lazily on first handler entry per agent. Eager rebuild (scanning all `coding-agent` entities' `sessionMeta` at boot) was scoped for Slice B but deferred because its UI consumer (`sharedRefs` indicator) is also Slice C.

4. **`provider.recover()` orphan-container cleanup.** Containers labeled `electric-ax.agent-id` whose entity was destroyed accumulate. No cleanup at `recover()` time. Manual `docker rm` required.

5. **Conformance suite parameterized by `SandboxProvider`.** The suite outlined in `2026-04-30-coding-agents-platform-primitive-design.md §Testing strategy §Layer 3` was not written. Required for future Modal/Fly/E2B providers.

6. **`wake.on: 'eventAppended'`.** Fine-grained streaming wakes are not implemented. Only `runFinished` is wired.

7. **`sandbox?` provider override on `SpawnCodingAgentOptions`.** Only `local-docker` exists; the override field was not plumbed.

8. **Cross-kind resume.** Architecture supports it (`events` collection is canonical) but no UI affordance and no integration test.

9. **Live `events()` tailing** from a `CodingAgentHandle`. Currently returns a snapshot async-iterable.

10. **Tool-call event-shape divergence (Slice C+ cleanup).** Native tool calls (via outbound-bridge → pi-agent-core) emit `tool_call_start`/`tool_call_end` events with `name`/`args`/`result` fields persisted to the `toolCalls` built-in collection. Coding-agent tool calls (via agent-session-protocol's `normalizeClaude()`) emit `tool_call`/`tool_result` events with `tool`/`input`/`output` fields stored in the coding-agent's custom `events` collection. Slice B Task 1 consolidated rendering at the renderer layer (option 1 from the analysis): `ToolCallView` now exports a `GenericToolCall` interface; `CodingAgentTimeline.ToolCallRow` adapts event-row pairs to that shape and renders via `ToolCallView`, matching the visual style of native agent tool calls in `EntityTimeline`. However, the underlying schema divergence remains — `events.toArray` on a coding-agent entity and a native (Horton/Worker) entity returns rows of fundamentally different shapes. Future cleanup: define a canonical `ToolCallEvent` shape in `agents-runtime`; have both producers (`outbound-bridge` and the coding-agent handler) emit that shape; migrate consumers (UI renderer, `ctx.observe`-based code reading events). This is a multi-package change touching `agents-runtime` + `coding-agents` + `agents-server-ui` and should be coordinated with any work on `ctx.observe` or cross-entity event queries.

### Beyond Slice C (roadmap / out of roadmap)

- `ShimBridge` and remote providers (Modal, Fly, E2B, Cloudflare).
- ACP (Agent Client Protocol) external adapter.
- Per-event approve/deny UI for `permission_request`.
- Replay / time-travel UI scrubber.
- Workspace file browser / "open in editor" link.
- Memory-snapshot lifecycle.
- Pre-warmed sandbox pools.
- Pin survival across server restart (persist refcount to stream or session meta).
- `ctx.deleteEntityStream` runtime primitive (for true `destroy()` tombstone cleanup).
- ~~Patch `agent-session-protocol@0.0.2` upstream to read `session_id` (snake_case).~~ ✅ DONE (local pnpm patch)
