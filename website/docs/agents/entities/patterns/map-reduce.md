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
      status: { primaryKey: `key` },
      children: { primaryKey: `key` },
    },

    async handler(ctx) {
      if (ctx.firstWake) {
        ctx.state.status.insert({ key: `current`, value: `idle` })
      }
      const mapChunksTool = createMapChunksTool(ctx)

      ctx.configureAgent({
        systemPrompt: MAP_REDUCE_SYSTEM_PROMPT,
        model: `claude-sonnet-4-5-20250929`,
        tools: [...ctx.darixTools, mapChunksTool],
      })
      await ctx.agent.run()
    },
  })
}
```

## How it works

The agent exposes a `map_chunks` tool. When called:

1. **Map phase** -- spawns one worker per chunk simultaneously. All workers run in parallel.
2. **Reduce phase** -- collects results from all workers with `Promise.all` and `handle.text()`.
3. Returns the combined results to the LLM for synthesis.

## Core

```ts
// Map phase - spawn all workers in parallel
const children: Array<{ id: string; handle: EntityHandle }> = []

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
  children.push({ id, handle: child })
  ctx.state.children.insert({ key: id, url: child.entityUrl, chunk: i })
}

// Reduce phase - collect results
transition(ctx.state.status, MAP_REDUCE_TRANSITIONS, `reducing`)

const results = await Promise.all(
  children.map(async ({ id, handle }) => {
    const fullText = (await handle.text()).join(`\n\n`)
    return { id, text: fullText || `(chunk "${id}" produced no text output)` }
  })
)
```

## State transitions

```ts
type MapReduceStatus = "idle" | "mapping" | "reducing"

const MAP_REDUCE_TRANSITIONS: Record<
  MapReduceStatus,
  readonly MapReduceStatus[]
> = {
  idle: ["mapping"],
  mapping: ["reducing"],
  reducing: ["idle"],
}
```

## State collections

| Collection | Purpose                                        |
| ---------- | ---------------------------------------------- |
| `status`   | Current phase (`idle`, `mapping`, `reducing`). |
| `children` | Spawned chunk workers (key, URL, chunk index). |
