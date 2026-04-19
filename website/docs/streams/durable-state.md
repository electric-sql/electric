---
title: Durable State
description: >-
  Structured state changes on top of Durable Streams. Work with typed insert, update, and delete events using MaterializedState, StreamDB, and Durable Sessions.
outline: [2, 3]
---

# Durable State

Durable State adds structured state changes on top of Durable Streams. Instead of treating a stream as raw bytes, you work with typed `insert`, `update`, and `delete` events.

<IntentLink intent="create" serviceType="streams" serviceVariant="state" />

## Protocol overview

Durable State uses JSON streams (`Content-Type: application/json`) and define two message types:

- **Change messages** for `insert`, `update`, and `delete`
- **Control messages** for snapshot boundaries and resets

Clients append these events to a stream and materialize state by applying them in order.

Use Durable Streams directly for raw token or byte streaming. Use Durable State when you want database-style sync semantics on top.

> See the full [State protocol specification](https://github.com/durable-streams/durable-streams/blob/main/packages/state/STATE-PROTOCOL.md) for the formal wire format and requirements.

## Installation

```bash
npm install @durable-streams/state @tanstack/db
```

`@tanstack/db` is only needed for [StreamDB](stream-db). If you only need `MaterializedState`, you can skip it.

## Change events

The State Protocol defines a standard format for state change events. Each event targets a typed entity identified by `type` and `key`, and carries an operation in its `headers`:

```json
{
  "type": "user",
  "key": "user:123",
  "value": { "name": "Alice", "email": "alice@example.com" },
  "headers": {
    "operation": "insert",
    "txid": "abc-123",
    "timestamp": "2025-12-23T10:30:00Z"
  }
}
```

**Fields:**

| Field               | Required          | Description                                                          |
| ------------------- | ----------------- | -------------------------------------------------------------------- |
| `type`              | Yes               | Entity type discriminator -- routes events to the correct collection |
| `key`               | Yes               | Unique identifier for the entity within its type                     |
| `value`             | For insert/update | The entity data                                                      |
| `old_value`         | No                | Previous value, useful for conflict detection                        |
| `headers.operation` | Yes               | One of `"insert"`, `"update"`, or `"delete"`                         |
| `headers.txid`      | No                | Transaction identifier for confirmation                              |
| `headers.timestamp` | No                | RFC 3339 timestamp                                                   |

Multiple entity types coexist in the same stream. A chat room stream might carry `user`, `message`, `reaction`, and `typing` events, all interleaved and processed in order.

## Control events

The protocol also defines control events for stream management, separate from data changes. These have a `control` field in their headers instead of an `operation`:

| Control          | Purpose                                                               |
| ---------------- | --------------------------------------------------------------------- |
| `snapshot-start` | Marks the beginning of a snapshot -- a complete dump of current state |
| `snapshot-end`   | Marks the end of a snapshot boundary                                  |
| `reset`          | Signals clients to clear their materialized state and restart         |

```json
{"headers": {"control": "snapshot-start", "offset": "123456_000"}}

{"type": "user", "key": "1", "value": {"name": "Alice"}, "headers": {"operation": "insert"}}
{"type": "user", "key": "2", "value": {"name": "Bob"}, "headers": {"operation": "insert"}}

{"headers": {"control": "snapshot-end", "offset": "123456_789"}}
```

You'll encounter these when a server sends a full state snapshot rather than incremental changes -- for example, on initial connection or after a schema migration.

## MaterializedState

`MaterializedState` is a simple in-memory key-value store that applies change events. It's the minimal way to consume state protocol events -- no schemas, no reactive queries, just a map from `(type, key)` to the latest value.

```typescript
import { MaterializedState } from "@durable-streams/state"

const state = new MaterializedState()

state.apply({
  type: "user",
  key: "1",
  value: { name: "Alice" },
  headers: { operation: "insert" },
})

state.apply({
  type: "user",
  key: "1",
  value: { name: "Alice Smith" },
  headers: { operation: "update" },
})

const user = state.get("user", "1") // { name: "Alice Smith" }
const allUsers = state.getType("user") // Map of all users
```

`MaterializedState` is a good fit when you need straightforward state tracking without reactive queries or schema validation.

## StreamDB

For applications that need reactive queries, filtering, joins, and optimistic updates, use [StreamDB](stream-db).

StreamDB is the `createStreamDB` / `StreamDB` layer in `@durable-streams/state`, built on top of State Streams and [TanStack DB](https://tanstack.com/db).

## Durable Sessions

A Durable Session multiplexes AI token streams with structured state into a persistent, shared session. Multiple users and agents can subscribe to and join the session at any time, making it a natural fit for collaborative AI applications.

The pattern layers protocols on top of each other:

1. **Durable Streams** -- reliable, resumable byte delivery
2. **State Protocol** -- structured CRUD operations over streams
3. **Application protocols** -- AI SDK transports, presence, CRDTs

This enables scenarios where an AI agent streams tokens into a session while structured state (tool results, user presence, shared documents) flows through the same infrastructure.

For a detailed walkthrough, see the [Durable Sessions for Collaborative AI](https://electric-sql.com/blog/2026/01/12/durable-sessions-for-collaborative-ai) blog post.

## Learn more

- [State protocol specification](https://github.com/durable-streams/durable-streams/blob/main/packages/state/STATE-PROTOCOL.md) -- full protocol spec
- [StreamDB](stream-db) -- reactive collections, queries, and optimistic actions
- [Yjs](integrations/yjs) -- sync Yjs CRDTs for collaborative editing
- [Package README](https://github.com/durable-streams/durable-streams/blob/main/packages/state/README.md) -- complete API reference
- [Examples](https://github.com/durable-streams/durable-streams/tree/main/examples/state) -- background jobs dashboard and Wikipedia live events demo
- [TanStack DB](https://tanstack.com/db) -- reactive collections and query engine
- [Standard Schema](https://standardschema.dev/) -- schema validation

---

See also: [Core concepts](concepts) | [JSON mode](json-mode) | [StreamDB](stream-db) | [Yjs](integrations/yjs)
