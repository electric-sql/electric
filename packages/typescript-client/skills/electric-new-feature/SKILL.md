---
name: electric-new-feature
description: >
  End-to-end guide for adding a new synced feature with Electric and TanStack
  DB. Covers the full journey: design Postgres schema, set REPLICA IDENTITY
  FULL, define shape, create proxy route, set up TanStack DB collection with
  electricCollectionOptions, implement optimistic mutations with txid
  handshake (pg_current_xact_id, awaitTxId), and build live queries with
  useLiveQuery. Also covers migration from old ElectricSQL (electrify/db
  pattern does not exist), current API patterns (table as query param not
  path, handle not shape_id). Load when building a new feature from scratch.
type: lifecycle
library: electric
library_version: '1.5.10'
requires:
  - electric-shapes
  - electric-proxy-auth
  - electric-schema-shapes
sources:
  - 'electric-sql/electric:AGENTS.md'
  - 'electric-sql/electric:examples/tanstack-db-web-starter/'
---

This skill builds on electric-shapes, electric-proxy-auth, and electric-schema-shapes. Read those first.

# Electric — New Feature End-to-End

## Setup

### 0. Start Electric locally

```yaml
# docker-compose.yml
services:
  postgres:
    image: postgres:17-alpine
    environment:
      POSTGRES_DB: electric
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: password
    ports:
      - '54321:5432'
    tmpfs:
      - /tmp
    command:
      - -c
      - listen_addresses=*
      - -c
      - wal_level=logical

  electric:
    image: electricsql/electric:latest
    environment:
      DATABASE_URL: postgresql://postgres:password@postgres:5432/electric?sslmode=disable
      ELECTRIC_INSECURE: true # Dev only — use ELECTRIC_SECRET in production
    ports:
      - '3000:3000'
    depends_on:
      - postgres
```

```bash
docker compose up -d
```

### 1. Create Postgres table

```sql
CREATE TABLE todos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  text TEXT NOT NULL,
  completed BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE todos REPLICA IDENTITY FULL;
```

### 2. Create proxy route

The proxy forwards Electric protocol params and injects server-side secrets. Use your framework's server route pattern (TanStack Start, Next.js API route, Express, etc.).

```ts
// Example: TanStack Start — src/routes/api/todos.ts
import { createFileRoute } from '@tanstack/react-router'
import { ELECTRIC_PROTOCOL_QUERY_PARAMS } from '@electric-sql/client'

const serve = async ({ request }: { request: Request }) => {
  const url = new URL(request.url)
  const electricUrl = process.env.ELECTRIC_URL || 'http://localhost:3000'
  const origin = new URL(`${electricUrl}/v1/shape`)

  url.searchParams.forEach((v, k) => {
    if (ELECTRIC_PROTOCOL_QUERY_PARAMS.includes(k))
      origin.searchParams.set(k, v)
  })

  origin.searchParams.set('table', 'todos')

  // Add auth if using Electric Cloud
  if (process.env.ELECTRIC_SOURCE_ID && process.env.ELECTRIC_SECRET) {
    origin.searchParams.set('source_id', process.env.ELECTRIC_SOURCE_ID)
    origin.searchParams.set('secret', process.env.ELECTRIC_SECRET)
  }

  const res = await fetch(origin)
  const headers = new Headers(res.headers)
  headers.delete('content-encoding')
  headers.delete('content-length')
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  })
}

export const Route = createFileRoute('/api/todos')({
  server: {
    handlers: {
      GET: serve,
    },
  },
})
```

### 3. Define schema

```ts
// db/schema.ts — Zod schema matching your Postgres table
import { z } from 'zod'

export const todoSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  text: z.string(),
  completed: z.boolean(),
  created_at: z.date(),
})

export type Todo = z.infer<typeof todoSchema>
```

If using Drizzle, generate schemas from your table definitions with `createSelectSchema(todosTable)` from `drizzle-zod`.

### 4. Create mutation endpoint

Implement your write endpoint using your framework's server function or API route. The endpoint must return `{ txid }` from the same transaction as the mutation.

```ts
// Example: server function that inserts and returns txid
async function createTodo(todo: { text: string; user_id: string }) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await client.query(
      'INSERT INTO todos (text, user_id) VALUES ($1, $2) RETURNING id',
      [todo.text, todo.user_id]
    )
    const txResult = await client.query(
      'SELECT pg_current_xact_id()::xid::text AS txid'
    )
    await client.query('COMMIT')
    return { id: result.rows[0].id, txid: Number(txResult.rows[0].txid) }
  } finally {
    client.release()
  }
}
```

### 5. Create TanStack DB collection

```ts
import { createCollection } from '@tanstack/react-db'
import { electricCollectionOptions } from '@tanstack/electric-db-collection'
import { todoSchema } from './db/schema'

export const todoCollection = createCollection(
  electricCollectionOptions({
    id: 'todos',
    schema: todoSchema,
    getKey: (row) => row.id,
    shapeOptions: {
      url: new URL(
        '/api/todos',
        typeof window !== 'undefined'
          ? window.location.origin
          : 'http://localhost:5173'
      ).toString(),
      // Electric auto-parses: bool, int2, int4, float4, float8, json, jsonb
      // You only need custom parsers for types like timestamptz, date, numeric
      // See electric-shapes/references/type-parsers.md for the full list
      parser: {
        timestamptz: (date: string) => new Date(date),
      },
    },
    onInsert: async ({ transaction }) => {
      const { modified: newTodo } = transaction.mutations[0]
      const result = await createTodo({
        text: newTodo.text,
        user_id: newTodo.user_id,
      })
      return { txid: result.txid }
    },
    onUpdate: async ({ transaction }) => {
      const { modified: updated } = transaction.mutations[0]
      const result = await updateTodo(updated.id, {
        text: updated.text,
        completed: updated.completed,
      })
      return { txid: result.txid }
    },
    onDelete: async ({ transaction }) => {
      const { original: deleted } = transaction.mutations[0]
      const result = await deleteTodo(deleted.id)
      return { txid: result.txid }
    },
  })
)
```

### 6. Build live queries

```tsx
import { useLiveQuery, eq } from '@tanstack/react-db'

export function TodoList() {
  const { data: todos } = useLiveQuery((q) =>
    q
      .from({ todo: todoCollection })
      .where(({ todo }) => eq(todo.completed, false))
      .orderBy(({ todo }) => todo.created_at, 'desc')
      .limit(50)
  )

  return (
    <ul>
      {todos.map((todo) => (
        <li key={todo.id}>{todo.text}</li>
      ))}
    </ul>
  )
}
```

### 7. Optimistic mutations

```tsx
const handleAdd = () => {
  todoCollection.insert({
    id: crypto.randomUUID(),
    text: 'New todo',
    completed: false,
    created_at: new Date(),
  })
}

const handleToggle = (todo) => {
  todoCollection.update(todo.id, (draft) => {
    draft.completed = !draft.completed
  })
}

const handleDelete = (todoId) => todoCollection.delete(todoId)
```

## Common Mistakes

### HIGH Removing parsers because the TanStack DB schema handles types

Wrong:

```ts
// "My Zod schema has z.coerce.date() so I don't need a parser"
electricCollectionOptions({
  schema: z.object({ created_at: z.coerce.date() }),
  shapeOptions: { url: '/api/todos' }, // No parser!
})
```

Correct:

```ts
electricCollectionOptions({
  schema: z.object({ created_at: z.coerce.date() }),
  shapeOptions: {
    url: '/api/todos',
    parser: { timestamptz: (date: string) => new Date(date) },
  },
})
```

Electric's sync path delivers data directly into the collection store, bypassing the TanStack DB schema. The `parser` in `shapeOptions` handles type coercion on the sync path; the schema handles the mutation path. You need both. Without the parser, `timestamptz` arrives as a string and `getTime()` or other Date methods will fail at runtime.

### CRITICAL Using old electrify() bidirectional sync API

Wrong:

```ts
const { db } = await electrify(conn, schema)
await db.todos.create({ text: 'New todo' })
```

Correct:

```ts
todoCollection.insert({ id: crypto.randomUUID(), text: 'New todo' })
// Write path: collection.insert() → onInsert → API → Postgres → txid → awaitTxId
```

Old ElectricSQL (v0.x) had bidirectional SQLite sync. Current Electric is read-only. Writes go through your API endpoint and are reconciled via txid handshake.

Source: `AGENTS.md:386-392`

### HIGH Using path-based table URL pattern

Wrong:

```ts
const stream = new ShapeStream({
  url: 'http://localhost:3000/v1/shape/todos?offset=-1',
})
```

Correct:

```ts
const stream = new ShapeStream({
  url: 'http://localhost:3000/v1/shape?table=todos&offset=-1',
})
```

The table-as-path-segment pattern (`/v1/shape/todos`) was removed in v0.8.0. Table is now a query parameter.

Source: `packages/sync-service/CHANGELOG.md:1124`

### MEDIUM Using shape_id instead of handle

Wrong:

```ts
const stream = new ShapeStream({
  url: '/api/todos',
  params: { shape_id: '12345' },
})
```

Correct:

```ts
const stream = new ShapeStream({
  url: '/api/todos',
  handle: '12345',
})
```

Renamed from `shape_id` to `handle` in v0.8.0.

Source: `packages/sync-service/CHANGELOG.md:1123`

See also: electric-orm/SKILL.md — Getting txid from ORM transactions.
See also: electric-proxy-auth/SKILL.md — E2E feature journey includes setting up proxy routes.

## Version

Targets @electric-sql/client v1.5.10, @tanstack/react-db latest.
