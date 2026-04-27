# Pattern: dispatcher

An entity classifies incoming messages and routes each one to the appropriate specialist entity **type** — chosen dynamically by the LLM per request. One dispatcher, variable specialists (spawned on demand).

**Canonical description:** `/docs/entities/patterns/dispatcher`

**Canonical example:** `examples/durable-agents-playground/src/coordination/dispatcher.ts`

**Note on the built-in `worker`:** if the dispatcher spawns `"worker"`, pass `{ systemPrompt, tools }` — the built-in worker (`/docs/entities/agents/worker`) requires both. Other target types (`horton`, or any app-registered type) have their own arg contracts.

## When this pattern applies

- Incoming requests vary in kind (research question vs coding question vs data analysis vs ...).
- A different specialist entity type handles each kind.
- The classification is dynamic — the LLM decides which type to spawn based on the request.
- Typically one active dispatch at a time (the dispatcher awaits each child before handling the next request).

If the specialist set is fixed and all specialists run in parallel → `manager-worker`. If routing is rule-based (no LLM), consider a plain `single-agent` that uses `ctx.send` to pre-existing entities.

## Required state

```ts
state: {
  children: {
    schema: z.object({
      key: z.string(),   // `dispatch-${counter}-${timestamp}`
      url: z.string(),
      type: z.string(),  // specialist entity type chosen by the LLM
    }),
    primaryKey: "key",
  },
  status: {
    schema: z.object({
      key: z.literal("current"),
      value: z.enum(["idle", "classifying", "dispatching", "waiting"]),
    }),
    primaryKey: "key",
  },
  dispatchCounter: {
    schema: z.object({ key: z.literal("value"), count: z.number() }),
    primaryKey: "key",
  },
}
```

The dispatch counter guarantees unique child IDs across multiple sequential dispatches.

## Handler skeleton

```ts
async handler(ctx, wake) {
  if (ctx.firstWake) {
    ctx.db.actions.status_insert({ row: { key: "current", value: "idle" } })
    ctx.db.actions.dispatchCounter_insert({ row: { key: "value", count: 0 } })
  }

  const dispatchTool: AgentTool = {
    name: "dispatch",
    parameters: Type.Object({
      type: Type.String({ description: "Entity type to spawn (e.g. horton, worker, or any registered app type)" }),
      systemPrompt: Type.String(),
      task: Type.String(),
    }),
    execute: async (_id, { type, systemPrompt, task }) => {
      transition(ctx.db, DISPATCHER_TRANSITIONS, "classifying")

      const counter = ctx.db.collections.dispatchCounter?.get("value")!.count + 1
      ctx.db.actions.dispatchCounter_update({ key: "value", row: { count: counter } })
      const childId = `dispatch-${counter}-${Date.now()}`

      transition(ctx.db, DISPATCHER_TRANSITIONS, "dispatching")
      const child = await ctx.spawn(
        type,
        childId,
        { systemPrompt },
        { initialMessage: task, wake: "runFinished" }
      )
      ctx.db.actions.children_insert({ row: { key: childId, url: child.entityUrl, type } })

      transition(ctx.db, DISPATCHER_TRANSITIONS, "waiting")
      const response = (await child.text()).join("\n\n")
      transition(ctx.db, DISPATCHER_TRANSITIONS, "idle")

      return {
        content: [{ type: "text", text: response }],
        details: {},
      }
    },
  }

  ctx.useAgent({ /* ... */, tools: [...ctx.electricTools, dispatchTool] })
  await ctx.agent.run()
}
```

## Invariants

- **Dispatch counter in state.** `Date.now()` alone is not unique under rapid dispatch.
- **Status state machine.** idle → classifying → dispatching → waiting → idle.
- **`wake: "runFinished"` on every spawn.** Dispatcher awaits each child.
- **Flag spawning into unregistered types.** If the LLM can choose any string, validate against a known type list or be prepared to handle spawn errors (catch → return error message in tool result).

## Pattern-specific review checklist

| #   | Rule                                                                                                                   | Why                                                                     |
| --- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| D1  | `state.dispatchCounter` present and incremented on each dispatch.                                                      | Prevents duplicate IDs.                                                 |
| D2  | `state.status` with the four-state machine.                                                                            | Makes concurrent-dispatch attempts visible and rejectable.              |
| D3  | Every spawn sets `wake: "runFinished"`.                                                                                | Otherwise dispatcher can't collect response.                            |
| D4  | `children` row captures the specialist `type` alongside the URL.                                                       | Needed for debugging/observability ("which entity handled request N?"). |
| D5  | Either the tool validates `type` against a whitelist, or the tool catches spawn errors and returns them in `content`.  | Unregistered types cause opaque errors.                                 |
| D6  | When the dispatched type is the built-in `worker`, the spawn args include `tools` (non-empty `WorkerToolName` subset). | Built-in worker rejects spawns without `tools`.                         |

## Anti-patterns

- **No dispatch counter.** Timestamp collisions under rapid-fire.
- **Infinite dispatch loop without state machine.** Hard to tell why a dispatcher is hanging; state machine makes it observable.
- **Dispatching into types that were never registered.** The spawn throws; if uncaught, the tool errors out with a confusing message. Validate or wrap.
- **Fixed specialist mapping.** If routing is `kind -> type` deterministically, the LLM isn't needed for classification. Use a plain `ctx.send` to a pre-existing entity (that's single-agent with coordination, not dispatcher).
