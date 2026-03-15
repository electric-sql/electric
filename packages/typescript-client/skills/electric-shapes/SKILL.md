---
name: electric-shapes
description: >
  Configure ShapeStream and Shape to sync a Postgres table to the client.
  Covers ShapeStreamOptions (url, table, where, columns, replica, offset,
  handle), custom type parsers (timestamptz, jsonb, int8), column mappers
  (snakeCamelMapper, createColumnMapper), onError retry semantics, backoff
  options, log modes (full, changes_only), requestSnapshot, fetchSnapshot,
  subscribe/unsubscribe, and Shape materialized view. Load when setting up
  sync, configuring shapes, parsing types, or handling sync errors.
type: core
library: electric
library_version: '1.5.10'
sources:
  - 'electric-sql/electric:packages/typescript-client/src/client.ts'
  - 'electric-sql/electric:packages/typescript-client/src/shape.ts'
  - 'electric-sql/electric:packages/typescript-client/src/types.ts'
  - 'electric-sql/electric:packages/typescript-client/src/parser.ts'
  - 'electric-sql/electric:packages/typescript-client/src/column-mapper.ts'
  - 'electric-sql/electric:website/docs/guides/shapes.md'
---

# Electric — Shape Streaming

## Setup

```ts
import { ShapeStream, Shape } from '@electric-sql/client'

const stream = new ShapeStream({
  url: '/api/todos', // Your proxy route, NOT direct Electric URL
  // Built-in parsers auto-handle: bool, int2, int4, float4, float8, json, jsonb
  // Add custom parsers for other types (see references/type-parsers.md)
  parser: {
    timestamptz: (date: string) => new Date(date),
  },
})

const shape = new Shape(stream)

shape.subscribe(({ rows }) => {
  console.log('synced rows:', rows)
})

// Wait for initial sync
const rows = await shape.rows
```

## Core Patterns

### Filter rows with WHERE clause and positional params

```ts
const stream = new ShapeStream({
  url: '/api/todos',
  params: {
    table: 'todos',
    where: 'user_id = $1 AND status = $2',
    params: { '1': userId, '2': 'active' },
  },
})
```

### Select specific columns (must include primary key)

```ts
const stream = new ShapeStream({
  url: '/api/todos',
  params: {
    table: 'todos',
    columns: ['id', 'title', 'status'], // PK required
  },
})
```

### Map column names between snake_case and camelCase

```ts
import { ShapeStream, snakeCamelMapper } from '@electric-sql/client'

const stream = new ShapeStream({
  url: '/api/todos',
  columnMapper: snakeCamelMapper(),
})
// DB column "created_at" arrives as "createdAt" in client
// WHERE clauses auto-translate: "createdAt" → "created_at"
```

### Handle errors with retry

```ts
const stream = new ShapeStream({
  url: '/api/todos',
  onError: (error) => {
    console.error('sync error', error)
    return {} // Return {} to retry; returning void stops the stream
  },
})
```

For auth token refresh on 401 errors, see electric-proxy-auth/SKILL.md.

### Resume from stored offset

```ts
const stream = new ShapeStream({
  url: '/api/todos',
  offset: storedOffset, // Both offset AND handle required
  handle: storedHandle,
})
```

### Get replica with old values on update

```ts
const stream = new ShapeStream({
  url: '/api/todos',
  params: {
    table: 'todos',
    replica: 'full', // Sends unchanged columns + old_value on updates
  },
})
```

## Common Mistakes

### CRITICAL Returning void from onError stops sync permanently

Wrong:

```ts
const stream = new ShapeStream({
  url: '/api/todos',
  onError: (error) => {
    console.error('sync error', error)
    // Returning nothing = stream stops forever
  },
})
```

Correct:

```ts
const stream = new ShapeStream({
  url: '/api/todos',
  onError: (error) => {
    console.error('sync error', error)
    return {} // Return {} to retry
  },
})
```

`onError` returning `undefined` signals the stream to permanently stop. Return at least `{}` to retry, or return `{ headers, params }` to retry with updated values.

Source: `packages/typescript-client/src/client.ts:409-418`

### HIGH Using columns without including primary key

Wrong:

```ts
const stream = new ShapeStream({
  url: '/api/todos',
  params: {
    table: 'todos',
    columns: ['title', 'status'],
  },
})
```

Correct:

```ts
const stream = new ShapeStream({
  url: '/api/todos',
  params: {
    table: 'todos',
    columns: ['id', 'title', 'status'],
  },
})
```

Server returns 400 error. The `columns` list must always include the primary key column(s).

Source: `website/docs/guides/shapes.md`

### HIGH Setting offset without handle for resumption

Wrong:

```ts
new ShapeStream({
  url: '/api/todos',
  offset: storedOffset,
})
```

Correct:

```ts
new ShapeStream({
  url: '/api/todos',
  offset: storedOffset,
  handle: storedHandle,
})
```

Throws `MissingShapeHandleError`. Both `offset` AND `handle` are required to resume a stream from a stored position.

Source: `packages/typescript-client/src/client.ts:1997-2003`

### HIGH Using non-deterministic functions in WHERE clause

Wrong:

```ts
const stream = new ShapeStream({
  url: '/api/events',
  params: {
    table: 'events',
    where: 'start_time > now()',
  },
})
```

Correct:

```ts
const stream = new ShapeStream({
  url: '/api/events',
  params: {
    table: 'events',
    where: 'start_time > $1',
    params: { '1': new Date().toISOString() },
  },
})
```

Server rejects WHERE clauses with non-deterministic functions like `now()`, `random()`, `count()`. Use static values or positional params.

Source: `packages/sync-service/lib/electric/replication/eval/env/known_functions.ex`

### HIGH Not parsing custom Postgres types

Wrong:

```ts
const stream = new ShapeStream({
  url: '/api/events',
})
// createdAt will be string "2024-01-15T10:30:00.000Z", not a Date
```

Correct:

```ts
const stream = new ShapeStream({
  url: '/api/events',
  parser: {
    timestamptz: (date: string) => new Date(date),
    timestamp: (date: string) => new Date(date),
  },
})
```

Electric auto-parses `bool`, `int2`, `int4`, `float4`, `float8`, `json`, `jsonb`, and `int8` (→ BigInt). All other types arrive as strings — add custom parsers for `timestamptz`, `date`, `numeric`, etc. See [references/type-parsers.md](references/type-parsers.md) for the full list.

Source: `AGENTS.md:300-308`

### MEDIUM Using reserved parameter names in params

Wrong:

```ts
const stream = new ShapeStream({
  url: '/api/todos',
  params: {
    table: 'todos',
    cursor: 'abc', // Reserved!
    offset: '0', // Reserved!
  },
})
```

Correct:

```ts
const stream = new ShapeStream({
  url: '/api/todos',
  params: {
    table: 'todos',
    page_cursor: 'abc',
    page_offset: '0',
  },
})
```

Throws `ReservedParamError`. Names `cursor`, `handle`, `live`, `offset`, `cache-buster`, and all `subset__*` prefixed params are reserved by the Electric protocol.

Source: `packages/typescript-client/src/client.ts:1984-1985`

### MEDIUM Mutating shape options on a running stream

Wrong:

```ts
const stream = new ShapeStream({
  url: '/api/todos',
  params: { table: 'todos', where: "status = 'active'" },
})
// Later...
stream.options.params.where = "status = 'done'" // No effect!
```

Correct:

```ts
// Create a new stream with different params
const newStream = new ShapeStream({
  url: '/api/todos',
  params: { table: 'todos', where: "status = 'done'" },
})
```

Shapes are immutable per subscription. Changing params on a running stream has no effect. Create a new `ShapeStream` instance for different filters.

Source: `AGENTS.md:106`

## References

- [WHERE clause supported types and functions](references/where-clause.md)
- [Built-in type parsers](references/type-parsers.md)

See also: electric-proxy-auth/SKILL.md — Shape URLs must point to proxy routes, not directly to Electric.
See also: electric-debugging/SKILL.md — onError semantics and backoff are essential for diagnosing sync problems.

## Version

Targets @electric-sql/client v1.5.10.
