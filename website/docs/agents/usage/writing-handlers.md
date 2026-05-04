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
  tags: Readonly<EntityTags>
  entityUrl: string
  entityType: string
  args: Readonly<Record<string, unknown>>
  db: EntityStreamDBWithActions
  state: TState
  events: Array<ChangeEvent>
  actions: Record<string, (...args: unknown[]) => unknown>
  electricTools: AgentTool[]
  useAgent: (config: AgentConfig) => AgentHandle
  useContext: (config: UseContextConfig) => void
  timelineMessages: (opts?: TimelineProjectionOpts) => Array<TimestampedMessage>
  insertContext: (id: string, entry: ContextEntryInput) => void
  removeContext: (id: string) => void
  getContext: (id: string) => ContextEntry | undefined
  listContext: () => Array<ContextEntry>
  agent: AgentHandle
  spawn: (
    type: string,
    id: string,
    args?: Record<string, unknown>,
    opts?: {
      initialMessage?: unknown
      wake?: Wake
      tags?: Record<string, string>
      observe?: boolean
    }
  ) => Promise<EntityHandle>
  observe: (
    source: ObservationSource,
    opts?: { wake?: Wake }
  ) => Promise<EntityHandle | SharedStateHandle | ObservationHandle>
  mkdb: <T extends SharedStateSchemaMap>(
    id: string,
    schema: T
  ) => SharedStateHandle<T>
  send: (
    entityUrl: string,
    payload: unknown,
    opts?: { type?: string; afterMs?: number }
  ) => void
  recordRun: () => RunHandle
  setTag: (key: string, value: string) => Promise<void>
  removeTag: (key: string) => Promise<void>
  sleep: () => void
}
```

### Property reference

| Property           | Description                                                                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `firstWake`        | `true` during the initial setup pass while the entity has no persisted manifest entries. Use state checks for one-time plain state initialization.       |
| `tags`             | Entity tags -- key/value metadata associated with this entity.                                                                                          |
| `entityUrl`        | The entity's URL path, e.g. `"/assistant/my-chat"`.                                                                                                     |
| `entityType`       | The registered type name, e.g. `"assistant"`.                                                                                                           |
| `args`             | Arguments passed when the entity was spawned. Immutable.                                                                                                |
| `db`               | The entity's stream database. Use `db.actions` for writes and `db.collections` for reads.                                                               |
| `state`            | Proxy object keyed by collection name. Each property is a [`StateCollectionProxy`](../reference/state-collection-proxy).                                |
| `events`           | Change events that triggered this wake.                                                                                                                 |
| `actions`          | Custom non-CRUD action functions from the entity definition's `actions` factory.                                                                        |
| `electricTools`       | Host-provided runtime-level tools to pass to `useAgent` when needed. May be empty.                                                                      |
| `useAgent`         | Configures the LLM agent. Returns an `AgentHandle`. See [Configuring the agent](./configuring-the-agent).                                               |
| `useContext`       | Declares context sources with token budgets and cache tiers. See [Context composition](./context-composition).                                          |
| `timelineMessages` | Projects the entity timeline into LLM messages. See [Context composition](./context-composition#timelinemessages).                                      |
| `insertContext`    | Inserts a durable context entry. See [Context composition](./context-composition#context-entries).                                                      |
| `removeContext`    | Removes a context entry by id.                                                                                                                          |
| `getContext`       | Gets a context entry by id, or `undefined` if not found.                                                                                                |
| `listContext`      | Lists all context entries.                                                                                                                              |
| `agent`            | The configured agent handle. Call `agent.run()` to start the agent loop.                                                                                |
| `spawn`            | Creates a child entity. See [Spawning and coordinating](./spawning-and-coordinating).                                                                   |
| `observe`          | Connects to another entity's stream or shared db. See [Reactive observers](../entities/patterns/reactive-observers) and [Shared state](./shared-state). |
| `mkdb`             | Creates a new shared state stream. See [Shared state](./shared-state).                                                                                  |
| `send`             | Sends a message to another entity's inbox. Supports delayed delivery via `afterMs`.                                                                     |
| `recordRun`        | Records non-LLM work in the built-in `runs` collection so `runFinished` observers are woken.                                                            |
| `setTag`           | Sets a tag on this entity.                                                                                                                              |
| `removeTag`        | Removes a tag from this entity.                                                                                                                         |
| `sleep`            | Returns the entity to idle without re-waking.                                                                                                           |

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
| `type`       | The wake type: `"message_received"` for inbox messages or `"wake"` for child completion, observed changes, cron, and timeouts. |
| `fromOffset` | Start offset of the events that triggered this wake.           |
| `toOffset`   | End offset of the events that triggered this wake.             |
| `eventCount` | Number of new events since last wake.                          |
| `payload`    | Optional payload from the trigger event.                       |
| `summary`    | Optional human-readable summary.                               |
| `fullRef`    | Optional full reference string for the trigger.                |

## Typical handler pattern

Most LLM handlers follow the same structure: initialize missing state idempotently, configure the agent, run the agent.

```ts
registry.define("assistant", {
  description: "A general-purpose assistant",
  state: {
    status: { primaryKey: "key" },
  },

  async handler(ctx) {
    if (!ctx.db.collections.status.get("current")) {
      ctx.db.actions.status_insert({ row: { key: "current", value: "idle" } })
    }

    ctx.useAgent({
      systemPrompt: "You are a helpful assistant.",
      model: "claude-sonnet-4-5-20250929",
      tools: [...ctx.electricTools],
    })
    await ctx.agent.run()
  },
})
```

## AgentConfig

Passed to `ctx.useAgent()`:

```ts
interface AgentConfig {
  systemPrompt: string
  model: string | Model<any>
  provider?: KnownProvider
  tools: AgentTool[]
  streamFn?: StreamFn
  getApiKey?: (provider: string) => Promise<string | undefined> | string | undefined
  onPayload?: SimpleStreamOptions["onPayload"]
  testResponses?: string[] | TestResponseFn
}
```

## firstWake and initialization

`ctx.firstWake` is `true` during the initial setup pass while the entity has no persisted manifest entries. It is useful for setup that creates manifest-backed resources such as `ctx.spawn()`, `ctx.observe()`, `ctx.mkdb()`, context entries, or schedules.

For plain state rows, prefer checking the collection itself so initialization stays idempotent even for entities that do not create manifest entries:

```ts
async handler(ctx) {
  if (!ctx.db.collections.status.get("current")) {
    ctx.db.actions.status_insert({ row: { key: 'current', value: 'idle' } })
  }
  if (!ctx.db.collections.counters.get("runs")) {
    ctx.db.actions.counters_insert({ row: { key: 'runs', value: 0 } })
  }
  // ...
}
```

After an entity persists manifest entries, subsequent wakes set `firstWake` to `false`.

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
  ctx.useAgent({ ... })
  await ctx.agent.run()
}
```

## recordRun

Call `ctx.recordRun()` when a handler does work without `ctx.agent.run()` but still needs to publish run lifecycle events. This is how non-LLM entities can wake parents observing them with `wake: "runFinished"`.

```ts
async handler(ctx) {
  const run = ctx.recordRun()
  try {
    const result = await runExternalJob()
    run.attachResponse(result.summary)
    run.end({ status: "completed" })
  } catch (error) {
    run.end({ status: "failed", finishReason: "error" })
    throw error
  }
}
```

## Using spawn args

Arguments passed at spawn time are available as `ctx.args`. This is how you parameterize entity behavior:

```ts
// Spawning side
const child = await ctx.spawn('worker', 'analysis-1', {
  systemPrompt: 'You are an analyst.',
  tools: ['read'],
})

// Worker handler
async handler(ctx) {
  const { systemPrompt } = ctx.args as { systemPrompt: string }
  ctx.useAgent({
    systemPrompt,
    model: 'claude-sonnet-4-5-20250929',
    tools: [...ctx.electricTools],
  })
  await ctx.agent.run()
}
```

## Adding custom tools

Combine `ctx.electricTools` with custom tools:

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
      const row = ctx.db.collections.kv?.get(key)
      return {
        content: [{ type: 'text', text: row ? JSON.stringify(row) : 'Not found' }],
        details: {},
      }
    },
  }

  ctx.useAgent({
    systemPrompt: 'You are an assistant with lookup capabilities.',
    model: 'claude-sonnet-4-5-20250929',
    tools: [...ctx.electricTools, myTool],
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
