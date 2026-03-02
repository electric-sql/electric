---
name: electric-tanstack-integration
description: >
  TanStack DB collections with Electric — createCollection,
  electricCollectionOptions, useLiveQuery, optimistic mutations, onInsert,
  onUpdate, onDelete, txid write-path contract, awaitTxId,
  createOptimisticAction, cross-collection joins, sub-ms differential dataflow
type: composition
library: '@electric-sql/client'
library_version: '1.5.8'
requires:
  - '@tanstack/react-db'
  - '@tanstack/electric-db-collection'
sources:
  - 'electric:AGENTS.md'
  - 'tanstack:tanstack.com/db/latest/docs/collections/electric-collection.md'
---

# Electric + TanStack DB Integration

TanStack DB collections are the default for apps that need writes, joins, or
multiple shapes. Prefer collections over lower-level ShapeStream/useShape.

## Setup

```bash
pnpm add @tanstack/react-db @tanstack/electric-db-collection @electric-sql/client
```

## Core Patterns

### Create Collection

```typescript
import { createCollection } from '@tanstack/react-db'
import { electricCollectionOptions } from '@tanstack/electric-db-collection'
import { todoSchema } from './schema'

export const todoCollection = createCollection(
  electricCollectionOptions({
    id: 'todos',
    schema: todoSchema,
    getKey: (row) => row.id,
    shapeOptions: { url: '/api/todos' },
    onInsert: async ({ transaction }) => {
      const newTodo = transaction.mutations[0].modified
      const { txid } = await api.todos.create(newTodo)
      return { txid }
    },
    onUpdate: async ({ transaction }) => {
      const { original, changes } = transaction.mutations[0]
      const { txid } = await api.todos.update(original.id, changes)
      return { txid }
    },
    onDelete: async ({ transaction }) => {
      const { id } = transaction.mutations[0].original
      const { txid } = await api.todos.delete(id)
      return { txid }
    },
  })
)
```

### Live Queries

```typescript
import { useLiveQuery, eq } from "@tanstack/react-db"

function TodoList() {
  const { data: todos } = useLiveQuery((q) =>
    q.from({ todo: todoCollection })
      .where(({ todo }) => eq(todo.completed, false))
      .orderBy(({ todo }) => todo.created_at, "desc")
      .limit(50)
  )
  return <ul>{todos.map((t) => <li key={t.id}>{t.text}</li>)}</ul>
}
```

### Cross-Collection Joins

```typescript
const { data } = useLiveQuery((q) =>
  q
    .from({ todo: todoCollection })
    .join({ user: userCollection }, ({ todo, user }) =>
      eq(todo.user_id, user.id)
    )
    .select(({ todo, user }) => ({
      id: todo.id,
      text: todo.text,
      userName: user.name,
    }))
)
```

### Direct Mutations

```typescript
todoCollection.insert({
  id: crypto.randomUUID(),
  text: 'New todo',
  completed: false,
  createdAt: Date.now(),
})

todoCollection.update(todoId, (draft) => {
  draft.completed = !draft.completed
})

todoCollection.delete(todoId)
```

### Write-Path Contract

```
UI mutation → optimistic → onInsert/onUpdate/onDelete → API → Postgres
  → returns txid → Electric streams change → collection drops optimistic state
```

Backend must return txid from the same transaction:

```sql
SELECT pg_current_xact_id()::xid::text as txid
```

### Multi-Collection Optimistic Actions

```typescript
import { createOptimisticAction } from '@tanstack/react-db'

const bootstrapAction = createOptimisticAction<string>({
  onMutate: (listId, text) => {
    listCollection.insert({ id: listId })
    todoCollection.insert({ id: crypto.randomUUID(), text, listId })
  },
  mutationFn: async (listId, text) => {
    const { txid } = await api.bootstrap({ listId, text })
    await Promise.all([
      listCollection.utils.awaitTxId(txid),
      todoCollection.utils.awaitTxId(txid),
    ])
  },
})
```

## Common Mistakes

### [CRITICAL] Not returning txid from write API

Wrong:

```typescript
// Server
app.post('/api/todos', async (req, res) => {
  const todo = await db.insert(todosTable).values(req.body).returning()
  res.json({ todo })
})
```

Correct:

```typescript
app.post('/api/todos', async (req, res) => {
  const result = await db.transaction(async (tx) => {
    const txid = await generateTxId(tx)
    const [todo] = await tx.insert(todosTable).values(req.body).returning()
    return { todo, txid }
  })
  res.json(result)
})
```

Without txid, optimistic state never drops — UI shows duplicates or stale rows.

Source: AGENTS.md Write-path contract

### [CRITICAL] Writing directly to Electric (bidirectional assumption)

Wrong:

```typescript
const { db } = await electrify(conn, schema)
await db.todos.create({ text: 'New' })
```

Correct:

```typescript
todoCollection.insert({ id: crypto.randomUUID(), text: 'New' })
// → onInsert → API → Postgres → Electric streams back
```

Electric is read-only. Writes go through API → Postgres → Electric streams back.
There is no `electrify()` or bidirectional sync.

Source: AGENTS.md Evolution from Old Electric

### [HIGH] Using ShapeStream/useShape instead of TanStack DB collection

Wrong:

```typescript
import { useShape } from '@electric-sql/react'
const { data } = useShape({ url: '/api/todos' })
```

Correct:

```typescript
import { useLiveQuery } from '@tanstack/react-db'
const { data } = useLiveQuery((q) => q.from({ todo: todoCollection }))
```

`useShape` is fine for simple read-only views. But most apps need writes, joins,
or multiple shapes — use collections for these.

Source: AGENTS.md line 393

### [HIGH] Not awaiting txid on ALL affected collections

Wrong:

```typescript
mutationFn: async (listId, text) => {
  const { txid } = await api.bootstrap({ listId, text })
  await listCollection.utils.awaitTxId(txid)
  // Forgot todoCollection!
}
```

Correct:

```typescript
mutationFn: async (listId, text) => {
  const { txid } = await api.bootstrap({ listId, text })
  await Promise.all([
    listCollection.utils.awaitTxId(txid),
    todoCollection.utils.awaitTxId(txid),
  ])
}
```

Multi-collection mutations must await txid on every affected collection.
Missing one leaves optimistic state indefinitely.

Source: AGENTS.md Custom optimistic actions

## Tension: Read-only sync vs write-path expectations

Electric only syncs data _from_ Postgres. Developers expect bidirectional sync
(especially agents trained on old Electric). Writes always go through your API
to Postgres. The collection's `onInsert`/`onUpdate`/`onDelete` handlers bridge
the gap with optimistic mutations.

Cross-reference: `electric-shapes`

## References

- [TanStack DB Overview](https://tanstack.com/db/latest/docs/overview)
- [Electric Collection](https://tanstack.com/db/latest/docs/collections/electric-collection)
- [Live Queries](https://tanstack.com/db/latest/docs/guides/live-queries)
