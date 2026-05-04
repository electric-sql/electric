---
name: electric-import
description: Use when the user asks to "import this Claude Code session into electric agents", "connect this session to electric", or similar. Detects the current workspace + session id, then runs `electric-ax-import --agent claude` against a running electric-agents dev server. After the import, the session shows up as a `coding-agent` entity in the agents-server-ui at http://localhost:4437/__agent_ui/ (observable, forkable, listable in the sidebar).
---

# Import this Claude Code session into electric-agents

Thin wrapper around `electric-ax-import` that figures out the workspace and session id from the active session, then registers it with a running electric-agents server.

## When to use

User says any of:

- "Import this session into electric"
- "Connect this Claude Code session to electric agents"
- "Make this a coding-agent entity"
- "Hook this up to electric"

## Prerequisites

- An electric-agents server running. By default `http://localhost:4437`. The user typically starts it with `node packages/electric-ax/bin/dev.mjs up` from the electric repo root, but any deployment that exposes the same `PUT /coding-agent/<name>` and `POST /coding-agent/<name>/send` endpoints works.
- The `electric-ax-import` binary on PATH **or** runnable via `pnpm -C <electric-repo>/packages/coding-agents exec electric-ax-import`. If it isn't, run `pnpm -C <electric-repo>/packages/coding-agents build` first.

## Plan

Run these in order. Stop and ask the user if any step fails or returns ambiguous output — don't paper over a failure with a guess.

### Step 1 — locate the workspace + session

```bash
WS=$(pwd -P)
# `electric-ax-import` itself does `realpath(workspace)`; we sanitise here only
# to read the projects/<sanitised>/ dir.
SANITISED=$(printf '%s' "$WS" | sed 's|/|-|g')
PROJ_DIR="$HOME/.claude/projects/$SANITISED"
# The active session is the most recently modified .jsonl.
SESSION_FILE=$(ls -t "$PROJ_DIR"/*.jsonl 2>/dev/null | head -1)
test -n "$SESSION_FILE" || { echo "no session file under $PROJ_DIR" >&2; exit 1; }
SESSION_ID=$(basename "$SESSION_FILE" .jsonl)
echo "workspace: $WS"
echo "session_id: $SESSION_ID"
```

If `$PROJ_DIR` doesn't exist or has no `.jsonl`, the current directory isn't a directory Claude Code has tracked. Stop and tell the user.

### Step 2 — confirm the server is reachable

```bash
SERVER="${ELECTRIC_AGENTS_URL:-http://localhost:4437}"
curl -fsS "$SERVER/health" >/dev/null || { echo "no server at $SERVER" >&2; exit 1; }
```

### Step 3 — run the import

```bash
electric-ax-import --agent claude --workspace "$WS" --session-id "$SESSION_ID" --server "$SERVER"
```

Successful output prints `imported as /coding-agent/<name>`. If the binary is not on PATH, fall back to `pnpm -C <electric-repo>/packages/coding-agents exec electric-ax-import …` — ask the user for the repo path if it isn't obvious from `pwd`.

### Step 4 — show the user where to find it

```bash
echo "open in UI: $SERVER/__agent_ui/#/entity/coding-agent/<name>"
```

Replace `<name>` with the agent id from Step 3's output. The sidebar should now list it.

## Common failures and what to do

- **"session JSONL not found at …"** — `electric-ax-import` runs `realpath(workspace)` and rebuilds the path. If you started the session from a symlink, the resolved path may differ from the sanitised one this skill computed in Step 1. Re-run with `--workspace "$(realpath .)"` to be explicit.

- **"ECONNREFUSED" / "fetch failed"** — server isn't up. From the electric repo root: `node packages/electric-ax/bin/dev.mjs up`. Then retry.

- **"agent already exists"** — this session was already imported. Pass `--agent-id <new-name>` to spawn a fresh entity that observes the same session, e.g. for a second viewer.

- **"command not found: electric-ax-import"** — the binary is exposed by `@electric-ax/coding-agents` package's `bin` entry. From the electric repo: `pnpm -C packages/coding-agents build` then either `pnpm -C packages/coding-agents exec electric-ax-import …` or add `packages/coding-agents/dist/cli/import.js` to PATH.

## Out of scope

- **Codex / opencode imports.** The CLI already supports `--agent codex`; future versions of this skill should detect kind from session-file shape (claude transcripts have `type:"system","subtype":"init"`, codex has `type:"session_meta"`) and switch.
- **Live remote-prompt injection.** Importing makes the session _observable_ — remote users can read events and fork from this session — but a Claude Code CLI session doesn't accept user-message input from a non-stdin source. Use the agents-server-ui timeline to watch; use Fork to spawn a sibling agent that can be prompted.
- **Persisting the import URL anywhere.** This skill prints the URL and exits. If you want it tracked in conversation memory, copy it manually.

## After running

The agent appears in the agents-server-ui sidebar with kind `claude` and the original session's transcript replayed as `events` rows. The user can:

- Send follow-up prompts via `POST /coding-agent/<name>/send` (which would spawn a _new_ sandboxed Claude — not back into this terminal session).
- Fork (`from: { agentId: "/coding-agent/<name>" }`) to start a sibling agent on a copy of the workspace.
- Convert kind / target via the UI dropdowns.
