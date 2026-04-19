---
title: JSON mode
description: >-
  Stream structured data using JSON messages over a Durable Stream.
outline: [2, 3]
---

# JSON mode

Stream structured data using JSON messages over a Durable Stream.

JSON mode is enabled by creating the stream with `Content-Type: application/json`. Use it when you want to stream structured messages with preserved message boundaries.

<IntentLink intent="create" serviceType="streams" serviceVariant="json" />

## What JSON mode does

- each `POST` stores a distinct JSON message
- posting a JSON array stores each element as its own message
- `GET` returns a JSON array of messages for the requested range

## Create a JSON stream

```bash
curl -X PUT http://localhost:4437/v1/stream/events \
  -H 'Content-Type: application/json'
```

## Append JSON messages

Append one message:

```bash
curl -X POST http://localhost:4437/v1/stream/events \
  -H 'Content-Type: application/json' \
  -d '{"type":"user.created","id":"123"}'
```

Append multiple messages in one request:

```bash
curl -X POST http://localhost:4437/v1/stream/events \
  -H 'Content-Type: application/json' \
  -d '[{"type":"user.created","id":"123"},{"type":"user.updated","id":"123"}]'
```

The second request stores two messages, not one outer array.

## Read them back

```bash
curl "http://localhost:4437/v1/stream/events?offset=-1"
```

Response:

```json
[
  { "type": "user.created", "id": "123" },
  { "type": "user.updated", "id": "123" }
]
```

## Use JSON mode from the client

::: code-group

```typescript [TypeScript]
import { DurableStream, stream } from "@durable-streams/client"

const events = await DurableStream.create({
  url: "http://localhost:4437/v1/stream/events",
  contentType: "application/json",
})

await events.append(JSON.stringify({ type: "user.created", id: "123" }))

const res = await stream<{ type: string; id: string }>({
  url: "http://localhost:4437/v1/stream/events",
  json: true,
})

const items = await res.json()
console.log(items)
```

```python [Python]
from durable_streams import DurableStream, stream

handle = DurableStream.create(
    "http://localhost:4437/v1/stream/events",
    content_type="application/json",
)

handle.append({"type": "user.created", "id": "123"})

with stream("http://localhost:4437/v1/stream/events") as res:
    items = res.read_json()
    print(items)
```

:::

## When to use it

- Use JSON mode for chat messages, agent events, state updates, and logs.
- Use byte streams for raw binary data or when you already have your own framing format.

## More

- [Core concepts](/docs/streams/concepts#messages-and-content-types)
- [Durable State](/docs/streams/durable-state) for structured state sync on top of JSON mode
- [StreamDB](stream-db) for a type-safe reactive database in a stream, running on Durable State
- [Yjs](integrations/yjs) for syncing Yjs CRDTs over durable streams
