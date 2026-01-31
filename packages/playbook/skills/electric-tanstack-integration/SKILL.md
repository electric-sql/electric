---
name: electric-tanstack-integration
description: Deep integration patterns for Electric with TanStack DB - collections, live queries, optimistic mutations
triggers:
  - tanstack db
  - collections
  - live queries
  - optimistic mutations
  - useLiveQuery
metadata:
  sources:
    - AGENTS.md
---

# Electric + TanStack DB Integration

Deep patterns for building local-first apps with Electric and TanStack DB.

## Architecture

```
Electric (Postgres sync) → HTTP Shape Stream → TanStack DB Collection
                                                     ↓
                                              Live Queries (sub-ms)
                                                     ↓
                                              UI Components
```

## Electric Collection Setup

### Basic Collection

```typescript
import { createCollection } from '@tanstack/react-db'
import { electricCollectionOptions } from '@tanstack/electric-db-collection'
import { todoSchema } from './schema'

export const todoCollection = createCollection(
  electricCollectionOptions({
    id: 'todos',
    schema: todoSchema,
    getKey: (row) => row.id,
    shapeOptions: {
      // Use full URL for SSR safety (relative URLs fail during SSR)
      url: new URL(
        '/api/todos', // Each table has its own route
        typeof window !== 'undefined'
          ? window.location.origin
          : 'http://localhost:5173'
      ).toString(),
    },
  })
)
```

### Passing Arguments to Collections

Treat shape URLs like API calls - pass arguments via query params:

```typescript
// Dynamic collection based on project
const projectTodos = createCollection(
  electricCollectionOptions({
    id: `todos-${projectId}`,
    schema: todoSchema,
    getKey: (row) => row.id,
    shapeOptions: {
      // Pass projectId like you would to any API
      url: new URL(
        `/api/todos?projectId=${projectId}`,
        typeof window !== 'undefined'
          ? window.location.origin
          : 'http://localhost:5173'
      ).toString(),
    },
  })
)
```

The server proxy receives these params and maps them to the actual shape query. See `electric-proxy` skill for server-side patterns.

### Preloading Collections

Preload in route loaders to prevent flash of empty state:

```typescript
// src/routes/index.tsx
export const Route = createFileRoute('/')({
  ssr: false,
  loader: async () => {
    // Preload before component renders
    await todoCollection.preload()
    await projectCollection.preload()
  },
  component: HomePage,
})
```

### Collection with Write Handlers

```typescript
export const todoCollection = createCollection(
  electricCollectionOptions({
    id: 'todos',
    schema: todoSchema,
    getKey: (row) => row.id,
    shapeOptions: { url: '/api/todos' },

    onInsert: async ({ transaction }) => {
      const newTodo = transaction.mutations[0].modified
      const { txid } = await api.todos.create(newTodo)
      return { txid } // Required for optimistic reconciliation
    },

    onUpdate: async ({ transaction }) => {
      const updated = transaction.mutations[0].modified
      const { txid } = await api.todos.update(updated)
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

### Custom Type Parsing

Postgres types need parsing to JavaScript types:

```typescript
shapeOptions: {
  url: '/api/todos',
  parser: {
    // Timestamps → Date objects
    timestamptz: (date: string) => new Date(date),
    // JSON → parsed objects
    jsonb: (json: string) => JSON.parse(json),
    // Numeric → float
    numeric: (num: string) => parseFloat(num),
  }
}
```

### SSR-Safe URL Construction

Collections may be imported during SSR. Use window check:

```typescript
shapeOptions: {
  url: new URL(
    '/api/todos',
    typeof window !== 'undefined'
      ? window.location.origin
      : 'http://localhost:5173'  // Fallback for SSR
  ).toString(),
}
```

### Error Handling

```typescript
shapeOptions: {
  url: '/api/todos',
  onError: (error) => {
    if (error instanceof FetchError && error.status === 401) {
      // Handle auth error - redirect to login
      return
    }
    // Rethrow to stop the stream
    throw error
  }
}
```

## Live Queries

TanStack DB provides SQL-like queries with **sub-millisecond** performance via differential dataflow.

### Basic Query

```tsx
import { useLiveQuery } from '@tanstack/react-db'

function TodoList() {
  const { data: todos } = useLiveQuery((q) => q.from({ todo: todoCollection }))

  return (
    <ul>
      {todos.map((t) => (
        <li key={t.id}>{t.text}</li>
      ))}
    </ul>
  )
}
```

### Filtering

```tsx
import { useLiveQuery, eq, and, or, gt } from '@tanstack/react-db'

const { data } = useLiveQuery((q) =>
  q
    .from({ todo: todoCollection })
    .where(({ todo }) => and(eq(todo.completed, false), gt(todo.priority, 5)))
)
```

### Ordering and Limiting

```tsx
const { data } = useLiveQuery((q) =>
  q
    .from({ todo: todoCollection })
    .where(({ todo }) => eq(todo.completed, false))
    .orderBy(({ todo }) => todo.created_at, 'desc')
    .limit(50)
)
```

### Dynamic Dependencies

```tsx
const [status, setStatus] = useState('active')

const { data } = useLiveQuery(
  (q) =>
    q
      .from({ todo: todoCollection })
      .where(({ todo }) => eq(todo.status, status)),
  [status] // Re-run when status changes
)
```

### Cross-Collection Joins

```tsx
const { data } = useLiveQuery((q) =>
  q
    .from({ todo: todoCollection })
    .join({ user: userCollection }, ({ todo, user }) =>
      eq(todo.user_id, user.id)
    )
    .where(({ user }) => eq(user.active, true))
    .select(({ todo, user }) => ({
      id: todo.id,
      text: todo.text,
      userName: user.name,
    }))
)
```

### Aggregations

```tsx
import { count, sum } from '@tanstack/react-db'

const { data } = useLiveQuery((q) =>
  q
    .from({ todo: todoCollection })
    .groupBy(({ todo }) => todo.list_id)
    .select(({ todo }) => ({
      listId: todo.list_id,
      totalTodos: count(todo.id),
      totalPriority: sum(todo.priority),
    }))
)
```

## Optimistic Mutations

### Direct Collection Mutations

```tsx
function TodoActions() {
  // Insert - immediately visible, synced via onInsert
  const handleAdd = () => {
    todoCollection.insert({
      id: crypto.randomUUID(),
      text: 'New todo',
      completed: false,
      created_at: Date.now(),
    })
  }

  // Update - uses Immer-style draft
  const handleToggle = (todo: Todo) => {
    todoCollection.update(todo.id, (draft) => {
      draft.completed = !draft.completed
    })
  }

  // Delete
  const handleDelete = (id: string) => {
    todoCollection.delete(id)
  }
}
```

### Custom Optimistic Actions

For multi-collection or complex mutations:

```typescript
import { createOptimisticAction } from '@tanstack/react-db'

const bootstrapListAction = createOptimisticAction<string>({
  // Immediately apply optimistic changes
  onMutate: (listId, firstItemText) => {
    listCollection.insert({ id: listId, name: 'New List' })
    todoCollection.insert({
      id: crypto.randomUUID(),
      text: firstItemText,
      list_id: listId,
    })
  },

  // Sync with server
  mutationFn: async (listId, firstItemText) => {
    const { txid } = await api.lists.bootstrap({ listId, firstItemText })

    // Wait for both collections to sync
    await Promise.all([
      listCollection.utils.awaitTxId(txid),
      todoCollection.utils.awaitTxId(txid),
    ])
  },
})

// Usage
bootstrapListAction('list-123', 'First item')
```

## Write Path Contract

The txid handshake prevents UI flicker:

1. UI calls `collection.insert()` → **instant optimistic update**
2. Collection calls `onInsert` → API call
3. API writes to Postgres, returns `txid`
4. Collection awaits `txid` on Electric stream
5. When txid arrives → **drop optimistic state, use synced data**

### Backend: Get Postgres txid

**Critical:** The `::xid` cast strips the epoch, matching Electric's replication stream format.

```typescript
// Helper function for Drizzle
async function generateTxId(tx: Transaction): Promise<number> {
  // ::xid cast gives raw 32-bit value matching Electric's stream
  const result = await tx.execute(
    sql`SELECT pg_current_xact_id()::xid::text as txid`
  )
  return parseInt(result.rows[0].txid as string, 10)
}

// Use inside transaction
const result = await db.transaction(async (tx) => {
  const txid = await generateTxId(tx)
  const [newItem] = await tx.insert(todosTable).values(input).returning()
  return { item: newItem, txid }
})
```

**Important:** Get txid inside the same transaction as the mutation.

## Framework Integrations

```bash
npm install @tanstack/{react,angular,solid,svelte,vue}-db
```

All frameworks use the same collection and query patterns:

```typescript
import { useLiveQuery } from '@tanstack/react-db'
// or '@tanstack/vue-db', '@tanstack/solid-db', etc.

const { data, isLoading } = useLiveQuery((q) =>
  q.from({ todos: todoCollection })
)
```

### React Native

Requires UUID polyfill:

```bash
npm install react-native-random-uuid
```

```typescript
// Entry point (before any Electric code)
import 'react-native-random-uuid'
```

## Migration from TanStack Query

1. Wrap existing `useQuery` in Query Collection (`queryCollectionOptions`)
2. Replace selectors with live queries
3. Port mutations to collection handlers
4. Switch to Electric Collection (no component changes needed)

```typescript
// Before: TanStack Query
const { data } = useQuery({
  queryKey: ['todos'],
  queryFn: () => api.todos.list(),
})

// After: Electric Collection (same component interface)
const { data } = useLiveQuery((q) => q.from({ todo: todoCollection }))
```

## Local-Only Collections

For client-side state that doesn't sync (auth, UI state):

```typescript
import {
  createCollection,
  localOnlyCollectionOptions,
} from '@tanstack/react-db'
import { z } from 'zod'

const authStateSchema = z.object({
  id: z.string(),
  session: z.any().nullable(),
  user: z.any().nullable(),
})

export const authStateCollection = createCollection(
  localOnlyCollectionOptions({
    id: 'auth-state',
    getKey: (item) => item.id,
    schema: authStateSchema,
  })
)

// Cache auth to avoid repeated API calls
if (!authStateCollection.get('auth')) {
  const result = await authClient.getSession()
  authStateCollection.insert({ id: 'auth', ...result.data })
}
```

## Testing

```typescript
import { vi } from 'vitest'

const mockCollection = createCollection(
  electricCollectionOptions({
    id: 'todos-test',
    schema: todoSchema,
    getKey: (row) => row.id,
    shapeOptions: {
      url: '/api/todos',
      fetchClient: vi.fn(), // Mock fetch for testing
    },
  })
)
```

## SSR Configuration (TanStack Start)

TanStack DB uses client-side state that doesn't work with SSR. Configure SPA mode:

See: [TanStack Start SPA Mode Guide](https://tanstack.com/start/latest/docs/framework/react/guide/spa-mode)

### 1. Disable SSR

```typescript
// src/start.tsx
import { createStart } from '@tanstack/react-start'

export const startInstance = createStart(() => ({
  defaultSsr: false, // Disable SSR globally
}))
```

Or per-route: `ssr: false` in route options.

### 2. Configure Shell Component

The `<html>` shell is always SSR'd, even with `defaultSsr: false`:

```typescript
// src/routes/__root.tsx
export const Route = createRootRoute({
  shellComponent: RootDocument, // Always SSR'd
  component: () => <Outlet />,  // Not SSR'd when defaultSsr: false
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head><HeadContent /></head>
      <body>{children}<Scripts /></body>
    </html>
  )
}
```

### 3. Add Nitro for Server Routes

```typescript
// vite.config.ts
import { nitro } from 'nitro/vite'

export default defineConfig({
  plugins: [nitro(), tanstackStart(), viteReact()],
})
```

**Common issue:** Empty output (`<!--$--><!--/$-->`) means SSR is still enabled or shellComponent is missing.

## Common Gotchas

1. **Use latest packages** - Check npm for `@electric-sql/*` & `@tanstack/*-db`
2. **txid must be integer** - Parse as `parseInt()` not string
3. **Collections are singletons** - Create once, import everywhere
4. **Live queries recompute on any collection change** - Use `limit()` for large datasets
5. **Shapes are immutable** - Use factory function for dynamic shapes
6. **SSR breaks collections** - Must configure all three SSR pieces (see above)
7. **TypeScript server.handlers error** - Types lag, code works at runtime

## Related Skills

- `npx @electric-sql/playbook show tanstack-start-quickstart` - Complete TanStack Start setup
- `npx @electric-sql/playbook show electric-proxy` - Proxy implementation patterns
- `npx @electric-sql/playbook show electric-quickstart` - Getting started
- `npx @electric-sql/playbook show electric-auth` - Authentication patterns
