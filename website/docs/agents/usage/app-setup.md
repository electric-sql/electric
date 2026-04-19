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
} from "@durable-streams/darix-runtime"

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
  baseUrl: string // Durable streams server URL
  serveEndpoint?: string // Webhook callback URL
  webhookPath?: string // Path to match (default: derived from serveEndpoint)
  registry?: EntityRegistry
  idleTimeout?: number // ms before closing idle wake (default: 20000)
  heartbeatInterval?: number // ms between heartbeats (default: 30000)
}
```

## HTTP server

Your app needs an HTTP server to receive webhook callbacks from the runtime server. Forward webhook POSTs to the runtime handler:

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

Registers all entity types with the runtime server and creates webhook subscriptions. Uses upsert semantics — re-registering an existing type updates it rather than erroring.

Must be called after your app starts listening.

```ts
await runtime.registerTypes()
```

This makes two requests per entity type:

1. `POST /_darix/entity-types` — registers the type definition and schemas.
2. `PUT /{type}/**?subscription={type}-handler` — creates a webhook subscription for the type.

## RuntimeHandler

```ts
interface RuntimeHandler {
  onEnter(req: IncomingMessage, res: ServerResponse): Promise<void>
  handleRequest(request: Request): Promise<Response | null>
  handleWebhookRequest(request: Request): Promise<Response>
  dispatchWebhookWake(notification: WebhookNotification): void
  drainWakes(): Promise<void>
  readonly typeNames: string[]
  registerTypes(): Promise<void>
}
```

| Method                 | Description                                                                        |
| ---------------------- | ---------------------------------------------------------------------------------- |
| `onEnter`              | Node HTTP adapter — reads the request body and delegates to `handleWebhookRequest` |
| `handleRequest`        | Fetch-native router — returns `null` if the path does not match `webhookPath`      |
| `handleWebhookRequest` | Processes a webhook POST directly, without path matching                           |
| `dispatchWebhookWake`  | Dispatches a pre-parsed notification (fire-and-forget)                             |
| `drainWakes`           | Waits for all in-flight wake handlers to settle; throws on errors                  |
| `registerTypes`        | Registers entity types and webhook subscriptions with the runtime server           |

## createRuntimeRouter

Fetch-native alternative with no Node HTTP dependency:

```ts
import { createRuntimeRouter } from "@durable-streams/darix-runtime"

const router = createRuntimeRouter(config)
const response = await router.handleRequest(request)
```

Use this when integrating with non-Node frameworks or edge runtimes.

## Environment variables

| Variable            | Default                 | Purpose              |
| ------------------- | ----------------------- | -------------------- |
| `DARIX_URL`         | `http://localhost:4437` | Runtime server URL   |
| `PORT`              | `3000`                  | Your app's HTTP port |
| `ANTHROPIC_API_KEY` | —                       | Claude API key       |
