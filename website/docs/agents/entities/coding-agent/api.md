---
title: Native API
titleTemplate: "Coding Agent - Electric Agents"
description: >-
  ctx.spawnCodingAgent, sending prompts, state collections, convert and fork.
outline: [2, 3]
---

# Native API

The coding-agent surface lives entirely on the `agents-runtime` `ctx` — no separate SDK is needed. Use the same primitives you'd use for any other entity (`ctx.spawn`, `ctx.send`, `ctx.observe`, `ctx.db.collections`/`actions`) plus one typed shortcut for spawn.

## `ctx.spawnCodingAgent(opts)`

Defined in [`packages/agents-runtime/src/types.ts`](https://github.com/electric-sql/electric/blob/main/packages/agents-runtime/src/types.ts). Returns a spawn handle whose `.url` is the new entity URL.

```ts
import { nanoid } from 'nanoid'

const coder = await ctx.spawnCodingAgent({
  id: nanoid(10),                                           // stable agent id
  kind: 'claude',                                           // 'claude' | 'codex' | 'opencode'
  target: 'sandbox',                                        // 'sandbox' | 'host' | 'sprites'
  workspace: { type: 'volume' },                            // or { type: 'bindMount', hostPath: '/abs/path' }
  // model: 'openai/gpt-5.4-mini-fast',                     // required for opencode
  initialPrompt: 'Add a sum() helper to src/math.ts.',     // optional first prompt
  wake: { on: 'runFinished', includeResponse: true },       // optional: wake parent on completion
  lifecycle: { idleTimeoutMs: 300_000, keepWarm: false },   // optional: tune idle behaviour
  // from: { agentId: '/coding-agent/source', workspaceMode: 'clone' },  // optional: fork
})
```

| Field           | Description                                                                                                |
| --------------- | ---------------------------------------------------------------------------------------------------------- |
| `id`            | Stable id scoped to the spawning entity. Re-using an id is a no-op (existing agent is observed instead).   |
| `kind`          | Default `claude`.                                                                                          |
| `target`        | Default `sandbox`. `sprites` requires `SPRITES_TOKEN`. `host` requires bindMount.                          |
| `workspace`     | `{ type: 'volume', name?: string }` or `{ type: 'bindMount', hostPath: string }`.                          |
| `model`         | Required for `opencode`; optional for claude/codex.                                                        |
| `initialPrompt` | Queued before first wake — saves a second send.                                                            |
| `wake`          | Async notification: `{ on: 'runFinished', includeResponse?: boolean }`. The parent is woken when this run completes. |
| `lifecycle`     | `{ idleTimeoutMs?: number; keepWarm?: boolean }`. See [Lifecycle → Idle eviction](./lifecycle#idle-eviction-keepwarm). |
| `from`          | Fork source: `{ agentId, workspaceMode?: 'share' \| 'clone' \| 'fresh' }`. See [Fork](#fork).              |

## Sending a prompt

```ts
await ctx.send(`/coding-agent/${id}`, { text: 'reply with: ok' }, { type: 'prompt' })
```

Or via the runtime client / HTTP:

```bash
curl -X POST http://localhost:4437/coding-agent/<name>/send \
  -H 'content-type: application/json' \
  -d '{"from":"user","type":"prompt","payload":{"text":"reply with: ok"}}'
```

## Observing another agent

```ts
const handle = await ctx.observe({
  sourceType: 'entity',
  sourceRef: '/coding-agent/source-id',
})
const sourceEvents = (handle.db?.collections.events.toArray ?? []) as Array<EventRow>
```

The handle provides at-spawn-time snapshot semantics — subsequent source updates are not reflected. Used by [`fork`](#fork) to read the source agent's transcript.

## State collections

`coding-agent` registers five state collections on its entity stream:

| Collection      | Wire type                       | Key                  | Description                                                                              |
| --------------- | ------------------------------- | -------------------- | ---------------------------------------------------------------------------------------- |
| `sessionMeta`   | `coding-agent.sessionMeta`      | `'current'`          | Singleton row: status, kind, target, pinned, workspace identity, last error, model.      |
| `runs`          | `coding-agent.runs`             | `runId` (nanoid)     | One row per turn: status, timestamps, finish reason, response text.                      |
| `events`        | `coding-agent.events`           | `<runId>:<seq>`      | Normalised `agent-session-protocol` events. Used by the timeline and by parent wakes.    |
| `lifecycle`     | `coding-agent.lifecycle`        | `<label>:<ts>-<rand>`| Infrastructure events (sandbox start/stop, pin/release, resume.restored, kind.converted, bootstrap.* ).|
| `nativeJsonl`   | `coding-agent.nativeJsonl`      | `'current'`          | Single-row blob: the CLI's on-disk transcript, captured post-turn. Used only for resume. |

Wire-type constants are exported from `@electric-ax/coding-agents` for parents that want to iterate or filter:

```ts
import {
  CODING_AGENT_SESSION_META_COLLECTION_TYPE, // 'coding-agent.sessionMeta'
  CODING_AGENT_RUNS_COLLECTION_TYPE,         // 'coding-agent.runs'
  CODING_AGENT_EVENTS_COLLECTION_TYPE,       // 'coding-agent.events'
  CODING_AGENT_LIFECYCLE_COLLECTION_TYPE,    // 'coding-agent.lifecycle'
  CODING_AGENT_NATIVE_JSONL_COLLECTION_TYPE, // 'coding-agent.nativeJsonl'
} from '@electric-ax/coding-agents'
```

The handler reads / writes them through standard SDK primitives: `ctx.db.collections.<name>.{get, toArray, rows}` and `ctx.db.actions.<name>_{insert, update}`. See [Defining entities](/docs/agents/usage/defining-entities) and [Managing state](/docs/agents/usage/managing-state) for the general state-collection pattern.

## Convert and Fork

Three operations let you change the CLI driving an agent or split off a sibling.

### Convert kind

Swap CLIs in place — the agent's events history is preserved by **denormalising** to common protocol events and re-rendering as the new kind's transcript format. The next prompt resumes with `--resume <new-session-id>` against the new CLI binary.

```ts
await ctx.send(`/coding-agent/foo`, { kind: 'codex' }, { type: 'convert-kind' })
```

Cross-kind support: claude ↔ codex and either → opencode (uni-directional in v1; opencode → claude/codex deferred). See `convertNativeJsonl` in [`entity/conversion.ts`](https://github.com/electric-sql/electric/blob/main/packages/coding-agents/src/entity/conversion.ts).

### Convert target

Move the workspace between sandbox / host / sprites. Cross-provider transitions (sandbox/host ↔ sprites) are rejected; for `sandbox+volume → host`, the workspace must already be bindMount.

```ts
await ctx.send(`/coding-agent/foo`, { to: 'host' }, { type: 'convert-target' })
```

### Fork

Spawn a sibling agent with `from: { agentId, workspaceMode }`. The new agent's events history is backfilled at first-wake (denormalised → renormalised per the new agent's kind), so cross-kind forks "remember" the parent's conversation.

```ts
const fork = await ctx.spawnCodingAgent({
  id: nanoid(10),
  kind: 'codex',
  workspace: { type: 'volume' },
  from: { agentId: '/coding-agent/source', workspaceMode: 'clone' },
})
```

`workspaceMode` defaults: `share` for bind-mount sources (multiple agents on the same host path serialise via the workspace lease), `clone` for volume sources (errors at spawn time if the provider doesn't implement `cloneWorkspace`).

| Provider              | `cloneWorkspace`                          |
| --------------------- | ----------------------------------------- |
| `LocalDockerProvider` | yes (alpine cp -a)                        |
| `HostProvider`        | no (bind-mount only)                      |
| `FlySpriteProvider`   | no (deferred to v1.5; see TL-S3)          |

## Cross-stream reads

Fork (spawn-time inheritance) reads another agent's `events` via `ctx.observe`:

```ts
const handle = await ctx.observe({
  sourceType: 'entity',
  sourceRef: '/coding-agent/source-id',
})
const sourceEvents = (handle.db?.collections.events.toArray ?? []) as Array<EventRow>
```

Caveats:

- Snapshot semantics: the read is at-spawn-time; subsequent source updates are not reflected.
- The handle includes a wake subscription by default (entities are observed). Fork callers do not need wake; the runtime garbage-collects un-awaited subscriptions per existing semantics.

## Lossy aspects

- Cross-agent tool calls degrade to `Bash`-with-description per the `agent-session-protocol` `denormalize` rules.
- Mid-turn-crash artefacts (dangling `tool_call` events) are passed through as-is; a sanitisation pass is a documented follow-up.
