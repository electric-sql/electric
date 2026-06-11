---
title: Event sources
titleTemplate: "... - Electric Agents"
description: >-
  Let agents discover and subscribe to external webhook-backed event feeds that wake entities with matching event data.
outline: [2, 3]
---

# Event sources

Event sources let agents subscribe to external feeds such as GitHub, Stripe, email, CI, or other webhook integrations. A subscription persists on the entity manifest and wakes the entity when matching external events arrive.

Built-in Horton runtimes expose event-source tools through `ctx.electricTools` by default.

## Contracts

An event source contract describes what an agent can subscribe to:

```ts
type EventSourceContract = {
  serviceId?: string
  sourceKey: string
  sourceType: "webhook"
  endpointKey: string
  status: "active" | "disabled" | "revoked"
  label: string
  description?: string
  agentVisible: boolean
  buckets: EventSourceBucket[]
  updatedAt?: string
  revision: number
}
```

Buckets describe path templates and parameters:

```ts
type EventSourceBucket = {
  key: string
  label: string
  description?: string
  pathTemplate: string
  paramsSchema: Record<string, unknown>
  eventTypes?: string[]
  filters?: EventSourceFilter[]
}
```

Agents should call `list_event_sources` first and use the advertised `sourceKey`, `bucketKey`, `paramsSchema`, and optional `filterKey`.

## Built-in tools

The runtime tool factory can add four tools:

| Tool | Purpose |
| ---- | ------- |
| `list_event_sources` | List external feeds the entity can subscribe to. |
| `list_event_source_subscriptions` | List active subscriptions for this entity. |
| `subscribe_event_source` | Subscribe the entity to a source or bucket. |
| `unsubscribe_event_source` | Remove a subscription by id. |

Horton receives these tools from the built-in runtime. Custom runtimes can provide them with `createEventSourceTools()` or by passing `createElectricTools` through `createRuntimeHandler()`.

```ts
import { createEventSourceTools } from "@electric-ax/agents-runtime/tools"

const runtime = createRuntimeHandler({
  baseUrl: "http://localhost:4437",
  registry,
  createElectricTools: (context) => createEventSourceTools(context),
})
```

## Subscribing from tools

`subscribe_event_source` accepts:

```ts
type EventSourceSubscriptionInput = {
  id?: string
  sourceKey: string
  bucketKey?: string
  params?: Record<string, unknown>
  filterKey?: string
  lifetime?: SubscriptionLifetime
  reason?: string
}
```

If `id` is omitted, the runtime derives a deterministic id from the source, bucket, params, and filter.

Lifetimes:

```ts
type SubscriptionLifetime =
  | { kind: "until_entity_stopped" }
  | { kind: "expires_at"; at: string }
  | { kind: "manual" }
```

The default lifetime is `until_entity_stopped`.

## Programmatic subscriptions

Host code can subscribe directly with `createRuntimeServerClient()`:

```ts
await client.subscribeToEventSource({
  entityUrl: "/horton/onboarding",
  sourceKey: "github",
  bucketKey: "repo",
  params: { repo: "electric-sql/electric" },
  reason: "Watch repo activity for this session",
})

await client.unsubscribeFromEventSource({
  entityUrl: "/horton/onboarding",
  id: "github-main",
})
```

Use `listEventSources()` to inspect available contracts:

```ts
const sources = await client.listEventSources()
```

## Wake payloads

When a subscribed source fires, the entity is woken with a hydrated event-source payload:

```ts
type HydratedEventSourceWake = {
  type: "event_source_wake"
  source: string
  sourceType: "webhook"
  endpointKey: string
  sourceKey: string
  subscription: {
    id: string
    bucketKey?: string
    params: Record<string, unknown>
    filterKey?: string
    reason?: string
  }
  bucket: string | null
  changes: Array<{
    collection: string
    kind: "insert" | "update" | "delete"
    key: string
  }>
  events: WebhookEventRow[]
  missingEventKeys?: string[]
}
```

Handlers can inspect `wake.payload` or use the normal agent context. Horton includes hydrated event-source data in the trigger message so the model can react without doing a second lookup.

## Manifest entries

Subscriptions are stored as `manifest` rows with `kind: "source"` and a stable manifest key:

```ts
event-source:<subscription-id>
```

This lets the entity list and remove subscriptions across wakes.

## Filters

`filterKey` selects a named filter advertised by the source. Filters are intended to narrow external event feeds. In the current version, filters are advisory until server-side source filters are enabled, so agents should still handle unexpected events defensively.
