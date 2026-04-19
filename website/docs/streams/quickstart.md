---
title: Quickstart
description: >-
  Get started with Durable Streams by following the Quickstart guide.
outline: [2, 3]
---

# Quickstart

Durable Streams are the data primitive for the agent loop.

Persistent, addressable, real‑time streams for building resilient agent sessions and collaborative multi-user, multi-agent systems.

<IntentLink intent="create" serviceType="streams" />

## Get started

Get a Durable Streams server running in seconds. Create a stream, append data, read it back, and tail it live using curl.

### 1. Start the server

Download the latest `durable-streams-server` binary from the [GitHub releases page](https://github.com/durable-streams/durable-streams/releases/latest), then run:

```bash
./durable-streams-server dev
```

This starts an in-memory server on `http://localhost:4437` with the stream endpoint at `/v1/stream/*`.

### 2. Create a stream

```bash
curl -X PUT http://localhost:4437/v1/stream/hello \
  -H 'Content-Type: text/plain'
```

### 3. Append some data

```bash
curl -X POST http://localhost:4437/v1/stream/hello \
  -H 'Content-Type: text/plain' \
  -d 'Hello, Durable Streams!'
```

### 4. Read it back

```bash
curl "http://localhost:4437/v1/stream/hello?offset=-1"
```

The response body contains your stream contents. Save the `Stream-Next-Offset` response header if you want to resume from the same position later.

### 5. Tail it live

In one terminal:

```bash
curl -N "http://localhost:4437/v1/stream/hello?offset=-1&live=sse"
```

In another terminal:

```bash
curl -X POST http://localhost:4437/v1/stream/hello \
  -H 'Content-Type: text/plain' \
  -d 'This appears in real time!'
```

The first terminal will receive the new data immediately.

## Next steps

Raw durable streams are awesome but it's what you do with them that counts. Dive into the [core concepts](/docs/streams/concepts) and see all of the ways you can use Durable Streams to build resilient, collaborative multi-agent systems.

Including, working with structured data and integrating into AI SDKs:

- [JSON mode](/docs/streams/json-mode) -- stream structured data using JSON messages
- [StreamDB](/docs/streams/stream-db) -- type-safe, reactive database in a stream
- [Yjs](/docs/streams/integrations/yjs) -- sync Yjs CRDTs for collaborative editing
- [TanStack AI](/docs/streams/integrations/tanstack-ai) -- durable session support for TanStack AI apps
- [Vercel AI SDK](/docs/streams/integrations/vercel-ai-sdk) -- durable Transport adapter for AI SDK apps
