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
  headers?: HeadersProvider
  writeTokenHeader?: ClaimTokenHeader
  track?: <T>(promise: Promise<T>) => Promise<T>
  principalKey?: string
}
```

| Field              | Description                                                                 |
| ------------------ | --------------------------------------------------------------------------- |
| `baseUrl`          | Base URL for the Electric Agents server.                                    |
| `fetch`            | Optional fetch implementation, useful in tests or non-standard runtimes.    |
| `headers`          | Static or async headers added to requests, useful for auth or tenant scope. |
| `writeTokenHeader` | Header transport for claim-scoped write tokens: `authorization`, `electric-claim-token`, or `both`. |
| `track`            | Optional wrapper for all requests, useful for telemetry or pending state.   |
| `principalKey`     | Principal key sent as `Electric-Principal` on requests.                     |

## Entity Lifecycle

### spawnEntity

```ts
const info = await client.spawnEntity({
  type: "horton",
  id: "onboarding",
  args: { timezone: "Europe/London" },
  initialMessage: "Help me get started.",
  tags: { project: "docs" },
  sandbox: { profile: "local", scope: "entity" },
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
  sandbox?: {
    profile?: string
    key?: string
    scope?: "entity" | "wake"
    persistent?: boolean
    owner?: boolean
    inherit?: boolean
  }
  dispatch_policy?: DispatchPolicy
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
    manifestKey?: string
  }
}
```

### getEntity

```ts
const info = await client.getEntity("/horton/onboarding")
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
  type: "user_message",
  mode: "queued",
})
```

```ts
interface SendEntityMessageOptions {
  targetUrl: string
  payload: unknown
  type?: string
  afterMs?: number
  mode?: "immediate" | "queued" | "paused" | "steer"
  position?: string
}
```

`afterMs` asks the server to deliver the message later. `mode` controls how the server queues or applies the message.

## Signals

Send lifecycle signals to an entity:

```ts
await client.signalEntity({
  entityUrl: "/horton/onboarding",
  signal: "SIGINT",
  reason: "User stopped the current run",
})
```

`deleteEntity()` sends `SIGKILL` and treats an already-missing entity as success:

```ts
await client.deleteEntity("/horton/onboarding")
```

## Attachments

Attachments are uploaded through entity routes, stored in private attachment streams, and referenced by manifest entries:

```ts
const { attachment } = await client.createAttachment({
  entityUrl: "/horton/onboarding",
  attachment: {
    bytes: imageBytes,
    mimeType: "image/png",
    filename: "diagram.png",
    subject: { type: "inbox", key: "message-1" },
    role: "input",
  },
})

const bytes = await client.readAttachment({
  entityUrl: "/horton/onboarding",
  id: attachment.id,
})
```

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

### ensureCronStream

```ts
const streamUrl = await client.ensureCronStream(
  "0 9 * * *",
  "Europe/London"
)
```

### ensureEntitiesMembershipStream

```ts
const source = await client.ensureEntitiesMembershipStream({ project: "docs" })
// { streamUrl, sourceRef }
```

This is the lower-level operation behind observing `entities({ tags })`.

### Event sources

Event-source APIs expose webhook-backed feeds that agents can subscribe to:

```ts
const sources = await client.listEventSources()

await client.subscribeToEventSource({
  entityUrl: "/horton/onboarding",
  id: "github-main",
  sourceKey: "github",
  bucketKey: "repo",
  params: { repo: "electric-sql/electric" },
  lifetime: { kind: "until_entity_stopped" },
})

await client.unsubscribeFromEventSource({
  entityUrl: "/horton/onboarding",
  id: "github-main",
})
```

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

`setTag()` and `deleteTag()` are primarily for handler/runtime-owned flows that already hold the current claim-scoped write token. External clients should prefer `send()` and write only to an entity's inbox rather than writing entity state directly.

```ts
await client.setTag("/horton/onboarding", "title", "Onboarding", writeToken)
await client.deleteTag("/horton/onboarding", "title", writeToken)
```

## Choosing a Client

| API                         | Use when                                                                 |
| --------------------------- | ------------------------------------------------------------------------ |
| `ctx.spawn/send/observe`    | You are inside an entity handler.                                        |
| `createAgentsClient()`      | You need to observe streams and drive UI state.                          |
| `createRuntimeServerClient()` | You need to manage entities, messages, wakes, schedules, or tags externally. |
| `electric-ax/entity-stream-db` | You need the CLI-style entity stream loader with `close()`.           |
