---
title: Targets and kinds
titleTemplate: "Coding Agent - Electric Agents"
description: >-
  sandbox / host / sprites; claude / codex / opencode; workspace types; cross-provider gates.
outline: [2, 3]
---

# Targets and kinds

A coding-agent picks a CLI **kind** (claude / codex / opencode) and a **target** (where the CLI runs — sandbox / host / sprites). The two axes are mostly orthogonal — every kind works on every target — except for a few gates noted below.

## Targets

| Target    | Backend                                                  | Workspace types     | Cleanup on destroy                                  |
| --------- | -------------------------------------------------------- | ------------------- | --------------------------------------------------- |
| `sandbox` | `LocalDockerProvider` (Docker)                           | volume, bindMount   | container removed; **volume kept for resume safety** (see [Operations → Cleanup](./operations#cleanup-utilities)) |
| `host`    | `HostProvider` (no isolation)                            | bindMount only      | nothing to clean up                                 |
| `sprites` | `FlySpriteProvider` ([sprites.dev](https://sprites.dev)) | volume only         | sprite deleted on the platform                      |

### Cross-provider transitions

`sandbox`↔`sprites` and `host`↔`sprites` are **not supported**. Both Convert and Fork between them are rejected at the server — the lifecycle event is `target.changed` with `detail: "failed: cross-provider (<from> → <to>)"`; the UI also disables those dropdown items. Spawn a fresh agent on the target instead.

`convert-target sandbox → host` requires a bind-mount workspace; volume-backed agents are rejected with `lastError = "convert to host requires a bindMount workspace"`.

### Sandbox (LocalDocker)

Runs the CLI inside a Docker container with full process and filesystem isolation. The container uses a persistent workspace volume or bind-mount, ensuring the filesystem layout is fresh on each cold-boot. This is the secure default for multi-tenant or untrusted workloads.

The provider is implemented at [`packages/coding-agents/src/providers/local-docker.ts`](https://github.com/electric-sql/electric/blob/main/packages/coding-agents/src/providers/local-docker.ts) and exercises `docker run` with an `electric-ax.agent-id` label so the runtime can recover containers across host restarts.

### Host

Runs the CLI directly on the host machine as the user running `agents-server`, with full filesystem and network access. Pick host mode when you want to import a local Claude session (resume an existing workflow), or when sandbox isolation isn't required or isn't possible (e.g. Docker is unavailable).

**Trust and access:** Host mode runs with the permissions of the agents-server process — typically the user running the server. Sandbox mode isolates the CLI's filesystem and process namespace inside the container.

### Sprites (Fly Sprites)

[sprites.dev](https://sprites.dev) is Fly's purpose-built agentic-sandbox product (distinct from Fly Machines). The provider is implemented at [`packages/coding-agents/src/providers/fly-sprites/`](https://github.com/electric-sql/electric/blob/main/packages/coding-agents/src/providers/fly-sprites/) and is registered automatically when `SPRITES_TOKEN` is present.

#### Provider parity (v1)

- All three coding-agent kinds (`claude`, `codex`, `opencode`) work on sprites.
- `convert-kind` (claude↔codex↔opencode) works in place on a sprites agent.
- `fork` **within sprites** carries conversation history forward.
- Cross-provider transitions (sandbox/host ↔ sprites) are not supported — sprites is its own provider universe.

#### Implementation notes

The exec WebSocket lives at `wss://api.sprites.dev/v1/sprites/{name}/exec`, **not** the per-sprite URL (the per-sprite URL routes to user-services running INSIDE the sprite, e.g. on :8080). Cmd is in the URL query string. Output frames are multiplexed by a one-byte stream-id prefix (`0x01` stdout, `0x02` stderr, `0x03 <code>` exit). Stdin-bearing exec uses HTTP POST instead of WS because the WebSocket stdin protocol shifted between rc30 (docs) and rc43 (server).

The default Ubuntu 25.10 image preinstalls Claude CLI, OpenAI Codex, Gemini CLI, node and npm — bootstrap installs only `opencode-ai` (with `--prefix=/usr/local` so the binary lands on PATH). Total cold-boot is ~10 s per fresh sprite (idempotent across restarts).

Full bug-by-bug record: [Implementation findings — round 2](https://github.com/electric-sql/electric/blob/main/docs/superpowers/plans/2026-05-02-coding-agents-fly-sprites.md#implementation-findings--round-2-2026-05-03).

## Kinds

| Kind     | CLI binary | Auth                                                                | Notes                                       |
| -------- | ---------- | ------------------------------------------------------------------- | ------------------------------------------- |
| claude   | `claude`   | `ANTHROPIC_API_KEY` (or OAuth via `CLAUDE_CODE_OAUTH_TOKEN`)        | Stream-JSON output; stdin prompt delivery   |
| codex    | `codex`    | `OPENAI_API_KEY`                                                    | Stream-JSON output; stdin prompt delivery   |
| opencode | `opencode` | `ANTHROPIC_API_KEY` and/or `OPENAI_API_KEY` (per-provider routing)  | Per-spawn `model` arg required              |

Adding a new kind = registering a `CodingAgentAdapter` (see [Integrating → Bridges](./integrating#bridges)).

### opencode model picker

opencode requires a model arg per spawn (no provider auto-detect in v1). Curated list (UI dropdown order, see [`CodingAgentSpawnDialog.tsx`](https://github.com/electric-sql/electric/blob/main/packages/agents-server-ui/src/components/CodingAgentSpawnDialog.tsx)):

- `openai/gpt-5.4-mini-fast` (default; chosen for auth-availability in this dev environment)
- `openai/gpt-5.5`
- `openai/gpt-5.5-fast`
- `anthropic/claude-haiku-4-5`
- `anthropic/claude-sonnet-4-6`

opencode reads `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` as per-provider fallback when `~/.local/share/opencode/auth.json` is missing. The handler passes whichever keys are in `process.env` through to the sandbox per-turn.

### opencode storage and resume

opencode persists conversations in SQLite at `~/.local/share/opencode/opencode.db`. Capture is via `opencode export <id>` (base64-encoded for transport); restore is via `opencode import <file>`. Captured JSON lands in the `events` stream the same way claude/codex transcripts do.

## Workspace types

### `volume`

```ts
workspace: { type: 'volume', name: 'my-project' }
// identity: 'volume:my-project'
// LocalDocker volume name: 'coding-agent-workspace-my-project'
// Sprites: a single sprite per agent, no separate volume
```

Created if it does not exist; persists until the last referent calls `destroy()`. Omitting `name` generates a slug from the agent id — unique to that agent. Required for `target: 'sprites'`.

### `bindMount`

```ts
workspace: { type: 'bindMount', hostPath: '/Users/me/projects/my-repo' }
// identity: 'bindMount:/Users/me/projects/my-repo'
```

The host directory is mounted at `realpath(hostPath)` inside the container (path-aligned with the host). Volume workspaces mount at `/workspace`. The runtime never deletes a bind-mount path; `destroy()` only drops the registry entry. Required for `target: 'host'`.

**Aligned path for bind-mounts:** When using a bind-mount workspace, the container's cwd matches the host cwd because the bind-mount is mounted at `realpath(hostPath)` inside the container (not at a fixed `/workspace`). This means `~/.claude/projects/<sanitised-cwd>/...` lines up across both targets without rewriting transcripts, allowing seamless session migration.

### Sharing workspaces

Two agents with the same workspace identity share the volume / bind-mount. Concurrent `idle` agents on a shared workspace coexist freely. Concurrent `running` agents are serialised: the second agent's `runTurn` waits for the first to release the per-identity workspace lease before it can execute. Sprites can't share workspaces (the sprite IS the workspace, keyed by agentId).

## Importing a host session

Resume a Claude session that was already in progress on the local machine by spawning a coding-agent with `target: 'host'` and a bind-mount pointing to the project:

```ts
const agent = await ctx.spawnCodingAgent({
  id: 'imported-session',
  kind: 'claude',
  target: 'host',
  workspace: { type: 'bindMount', hostPath: '/path/to/project' },
  importNativeSessionId: 'abc123def456',
})
```

The handler reads `~/.claude/projects/<sanitised-realpath>/<session-id>.jsonl` on first wake, so `claude --resume <session-id>` on the same machine sees the same conversation history that the agent is working with.

CLI shortcut after building the package:

```bash
pnpm -C packages/coding-agents build
electric-ax-import --agent claude --workspace /path/to/proj --session-id <claude-session-id>
```
