---
name: tanstack-start-quickstart
description: >
  Full-stack TanStack Start setup — createFileRoute server handlers, proxy
  routes, Electric collections, Drizzle schema, migrations, server functions,
  ELECTRIC_PROTOCOL_QUERY_PARAMS, electricCollectionOptions
type: composition
library: '@electric-sql/client'
library_version: '1.5.8'
requires:
  - '@tanstack/react-start'
  - '@tanstack/react-db'
  - '@tanstack/electric-db-collection'
  - 'drizzle-orm'
sources:
  - 'electric:AGENTS.md'
  - 'electric:examples/tanstack-db-web-starter'
---

# TanStack Start Quickstart

Full-stack setup with TanStack Start, Electric sync, and Drizzle ORM.

## Setup

```bash
npx gitpick electric-sql/electric/tree/main/examples/tanstack-db-web-starter my-app
cd my-app
cp .env.example .env
pnpm install
pnpm dev
# in new terminal
pnpm migrate
```

## Core Patterns

### Proxy Route (Server)

```typescript
// src/routes/api/todos.ts
import { createFileRoute } from '@tanstack/react-router'
import { ELECTRIC_PROTOCOL_QUERY_PARAMS } from '@electric-sql/client'

const serve = async ({ request }: { request: Request }) => {
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session) {
    return new Response('Unauthorized', { status: 401 })
  }

  const url = new URL(request.url)
  const origin = new URL(`${process.env.ELECTRIC_URL}/v1/shape`)

  url.searchParams.forEach((v, k) => {
    if (ELECTRIC_PROTOCOL_QUERY_PARAMS.includes(k))
      origin.searchParams.set(k, v)
  })

  origin.searchParams.set('table', 'todos')
  origin.searchParams.set('where', 'user_id = $1')
  origin.searchParams.set('params', JSON.stringify([session.user.id]))

  if (process.env.ELECTRIC_SOURCE_ID) {
    origin.searchParams.set('source_id', process.env.ELECTRIC_SOURCE_ID)
    origin.searchParams.set('secret', process.env.ELECTRIC_SECRET!)
  }

  const res = await fetch(origin)
  const headers = new Headers(res.headers)
  headers.delete('content-encoding')
  headers.delete('content-length')
  headers.set('vary', 'authorization')

  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  })
}

export const Route = createFileRoute('/api/todos')({
  server: { handlers: { GET: serve } },
})
```

### Collection (Client)

```typescript
// src/lib/collections.ts
import { createCollection } from '@tanstack/react-db'
import { electricCollectionOptions } from '@tanstack/electric-db-collection'
import { selectTodoSchema } from '@/db/schema'

export const todoCollection = createCollection(
  electricCollectionOptions({
    id: 'todos',
    schema: selectTodoSchema,
    getKey: (item) => item.id,
    shapeOptions: { url: '/api/todos' },
    onInsert: async ({ transaction }) => {
      const { txid } = await api.todos.create(transaction.mutations[0].modified)
      return { txid }
    },
  })
)
```

### Drizzle Schema + Migrations

```typescript
// src/db/schema.ts
import {
  pgTable,
  integer,
  varchar,
  boolean,
  timestamp,
} from 'drizzle-orm/pg-core'

export const todosTable = pgTable('todos', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  text: varchar({ length: 500 }).notNull(),
  completed: boolean().notNull().default(false),
  created_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
})
```

```bash
pnpm drizzle-kit generate && pnpm drizzle-kit migrate
```

### Live Query UI

```tsx
import { useLiveQuery } from '@tanstack/react-db'

function Todos() {
  const { data } = useLiveQuery((q) =>
    q
      .from({ todo: todoCollection })
      .orderBy(({ todo }) => todo.created_at, 'desc')
  )
  return (
    <ul>
      {data.map((t) => (
        <li key={t.id}>{t.text}</li>
      ))}
    </ul>
  )
}
```

## Common Mistakes

### [CRITICAL] Exposing ELECTRIC_SECRET in client code

Wrong:

```typescript
// This runs in the browser!
const stream = new ShapeStream({
  url: `${ELECTRIC_URL}/v1/shape?secret=${process.env.ELECTRIC_SECRET}`,
})
```

Correct:

```typescript
// Client: no secrets
const stream = new ShapeStream({ url: '/api/todos' })

// Server route: secret stays server-side
origin.searchParams.set('secret', process.env.ELECTRIC_SECRET!)
```

TanStack Start server functions run server-side. The secret must stay there,
never in the client bundle.

Source: AGENTS.md Security Rules #1

### [CRITICAL] Not returning txid from API mutations

Wrong:

```typescript
const [todo] = await db.insert(todosTable).values(input).returning()
return { todo }
```

Correct:

```typescript
return await db.transaction(async (tx) => {
  const txid = await generateTxId(tx)
  const [todo] = await tx.insert(todosTable).values(input).returning()
  return { todo, txid }
})
```

Without txid, optimistic state in the collection never resolves.

Source: AGENTS.md Write-path contract

### [HIGH] Using useShape instead of collection for apps with writes

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

Collections provide optimistic mutations, joins, and sub-ms live queries.
`useShape` is only for simple read-only views.

Source: AGENTS.md line 393

## References

- [TanStack Start Docs](https://tanstack.com/start/latest)
- [tanstack-db-web-starter](https://github.com/electric-sql/electric/tree/main/examples/tanstack-db-web-starter)
- [Electric Collection](https://tanstack.com/db/latest/docs/collections/electric-collection)
