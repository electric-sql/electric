---
title: Dispatcher
titleTemplate: "... - Electric Agents"
description: >-
  Message routing pattern that classifies incoming messages and dispatches to specialist agents.
outline: [2, 3]
---

# Dispatcher

Pattern: classify incoming messages and route to the appropriate agent type.

**Source:** [`examples/durable-agents-playground/src/coordination/dispatcher.ts`](https://github.com/electric-sql/durable-streams/blob/main/examples/durable-agents-playground/src/coordination/dispatcher.ts)

## Registration

```ts
export function registerDispatcher(registry: EntityRegistry) {
  registry.define(`dispatcher`, {
    description: `Router agent that classifies incoming messages and dispatches to the appropriate specialist agent type`,
    state: {
      status: { primaryKey: `key` },
      counters: { primaryKey: `key` },
      children: { primaryKey: `key` },
    },

    async handler(ctx) {
      if (ctx.firstWake) {
        ctx.state.status.insert({ key: `current`, value: `idle` })
      }
      const dispatchTool = createDispatchTool(ctx)

      ctx.configureAgent({
        systemPrompt: DISPATCHER_SYSTEM_PROMPT,
        model: `claude-sonnet-4-5-20250929`,
        tools: [...ctx.darixTools, dispatchTool],
      })
      await ctx.agent.run()
    },
  })
}
```

## How it works

The dispatcher exposes a `dispatch` tool. When the LLM classifies an incoming message, it calls the tool with:

- `type` -- the entity type to spawn (e.g. `"assistant"`, `"worker"`)
- `systemPrompt` -- a focused prompt crafted for the task
- `task` -- the original message to forward

The tool then:

1. Increments the dispatch counter in state.
2. Transitions through `classifying` -> `dispatching` -> `waiting` -> `idle`.
3. Spawns the requested entity type with `wake: 'runFinished'`.
4. Awaits completion and returns the result.

## Dispatch tool

```ts
const child = await ctx.spawn(
  type,
  id,
  { systemPrompt },
  {
    initialMessage: task,
    wake: `runFinished`,
  }
)
ctx.state.children.insert({ key: id, url: child.entityUrl, type })

transition(ctx.state.status, DISPATCHER_TRANSITIONS, `waiting`)

const fullText = (await child.text()).join(`\n\n`)
```

## State transitions

```ts
type DispatcherStatus = "idle" | "classifying" | "dispatching" | "waiting"

const DISPATCHER_TRANSITIONS: Record<
  DispatcherStatus,
  readonly DispatcherStatus[]
> = {
  idle: ["classifying"],
  classifying: ["dispatching"],
  dispatching: ["waiting"],
  waiting: ["idle"],
}
```

## State collections

| Collection | Purpose                                     |
| ---------- | ------------------------------------------- |
| `status`   | Current dispatch phase.                     |
| `counters` | Tracks total dispatch count.                |
| `children` | Spawned specialist agents (key, URL, type). |
