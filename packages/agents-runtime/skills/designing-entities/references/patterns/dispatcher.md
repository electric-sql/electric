# Pattern: dispatcher

An entity classifies incoming messages and routes each one to the appropriate specialist entity **type** — chosen dynamically by the LLM per request. One dispatcher, variable specialists (spawned on demand).

**Canonical description:** `/docs/entities/patterns/dispatcher`

**Canonical example:** `examples/durable-agents-playground/src/coordination/dispatcher.ts`

**Note on the built-in `worker`:** if the dispatcher spawns `"worker"`, pass `{ systemPrompt, tools }` — the built-in worker (`/docs/entities/agents/worker`) requires both. Other target types (`horton`, or any app-registered type) have their own arg contracts.

## When this pattern applies

- Incoming requests vary in kind (research question vs coding question vs data analysis vs ...).
- A different specialist entity type handles each kind.
- The classification is dynamic — the LLM decides which type to spawn based on the request.
- The dispatcher must remain durable: it starts child work, returns, and continues from a later child-completion wake.

If the specialist set is fixed and all specialists run in parallel → `manager-worker`. If routing is rule-based (no LLM), consider a plain `single-agent` that uses `ctx.send` to pre-existing entities.

## Required state

```ts
state: {
  children: {
    schema: z.object({
      key: z.string(),
      url: z.string(),
      type: z.string(),
      status: z.enum(["running", "completed", "failed"]),
      response: z.string().optional(),
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

## Handler skeleton

```ts
async handler(ctx, wake) {
  const finished = wake.payload?.finished_child
  if (finished) {
    ctx.db.actions.children_update({
      key: finished.url,
      updater: (draft) => {
        draft.status = finished.run_status
        draft.response = finished.response ?? ""
      },
    })
    ctx.db.actions.status_update({ key: "current", row: { value: "idle" } })
    await ctx.agent.run(`Specialist finished:\n${finished.response ?? ""}`)
    return
  }

  const dispatchTool: AgentTool = {
    name: "dispatch",
    parameters: Type.Object({
      type: Type.String(),
      systemPrompt: Type.String(),
      task: Type.String(),
    }),
    execute: async (_id, { type, systemPrompt, task }) => {
      transition(ctx.db, DISPATCHER_TRANSITIONS, "classifying")
      const counter = ctx.db.collections.dispatchCounter?.get("value")!.count + 1
      const childId = `dispatch-${counter}-${Date.now()}`

      transition(ctx.db, DISPATCHER_TRANSITIONS, "dispatching")
      const child = await ctx.spawn(type, childId, { systemPrompt }, {
        initialMessage: task,
        wake: { on: "runFinished", includeResponse: true },
      })
      ctx.db.actions.children_insert({ row: { key: child.entityUrl, url: child.entityUrl, type, status: "running" } })
      transition(ctx.db, DISPATCHER_TRANSITIONS, "waiting")

      return {
        content: [{ type: "text", text: `Started ${child.entityUrl}; I will continue when it finishes.` }],
        details: { childUrl: child.entityUrl },
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
- **`wake: { on: "runFinished", includeResponse: true }` on every spawn that needs a text result.** Dispatcher continues from child-completion wakes.
- **Durable continuation only.** The tool starts child work and returns; continuation happens in the handler's later wake.
- **Flag spawning into unregistered types.** Validate against a known type list or catch spawn errors.

## Pattern-specific review checklist

| #   | Rule                                                                                                                   | Why                                                        |
| --- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| D1  | `state.dispatchCounter` present and incremented on each dispatch.                                                      | Prevents duplicate IDs.                                    |
| D2  | `state.status` with the four-state machine.                                                                            | Makes concurrent-dispatch attempts visible and rejectable. |
| D3  | Every result-producing spawn sets `wake: { on: "runFinished", includeResponse: true }`.                                | Otherwise dispatcher will not receive a continuation wake. |
| D4  | `children` row captures the specialist `type`, URL, status, and response.                                              | Needed for durable continuation and observability.         |
| D5  | Either the tool validates `type` against a whitelist, or the tool catches spawn errors and returns them in `content`.  | Unregistered types cause opaque errors.                    |
| D6  | When the dispatched type is the built-in `worker`, the spawn args include `tools` (non-empty `WorkerToolName` subset). | Built-in worker rejects spawns without `tools`.            |

## Anti-patterns

- **Waiting for child output in the tool call.** Same-wake child waits are not durable orchestration.
- **No dispatch counter.** Timestamp collisions under rapid-fire.
- **Infinite dispatch loop without state machine.** Hard to tell why a dispatcher is hanging; state machine makes it observable.
- **Dispatching into types that were never registered.** Validate or wrap.
