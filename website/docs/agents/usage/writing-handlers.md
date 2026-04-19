---
title: Writing handlers
titleTemplate: "... - Electric Agents"
description: >-
  Implement entity handlers using HandlerContext and WakeEvent, with patterns for first wake, messaging, and tool use.
outline: [2, 3]
---

# Writing handlers

The handler is the function that runs each time an entity wakes. It receives a `HandlerContext` and a `WakeEvent` describing what triggered the invocation.

## Signature

```ts
handler(ctx: HandlerContext, wake: WakeEvent) => void | Promise<void>
```

## HandlerContext

```ts
interface HandlerContext<TState extends StateProxy = StateProxy> {
  firstWake: boolean
  entityUrl: string
  entityType: string
  args: Readonly<Record<string, unknown>>
  db: EntityStreamDBWithActions
  state: TState
  actions: Record<string, (...args: unknown[]) => unknown>
  darixTools: AgentTool[]
  configureAgent: (config: AgentConfig) => AgentHandle
  agent: AgentHandle
  spawn: (
    type: string,
    id: string,
    args?: Record<string, unknown>,
    opts?: { initialMessage?: unknown; wake?: Wake }
  ) => Promise<EntityHandle>
  observe: (entityUrl: string, opts?: { wake?: Wake }) => Promise<EntityHandle>
  createSharedState: <T extends SharedStateSchemaMap>(
    id: string,
    schema: T
  ) => SharedStateHandle<T>
  connectSharedState: <T extends SharedStateSchemaMap>(
    id: string,
    schema: T,
    opts?: { wake?: Wake }
  ) => SharedStateHandle<T>
  send: (entityUrl: string, payload: unknown, opts?: { type?: string }) => void
  sleep: () => void
}
```

### Property reference

| Property             | Description                                                                                             |
| -------------------- | ------------------------------------------------------------------------------------------------------- |
| `firstWake`          | `true` on the entity's first activation ever. Use for initialization.                                   |
| `entityUrl`          | The entity's URL path, e.g. `"/assistant/my-chat"`.                                                     |
| `entityType`         | The registered type name, e.g. `"assistant"`.                                                           |
| `args`               | Arguments passed when the entity was spawned. Immutable.                                                |
| `db`                 | Direct access to the entity's stream database.                                                          |
| `state`              | Proxy object for custom state collections. See [Defining entities](./defining-entities).                |
| `actions`            | Named action functions from the entity definition's `actions` factory.                                  |
| `darixTools`         | Built-in tools for spawning, observing, sending, and managing entities. Pass to `configureAgent`.       |
| `configureAgent`     | Configures the LLM agent. Returns an `AgentHandle`.                                                     |
| `agent`              | The configured agent handle. Call `agent.run()` to start the agent loop.                                |
| `spawn`              | Creates a child entity. See [Spawning and coordinating](./spawning-and-coordinating).                   |
| `observe`            | Connects to another entity's stream. See [Reactive observers](../entities/patterns/reactive-observers). |
| `createSharedState`  | Creates a new shared state stream. See [Shared state](./shared-state).                                  |
| `connectSharedState` | Connects to an existing shared state stream. See [Shared state](./shared-state).                        |
| `send`               | Sends a message to another entity's inbox.                                                              |
| `sleep`              | Returns the entity to idle without re-waking.                                                           |

## WakeEvent

Describes what triggered this handler invocation.

```ts
type WakeEvent = {
  source: string
  type: string
  fromOffset: number
  toOffset: number
  eventCount: number
  payload?: unknown
  summary?: string
  fullRef?: string
}
```

| Field        | Description                                                    |
| ------------ | -------------------------------------------------------------- |
| `source`     | The stream or entity that caused the wake.                     |
| `type`       | The wake type (e.g. `"message"`, `"runFinished"`, `"change"`). |
| `fromOffset` | Start offset of the events that triggered this wake.           |
| `toOffset`   | End offset of the events that triggered this wake.             |
| `eventCount` | Number of new events since last wake.                          |
| `payload`    | Optional payload from the trigger event.                       |
| `summary`    | Optional human-readable summary.                               |
| `fullRef`    | Optional full reference string for the trigger.                |

## Typical handler pattern

Most handlers follow the same structure: initialize state on first wake, configure the agent, run the agent.

```ts
registry.define("assistant", {
  description: "A general-purpose assistant",
  state: {
    status: { primaryKey: "key" },
  },

  async handler(ctx) {
    if (ctx.firstWake) {
      ctx.state.status.insert({ key: "current", value: "idle" })
    }

    ctx.configureAgent({
      systemPrompt: "You are a helpful assistant.",
      model: "claude-sonnet-4-5-20250929",
      tools: [...ctx.darixTools],
    })
    await ctx.agent.run()
  },
})
```

## AgentConfig

Passed to `ctx.configureAgent()`:

```ts
interface AgentConfig {
  systemPrompt: string
  model: string
  tools: AgentTool[]
  streamFn?: StreamFn
  testResponses?: string[] | TestResponseFn
}
```

## firstWake

`ctx.firstWake` is `true` only on the entity's very first activation. Use it for one-time initialization:

```ts
async handler(ctx) {
  if (ctx.firstWake) {
    ctx.state.status.insert({ key: 'current', value: 'idle' })
    ctx.state.counters.insert({ key: 'runs', value: 0 })
  }
  // ...
}
```

On subsequent wakes (new messages, child completion, etc.), `firstWake` is `false`.

## sleep

Call `ctx.sleep()` to return the entity to idle without triggering a re-wake. The handler exits and the entity waits for the next external event.

```ts
async handler(ctx, wake) {
  if (wake.type === 'some-condition') {
    // Nothing to do right now
    ctx.sleep()
    return
  }
  // Otherwise, run the agent
  ctx.configureAgent({ ... })
  await ctx.agent.run()
}
```

## Using spawn args

Arguments passed at spawn time are available as `ctx.args`. This is how you parameterize entity behavior:

```ts
// Spawning side
const child = await ctx.spawn('worker', 'analysis-1', {
  systemPrompt: 'You are an analyst.',
})

// Worker handler
async handler(ctx) {
  const { systemPrompt } = ctx.args as { systemPrompt: string }
  ctx.configureAgent({
    systemPrompt,
    model: 'claude-sonnet-4-5-20250929',
    tools: [...ctx.darixTools],
  })
  await ctx.agent.run()
}
```

## Adding custom tools

Combine `ctx.darixTools` with custom tools:

```ts
async handler(ctx) {
  const myTool: AgentTool = {
    name: 'lookup',
    label: 'Lookup',
    description: 'Looks up a value by key',
    parameters: Type.Object({
      key: Type.String({ description: 'The key to look up' }),
    }),
    execute: async (_toolCallId, params) => {
      const { key } = params as { key: string }
      const row = ctx.state.kv.get(key)
      return {
        content: [{ type: 'text', text: row ? JSON.stringify(row) : 'Not found' }],
        details: {},
      }
    },
  }

  ctx.configureAgent({
    systemPrompt: 'You are an assistant with lookup capabilities.',
    model: 'claude-sonnet-4-5-20250929',
    tools: [...ctx.darixTools, myTool],
  })
  await ctx.agent.run()
}
```

## Sending messages

Use `ctx.send()` to deliver a message to another entity's inbox:

```ts
ctx.send("/worker/task-1", { action: "process", data: payload })
ctx.send("/worker/task-1", payload, { type: "custom_type" })
```

The target entity will be woken to process the message.
