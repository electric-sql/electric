# @electric-ax/coding-agents

Coding-agent runtime + sandbox providers for the agents-server platform.

## Internal: cross-stream reads

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

## Cross-kind resume and forking

Two operations let you change which CLI drives a coding-agent:

### Convert (in-place)

Send a `convert-kind` inbox message:

```ts
await ctx.send(`/coding-agent/foo`, { kind: `codex` }, { type: `convert-kind` })
```

The agent's events history is preserved. The next prompt runs under the new kind.

### Fork (sibling agent)

Spawn with `from`:

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

| Provider              | `cloneWorkspace`     |
| --------------------- | -------------------- |
| `LocalDockerProvider` | yes (alpine cp -a)   |
| `HostProvider`        | no (bind-mount only) |

### Lossy aspects

- Cross-agent tool calls degrade to `Bash`-with-description per the protocol's `denormalize` rules.
- Mid-turn-crash artefacts (dangling `tool_call` events) are passed through as-is; a sanitisation pass is a documented follow-up.

## opencode (third agent kind)

[opencode-ai](https://github.com/sst/opencode) is supported as a first-class
spawnable kind alongside claude and codex. v1 is **spawn-only** — cross-kind
operations involving opencode (Fork to opencode, Convert kind: opencode) are
gated in the UI behind a tooltip pointing at the deferred follow-up slice.

### Spawning

```ts
await ctx.spawnCodingAgent({
  id: nanoid(10),
  kind: `opencode`,
  workspace: { type: `volume` },
  model: `openai/gpt-5.4-mini-fast`,
})
```

`model` is required for opencode (no provider auto-detect in v1). Curated
list:

- `openai/gpt-5.4-mini-fast` (v1 default — chosen for auth-availability in this dev environment, see findings in the plan doc)
- `anthropic/claude-haiku-4-5`
- `anthropic/claude-sonnet-4-6`
- `openai/gpt-5.5`
- `openai/gpt-5.5-fast`

### Auth

Env-var only. opencode reads `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` as
per-provider fallback when `~/.local/share/opencode/auth.json` is missing.
The handler passes whichever keys are in `process.env` through to the
sandbox per-turn.

### Storage

opencode persists conversations in SQLite at
`~/.local/share/opencode/opencode.db`. Capture is via `opencode export <id>`
(base64-encoded for transport); restore is via `opencode import <file>`.
Captured JSON lands in the events stream the same way claude/codex
transcripts do.

### Tracked limitations

- **TL-1 (project-wide)**: opencode shares codex's argv-only prompt delivery,
  so prompts are bounded by `ARG_MAX` (~256 KB on Linux). See
  [`docs/superpowers/specs/2026-05-02-coding-agents-opencode-design.md` §10 TL-1](../../docs/superpowers/specs/2026-05-02-coding-agents-opencode-design.md).
- **TL-2 (opencode-only)**: `opencode export`/`opencode import` JSON schema
  isn't documented as stable across versions. The Dockerfile pins
  `opencode-ai` to a known-good version; re-test on bumps. See
  [`…opencode-design.md` §10 TL-2](../../docs/superpowers/specs/2026-05-02-coding-agents-opencode-design.md).
- **TL-3 (opencode-only)**: cross-kind UI is gated. Discoverable absence,
  not silent failure. See
  [`…opencode-design.md` §10 TL-3](../../docs/superpowers/specs/2026-05-02-coding-agents-opencode-design.md).
