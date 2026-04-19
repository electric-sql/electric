---
title: HandlerContext
titleTemplate: "... - Electric Agents"
description: >-
  API reference for HandlerContext: state, coordination, agent configuration, and execution control.
outline: [2, 3]
---

# HandlerContext

The handler context is passed as the first argument to every entity handler. It provides access to state, coordination primitives, and agent configuration.

**Source:** `@durable-streams/darix-runtime`

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
  configureAgent(config: AgentConfig): AgentHandle
  agent: AgentHandle
  spawn(
    type: string,
    id: string,
    args?: Record<string, unknown>,
    opts?: { initialMessage?: unknown; wake?: Wake }
  ): Promise<EntityHandle>
  observe(entityUrl: string, opts?: { wake?: Wake }): Promise<EntityHandle>
  createSharedState<T extends SharedStateSchemaMap>(
    id: string,
    schema: T
  ): SharedStateHandle<T>
  connectSharedState<T extends SharedStateSchemaMap>(
    id: string,
    schema: T,
    opts?: { wake?: Wake }
  ): SharedStateHandle<T>
  send(entityUrl: string, payload: unknown, opts?: { type?: string }): void
  sleep(): void
}
```

## Properties

| Property     | Type                                              | Description                                                                                                   |
| ------------ | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `firstWake`  | `boolean`                                         | `true` on the entity's first-ever handler invocation.                                                         |
| `entityUrl`  | `string`                                          | URL path of this entity (e.g. `"/chat/my-convo"`).                                                            |
| `entityType` | `string`                                          | Registered type name (e.g. `"chat"`).                                                                         |
| `args`       | `Readonly<Record<string, unknown>>`               | Spawn arguments passed when the entity was created.                                                           |
| `db`         | `EntityStreamDBWithActions`                       | The entity's TanStack DB instance with registered actions.                                                    |
| `state`      | `TState`                                          | Proxy object keyed by collection name. Each property is a [`StateCollectionProxy`](./state-collection-proxy). |
| `actions`    | `Record<string, (...args: unknown[]) => unknown>` | Auto-generated CRUD actions for custom state collections.                                                     |
| `darixTools` | `AgentTool[]`                                     | Built-in tools (e.g. `send_message`) to spread into agent config.                                             |

## Methods

| Method                                  | Return Type               | Description                                                                                        |
| --------------------------------------- | ------------------------- | -------------------------------------------------------------------------------------------------- |
| `configureAgent(config)`                | `AgentHandle`             | Configure the LLM agent. Must be called before `agent.run()`. See [`AgentConfig`](./agent-config). |
| `agent.run()`                           | `Promise<AgentRunResult>` | Run the configured agent loop.                                                                     |
| `spawn(type, id, args?, opts?)`         | `Promise<EntityHandle>`   | Spawn a child entity. See [`EntityHandle`](./entity-handle).                                       |
| `observe(entityUrl, opts?)`             | `Promise<EntityHandle>`   | Observe another entity's stream.                                                                   |
| `createSharedState(id, schema)`         | `SharedStateHandle<T>`    | Create a new shared state stream. See [`SharedStateHandle`](./shared-state-handle).                |
| `connectSharedState(id, schema, opts?)` | `SharedStateHandle<T>`    | Connect to an existing shared state stream.                                                        |
| `send(entityUrl, payload, opts?)`       | `void`                    | Send a message to another entity.                                                                  |
| `sleep()`                               | `void`                    | End the handler without running an agent. The entity remains idle until the next wake.             |
