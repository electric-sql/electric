# Coding-agents Slice C₁ — Urgent fixes

**Date:** 2026-05-01
**Status:** Draft (pending implementation)
**Predecessors:** Slice A (`2026-04-30-coding-agents-slice-a-design.md`), Slice B (`2026-04-30-coding-agents-slice-b-design.md`)
**Self-review reference:** `notes/2026-04-30-coding-agents-implementation-review.md`
**Code-review reference:** Slice C kickoff review (in-conversation)

---

## Why

The MVP + Slice A + Slice B work shipped a working coding-agent platform primitive. A code review before starting Slice C surfaced five issues that affect correctness or security of code already in the branch and should land before any further feature work:

- **C1** — `materialiseResume` packs the resume transcript into a base64-encoded `sh -c` argument; multi-turn conversations exceed the host's `ARG_MAX` (~2 MB on Linux), so resume silently fails for any non-trivial session.
- **C2** — A race between idle-timer eviction, reconcile, and `processPrompt`'s `wasCold` gate skips transcript materialisation, surfacing as `"No conversation found with session ID"` and silent loss of conversation continuity.
- **C3** — `ANTHROPIC_API_KEY` is passed via `docker exec -e KEY=VAL`, exposing the secret in `/proc/<pid>/cmdline` (visible to other host users via `ps`).
- **I1** — Idle-timer eviction destroys the container without updating `sessionMeta.status`. The UI sees `idle` indefinitely while the container is gone; reconcile only fires on the next prompt.
- **I2** — `WorkspaceRegistry.chainByIdentity` is an unbounded promise chain. Long-lived shared workspaces accumulate microtask layers proportional to turn count.

This slice ships those fixes plus the test coverage to lock them in.

---

## Non-goals

Carried forward to Slice C₂ / C₃ / later:

- **Codex bridge + cross-kind resume.** Slice C₂.
- **`SandboxProvider` conformance suite.** Slice C₂.
- **Eager `WorkspaceRegistry` rebuild + "shared with N agents" UI indicator.** Slice C₃.
- **Live `events()` tailing on `CodingAgentHandle`.** Slice C₃.
- **`wake.on: 'eventAppended'` runtime hook.** Slice C₃.
- **Per-event approve/deny for `permission_request`.** Slice C₃.
- **`/wire` subpath export of `@electric-ax/coding-agents`.** Slice C₃ (when schemas evolve enough to feel painful).
- **`ctx: any` typing in entity handler.** Cosmetic, large diff, deferred.
- **Pin-count survival across server restart.** Needs schema decision (persist where?), deferred.
- **Canonical tool-call event shape across `agents-runtime` + `coding-agents` + `agents-server-ui`.** Stays as-is; the renderer-layer adapter shipped in Slice B is acceptable for now.
- **Button error toasts in `EntityHeader`.** UX polish, deferred.

---

## Scope summary

Five fixes in three packages:

| Fix                            | Files                                                                                                                   | Risk                                       |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| C1 — pipe transcript via stdin | `coding-agents/src/providers/local-docker.ts`, `coding-agents/src/entity/handler.ts`                                    | Medium (changes a Slice B path)            |
| C2 — probe-and-materialise     | `coding-agents/src/entity/handler.ts`                                                                                   | Medium (subsumes the recent reconcile fix) |
| C3 — env file via `--env-file` | `coding-agents/src/providers/local-docker.ts`                                                                           | Low                                        |
| I1 — idle timer wakes entity   | `coding-agents/src/lifecycle-manager.ts`, `coding-agents/src/entity/handler.ts`, `coding-agents/src/entity/messages.ts` | Low (additive message type)                |
| I2 — trim mutex chain          | `coding-agents/src/workspace-registry.ts`                                                                               | Low                                        |

No runtime API changes. No UI changes. No spec changes for upstream consumers.

---

## Fix 1 (C1) — Pipe transcript via stdin

### Current state

`packages/coding-agents/src/entity/handler.ts:62-67`:

```ts
async function materialiseResume(
  provider: SandboxProvider,
  agentId: string,
  blobB64: string,
  destPath: string
): Promise<void> {
  await provider.exec({
    agentId,
    cmd: [
      `sh`,
      `-c`,
      `printf '%s' '${blobB64}' | base64 -d > ${destPath} && chmod 600 ${destPath}`,
    ],
  })
}
```

The transcript is read from the `nativeJsonl` collection (single row, `content` is the raw transcript) and base64-encoded into the shell command. Linux argv limit is ~2 MB; base64 inflates by ~33%; multi-turn Claude transcripts cross that boundary fast.

### Change

Add a stdin-aware copy primitive on `SandboxProvider`:

```ts
// SandboxProvider contract addition
copyToContainer(args: {
  agentId: string
  destPath: string
  content: string  // utf-8
  mode?: number    // default 0o600
}): Promise<void>
```

`LocalDockerProvider.copyToContainer` implementation:

```ts
async copyToContainer({ agentId, destPath, content, mode = 0o600 }) {
  const handle = await this.exec({
    agentId,
    cmd: [`sh`, `-c`, `umask 077 && cat > ${shellQuote(destPath)} && chmod ${mode.toString(8)} ${shellQuote(destPath)}`],
    stdin: `pipe`,
  })
  if (!handle.writeStdin || !handle.closeStdin) throw new Error(`copyToContainer requires stdin pipe`)
  await handle.writeStdin(content)
  await handle.closeStdin()
  const exit = await handle.wait()
  if (exit.exitCode !== 0) {
    throw new Error(`copyToContainer failed: exit ${exit.exitCode}, stderr=${(await drain(handle.stderr)).slice(0, 400)}`)
  }
}
```

Update `materialiseResume` in the handler to:

```ts
async function materialiseResume(provider, agentId, content, destPath) {
  await provider.copyToContainer({ agentId, destPath, content, mode: 0o600 })
}
```

**No data migration needed.** `nativeJsonl.content` already stores raw UTF-8 transcripts (line 61 of the current `handler.ts` base64-encodes `content` purely to escape it for shell argv); only the in-flight transport changes. After Fix 1, the storage contract is unchanged.

**Adjacent cleanup (low priority):** `captureTranscript` (handler.ts:82-106) reads the file back via `base64 -w 0 | drain stdout` — base64 inflates the wire payload by ~33%. Replacing with a `copyFromContainer` primitive (`docker exec ... cat <path>` and drain stdout as bytes) cuts that. Optional; transcripts on the read direction don't hit `ARG_MAX`. Folded in if trivial during implementation; deferred otherwise.

### Test

Unit test in `test/unit/local-docker.test.ts`: copy a 4 MB UTF-8 string via `copyToContainer`, read it back via `docker exec cat`, assert byte-for-byte equality. Gated on `DOCKER=1`.

---

## Fix 2 (C2) — Probe-and-materialise

### Current state

`processPrompt` in `handler.ts`:

```ts
const wasCold = meta.status === `cold`
await lm.ensureRunning(agentId, options)
// ...
if (wasCold && meta.nativeSessionId) {
  await materialiseResume(provider, agentId, blob, transcriptPath)
}
```

The `wasCold` gate was added in commit `ef8fe64e2` to avoid emitting redundant `sandbox.starting`/`sandbox.started` lifecycle rows on warm prompts. It also gates resume materialisation. Three failure modes:

1. **Idle-timer race** — timer fires between reconcile and `processPrompt`, container is destroyed but `meta.status` is still `'idle'`, `wasCold === false`, materialise skipped, `claude --resume` fails. (Surfaced post-merge of `ef8fe64e2`; partially patched in `7a14b7d7e`.)
2. **External container death** — Docker daemon restart, OOM kill, manual `docker rm`. Reconcile flips status to `'cold'` only on the next handler entry, but only if it sees `providerStatus !== 'running'` AND `meta.status === 'idle'`; if the container died from `'running'` directly, the path is different.
3. **`recover()` post-Slice-C₂** — when adopting an existing container after server restart, the runtime won't know whether the transcript file still exists.

### Change

Decouple resume materialisation from the lifecycle status. The new gate is a **probe of the actual postcondition** — does the transcript file exist in the container?

```ts
async function ensureTranscriptMaterialised(
  provider: SandboxProvider,
  agentId: string,
  meta: SessionMetaRow,
  nativeJsonlCol: Collection<NativeJsonlRow>,
  destPath: string
): Promise<void> {
  if (!meta.nativeSessionId) return // first turn, nothing to resume

  const probe = await provider.exec({
    agentId,
    cmd: [`test`, `-f`, destPath],
  })
  const probeExit = await probe.wait()
  if (probeExit.exitCode === 0) return // already materialised

  const row = nativeJsonlCol.get(`current`)
  if (!row || !row.content) return // nothing to materialise; first turn after a kind switch

  await provider.copyToContainer({ agentId, destPath, content: row.content })
}
```

Call `ensureTranscriptMaterialised` unconditionally before `claude --resume` in `processPrompt`. Remove the `wasCold` gate on resume-materialise specifically. **Lifecycle row insertion (`sandbox.starting` / `sandbox.started`) keeps the `wasCold` gate**, since that's the original purpose of the flag.

### Why probe over status re-check

- Status re-check (`provider.status()` after `ensureRunning`) only catches the timer race; it doesn't catch external container death or `recover()` cases.
- Probe is idempotent — safe to call on every prompt even when the file already exists. The `test -f` cost is negligible (~10 ms per `docker exec`).
- The probe is the literal precondition `claude --resume` requires — bug-for-bug parity.

### Migration interaction

The `wasCold` flag is referenced in two places:

1. Lifecycle row insertion (correct, keep).
2. `materialiseResume` call (incorrect for the reasons above, replace with probe).

The recent reconcile fix (`7a14b7d7e`) covered the case `idle && unknown → cold`. With probe-and-materialise, that fix is no longer load-bearing for resume correctness — but it remains correct for status accuracy and is kept.

### Test

Add to `test/integration/slice-b.test.ts`: forcibly destroy the container between turns 1 and 2 (simulating idle eviction at the worst time), run turn 2, assert resume succeeds. Gated on `DOCKER=1`.

---

## Fix 3 (C3) — Env file via `--env-file`

### Current state

`packages/coding-agents/src/providers/local-docker.ts:195`:

```ts
async exec({ agentId, cmd, env, ... }) {
  // ...
  for (const [k, v] of Object.entries(env || {})) {
    args.push(`-e`, `${k}=${v}`)
  }
  // ...
  const child = spawn(`docker`, args, ...)
}
```

Calls to `provider.exec` from the bridge include `env: { ANTHROPIC_API_KEY: '...', ANTHROPIC_MODEL: '...' }`. Each invocation passes `-e ANTHROPIC_API_KEY=sk-ant-...` in argv, persisted in `/proc/<pid>/cmdline` and visible via `ps` to any host user.

### Change

Persist env in a per-container tmpfs file at `start()` time:

1. **Container start:** `docker run` adds `--tmpfs /run:size=64k,mode=1777` (already inherited from the base image's `/run`). After the container is up, write the merged env to `/run/agent.env` via the same stdin-piped `cat` primitive used by `copyToContainer`. File mode `0600`, owned by `agent` user.

2. **Subsequent `exec` calls:** swap `-e KEY=VAL` for `--env-file /run/agent.env`. Argv carries no secrets.

3. **Env mutation:** if a future call needs to override a single env var, materialise a fresh env file via `copyToContainer`. Bridge currently passes the same env on every turn — single materialise at `start()` is enough.

### Implementation sketch

```ts
// In LocalDockerProvider.start(), after the container is up:
async start(opts: StartOptions): Promise<StartResult> {
  // ... existing docker run with labels, mounts, etc., but NO -e flags

  if (opts.env) {
    const envContent = Object.entries(opts.env)
      .map(([k, v]) => `${k}=${v}`)
      .join(`\n`)
    await this.copyToContainer({
      agentId: opts.agentId,
      destPath: `/run/agent.env`,
      content: envContent,
      mode: 0o600,
    })
  }
  return { instanceId, ... }
}

async exec(args: ExecArgs): Promise<ExecHandle> {
  const dockerArgs = [`exec`]
  // ...
  if (await this.envFileExists(args.agentId)) {
    dockerArgs.push(`--env-file`, `/run/agent.env`)
  }
  // No more -e KEY=VAL injection
}
```

`envFileExists` is a one-time per-container probe cached on the provider's in-memory map. Recovers correctly on `recover()` because the cache is rebuilt by probing `/run/agent.env` for adopted containers.

### Why tmpfs over persistent file

- `/run` is tmpfs by default in Debian-based images — file disappears on container destroy. No on-disk artefact to clean up.
- API keys never written to a layer or volume.
- Survives `docker exec` and bridge invocations within a container's lifetime; that's all we need.

Alternatives considered:

- **`/home/agent/.env`** — persists across `docker restart` (we never use that), and lives in the workspace volume that's shared across agents in the same workspace. Wrong scope: the env is per-container, not per-workspace.
- **`/dev/shm/agent.env`** — also tmpfs, but `/run` is the conventional location for runtime ephemeral files.

### Test

Integration test in `test/integration/local-docker.test.ts`: spawn a container with a sentinel env var, run `ps -ef` on the host, assert the sentinel value never appears. Gated on `DOCKER=1`.

---

## Fix 4 (I1) — Idle timer wakes the entity

### Current state

`LifecycleManager.armIdleTimer` already takes an `onFire` callback (lifecycle-manager.ts:59). The handler supplies it at `handler.ts:581` (after-prompt arming) and `handler.ts:632` (after-release arming):

```ts
// handler.ts:581
lm.armIdleTimer(agentId, finalMeta.idleTimeoutMs, () => {
  void lm.provider.destroy(agentId).catch((err) => {
    log.warn({ err, agentId }, `idle stop failed`)
  })
})
```

The closure destroys the container but does not signal the entity. `sessionMeta.status` stays `'idle'` until something else wakes the entity. A parent observing via `wake: 'runFinished'` is not notified the run was cut short.

### Change

Add an optional `wakeEntity` dep to `registerCodingAgent`:

```ts
// register.ts
export interface RegisterCodingAgentDeps {
  provider: SandboxProvider
  bridge: Bridge
  defaults?: Partial<{ idleTimeoutMs; coldBootBudgetMs; runTimeoutMs }>
  env?: () => Record<string, string>
  /** NEW. Posts a self-message to the entity, used by the idle timer
   *  to trigger reconcile after destroy. Bootstrap supplies this once
   *  the runtime is constructed. */
  wakeEntity?: (agentId: string) => void
}
```

Pass it through to `makeCodingAgentHandler` via `CodingAgentHandlerOptions`. Update both `armIdleTimer` call sites:

```ts
lm.armIdleTimer(agentId, finalMeta.idleTimeoutMs, () => {
  void lm.provider
    .destroy(agentId)
    .catch((err) => log.warn({ err, agentId }, `idle stop failed`))
    .finally(() => options.wakeEntity?.(agentId))
})
```

`LifecycleManager` itself is unchanged.

### Wiring `wakeEntity` in bootstrap

`packages/agents/src/bootstrap.ts` currently creates the registry, registers entities, then creates the runtime. The wake closure needs the runtime, which doesn't exist yet at registration time. Two options:

**Option A — mutable holder.** Declare `let runtime: any = null` before `registerCodingAgent`; supply `wakeEntity: (agentId) => runtime?.executeSend({ targetUrl: agentId, type: 'lifecycle/idle-eviction-fired', payload: {} })`; assign `runtime = createRuntimeHandler(...)` after. The closure resolves at fire time, after the runtime is set.

**Option B — restructure bootstrap.** Create runtime first, then register entities with `wakeEntity` inline. Cleaner but a larger diff into shared boot code.

**Decision:** Option A. Localised to coding-agent registration; doesn't touch worker or horton boot ordering.

### Wake message type

Add a new inbox schema entry `lifecycle/idle-eviction-fired` whose payload is empty. Dispatch in `dispatchInboxMessage` is a no-op — reconcile at the top of the handler already saw `idle && !running` and flipped status to `'cold'`. The message exists only to re-enter the handler.

```ts
// messages.ts
export const idleEvictionFiredMessageSchema = z.object({}).passthrough()

// register.ts inboxSchemas:
inboxSchemas: {
  prompt: promptMessageSchema,
  pin: pinMessageSchema,
  release: releaseMessageSchema,
  stop: stopMessageSchema,
  destroy: destroyMessageSchema,
  'lifecycle/idle-eviction-fired': idleEvictionFiredMessageSchema,  // NEW
},
```

### Why wake-via-send

- `LifecycleManager` stays schema-agnostic (no `db` handle).
- Reuses the reconcile rule shipped in `7a14b7d7e` (`idle && !running → cold`).
- The `executeSend` path is the same one user-initiated Pin/Release/Stop traverse — no new runtime primitive.

Alternative considered: timer holds a `db` handle and updates `sessionMeta` directly. Rejected — couples timer plumbing to entity-specific schema. If reconcile rules change (e.g., adding `'evicted'` status), the timer would silently diverge.

### Test

Unit test in `test/unit/entity-handler.test.ts`: arm a timer with `wakeEntity` mocked, fast-forward fake timers, assert `provider.destroy` was called and then `wakeEntity` was called with the same `agentId`.

Unit test (continued): simulate the entity receiving `lifecycle/idle-eviction-fired` with prior state `meta.status === 'idle'` and `provider.status()` returning `'unknown'`; assert `meta.status` flips to `'cold'` and dispatch is a no-op.

---

## Fix 5 (I2) — Trim mutex chain in `WorkspaceRegistry`

### Current state

`packages/coding-agents/src/workspace-registry.ts:68-79`:

```ts
acquire(identity: string): Promise<() => void> {
  const prior = this.chainByIdentity.get(identity) ?? Promise.resolve()
  let releaseFn: () => void
  const next = new Promise<void>((res) => { releaseFn = res })
  this.chainByIdentity.set(identity, prior.then(() => next))
  return prior.then(() => releaseFn!)
}
```

Every `acquire` extends the chain with `prior.then(() => next)`. The chain entry is **only** cleared by `rebuild()`. Long-lived shared workspaces accumulate one promise layer per turn forever.

The `refsByIdentity: Map<string, Set<string>>` is a separate structure (counts agents sharing the workspace, surfaced as `state().workspace.sharedRefs`); it is not the mutex chain and stays unchanged in this fix.

### Change

Add an in-flight acquirer counter. Increment on `acquire`, decrement on `release`. When the counter reaches zero AND the current chain entry is the one we just resolved, delete the entry:

```ts
private readonly acquirersByIdentity = new Map<string, number>()

acquire(identity: string): Promise<() => void> {
  this.acquirersByIdentity.set(
    identity,
    (this.acquirersByIdentity.get(identity) ?? 0) + 1
  )
  const prior = this.chainByIdentity.get(identity) ?? Promise.resolve()
  let releaseFn!: () => void
  const next = new Promise<void>((res) => { releaseFn = res })
  const link = prior.then(() => next)
  this.chainByIdentity.set(identity, link)
  return prior.then(() => () => {
    const remaining = (this.acquirersByIdentity.get(identity) ?? 1) - 1
    if (remaining === 0) {
      this.acquirersByIdentity.delete(identity)
      // Only delete if no one chained onto us in the meantime.
      if (this.chainByIdentity.get(identity) === link) {
        this.chainByIdentity.delete(identity)
      }
    } else {
      this.acquirersByIdentity.set(identity, remaining)
    }
    releaseFn()
  })
}
```

The `chainByIdentity.get(identity) === link` guard prevents deleting a chain that another concurrent acquirer just extended. Concurrent acquirers walk the chain normally; only the truly last lease prunes the entry. `rebuild()` continues to clear both maps.

### Test

Unit test in `test/unit/workspace-registry.test.ts`: acquire/release N times serially, assert `chainByIdentity.size === 0` after the last release. Existing concurrent-acquire tests remain unchanged.

---

## Cross-cutting test: idle eviction with resume roundtrip

Single integration test that exercises Fix 1, Fix 2, and Fix 4 together:

```ts
test('idle eviction between turns: turn 2 resumes successfully', async () => {
  const agent = await spawnCodingAgent({ ... })
  await agent.send({ type: 'prompt', text: 'remember the word ELEPHANT' })
  await waitForRunFinished(agent)

  // Force idle timer to fire NOW (test-only LifecycleManager.evictNow).
  await lm.evictNow(agent.id)

  // Wait for status to flip to 'cold'.
  await waitFor(() => agent.state().status === 'cold', { timeout: 5000 })

  await agent.send({ type: 'prompt', text: 'what was the word?' })
  await waitForRunFinished(agent)

  const lastEvent = (await agent.events({ since: 'start' })).pop()
  expect(lastEvent).toMatchObject({ type: 'assistant_message' })
  expect(lastEvent.text.toLowerCase()).toContain('elephant')
})
```

Gated on `DOCKER=1`. Goes in `test/integration/slice-c1.test.ts`.

---

## Migration & rollback

- **`nativeJsonl.content` format change** (Fix 1) is the only data-shape change. Read code probes the first byte — `{` means raw JSONL, anything else is treated as base64 (legacy). New writes always store raw. Read shim is dropped after one release cycle.
- **All other fixes are internal.** No public type changes, no protocol changes, no schema changes.
- **Rollback:** revert any single fix independently. Reverting Fix 4 leaves Fix 2 doing the heavy lifting for race correctness.

---

## Build sequence

1. Add `SandboxProvider.copyToContainer` contract + `LocalDockerProvider.copyToContainer` impl + unit test.
2. Refactor `materialiseResume` → `ensureTranscriptMaterialised` (probe-and-materialise) using `copyToContainer`. Remove `wasCold` gate on resume-materialise; keep it for lifecycle rows.
3. Switch `LocalDockerProvider.start` to write `/run/agent.env`; switch `exec` to `--env-file`. Integration test.
4. Add `lifecycle/idle-eviction-fired` message type + dispatch case. Wire `LifecycleManager` `wake` callback in `registerCodingAgent.boot()`. Unit tests.
5. Add `WorkspaceRegistry` acquirer counting + chain trimming. Unit test.
6. Cross-cutting integration test (idle-eviction-with-resume roundtrip).
7. Update existing slice-b integration test if any expectations changed.
8. Run full suite + manual UI smoke (turn 1 → wait for idle → turn 2 → confirm continuity).

---

## Risks

- **Probe latency** (Fix 2). Each `claude --resume` adds one `docker exec test -f` round-trip (~10-30 ms). Acceptable; resume is already a multi-second operation.
- **Env file desync** (Fix 3). If a future code path mutates env between turns, the env file goes stale. Mitigation: today the bridge passes the same env on every turn; if that changes, re-materialise the env file at the call site.
- **Wake-via-send latency** (Fix 4). The status flip happens on the next handler entry, not synchronously with the timer. UI may briefly show `idle` after the container is gone before flipping to `cold`. Acceptable for Slice C₁; tighten in Slice C₃ if user-visible.
- **`copyToContainer` adds a new contract** to `SandboxProvider`. Future providers (Modal, Fly, E2B in Slice C₂) must implement it. Folded into the conformance suite (Slice C₂).

---

## Open questions

None. Two were addressed in scoping:

- _Fix 4 — wake-via-send vs direct meta update?_ — Wake-via-send chosen.
- _Fix 3 — env file location?_ — `/run/agent.env` (tmpfs).

---

## Acceptance criteria

- All five fixes land in a single PR (or fast follow-ups on the same branch).
- New unit tests pass without `DOCKER=1`.
- `DOCKER=1 pnpm -C packages/coding-agents test` green, including the new `slice-c1.test.ts` cross-cutting test.
- Manual: spawn an agent, send a prompt, wait `idleMs + 5s`, send another prompt — agent remembers the first prompt's content; UI status indicator transitions `idle → cold → starting → running` correctly.
- `ps -ef` on the host during a run shows no `ANTHROPIC_*` env values.
- `materialiseResume` succeeds with a synthetic 4 MB transcript.
