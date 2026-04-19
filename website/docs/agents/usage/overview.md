---
title: Overview
titleTemplate: "... - Electric Agents"
description: >-
  High level overview of the Electric Agents system and developer APIs.
outline: [2, 3]
---

# Usage overview

High level overview of the Electric&nbsp;Agents system and developer&nbsp;APIs.

## 1. Entity definition (`registry.define()`)

Agents are entities that handle events, defined as a:

- `handler(ctx, wake)` with
- `state` and [built in collections](#_8-built-in-collections)

And schemas:

- `creationSchema` -- validated spawn args
- `inboxSchemas` -- typed message contracts
- `outputSchemas` -- what the entity emits (for UI binding)

See [Defining entities](/docs/agents/usage/defining-entities) and [EntityDefinition reference](/docs/agents/reference/entity-definition).

## 2. Handler context (`ctx`)

The context API passed into the handler:

| Property/Method                      | Purpose                                                 |
| ------------------------------------ | ------------------------------------------------------- |
| `ctx.firstWake`                      | Boolean -- is this the entity's first activation?       |
| `ctx.entityUrl`                      | Identity -- `/type/id`                                  |
| `ctx.entityType`                     | Type name string                                        |
| `ctx.args`                           | Readonly spawn arguments                                |
| `ctx.state.<name>`                   | Proxy to custom state collections                       |
| `ctx.db`                             | Full TanStack DB with all built-in + custom collections |
| `ctx.configureAgent()`               | Set up the LLM agent                                    |
| `ctx.agent.run()`                    | Execute the agent loop                                  |
| `ctx.darixTools`                     | Runtime-provided tools to spread into agent config      |
| `ctx.spawn(type, id, args, opts)`    | Create child entity                                     |
| `ctx.observe(url, opts)`             | Subscribe to another entity                             |
| `ctx.send(url, payload, opts)`       | Send message to an entity                               |
| `ctx.sleep()`                        | Return to idle                                          |
| `ctx.createSharedState(id, schema)`  | Create cross-entity shared state                        |
| `ctx.connectSharedState(id, schema)` | Join existing shared state                              |

See [Writing handlers](/docs/agents/usage/writing-handlers) and [HandlerContext reference](/docs/agents/reference/handler-context).

## 3. Agent configuration

```ts
ctx.configureAgent({
  systemPrompt: string,
  model: string,           // e.g. 'claude-sonnet-4-5-20250929'
  tools: AgentTool[],      // [...ctx.darixTools, ...custom]
  streamFn?: StreamFn,     // optional streaming callback
  testResponses?: string[] // for testing without LLM
})
await ctx.agent.run()      // blocks until agent finishes
```

See [Configuring the agent](/docs/agents/usage/configuring-the-agent) and [AgentConfig reference](/docs/agents/reference/agent-config).

## 4. Tool definition

**Stateless tools** are pure functions:

```ts
const myTool: AgentTool = {
  name: "calculator",
  description: "...",
  parameters: Type.Object({ expression: Type.String() }), // TypeBox
  execute: async (toolCallId, params) => ({
    content: [{ type: "text", text: result }],
    details: {},
  }),
}
```

**Stateful tools** are factories receiving `StateCollectionProxy`:

```ts
function createMemoryTool(stateProxy: StateCollectionProxy<Row>): AgentTool {
  return {
    name: "memory_store",
    execute: async (_, params) => {
      stateProxy.insert({ key, value }) // writes to entity state
    },
  }
}
```

**Handler-scoped tools** are factories receiving `ctx`:

```ts
function createDispatchTool(ctx: HandlerContext): AgentTool {
  return {
    execute: async (_, params) => {
      const child = await ctx.spawn("worker", id, args, { wake: "runFinished" })
      const text = await child.text()
      return { content: [{ type: "text", text }] }
    },
  }
}
```

See [Defining tools](/docs/agents/usage/defining-tools) and [AgentTool reference](/docs/agents/reference/agent-tool).

## 5. State collections (`ctx.state`)

Each collection is a `StateCollectionProxy<T>`:

- `.insert(row)` -- add new row
- `.update(key, draft => { ... })` -- Immer-style mutation
- `.delete(key)` -- remove by primary key
- `.get(key)` -- read one
- `.toArray` -- read all (getter, not method)

See [Managing state](/docs/agents/usage/managing-state) and [StateCollectionProxy reference](/docs/agents/reference/state-collection-proxy).

## 6. Entity coordination primitives

- **`spawn(type, id, args, opts)`** -> `EntityHandle` -- create child
  - `opts.initialMessage` -- first message to deliver
  - `opts.wake` -- `'runFinished'`, `{ on: 'runFinished', includeResponse? }`, or `{ on: 'change', collections?, debounceMs?, timeoutMs? }`
- **`observe(url, opts)`** -> `EntityHandle` -- subscribe to existing entity
- **`send(url, payload, opts)`** -- fire-and-forget message
- **`sleep()`** -- go idle

**EntityHandle** returned from spawn/observe:

- `.entityUrl`, `.type`, `.db` (read-only TanStack DB)
- `.run` -- Promise that resolves when child completes
- `.text()` -- get all completed text output
- `.send(msg)` -- send follow-up message
- `.status()` -- `'spawning' | 'running' | 'idle' | 'stopped'`

See [Spawning & coordinating](/docs/agents/usage/spawning-and-coordinating) and [EntityHandle reference](/docs/agents/reference/entity-handle).

## 7. Shared state (cross-entity)

Define a schema map, then create/connect:

```ts
const schema = {
  findings: {
    schema: z.object({ key: z.string(), text: z.string() }),
    type: "shared:finding",
    primaryKey: "key",
  },
}
// Parent creates:
ctx.createSharedState("research-123", schema)
// Children connect:
const shared = ctx.connectSharedState("research-123", schema)
shared.findings.insert({ key: "f1", text: "..." })
```

See [Shared state](/docs/agents/usage/shared-state) and [SharedStateHandle reference](/docs/agents/reference/shared-state-handle).

## 8. Built-in collections

Every entity automatically has the following `ctx.db.collections`:

| Collection         | Purpose                   | Key fields                                             |
| ------------------ | ------------------------- | ------------------------------------------------------ |
| `runs`             | Agent run lifecycle       | `status: started/completed/failed`                     |
| `steps`            | LLM call steps            | `step_number, model_id, duration_ms`                   |
| `texts`            | Text message blocks       | `status: streaming/completed`                          |
| `textDeltas`       | Incremental text chunks   | `text_id, delta`                                       |
| `toolCalls`        | Tool invocation lifecycle | `tool_name, status, args, result`                      |
| `reasoning`        | Extended thinking blocks  | `status: streaming/completed`                          |
| `errors`           | Diagnostic errors         | `error_code, message`                                  |
| `inbox`            | Received messages         | `from, payload, message_type`                          |
| `wakes`            | Wake event history        | `source, timeout, changes`                             |
| `entityCreated`    | Bootstrap metadata        | `entity_type, args, parent_url`                        |
| `entityStopped`    | Shutdown signal           | `timestamp, reason`                                    |
| `childStatus`      | Child entity status       | `entity_url, status`                                   |
| `manifests`        | Wiring declarations       | discriminated union: child/observe/shared-state/effect |
| `replayWatermarks` | Replay offset tracking    | `source_id, offset`                                    |

See [Built-in collections](/docs/agents/reference/built-in-collections).

## 9. CLI (`darix`)

Interact with the system using the `darix` CLI:

| Command                               | Purpose                      |
| ------------------------------------- | ---------------------------- |
| `darix types`                         | List registered entity types |
| `darix types inspect <name>`          | Show type schema             |
| `darix spawn /type/id --args '{...}'` | Create entity                |
| `darix send /type/id 'message'`       | Send message                 |
| `darix observe /type/id`              | Stream entity events         |
| `darix inspect /type/id`              | Show entity state            |
| `darix ps [--type --status --parent]` | List entities                |
| `darix kill /type/id`                 | Stop entity                  |

See [CLI reference](/docs/agents/reference/cli).

## 10. App setup

```ts
const registry = createEntityRegistry()
registerMyEntity(registry)

const runtime = createRuntimeHandler({
  baseUrl: DARIX_URL, // runtime server
  serveEndpoint: `${URL}/webhook`, // callback URL
  registry,
})

// Node HTTP server, forward POST /webhook -> runtime.onEnter(req, res)
await runtime.registerTypes() // register all types with runtime server
```

See [App setup](/docs/agents/usage/app-setup) and [RuntimeHandler reference](/docs/agents/reference/runtime-handler).
