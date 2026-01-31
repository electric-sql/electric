---
name: electric-shapes
description: Electric Shapes API - define and sync subsets of Postgres data
triggers:
  - shapes
  - shape
  - ShapeStream
  - Shape
  - sync data
  - where clause
metadata:
  sources:
    - website/docs/guides/shapes.md
    - packages/typescript-client/src/shape.ts
---

# Electric Shapes

Shapes define subsets of your Postgres data to sync to clients.

## What is a Shape?

A Shape is:

- A **table** (required) - e.g., `todos`
- A **where clause** (optional) - filters rows
- A **columns** list (optional) - limits which columns sync

Electric syncs all matching rows, then streams changes in real-time.

## Security: Always Proxy in Production

**Electric is public by default.** Any shape request without authentication exposes data. Always:

1. Put Electric behind your backend API proxy
2. Authenticate users in your proxy
3. Define shapes server-side (never let clients control `table` or `where`)

See `electric-proxy` skill for implementation patterns.

## Basic Usage

```typescript
import { ShapeStream, Shape } from '@electric-sql/client'

// Create a stream
const stream = new ShapeStream({
  url: '/api/todos', // Proxy URL (never direct Electric URL in production)

// Materialize into a Shape
const shape = new Shape(stream)

// Wait for initial sync
const rows = await shape.rows

// Subscribe to changes
shape.subscribe(({ rows }) => {
  console.log('Current data:', rows)
})
```

## Shape Definition (Server-Side)

Shapes are defined in your proxy, not in client code:

```typescript
// Server proxy
const origin = new URL(process.env.ELECTRIC_URL!)

origin.searchParams.set('table', 'todos') // Required
origin.searchParams.set('where', `user_id = $1`) // Optional filter
origin.searchParams.set('columns', 'id,title,status') // Optional columns
origin.searchParams.set('params', JSON.stringify([userId]))
```

### Table

```typescript
// Simple table
origin.searchParams.set('table', 'todos')

// Schema-qualified table
origin.searchParams.set('table', 'myschema.todos')
```

### Partitioned Tables

Electric supports Postgres declaratively partitioned tables:

```typescript
// Sync entire partitioned table (all partitions)
origin.searchParams.set('table', 'events')

// Sync specific partition only
origin.searchParams.set('table', 'events_2024')
```

**Note**: When syncing individual partitions, writes only apply if they fall within that partition's range.

### Where Clause

SQL-like filter expression:

```typescript
// Simple equality
origin.searchParams.set('where', `status = 'active'`)

// Parameterized (recommended for user input)
origin.searchParams.set('where', `user_id = $1 AND status = $2`)
origin.searchParams.set('params', JSON.stringify([userId, 'active']))

// Multiple conditions
origin.searchParams.set('where', `priority > 5 AND status IN ('todo', 'doing')`)
```

**Supported operators:**

- Comparison: `=`, `!=`, `<`, `>`, `<=`, `>=`
- Logical: `AND`, `OR`, `NOT`
- Pattern: `LIKE`, `ILIKE`
- Set: `IN`, `NOT IN`
- Null: `IS NULL`, `IS NOT NULL`

**Limitations:**

- Single table only (no joins)
- No subqueries
- No non-deterministic functions (`now()`, `random()`)

### Columns

Limit which columns sync (must include primary key):

```typescript
origin.searchParams.set('columns', 'id,title,status')

// With quoted identifiers
origin.searchParams.set('columns', 'id,"Created-At",status')
```

## ShapeStream Options

```typescript
const stream = new ShapeStream({
  // Required
  url: '/api/todos',

  // Optional: Custom headers (can be functions for dynamic values)
  headers: {
    Authorization: () => `Bearer ${getToken()}`,
  },

  // Optional: Additional params (for Electric protocol only)
  params: {
    offset: '-1', // Start from beginning
  },

  // Optional: Custom fetch client
  fetchClient: customFetch,

  // Optional: Error handler
  onError: async (error) => {
    if (error instanceof FetchError && error.status === 401) {
      // Refresh token and retry
      const newToken = await refreshToken()
      return { headers: { Authorization: `Bearer ${newToken}` } }
    }
    // Return void to stop the stream
  },

  // Optional: Custom type parsers
  parser: {
    timestamptz: (v) => new Date(v),
    jsonb: (v) => JSON.parse(v),
  },
})
```

## Shape Methods

```typescript
const shape = new Shape(stream)

// Get all rows (Promise - resolves when caught up)
const rows = await shape.rows

// Get current value synchronously
const currentRows = shape.currentRows

// Check if synced
const synced = shape.isUpToDate()

// Subscribe to changes
const unsubscribe = shape.subscribe(({ rows }) => {
  console.log('Updated:', rows)
})

// Clean up
unsubscribe()
shape.unsubscribeAll()
```

## ShapeStream Events

```typescript
stream.subscribe((messages) => {
  for (const message of messages) {
    if ('value' in message) {
      // Data message
      const { key, value, headers } = message
      // headers.operation: 'insert' | 'update' | 'delete'
    } else if ('headers' in message && message.headers.control) {
      // Control message
      if (message.headers.control === 'up-to-date') {
        console.log('Caught up with server')
      }
      if (message.headers.control === 'must-refetch') {
        console.log('Need to resync from scratch')
      }
    }
  }
})
```

## Performance Optimization

### Optimized Where Clauses

Electric optimizes these patterns for high throughput:

```typescript
// ✅ Optimized: Simple equality
where: `user_id = $1`

// ✅ Optimized: Equality with additional conditions
where: `user_id = $1 AND status = 'active'`

// ⚠️ Not optimized: OR conditions
where: `user_id = $1 OR team_id = $2`

// ⚠️ Not optimized: Range queries alone
where: `created_at > $1`
```

Optimized queries maintain ~5,000 changes/sec regardless of shape count.

### Limit Columns

Only sync what you need:

```typescript
// Sync entire row
origin.searchParams.set('table', 'documents')

// Better: Only needed columns
origin.searchParams.set('table', 'documents')
origin.searchParams.set('columns', 'id,title,updated_at') // Skip large 'content' column
```

## Advanced Sync Modes

### Changes-Only Mode

Skip the initial snapshot, receive only future changes:

```typescript
// Via HTTP API
origin.searchParams.set('log', 'changes_only')

// Useful when:
// - Initial state loaded from another source
// - Only care about real-time updates
// - Building notification systems
```

### Start from Now

Skip all historical data:

```typescript
origin.searchParams.set('offset', 'now')
```

Returns immediate `up-to-date` with latest offset for live mode. Useful for dashboards that only need current state.

### Subset Snapshots

In changes-only mode, fetch specific data portions:

```typescript
// Get high-priority items in changes-only mode
origin.searchParams.set('log', 'changes_only')
origin.searchParams.set('subset__where', 'priority = $1')
origin.searchParams.set('subset__params', JSON.stringify({ '1': 'high' }))
origin.searchParams.set('subset__limit', '10')
```

Response includes snapshot metadata for change deduplication.

## Shape Limitations

### Single Table

Shapes can't join tables. Workarounds:

```typescript
// Sync related shapes separately
const projectShape = new Shape(projectStream)
const issuesShape = new Shape(issuesStream)

// Join in client with TanStack DB
useLiveQuery((q) =>
  q.from({ project: projectCollection })
   .join({ issue: issueCollection }, ...)
)
```

### Immutable Definitions

Once a shape subscription starts, its definition can't change. For dynamic shapes:

```typescript
// Factory pattern for dynamic shapes
function createUserTodosShape(userId: string) {
  return new ShapeStream({
    url: `/api/todos?userId=${userId}`,
  })
}
```

### Dropping Tables

If you drop a table in Postgres, manually delete its shapes before recreating.

## Type Parsing

Electric returns all values as strings. Parse custom types:

```typescript
const stream = new ShapeStream({
  url: '/api/todos',
  parser: {
    // Timestamps
    timestamptz: (value: string) => new Date(value),
    timestamp: (value: string) => new Date(value),

    // JSON
    jsonb: (value: string) => JSON.parse(value),
    json: (value: string) => JSON.parse(value),

    // Numbers
    numeric: (value: string) => parseFloat(value),
    int8: (value: string) => BigInt(value),

    // Arrays
    _int4: (value: string) => value.replace(/[{}]/g, '').split(',').map(Number),

    // Custom
    point: (value: string) => {
      const [x, y] = value.replace(/[()]/g, '').split(',')
      return { x: parseFloat(x), y: parseFloat(y) }
    },
  },
})
```

## Error Handling

```typescript
const stream = new ShapeStream({
  url: '/api/todos',
  onError: async (error) => {
    if (error instanceof FetchError) {
      switch (error.status) {
        case 401:
          // Token expired - refresh and retry
          return {
            headers: { Authorization: `Bearer ${await refreshToken()}` },
          }
        case 403:
          // No access - show error
          showError('Access denied')
          return // Stop stream
        case 409:
          // Shape changed - client handles must-refetch
          return {} // Retry with same config
        case 429:
          // Rate limited - retry after delay
          await delay(error.headers.get('Retry-After') || 1000)
          return {}
      }
    }
    // Log and stop
    logError(error)
  },
})
```

## With React

```tsx
import { useShape } from '@electric-sql/react'

function TodoList() {
  const {
    data: todos,
    isLoading,
    error,
  } = useShape({
    url: '/api/todos',
  })

  if (isLoading) return <Loading />
  if (error) return <Error error={error} />

  return (
    <ul>
      {todos.map((todo) => (
        <li key={todo.id}>{todo.title}</li>
      ))}
    </ul>
  )
}
```

## References

- [Shapes Guide](https://electric-sql.com/docs/guides/shapes)
- [HTTP API](https://electric-sql.com/docs/api/http)
- [TypeScript Client](https://electric-sql.com/docs/api/clients/typescript)
