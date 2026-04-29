---
title: StreamDB
description: >-
  Type-safe reactive database in a durable stream. Define schemas with StandardSchema, query with TanStack DB, and use optimistic actions on top of Durable State.
outline: [2, 3]
---

# StreamDB

StreamDB is a type-safe reactive database in a durable stream.

Pass in a [StandardSchema](#define-a-standardschema) and get typed collections, reactive queries, and optimistic actions on top of [Durable State](durable-state).

<IntentLink intent="create" serviceType="streams" serviceVariant="state" />

## Installation

```bash
npm install @durable-streams/state @tanstack/db
```

`@tanstack/db` is a peer dependency required for StreamDB collections and queries.

## Define a StandardSchema

Define your state structure with `createStateSchema`. Each collection maps an entity type to a [Standard Schema](https://standardschema.dev/) validator and a primary key field:

```typescript
import { createStateSchema, createStreamDB } from "@durable-streams/state"
import { z } from "zod"

const userSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
})

const messageSchema = z.object({
  id: z.string(),
  userId: z.string(),
  text: z.string(),
  timestamp: z.string(),
})

const schema = createStateSchema({
  users: {
    schema: userSchema,
    type: "user",
    primaryKey: "id",
  },
  messages: {
    schema: messageSchema,
    type: "message",
    primaryKey: "id",
  },
})
```

Any [Standard Schema](https://standardschema.dev/) library works, including Zod, Valibot, ArkType, or a manual implementation.

The schema also provides typed event helpers:

```typescript
schema.users.insert({
  value: { id: "1", name: "Alice", email: "alice@example.com" },
})
schema.users.update({ value: updatedUser, oldValue: previousUser })
schema.users.delete({ key: "1" })
```

## Create a StreamDB

`createStreamDB` connects your schema to a Durable Stream and creates a reactive, stream-backed database:

```typescript
const db = createStreamDB({
  streamOptions: {
    url: "https://api.example.com/streams/my-stream",
    contentType: "application/json",
  },
  state: schema,
})

await db.preload()
```

Calling `preload()` reads the stream from the beginning, materializes the current state, and then stays connected for live updates.

## Reactive queries

StreamDB collections are TanStack DB collections. Use `useLiveQuery` for queries that update automatically when data changes:

```typescript
import { useLiveQuery } from "@tanstack/react-db"
import { eq, count } from "@tanstack/db"

const allUsers = useLiveQuery((q) => q.from({ users: db.collections.users }))

const activeUsers = useLiveQuery((q) =>
  q
    .from({ users: db.collections.users })
    .where(({ users }) => eq(users.active, true))
)

const messagesWithAuthors = useLiveQuery((q) =>
  q
    .from({ messages: db.collections.messages })
    .join({ users: db.collections.users }, ({ messages, users }) =>
      eq(messages.userId, users.id)
    )
    .select(({ messages, users }) => ({
      text: messages.text,
      userName: users.name,
    }))
)

const messageCount = useLiveQuery((q) =>
  q
    .from({ messages: db.collections.messages })
    .select(({ messages }) => ({ total: count(messages.id) }))
)
```

TanStack DB uses differential dataflow, so queries update incrementally instead of recomputing everything from scratch.

Framework adapters are available for [React](https://tanstack.com/db/latest/docs/framework/react/overview), [Solid](https://tanstack.com/db/latest/docs/framework/solid/overview), and [Vue](https://tanstack.com/db/latest/docs/framework/vue/overview).

## Lifecycle

```typescript
await db.preload()
db.close()
await db.utils.awaitTxId("txid-uuid", 5000)
```

## Optimistic actions

StreamDB supports optimistic mutations through TanStack DB's action system. Actions update local state immediately while persisting changes to the stream asynchronously:

```typescript
const db = createStreamDB({
  streamOptions: { url: streamUrl, contentType: "application/json" },
  state: schema,
  actions: ({ db, stream }) => ({
    addUser: {
      onMutate: (user) => {
        db.collections.users.insert(user)
      },
      mutationFn: async (user) => {
        const txid = crypto.randomUUID()
        await stream.append(
          JSON.stringify(
            schema.users.insert({ value: user, headers: { txid } })
          )
        )
        await db.utils.awaitTxId(txid)
      },
    },
  }),
})

await db.actions.addUser({ id: "1", name: "Alice", email: "alice@example.com" })
```

If the server mutation fails, TanStack DB rolls back the optimistic update.

## Common patterns

### Key/value store

```typescript
const schema = createStateSchema({
  config: {
    schema: configSchema,
    type: "config",
    primaryKey: "key",
  },
})

await stream.append(
  JSON.stringify(
    schema.config.insert({ value: { key: "theme", value: "dark" } })
  )
)
```

### Presence tracking

```typescript
const schema = createStateSchema({
  presence: {
    schema: presenceSchema,
    type: "presence",
    primaryKey: "userId",
  },
})

await stream.append(
  JSON.stringify(
    schema.presence.update({
      value: { userId: "alice", status: "online", lastSeen: Date.now() },
    })
  )
)
```

### Multi-type chat room

```typescript
const schema = createStateSchema({
  users: { schema: userSchema, type: "user", primaryKey: "id" },
  messages: { schema: messageSchema, type: "message", primaryKey: "id" },
  reactions: { schema: reactionSchema, type: "reaction", primaryKey: "id" },
  typing: { schema: typingSchema, type: "typing", primaryKey: "userId" },
})

await stream.append(JSON.stringify(schema.users.insert({ value: user })))
await stream.append(JSON.stringify(schema.messages.insert({ value: message })))
await stream.append(
  JSON.stringify(schema.reactions.insert({ value: reaction }))
)
```

## Best practices

**Use object values.** StreamDB requires object values, not primitives, for the primary key pattern:

```typescript
// Won't work
{ type: "count", key: "views", value: 42 }

// Works
{ type: "count", key: "views", value: { id: "views", count: 42 } }
```

**Always call `close()`.**

```typescript
useEffect(() => {
  const db = createStreamDB({ streamOptions, state: schema })
  return () => db.close()
}, [])
```

**Use transaction IDs for critical operations.**

```typescript
const txid = crypto.randomUUID()
await stream.append(
  JSON.stringify(schema.users.insert({ value: user, headers: { txid } }))
)
await db.utils.awaitTxId(txid, 10000)
```

**Validate at boundaries.**

```typescript
const userSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  age: z.number().min(0).max(150),
})
```

## Learn more

- [Durable State](durable-state) for the underlying protocol
- [Package README](https://github.com/durable-streams/durable-streams/blob/main/packages/state/README.md)
- [Examples](https://github.com/durable-streams/durable-streams/tree/main/examples/state)
- [TanStack DB](https://tanstack.com/db)
