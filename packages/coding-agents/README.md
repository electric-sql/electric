# @electric-ax/coding-agents

Coding-agent runtime + sandbox providers for the agents-server platform. A coding-agent is a long-lived `coding-agent` entity that owns a workspace and a CLI session (claude / codex / opencode). The package wires up the sandbox lifecycle (cold → starting → idle → running → cold), the bridge that drives the CLI per turn, and the providers that back the workspace (LocalDocker, Host, Fly Sprites).

## Contents

- [Quick reference](#quick-reference)
- [Conformance status](#conformance-status)
- [Setup](#setup)
- [Spawning](#spawning)
- [Agent lifecycle](#agent-lifecycle)
- [Targets (sandbox / host / sprites)](#targets)
- [Cross-kind resume and forking](#cross-kind-resume-and-forking)
- [opencode (third agent kind)](#opencode-third-agent-kind)
- [Fly Sprites provider](#fly-sprites-provider)
- [Cleanup utilities](#cleanup-utilities)
- [Tracked limitations](#tracked-limitations)
- [Internals](#internals)

---

## Quick reference

| Aspect            | Values                                                                                   |
| ----------------- | ---------------------------------------------------------------------------------------- |
| Agent kinds       | `claude`, `codex`, `opencode`                                                            |
| Targets           | `sandbox` (Docker), `host` (no isolation), `sprites` (sprites.dev remote sandbox)        |
| Workspace types   | `volume` (Docker named volume — sandbox/sprites), `bindMount` (host path — host/sandbox) |
| Inbox messages    | `prompt`, `pin`, `release`, `stop`, `destroy`, `convert-kind`, `convert-target`          |
| Status states     | `cold`, `starting`, `idle`, `running`, `stopping`, `error`, `destroyed`                  |
| Provider env vars | `ANTHROPIC_API_KEY` (or `CLAUDE_CODE_OAUTH_TOKEN`), `OPENAI_API_KEY`, `SPRITES_TOKEN`    |

---

## Conformance status

Two parameterized harnesses exercise the package: `runSandboxProviderConformance` (Layer 1, the `SandboxProvider` contract — 9 scenarios L1.1–L1.9) and `runCodingAgentsIntegrationConformance` (Layer 2, provider+bridge+handler against real CLIs — 8 scenarios × 3 kinds = 24 cells). Capability flags (`supportsRecovery`, `supportsCloneWorkspace`, `supportsSharedWorkspace`) skip scenarios a provider can't satisfy by design.

| Provider              | Pass | Skip | Fail | Skipped scenarios                         |
| --------------------- | ---- | ---- | ---- | ----------------------------------------- |
| `LocalDockerProvider` | 33   | 0    | 0    | —                                         |
| `HostProvider`        | 23   | 10   | 0    | L1.4 / L1.9 + opencode (CLI not on host)  |
| `FlySpriteProvider`   | 25   | 8    | 0    | L1.4 / L1.9 (TL-S3) + L2.5 / L2.6 (TL-S4) |

Run conformance:

```bash
DOCKER=1                            pnpm -C packages/coding-agents test test/integration/local-docker-conformance.test.ts
HOST_PROVIDER=1                     pnpm -C packages/coding-agents test test/integration/host-provider-conformance.test.ts
SPRITES=1 SPRITES_TOKEN=...         pnpm -C packages/coding-agents test test/integration/fly-sprites-conformance.test.ts
```

Layer-4 e2e (real CLIs + a live `agents-server`) live in `test/integration/*.e2e.test.ts` and require `SLOW=1` plus a running dev server (`node packages/electric-ax/bin/dev.mjs up`). Coverage is structurally parallel to Layer 2; Layer 4 adds the HTTP plumbing assertion the conformance harness skips.

---

## Setup

### Required env

At least one of `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` must be set; both is fine. `SPRITES_TOKEN` is required only if you want the sprites target.

```bash
# Most users will have one of these — claude OAuth subscription tokens look like sk-ant-oat...
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-proj-...
SPRITES_TOKEN=<bearer-token-from-sprites.dev>   # optional
```

The default `env()` callback in `register.ts` mirrors `ANTHROPIC_API_KEY` → `CLAUDE_CODE_OAUTH_TOKEN` when the value matches the OAuth shape, so a single `ANTHROPIC_API_KEY=sk-ant-oat...` covers both API and OAuth code paths transparently.

### Local dev

```bash
pnpm install
node packages/electric-ax/bin/dev.mjs up           # spawn full stack on :4437
node packages/electric-ax/bin/dev.mjs restart      # bounce host services (preserves state)
node packages/electric-ax/bin/dev.mjs clear-state  # nuke postgres + volumes + streams
```

`dev.mjs` runs an embedded `DurableStreamTestServer`. To survive `up`-after-`down` without losing entity state, the script sets `ELECTRIC_AGENTS_STREAMS_DATA_DIR=.local/dev-streams` automatically. `clear-state` wipes that directory alongside the postgres/electric volumes.

---

## Spawning

From code:

```ts
import { nanoid } from 'nanoid'

await ctx.spawnCodingAgent({
  id: nanoid(10),
  kind: `claude`, // 'claude' | 'codex' | 'opencode'
  target: `sandbox`, // 'sandbox' | 'host' | 'sprites'
  workspace: { type: `volume` }, // or { type: 'bindMount', hostPath: '/abs/path' }
  // model: 'openai/gpt-5.4-mini-fast', // required for opencode; optional for claude/codex
  // idleTimeoutMs: 300_000,            // optional, default 300s
  // keepWarm: true,                    // disable idle eviction
})
```

From the UI: **New session → coding-agent → pick kind / target / workspace → Spawn**. The dialog auto-switches workspace to volume and disables bind-mount when target=sprites (sprites have intrinsic FS).

The first prompt triggers cold-boot. Send via:

```ts
await ctx.send(
  `/coding-agent/foo`,
  { text: `reply with: ok` },
  { type: `prompt` }
)
```

---

## Agent lifecycle

### Status states (`sessionMeta.status`)

| State       | Meaning                                                                                             |
| ----------- | --------------------------------------------------------------------------------------------------- |
| `cold`      | Sandbox is hibernated. Volume / sprite still exists; will wake on next prompt.                      |
| `starting`  | Cold-boot in progress (provider creating container / sprite, bootstrap running).                    |
| `idle`      | Sandbox up, no active turn. Idle timer counts down to eviction unless `keepWarm` is set.            |
| `running`   | A prompt is being processed (CLI is executing).                                                     |
| `stopping`  | Currently transitioning down (e.g. response to `stop` message or idle eviction).                    |
| `error`     | Most recent operation failed; `lastError` carries the message.                                      |
| `destroyed` | Permanent. Container removed; UI Pin/Release/Stop/Convert disabled. Volume may persist (see below). |

### Inbox messages (control plane)

Send these via `POST /coding-agent/<name>/send`:

| Type             | Payload                                                       | Effect                                                                                           |
| ---------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `prompt`         | `{ text: string }`                                            | Run a turn. If cold, triggers sandbox start + bootstrap (sprites only).                          |
| `pin`            | `{}`                                                          | Mark as pinned; idle eviction is suppressed while pinned.                                        |
| `release`        | `{}`                                                          | Unpin; idle timer resumes.                                                                       |
| `stop`           | `{}`                                                          | Hibernate now. Container removed; `cold`. Volume kept for resume.                                |
| `destroy`        | `{}`                                                          | Terminal. Removes container; sets status `destroyed`.                                            |
| `convert-target` | `{ to: 'sandbox' \| 'host' \| 'sprites' }`                    | Move the workspace to a different target. Cross-provider transitions are rejected (see Targets). |
| `convert-kind`   | `{ kind: 'claude' \| 'codex' \| 'opencode', model?: string }` | Swap the CLI in place; events history is preserved.                                              |

### Idle eviction & keepWarm

After `idleTimeoutMs` (default 300s) of no prompts, the runtime fires a self-message that destroys the container and flips status `idle → cold`. Setting `keepWarm: true` (or sending `pin`) suppresses this. The `release` message clears the pin and idle eviction resumes.

### Lifecycle events

The `coding-agent.lifecycle` collection records timestamped events:

```
sandbox.starting, sandbox.started, sandbox.stopped, sandbox.failed,
pin, release, orphan.detected, resume.restored,
import.restored, import.failed,
target.changed, kind.converted, kind.convert_failed, kind.forked,
bootstrap.starting, bootstrap.complete, bootstrap.failed
```

The UI timeline renders these alongside conversation events. `bootstrap.*` is sprites-only.

---

## Targets

| Target    | Backend                           | Workspace types   | Cleanup on destroy                           |
| --------- | --------------------------------- | ----------------- | -------------------------------------------- |
| `sandbox` | `LocalDockerProvider` (Docker)    | volume, bindMount | container removed; **volume kept** (see O-1) |
| `host`    | `HostProvider` (no isolation)     | bindMount only    | nothing to clean up                          |
| `sprites` | `FlySpriteProvider` (sprites.dev) | volume only       | sprite deleted on the platform               |

**Cross-provider transitions are not supported.** Convert and Fork between `sandbox`↔`sprites` or `host`↔`sprites` are rejected at the server (lifecycle event `target.changed` with `failed: ...`); the UI also disables those dropdown items. Spawn a fresh agent on the target instead.

The `convert-target sandbox → host` path requires a `bindMount` workspace; volume-backed agents are rejected with `lastError = "convert to host requires a bindMount workspace"`.

---

## Cross-kind resume and forking

Two operations let you change which CLI drives a coding-agent.

### Convert (in-place)

```ts
await ctx.send(`/coding-agent/foo`, { kind: `codex` }, { type: `convert-kind` })
```

Events history is preserved. The next prompt runs under the new kind.

### Fork (sibling agent)

```ts
await ctx.spawnCodingAgent({
  id: nanoid(10),
  kind: `codex`,
  workspace: { type: `volume` },
  from: { agentId: `/coding-agent/source`, workspaceMode: `clone` },
})
```

`workspaceMode` defaults: `share` for bind-mount sources, `clone` for volume sources (errors at spawn time if the provider doesn't implement `cloneWorkspace`).

### Provider capability matrix

| Provider              | `cloneWorkspace`             |
| --------------------- | ---------------------------- |
| `LocalDockerProvider` | yes (alpine cp -a)           |
| `HostProvider`        | no (bind-mount only)         |
| `FlySpriteProvider`   | no (deferred to v1.5; TL-S3) |

### Lossy aspects

- Cross-agent tool calls degrade to `Bash`-with-description per the protocol's `denormalize` rules.
- Mid-turn-crash artefacts (dangling `tool_call` events) are passed through as-is; a sanitisation pass is a documented follow-up.

### Internal: cross-stream reads

Fork (spawn-time inheritance) reads another agent's `events` via:

```ts
const handle = await ctx.observe({
  sourceType: 'entity',
  sourceRef: '/coding-agent/source-id',
})
const sourceEvents = (handle.db?.collections.events.toArray ??
  []) as Array<EventRow>
```

Caveats:

- Snapshot semantics: the read is at-spawn-time; subsequent source updates are not reflected.
- The handle includes a wake subscription by default (entities are observed). Fork callers do not need wake; the runtime garbage-collects un-awaited subscriptions per existing semantics.

---

## opencode (third agent kind)

[opencode-ai](https://github.com/sst/opencode) is supported as a first-class spawnable kind alongside claude and codex. v1 is **spawn-only** — cross-kind operations involving opencode (Fork to opencode, Convert kind: opencode) are gated in the UI behind a tooltip pointing at the deferred follow-up slice.

### Spawning

```ts
await ctx.spawnCodingAgent({
  id: nanoid(10),
  kind: `opencode`,
  workspace: { type: `volume` },
  model: `openai/gpt-5.4-mini-fast`,
})
```

`model` is required for opencode (no provider auto-detect in v1). Curated list:

- `openai/gpt-5.4-mini-fast` (v1 default — chosen for auth-availability in this dev environment, see findings in the plan doc)
- `anthropic/claude-haiku-4-5`
- `anthropic/claude-sonnet-4-6`
- `openai/gpt-5.5`
- `openai/gpt-5.5-fast`

### Auth

Env-var only. opencode reads `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` as per-provider fallback when `~/.local/share/opencode/auth.json` is missing. The handler passes whichever keys are in `process.env` through to the sandbox per-turn.

### Storage

opencode persists conversations in SQLite at `~/.local/share/opencode/opencode.db`. Capture is via `opencode export <id>` (base64-encoded for transport); restore is via `opencode import <file>`. Captured JSON lands in the events stream the same way claude/codex transcripts do.

---

## Fly Sprites provider

[sprites.dev](https://sprites.dev) is supported as a third sandbox target alongside `sandbox` (LocalDocker) and `host`. v1 is **provider-parity only** for the existing surface area:

- All three coding-agent kinds (`claude`, `codex`, `opencode`) work on sprites.
- `convert-kind` (claude↔codex↔opencode) works in place on a sprites agent.
- `fork` **within sprites** (kind picker) carries conversation history forward.
- Cross-provider transitions (sandbox/host ↔ sprites) are **not supported** — sprites is its own provider universe. The UI surfaces the option but disables it with an explanatory tooltip.

### Setup

```bash
export SPRITES_TOKEN=<bearer-token-from-sprites.dev>
```

The `FlySpriteProvider` is registered automatically when `SPRITES_TOKEN` is present. Without it, spawning `target='sprites'` fails with a clear error message.

### Spawning

From code:

```ts
await ctx.spawnCodingAgent({
  id: nanoid(10),
  kind: `claude`,
  target: `sprites`,
  workspace: { type: `volume` },
})
```

From the UI: New session → coding-agent → pick **Sprites** target. Workspace type auto-switches to volume; bind-mount is intentionally disabled.

### Implementation notes

The exec WebSocket lives at `wss://api.sprites.dev/v1/sprites/{name}/exec`, **not** the per-sprite URL (the per-sprite URL routes to user-services running INSIDE the sprite). Cmd is in the URL query string. Output frames are multiplexed by a one-byte stream-id prefix (`0x01` stdout, `0x02` stderr, `0x03 <code>` exit). Stdin-bearing exec uses HTTP POST instead of WS because the WebSocket stdin protocol shifted between rc30 (docs) and rc43 (server).

The default Ubuntu 25.10 image preinstalls Claude CLI, OpenAI Codex, Gemini CLI, node and npm — bootstrap installs only `opencode-ai` (with `--prefix=/usr/local` so the binary lands on PATH).

Full bug-by-bug record: [`docs/superpowers/plans/2026-05-02-coding-agents-fly-sprites.md` § Implementation findings — round 2 (2026-05-03)](../../docs/superpowers/plans/2026-05-02-coding-agents-fly-sprites.md#implementation-findings--round-2-2026-05-03).

---

## Cleanup utilities

Two operator scripts under `packages/coding-agents/scripts/`:

```bash
SPRITES_TOKEN=... pnpm -C packages/coding-agents cleanup:sprites           # dry-run
SPRITES_TOKEN=... pnpm -C packages/coding-agents cleanup:sprites --delete  # actually delete

pnpm -C packages/coding-agents cleanup:volumes                             # dry-run
pnpm -C packages/coding-agents cleanup:volumes --delete                    # delete unattached volumes
pnpm -C packages/coding-agents cleanup:volumes --in-use                    # also list still-mounted
```

`cleanup:sprites` lists sprites whose name starts with `conf-sprite-`, `e2e-sprites-`, or `coding-agent-` (the prefixes used by conformance / e2e tests and production UI-spawned sprites).

`cleanup:volumes` lists `coding-agent-workspace-*` Docker volumes (kept by `LocalDockerProvider.destroy()` for resume safety, orphaned after entity DELETE). Default skips still-mounted volumes; `--in-use` widens the listing.

Both scripts run via Node 24's native TS strip — no `tsx` dependency.

---

## Tracked limitations

### opencode

- **TL-1 (project-wide)**: opencode shares codex's argv-only prompt delivery, so prompts are bounded by `ARG_MAX` (~256 KB on Linux). See [`…opencode-design.md` §10 TL-1](../../docs/superpowers/specs/2026-05-02-coding-agents-opencode-design.md).
- **TL-2 (opencode-only)**: `opencode export`/`opencode import` JSON schema isn't documented as stable across versions. The Dockerfile pins `opencode-ai` to a known-good version; re-test on bumps. See [`…opencode-design.md` §10 TL-2](../../docs/superpowers/specs/2026-05-02-coding-agents-opencode-design.md).
- **TL-3 (opencode-only)**: cross-kind UI is gated. Discoverable absence, not silent failure. See [`…opencode-design.md` §10 TL-3](../../docs/superpowers/specs/2026-05-02-coding-agents-opencode-design.md).

### Fly Sprites

- **TL-S1**: Sprites API is pre-1.0. Spec was authored against `v0.0.1-rc30`; the production server is on `0.0.1-rc43` (validated). Pin to a known-good version when published; integration tests catch drift. Resolved deltas vs rc30 captured in [`docs/superpowers/plans/2026-05-02-coding-agents-fly-sprites.md` § Implementation findings — round 2](../../docs/superpowers/plans/2026-05-02-coding-agents-fly-sprites.md#implementation-findings--round-2-2026-05-03): exec URL on `api.sprites.dev` (not per-sprite), output multiplexed `0x01/0x02/0x03` stream-id frames, stdin via HTTP POST (not WS), `cwd=` query param ignored when cmd is shell-wrapped (honored by explicit `cd` in the wrapper instead), `homeDir = /home/sprite` (not `/root`).
- **TL-S2**: No custom OCI image input. First sprite cold-boot per agent includes ~10 s for `opencode-ai` install (idempotent — bootstrap is keyed off `/opt/electric-ax/.bootstrapped`). The default Ubuntu image preinstalls Claude CLI / OpenAI Codex / Gemini CLI / node / npm so we only install opencode.
- **TL-S3**: No `cloneWorkspace`. Workspace files don't transfer on fork within sprites; conversation history does. Conformance L1.9 skipped via `supportsCloneWorkspace: false`.
- **TL-S4**: No cross-provider migration (by design — see Targets above). The sandbox IS the workspace on sprites; conformance L2.5 / L2.6 skipped via `supportsSharedWorkspace: false`.
- **TL-S5**: DNS allowlist policy may need updates for additional egress endpoints.
- **TL-S6**: Real Sprites runs are billed. The conformance harness's `afterAll` scrubs orphans matching `test-coding-agent-` and `conf-sprite-` prefixes; for ad-hoc cleanup run `pnpm cleanup:sprites --delete`.

### LocalDocker

- **O-1 (mitigated)**: `LocalDockerProvider.destroy()` keeps the workspace volume so it survives idle eviction → resume cycles. After the agent's terminal DELETE the volume is orphaned indefinitely. Mitigation: `pnpm cleanup:volumes`. The design-level fix (DELETE entity signaling "terminal" → automatic volume reclaim) is slice-B/C territory.

---

## Internals

- Conversion plan: `packages/coding-agents/src/entity/handler.ts:processConvertKind`, `processConvertTarget`. Cross-provider gate: `if (involvesSprites && !bothSprites) reject` (note the XOR — early drafts of `if (sprites && !local)` matched any-side-sprites and never rejected).
- Sandbox provider lifecycle: `LifecycleManager.providerFor(target)` is called from `processPrompt` before the LLM call; misconfigured providers manifest as `lastError = "No provider configured for target='<target>'..."`.
- Sprites name sanitisation: `spriteName(agentId)` lowercases and replaces any non-`[a-z0-9-]` char with `-`. Lossy by design; collision risk is vanishing for 10-char nanoids.
- Sprites env staging: `/run/agent.env` (mode 600, owned by `sprite` user) is written at `start()` and sourced by every exec via the `wrapWithAgentEnv` shell wrapper, which uses `set -a; . file; set +a` so assignments propagate to children.
- Cold-boot budget: 30 s default, bumped to 240 s for sprites (cold-boot includes per-sprite REST create + WebSocket exec bootstrap with npm install).
