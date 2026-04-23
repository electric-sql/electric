---
title: Electric Agents
titleTemplate: "... - Electric Agents"
description: >-
  The durable runtime for long-lived agents. Core concepts behind Electric Agents — entities, handlers, wakes, state, agent loops, tools, and coordination.
outline: [2, 3]
---

# Electric Agents

Electric Agents is **the durable runtime for long-lived agents**. It's a runtime and communication fabric for spawning and scaling collaborative agents on serverless compute, using your existing web and AI&nbsp;frameworks.

Agent sessions and communication are backed by [Electric Streams](/streams). Each agent is an **entity** with its own stream of events.

Entities listen for messages and events. When a message or event is received — like a child finishing or state changing — the entity is **woken** and its handler runs.

All agent activity (runs, tool calls, text output) is persisted to the entity's durable stream. This means agents can scale to zero and survive restarts whilst maintaining full session history. Sessions can be observed and interacted with by any number of other users and entities, both asynchronously and in real time.

<EntityOverviewDiagram />

## Entities

The unit of durable state. Defined with [`registry.define()`](/docs/agents/reference/entity-registry). Each entity has a type and an ID, addressed by URL as `/{type}/{id}`. An entity's stream is the single source of truth for everything that has happened to it. See [Defining entities](/docs/agents/usage/defining-entities).

```ts
const registry = createEntityRegistry()

registry.define("assistant", {
  description: "A general-purpose AI assistant",
  async handler(ctx) {
    // ...
  },
})
```

## Handlers

The function that runs when an entity wakes. Receives a [`HandlerContext`](/docs/agents/reference/handler-context) (`ctx`) and a [`WakeEvent`](/docs/agents/reference/wake-event) (`wake`). The handler decides how to respond: configure an agent, update state, spawn children, or any combination. See [Writing handlers](/docs/agents/usage/writing-handlers).

```ts
registry.define("support", {
  async handler(ctx, wake) {
    if (wake.type === "message_received") {
      ctx.useAgent({
        systemPrompt: "You are a support agent.",
        model: "claude-sonnet-4-5-20250929",
        tools: [...ctx.darixTools, searchKbTool],
      })
      await ctx.agent.run()
    }
  },
})
```

## Wakes

Events that trigger a handler invocation. Wake sources include: incoming messages, child entity completion, state changes, and timeouts. The [`WakeEvent`](/docs/agents/reference/wake-event) tells the handler why it was woken. See [Waking entities](/docs/agents/usage/waking-entities).

```ts
async handler(ctx, wake) {
  // wake.type — "message_received", "wake", etc.
  // wake.source — who triggered the wake
  // wake.payload — message content or wake data

  if (wake.type === "message_received") {
    const userMessage = wake.payload
    // handle incoming message
  }
}
```

## State

Custom persistent collections on the entity. Writes go through `ctx.db.actions` and reads through `ctx.db.collections`, backed by [TanStack DB](https://tanstack.com/db). State is local to the entity and survives restarts. You define typed collections as part of the [entity definition](/docs/agents/reference/entity-definition). See [Managing state](/docs/agents/usage/managing-state).

```ts
registry.define("tracker", {
  state: {
    items: {
      schema: z.object({
        key: z.string(),
        name: z.string(),
        done: z.boolean(),
      }),
      primaryKey: "key",
    },
  },
  async handler(ctx) {
    // read
    const item = ctx.db.collections.items.get("item-1")

    // write
    ctx.db.actions.items_insert({ key: "item-2", name: "New", done: false })
  },
})
```

## Agent loop

The core pattern is [`ctx.useAgent()`](/docs/agents/reference/agent-config) followed by `ctx.agent.run()`. This runs the LLM in a loop — it generates text, calls tools, and continues until it has nothing left to do. All activity is automatically persisted to the entity's stream. See [Configuring the agent](/docs/agents/usage/configuring-the-agent).

```ts
ctx.useAgent({
  systemPrompt: "You are a helpful assistant.",
  model: "claude-sonnet-4-5-20250929",
  tools: [...ctx.darixTools, myCustomTool],
})

await ctx.agent.run()
```

## Tools

Functions the LLM can call during the agent loop. Each tool has a name, description, parameters (defined with TypeBox or any Standard Schema validator), and an execute function. Tools run in the handler's context and have access to the entity's state and coordination primitives. See [Defining tools](/docs/agents/usage/defining-tools) and the [`AgentTool` reference](/docs/agents/reference/agent-tool).

```ts
const searchKbTool: AgentTool = {
  name: "search_kb",
  description: "Search the knowledge base",
  parameters: z.object({
    query: z.string({ description: "Search query" }),
  }),
  execute: async (_toolCallId, params) => {
    const results = await searchKnowledgeBase(params.query)
    return {
      content: [{ type: "text", text: JSON.stringify(results) }],
    }
  },
}
```

## Coordination

Entities interact through structured primitives. An entity can `spawn` children, `observe` other entities, `send` messages, and [share state](/docs/agents/usage/shared-state). These operations are all durable — they survive restarts and are tracked in the event stream. See [Spawning and coordinating](/docs/agents/usage/spawning-and-coordinating).

```ts
async handler(ctx) {
  // spawn a child entity — wake parent when it finishes
  const child = await ctx.spawn("worker", "task-1", {
    systemPrompt: "Analyse this data",
  }, { initialMessage: data, wake: "runFinished" })

  // send a message to another entity
  ctx.send("/notify/alerts", { level: "info", text: "Task started" })

  // observe another entity's state changes
  await ctx.observe(entity("/order/99"), {
    wake: { on: "change", collections: ["status"] },
  })
}
```

## Built-in collections

Every entity automatically has collections for runs, steps, texts, tool calls, errors, inbox, and more. These are populated by the runtime as the agent operates. You can query them from the handler or observe them externally. See the [Built-in collections reference](/docs/agents/reference/built-in-collections).

```ts
// from inside a handler
const allRuns = ctx.db.collections.runs.toArray
const lastError = ctx.db.collections.errors.toArray.at(-1)

// from outside — observe an entity's stream in real-time
const stream = client.stream("/support/ticket-42")
for await (const event of stream) {
  console.log(event.type, event.value)
}
```
