# Pattern: reactive-observers

An entity subscribes to another entity's stream via `ctx.observe()` and wakes when specified collections change. The observer does not spawn — it watches and reacts.

**Canonical description:** `/docs/entities/patterns/reactive-observers`

**Canonical examples:**

- `examples/durable-agents-playground/src/reactive/monitor.ts` — health dashboard
- `examples/durable-agents-playground/src/reactive/summarizer.ts` — progressive summaries
- `examples/durable-agents-playground/src/reactive/guardian.ts` — quality checks

## When this pattern applies

- One or more existing entities produce a stream of changes (text, tool calls, state updates).
- The observer needs to react to those changes — summarize, alert, flag, aggregate.
- The observer does not start the watched entity; it connects to it.
- Typical wake trigger: `{ on: "change", collections: [...] }`.

If the entity needs to create the thing it's watching → `manager-worker` (observer spawns worker). If the observer routes messages rather than reacts to state → `dispatcher`.

## Required state

Minimal — usually just status:

```ts
state: {
  status: {
    schema: z.object({
      key: z.literal("current"),
      value: z.enum(["idle", "observing", "analyzing", "reporting"]),
    }),
    primaryKey: "key",
  },
}
```

Optionally, track the list of observed targets if the observer watches many entities:

```ts
state: {
  watching: {
    schema: z.object({ key: z.string(), entityUrl: z.string(), since: z.string() }),
    primaryKey: "key",
  },
}
```

## Handler skeleton

```ts
import { entity } from "@electric-ax/agent-runtime"

async handler(ctx, wake) {
  if (ctx.firstWake) {
    ctx.db.actions.status_insert({ row: { key: "current", value: "idle" } })
  }

  const observeTool: AgentTool = {
    name: "observe_entity",
    parameters: Type.Object({
      entity_url: Type.String(),
      collections: Type.Optional(Type.Array(Type.String())),
    }),
    execute: async (_id, { entity_url, collections }) => {
      await ctx.observe(entity(entity_url), {
        wake: {
          on: "change",
          collections: collections ?? ["texts", "toolCalls"],
          debounceMs: 500,
        },
      })
      return {
        content: [{ type: "text", text: `Now observing ${entity_url}` }],
        details: {},
      }
    },
  }

  // On wake from change, read the observed entity's state via ctx.db
  // ... (if needed, tool reads from observed entity's collections) ...

  ctx.useAgent({ /* ... */, tools: [...ctx.electricTools, observeTool] })
  await ctx.agent.run()
}
```

## Invariants

- **Every `ctx.observe()` call includes a `wake` option.** Observation without wake is a silent no-op — handler never re-invokes on changes.
- **No `ctx.spawn()` in the handler.** Observers watch, they don't create. If the entity also spawns, that's a hybrid pattern — document it explicitly.
- **Target URL is parametric** (from `ctx.args`, inbox message, or prior state), not hardcoded to a specific instance.
- **Use `collections` filter when only specific events matter.** Omitting wakes on every change — fine for debugging, noisy in production.
- **Use `debounceMs` when the target changes rapidly.** Without debounce, the observer wakes on every delta and may thrash.

## Pattern-specific review checklist

| #   | Rule                                                                                                                     | Why                                                                                              |
| --- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| RO1 | Every `ctx.observe` call passes a `wake` option.                                                                         | Missing wake = silent subscription, never triggers the handler.                                  |
| RO2 | No `ctx.spawn` calls in the handler body.                                                                                | If present, the entity is not purely reactive — consider a different pattern or document hybrid. |
| RO3 | `wake.on === "change"` includes a `collections` array when the observer only cares about specific events.                | Reduces wake noise.                                                                              |
| RO4 | `debounceMs` set when the source changes rapidly (streamed text, frequent tool calls).                                   | Avoids thrashing.                                                                                |
| RO5 | Target entity URL comes from `ctx.args`, an inbox message, or state — not a hardcoded literal.                           | Hardcoded URLs make the entity usable on exactly one instance.                                   |
| RO6 | Observer reads the target's state via `handle.db.collections.*` or re-observes as needed, not via cross-entity `ctx.db`. | `ctx.db` is this entity's state only; observed data is on the handle's db.                       |

## Anti-patterns

- **`ctx.observe()` without wake.** Silent subscription; handler never fires again.
- **Re-subscribing to the same URL every wake.** One subscription is enough. Track in state if needed.
- **Hardcoded target URL.** Makes the entity single-purpose; pass via args.
- **Spawning inside the observer.** Mixing patterns — split into two entities or document the hybrid clearly.
