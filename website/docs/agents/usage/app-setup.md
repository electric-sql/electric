---
title: App setup
titleTemplate: "... - Electric Agents"
description: >-
  Connect your app to the Electric Agents runtime with createRuntimeHandler, webhooks, and type registration.
outline: [2, 3]
---

# App setup

The runtime handler connects your app's entity definitions to the Electric Agents runtime server via webhooks.

## createRuntimeHandler

Creates a runtime with a Node HTTP adapter:

```ts
import {
  createEntityRegistry,
  createRuntimeHandler,
} from "@electric-ax/agents-runtime"

const registry = createEntityRegistry()
// ... register entity types ...

const runtime = createRuntimeHandler({
  baseUrl: "http://localhost:4437",
  serveEndpoint: "http://localhost:3000/webhook",
  registry,
})
```

## Configuration

```ts
interface RuntimeRouterConfig {
  baseUrl: string // Electric Agents server URL
  serveEndpoint?: string // Webhook callback URL
  webhookPath?: string // Path to match (default: derived from serveEndpoint)
  handlerUrl?: string // legacy alias for serveEndpoint
  registry?: EntityRegistry
  subscriptionPathForType?: (typeName: string) => string
  defaultDispatchPolicyForType?: (typeName: string) => DispatchPolicy | undefined
  serverHeaders?: HeadersProvider
  webhookSignature?: false | Partial<WebhookSignatureVerifierConfig>
  idleTimeout?: number // ms before closing idle wake (default: 20000)
  heartbeatInterval?: number // ms between heartbeats (default: 10000)
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
      messageType?: string
    }): Promise<{ txid: string }>
    deleteSchedule(opts: { id: string }): Promise<{ txid: string }>
    listWebhookSources(): Promise<Array<WebhookSourceContract>>
    subscribeToWebhookSource(
      opts: WebhookSourceSubscriptionInput
    ): Promise<{ txid: string; subscription: WebhookSourceSubscription }>
    unsubscribeFromWebhookSource(opts: { id: string }): Promise<{ txid: string }>
  }) => AgentTool[] | Promise<AgentTool[]> // factory for extra agent tools
  onWakeError?: (error: Error) => boolean | void // return true to mark handled
  registrationConcurrency?: number // max concurrent type registrations (default: 8)
  sandboxProfiles?: ReadonlyArray<SandboxProfile>
  publicUrl?: string
  name?: string
}
```

Key fields:

| Field                          | Description                                                                                                      |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `serveEndpoint`                | Public webhook callback URL. When present, type registration includes webhook dispatch unless a default dispatch policy overrides it. |
| `serverHeaders`                | Headers sent on control-plane requests to the agents server, including type registration and wake claims.        |
| `webhookSignature`             | Webhook signature verification config. Enabled by default against `${baseUrl}/__ds/jwks.json`; set to `false` only for trusted in-process tests. |
| `defaultDispatchPolicyForType` | Override the default dispatch policy registered per entity type. Use this for pull-wake runner targets.          |
| `sandboxProfiles`              | Named sandbox profiles advertised by this runtime. Spawn requests can select one by profile name.                |
| `publicUrl`                    | Public URL for this runtime, surfaced by server runtime metadata APIs when available.                            |
| `name`                         | Human-readable runtime name. Defaults to `"default"`.                                                           |

## HTTP server

Your app needs an HTTP server to receive webhook callbacks from the Electric Agents runtime server. Forward webhook POSTs to the runtime handler:

```ts
import http from "node:http"

const server = http.createServer(async (req, res) => {
  if (req.url === "/webhook" && req.method === "POST") {
    await runtime.onEnter(req, res)
    return
  }
  res.writeHead(404)
  res.end()
})

server.listen(PORT, async () => {
  await runtime.registerTypes()
  console.log(`${runtime.typeNames.length} types registered`)
})
```

## registerTypes

Registers all entity types with the Electric Agents runtime server and creates webhook subscriptions. Uses upsert semantics — re-registering an existing type updates it rather than erroring.

Must be called after your app starts listening.

```ts
await runtime.registerTypes()
```

This sends `POST /_electric/entity-types` for each entity type. The request includes the type definition, state schemas, permission grants, optional `serve_endpoint`, and optional default dispatch policy. When `serveEndpoint` is set and no custom default dispatch policy is provided, registration uses webhook dispatch to that endpoint.

## RuntimeHandler

```ts
interface RuntimeHandler {
  onEnter(req: IncomingMessage, res: ServerResponse): Promise<void>
  handleRequest(request: Request): Promise<Response | null>
  handleWebhookRequest(request: Request): Promise<Response>
  dispatchWake(
    notification: WakeNotification,
    options?: Pick<ProcessWakeConfig, "claimHeaders" | "claimTokenHeader">
  ): void
  dispatchWebhookWake(notification: WebhookNotification): void
  drainWakes(): Promise<void>
  waitForSettled(): Promise<void>
  abortWakes(): void
  debugState(): RuntimeDebugState
  readonly typeNames: string[]
  readonly sandboxProfileDescriptors: Array<{
    name: string
    label: string
    description?: string
    remote?: boolean
  }>
  registerTypes(): Promise<void>
}

interface RuntimeDebugState {
  pendingWakeCount: number
  pendingWakeLabels: string[]
  wakeErrorCount: number
  typeNames: string[]
}
```

| Method                 | Description                                                                        |
| ---------------------- | ---------------------------------------------------------------------------------- |
| `onEnter`              | Node HTTP adapter — reads the request body and delegates to `handleWebhookRequest` |
| `handleRequest`        | Fetch-native router — returns `null` if the path does not match `webhookPath`      |
| `handleWebhookRequest` | Processes a webhook POST directly, without path matching                           |
| `dispatchWake`         | Dispatches a pre-parsed wake notification from any transport                       |
| `dispatchWebhookWake`  | Dispatches a pre-parsed notification (fire-and-forget)                             |
| `drainWakes`           | Waits for all in-flight wake handlers to settle; throws on errors                  |
| `waitForSettled`       | Waits for all in-flight wakes; throws on errors                                    |
| `abortWakes`           | Cancels all in-flight wake handlers immediately                                    |
| `debugState`           | Returns a snapshot of internal runtime state for diagnostics                       |
| `sandboxProfileDescriptors` | Sandbox profile descriptors advertised by this runtime                     |
| `registerTypes`        | Registers entity types, schemas, permission grants, and default dispatch policy with the Electric Agents runtime server |

## createRuntimeRouter

Fetch-native alternative with no Node HTTP dependency:

```ts
import { createRuntimeRouter } from "@electric-ax/agents-runtime"

const router = createRuntimeRouter(config)
const response = await router.handleRequest(request)
```

Use this when integrating with non-Node frameworks or edge runtimes.

## Environment variables

| Variable            | Default                 | Purpose                  |
| ------------------- | ----------------------- | ------------------------ |
| `ELECTRIC_AGENTS_URL`         | `http://localhost:4437` | Electric Agents runtime server URL |
| `PORT`              | `3000`                  | Your app's HTTP port     |
| `ANTHROPIC_API_KEY` | —                       | Claude API key           |
