---
title: TypeScript client
description: >-
  TypeScript client for Durable Streams. Fetch-like stream() for reads and IdempotentProducer for exactly-once writes with batching and retries.
outline: [2, 3]
---

# TypeScript client

Use `@durable-streams/client` when you want direct read and write access to Durable Streams from TypeScript.

It gives you:

- `stream()` for fetch-like reads
- `DurableStream` for create, append, read, close, and delete
- `IdempotentProducer` for exactly-once writes with batching and retries

<IntentLink intent="create" serviceType="streams" serviceVariant="json" />

## Key features

- Exactly-once writes with `IdempotentProducer`
- Automatic batching and pipelining for high-throughput producers
- Streaming reads with promise helpers, `ReadableStream`s, and subscribers
- Offset-based resumability and configurable live modes
- Works with JSON, text, and raw byte streams

## Install

```bash
npm install @durable-streams/client
```

## Read-only API

The `stream()` function is the fetch-like API for consuming streams:

```typescript
import { stream } from "@durable-streams/client"

const res = await stream<{ message: string }>({
  url: "https://streams.example.com/my-account/chat/room-1",
  offset: savedOffset,
  live: true,
})

const items = await res.json()
console.log(items)
```

Use `stream()` when your app only needs to consume a stream.

### StreamResponse helpers

`StreamResponse` supports multiple consumption patterns:

```typescript
const bytes = await res.body()
const items = await res.json()
const text = await res.text()

const byteStream = res.bodyStream()
const jsonStream = res.jsonStream()
const textStream = res.textStream()

const unsubscribe = res.subscribeJson(async (batch) => {
  await processBatch(batch.items)
})
```

Save the returned offset from subscriber batches if you want to resume from the same place later.

## Exactly-once writes

For reliable, high-throughput writes with exactly-once semantics, use `IdempotentProducer`:

```typescript
import { DurableStream, IdempotentProducer } from "@durable-streams/client"

const stream = await DurableStream.create({
  url: "https://streams.example.com/events",
  contentType: "application/json",
})

const producer = new IdempotentProducer(stream, "event-processor-1", {
  autoClaim: true,
  onError: (err) => console.error("Batch failed:", err),
})

for (const event of events) {
  producer.append(event)
}

await producer.flush()
await producer.close()
```

This is the recommended write path when you need safe retries and duplicate prevention.

## Read/write API

Use `DurableStream` when you want a persistent handle for create, append, and read operations:

```typescript
import { DurableStream } from "@durable-streams/client"

const handle = await DurableStream.create({
  url: "https://streams.example.com/my-account/chat/room-1",
  contentType: "application/json",
  ttlSeconds: 3600,
})

await handle.append(JSON.stringify({ type: "message", text: "Hello" }))

const res = await handle.stream<{ type: string; text: string }>()
res.subscribeJson(async (batch) => {
  for (const item of batch.items) {
    console.log(item.text)
  }
})
```

## Live modes

- `true` uses the default live behavior for the stream type
- `false` reads catch-up data only
- `"sse"` forces Server-Sent Events
- `"long-poll"` forces long-polling

## When to use it

- Use the TypeScript client when you are building directly on the protocol.
- Use [JSON mode](../json-mode) when your stream payloads are structured messages.
- Use [Vercel AI SDK](../integrations/vercel-ai-sdk) or [TanStack AI](../integrations/tanstack-ai) when you want higher-level AI integrations.

## More

- [TypeScript client README](https://github.com/durable-streams/durable-streams/blob/main/packages/client/README.md)
- [Client libraries](other) for the other official language clients
