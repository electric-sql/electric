---
title: Yjs
description: >-
  Sync Yjs CRDT documents over HTTP with automatic server-side compaction, snapshot management, and optional awareness (presence) support.
outline: [2, 3]
---

<img src="/img/icons/yjs.svg" style="height: 54px !important" />
<br />

# Yjs

Sync [Yjs](https://yjs.dev/) CRDT documents over Durable Streams using plain HTTP — no WebSocket infrastructure needed.

y-durable-streams provides a Yjs provider and server that handle snapshot discovery, live updates via long-polling or SSE, automatic server-side compaction, and optional awareness (presence) for cursors and user status.

## Installation

```bash
npm install @durable-streams/y-durable-streams yjs y-protocols lib0
```

`yjs`, `y-protocols`, and `lib0` are peer dependencies.

## Quick start

```typescript
import { YjsProvider } from "@durable-streams/y-durable-streams"
import * as Y from "yjs"
import { Awareness } from "y-protocols/awareness"

const doc = new Y.Doc()
const awareness = new Awareness(doc)

const provider = new YjsProvider({
  doc,
  baseUrl: "http://localhost:4438/v1/yjs/my-service",
  docId: "my-document",
  awareness,
})

provider.on("synced", (synced) => {
  console.log("Synced:", synced)
})
```

The provider connects automatically, discovers the latest snapshot, loads it, then streams live updates.

## Provider options

```typescript
interface YjsProviderOptions {
  doc: Y.Doc // Yjs document to sync
  baseUrl: string // Server URL, e.g. "http://localhost:4438/v1/yjs/my-service"
  docId: string // Document ID (can include slashes, e.g. "project/chapter-1")
  awareness?: Awareness // Optional awareness for presence
  headers?: HeadersRecord // Optional auth headers
  liveMode?: "sse" | "long-poll" // Live update transport (default: "sse")
  connect?: boolean // Auto-connect on construction (default: true)
}
```

## Events

```typescript
// Sync state changes
provider.on("synced", (synced: boolean) => {
  if (synced) {
    console.log("Document is synced with server")
  }
})

// Connection status changes
provider.on("status", (status: "disconnected" | "connecting" | "connected") => {
  console.log("Status:", status)
})

// Error handling
provider.on("error", (error: Error) => {
  console.error("Provider error:", error)
})
```

## Lifecycle

```typescript
// Manual connection
const provider = new YjsProvider({
  doc,
  baseUrl,
  docId,
  connect: false, // Don't connect automatically
})

provider.on("synced", handleSync)
provider.on("error", handleError)

await provider.connect()

// Disconnect temporarily
provider.disconnect()

// Reconnect
await provider.connect()

// Destroy permanently
provider.destroy()
```

Always call `destroy()` when done to clean up event listeners and close connections.

## Authentication

```typescript
const provider = new YjsProvider({
  doc,
  baseUrl: "http://localhost:4438/v1/yjs/my-service",
  docId: "my-document",
  awareness,
  headers: {
    Authorization: "Bearer your-token",
  },
})
```

## Awareness (presence)

Pass an `Awareness` instance to enable presence support. y-durable-streams broadcasts local awareness state (cursors, selections, user info) and subscribes to remote awareness updates via a separate SSE stream.

```typescript
import * as Y from "yjs"
import { Awareness } from "y-protocols/awareness"
import { YjsProvider } from "@durable-streams/y-durable-streams"

const doc = new Y.Doc()
const awareness = new Awareness(doc)

const provider = new YjsProvider({
  doc,
  baseUrl: "http://localhost:4438/v1/yjs/my-service",
  docId: "my-document",
  awareness,
})

// Set local user presence
awareness.setLocalStateField("user", {
  name: "Alice",
  color: "#ff0000",
})

// Listen for remote awareness changes
awareness.on("change", () => {
  const states = awareness.getStates()
  console.log("Online users:", states.size)
})
```

Awareness heartbeats are sent every 15 seconds. When the provider disconnects, it broadcasts a removal so other clients see the user go offline immediately.

## How it works

y-durable-streams uses a four-step sync protocol over HTTP. For the full wire format and details, see the [Yjs Durable Streams Protocol specification](https://github.com/durable-streams/durable-streams/blob/main/packages/y-durable-streams/YJS-PROTOCOL.md).

1. **Snapshot discovery** — Requests `?offset=snapshot`. The server responds with a 307 redirect to the latest snapshot offset, or to `-1` if no snapshot exists.
2. **Snapshot loading** — Fetches the binary Yjs snapshot and applies it to the local document. The response includes a `stream-next-offset` header indicating where to continue.
3. **Live updates** — Streams incremental updates from the offset via long-polling or SSE. Local edits are sent through an idempotent producer for exactly-once delivery.
4. **Awareness** — An optional separate SSE stream carries presence data (cursors, selections, user info) using named awareness channels.

### Compaction

y-durable-streams automatically compacts documents when accumulated updates exceed a size threshold. Compaction creates a new snapshot at the current offset, keeping initial sync fast for new clients. This is transparent to connected clients — existing connections continue uninterrupted.

### URL structure

Each document is accessed via a single URL with query parameters:

```
{baseUrl}/docs/{docPath}?{queryParams}
```

Where `docPath` can include forward slashes (e.g., `project/chapter-1`).

## Best practices

**Always call `destroy()`.** Clean up providers when unmounting components or leaving documents.

```typescript
useEffect(() => {
  const provider = new YjsProvider({ doc, baseUrl, docId, awareness })
  return () => provider.destroy()
}, [])
```

**Use hierarchical document paths.** Organize documents with forward slashes for logical grouping.

```typescript
// Good
docId: "org/project/chapter-1"

// Also works
docId: "simple-doc"
```

**Handle errors gracefully.** y-durable-streams automatically reconnects on transient failures, but listen for errors to update the UI.

```typescript
provider.on("error", (error) => {
  showToast("Connection issue — retrying...")
})
```

## Learn more

- [Yjs protocol specification](https://github.com/durable-streams/durable-streams/blob/main/packages/y-durable-streams/YJS-PROTOCOL.md) — full protocol spec
- [Package README](https://github.com/durable-streams/durable-streams/blob/main/packages/y-durable-streams/README.md) — complete API reference
- [Yjs demo](https://github.com/durable-streams/durable-streams/tree/main/examples/yjs-demo) — collaborative text editor example
- [Yjs docs](https://docs.yjs.dev/) — Yjs documentation
