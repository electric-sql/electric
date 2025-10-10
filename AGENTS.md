# AGENTS.md – ElectricSQL + TanStack DB

> **Audience:** coding agents/codegen tools
> **Goal:** ship fast, reliable, local-first apps by pairing **Electric** (Postgres sync engine over HTTP) with **TanStack DB** (embedded client DB with live queries & optimistic mutations).
> **Status:** current as of **2025-09-18**.

## TL;DR

* **Electric:** read-path sync Postgres→clients via HTTP (shapes→changelog→client) ([Electric][1])
* **TanStack DB:** client collections+live queries+transactional optimistic mutations. Swap `queryCollectionOptions`→`electricCollectionOptions` without touching components ([TanStack][2])
* **Electric Collection:** subscribes to Electric Shapes (single-table, optional `where`/`columns`) ([TanStack][3])
* **Writes:** mutations→API→Postgres txid→await in Electric collection→drop optimistic state when change arrives ([TanStack][3])
* **Live queries:** differential dataflow→sub-ms updates+cross-collection joins ([TanStack][2])
* **Security/scale:** proxy auth, shape-scoped authorization, CDN caching. Use Electric Cloud to skip ops ([Electric][4])

## 🔒 Security Rules (ALWAYS)

1. **Never expose `SOURCE_SECRET` to browser** – inject server-side via proxy
2. **Electric HTTP API public by default** – enforce auth at proxy
3. **Put Electric behind server/proxy** – never call directly from production ([Electric][10])
5. **Define shapes in server/proxy** – no client-defined tables/WHERE clauses

## Golden Path

### 0) Create project
```sh
npx gitpick electric-sql/electric/tree/main/examples/tanstack-db-web-starter my-tanstack-db-project
cd my-tanstack-db-project
cp .env.example .env
pnpm install
pnpm dev
# in new terminal
pnpm migrate
```

### 1) Electric proxy (server)
```ts
// TanStack Start server function
import { createServerFileRoute } from '@tanstack/react-start/server'
import { ELECTRIC_PROTOCOL_QUERY_PARAMS } from '@electric-sql/client'

const ELECTRIC_URL = 'https://api.electric-sql.cloud/v1/shape'

const serve = async ({ request }: { request: Request }) => {
  const url = new URL(request.url)
  const origin = new URL(ELECTRIC_URL)

  // Pass Electric protocol params
  url.searchParams.forEach((v, k) => {
    if (ELECTRIC_PROTOCOL_QUERY_PARAMS.includes(k)) origin.searchParams.set(k, v)
  })

  // Server decides shape
  origin.searchParams.set('table', 'todos')
  // Tenant isolation: origin.searchParams.set('where', `user_id=$1`)
  // origin.searchParams.set('params', JSON.stringify([user.id]))
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

### 2) Electric Collection (client)
```ts
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
    // onUpdate/onDelete same pattern
  })
)
```

**Shape config:**
- Single-table only + optional `where`/`columns`
- Include PK if using `columns`
- Shapes immutable per subscription ([Electric][6]) use collection factory function to make dynamic

### 3) Write-path contract
1. UI mutates collection (instant optimistic)
2. Collection calls API in `onInsert`/`onUpdate`/`onDelete`
3. API writes Postgres, returns txid
4. Client awaits tx on Electric stream→drops optimistic state

**Backend: get Postgres txid and return as an integer**
```sql
SELECT pg_current_xact_id()::xid::text as txid
```

### 4) Live queries
TanStack DB SQL-like queries **sub-ms performance** differential dataflow ([TanStack][7]):

```tsx
import { useLiveQuery, eq } from '@tanstack/react-db'

export function TodoList() {
  const { data: todos } = useLiveQuery((q) =>
    q.from({ todo: todoCollection })
     .where(({ todo }) => eq(todo.completed, false))
     .orderBy(({ todo }) => todo.created_at, 'desc')
     .limit(50)
  )
  return <ul>{todos.map((todo) => <li key={todo.id}>{todo.text}</li>)}</ul>
}
```

Dependencies:
```tsx
const [direction, setDirection] = useState('desc')
const { data } = useLiveQuery((q) =>
  q.from({ todo: todoCollection })
   .orderBy(({ todo }) => todo.createdAt, direction)
   .limit(50),
  [direction]
)
```

Cross-collection joins:
```tsx
.join({ user: userCollection }, ({ todo, user }) => eq(todo.user_id, user.id))
.where(({ user }) => eq(u.active, true))
.select(({ todo, user }) => ({ id: todo.id, text: todo.text, userName: user.name }))
```

Aggregations:
```tsx
.groupBy(({ todo }) => todo.listId)
.select(({ todo }) => ({ listId: todo.listId, totalTodos: count(todo.id) }))
```

## Optimistic Mutations

### Direct mutations
```tsx
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
  const handleDelete = (todoId) => todoCollection.delete(todoId)
}
```

### Custom optimistic actions
```tsx
import { createOptimisticAction } from '@tanstack/react-db'

const bootstrapTodoListAction = createOptimisticAction<string>({
  onMutate: (listId, itemText) => {
    listCollection.insert({id: listId})
    todoCollection.insert({id: crypto.randomUUID(), text: itemText, listId})
  },
  mutationFn: async (listId, itemText) => {
    const { txid } = await api.todos.bootstrapTodoList({ listId, itemText })
    await Promise.all([listCollection.utils.awaitTxId(txid), todoCollection.utils.awaitTxId(txid)])
  }
})
```

## Testing
```ts
shapeOptions: {
  url: '/api/todos',
  fetchClient: vi.fn(), // mock fetch
  onError: (error) => // ... handle fetch errors
}
```

## ⚠️ Critical Gotchas

1. **Use latest packages** - Check npm for `@electric-sql/*` & `@tanstack/*-db`
2. **txid handshake required** - Prevents UI flicker when optimistic→synced state
3. **Local dev slow shapes** - HTTP/1.1 6-connection limit. Fix: HTTP/2 proxy (Caddy/nginx) or Electric Cloud ([Electric][18])
4. **Proxy must forward headers/params** - Preserve Electric query params
5. **Parse custom types:**
```ts
shapeOptions: {
  parser: { timestamptz: (date: string) => new Date(date) }
}
```

## Framework integrations
```sh
npm install @tanstack/{angular,react,solid,svelte,vue}-db
```
```ts
import { useLiveQuery } from '...'
const { data, isLoading } = useLiveQuery((q) => q.from({ todos: todosCollection }))
```

**React Native:** Requires `react-native-random-uuid` + import in entry point

## Migration from TanStack Query
1. Wrap `useQuery` in Query Collection (`queryCollectionOptions`)
2. Replace selectors with live queries
3. Port mutations to collection handlers
4. Switch to Electric Collection (no component changes)

## Deployment

### Electric Cloud
```sh
npx @electric-sql/start my-app
pnpm claim && pnpm deploy
```

### Self-hosted
```sh
docker run -e DATABASE_URL=postgres://... electricsql/electric
```

Docker compose:
```yaml
name: "electric-backend"
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: electric
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: password
    ports: ["54321:5432"]
    volumes: ["./postgres.conf:/etc/postgresql/postgresql.conf:ro"]
    tmpfs: ["/var/lib/postgresql/data", "/tmp"]
    command: ["postgres", "-c", "config_file=/etc/postgresql/postgresql.conf"]

  backend:
    image: electricsql/electric:canary
    environment:
      DATABASE_URL: postgresql://postgres:password@postgres:5432/electric?sslmode=disable
      ELECTRIC_INSECURE: true
    ports: ["3000:3000"]
    depends_on: ["postgres"]
```

**Postgres requirements:** v14+, logical replication, user with REPLICATION role, `wal_level=logical`

## Stack (web/mobile)
* **DB:** Postgres (Neon/Supabase/Crunchy with logical replication)
* **Backend:** TanStack Start+Drizzle+tRPC/REST
* **Proxy:** Edge function/server route
* **Client:** TanStack DB (React/Expo)

## Evolution from Old Electric

**Old:** Bidirectional SQLite sync, handled reads+writes
**New:** Electric (Read-only HTTP streaming from Postgres) + TanStack DB (optimistic writes via API)

Avoid old patterns:
```ts
// ❌ OLD (doesn't exist)
const { db } = await electrify(conn, schema)
await db.todos.create({ text: 'New todo' })
```

Write path: `todos.insert()`→optimistic→`onInsert`→API→Postgres txid→Electric streams→reconcile→drop optimistic
Prefer TanStack DB collections over lower-level Shape/ShapeStream/useShape APIs.

## References
[1]: https://electric-sql.com/docs/api/http.md
[2]: https://tanstack.com/db/latest/docs/overview.md
[3]: https://tanstack.com/db/latest/docs/collections/electric-collection.md
[4]: https://electric-sql.com/docs/guides/auth.md
[5]: https://electric-sql.com/docs/quickstart.md
[6]: https://electric-sql.com/docs/guides/shapes.md
[7]: https://tanstack.com/db/latest/docs/guides/live-queries.md
[8]: https://electric-sql.com/blog/2024/11/21/local-first-with-your-existing-api.md
[9]: https://electric-sql.com/docs/api/clients/typescript.md
[10]: https://electric-sql.com/docs/guides/security.md
[11]: https://electric-sql.com/product/cloud.md
[12]: https://tanstack.com/db/latest/docs/collections/query-collection.md
[13]: https://tanstack.com/db/latest/docs/guides/error-handling.md
[14]: https://electric-sql.com/docs/stacks.md
[15]: https://electric-sql.com/blog/2025/07/29/local-first-sync-with-tanstack-db.md
[16]: https://tanstack.com/blog/tanstack-db-0.1-the-embedded-client-database-for-tanstack-query.md
[17]: https://frontendatscale.com/blog/tanstack-db/
[18]: https://electric-sql.com/docs/guides/troubleshooting.md#slow-shapes
