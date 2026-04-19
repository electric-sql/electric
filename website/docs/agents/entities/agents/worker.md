---
title: Worker
titleTemplate: "... - Electric Agents"
description: >-
  Generic configurable child entity with auto-generated CRUD tools for shared state collections.
outline: [2, 3]
---

# Worker

A generic, configurable child entity. Not a pre-built runtime agent -- a pattern for building configurable workers that receive their prompt, tools, and shared state access via spawn args.

**Source:** [`examples/durable-agents-playground/src/workers/worker.ts`](https://github.com/electric-sql/durable-streams/blob/main/examples/durable-agents-playground/src/workers/worker.ts)

## Registration

```ts
import { registerWorker } from "./workers/worker"

registerWorker(registry)
```

## Configuration

Workers are configured entirely through spawn args:

```ts
interface WorkerArgs {
  systemPrompt: string
  sharedState?: { id: string; schema: SharedStateSchemaMap }
  sharedStateToolMode?: "full" | "write-only"
  builtinTools?: Array<"web_search" | "fetch_url">
}
```

| Field                 | Required | Description                                                                                             |
| --------------------- | -------- | ------------------------------------------------------------------------------------------------------- |
| `systemPrompt`        | Yes      | The agent's system prompt.                                                                              |
| `sharedState`         | No       | Shared state ID and schema to connect to.                                                               |
| `sharedStateToolMode` | No       | `'full'` (default) generates read/write/update/delete tools. `'write-only'` generates write tools only. |
| `builtinTools`        | No       | Which built-in tools to enable.                                                                         |

## What the handler does

1. Parses `ctx.args` into `WorkerArgs`.
2. If `builtinTools` is provided, creates the requested tools (`web_search`, `fetch_url`).
3. If `sharedState` is provided, calls `ctx.connectSharedState()` and generates CRUD tools for each collection in the schema:
   - `write_<collection>` -- insert a row
   - `read_<collection>` -- read all rows
   - `update_<collection>` -- update by key
   - `delete_<collection>` -- delete by key
4. If `sharedStateToolMode` is `'write-only'`, only the `write_` tools are generated.
5. Configures the agent with the provided `systemPrompt` and all assembled tools.
6. Runs the agent.

## Shared state tool generation

From the source:

```ts
for (const [collectionName, collectionSchema] of Object.entries(
  args.sharedState.schema
)) {
  const collection = collectionHandleForName(shared, collectionName)
  if (!collection) continue

  tools.push({
    name: `write_${collectionName}`,
    label: `Write ${collectionName}`,
    description: `Write an entry to the shared ${collectionName} collection. The data must include a unique 'key' field.`,
    parameters: Type.Object({
      data: Type.Record(Type.String(), Type.Unknown(), {
        description: "The data object to write",
      }),
    }),
    execute: async (_id, params) => {
      const { data } = params as { data: Record<string, unknown> }
      const validated = await validateSharedStateRow(
        collectionSchema.schema,
        data
      )
      collection.insert(validated)
      return {
        content: [
          {
            type: "text",
            text: `Written to ${collectionName}: ${JSON.stringify(validated)}`,
          },
        ],
        details: {},
      }
    },
  })

  if (sharedStateToolMode === "write-only") continue

  // ... read, update, delete tools follow the same pattern
}
```

## Spawning a worker

Workers are typically spawned as children by coordination patterns:

```ts
const child = await ctx.spawn(
  "worker",
  "my-worker",
  {
    systemPrompt: "You are a data analyst.",
    builtinTools: ["web_search"],
    sharedState: { id: "shared-123", schema: mySchema },
  },
  {
    initialMessage: "Analyze this data...",
    wake: "runFinished",
  }
)
```

The parent can then await the result with `await child.text()`.
