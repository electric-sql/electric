# Coding Agents MVP — Run Report

**Date:** 2026-04-30
**Plan:** `docs/superpowers/plans/2026-04-30-coding-agents-mvp.md`
**Spec:** `docs/superpowers/specs/2026-04-30-coding-agents-platform-primitive-design.md`
**Validation bar:** integration smoke test starts a Docker sandbox, runs `claude --print` inside it, asserts `session_init` + `assistant_message` events.
**Outcome:** ✅ Green on first integration-test run. No iteration cycle needed.

## Result

```
✓ test/unit/local-docker.test.ts        (1 test)   2 ms
✓ test/unit/stdio-bridge.test.ts        (3 tests)  4 ms
✓ test/integration/smoke.test.ts        (1 test)   3.05 s   ← validation bar
```

Wall clock from "Phase 0 dispatched" to "smoke green":

- Phase 0 (foundation, 1 agent): ~2 min
- Phase 1 (3 parallel agents): ~7.5 min (gated by Dockerfile + image build at 1.A)
- Consolidation (parent session): ~1 min (tsconfig fix + index re-exports)
- Phase 2 (smoke, 1 agent): ~1.5 min (test itself: 3.05 s; rest was setup)

**Total:** ~12 minutes of agent wall-time for a working sandbox + bridge + smoke.

API cost: ~$0.001 per smoke run on `claude-haiku-4-5-20251001`.

## What worked first time

- **The four-phase plan.** Phase 0 (sequential foundation) → Phase 1 (3 parallel independent components) → Phase 2 (single integration agent) mapped cleanly to the file structure. No agent had to wait on another within a phase.
- **Pre-grounding by reading existing patterns.** `packages/agents-runtime/`'s `package.json`, `tsconfig.json`, `tsdown.config.ts`, `vitest.config.ts` were the templates. Subagents copied those exactly.
- **`agent-session-protocol@0.0.2`'s `normalize(lines, 'claude')`.** No signature divergence vs. the plan's assumption. Parsed real `claude --print --output-format=stream-json` output cleanly without filtering.
- **Image build cached aggressively.** First build ~22 s no-cache; subsequent rebuilds ~0.7 s. Smoke test re-runs are essentially free locally.
- **The stdin-piped prompt + `--print --output-format=stream-json --verbose --dangerously-skip-permissions --model claude-haiku-4-5-20251001` flag set.** Worked verbatim.

## What had to be fixed mid-flight

### 1. `tsconfig.json` `rootDir` vs. `include: ["test/**/*"]` clash

**Symptom:** Phase 1.B and Phase 1.C agents both reported `TS6059: File 'X' is not under 'rootDir'` when typechecking. The `tsconfig.json` (copied from `packages/agents-runtime/`) had `"rootDir": "./src"` while `"include"` matched `test/**/*`.

**Why three agents independently flagged it but couldn't fix it:** the Phase 1 agents had explicit constraints to touch only their own files (no cross-cutting `tsconfig.json` edits) — to prevent merge conflicts on the parent commit. The agents correctly did the right thing locally (their tests passed) and surfaced the issue to the parent.

**Fix:** Parent session removed `"rootDir"` (single line). Single consolidation commit (`27ee432a2`).

**Lesson:** When dispatching parallel agents that all need TS to compile, the parent should fix obvious project-config issues _up front_ before dispatching. Or the plan should pre-empt with the right config.

### 2. `useradd -u 1000` collided with `node:22-bookworm-slim`'s built-in `node` user (UID 1000)

**Symptom:** First Dockerfile build attempt failed with `useradd: UID 1000 is not unique`.

**Hypothesis:** The base image already provisions a non-root user.

**Fix:** Phase 1.A agent added `userdel -r node 2>/dev/null || true` before the `useradd`. Build went green.

**Lesson:** Plans that bake `useradd -u 1000` shouldn't assume the base image is empty. Either pick a UID like 1001 or do the userdel-then-useradd dance shown above. Prefer the latter — keeps the convention `agent` user.

### 3. `entrypoint.sh` ignored `$@`, breaking `docker run image claude --version`

**Symptom:** The plan's verbatim entrypoint (`exec tail -f /dev/null`) caused `docker run image claude --version` to hang on `tail` instead of executing `claude --version`. With `ENTRYPOINT` set, positional args become args to the entrypoint, not a replacement command.

**Fix:** Phase 1.A agent made the entrypoint arg-aware — exec `$@` if any args were passed, fall back to `tail -f /dev/null` otherwise. Both `docker run image` (no-arg, idle PID 1) and `docker run image claude --version` (one-shot) now work.

**Lesson:** When using `tini` + `tail` for a long-lived sandbox, the entrypoint must still respect `CMD`/positional args, otherwise smoke checks like `docker run IMAGE claude --version` won't work.

## Other notes

- **Lint-staged backtick conversion.** Repo's pre-commit hook converted all single-quoted strings to backticks via prettier/eslint. Subagents matched the existing style automatically once they read Phase 0's source. No semantic impact.
- **Async iterables for `stdout` / `stderr` worked smoothly.** `node:readline.createInterface(stream)` typed-as `AsyncIterable<string>` and consumed via `for await`. No backpressure issues observed.
- **Volume permissions.** `chown agent:agent /workspace` + `USER agent` in the Dockerfile combined with Docker's volume-mount default ownership preserved write access. No permission errors observed.
- **`--include-partial-messages` not used in MVP.** With `claude --print` we get the full assistant message in one event at the end. For streaming UIs we'll add it later. Not needed for the validation bar.

## What's NOT done (vs. the full design spec)

The MVP intentionally cut these — listed here so the next plan can pick up:

1. **Codex support.** Bridge currently rejects `kind: 'codex'`. Spec needs codex CLI bundled into the image and a parallel arg-set in the bridge.
2. **`LifecycleManager`** — idle hibernation, `pin`/`release` reference counting, state machine, crash recovery via container labels.
3. **Workspace registry + lease.** Per-workspace mutex; refcount on shareable volumes; bind-mount realpath canonicalization. Without this, two agents on the same volume can race.
4. **Resume.** `nativeSessionId` is currently logged-and-ignored. Needs `--resume <id>` plumbing + sidecar JSONL collection write/read for cold-boot restore.
5. **`ctx.spawnCodingAgent` / `ctx.observeCodingAgent`.** No runtime API surface. Today only the Provider + Bridge are usable directly.
6. **Built-in `coding-agent` entity.** No entity registration, no `runs` / `events` / `nativeJsonl` / `lifecycle` collections, no inbox-driven prompt queueing.
7. **UI updates.** Status enum extension, header sandbox provenance row, pin/release/stop buttons, lifecycle event rendering, shared-workspace indicator.
8. **Tools.** `spawn_coding_agent` / `prompt_coding_agent` for Horton.
9. **Removal of legacy `coder` entity.** `packages/agents/src/agents/coding-session.ts`, `spawn-coder.ts`, `prompt-coder.ts` still in place.
10. **Conformance suite + cross-kind resume tests.**
11. **Crash recovery flow.** `provider.recover()` returns labeled containers correctly, but no orphan-run detection / `runs.status=failed` transition exists yet.

## Recommended next steps (priority order)

1. Add `LifecycleManager` + workspace lease (small, unlocks correct multi-agent behavior).
2. Add `ctx.spawnCodingAgent` API surface + built-in `coding-agent` entity (medium; integration with `agents-server` lifecycle).
3. Add resume (`--resume`, sidecar collection, denormalize on cold boot).
4. Replace legacy `coder` + update Horton's tools.
5. UI extensions.
6. Codex support (CLI bundling + bridge arg path).
7. Conformance suite for the parameterized `SandboxProvider` interface (sets up future Modal/Fly impls).

## Artifacts

Commits on `main` (in order):

1. `6a334900a` — scaffold `@electric-ax/coding-agents` package
2. `0c9d3cf2f` — define core types
3. `7d7a01fc0` — Dockerfile + image build helper
4. `4af98f3b5` — `LocalDockerProvider`
5. `0a1c660a8` — `StdioBridge`
6. `27ee432a2` — fix tsconfig + wire re-exports
7. `b178f0e41` — integration smoke against real Docker + Claude

Image: `electric-ax/coding-agent-sandbox:test` (loaded locally; not pushed).

API key: stored at `/tmp/.electric-coding-agents-env` (mode 600, outside repo).

## How to re-run

```bash
# Rebuild image (cached if no Dockerfile changes)
docker build -t electric-ax/coding-agent-sandbox:test \
  -f packages/coding-agents/docker/Dockerfile \
  packages/coding-agents

# Run all unit tests (no Docker required)
pnpm -C packages/coding-agents test

# Run the smoke test (needs Docker + /tmp/.electric-coding-agents-env)
DOCKER=1 pnpm -C packages/coding-agents test:integration
```
