---
name: electric-shapes
description: >
  Defining and consuming shapes — ShapeStream, Shape, useShape, params sub-key,
  WHERE clauses, columns selection, type parsing, column mapping, parser config,
  onError handler, FetchError, subscribe, camelCase mapping, single-table only
type: sub-skill
library: '@electric-sql/client'
library_version: '1.5.8'
sources:
  - 'electric:website/docs/guides/shapes.md'
  - 'electric:packages/typescript-client/src/shape.ts'
  - 'electric:packages/typescript-client/src/parser.ts'
---

# Electric Shapes

Shapes define subsets of Postgres data to sync. A shape is a **table** + optional
**where** + optional **columns**. Electric syncs all matching rows, then streams
changes in real-time.

## Setup

```typescript
import { ShapeStream, Shape } from '@electric-sql/client'
```

## Core Patterns

### Basic Shape

```typescript
const stream = new ShapeStream({
  url: `/api/todos`, // proxy URL (server defines actual shape)
})

const shape = new Shape(stream)
const rows = await shape.rows // wait for initial sync

shape.subscribe(({ rows }) => {
  console.log('Current data:', rows)
})
```

### Shape Definition (Server-Side Proxy)

Shapes are defined in your proxy, not client code:

```typescript
const origin = new URL(`${process.env.ELECTRIC_URL}/v1/shape`)
origin.searchParams.set('table', 'todos')
origin.searchParams.set('where', 'user_id = $1')
origin.searchParams.set('columns', 'id,title,status')
origin.searchParams.set('params', JSON.stringify([userId]))
```

### Type Parsing

Electric sends all values as strings. Parse custom types:

```typescript
const stream = new ShapeStream({
  url: `/api/todos`,
  parser: {
    timestamptz: (v: string) => new Date(v),
    jsonb: (v: string) => JSON.parse(v),
    int8: (v: string) => BigInt(v),
    _int4: (v: string) => v.replace(/[{}]/g, '').split(',').map(Number),
  },
})
```

### Dynamic Headers

```typescript
const stream = new ShapeStream({
  url: `/api/todos`,
  headers: {
    Authorization: async () => `Bearer ${await getAccessToken()}`,
  },
})
```

### Error Handling

```typescript
const stream = new ShapeStream({
  url: `/api/todos`,
  onError: async (error) => {
    if (error instanceof FetchError && error.status === 401) {
      return { headers: { Authorization: `Bearer ${await refreshToken()}` } }
    }
    if (error instanceof FetchError && error.status === 403) {
      return // stop stream
    }
    return {} // retry
  },
})
```

Return `{ headers, params }` to retry, `{}` to retry same config, or `void` to stop.

### With React

```tsx
import { useShape } from '@electric-sql/react'

function TodoList() {
  const { data, isLoading } = useShape({ url: `/api/todos` })
  if (isLoading) return <p>Loading...</p>
  return (
    <ul>
      {data.map((t) => (
        <li key={t.id}>{t.title}</li>
      ))}
    </ul>
  )
}
```

### Stream Events

```typescript
stream.subscribe((messages) => {
  for (const msg of messages) {
    if ('value' in msg) {
      // msg.headers.operation: "insert" | "update" | "delete"
    } else if (msg.headers?.control === 'must-refetch') {
      // shape rotated — resync from scratch
    }
  }
})
```

## Common Mistakes

### [CRITICAL] table/where/columns at top level instead of params

Wrong:

```typescript
const stream = new ShapeStream({
  url: `/api/todos`,
  table: 'todos',
  where: "status = 'active'",
})
```

Correct:

```typescript
// Client: just pass the proxy URL
const stream = new ShapeStream({ url: `/api/todos` })

// Server proxy: set shape params on Electric URL
origin.searchParams.set('table', 'todos')
origin.searchParams.set('where', "status = 'active'")
```

Pre-0.9 API had `table`/`where`/`columns` as top-level ShapeStream options. Current
API requires them as URL search params set server-side in the proxy.

Source: typescript-client CHANGELOG.md v0.9.0

### [CRITICAL] Using old Electric patterns (electrify, db.table.create)

Wrong:

```typescript
const { db } = await electrify(conn, schema)
await db.todos.create({ text: 'New' })
```

Correct:

```typescript
const stream = new ShapeStream({ url: `/api/todos` })
```

`electrify()` is from old Electric (bidirectional SQLite sync). New Electric is
read-only HTTP. Writes go through API → Postgres → Electric streams back.

Source: AGENTS.md lines 379-393

### [HIGH] Missing primary key in columns selection

Wrong:

```typescript
origin.searchParams.set('columns', 'title,status')
```

Correct:

```typescript
origin.searchParams.set('columns', 'id,title,status')
```

The `columns` param must include primary key columns or the shape request will fail.

Source: website/electric-api.yaml

### [HIGH] Expecting shapes to span multiple tables

Wrong:

```typescript
origin.searchParams.set('table', 'todos JOIN users ON ...')
```

Correct:

```typescript
// Sync separate shapes, join client-side with TanStack DB
const todoStream = new ShapeStream({ url: `/api/todos` })
const userStream = new ShapeStream({ url: `/api/users` })
```

Shapes are single-table only. Cross-table joins require multiple shapes plus
client-side joining (e.g., TanStack DB `useLiveQuery` with `.join()`).

Source: website/docs/guides/shapes.md

### [HIGH] Not parsing custom Postgres types

Wrong:

```typescript
const stream = new ShapeStream({ url: `/api/events` })
// event.created_at is "2024-01-15T10:30:00Z" (string, not Date)
```

Correct:

```typescript
const stream = new ShapeStream({
  url: `/api/events`,
  parser: {
    timestamptz: (v: string) => new Date(v),
    jsonb: (v: string) => JSON.parse(v),
  },
})
```

Values arrive as strings from HTTP. Without a parser, `timestamptz`, `jsonb`, and
array types remain as unparsed strings — no error, just wrong types at runtime.

Source: packages/typescript-client/src/parser.ts

### [MEDIUM] Using reserved param names in custom params

Wrong:

```typescript
origin.searchParams.set('cursor', 'my-cursor')
origin.searchParams.set('offset', 'custom-offset')
```

Correct:

```typescript
// These names are reserved for the Electric protocol:
// cursor, handle, live, offset, cache-buster, subset__*
// Use different names for your own params
origin.searchParams.set('filter_cursor', 'my-cursor')
```

Reserved param names (`cursor`, `handle`, `live`, `offset`, `cache-buster`,
`subset__*`) throw `ReservedParamError`.

Source: packages/typescript-client/src/client.ts

## Tension: Read-only sync vs write-path expectations

Electric is read-only. Developers (and agents trained on old Electric) expect
bidirectional sync. Shapes only stream data _from_ Postgres — there is no
write API on shapes. Writes go through your backend API to Postgres, and Electric
syncs the changes back to clients.

Cross-reference: `electric-tanstack-integration`

## References

- [Shapes Guide](https://electric-sql.com/docs/guides/shapes)
- [HTTP API](https://electric-sql.com/docs/api/http)
- [TypeScript Client API](https://electric-sql.com/docs/api/clients/typescript)
- Reference: `electric-shapes/references/shape-options.md`
- Reference: `electric-shapes/references/parser-types.md`
