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

    async handler(ctx) {
      const dispatchTool = createDispatchTool(ctx)

      ctx.useAgent({
        systemPrompt: DISPATCHER_SYSTEM_PROMPT,
        model: `claude-sonnet-4-5-20250929`,
        tools: [...ctx.darixTools, dispatchTool],
      })
      await ctx.agent.run()
    },
  })
}
```

::: info No local state
The dispatcher entity defines no `state` collections. It is stateless -- it relies entirely on the wake mechanism to receive child completion events and forwards specialist output to the user.
:::

## How it works

The dispatcher exposes a `dispatch` tool. When the LLM classifies an incoming message, it calls the tool with:

- `type` -- the entity type to spawn (e.g. `"assistant"`, `"worker"`)
- `systemPrompt` -- a focused prompt crafted for the task
- `task` -- the original message to forward

The tool then:

1. Spawns the requested entity type with `wake: 'runFinished'`.
2. Returns immediately with a status message. The dispatcher is re-invoked when the specialist finishes.

## Dispatch tool

```ts
await ctx.spawn(
  type,
  id,
  { systemPrompt },
  {
    initialMessage: task,
    wake: `runFinished`,
  }
)

return {
  content: [
    {
      type: `text` as const,
      text: `Dispatched to "${type}" specialist (${id}). You will be woken when it finishes.`,
    },
  ],
  details: { id, type },
}
```
