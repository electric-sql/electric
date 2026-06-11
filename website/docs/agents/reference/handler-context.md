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
  wake: HandlerWake
  slashCommands: SlashCommandHelpers
  tags: Readonly<EntityTags>
  principal?: RuntimePrincipal
  entityUrl: string
  entityType: string
  args: Readonly<Record<string, unknown>>
  db: EntityStreamDBWithActions
  self: SelfHandle
  state: TState
  events: Array<ChangeEvent>
  actions: Record<string, (...args: unknown[]) => unknown>
  electricTools: AgentTool[]
  signal: AbortSignal
  sandbox: Sandbox
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
      initialMessageType?: string
      wake?: Wake
      tags?: Record<string, string>
      observe?: boolean
      sandbox?: SpawnSandboxOption
    }
  ): Promise<EntityHandle>
  fork(
    sourceEntityUrl: string,
    id: string,
    opts?: ForkOptions
  ): Promise<EntityHandle>
  forkSelf(id: string, opts?: ForkOptions): Promise<EntityHandle>
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
  ): Promise<SendResult>
  attachments: AttachmentsApi
  createEffect(functionRef: string, key: string, config: JsonValue): boolean
  onSignal(
    handler: (signal: {
      signal: EntitySignal
      reason?: string
      payload?: unknown
    }) => void | Promise<void>
  ): void
  recordRun(): RunHandle
  setTag(key: string, value: string): Promise<void>
  deleteTag(key: string): Promise<void>
  sleep(): void
}
```

> **Tip:** Use the helper functions `entity()`, `cron()`, `entities()`, `db()`, `webhook()`, and `pgSync()` from `@electric-ax/agents-runtime` to construct `ObservationSource` values for `observe()`.

## Properties

| Property     | Type                                              | Description                                                                                                   |
| ------------ | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `firstWake`  | `boolean`                                         | `true` during the initial setup pass while the entity has no persisted manifest entries. Use state checks for one-time plain state initialization. |
| `wake`       | `HandlerWake`                                     | Current wake projected into the handler context. Equivalent to the second handler argument.                    |
| `slashCommands` | `SlashCommandHelpers`                         | Read and manage slash-command definitions exposed to structured composer inputs.                              |
| `tags`       | `Readonly<EntityTags>`                            | Entity tags — key/value metadata associated with this entity.                                                 |
| `principal`  | `RuntimePrincipal \| undefined`                   | Principal that caused the current wake, when the server supplied one.                                         |
| `entityUrl`  | `string`                                          | URL path of this entity (e.g. `"/chat/my-convo"`).                                                            |
| `entityType` | `string`                                          | Registered type name (e.g. `"chat"`).                                                                         |
| `args`       | `Readonly<Record<string, unknown>>`               | Spawn arguments passed when the entity was created.                                                           |
| `db`         | `EntityStreamDBWithActions`                       | The entity's TanStack DB instance with registered actions.                                                    |
| `self`       | `SelfHandle`                                      | Handle for this entity. Use `ctx.self.send(payload)` to send to yourself without spelling the entity URL.     |
| `state`      | `TState`                                          | Proxy object keyed by collection name. Each property is a [`StateCollectionProxy`](./state-collection-proxy). |
| `events`     | `Array<ChangeEvent>`                              | Change events that triggered this wake.                                                                       |
| `actions`    | `Record<string, (...args: unknown[]) => unknown>` | Custom non-CRUD actions from the entity definition's `actions` factory. Auto-generated CRUD actions live on `ctx.db.actions` and `ctx.state`. |
| `electricTools` | `AgentTool[]`                                     | Host-provided runtime-level tools to spread into agent config when needed. May be empty.                     |
| `signal`     | `AbortSignal`                                     | Aborts when the current wake should stop early, such as during shutdown or `SIGINT`. Pass it to cancellable work. |
| `sandbox`    | `Sandbox`                                         | Active sandbox for this wake session. Runtime-provided tools use this for filesystem, process, and network access. |
| `attachments` | `AttachmentsApi`                                 | Read and create manifest-backed attachments for this entity.                                                  |

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
| `spawn(type, id, args?, opts?)`   | `Promise<EntityHandle>`                                           | Spawn a child entity. `opts` accepts `tags`, `observe`, `initialMessage`, `initialMessageType`, `wake`, and `sandbox`. See [`EntityHandle`](./entity-handle).                                                                                                    |
| `fork(sourceUrl, id, opts?)`      | `Promise<EntityHandle>`                                           | Fork another entity at its latest completed run. By default the fork becomes this entity's child and wakes this entity when the fork's next run finishes.                                                                                   |
| `forkSelf(id, opts?)`             | `Promise<EntityHandle>`                                           | Convenience wrapper for `ctx.fork(ctx.entityUrl, id, opts)`.                                                                                                                                                                               |
| `observe(source, opts?)`          | `Promise<EntityHandle \| SharedStateHandle \| ObservationHandle>` | Observe a source. Return type depends on source type: `EntityHandle` for entities, `SharedStateHandle & ObservationHandle` for db, `ObservationHandle` otherwise. Use `entity()`, `cron()`, `entities()`, `db()` helpers to build sources. |
| `mkdb(id, schema)`                | `SharedStateHandle<T>`                                            | Create a new shared state stream. See [`SharedStateHandle`](./shared-state-handle).                                                                                                                                                        |
| `send(entityUrl, payload, opts?)` | `Promise<SendResult>`                                             | Send a message to another entity. `opts` accepts `type` and `afterMs` (delay in milliseconds).                                                                                                                                             |
| `createEffect(ref, key, config)`  | `boolean`                                                         | Register an effect for the current entity definition. Returns whether the effect was newly created for this key.                                                                                                                           |
| `onSignal(handler)`               | `void`                                                            | Register a handler for lifecycle signals delivered during this wake. Runtime-controlled signals such as `SIGINT`, `SIGSTOP`, `SIGCONT`, and `SIGKILL` are handled by the runtime.                                                         |
| `recordRun()`                     | `RunHandle`                                                       | Record a non-LLM run in the built-in `runs` collection, so observers using `wake: { on: "runFinished", includeResponse: true }` are notified when external work completes.                                                                                               |
| `setTag(key, value)`              | `Promise<void>`                                                   | Set a tag on this entity.                                                                                                                                                                                                                  |
| `deleteTag(key)`                  | `Promise<void>`                                                   | Delete a tag from this entity.                                                                                                                                                                                                             |
| `sleep()`                         | `void`                                                            | End the handler without running an agent. The entity remains idle until the next wake.                                                                                                                                                     |

## Sandbox

`ctx.sandbox` is selected from the entity's sandbox profile at wake-session start. The runtime owns disposal; handlers should not call `sandbox.dispose()` directly. Use it when writing custom tools that need filesystem, subprocess, or network access so the behavior follows the active sandbox profile.

Spawned children can inherit or select a sandbox:

```ts
await ctx.spawn("worker", "analysis", args, {
  sandbox: "inherit",
  initialMessage: "Review the current workspace.",
})
```

## Forking

`ctx.fork(sourceEntityUrl, id, opts?)` creates a child fork of another entity at that source entity's latest completed run. `ctx.forkSelf(id, opts?)` forks the current entity. Options mirror spawn where the semantics map:

```ts
const fork = await ctx.forkSelf("variant-a", {
  initialMessage: { text: "Try a different approach." },
  tags: { branch: "variant-a" },
})
```

By default the fork is observed as this entity's child with a `runFinished` wake that includes the fork response. Pass `observe: false` for a fire-and-forget fork with no parent manifest entry, wake subscription, or reply path.

## Attachments

`ctx.attachments` exposes manifest-backed attachments associated with the entity. It is used by the runtime to hydrate image and file context and can also be used by custom handlers or tools that need to inspect uploaded files.

## Slash Commands

`ctx.slashCommands` exposes structured composer commands registered on the entity. Static commands come from the entity type; handlers can add or replace dynamic commands for UI composers that send `composer_input` messages:

```ts
ctx.slashCommands.register({
  name: "summarize",
  description: "Summarize the current session",
})
```

Use `ctx.wake` or the handler's `wake` argument to inspect incoming composer payloads.

## Lifecycle Signals

Use `ctx.signal` for cancellable work and `ctx.onSignal()` for handler-delivered lifecycle signals:

```ts
ctx.onSignal(async ({ signal, reason }) => {
  if (signal === "SIGTERM") {
    await cleanup(reason)
  }
})
```

`SIGINT` aborts the active handler invocation through `ctx.signal`. `SIGSTOP`, `SIGCONT`, and `SIGKILL` are runtime-controlled.

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
