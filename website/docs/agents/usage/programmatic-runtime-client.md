---
title: Programmatic runtime client
titleTemplate: "... - Electric Agents"
description: >-
  Use createRuntimeServerClient to spawn entities, send messages, register wakes,
  manage schedules, and connect shared state from application code.
outline: [2, 3]
---

# Programmatic runtime client

`createRuntimeServerClient()` is the lower-level HTTP client for the Electric Agents server. Handler code should usually use `ctx.spawn()`, `ctx.send()`, `ctx.observe()`, and `ctx.mkdb()` instead. Use this client from application services, tests, CLIs, and integration code that needs to manage entities from outside a handler.

```ts
import { createRuntimeServerClient } from "@electric-ax/agents-runtime"

const client = createRuntimeServerClient({
  baseUrl: "http://localhost:4437",
})
```

## Config

```ts
interface RuntimeServerClientConfig {
  baseUrl: string
  fetch?: typeof globalThis.fetch
  track?: <T>(promise: Promise<T>) => Promise<T>
}
```

| Field     | Description                                                               |
| --------- | ------------------------------------------------------------------------- |
| `baseUrl` | Base URL for the Electric Agents server.                                  |
| `fetch`   | Optional fetch implementation, useful in tests or non-standard runtimes.  |
| `track`   | Optional wrapper for all requests, useful for telemetry or pending state. |

## Entity Lifecycle

### spawnEntity

```ts
const info = await client.spawnEntity({
  type: "horton",
  id: "onboarding",
  args: { timezone: "Europe/London" },
  initialMessage: "Help me get started.",
  tags: { project: "docs" },
})

console.log(info.entityUrl) // "/horton/onboarding"
```

`spawnEntity()` is idempotent for an existing `/{type}/{id}` URL: if the server reports a conflict and returns entity details, the client returns that entity info.

```ts
interface SpawnEntityOptions {
  type: string
  id: string
  args?: Record<string, unknown>
  parentUrl?: string
  initialMessage?: unknown
  tags?: Record<string, string>
  wake?: {
    subscriberUrl: string
    condition:
      | "runFinished"
      | {
          on: "change"
          collections?: string[]
          ops?: Array<"insert" | "update" | "delete">
        }
    debounceMs?: number
    timeoutMs?: number
    includeResponse?: boolean
  }
}
```

### getEntityInfo

```ts
const info = await client.getEntityInfo("/horton/onboarding")
// { entityUrl, entityType, streamPath }
```

### deleteEntity

```ts
await client.deleteEntity("/horton/onboarding")
```

Deleting an already-missing entity is treated as success.

## Messages

```ts
await client.sendEntityMessage({
  targetUrl: "/horton/onboarding",
  payload: "What changed since last time?",
  from: "support-ui",
  type: "user_message",
})
```

```ts
interface SendEntityMessageOptions {
  targetUrl: string
  payload: unknown
  from?: string
  type?: string
  afterMs?: number
}
```

`afterMs` asks the server to deliver the message later.

## Shared State

```ts
const streamPath = await client.ensureSharedStateStream("research-123")
// "/_electric/shared-state/research-123"

const samePath = client.getSharedStateStreamPath("research-123")
```

Use `ensureSharedStateStream()` when app code needs to create a shared-state stream before entities connect to it.

## Wakes and Sources

### registerWake

`registerWake()` creates a wake subscription from one source stream to a subscriber entity.

```ts
await client.registerWake({
  subscriberUrl: "/coordinator/research",
  sourceUrl: "/worker/analyst/main",
  condition: "runFinished",
  includeResponse: true,
})
```

For change wakes:

```ts
await client.registerWake({
  subscriberUrl: "/monitor/main",
  sourceUrl: "/horton/onboarding/main",
  condition: {
    on: "change",
    collections: ["runs", "texts"],
    ops: ["insert", "update"],
  },
  debounceMs: 250,
})
```

### registerCronSource

```ts
const streamUrl = await client.registerCronSource(
  "0 9 * * *",
  "Europe/London"
)
```

### registerEntitiesSource

```ts
const source = await client.registerEntitiesSource({ project: "docs" })
// { streamUrl, sourceRef }
```

This is the lower-level operation behind observing `entities({ tags })`.

## Schedules

Schedules are stored on an entity manifest and return the write transaction id.

```ts
await client.upsertCronSchedule({
  entityUrl: "/horton/onboarding",
  id: "daily-checkin",
  expression: "0 9 * * *",
  timezone: "Europe/London",
  payload: "Run the daily check-in.",
})

await client.upsertFutureSendSchedule({
  entityUrl: "/horton/onboarding",
  id: "follow-up",
  fireAt: new Date(Date.now() + 60_000).toISOString(),
  payload: "Follow up now.",
})

await client.deleteSchedule({
  entityUrl: "/horton/onboarding",
  id: "follow-up",
})
```

## Tags

`setTag()` and `removeTag()` are primarily for handler/runtime-owned flows that already hold the current claim-scoped write token. External clients should prefer `send()` and write only to an entity's inbox rather than writing entity state directly.

```ts
await client.setTag("/horton/onboarding", "title", "Onboarding", writeToken)
await client.removeTag("/horton/onboarding", "title", writeToken)
```

## Choosing a Client

| API                         | Use when                                                                 |
| --------------------------- | ------------------------------------------------------------------------ |
| `ctx.spawn/send/observe`    | You are inside an entity handler.                                        |
| `createAgentsClient()`      | You need to observe streams and drive UI state.                          |
| `createRuntimeServerClient()` | You need to manage entities, messages, wakes, schedules, or tags externally. |
| `electric-ax/entity-stream-db` | You need the CLI-style entity stream loader with `close()`.           |
