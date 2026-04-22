# Pattern: blackboard (shared state)

Multiple entities coordinate through a shared data structure — reads and writes are appended to a durable stream that every participant connects to. The parent creates the shared state; children connect to it and use auto-generated CRUD tools to collaborate.

**Canonical description:** `/docs/entities/patterns/blackboard`

**Canonical example:** `examples/durable-agents-playground/src/blackboard/debate.ts` (also `wiki.ts`, `peer-review.ts`, `trading-floor.ts`). These rely on the **playground's custom worker** (`examples/durable-agents-playground/src/workers/worker.ts`), which accepts `sharedState` / `sharedStateToolMode` / `builtinTools` in spawn args.

## Shared-state workers need a custom worker type

The Electric agent server's built-in `worker` (`/docs/entities/agents/worker`) is a least-privilege sandbox: it accepts only `{ systemPrompt, tools }` and does **not** receive `ctx.electricTools` or `sharedState`. Blackboard workflows therefore require either:

1. **Register a custom worker entity type** in your app that accepts `sharedState` in `ctx.args`, calls `ctx.observe(db(args.sharedState.id, args.sharedState.schema))`, and exposes shared-collection CRUD tools to its agent. The playground worker is a template — copy its pattern into your app and register it with a unique type name (e.g. `"blackboard-worker"`).
2. **Coordinate via `ctx.send` + `ctx.observe`** instead of shared-state tools: the parent writes to its own state, workers observe the parent, workers `ctx.send` results back. Lower bandwidth; gives up the CRUD tool ergonomics.

The example below assumes option 1 — a custom `blackboard-worker` type has been registered.

## When this pattern applies

- Multiple workers need to read and contribute to the same dataset (findings, arguments, orders, wiki sections).
- Contributions are additive or cumulative — each worker adds without overwriting others.
- Parent (or a reader entity) aggregates / reviews / synthesizes from the shared state.
- Can be layered on top of `manager-worker` or `map-reduce` — those define spawning; blackboard defines the shared data channel.

## Required state

On the parent:

```ts
state: {
  status: {
    schema: z.object({
      key: z.literal("current"),
      value: z.enum(["idle", "active", "done"]),
    }),
    primaryKey: "key",
  },
  // plus children tracking if spawning dynamic workers
}
```

**Shared schema** (exported from a shared module, imported by both parent and child):

```ts
// shared-schema.ts
import { z } from 'zod/v4'

export const debateSchema = {
  arguments: {
    schema: z.object({
      key: z.string(),
      side: z.enum(['pro', 'con']),
      round: z.number(),
      text: z.string(),
    }),
    type: 'shared:argument',
    primaryKey: 'key',
  },
} as const
```

## Handler skeleton — parent

```ts
import { debateSchema } from "./shared-schema"
import { db } from '@electric-ax/agent-runtime'

async handler(ctx, wake) {
  const sharedId = `debate-${ctx.entityUrl}`

  if (ctx.firstWake) {
    ctx.mkdb(sharedId, debateSchema)
    ctx.db.actions.status_insert({ row: { key: "current", value: "idle" } })
  }

  const shared = await ctx.observe(db(sharedId, debateSchema), {
    wake: { on: "change", debounceMs: 500 }, // optional — if parent reacts to updates
  })

  const startDebateTool: AgentTool = {
    execute: async (_id, { topic }) => {
      const pro = await ctx.spawn(
        "blackboard-worker", // custom type registered in your app — NOT the built-in "worker"
        "pro",
        {
          systemPrompt: "Argue FOR the proposition...",
          sharedState: { id: sharedId, schema: debateSchema },
        },
        { initialMessage: `Topic: ${topic}`, wake: "runFinished" }
      )
      // ... spawn `con` similarly ...

      return { content: [{ type: "text", text: "Debate started." }], details: {} }
    },
    // ...
  }

  // Later: read from shared
  // const args = shared.arguments.toArray

  ctx.useAgent({ /* ... */ })
  await ctx.agent.run()
}
```

## Handler skeleton — child worker

```ts
import { debateSchema } from "./shared-schema" // SAME schema object
import { db } from '@electric-ax/agent-runtime'

async handler(ctx) {
  const args = ctx.args as { sharedState: { id: string; schema: typeof debateSchema } }
  const shared = await ctx.observe(db(args.sharedState.id, args.sharedState.schema))

  // Worker writes via shared.<collection>.insert / .update
  // The auto-generated CRUD tools (write_arguments, read_arguments, etc.) are
  // also available to its LLM when `sharedStateToolMode: "full"` is set.

  ctx.useAgent({
    systemPrompt: args.systemPrompt,
    model: "claude-sonnet-4-5-20250929",
    tools: [...ctx.electricTools],
  })
  await ctx.agent.run()
}
```

## Invariants

- **`mkdb` is called only on `ctx.firstWake`.** It initializes the backing stream; calling again is a no-op or error.
- **`observe(db(...))` is called every wake** (both parent and child). The handle is not durable across wakes.
- **Parent and children use the same schema object.** Import from a shared module — do not re-declare. Mismatch causes silent write failures or CRUD tool shape drift.
- **Children receive `{ id, schema }` via `ctx.args`.** Conventionally under `args.sharedState.id` and `args.sharedState.schema`.
- **Writes are eventually consistent.** Don't assume a write is visible to others immediately; use `wake: { on: "change" }` to react.

## Pattern-specific review checklist

| #   | Rule                                                                                                                                                                              | Why                                                                                     |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| BB1 | Shared schema declared in a shared module and imported by both parent and children.                                                                                               | Prevents schema drift between writers and readers.                                      |
| BB2 | `mkdb` is inside `if (ctx.firstWake) { ... }`.                                                                                                                                    | Called every wake causes errors.                                                        |
| BB3 | `observe(db(...))` is called outside the `firstWake` guard, every wake.                                                                                                           | The handle must be re-obtained per wake.                                                |
| BB4 | Workers receive `{ id, schema }` as part of `ctx.args` and call `ctx.observe(db(args.sharedState.id, args.sharedState.schema))`.                                                  | Standard worker contract.                                                               |
| BB5 | If the parent reacts to updates (not waiting on child completion), `observe(db(...), { wake: { on: "change", debounceMs } })`.                                                    | Otherwise parent never wakes on shared-state changes.                                   |
| BB6 | Shared collection `type` follows `"shared:<name>"` convention.                                                                                                                    | Distinguishes shared-state events from entity-local state events in the durable stream. |
| BB7 | Spawned workers are a **custom** app-registered type (not the built-in `worker`), OR the coordination is rearchitected to use `ctx.send` + `ctx.observe` instead of shared state. | Built-in worker is least-privilege and does not support `sharedState` args.             |

## Anti-patterns

- **Re-declaring the schema in the worker file.** Two separate object literals are not the same schema, even if they look identical. Import.
- **`mkdb` every wake.** Errors or clobbers depending on runtime; only `firstWake`.
- **Assuming immediate visibility of writes.** Shared writes are async; use wake-on-change to react.
- **Passing the schema as a JSON literal.** Zod objects (or equivalent) are needed — pass the imported object, not `JSON.stringify(schema)`.
