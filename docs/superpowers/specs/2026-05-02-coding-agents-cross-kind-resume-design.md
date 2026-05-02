# Coding-agents — Cross-kind resume + fork

**Date:** 2026-05-02
**Status:** Draft (pending implementation)
**Predecessors:** Slice A, B, C₁, C₂ (codex parity), conformance suite.
**Branch:** new branch off `main` (suggested name: `coding-agents-cross-kind-resume`); the long-running `coding-agents-slice-a` branch is closing out with the conformance PR.

---

## Why

Slice C₂ shipped codex parity but explicitly deferred cross-kind resume:

> "Cross-kind resume (claude → codex on the same agent) is **out of scope** — deferred to a follow-up. The architecture supports it (events collection is canonical) but the test surface and `denormalize` correctness work belong in their own slice." — `2026-05-01-coding-agents-slice-c2-design.md:19`

The conformance suite (slice 2026-05-02) reserved the conformance scenario but skipped wiring it. The platform-primitive design (`2026-04-30-coding-agents-platform-primitive-design.md:602`) listed cross-kind resume as "works programmatically; no UI affordance yet" in the post-MVP backlog.

`agent-session-protocol@0.0.2` already implements `denormalize(events, kind, { sessionId, cwd })` for both kinds, including cross-agent tool-call degradation (`isFromAnotherAgent` branch — see `dist/src-8t6qdcZ0.js:824`). The remaining work is plumbing, UI, tests, and docs.

This slice ships **two user-facing capabilities, one shared mechanism**:

1. **Convert** — flip a live agent's `kind` mid-conversation. Inbox control message; queued after the in-flight turn.
2. **Fork** — spawn a new sibling agent that starts with another agent's denormalized history. Spawn-time option.

## Non-goals

- Per-turn cursor for fork (always forks from "all events at fork time"; no "fork from turn N").
- Replay scrubber / conversation time-travel UI.
- Multi-step conversion chains driven automatically by the runtime.
- Bind-mount cloning by default for `HostProvider` — copying a user's host directory is opt-in only; default is `share`.
- Operator gates (e.g., disable conversion per workspace).
- Sanitisation of dangling `tool_call` events (mid-turn-crash artefacts) before denormalize. Documented edge case; mitigation deferred.

---

## §1. Mechanism

```
Convert (mid-life, queued):
  inbox:{ type:'convertKind', payload:{ kind, model? } }
       │
       │ processed after current turn finishes (existing serial inbox semantics)
       ▼
  events collection ─► denormalize(events, newKind, { sessionId:newId, cwd:workspaceMount })
                                                                      │
                                                                      ▼
  meta.kind        ◄─ update                              nativeJsonl row replaced
  meta.nativeSessionId ◄─ newId                           lifecycle.kind.converted row inserted
  (model passed through to lifecycle.detail; not persisted on meta)
       │
       ▼
  next prompt → handler routes through getAdapter(meta.kind) (already kind-agnostic)


Fork (spawn-time):
  spawnCodingAgent({ from:{ agentId, workspaceMode? }, kind, ... })
       │
       │ during register flow
       ▼
  read source events (cross-stream)
       │
       ├─► denormalize(events, newKind, { sessionId:newId, cwd:workspaceMount })
       │     └─► populate this agent's nativeJsonl
       ├─► resolve workspace per workspaceMode (share / clone / fresh)
       └─► lifecycle.kind.forked row (on the new agent; source is untouched)
       │
       ▼
  agent is `cold`, ready for first prompt
```

**Key invariants:**

- The `events` collection is canonical and is **never rewritten**. Conversion only regenerates `nativeJsonl` (the kind-specific blob) and updates meta fields.
- `nativeSessionId` is regenerated on every conversion (UUIDs; the old id is meaningless to the new CLI).
- Same-kind conversion is **allowed** (useful for model swap or transcript rebuild). Same-kind no-ops still regenerate nativeJsonl + sessionId.
- Conversion does not require the sandbox. It is a pure data operation; the next prompt's existing `ensureTranscriptMaterialised` path writes the new nativeJsonl to the sandbox at the new kind's expected location.

---

## §2. API surface

### Control message (convert)

```ts
{ type: 'convertKind', payload: { kind: CodingAgentKind, model?: string } }
```

Lands on the standard inbox; processed serially after preceding prompts. Completion is observed via the new `kind.converted` lifecycle row (no inbox response).

### Spawn option (fork)

```ts
interface SpawnCodingAgentOptions {
  // existing fields...
  from?: {
    agentId: string
    workspaceMode?: 'share' | 'clone' | 'fresh'
  }
}
```

Default `workspaceMode`:

- bind-mount source → `share`
- volume source → `clone` if provider implements `cloneWorkspace`, else **error** (caller picks `share` or `fresh` explicitly).

### Built-in tools

Registered alongside `spawn_coding_agent`:

```ts
convert_coding_agent({
  id: string,
  kind: CodingAgentKind,
  model?: string,
})

fork_coding_agent({
  source: string,
  kind: CodingAgentKind,
  agentId?: string,
  workspaceMode?: 'share' | 'clone' | 'fresh',
  initialMessage?: string,
  model?: string,
})
```

### UI affordances (`packages/agents-server-ui`)

- **Header gains a "Convert kind" button** next to Pin/Release/Stop. Click → menu lists the _other_ registered kinds; confirm dispatches the control message. Disabled when no other kind is registered.
- **Spawn dialog gains a "Fork from existing agent" toggle**. When enabled: agent picker (filtered to coding-agents in the same workspace tree), kind selector, workspace-mode selector defaulted per the policy above. New agent's `agentId` is auto-generated as for normal spawns.
- **Timeline renders `kind.converted` and `kind.forked` as muted lifecycle rows** (existing pattern — same as `sandbox.started` / `resume.restored`). Detail field carries `oldKind→newKind` for converts and `source=<id>,mode=<mode>` for forks.

### Provider capability

```ts
interface SandboxProvider {
  // existing methods...
  cloneWorkspace?(opts: {
    source: WorkspaceSpec
    target: WorkspaceSpec
  }): Promise<void>
}
```

- `LocalDockerProvider`: implement via `docker run --rm -v src:/from -v dst:/to alpine cp -a /from/. /to/`. Container deleted on completion. Fails fast if either volume is missing.
- `HostProvider`: not implemented (bind-mount semantics — `clone` errors out per the default policy).
- Future Modal/Fly/E2B: implement when their primitives allow; absent capability means `clone` mode errors out at spawn time with a clear message.

---

## §3. Lifecycle & state machine

**Conversion does NOT spawn the sandbox.** It is a pure data operation:

1. Read `events` collection.
2. Call `denormalize(events, newKind, { sessionId, cwd })`.
3. Update `meta.kind` and `meta.nativeSessionId`. (The `model` payload is recorded in the lifecycle row's `detail` string; `SessionMetaRow` has no `model` field.)
4. Replace the `nativeJsonl` row.
5. Insert `lifecycle.kind.converted` row.

No CLI spawn, no `--resume`, no transcript materialise. The next prompt's existing `ensureTranscriptMaterialised` path picks up the new nativeJsonl + sessionId and writes it to the sandbox at the new kind's expected location. The conversion is invisible to the bridge — it just sees a new `kind` on the next turn.

**Inbox handling** mirrors existing serial semantics:

- The convertKind message is a new branch alongside `prompt`.
- A turn in flight when convertKind arrives: the message sits in the inbox; processed after `runTurn` resolves and the lease is released.
- States `cold` / `idle` / `starting` / `stopping`: convertKind processes immediately (collection writes are sequential).

**Fork lifecycle:**

- Register handler reads source's `events` collection cross-stream.
- Before the fork's first turn, `nativeJsonl` is already populated from the denormalize.
- First turn proceeds normally; the existing materialise path writes nativeJsonl to the sandbox.
- `lifecycle.kind.forked` row inserted on the **new** agent's stream. Source agent is untouched.

**Cross-stream read for fork.** This is the spicy bit. The runtime puts each entity's collections on its own stream, so reading another entity's `events` from inside a register handler isn't free. Build-sequence step 1 verifies how this is done (likely a `ctx.observeAgent(sourceId)` shape exists or needs adding) and locks the pattern before any mechanism work. If the runtime requires extension, that work happens in this slice.

---

## §4. Failure model

| Failure                                                 | Behaviour                                                                                                                                                                                             |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Empty events on convert                                 | Allowed. nativeJsonl empty; new kind starts conversation fresh under the same agent. lifecycle row still inserted.                                                                                    |
| `denormalize` throws                                    | Conversion fails; meta untouched; `lifecycle.kind.convert_failed` row + log.                                                                                                                          |
| Source agent missing (fork)                             | First-wake init persists `sessionMeta` then fails the fork branch; agent is registered with `status: 'error'` and `lastError` set. Caller observes the error via the entity's lifecycle row and meta. |
| Source has no events (fork)                             | Fork proceeds; new agent starts with empty history. Equivalent to a normal spawn.                                                                                                                     |
| `cloneWorkspace` fails                                  | First-wake init fails the fork branch after `sessionMeta` is persisted; agent ends in `status: 'error'`. Same shape as the source-missing case.                                                       |
| Same-kind convert                                       | Allowed; regenerates nativeJsonl + sessionId; useful for model swap.                                                                                                                                  |
| Trailing dangling `tool_call` (bridge crashed mid-turn) | `denormalize` processes as-is. Risk: target CLI may complain on resume. Documented edge case; mitigation is a follow-up sanitise pass.                                                                |
| Convert called twice in a row (claude → codex → claude) | Round-trips through events. Tool calls degrade per asp's rules (cross-agent tool-call → `Bash`-with-description). Lossy but semantically coherent.                                                    |
| Convert to a kind that isn't registered                 | Reject at zod validation; lifecycle row not inserted.                                                                                                                                                 |
| Fork to a kind that isn't registered                    | Reject at spawn validation.                                                                                                                                                                           |

**Atomicity.** All meta + nativeJsonl + lifecycle writes for a single conversion go through a single batched transaction (existing `ctx.db.actions.*` pattern). Either all visible or none. No half-converted states.

---

## §5. Testing

### Layer 1 (unit, no Docker, no API keys)

`packages/coding-agents/test/unit/`:

- `convert-kind.test.ts` — fixture events → invoke conversion handler → assert nativeJsonl content matches expected denormalize output, meta.kind / sessionId updated, lifecycle row inserted.
- `fork.test.ts` — synthetic source events → register fork handler → assert new agent's nativeJsonl populated, lifecycle row inserted on new agent.
- `same-kind-convert.test.ts` — regenerates sessionId, nativeJsonl reformatted; meta.model updates if provided.
- `empty-events-convert.test.ts` — graceful no-history conversion.
- `convert-failure.test.ts` — denormalize throws → meta untouched → `convert_failed` row inserted.
- API-shape tests: zod validation for control message + spawn option + tool argument.

### Layer 2 (integration, real Docker, fake CLI)

`packages/coding-agents/test/integration/`:

- `clone-workspace.test.ts` — `LocalDockerProvider.cloneWorkspace` populates the target volume byte-identically (gated `DOCKER=1`).

### Layer 3 (conformance — wires the deferred scenarios)

Extend `packages/coding-agents/src/conformance/integration.ts`:

- **L2.7 — `convert mid-conversation`**: prompt → wait for events → convertKind → next prompt → assert response under new kind.
- **L2.8 — `fork into sibling`**: source has events → spawn fork → first prompt → assert fork sees history.

Extend `packages/coding-agents/src/conformance/provider.ts`:

- **L1.9 — `cloneWorkspace` (optional)** — gated on capability presence (mirrors `supportsRecovery` pattern from existing conformance suite).

### Layer 4 (e2e, real CLIs, real keys)

`packages/coding-agents/test/integration/*.e2e.test.ts` (gated `SLOW=1` + both API keys):

- `convert-kind.e2e.test.ts` — claude prompt with secret → convert to codex → codex prompt asking for the secret → assert response includes secret. Mirrors the existing `import-claude.e2e.test.ts` SECRET pattern.
- `fork-kind.e2e.test.ts` — claude agent runs one turn establishing context → fork as codex → fork's first prompt → assert response references parent's context.

Both tests start the agents-server fixture, spawn agents through the real handler, and use the real CLIs — same harness as existing Layer 4 tests.

### Playwright UI tests

`packages/agents-server-ui/test-results/` (existing Playwright dir). New tests:

- `convert-kind.spec.ts` — open agent with two kinds registered → click Convert dropdown → select other kind → confirm → assert lifecycle row appears and timeline updates after a follow-up turn.
- `fork-spawn.spec.ts` — spawn dialog → toggle "Fork from" → pick agent → pick kind → pick workspace mode → submit → assert new agent appears in sidebar and timeline shows `kind.forked` row.

UI tests do not require real CLIs (use the fake-CLI fixture in the test image).

### Component tests

`packages/agents-server-ui/`:

- Header convert button: dropdown shows other kinds, click dispatches control message with correct payload.
- Spawn dialog fork toggle: validation (source required when toggled, kind required, workspace mode select disabled appropriately).

---

## §6. Build sequence

1. **Cross-stream read pattern** — verify how a register handler can read another entity's `events` collection. Lock the API; document constraints. Pre-requisite for fork.
2. **`cloneWorkspace` capability** — add optional method to `SandboxProvider` interface. Implement on `LocalDockerProvider` via throwaway `alpine cp -a` container. Layer 2 test.
3. **Conversion handler** — add `convertKind` inbox branch. Wire denormalize from asp. Insert lifecycle row. Layer 1 unit tests.
4. **Fork register flow** — extend register handler with `from` branch. Cross-stream read + denormalize + nativeJsonl populate + lifecycle row. Layer 1 unit tests.
5. **API plumbing** — extend zod schemas (control message, spawn option). Type exports.
6. **Tools** — `convert_coding_agent` and `fork_coding_agent` registered alongside existing built-in tools. Tool-shape unit tests.
7. **Provider-aware default for `workspaceMode`** — in fork register flow, branch on source workspace type (bind-mount → share, volume → clone-with-error-fallback).
8. **Conformance scenarios** — L2.7, L2.8 in integration factory; optional L1.9 in provider factory.
9. **UI: header convert** — button + dropdown + dispatch + component tests.
10. **UI: spawn dialog fork** — toggle + selectors + validation + component tests.
11. **Playwright UI tests** — convert-kind.spec.ts, fork-spawn.spec.ts.
12. **Layer 4 e2e** — convert + fork e2e tests with real CLIs.
13. **Documentation updates** — see §7.
14. **Verify** — full unit, integration (`DOCKER=1`), conformance (provider + integration factories), Layer 4 (`SLOW=1`), Playwright UI.

---

## §7. Documentation updates

- **`packages/coding-agents/README.md`** — new section "Cross-kind resume and forking" with:
  - Overview of `convertKind` control message + `from` spawn option.
  - Provider capability matrix for `cloneWorkspace`.
  - Default `workspaceMode` policy table (bind-mount vs volume).
  - Lossy-conversion caveat (cross-agent tool calls degrade to `Bash`-with-description).
- **`docs/superpowers/specs/2026-04-30-coding-agents-platform-primitive-design.md`** — flip the §"Out of scope for v1" line "Cross-kind resume in the spawn dialog (works programmatically; no UI affordance yet)" to a footnote pointing at this design doc as the slice that closed it.
- **`docs/superpowers/specs/2026-05-01-coding-agents-slice-c2-design.md`** — append a "Resolved by" note next to the deferral language at lines 19, 23, pointing at this design.
- **`docs/superpowers/specs/2026-05-02-coding-agents-conformance-design.md`** — append a "Resolved by" note next to the cross-kind-resume non-goal at line 26, and update §"Layer 3" to mention L2.7/L2.8/L1.9 are wired in this slice.
- **`docs/superpowers/specs/notes/`** — implementation notes file appended after merge (lessons learned, denormalize edge cases observed in practice). Convention follows existing slice reports.
- **`AGENTS.md`** — only if it has an existing coding-agents section (search before editing). If yes, add a one-paragraph note about the conversion + fork APIs. If no, skip.

---

## §8. Risks

- **Cross-stream read API.** May require runtime support that doesn't yet exist. Step 1 verifies; if absent, this slice grows to add it (or fork moves to a follow-up slice).
- **`denormalize` lossy on cross-kind tool calls.** asp degrades unknown tools to `Bash`-with-description. Acceptable for v1 (UI still shows the original tool from `events`); document for users.
- **Big workspace clones.** `cp -a` of a multi-GB volume takes minutes. Mitigation: surface progress in lifecycle rows; add a follow-up reflink-aware path on Linux/btrfs.
- **Mid-turn convert with dangling tool_call.** Documented edge case. Empirical mitigation later if it bites.
- **UI complexity.** Three workspace modes × two providers × two kinds × confirmations = surface area. Mitigation: keep the dialog dumb (just dispatch values), put all policy decisions in the runtime.
- **Layer 4 e2e flakiness with real CLIs.** Pattern from existing Layer 4 (E1–E3) — known-flaky e2e tests are tolerated, gated `SLOW=1`. Same approach here; document in implementation notes after first run.

---

## §9. Migration

- **No data migration.** Existing `meta.kind` rows remain valid. Conversion is a runtime operation that mutates a single agent.
- **`SandboxProvider` interface change** is **additive** (`cloneWorkspace` is optional). Existing in-tree implementations (`LocalDockerProvider`, `HostProvider`, fake providers) compile unchanged.
- **`SpawnCodingAgentOptions` extension** is **additive** (`from` is optional). Existing callers compile unchanged.
- **Inbox message schema extension** is **additive** (new `convertKind` variant). Existing callers compile unchanged.

---

## §10. Acceptance criteria

- `pnpm -C packages/coding-agents test` (unit) green: convertKind, fork, same-kind, empty-events, failure path all pass.
- `DOCKER=1 pnpm -C packages/coding-agents test:integration` green: clone-workspace passes; conformance L1.9, L2.7, L2.8 pass.
- `HOST_PROVIDER=1 pnpm -C packages/coding-agents test:integration:host` green: L2.7 + L2.8 pass; L1.9 skipped.
- `SLOW=1 ANTHROPIC_API_KEY=... OPENAI_API_KEY=... pnpm -C packages/coding-agents test` green: convert-kind.e2e + fork-kind.e2e pass with real CLIs.
- `pnpm -C packages/agents-server-ui test:ui` (Playwright) green: convert-kind.spec + fork-spawn.spec pass.
- Manual: spawn a claude agent via the dashboard, send a prompt, click Convert → codex, confirm; send another prompt; observe the response under codex referencing the prior turn. Lifecycle timeline shows the conversion row.
- Manual: open spawn dialog, toggle Fork-from, select source agent (claude), pick codex kind + clone workspace mode, spawn; confirm new sidebar entry; send first prompt; verify response references the source's history.
- `electric-ax-import` and other existing CLIs continue to work unchanged.
- README and predecessor specs updated per §7.
