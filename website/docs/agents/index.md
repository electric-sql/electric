---
title: Electric Agents
titleTemplate: "... - Electric Agents"
description: >-
  The durable runtime for long-lived agents — entities, handlers, wakes, agent loops, and coordination, built on Electric Streams, TanStack DB, and pi.
outline: [2, 3]
---

<script setup>
import EntityOverviewDiagram from '../../src/components/agents-home/EntityOverviewDiagram.vue'
</script>

# Electric Agents

Electric Agents is **the durable runtime for long-lived agents**. It's a runtime and communication fabric for spawning and scaling collaborative agents on serverless compute, using your existing web and AI&nbsp;frameworks.

Each agent is an **entity** — an addressable, schema-typed unit of state at `/{type}/{id}`. An entity's session and state live on a durable [Electric&nbsp;Stream](/streams/) of events.

Entities **wake** when something happens — a message arrives, a child finishes, state changes, or a scheduled time elapses. When woken, the entity's handler runs. It can configure an LLM agent loop, update state, spawn children, and coordinate with other entities.

Every step — runs, tool calls, text deltas, state changes — is appended to the entity's stream as it happens. Agents scale to zero and survive restarts. Any session can be replayed or [forked](/blog/2026/04/15/fork-branching-for-durable-streams) from any point, and observed in real time by any number of users and entities, both inside the system and from external apps.

<EntityOverviewDiagram />

Start with the [Quickstart](/docs/agents/quickstart) to run the built-in `horton` and `worker` entities and connect your own app in a few minutes. The [Usage overview](/docs/agents/usage/overview) summarises the full developer surface in a single page.

## How it works

The runtime SDK is a layer over three foundations:

- **[Electric&nbsp;Streams](/streams/)** — durable, ordered event log per entity.
- **[TanStack&nbsp;DB](https://tanstack.com/db)** — typed local reads and writes via collections.
- **Mario Zechner's [pi](https://github.com/badlogic/pi-mono) toolkit** — `pi-ai` (unified multi-provider LLM API) and `pi-agent-core` (agent runtime) for the LLM agent loop.

**One stream per entity.** The runtime projects that stream into a typed local DB of collections — an `EntityStreamDB`. Inside a handler, that DB is `ctx.db`: writes go through `ctx.db.actions` (which append events to the stream), reads come from `ctx.db.collections`. The runtime ships [built-in collections](#built-in-collections) for runs, tool calls, text deltas, errors, inbox, and more, and you add your own typed [state](#state) collections per entity type.

**Inside a handler.** When a handler calls `ctx.useAgent()`, the runtime configures the agent on its behalf and routes every step — model call, text delta, tool invocation, error — through the same projection, so the agent loop becomes durable events on the entity's stream.

**Outside the handler.** Any app or other entity can call [`createAgentsClient().observe(entity('/type/id'))`](/docs/agents/usage/clients-and-react) to load an entity's stream into a local DB and react to changes in real time, with the same schemas and types as the handler.

## Entities

Use entities to model anything long-lived and addressable — an agent session, a chat thread, a research job, a coordinator, a worker. You register a **type** with [`registry.define()`](/docs/agents/reference/entity-registry) and spawn **instances** at `/{type}/{id}`. Each instance has its own state, handler, and event stream. See [Defining entities](/docs/agents/usage/defining-entities).

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
        tools: [...ctx.electricTools, searchKbTool],
      })
      await ctx.agent.run()
    }
  },
})
```

## Wakes

Events that trigger a handler invocation. Wake sources include incoming messages, child completion, state changes, and timers (scheduled sends, cron, timeouts). The [`WakeEvent`](/docs/agents/reference/wake-event) tells the handler why it was woken. See [Waking entities](/docs/agents/usage/waking-entities).

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

Custom persistent collections on the entity. Defined as part of the [entity definition](/docs/agents/reference/entity-definition) and accessed through `ctx.db` alongside the [built-in collections](#built-in-collections). State is local to the entity, typed, and survives restarts. Use it for things that belong to the entity but aren't part of the agent's event stream — an order's items, a research job's findings, a chat session's TODOs. See [Managing state](/docs/agents/usage/managing-state).

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
    ctx.db.actions.items_insert({
      row: { key: "item-2", name: "New", done: false },
    })
  },
})
```

## Agent loop

The core pattern is [`ctx.useAgent()`](/docs/agents/reference/agent-config) followed by `ctx.agent.run()`. This runs the LLM in a loop — it generates text, calls tools, and continues until it has nothing left to do. All activity is automatically persisted to the entity's stream. See [Configuring the agent](/docs/agents/usage/configuring-the-agent).

```ts
ctx.useAgent({
  systemPrompt: "You are a helpful assistant.",
  model: "claude-sonnet-4-5-20250929",
  tools: [...ctx.electricTools, myCustomTool],
})

await ctx.agent.run()
```

## Tools

Functions the LLM can call during the agent loop. Each tool has a name, description, parameters (defined with [TypeBox](https://github.com/sinclairzx81/typebox) or any [Standard Schema](https://standardschema.dev) validator), and an execute function. Tools run in the handler's context and have access to the entity's state and coordination primitives. See [Defining tools](/docs/agents/usage/defining-tools) and the [`AgentTool` reference](/docs/agents/reference/agent-tool).

```ts
const searchKbTool: AgentTool = {
  name: "search_kb",
  label: "Search knowledge base",
  description: "Search the knowledge base",
  parameters: Type.Object({
    query: Type.String({ description: "Search query" }),
  }),
  execute: async (_toolCallId, params) => {
    const { query } = params as { query: string }
    const results = await searchKnowledgeBase(query)
    return {
      content: [{ type: "text", text: JSON.stringify(results) }],
      details: {},
    }
  },
}
```

## Coordination

Entities interact through structured primitives. An entity can `spawn` children, `observe` other entities, `send` messages, and [share state](/docs/agents/usage/shared-state). These operations are all durable — they survive restarts and are tracked in the event stream. See [Spawning and coordinating](/docs/agents/usage/spawning-and-coordinating).

```ts
async handler(ctx) {
  // spawn a child entity — wake parent when it finishes
  const child = await ctx.spawn(
    "worker",
    "task-1",
    {
      systemPrompt: "Analyse the report",
      tools: ["read"],
    },
    { initialMessage: "Find the top three issues", wake: "runFinished" }
  )

  // send a message to another entity
  ctx.send("/notify/alerts", { level: "info", text: "Task started" })

  // observe another entity's state changes
  await ctx.observe(entity("/order/99"), {
    wake: { on: "change", collections: ["status"] },
  })
}
```

## Built-in collections

Every entity automatically has collections for runs, steps, texts, tool calls, errors, inbox, and more. These are populated by the runtime as the agent operates and give you live observability into every step of the agent loop — useful for chat UIs, debugging tools, dashboards, and analytics. Query them from the handler or observe them externally. See the [Built-in collections reference](/docs/agents/reference/built-in-collections).

```ts
// from inside a handler
const allRuns = ctx.db.collections.runs.toArray
const lastError = ctx.db.collections.errors.toArray.at(-1)

// from outside — load an entity's stream into a local DB
const client = createAgentsClient({ baseUrl: "http://localhost:4437" })
const db = await client.observe(entity("/support/ticket-42"))
console.log(db.collections.texts.toArray)
```

## Next steps

- [Quickstart](/docs/agents/quickstart) — run the built-in `horton` and `worker` entities and connect your own app.
- [Usage overview](/docs/agents/usage/overview) — the full developer surface on one page.
- [Defining entities](/docs/agents/usage/defining-entities) — entity types, schemas, and configuration.
- [Writing handlers](/docs/agents/usage/writing-handlers) — handler lifecycle and the `ctx` API.
- [Configuring the agent](/docs/agents/usage/configuring-the-agent) — `useAgent`, models, tools, and streaming.
- [Spawning & coordinating](/docs/agents/usage/spawning-and-coordinating) — multi-entity topologies and shared state.
- [Built-in agents](/docs/agents/entities/agents/horton) — Horton, Worker, and Coder, the agents that ship with the runtime.
- [Examples](/docs/agents/examples/playground) — pattern walkthroughs and demo apps.
