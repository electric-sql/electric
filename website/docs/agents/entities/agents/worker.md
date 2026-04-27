---
title: Worker
titleTemplate: "... - Electric Agents"
description: >-
  Generic sandboxed subagent type. Spawned by Horton (or any agent) via the spawn_worker tool with a system prompt and a chosen tool subset.
outline: [2, 3]
---

# Worker

A generic, sandboxed subagent type. Workers are spawned by other agents (typically [Horton](./horton)) via the `spawn_worker` tool — the spawner provides a system prompt and picks the subset of tools the worker should have access to.

**Source:** [`packages/agents/src/agents/worker.ts`](https://github.com/electric-sql/electric/blob/main/packages/agents/src/agents/worker.ts)

## Spawn args

```ts
interface WorkerArgs {
  systemPrompt: string
  tools: Array<WorkerToolName>
}
```

| Field          | Required | Description                                                                                   |
| -------------- | -------- | --------------------------------------------------------------------------------------------- |
| `systemPrompt` | Yes      | The worker's system prompt. Brief it like a colleague: file paths, line numbers, deliverable. |
| `tools`        | Yes      | Non-empty subset of valid tool names (see below). Unknown names throw at parse time.          |

`registerWorker(registry, { workingDirectory, streamFn? })` is called by the dev server during bootstrap; you don't usually call it yourself.

## Valid tool names

```ts
type WorkerToolName =
  | "bash"
  | "read"
  | "write"
  | "edit"
  | "brave_search"
  | "fetch_url"
  | "spawn_worker"
```

These are the same primitives Horton uses. Pick the smallest subset the worker needs — tools are the worker's permission set.

## Spawning a worker

The canonical way to spawn a worker is the `spawn_worker` tool, which Horton calls from inside its agent loop:

```ts
spawn_worker({
  systemPrompt:
    "You are a focused researcher. Find the three most-cited papers on X and return their titles, authors, and DOIs as a markdown table.",
  tools: ["brave_search", "fetch_url"],
  initialMessage: "Begin research now.",
})
```

| Field            | Required | Notes                                                                         |
| ---------------- | -------- | ----------------------------------------------------------------------------- |
| `systemPrompt`   | Yes      | Sets persona and constraints.                                                 |
| `tools`          | Yes      | Subset of `WorkerToolName`. Must contain at least one entry.                  |
| `initialMessage` | Yes      | First user message. **Without this the worker idles** — nothing kicks it off. |

The spawn uses `wake: { on: 'runFinished', includeResponse: true }`, so the spawner wakes when the worker finishes its run and receives the worker's response in the wake message.

## What the handler does

1. Parses `ctx.args` into `WorkerArgs`. Throws if `systemPrompt` is empty or `tools` contains an unknown name.
2. Builds the requested tool instances against the worker's `workingDirectory` (and a fresh per-wake `readSet` for the read-first-then-edit guard).
3. Configures the agent with `HORTON_MODEL` (`claude-sonnet-4-5-20250929`), the provided system prompt (with a brief reporting-back footer appended), and the assembled tool list.
4. Runs the agent until the LLM stops.

::: warning Least-privilege sandbox
Workers deliberately do **not** receive `ctx.electricTools`. The spawner already picked the worker's tool subset; granting entity-runtime primitives (cron, schedule, send-to-arbitrary-entity) would let a worker escape that scope. If a worker needs those primitives, it must spawn its own subagent or report back to the spawner. This invariant is asserted by `worker-least-privilege.test.ts`.
:::

## Reporting footer

The runtime appends this to every worker's system prompt:

```text
# Reporting back
When you finish, respond with a concise report covering what was done and any key findings. The caller will relay this to the user, so it only needs the essentials.
```

## Details

| Property          | Value                                                                 |
| ----------------- | --------------------------------------------------------------------- |
| Type name         | `worker`                                                              |
| Model             | `HORTON_MODEL` (`claude-sonnet-4-5-20250929`)                         |
| Tools             | Subset of 7 primitives chosen at spawn time. **No `ctx.electricTools`.** |
| Working directory | Provided to `registerWorker` at bootstrap                             |
| Description       | `Internal — generic worker spawned by other agents`                   |
