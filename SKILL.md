---
name: electric-sql-with-tanstack-db
description: Build fast, secure, local-first apps by combining ElectricSQL (Postgres → HTTP sync) with TanStack DB (embedded client DB, live queries, optimistic mutations).
audience: coding-agents
status: stable
last_updated: 2025-09-18
---

# ElectricSQL + TanStack DB Skill

This skill defines the **canonical integration pattern** for pairing:

- **ElectricSQL** — read-path Postgres sync over HTTP (shapes → changelog → client)
- **TanStack DB** — embedded client database with live queries and optimistic mutations

The result is **local-first UX**, **sub-ms live queries**, and **server-authoritative writes**.

---

## When to Use This Skill

Use this skill when you need:

- Live Postgres updates in the browser/mobile client
- Optimistic UI writes without flicker
- Local-first behavior with server reconciliation
- HTTP-friendly sync (CDN/cache/proxyable)
- Strict control over auth, tenancy, and data access

---

## 🔒 Security Rules (MANDATORY)

1. **NEVER expose `SOURCE_SECRET` to clients**
2. **Electric HTTP API is public by default** — protect via proxy
3. **Always proxy Electric behind server/edge**
4. **Clients must NOT define tables or WHERE clauses**
5. **Tenant isolation must be enforced server-side**

Violation of any rule = security bug.  
See: Electric security & auth guides [10][4].

---

## Architecture Overview

```
Client (TanStack DB)
   ├─ Live Queries
   ├─ Optimistic Mutations
   ↓
API (TanStack Start / Edge)
   ├─ Auth
   ├─ Write handlers (txid)
   ├─ Electric proxy
   ↓
ElectricSQL (HTTP Shapes)
   ↓
Postgres (logical replication)
```

Electric is **read-only**. All writes go through your API.  
This is the **new Electric architecture** (not the old SQLite-based sync) [8][15].

---

## Golden Path

### 0) Project Bootstrap

```bash
npx gitpick electric-sql/electric/tree/main/examples/tanstack-db-web-starter my-app
cd my-app
cp .env.example .env
pnpm install
pnpm dev

# In another terminal
pnpm migrate
```

Starter based on Electric + TanStack DB example [5][15].

---

## 1) Electric Proxy (Server)

**Purpose:** inject secrets, enforce auth, lock shapes.

```ts
import { createServerFileRoute } from '@tanstack/react-start/server'
import { ELECTRIC_PROTOCOL_QUERY_PARAMS } from '@electric-sql/client'

const ELECTRIC_URL = 'https://api.electric-sql.cloud/v1/shape'

async function serve({ request }: { request: Request }) {
  const incoming = new URL(request.url)
  const outgoing = new URL(ELECTRIC_URL)

  // Forward Electric protocol params
  incoming.searchParams.forEach((v, k) => {
    if (ELECTRIC_PROTOCOL_QUERY_PARAMS.includes(k)) {
      outgoing.searchParams.set(k, v)
    }
  })

  // Server decides shape
  outgoing.searchParams.set('table', 'todos')
  // outgoing.searchParams.set('where', 'user_id = $1')
  // outgoing.searchParams.set('params', JSON.stringify([user.id]))

  outgoing.searchParams.set('source_id', process.env.SOURCE_ID!)
  outgoing.searchParams.set('secret', process.env.SOURCE_SECRET!)

  const res = await fetch(outgoing)
  const headers = new Headers(res.headers)
  headers.delete('content-encoding')
  headers.delete('content-length')

  return new Response(res.body, {
    status: res.status,
    headers,
  })
}

export const ServerRoute = createServerFileRoute('/api/todos').methods({
  GET: serve,
})
```

- Shapes must be **defined server-side** [6].
- Electric HTTP API is **public unless proxied** [10].

---

## 2) Database Schema (Postgres)

```ts
import { pgTable, text, boolean, timestamp } from 'drizzle-orm/pg-core'

export const todos = pgTable('todos', {
  id: text('id').primaryKey(),
  text: text('text').notNull(),
  completed: boolean('completed').notNull().default(false),
  userId: text('user_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
})
```

Postgres requirements: v14+, logical replication, REPLICATION role [14].

---

## 3) Client Schema

```ts
import { z } from 'zod'

export const todoSchema = z.object({
  id: z.string(),
  text: z.string(),
  completed: z.boolean(),
  userId: z.string(),
  createdAt: z.date(),
})
```

---

## 4) Electric Collection (Client)

```ts
import { createCollection } from '@tanstack/react-db'
import { electricCollectionOptions } from '@tanstack/electric-db-collection'
import { todoSchema } from './schema'

export const todoCollection = createCollection(
  electricCollectionOptions({
    id: 'todos',
    schema: todoSchema,
    getKey: (row) => row.id,
    shapeOptions: {
      url: '/api/todos',
      parser: {
        timestamptz: (v: string) => new Date(v),
      },
    },

    onInsert: async ({ transaction }) => {
      const todo = transaction.mutations[0].modified
      const { txid } = await api.todos.create(todo)
      return { txid }
    },

    onUpdate: async ({ transaction }) => {
      const todo = transaction.mutations[0].modified
      const { txid } = await api.todos.update(todo)
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

Electric collections subscribe to **single-table shapes** [3][6].

---

## 5) Write Path + txid Contract

Every write **must return the Postgres txid**.

```sql
SELECT pg_current_xact_id()::xid::text AS txid
```

Flow:

1. Client mutates collection (optimistic)
2. API writes to Postgres
3. API returns txid
4. Electric streams change
5. Client awaits txid → drops optimistic state

This prevents UI flicker [3][7].

---

## 6) Live Queries

```tsx
import { useLiveQuery, eq } from '@tanstack/react-db'

export function TodoList() {
  const { data } = useLiveQuery((q) =>
    q
      .from({ todo: todoCollection })
      .where(({ todo }) => eq(todo.completed, false))
      .orderBy(({ todo }) => todo.createdAt, 'desc')
      .limit(50)
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

- Differential dataflow
- Sub-ms recomputation
- Cross-collection joins & aggregations [7][16][17]

---

## 7) Optimistic Actions (Advanced)

```ts
import { createOptimisticAction } from '@tanstack/react-db'

export const bootstrapTodoList = createOptimisticAction<string>({
  onMutate: (listId, text) => {
    listCollection.insert({ id: listId })
    todoCollection.insert({
      id: crypto.randomUUID(),
      text,
      completed: false,
    })
  },

  mutationFn: async (listId, text) => {
    const { txid } = await api.todos.bootstrap(listId, text)
    await Promise.all([
      listCollection.utils.awaitTxId(txid),
      todoCollection.utils.awaitTxId(txid),
    ])
  },
})
```

---

## 8) Testing

```ts
shapeOptions: {
  url: '/api/todos',
  fetchClient: vi.fn(),
  onError: (err) => console.error(err),
}
```

Error handling guide: [13].

---

## ⚠️ Critical Gotchas

- Shapes are immutable per subscription [6]
- HTTP/1.1 limits cause slow local dev → use HTTP/2 [18]
- Always forward Electric protocol params [1]
- Include PK when selecting columns [6]
- Prefer collections over `useShape` [3][9]

---

## Deployment

### Electric Cloud

```bash
npx @electric-sql/start my-app
pnpm claim
pnpm deploy
```

Managed hosting & scaling [11].

### Self-Hosted

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: electric
      POSTGRES_PASSWORD: password
    command: ["postgres", "-c", "wal_level=logical"]

  electric:
    image: electricsql/electric:canary
    environment:
      DATABASE_URL: postgres://postgres:password@postgres:5432/electric
      ELECTRIC_INSECURE: true
    ports: ["3000:3000"]
```

---

## Migration Notes (Old Electric → New)

❌ Old: bidirectional SQLite sync  
✅ New: Postgres → Electric (read-only) + API writes + TanStack DB optimistic state [8][15]

---

## Summary

This skill enables:

- Local-first UX
- Server-authoritative writes
- Zero polling
- Secure, proxy-enforced access
- Sub-ms live queries

Use this as the **default, blessed pattern** for ElectricSQL + TanStack DB.

---

## References

[1] https://electric-sql.com/docs/api/http.md  
[2] https://tanstack.com/db/latest/docs/overview.md  
[3] https://tanstack.com/db/latest/docs/collections/electric-collection.md  
[4] https://electric-sql.com/docs/guides/auth.md  
[5] https://electric-sql.com/docs/quickstart.md  
[6] https://electric-sql.com/docs/guides/shapes.md  
[7] https://tanstack.com/db/latest/docs/guides/live-queries.md  
[8] https://electric-sql.com/blog/2024/11/21/local-first-with-your-existing-api.md  
[9] https://electric-sql.com/docs/api/clients/typescript.md  
[10] https://electric-sql.com/docs/guides/security.md  
[11] https://electric-sql.com/product/cloud.md  
[12] https://tanstack.com/db/latest/docs/collections/query-collection.md  
[13] https://tanstack.com/db/latest/docs/guides/error-handling.md  
[14] https://electric-sql.com/docs/stacks.md  
[15] https://electric-sql.com/blog/2025/07/29/local-first-sync-with-tanstack-db.md  
[16] https://tanstack.com/blog/tanstack-db-0.1-the-embedded-client-database-for-tanstack-query.md  
[17] https://frontendatscale.com/blog/tanstack-db/  
[18] https://electric-sql.com/docs/guides/troubleshooting.md#slow-shapes
