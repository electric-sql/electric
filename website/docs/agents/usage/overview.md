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

| Property/Method                     | Purpose                                                               |
| ----------------------------------- | --------------------------------------------------------------------- |
| `ctx.firstWake`                     | Boolean -- initial setup pass while no manifest entries exist         |
| `ctx.entityUrl`                     | Identity -- `/type/id`                                                |
| `ctx.entityType`                    | Type name string                                                      |
| `ctx.args`                          | Readonly spawn arguments                                              |
| `ctx.tags`                          | Entity tags -- key/value metadata                                     |
| `ctx.db`                            | Full TanStack DB: `db.actions` for writes, `db.collections` for reads |
| `ctx.state`                         | Proxy object keyed by collection name                                 |
| `ctx.events`                        | Change events that triggered this wake                                |
| `ctx.useAgent()`                    | Set up the LLM agent                                                  |
| `ctx.useContext()`                  | Declare context sources with token budgets and cache tiers            |
| `ctx.timelineMessages()`            | Project the entity timeline into LLM messages                         |
| `ctx.insertContext(id, entry)`      | Insert a durable context entry                                        |
| `ctx.agent.run()`                   | Execute the agent loop                                                |
| `ctx.electricTools`                    | Runtime-provided tools to spread into agent config                    |
| `ctx.spawn(type, id, args, opts)`   | Create child entity                                                   |
| `ctx.observe(source, opts)`         | Subscribe to a source via `entity()`, `cron()`, `entities()`, `db()`  |
| `ctx.send(url, payload, opts)`      | Send message to an entity                                             |
| `ctx.sleep()`                       | Return to idle                                                        |
| `ctx.mkdb(id, schema)`              | Create cross-entity shared state                                      |
| `ctx.observe(db(id, schema), opts)` | Join existing shared state                                            |
| `ctx.recordRun()`                   | Record non-LLM work as a run for `runFinished` observers              |
| `ctx.setTag(key, value)`            | Set a tag on this entity                                              |
| `ctx.removeTag(key)`                | Remove a tag from this entity                                         |

See [Writing handlers](/docs/agents/usage/writing-handlers) and [HandlerContext reference](/docs/agents/reference/handler-context).

## 3. Agent configuration

```ts
ctx.useAgent({
  systemPrompt: string,
  model: string | Model<any>, // e.g. 'claude-sonnet-4-5-20250929'
  provider?: KnownProvider,   // defaults to 'anthropic' for string models
  tools: AgentTool[],      // [...ctx.electricTools, ...custom]
  streamFn?: StreamFn,     // optional streaming callback
  getApiKey?: (provider: string) => string | Promise<string> | undefined,
  onPayload?: SimpleStreamOptions["onPayload"],
  testResponses?: string[] | TestResponseFn // for testing without LLM
})
await ctx.agent.run()      // blocks until agent finishes
```

See [Configuring the agent](/docs/agents/usage/configuring-the-agent) and [AgentConfig reference](/docs/agents/reference/agent-config).

## 4. Tool definition

**Stateless tools** are pure functions:

```ts
const myTool: AgentTool = {
  name: "calculator",
  label: "Calculator",
  description: "Evaluate a mathematical expression.",
  parameters: Type.Object({ expression: Type.String() }), // TypeBox
  execute: async (_toolCallId, params) => {
    const { expression } = params as { expression: string }
    const result = evaluate(expression)
    return {
      content: [{ type: "text", text: String(result) }],
      details: {},
    }
  },
}
```

**Stateful tools** are factories receiving `ctx` for state access:

```ts
function createMemoryTool(ctx: HandlerContext): AgentTool {
  return {
    name: "memory_store",
    label: "Memory Store",
    description: "Persist a key-value memory row.",
    parameters: Type.Object({
      key: Type.String(),
      value: Type.String(),
    }),
    execute: async (_, params) => {
      const { key, value } = params as { key: string; value: string }
      ctx.db.actions.memory_insert({ row: { key, value } }) // writes to entity state
      return { content: [{ type: "text", text: "Stored." }], details: {} }
    },
  }
}
```

**Handler-scoped tools** are factories receiving `ctx`:

```ts
function createDispatchTool(ctx: HandlerContext): AgentTool {
  return {
    name: "dispatch",
    label: "Dispatch",
    description: "Spawn a worker and return its text output.",
    parameters: Type.Object({
      id: Type.String(),
      systemPrompt: Type.String(),
      task: Type.String(),
    }),
    execute: async (_, params) => {
      const { id, systemPrompt, task } = params as {
        id: string
        systemPrompt: string
        task: string
      }
      const child = await ctx.spawn(
        "worker",
        id,
        { systemPrompt, tools: ["read"] },
        { initialMessage: task, wake: "runFinished" }
      )
      const text = (await child.text()).join("\n\n")
      return { content: [{ type: "text", text }], details: {} }
    },
  }
}
```

See [Defining tools](/docs/agents/usage/defining-tools) and [AgentTool reference](/docs/agents/reference/agent-tool).

## 5. State collections (`ctx.db`)

Custom state is accessed through `ctx.db`:

**Writes** via `ctx.db.actions`:

- `.<name>_insert({ row })` -- add new row
- `.<name>_update({ key, updater: (draft) => { ... } })` -- Immer-style mutation
- `.<name>_delete({ key })` -- remove by primary key

**Reads** via `ctx.db.collections`:

- `.<name>?.get(key)` -- read one
- `.<name>?.toArray` -- read all (getter, not method)

See [Managing state](/docs/agents/usage/managing-state).

## 6. Entity coordination primitives

- **`spawn(type, id, args, opts)`** -> `EntityHandle` -- create child
  - `opts.initialMessage` -- first message to deliver
  - `opts.wake` -- `'runFinished'`, `{ on: 'runFinished', includeResponse? }`, or `{ on: 'change', collections?, debounceMs?, timeoutMs? }`
- **`observe(source, opts)`** -> `EntityHandle | ObservationHandle` -- subscribe via `entity()`, `cron()`, `entities()`, `db()`
- **`send(url, payload, opts)`** -- fire-and-forget message
- **`recordRun()`** -> `RunHandle` -- publish run lifecycle for external work
- **`sleep()`** -- go idle

**EntityHandle** returned from spawn/observe:

- `.entityUrl`, `.type`, `.db` (read-only TanStack DB)
- `.run` -- Promise that resolves when child completes
- `.text()` -- get all completed text output
- `.send(msg)` -- send follow-up message
- `.status()` -- `ChildStatus | undefined` (object with `.status`, `.entity_url`, `.entity_type`)

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
ctx.mkdb("research-123", schema)
// Children connect:
const shared = await ctx.observe(db("research-123", schema))
shared.findings.insert({ key: "f1", text: "..." })
```

See [Shared state](/docs/agents/usage/shared-state) and [SharedStateHandle reference](/docs/agents/reference/shared-state-handle).

## 8. Built-in collections

Every entity automatically has 17 `ctx.db.collections`:

| Collection         | Purpose                   | Key fields                                                             |
| ------------------ | ------------------------- | ---------------------------------------------------------------------- |
| `runs`             | Agent run lifecycle       | `status: started/completed/failed`                                     |
| `steps`            | LLM call steps            | `step_number, model_id, duration_ms`                                   |
| `texts`            | Text message blocks       | `status: streaming/completed`                                          |
| `textDeltas`       | Incremental text chunks   | `text_id, delta`                                                       |
| `toolCalls`        | Tool invocation lifecycle | `tool_name, status, args, result`                                      |
| `reasoning`        | Extended thinking blocks  | `status: streaming/completed`                                          |
| `errors`           | Diagnostic errors         | `error_code, message`                                                  |
| `inbox`            | Received messages         | `from, payload, message_type`                                          |
| `wakes`            | Wake event history        | `source, timeout, changes`                                             |
| `entityCreated`    | Bootstrap metadata        | `entity_type, args, parent_url`                                        |
| `entityStopped`    | Shutdown signal           | `timestamp, reason`                                                    |
| `childStatus`      | Child entity status       | `entity_url, status`                                                   |
| `manifests`        | Wiring declarations       | discriminated union: child/source/shared-state/effect/context/schedule |
| `replayWatermarks` | Replay offset tracking    | `source_id, offset`                                                    |
| `tags`             | Entity tags/labels        | `key, value`                                                           |
| `contextInserted`  | Context additions         | `id, name, attrs, content, timestamp`                                  |
| `contextRemoved`   | Context removals          | `id, name, timestamp`                                                  |

See [Built-in collections](/docs/agents/reference/built-in-collections).

## 9. CLI (`electric agents`)

Interact with the system using the Electric Agents CLI:

| Command                                      | Purpose                      |
| -------------------------------------------- | ---------------------------- |
| `electric agents types`                       | List registered entity types |
| `electric agents types inspect <name>`        | Show type schema             |
| `electric agents spawn /type/id --args '{...}'` | Create entity                |
| `electric agents send /type/id 'message'`     | Send message                 |
| `electric agents observe /type/id`            | Stream entity events         |
| `electric agents inspect /type/id`            | Show entity state            |
| `electric agents ps [--type --status --parent]` | List entities                |
| `electric agents kill /type/id`               | Delete entity                |
| `electric agents start`                       | Start local dev environment  |
| `electric agents start-builtin`               | Start built-in Horton runtime |
| `electric agents quickstart`                  | Start local server and built-ins |
| `electric agents stop`                        | Stop local dev environment   |
| `electric agents init [project-name]`          | Scaffold a starter app       |

See [CLI reference](/docs/agents/reference/cli).

## 10. App setup

```ts
const registry = createEntityRegistry()
registerMyEntity(registry)

const runtime = createRuntimeHandler({
  baseUrl: ELECTRIC_AGENTS_URL, // Electric Agents server
  serveEndpoint: `${URL}/webhook`, // callback URL
  registry,
})

// Node HTTP server, forward POST /webhook -> runtime.onEnter(req, res)
await runtime.registerTypes() // register all types with runtime server
```

See [App setup](/docs/agents/usage/app-setup) and [RuntimeHandler reference](/docs/agents/reference/runtime-handler).

## 11. App clients and embedded built-ins

Use the client and embedding APIs when you need to work with agents outside an entity handler:

| API                               | Use case                                      |
| --------------------------------- | --------------------------------------------- |
| `createAgentsClient()`            | Observe entity, membership, or shared-state streams from app code |
| `useChat()`                       | Render an observed `EntityStreamDB` in React  |
| `createRuntimeServerClient()`     | Spawn, message, delete, tag, and schedule entities from services |
| `BuiltinAgentsServer`             | Host Horton and worker in your own process |

See [Clients & React](/docs/agents/usage/clients-and-react), [Programmatic runtime client](/docs/agents/usage/programmatic-runtime-client), and [Embedded built-ins](/docs/agents/usage/embedded-builtins).
