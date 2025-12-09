---
title: 'Announcing Durable Streams'
description: 'An HTTP protocol for reliable, resumable streaming to clients (including AI token streams)'
excerpt: 'We’re open-sourcing Durable Streams, an HTTP-based protocol for ordered, replayable streaming to client applications. It’s extracted from ~1.5 years of production use at Electric.'
authors: [KyleAMathews]
image: '/img/blog/announcing-durable-streams/hero.png'
tags: [durable-streams, sync, protocol]
outline: [2, 3]
post: true
---

The internet has strong primitives for server-to-server messaging: Kafka, RabbitMQ, NATS. They give you ordering, delivery semantics, and fault tolerance between backend services.

Client streaming is different. WebSocket and SSE connections are easy to start, but they’re fragile in practice: tabs get suspended, networks flap, devices switch, pages refresh. When that happens, you either lose in-flight data or you build a bespoke backend storage & client resume protocol on top.

AI products make this painfully visible. Token streaming is the UI for chat and copilots, and agentic apps often stream progress events, tool outputs, and partial results over long-running sessions. A transient disconnect can leave users with truncated output, force a restart, or create duplicate/ambiguous state when the client tries to recover.

Durable Streams is our attempt to make “durable, resumable client streaming” a standard, boring, building block.

Today, we’re open-sourcing [Durable Streams](https://github.com/durable-streams/durable-streams): an HTTP-based protocol for reliable, resumable data streaming to client applications.

## What is Durable Streams?

Durable Streams is an open protocol that extends standard HTTP to support ordered, replayable streams with offset-based resumability. It’s designed to work anywhere HTTP works: browsers, mobile, native clients, and IoT.

The core idea is simple:

- Every position in a stream has an **opaque, lexicographically sortable offset**.
- Clients persist the last offset they’ve processed.
- On reconnect, clients resume by asking for “everything after offset X”.
- The server doesn’t need per-client session state; the stream is durable, and **progress is tracked client-side**.
- Streams are addressed by offset-based URLs, so historical reads can be cached by CDNs. That makes it feasible to serve large numbers of clients from a single source stream without turning your origin into a bottleneck.

That's the model: consistent, interoperable, and scalable durable client streaming.

## Why Now (and why we built it)

Durable Streams comes directly out of building Electric, our Postgres-native sync engine.

A sync engine can’t cheat its way around delivery. We needed a transport layer that guarantees *ordered, replayable, resumable* delivery. Over the last 1.5 years, we've refined and refined our implementation until now we reliably deliver millions of state changes every day on Electric Cloud.

At the same time, conversations with users, customers, and peers in the broader AI ecosystem were converging on the same pain point: **AI token streaming needs reliable delivery and persistence**.

Teams are shipping streaming UIs on best-effort connections, then reimplementing offsets, buffering, replay, and deduplication in application code. The underlying need is a durable stream primitive that makes token streaming (and other client streaming) survivable across the messy realities of browsers and networks.

We're now prepping Electric 2.0 for our Postgres-native sync engine so this is a natural moment to split our sync stack into clearer layers.

Internally, we’ve ended up thinking about the stack in three layers:

1. **Streams** — Durable, resumable delivery
2. **State** — A schema for state change events (inserts, updates, and deletes)
3. **Specific** — Database-specific replication logic (e.g. Postgres)

Durable Streams is that bottom layer extracted as a standalone protocol: the thing we need for Electric, and the thing we keep seeing other teams reinvent for AI streaming and beyond.

## How It Works

Durable Streams uses standard HTTP methods:

- **Create + append**: create a stream with `PUT`, append data with `POST`. Each append returns the next offset in a response header.
- **Read + resume**: read from an offset using `GET` for catch-up; or tail the stream using long-polling or an SSE mode. If a connection drops, reconnect using the last saved offset.
- **Message boundaries**: choose between raw byte concatenation (with your own framing, e.g. NDJSON) or a JSON mode where servers return batches as arrays with preserved boundaries.

Streams are addressed by offset-based URLs, so historical reads can be cached by CDNs. That makes it feasible to serve large numbers of clients from a single source stream without turning your origin into a bottleneck.

## Use Cases

Durable Streams is a delivery primitive. A few places it fits well:

- **AI / LLM streaming**: resume token streams across refreshes and device switches instead of restarting generations.
- **Agentic apps**: stream tool outputs and progress events with replay and clean reconnect semantics.
- **Database synchronization**: stream row changes with guaranteed ordering and resumability (how Electric ships updates to clients; also useful as a substrate for systems like TanStack DB).
- **Event sourcing**: immutable logs clients can replay from any point in time.
- **Real-time collaboration**: deliver CRDT / OT updates with replayable history and clean reconnects.

The pattern is the same: consume events from backend systems (databases, Kafka, queues), apply auth + transformation, then fan out to clients over HTTP using Durable Streams.

## What’s in the Repo

The [durable-streams repository](https://github.com/durable-streams/durable-streams) includes:

- A reference Node.js server implementation
- TypeScript clients for read-only and read-write scenarios
- A CLI tool for testing and development
- A conformance test suite for cross-implementation compatibility

If you want to dig in, start with the repo and the protocol docs. And if you’re thinking about where this fits in your stack, join us in [Discord](https://discord.electric-sql.com).

