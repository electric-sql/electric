---
title: HandlerContext
titleTemplate: "... - Electric Agents"
description: >-
  API reference for HandlerContext: state, coordination, agent configuration, and execution control.
outline: [2, 3]
---

# HandlerContext

The handler context is passed as the first argument to every entity handler. It provides access to state, coordination primitives, and agent configuration.

**Source:** `@electric-ax/agents-runtime`

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
  useAgent(config: AgentConfig): AgentHandle
  useContext(config: UseContextConfig): void
  timelineMessages(opts?: TimelineProjectionOpts): Array<TimestampedMessage>
  insertContext(id: string, entry: ContextEntryInput): void
  removeContext(id: string): void
  getContext(id: string): ContextEntry | undefined
  listContext(): Array<ContextEntry>
  agent: AgentHandle
  spawn(
    type: string,
    id: string,
    args?: Record<string, unknown>,
    opts?: {
      initialMessage?: unknown
      wake?: Wake
      tags?: Record<string, string>
      observe?: boolean
    }
  ): Promise<EntityHandle>
  observe(
    source: ObservationSource & { sourceType: "entity" },
    opts?: { wake?: Wake }
  ): Promise<EntityHandle>
  observe(
    source: ObservationSource & { sourceType: "db" },
    opts?: { wake?: Wake }
  ): Promise<SharedStateHandle & ObservationHandle>
  observe(
    source: ObservationSource,
    opts?: { wake?: Wake }
  ): Promise<ObservationHandle>
  mkdb<T extends SharedStateSchemaMap>(
    id: string,
    schema: T
  ): SharedStateHandle<T>
  send(
    entityUrl: string,
    payload: unknown,
    opts?: { type?: string; afterMs?: number }
  ): void
  recordRun(): RunHandle
  setTag(key: string, value: string): Promise<void>
  removeTag(key: string): Promise<void>
  sleep(): void
}
```

> **Tip:** Use the helper functions `entity()`, `cron()`, `entities()`, and `db()` from `@electric-ax/agents-runtime` to construct `ObservationSource` values for `observe()`.

## Properties

| Property     | Type                                              | Description                                                                                                   |
| ------------ | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `firstWake`  | `boolean`                                         | `true` during the initial setup pass while the entity has no persisted manifest entries. Use state checks for one-time plain state initialization. |
| `tags`       | `Readonly<EntityTags>`                            | Entity tags — key/value metadata associated with this entity.                                                 |
| `entityUrl`  | `string`                                          | URL path of this entity (e.g. `"/chat/my-convo"`).                                                            |
| `entityType` | `string`                                          | Registered type name (e.g. `"chat"`).                                                                         |
| `args`       | `Readonly<Record<string, unknown>>`               | Spawn arguments passed when the entity was created.                                                           |
| `db`         | `EntityStreamDBWithActions`                       | The entity's TanStack DB instance with registered actions.                                                    |
| `state`      | `TState`                                          | Proxy object keyed by collection name. Each property is a [`StateCollectionProxy`](./state-collection-proxy). |
| `events`     | `Array<ChangeEvent>`                              | Change events that triggered this wake.                                                                       |
| `actions`    | `Record<string, (...args: unknown[]) => unknown>` | Custom non-CRUD actions from the entity definition's `actions` factory. Auto-generated CRUD actions live on `ctx.db.actions` and `ctx.state`. |
| `electricTools` | `AgentTool[]`                                     | Host-provided runtime-level tools to spread into agent config when needed. May be empty.                     |

## Methods

| Method                            | Return Type                                                       | Description                                                                                                                                                                                                                                |
| --------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `useAgent(config)`                | `AgentHandle`                                                     | Configure the LLM agent. Must be called before `agent.run()`. See [`AgentConfig`](./agent-config).                                                                                                                                         |
| `useContext(config)`              | `void`                                                            | Declare context sources with token budgets and cache tiers for the agent's context window. See [Context composition](/docs/agents/usage/context-composition).                                                                                     |
| `timelineMessages(opts?)`         | `Array<TimestampedMessage>`                                       | Project the entity timeline into an ordered array of LLM messages. Typically used as the `content` function of a volatile source. See [Context composition](/docs/agents/usage/context-composition#timelinemessages).                             |
| `insertContext(id, entry)`        | `void`                                                            | Insert a durable context entry. Persists across wakes. Inserting with an existing `id` replaces the previous entry. See [Context entries](/docs/agents/usage/context-composition#context-entries).                                                |
| `removeContext(id)`               | `void`                                                            | Remove a context entry by id.                                                                                                                                                                                                              |
| `getContext(id)`                  | `ContextEntry \| undefined`                                       | Get a context entry by id, or `undefined` if not found.                                                                                                                                                                                    |
| `listContext()`                   | `Array<ContextEntry>`                                             | List all context entries.                                                                                                                                                                                                                  |
| `agent.run(input?)`               | `Promise<AgentRunResult>`                                         | Run the configured agent loop. Optional `input` string is appended as a user message before the loop starts.                                                                                                                               |
| `spawn(type, id, args?, opts?)`   | `Promise<EntityHandle>`                                           | Spawn a child entity. `opts` accepts `tags`, `observe`, `initialMessage`, and `wake`. See [`EntityHandle`](./entity-handle).                                                                                                               |
| `observe(source, opts?)`          | `Promise<EntityHandle \| SharedStateHandle \| ObservationHandle>` | Observe a source. Return type depends on source type: `EntityHandle` for entities, `SharedStateHandle & ObservationHandle` for db, `ObservationHandle` otherwise. Use `entity()`, `cron()`, `entities()`, `db()` helpers to build sources. |
| `mkdb(id, schema)`                | `SharedStateHandle<T>`                                            | Create a new shared state stream. See [`SharedStateHandle`](./shared-state-handle).                                                                                                                                                        |
| `send(entityUrl, payload, opts?)` | `void`                                                            | Send a message to another entity. `opts` accepts `type` and `afterMs` (delay in milliseconds).                                                                                                                                             |
| `recordRun()`                     | `RunHandle`                                                       | Record a non-LLM run in the built-in `runs` collection, so observers using `wake: "runFinished"` are notified when external work completes.                                                                                               |
| `setTag(key, value)`              | `Promise<void>`                                                   | Set a tag on this entity.                                                                                                                                                                                                                  |
| `removeTag(key)`                  | `Promise<void>`                                                   | Remove a tag from this entity.                                                                                                                                                                                                             |
| `sleep()`                         | `void`                                                            | End the handler without running an agent. The entity remains idle until the next wake.                                                                                                                                                     |

## RunHandle

`recordRun()` is for handlers that perform work outside `ctx.agent.run()` but still want to expose run lifecycle events.

```ts
interface RunHandle {
  readonly key: string
  end(opts: { status: "completed" | "failed"; finishReason?: string }): void
  attachResponse(text: string): void
}
```

`attachResponse()` appends text deltas linked to the run, which can be included in `runFinished` wake payloads.
