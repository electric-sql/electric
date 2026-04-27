---
title: RuntimeHandler
titleTemplate: "... - Electric Agents"
description: >-
  API reference for RuntimeHandler: webhook handling, type registration, and deployment configuration.
outline: [2, 3]
---

# RuntimeHandler

Factory functions that create the runtime request router and Node HTTP adapter. The router handles webhook wake delivery from the Electric Agents runtime server and registers entity types on startup.

**Source:** `@electric-ax/agents-runtime`

## RuntimeRouter

```ts
interface RuntimeRouter {
  handleRequest(request: Request): Promise<Response | null>
  handleWebhookRequest(request: Request): Promise<Response>
  dispatchWebhookWake(notification: WebhookNotification): void
  drainWakes(): Promise<void>
  waitForSettled(): Promise<void>
  abortWakes(): void
  debugState(): RuntimeDebugState
  readonly typeNames: string[]
  registerTypes(): Promise<void>
}
```

| Method                              | Return Type                 | Description                                                                                             |
| ----------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------- |
| `handleRequest(request)`            | `Promise<Response \| null>` | Route a fetch `Request`. Returns `null` if the request path does not match `webhookPath`.               |
| `handleWebhookRequest(request)`     | `Promise<Response>`         | Handle a webhook request directly, without route matching.                                              |
| `dispatchWebhookWake(notification)` | `void`                      | Dispatch an already-parsed webhook notification. Runs the wake handler in the background.               |
| `drainWakes()`                      | `Promise<void>`             | Wait for all in-flight wake handlers to settle. Throws if any wake errored.                             |
| `waitForSettled()`                  | `Promise<void>`             | Alias for `drainWakes()`. Intended for callers that care about runtime quiescence.                      |
| `abortWakes()`                      | `void`                      | Abort in-flight wakes so host shutdown can complete quickly.                                            |
| `debugState()`                      | `RuntimeDebugState`         | Return a runtime-local snapshot for tests and shutdown diagnostics.                                     |
| `typeNames`                         | `string[]`                  | Names of all registered entity types (read-only).                                                       |
| `registerTypes()`                   | `Promise<void>`             | Register all entity types with the Electric Agents runtime server. Uses upsert semantics — safe to call on every startup. |

## RuntimeHandler

Extends `RuntimeRouter` with a Node HTTP compatibility adapter.

```ts
interface RuntimeHandler extends RuntimeRouter {
  onEnter(req: IncomingMessage, res: ServerResponse): Promise<void>
}
```

| Method              | Parameters                               | Description                                                                                           |
| ------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `onEnter(req, res)` | Node `IncomingMessage`, `ServerResponse` | Node HTTP adapter. Converts the request to a fetch `Request` and delegates to `handleWebhookRequest`. |

## RuntimeDebugState

```ts
interface RuntimeDebugState {
  pendingWakeCount: number
  pendingWakeLabels: string[]
  wakeErrorCount: number
  typeNames: string[]
}
```

| Field               | Type       | Description                                             |
| ------------------- | ---------- | ------------------------------------------------------- |
| `pendingWakeCount`  | `number`   | Number of in-flight wake handlers.                      |
| `pendingWakeLabels` | `string[]` | Labels identifying each pending wake (for diagnostics). |
| `wakeErrorCount`    | `number`   | Number of wake handlers that have errored.              |
| `typeNames`         | `string[]` | Names of all registered entity types.                   |

## Factory functions

```ts
function createRuntimeRouter(config: RuntimeRouterConfig): RuntimeRouter

function createRuntimeHandler(config: RuntimeHandlerConfig): RuntimeHandler
```

`RuntimeHandlerConfig` is an alias for `RuntimeRouterConfig`.

## RuntimeRouterConfig

```ts
interface RuntimeRouterConfig {
  baseUrl: string
  serveEndpoint?: string
  webhookPath?: string
  handlerUrl?: string
  registry?: EntityRegistry
  subscriptionPathForType?: (typeName: string) => string
  idleTimeout?: number
  heartbeatInterval?: number
  createElectricTools?: (context: {
    entityUrl: string
    entityType: string
    args: Readonly<Record<string, unknown>>
    db: EntityStreamDBWithActions
    events: Array<ChangeEvent>
    upsertCronSchedule(opts: {
      id: string
      expression: string
      timezone?: string
      payload?: unknown
      debounceMs?: number
      timeoutMs?: number
    }): Promise<{ txid: string }>
    upsertFutureSendSchedule(opts: {
      id: string
      payload: unknown
      targetUrl?: string
      fireAt: string
      from?: string
      messageType?: string
    }): Promise<{ txid: string }>
    deleteSchedule(opts: { id: string }): Promise<{ txid: string }>
  }) => AgentTool[] | Promise<AgentTool[]>
  onWakeError?: (error: Error) => boolean | void
  registrationConcurrency?: number
}
```

| Field                     | Type                                                          | Default                                      | Description                                                                                                       |
| ------------------------- | ------------------------------------------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `baseUrl`                 | `string`                                                      | -                                            | Base URL of the Electric Agents runtime server (e.g. `"http://localhost:4437"`). Required.                                          |
| `serveEndpoint`           | `string`                                                      | -                                            | Full webhook callback URL exposed by your app. Used for type registration.                                        |
| `webhookPath`             | `string`                                                      | pathname from `serveEndpoint`, or `"/electric-agents"` | Path matched by `handleRequest()`.                                                                                |
| `handlerUrl`              | `string`                                                      | -                                            | Deprecated alias for `serveEndpoint`.                                                                             |
| `registry`                | `EntityRegistry`                                              | default registry                             | Entity registry for this handler. Falls back to the module-level default registry.                                |
| `subscriptionPathForType` | `(typeName: string) => string`                                | -                                            | Override the webhook subscription path used per entity type registration.                                         |
| `idleTimeout`             | `number`                                                      | `20000`                                      | Idle timeout in milliseconds before closing a wake.                                                               |
| `heartbeatInterval`       | `number`                                                      | `30000`                                      | Heartbeat interval in milliseconds.                                                                               |
| `createElectricTools`     | `(context) => AgentTool[] \| Promise<...>`                    | -                                            | Optional tool factory invoked for each wake context before handler execution. Provides extra tools to the agent.  |
| `onWakeError`             | `(error: Error) => boolean \| void`                           | -                                            | Observer for background wake failures. Return `true` to mark the error as handled so it is not rethrown on drain. |
| `registrationConcurrency` | `number`                                                      | `8`                                          | Max number of concurrent entity-type registrations.                                                               |
