---
title: 'Announcing Durable Streams'
description: >
  A persistent stream primitive and HTTP protocol for reliable, resumable,
  real-time data streaming into client applications
excerpt: >
  We're open-sourcing Durable Streams, a persistent stream primitive and HTTP
  protocol for reliable, resumable, real-time data streaming into client
  applications. It's extracted from ~1.5 years of production use at Electric.
authors: [kyle, samwillis]
image: /img/blog/announcing-durable-streams/hero.png
tags: [durable-streams, sync, protocol]
outline: [2, 3]
post: true
---

The internet has strong primitives for server-to-server messaging: Kafka, RabbitMQ, NATS. They give you ordering, delivery semantics, and fault tolerance between backend services.

Client streaming is different. WebSocket and SSE connections are easy to start, but they're fragile in practice: tabs get suspended, networks flap, devices switch, pages refresh. When that happens, you either lose in-flight data or you build a bespoke backend storage & client resume protocol on top.

AI products make this painfully visible. Token streaming is the UI for chat and copilots, and agentic apps often stream progress events, tool outputs, and partial results over long-running sessions. When the stream fails, the product fails—even if the model did the right thing. A transient disconnect can leave users with truncated output, force a restart, or create duplicate/ambiguous state when the client tries to recover.

Durable Streams makes "durable, resumable client streaming" a standard, universally available building block that just works.

Today, we're open-sourcing [Durable Streams](https://github.com/durable-streams/durable-streams): a persistent stream primitive and HTTP protocol for reliable, resumable, real-time data streaming into client applications. We originally built Durable Streams as the delivery layer inside Electric, our Postgres-native sync engine, and are now standardizing it as a standalone protocol.

## Why Now (and why we built it)

**Refined in production**

A sync engine can't cheat its way around delivery—we needed a transport layer that guarantees *ordered, replayable, resumable* delivery from day one. Over the past 18 months of Electric Cloud, we've continuously refined our implementation until now we reliably deliver millions of state changes every day.

**The AI explosion**

At the same time, conversations with users, customers, and industry peers kept surfacing the same theme: **AI token streaming needs reliable delivery and persistence**. This has become a [dominant infrastructure concern](https://electric-sql.com/blog/2025/04/09/building-ai-apps-on-sync) as AI applications proliferate. Teams are shipping streaming UIs on best-effort connections, then reimplementing offsets, buffering, replay, and deduplication in application code. The underlying need is a durable stream primitive that makes token streaming (and other client streaming) survivable across the messy realities of browsers and networks.

**Breaking the stack into layers**

As we work on Electric 2.0, we're making a key architectural shift: splitting our sync stack into three composable layers. This lets us publish each layer as a standalone protocol that teams can use independently or combine.

1. **Streams** — Durable, resumable delivery
2. **State** — A schema for state change events (inserts, updates, and deletes)
3. **Specific** — Database-specific replication logic (e.g. Postgres)

Durable Streams is that first, and most fundamental layer extracted as a standalone protocol: the thing we need for Electric, and the thing we keep seeing other teams reinvent for AI streaming and beyond.

## How It Works

Durable Streams uses standard HTTP methods:

- **Create + append**: create a stream with `PUT`, append data with `POST`. Each append returns the next offset in a response header.
- **Read + resume**: read from an offset using `GET` for catch-up; or tail the stream using long-polling or an SSE mode. If a connection drops, reconnect using the last saved offset.
- **Message boundaries**: choose between raw byte concatenation (with your own framing, e.g. NDJSON) or a JSON mode where servers return batches as arrays with preserved boundaries.
- **Infrastructure-friendly**: runs over plain HTTP (including long-polling or SSE) so it fits behind CDNs and standard API gateways.

Here's what resumable streaming looks like in practice:

```typescript
import { DurableStream } from "@durable-streams/client"

const stream = new DurableStream({
  url: "https://your-server.com/v1/stream/my-stream",
})

// Catch-up: read all existing data
const result = await stream.read()
const savedOffset = result.offset // Persist this client-side

// Resume from where you left off (after refresh, reconnect, device switch)
for await (const chunk of stream.follow({
  offset: savedOffset,
  live: "long-poll",
})) {
  console.log(new TextDecoder().decode(chunk.data))
  // Save chunk.offset to resume from here next time
}
```

For AI token streaming, the pattern is similar—stream tokens to a Durable Stream, and clients can resume mid-generation:

```typescript
// Server: stream LLM output
for await (const token of llm.stream(prompt)) {
  await stream.append(token)
}

// Client: resume from last seen token (works across page refreshes)
for await (const chunk of stream.follow({
  offset: lastSeenOffset,
  live: "sse",
})) {
  renderToken(new TextDecoder().decode(chunk.data))
}
```

## What are Durable Streams?

The Durable Streams protocol is an open protocol that extends standard HTTP to support ordered, replayable streams with offset-based resumability. It's designed to work anywhere HTTP works: browsers, mobile, native clients, and IoT.

The core idea: streams are a first-class primitive that get their own URL. Each stream is an addressable, append-only log that clients can read from any position.

- Every position in a stream has an **opaque, monotonic offset**.
- Clients persist the last offset they've processed.
- On reconnect, clients resume by asking for "everything after offset X".
- The server doesn't need per-client session state; the stream is durable, and **progress is tracked client-side**.
- Streams are addressed by offset-based URLs, so historical reads can be cached by CDNs. That makes it feasible to serve large numbers of clients from a single source stream without turning your origin into a bottleneck.

That's the model: consistent, interoperable, scalable, and durable client streaming.

## Use Cases

Durable Streams is a delivery primitive. A few places it fits well:

- **AI / LLM streaming**: resume token streams across refreshes and device switches instead of restarting generations.
- **Agentic apps**: stream tool outputs and progress events with replay and clean reconnect semantics.
- **Database synchronization**: stream row changes with guaranteed ordering and resumability (the mechanism Electric uses to ship updates to clients).
- **Event sourcing**: immutable logs clients can replay from any point in time.
- **Real-time collaboration**: deliver CRDT / OT updates with replayable history and clean reconnects.

The pattern is the same: consume events from backend systems (databases, Kafka, queues), apply auth + transformation, then fan out to clients over HTTP using Durable Streams.

## What's in the Repo

The [durable-streams repository](https://github.com/durable-streams/durable-streams) includes:

- A reference Node.js server implementation
- TypeScript clients for read-only and read-write scenarios
- A CLI tool for testing and development
- A conformance test suite for cross-implementation compatibility

The goal is for Durable Streams to be a *spec with many implementations*, not a single codebase. We'd love to see independent server and client implementations in other languages. The reference implementation includes a Node.js server and TypeScript/JavaScript client, but the ecosystem needs implementations in Python, Go, Rust, Java, Swift, Kotlin, and more—along with different storage backends (PostgreSQL, S3, Redis, etc.).

If you're building one, the conformance test suite is there to help ensure compatibility, we're happy to link to implementations from the main repository, and we'd love to chat in [Discord](https://discord.electric-sql.com).

## What's Coming Next

Today's launch focuses on Durable Streams—the foundational delivery layer. But this is just the first of the three layers we're publishing.

Electric's current protocol combines all three layers into a single system. As we build Electric 2.0, we're separating these concerns so each layer can be used independently:

- **Durable Streams** (launching today) — Reliable, resumable delivery over HTTP
- **State protocol** (coming soon) — A standardized schema for state change events (inserts, updates, deletes) that works over any durable stream
- **Database-specific adapters** (coming soon) — Replication protocols for Postgres, MySQL, SQLite, and other databases

This means you can use Durable Streams for AI token streaming today, then later adopt the State protocol when you need database sync semantics. Or use the State protocol over a different transport if you prefer. The layers compose.

Stay tuned for the State protocol announcement.

## Common Questions

### Why not just use SSE or WebSockets?

Both SSE and WebSockets are ephemeral—when a connection drops, in-flight data is lost. There's no standard way to resume from a specific position after reconnection, no defined protocol for retrieving historical data before switching to live mode, and neither integrates well with HTTP caching infrastructure or standard API gateways.

Durable Streams keeps you in plain HTTP with standardized resumption through opaque, monotonic offsets, a unified catch-up and live protocol, and offset-based requests that CDNs and browsers can cache.

### How does this relate to Kafka, RabbitMQ, and other message queues?

Durable Streams complements rather than replaces these systems. Kafka and RabbitMQ excel at server-to-server messaging in backend infrastructure. Durable Streams solves the distinct challenge of reliably streaming data to client applications—handling client diversity, network unreliability, and the economics of per-connection delivery.

The recommended pattern: backend systems (Kafka, databases, queues) → application server → Durable Streams → clients.

## Performance

Durable Streams is built for production scale. In Electric, we sync data through Postgres and Electric in under 15ms end-to-end. Throughput scales with your infrastructure—the protocol itself adds minimal overhead, and we've tested millions of concurrent clients subscribed to a single stream without degradation.

The offset-based design enables aggressive caching at CDN edges, which means read-heavy workloads (common in sync and AI scenarios) scale horizontally without overwhelming origin servers.

## Community

Durable Streams is designed as a community protocol. We'd love to see independent server and client implementations in other languages. The reference implementation includes a Node.js server and TypeScript/JavaScript client, but the ecosystem needs implementations in Python, Go, Rust, Java, Swift, Kotlin, and more—along with different storage backends (PostgreSQL, S3, Redis, etc.).

If you're building one, the conformance test suite is there to help ensure compatibility, we're happy to link to implementations from the main repository, and we'd love to chat in [Discord](https://discord.electric-sql.com).

## Get Started

Check out the [durable-streams repository](https://github.com/durable-streams/durable-streams) to get started, and join us in [Discord](https://discord.electric-sql.com) if you're thinking about where this fits in your stack.
