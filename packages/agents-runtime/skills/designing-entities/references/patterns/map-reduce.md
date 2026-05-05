# Pattern: map-reduce

Split input into chunks, process all chunks in parallel with independent workers, collect and reduce the results. Unlike `manager-worker`, the worker count varies per input (one per chunk).

**Canonical description:** `/docs/entities/patterns/map-reduce`

**Canonical example:** `examples/durable-agents-playground/src/coordination/map-reduce.ts` — the playground registers its own `worker`; real apps spawning `"worker"` get the built-in least-privilege worker that requires `{ systemPrompt, tools }` (see `/docs/entities/agents/worker`).

## When this pattern applies

- Input is a collection that can be processed in parallel (rows of data, documents, URLs, search queries, etc.).
- Each chunk is processed identically (same `systemPrompt`, different payload).
- Worker count depends on input size, not fixed.
- Reduce step aggregates all results at the end.

If the workers are a fixed named set → `manager-worker`. If they run sequentially → `pipeline`.

## Required state

```ts
state: {
  children: {
    schema: z.object({
      key: z.string(),    // `chunk-${i}-${timestamp}-${counter}`
      url: z.string(),
      chunk: z.number(),  // index in the chunks array
    }),
    primaryKey: "key",
  },
  status: {
    schema: z.object({
      key: z.literal("current"),
      value: z.enum(["idle", "mapping", "reducing"]),
    }),
    primaryKey: "key",
  },
  spawnCounter: {
    schema: z.object({ key: z.literal("value"), count: z.number() }),
    primaryKey: "key",
  },
}
```

The spawn counter prevents duplicate child IDs across re-wakes when the same map operation is invoked multiple times.

## Handler skeleton

```ts
import { entity } from "@electric-ax/agents-runtime"

async handler(ctx, wake) {
  if (ctx.firstWake) {
    ctx.db.actions.status_insert({ row: { key: "current", value: "idle" } })
    ctx.db.actions.spawnCounter_insert({ row: { key: "value", count: 0 } })
  }

  const mapChunksTool: AgentTool = {
    name: "map_chunks",
    parameters: Type.Object({
      chunks: Type.Array(Type.String()),
      task: Type.String(),
    }),
    execute: async (_id, { chunks, task }) => {
      transition(ctx.db, MR_TRANSITIONS, "mapping")

      const counterRow = ctx.db.collections.spawnCounter?.get("value")!
      const startCounter = counterRow.count

      const spawnedIds: string[] = []
      for (let i = 0; i < chunks.length; i++) {
        const spawnNum = startCounter + i + 1
        const id = `chunk-${i}-${Date.now()}-${spawnNum}`
        const child = await ctx.spawn(
          "worker",
          id,
          {
            systemPrompt: task,
            tools: chunkTools, // required for built-in worker, e.g. ["web_search", "fetch_url"]
          },
          { initialMessage: chunks[i], wake: "runFinished" }
        )
        ctx.db.actions.children_insert({ row: { key: id, url: child.entityUrl, chunk: i } })
        spawnedIds.push(id)
      }
      ctx.db.actions.spawnCounter_update({ key: "value", row: { count: startCounter + chunks.length } })

      transition(ctx.db, MR_TRANSITIONS, "reducing")

      const results = await Promise.all(
        spawnedIds.map(async (id) => {
          const row = ctx.db.collections.children?.get(id)!
          const handle = await ctx.observe(entity(row.url))
          return { id, chunk: row.chunk, text: (await handle.text()).join("\n\n") }
        })
      )

      transition(ctx.db, MR_TRANSITIONS, "idle")

      return {
        content: [{ type: "text", text: results.map(r => `## Chunk ${r.chunk}\n${r.text}`).join("\n\n") }],
        details: {},
      }
    },
  }

  ctx.useAgent({ /* ... */, tools: [...ctx.electricTools, mapChunksTool] })
  await ctx.agent.run()
}
```

## Invariants

- **Spawn counter guarantees unique IDs across invocations.** `Date.now()` alone can collide when the tool is called in quick succession.
- **Single spawn loop — no per-child await inside the loop.** All workers start, then reduce collects.
- **`wake: "runFinished"` on every spawn.**
- **`Promise.all` for reduce.** All collection is parallel.
- **Status transitions enforce phase ordering.** idle → mapping → reducing → idle.

## Pattern-specific review checklist

| #   | Rule                                                                                                              | Why                                                             |
| --- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| MR1 | `state.children` tracks chunk index and url per spawned worker.                                                   | Needed for reduce phase to correlate results with input chunks. |
| MR2 | `state.status` with transitions `idle → mapping → reducing → idle`.                                               | Prevents concurrent map phases from interleaving.               |
| MR3 | Spawn counter (or equivalent monotonic source) included in child IDs.                                             | `Date.now()` alone collides under rapid invocation.             |
| MR4 | Spawn loop does not `await child.run` or `child.text()` inside the loop — all workers start first, reduce second. | Sequential awaits defeat parallelism.                           |
| MR5 | Reduce uses `Promise.all` over all spawned children.                                                              | Parallel collection; matches the parallel map.                  |
| MR6 | Every spawn sets `wake: "runFinished"`.                                                                           | Parent wake on child completion.                                |
| MR7 | Every spawn of the built-in `worker` passes a non-empty `tools` array.                                            | Built-in worker throws at parse time otherwise.                 |

## Anti-patterns

- **Random-only IDs (`Math.random()`).** Collisions under rapid calls; hard to debug. Use counter + timestamp.
- **Awaiting each worker in the map loop.** Serializes what should be parallel — that's `pipeline`, not map-reduce.
- **Fixed chunk count.** If the chunks are always 3 fixed roles, use `manager-worker` instead.
- **No spawn counter.** On re-wake, the same counter reset re-generates the same IDs → collisions.
