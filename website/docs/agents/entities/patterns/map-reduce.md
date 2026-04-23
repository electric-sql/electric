---
title: Map-Reduce
titleTemplate: "... - Electric Agents"
description: >-
  Parallel processing pattern that splits work into chunks, processes simultaneously, and reduces results.
outline: [2, 3]
---

# Map-Reduce

Pattern: split input into chunks, process all in parallel, collect results.

**Source:** [`examples/durable-agents-playground/src/coordination/map-reduce.ts`](https://github.com/electric-sql/durable-streams/blob/main/examples/durable-agents-playground/src/coordination/map-reduce.ts)

## Registration

```ts
export function registerMapReduce(registry: EntityRegistry) {
  registry.define(`map-reduce`, {
    description: `Map-reduce orchestrator that splits input into chunks, processes them in parallel with worker agents, then synthesizes results`,
    state: {
      children: { primaryKey: `key` },
    },

    async handler(ctx) {
      ctx.useAgent({
        systemPrompt: MAP_REDUCE_SYSTEM_PROMPT,
        model: `claude-sonnet-4-5-20250929`,
        tools: [...ctx.darixTools, createMapChunksTool(ctx)],
      })
      await ctx.agent.run()
    },
  })
}
```

## How it works

The agent exposes a `map_chunks` tool. When called:

1. **Map phase** -- spawns one worker per chunk simultaneously. All workers run in parallel.
2. Returns immediately. The entity is re-invoked as each worker finishes.
3. The LLM synthesizes results once all workers have reported in via wake events.

## Core

```ts
// Map phase - spawn all workers in parallel
for (let i = 0; i < chunks.length; i++) {
  spawnCounter++
  const id = `chunk-${i}-${Date.now()}-${spawnCounter}`
  const child = await ctx.spawn(
    `worker`,
    id,
    { systemPrompt: task },
    {
      initialMessage: chunks[i],
      wake: `runFinished`,
    }
  )
  ctx.db.actions.children_insert({
    row: { key: id, url: child.entityUrl, chunk: i },
  })
}

return {
  content: [
    {
      type: `text` as const,
      text: `Spawned ${chunks.length} parallel workers. You will be woken as each finishes with its output in finished_child.response.`,
    },
  ],
  details: { chunkCount: chunks.length },
}
```

## State collections

| Collection | Purpose                                        |
| ---------- | ---------------------------------------------- |
| `children` | Spawned chunk workers (key, URL, chunk index). |
