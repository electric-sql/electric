# AGENTS.md — Using **ElectricSQL** with **TanStack DB**

> **Audience:** coding agents and codegen tools
> **Goal:** ship fast, reliable, local-first apps by pairing **Electric** (Postgres sync engine over HTTP) with **TanStack DB** (embedded client DB with live queries & optimistic mutations).
> **Status:** current as of **2025-09-17**.

## TL;DR (what to internalize)

* **Electric = read-path sync engine** that syncs data out of Postgres into clients via HTTP (shapes → change log → client). ([Electric][1])
* **TanStack DB = client collections + live queries + transactional optimistic mutations.** Start with `queryCollectionOptions` (fetch) and swap to `electricCollectionOptions` (sync) without touching component code. ([TanStack][2])
* **Electric Collection** in TanStack DB subscribes to Electric **Shapes** (single-table, optional `where`, `columns`). ([TanStack][3])
* **Writes:** send mutations to your API, return a **Postgres txid** from the backend and **await it** in the Electric collection to drop optimistic state exactly when the replicated change arrives. ([TanStack][3])
* **Live queries** re-compute incrementally (differential dataflow) → sub-ms UI updates and painless cross-collection joins. ([TanStack][2])
* **Security & scale:** proxy auth, shape-scoped authorization, CDN caching & long-polling coalescing. Use **Electric Cloud** to skip ops. ([Electric][4])

## 🔒 Security Rules (ALWAYS FOLLOW)

1. **Never expose `SOURCE_SECRET` to the browser** — inject it server-side via your proxy.
2. **Electric HTTP API is public by default** — enforce authentication at the proxy.
3. **Put Electric behind your proxy** — never call it directly from production clients ([Electric][10]).
4. **Proxy every Electric request** — Client → Your API → Electric (apply auth/filters).
5. **Define shapes on the server/proxy** — avoid client-defined tables or WHERE clauses.

## Golden Path (minimal, end-to-end)

### 0) Create a project (fastest path)

```bash
npx @electric-sql/start my-electric-app
pnpm dev
# optional deploy
pnpm claim && pnpm deploy
```

Open the app, run `UPDATE` in Postgres; see instant UI updates. ([Electric][5])

### 1) Define the Electric proxy (server)

> **Why:** Keep Electric private, apply auth/filters, and attach credentials server-side. See Security Rules ☝️

```ts
// TanStack Start server function (similar for Next.js route handler)
import { createServerFileRoute } from '@tanstack/react-start/server'
import { ELECTRIC_PROTOCOL_QUERY_PARAMS } from '@electric-sql/client'

const ELECTRIC_SHAPE_URL = 'https://api.electric-sql.cloud/v1/shape' // or self-hosted

const serve = async ({ request }: { request: Request }) => {
  // 1) Validate user/session; decide table/filters
  const url = new URL(request.url)
  const origin = new URL(ELECTRIC_SHAPE_URL)

  // 2) Pass through only Electric protocol params (offset, live, handle, etc)
  url.searchParams.forEach((v, k) => {
    if (ELECTRIC_PROTOCOL_QUERY_PARAMS.includes(k)) origin.searchParams.set(k, v)
  })

  // 3) Server decides the shape (no table names from client)
  origin.searchParams.set('table', 'todos')
  // e.g. tenant isolation / ABAC:
  // origin.searchParams.set('where', `user_id = $1`)
  // origin.searchParams.set('params', JSON.stringify([user.id]))

  // 4) Attach Cloud creds server-side (never in client)
  origin.searchParams.set('source_id', process.env.SOURCE_ID!)
  origin.searchParams.set('secret', process.env.SOURCE_SECRET!)

  const res = await fetch(origin)
  const headers = new Headers(res.headers)
  headers.delete('content-encoding')
  headers.delete('content-length')
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
}

export const ServerRoute = createServerFileRoute('/api/todos').methods({ GET: serve })
```

### 2) Create an **Electric Collection** (client)

```ts
import { createCollection, useLiveQuery, eq } from '@tanstack/react-db'
import { electricCollectionOptions } from '@tanstack/electric-db-collection'
import { todoSchema } from './schema'

export const todoCollection = createCollection(
  electricCollectionOptions({
    id: 'todos',
    schema: todoSchema,
    getKey: (row) => row.id,
    shapeOptions: {
      url: '/api/todos'
    },
    onInsert: async ({ transaction }) => {
      const newTodo = transaction.mutations[0].modified
      const { txid } = await api.todos.create(newTodo)
      return { txid }
    },
    onUpdate: async ({ transaction }) => {
      const m = transaction.mutations[0]
      const { txid } = await api.todos.update(m.key, m.changes)
      return { txid }
    },
    onDelete: async ({ transaction }) => {
      const id = transaction.mutations[0].key
      const { txid } = await api.todos.delete(id)
      return { txid }
    },
  })
)
```

**Shape Configuration:**
- **Single-table only** with optional `where` & `columns`
- Include PK columns if using `columns`
- Shapes are **immutable** per subscription ([Electric][6])

### 3) Write-path contract (client ⇄ API ⇄ Postgres)

**Contract:**
1. UI mutates a collection (instant optimistic)
2. Collection calls your API in `onInsert`/`onUpdate`/`onDelete`
3. API writes to Postgres and returns **`txid`** from the same SQL transaction
4. Client awaits that tx on the Electric stream → drops optimistic state when change arrives

**Backend: get Postgres txid**
```ts
async function withTxid<T>(tx: any, work: () => Promise<T>) {
  const res = await tx.execute(sql`SELECT pg_current_xact_id()::xid::text as txid`)
  const txid = parseInt(res.rows[0]!.txid, 10)
  const result = await work()
  return { txid, result }
}
```

### 4) Read in components (live queries)

```tsx
import { useLiveQuery, eq } from '@tanstack/react-db'
import { todoCollection } from './collections'

export function TodoList() {
  const { data: todos } = useLiveQuery((q) =>
    q.from({ todo: todoCollection })
     .where(({ todo }) => eq(todo.completed, false))
     .orderBy(({ todo }) => todo.created_at, 'desc')
  )
  return <ul>{todos.map((todo) => <li key={todo.id}>{todo.text}</li>)}</ul>
}
```

## Mental Model (for agents)

* **Electric is a read-path sync engine** - syncs data out of Postgres into clients. You implement writes via your API. ([Electric][8])
* **Can adopt incrementally:** can start with `queryCollectionOptions` (keep your current API); later switch to `electricCollectionOptions` with no component changes ([TanStack][2])
* **Two loops, one source of truth**
  * **Inner loop:** optimistic mutations in TanStack DB in the client (instant UX, rollback on error)
  * **Outer loop:** server persistence → Electric streams authoritative changes → collections merge & drop optimistic ([TanStack][2])

## Live Query Patterns

TanStack DB provides SQL-like queries with **sub-millisecond performance** using differential dataflow:

### Basic filtering and sorting
```typescript
const { data: activeTodos } = useLiveQuery((q) =>
  q.from({ todo: todoCollection })
   .where(({ todo }) => eq(todo.completed, false))
   .orderBy(({ todo }) => todo.createdAt, 'desc')
   .limit(50)
)
```

### Live query dependencies
```typescript
const [ direction, setDirection ] = useState('desc')
const { data: activeTodos } = useLiveQuery((q) =>
  q.from({ todo: todoCollection })
   .orderBy(({ todo }) => todo.createdAt, direction)
   .limit(50),
  [direction] // live query pipeline is re-created when `direction` changes
)
```

### Cross-collection joins
```typescript
const { data: todosWithLists } = useLiveQuery((q) =>
  q.from({ todo: todoCollection })
   .join({ user: userCollection }, ({ todo, user }) => eq(todo.user_id, user.id))
   .where(({ user }) => eq(u.active, true))
   .select(({ todo, user }) => ({
     id: todo.id,
     text: todo.text,
     userName: user.name
   }))
)
```

### Aggregations and grouping
```typescript
const { data: listStats } = useLiveQuery((q) =>
  q.from({ todo: todoCollection })
   .join({ list: listCollection },
         ({ todo, list }) => eq(list.id, todo.listId))
   .groupBy(({ list }) => list.id)
   .select(({ todo, list }) => ({
     listId: list.id,
     listName: list.name,
     totalTodos: count(todo.id),
     completedTodos: count(when(eq(todo.completed, true), todo.id))
   }))
)
```

**Performance:** Sub-millisecond queries with incremental updates via differential dataflow ([TanStack][7])

## Optimistic Mutations

### Direct collection mutations
```typescript
function TodoActions() {
  const handleAdd = () => {
    todoCollection.insert({
      id: crypto.randomUUID(),
      text: 'New todo',
      completed: false,
      createdAt: Date.now()
    })
  }

  const handleToggle = (todo) => {
    todoCollection.update(todo.id, (draft) => {
      draft.completed = !draft.completed
    })
  }

  const handleDelete = (todoId) => {
    todoCollection.delete(todoId)
  }
}
```

### Custom optimistic actions

Useful for performing multiple operations, potentially across collections, within a single transaction.

```typescript
import { createOptimisticAction } from '@tanstack/react-db'

const addTodoAction = createOptimisticAction<string>({
  onMutate: (text) => {
    todoCollection.insert({
      id: crypto.randomUUID(),
      text,
      completed: false,
      createdAt: Date.now()
    })
  },
  mutationFn: async (text) => {
    const { txid } = await api.todos.create({ text, completed: false })
    // explicitly await for the transaction ID using utils.awaitTxId()
    await todoCollection.utils.awaitTxId(txid)
  }
})
```

See also `createTransaction`.

## Testing

Electric collections are just HTTP clients - can test with standard fetch mocks:

```typescript
import { vi } from 'vitest'

// Mock the fetch client
const mockFetch = vi.fn()
const todoCollection = createCollection(
  electricCollectionOptions({
    shapeOptions: {
      url: '/api/todos',
      fetchClient: mockFetch,  // inject mock
      onError: (error) => console.error('Shape error:', error)
    },
    onInsert: async ({ transaction }) => {
      return await api.todos.create(transaction.mutations[0].modified)
    }
  })
)

// Test optimistic updates
it('handles optimistic updates', async () => {
  mockFetch.mockResolvedValueOnce(/* mock shape response */)
  const tx = todoCollection.insert({ text: 'Test todo' })
  expect(tx.state).toBe('optimistic')
  // ... await and assert
})
```

See [TanStack DB tests](https://github.com/TanStack/db/tree/main/packages/electric-db-collection/tests) for more examples.

## ⚠️ Gotchas & Pitfalls

### Critical Gotchas

#### 0. Use the latest package versions
Search npm and use the latest versions for `@electric-sql/*` and `@tanstack/*-db` packages.

#### 1. The txid handshake (prevents flickering)
Both backend and client must handle txid for smooth optimistic updates:

```typescript
onInsert: async ({ transaction }) => {
  // Backend: Return txid from the same Postgres transaction
  const { txid } = await api.todos.create(transaction.mutations[0].modified)
  // Client: Returning the `txid` (or using utils.awaitTxId in an explicit transaction)
  // waits for Electric to sync the transaction back before discarding the optimistic state.
  return { txid }
}
```

**Without this pattern:** UI flickers as optimistic state drops before synced state arrives.

#### 2. Slow shapes in local development
Local dev uses HTTP/1.1 (6 connection limit). Each shape = 1 long-poll connection.
**Fix:** Use HTTP/2 proxy (Caddy/nginx) or Electric Cloud. See [troubleshooting guide](https://electric-sql.com/docs/guides/troubleshooting#slow-shapes)

#### 3. Proxy must forward headers & protocol params
Must preserve Electric query params and protocol headers in proxy. See Define the Electric proxy ☝️

#### 4. Parsing custom Postgres types into Javascript objects
Use a custom `parser` in the shapeOptions ([Electric][9]):

```ts
shapeOptions: {
  // ...,
  parser: { // E.g.: parse timestamp columns into Date objects
    timestamptz: (date: string) => new Date(date),
  }
}
```

### Common Pitfalls (and fixes)

* **Shape surprises:** Shapes are **single-table** and **immutable** per subscription. To "change" a shape, start a new subscription / create a new collection with a factory function ([Electric][6])
* **Unstable keys:** always set a stable `getKey` for collections (e.g., PK) ([TanStack][3])
* **Over-fetching sync:** avoid `replica=full` unless you need `old_value` (bandwidth trade-off) ([Electric][9])
* **Mixing Query vs Electric semantics:** Query collections treat `queryFn` results as **complete state**. Electric collections stream **diffs**; don't copy Query refetch patterns into Electric ([TanStack][12])
* **Dropping tables:** delete any active shapes for that table first; Postgres logical replication doesn't stream DDL ([Electric][6])

## Advanced Patterns

### Incremental adoption
Start with QueryCollection, migrate to ElectricCollection:

```typescript
// Phase 1: REST API with optimistic updates
const todoCollection = createCollection(
  queryCollectionOptions({
    queryKey: ['todos'],
    queryFn: () => api.todos.getAll(),
    // ... mutation handlers
  })
)

// Phase 2: Add real-time sync (same component code works)
const todoCollection = createCollection(
  electricCollectionOptions({
    shapeOptions: { url: '/api/todos' },
    // ... same mutation handlers
  })
)
```

## Framework integrations

```sh
npm install @tanstack/angular-db
npm install @tanstack/react-db
npm install @tanstack/solid-db
npm install @tanstack/svelte-db
npm install @tanstack/vue-db
```

```typescript
import { useLiveQuery } from '...'

const { data, isLoading } = useLiveQuery((q) =>
  q.from({ todos: todosCollection })
)
```

### React Native requirements
```bash
npm install react-native-random-uuid
```
```typescript
// Entry point (App.js/index.js)
import 'react-native-random-uuid'
```

## Migration Playbook (existing TanStack Query apps)

1. Wrap existing `useQuery` route into a **Query Collection** (`queryCollectionOptions`)
2. Replace selectors/derivations with **live queries**
3. Port mutations to **collection handlers** (optimistic by default)
4. Switch the collection to **Electric Collection** (proxy in place)
   No component changes needed ([TanStack][2])

## Deployment

### Electric Cloud (recommended - easiest)
```bash
npx @electric-sql/start my-app

pnpm claim
pnpm deploy
```

### Self-hosted Electric

Run using Docker:

```bash
docker run -e DATABASE_URL=postgres://... electricsql/electric
```

Local Docker compose:

```yaml
name: "electric-backend"
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: electric
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: password
    ports:
      - 54321:5432
    volumes:
      - ./postgres.conf:/etc/postgresql/postgresql.conf:ro
    tmpfs:
      - /var/lib/postgresql/data
      - /tmp
    command:
      - postgres
      - -c
      - config_file=/etc/postgresql/postgresql.conf

  backend:
    image: electricsql/electric:canary
    environment:
      DATABASE_URL: postgresql://postgres:password@postgres:5432/electric?sslmode=disable
      ELECTRIC_INSECURE: true # Not suitable for production
    ports:
      - 3000:3000
    depends_on:
      - postgres
```

### Postgres requirements
- PostgreSQL 14+ with logical replication enabled
- DB user with `REPLICATION` role
  - Creates `electric_publication_default` publication
  - Creates `electric_slot_default` replication slot
- Requires `wal_level=logical` configuration

## Recommended Stack (web & mobile)

* **DB:** Postgres (any host with logical replication: Neon, Supabase, Crunchy)
* **Backend:** TanStack Start + Drizzle (schemas/migrations) + tRPC/REST for writes
* **Proxy:** Edge function / server route (see Golden Path section 1)
* **Client:** TanStack DB (React adapter for web; Expo starter for RN)

This "End-to-End TypeScript" stack is what the official starters use. ([Electric][14])

## What Changed vs Older Mental Models (avoid stale assumptions)

### Electric Has Evolved (avoid outdated patterns):
* **Old Electric:** Bidirectional SQLite sync, handled reads + writes directly
* **New Electric:** Read-only HTTP streaming from Postgres ([Electric][1])
* **Complete solution:** Electric (reads) + TanStack DB (optimistic writes via your API) = full local-first

### Don't generate these old patterns
```typescript
// ❌ OLD APIs (don't exist anymore)
const { db } = await electrify(conn, schema)
await db.todos.create({ text: 'New todo' })

// ✅ NEW pattern: TanStack DB collections
const todos = createCollection(
  electricCollectionOptions({
    shapeOptions: { url: '/api/todos' },
    onInsert: async ({ transaction }) => {
      const { txid } = await api.todos.create(transaction.mutations[0].modified)
      await todos.utils.awaitTxId(txid)
      return { txid }
    }
  })
)
todos.insert({ text: 'New todo' })  // Optimistic + sync
```

* Old Electric "include-tree" shapes don't exist → use **new single-table Electric shapes** and join in client ([GitHub][6])
* Don't use RLS/row-filters in Electric itself for auth; **authorize at the HTTP proxy** you control ([GitHub][4])

### Write path clarity

Electric doesn't handle writes from the client back into Postgres, but **TanStack DB does**, **through your API**:

1. `todos.insert()` → optimistic update (instant UI)
2. `onInsert` handler → your API → Postgres (returns txid)
3. Electric streams change back → TanStack DB reconciles → discards optimistic state

This gives you full control over auth/business logic while maintaining instant local-first UX ([TanStack][3])

### Prefer TanStack DB over lower-level Shape APIs

The Electric TypeScript Client provides lower-level `Shape` / `ShapeStream` classes and `useShape` hook ([Electric][9]):

```ts
import { Shape, ShapeStream } from '@electric-sql/client'
const stream = new ShapeStream({...})
const shape = new Shape(stream)

import { useShape } from '@electric-sql/react'
function Component() {
  const { data } = useShape({...})
}
```

However, for web and mobile app development, **TanStack DB collections are preferred as much more ergonomic and powerful**.

## Further Reading / Starters

* **TanStack DB overview & quick start** – docs & API reference ([TanStack][2])
* **Electric × TanStack DB** (official blog with code & txid handshake) ([Electric][15])
* **Electric Shapes, HTTP API, Auth/Security, Cloud** ([Electric][6])
* **TanStack DB Electric Collection docs** (options, proxy sample, `awaitTxId`) ([TanStack][3])
* **TanStack DB Live Queries** (query builder, joins, aggregations) ([TanStack][7])
* **Background & motivation** – TanStack blog on DB 0.1 (why differential dataflow & collections) ([TanStack][16])
* **Interactive explainer** for teams adopting TanStack DB ([Frontend at Scale][17])

### That's it

Follow the **proxy → Electric Collection → live queries → mutations → txid** pattern for local-first UX with instant reads and writes, end-to-end reactivity, clean code and a safe, scalable sync architecture.

[1]: https://electric-sql.com/docs/api/http "HTTP API | ElectricSQL"
[2]: https://tanstack.com/db/latest/docs/overview "Overview | TanStack DB Docs"
[3]: https://tanstack.com/db/latest/docs/collections/electric-collection "Electric Collection | TanStack DB Docs"
[4]: https://electric-sql.com/docs/guides/auth "Auth - Guides | ElectricSQL"
[5]: https://electric-sql.com/docs/quickstart "Quickstart | ElectricSQL"
[6]: https://electric-sql.com/docs/guides/shapes "Shapes - Guides | ElectricSQL"
[7]: https://tanstack.com/db/latest/docs/guides/live-queries "Live Queries | TanStack DB Docs"
[8]: https://electric-sql.com/blog/2024/11/21/local-first-with-your-existing-api "Local-first with your existing API | ElectricSQL"
[9]: https://electric-sql.com/docs/api/clients/typescript "TypeScript Client | ElectricSQL"
[10]: https://electric-sql.com/docs/guides/security "Security - Guides | ElectricSQL"
[11]: https://electric-sql.com/product/cloud "Cloud | ElectricSQL"
[12]: https://tanstack.com/db/latest/docs/collections/query-collection "Query Collection | TanStack DB Docs"
[13]: https://tanstack.com/db/latest/docs/guides/error-handling "Error Handling | TanStack DB Docs"
[14]: https://electric-sql.com/docs/stacks "Stacks | ElectricSQL"
[15]: https://electric-sql.com/blog/2025/07/29/local-first-sync-with-tanstack-db "Local-first sync with TanStack DB and Electric | ElectricSQL"
[16]: https://tanstack.com/blog/tanstack-db-0.1-the-embedded-client-database-for-tanstack-query "Stop Re-Rendering – TanStack DB, the Embedded Client Database for TanStack Query | TanStack Blog"
[17]: https://frontendatscale.com/blog/tanstack-db/ "An Interactive Guide to TanStack DB | Frontend at Scale"