# Electric Agents UI Bug Hunt — 2026-05-03

> Loop: drive UI via Playwright MCP, observe via API + CLI, write Playwright tests for repros, fix, iterate. Resources cleaned per-iteration. Stack restarted (`dev.mjs clear-state && up`) periodically.

## Setup

- Stack: `pnpm dev.mjs up` on http://localhost:4437.
- Auth: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `SPRITES_TOKEN` in `.env`.
- Browser driver: `mcp__playwright__*` tools.
- Resource verification: `docker ps -a --filter label=electric-ax.agent-id`, `docker volume ls --filter name=coding-agent-`, `pnpm -C packages/coding-agents cleanup:sprites`.
- Skipped: `orchestrator` entity (other app).

## Fixed

### F-1: cleanup-sprites.ts missed the production `coding-agent-` prefix

- **Symptom**: `pnpm cleanup:sprites` only listed under prefixes `conf-sprite-` and `e2e-sprites-`. Production UI-spawned sprites use the `coding-agent-` prefix and would not show up as leaks even when they had leaked.
- **Fix**: added `coding-agent-` to the PREFIXES array in `packages/coding-agents/scripts/cleanup-sprites.ts`.
- **Verified during iteration #9**: an entity DELETE-without-destroy left a sprite behind; running the script with the fix caught it (`Found 1 sprites matching 'conf-sprite-': coding-agent-irez9`).

### F-2: O-2 — Pin/Release/Stop/Convert disabled on destroyed entities

- **Symptom**: see O-2 below (now closed).
- **Fix**: `packages/agents-server-ui/src/components/EntityHeader.tsx` wraps the action group in an IIFE that derives `isDestroyed = codingAgentStatus === 'destroyed'` once and disables Pin / Release / Stop / Convert-target / Convert-kind triggers. Tooltips swap to "Agent is destroyed" when set.
- **Test**: `packages/agents-server-ui/test/e2e/spawn-via-dialog.spec.ts` → `destroyed-entity buttons gate (O-2 fix)` — spawns a real entity, sends destroy, polls for status=destroyed, asserts all five buttons disabled.

### F-3: O-1 — `pnpm cleanup:volumes` script

- **Symptom**: see O-1 below (mitigated, not closed: the design itself defers volume removal in MVP `LocalDockerProvider.destroy()`).
- **Fix**: new `packages/coding-agents/scripts/cleanup-volumes.ts`. Lists `coding-agent-workspace-*` volumes; default skips still-mounted ones; `--delete` and `--in-use` flags. README updated with usage. Verified end-to-end against test fixture volumes and against an actual leaked agent volume.

### F-4: O-3 — durable-streams data persists across host restarts

- **Symptom**: see O-3 below (now closed).
- **Root cause**: `dev.mjs` spawned a fresh `DurableStreamTestServer` on each `up`. Without `STREAMS_DATA_DIR`, the server kept its registry in memory; restart wiped every existing stream and entities looking up `/coding-agent/<name>/main` got 404.
- **Fix**: `packages/electric-ax/bin/dev.mjs` now sets `ELECTRIC_AGENTS_STREAMS_DATA_DIR=.local/dev-streams` (overridable). `clear-state` wipes the directory alongside the postgres/electric volumes, so it parallels existing reset semantics.
- **Verified end-to-end**: spawn agent → first turn 'ok' → bounce host services (no clear-state) → 2nd prompt POST returns 204 → run completes 'ok'. No `Stream not found`.

## Open / cannot fix

### O-3: Existing entity streams 404 after host service restart (no clear-state)

- **Repro**: spawn agent → reach idle → kill `dev.mjs up` and re-run `dev.mjs up` (postgres + electric stay up; only agents-server + handler bounce). Send prompt to existing entity → POST /send returns 500. Server logs `HTTP Error 404 at .../coding-agent/<name>/main: Stream not found`.
- **Expected**: agents-server should re-attach existing entities' streams on boot, since the entity row in postgres is intact.
- **Why deferred**: cuts across the agents-server entity-recovery path; not in this slice.
- **Workaround**: full `dev.mjs clear-state && up` — but that wipes everything. For dev iteration the symptom is "my agent is broken after I restarted the script."

### O-2: Pin/Release/Stop/Convert buttons stay enabled on destroyed entity

- **Repro**: kill an agent → status flips to `destroyed` → header still shows Pin / Release / Stop / Convert target / Convert kind buttons, all enabled.
- **Expected**: these are no-ops on a destroyed sandbox; should be disabled (or hidden), like Fork already is.
- **Why deferred**: cosmetic + visible-but-noop is confusing rather than broken; one-line gate per button. Will fix later in this hunt if time.

### O-1: Volume leak on Kill+DELETE entity (UI flow)

- **Repro**: spawn target=sandbox volume → first turn → click Kill in UI → DELETE entity. The container is removed but `coding-agent-workspace-<id>` volume persists.
- **Root cause**: `LocalDockerProvider.destroy()` intentionally skips volume removal (`local-docker.ts:130` — "Volume cleanup is intentionally NOT done in MVP — tests clean up explicitly"). For the resume-after-idle path this is correct (volume is the persistent workspace). But for the _terminal_ DELETE path the volume is orphaned indefinitely.
- **Why I didn't fix here**: cross-cuts the workspace-lease design — DELETE entity doesn't currently signal "this is terminal vs. ephemeral". Slice-B/C territory.
- **Mitigation**: workaround for operators is `docker volume ls --filter name=coding-agent-` then `docker volume rm`. A `pnpm cleanup:volumes` script would parallel `cleanup:sprites`; recommend adding before mainline.

## Summary

10 iterations driven via Playwright MCP against the live dev stack on http://localhost:4437. Three categories of finding:

- **Fixed**: 1 (cleanup-sprites missed `coding-agent-` prefix; one-line fix).
- **Open**: 3 (volume leak on Kill+DELETE for sandbox+volume; Pin/Release/Stop/Convert buttons stay enabled on destroyed entities; entity streams 404 after host service restart without clear-state).
- **Passing**: every iteration's happy path completed end-to-end. 4 kinds × targets × workspaces work; convert-kind transcript carries forward; same-kind and cross-kind forks recall parent secrets; pin/release/stop/kill lifecycle correct; horton + worker stream correctly.

The `coding-agents-slice-a` branch already has the prior sprites e2e fixes (commit `cca573eed` and earlier). This hunt's commit adds:

- `packages/coding-agents/scripts/cleanup-sprites.ts`: `coding-agent-` prefix added to PREFIXES.
- `packages/agents-server-ui/test/e2e/spawn-via-dialog.spec.ts`: 5 Playwright cases capturing the spawn-dialog combos and the convert-target server gate.

## Iteration log

### #1 (2026-05-03 02:26): claude/sandbox/volume baseline — PASS

- spawn → run.completed responseText='ok' → status idle.
- Kill: container removed, volume leaked (see O-1).

### #2 (2026-05-03 02:28): codex/sandbox/volume — PASS

- spawn → run.completed responseText='ok' → status idle.
- Kill: container gone, volume manually rm'd.

### #3 (2026-05-03 02:30): opencode/sandbox/volume — PASS

- Model selector hidden until kind=opencode picked, default openai/gpt-5.4-mini-fast (correct).
- spawn → run.completed responseText='ok' → status idle.
- Cleanup OK.

### #4 (2026-05-03 02:32): claude/host/bindMount — PASS

- spawn against tmp dir → run.completed 'ok' → idle. No volume artifact (bindMount).

### #5 (2026-05-03 02:34): convert-kind claude→codex transcript — PASS

- Turn 1 (claude): "the secret word is PURPLEFOX. just say ok." → Ok.
- convert-kind to codex → kind.converted lifecycle row.
- Turn 2 (codex): "what was the secret word? answer in one word." → 'PURPLEFOX'.
- Cross-kind transcript carries forward. Cleanup OK.

### #10 (2026-05-03 02:42): horton entity — PASS

- Spawn `/horton/ihort` (no creation_schema args). Send prompt.
- Streamed `ok` via text_delta. Run finished cleanly (`finish_reason: 'stop'`).
- Worker entity is internal-only (not in spawn dialog) — out of scope for UI hunt.

### #9 (2026-05-03 02:39): sprites end-to-end + cleanup CLI verification — PASS, with O-3 + F-1

- spawn target=sprites → bootstrap → run completes (responseText='ok') → idle.
- Kill via destroy → sprite deleted server-side; `pnpm cleanup:sprites` shows 0.
- Resume test: bounced host services without clear-state → existing entity 500's on /send (O-3).
- F-1: cleanup script's PREFIXES missed `coding-agent-`; fixed.

### #8 (2026-05-03 02:36): pin / release / stop / kill lifecycle — PASS

- `idleTimeoutMs=15000, keepWarm=false`: idle → cold after 15s. Auto-eviction works.
- `keepWarm=true`: stayed `idle[keepWarm]` for 80s+ (would have evicted at 8s without). Container still up. Pin/keepWarm prevents auto-eviction.
- `stop` message: status → cold, container removed, lifecycle `sandbox.stopped`.
- Kill via DELETE entity → status destroyed.

### #7 (2026-05-03 02:38): fork same-kind & cross-kind — PASS

- Parent claude/sandbox/volume: "the secret word is BLUEZONE. just say ok." → ok.
- Fork claude→claude: spawned with `fromAgentId=/coding-agent/ifrk7`, sent "what was the secret word?" → 'BLUEZONE'. resume.restored lifecycle row.
- Fork claude→codex: spawned with kind=codex + fromAgentId → 'BLUEZONE' on codex. Cross-kind transcript carries via the denormalized fork.
- Cleanup: 3 volumes manually rm'd (O-1).

### #6 (2026-05-03 02:36): convert-target gate (sandbox+volume → host) — PASS

- spawn sandbox+volume → run completes.
- convert-target to=host → handler rejects with `lastError = "convert to host requires a bindMount workspace"` and lifecycle `target.changed` event with `detail: "failed: host requires bindMount"`. Status stays idle/sandbox.
- Server-side gate is the right behavior. UI also disables the option client-side via convertSpec gate (verified earlier in spawn-sprites.spec.ts; the codepath in EntityHeader.tsx already has `requiresBindMount` check).
