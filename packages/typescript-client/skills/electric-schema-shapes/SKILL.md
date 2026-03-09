---
name: electric-schema-shapes
description: >
  Design Postgres schema and Electric shape definitions together for a new
  feature. Covers single-table shape constraint, cross-table joins using
  multiple shapes, WHERE clause design for tenant isolation, column selection
  for bandwidth optimization, replica mode choice (default vs full for
  old_value), enum casting in WHERE clauses, and txid handshake setup with
  pg_current_xact_id() for optimistic writes. Load when designing database
  tables for use with Electric shapes.
type: core
library: electric
library_version: '1.5.10'
requires:
  - electric-shapes
sources:
  - 'electric-sql/electric:AGENTS.md'
  - 'electric-sql/electric:website/docs/guides/shapes.md'
---

This skill builds on electric-shapes. Read it first for ShapeStream configuration.

# Electric — Schema and Shapes

## Setup

Design tables knowing each shape syncs one table. For cross-table data, use multiple shapes with client-side joins.

```sql
-- Schema designed for Electric shapes
CREATE TABLE todos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  text TEXT NOT NULL,
  completed BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE todos REPLICA IDENTITY FULL;
```

```ts
import { ShapeStream } from '@electric-sql/client'

const todoStream = new ShapeStream({
  url: '/api/todos', // Proxy sets: table=todos, where=org_id=$1
})
```

## Core Patterns

### Cross-table data with multiple shapes

```ts
// Each shape syncs one table — join client-side
const todoStream = new ShapeStream({ url: '/api/todos' })
const userStream = new ShapeStream({ url: '/api/users' })

// With TanStack DB, use .join() in live queries:
// q.from({ todo: todoCollection })
//   .join({ user: userCollection }, ({ todo, user }) => eq(todo.userId, user.id))
```

### Choose replica mode

```ts
// Default: only changed columns sent on update
const stream = new ShapeStream({ url: '/api/todos' })

// Full: all columns + old_value on updates (more bandwidth, needed for diffs)
const stream = new ShapeStream({
  url: '/api/todos',
  params: { replica: 'full' },
})
```

### Backend txid handshake for optimistic writes

Call `pg_current_xact_id()::xid::text` inside the same transaction as your mutation. If you query it outside the transaction, you get a different txid and the client will never reconcile.

```ts
// API endpoint — txid MUST be in the same transaction as the INSERT
app.post('/api/todos', async (req, res) => {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await client.query(
      'INSERT INTO todos (id, text, org_id) VALUES ($1, $2, $3) RETURNING id',
      [crypto.randomUUID(), req.body.text, req.body.orgId]
    )
    const txResult = await client.query(
      'SELECT pg_current_xact_id()::xid::text AS txid'
    )
    await client.query('COMMIT')
    // txid accepts number | bigint | `${bigint}`
    res.json({ id: result.rows[0].id, txid: parseInt(txResult.rows[0].txid) })
  } finally {
    client.release()
  }
})
```

```ts
// Client awaits txid before dropping optimistic state
await todoCollection.utils.awaitTxId(txid)
```

## Common Mistakes

### HIGH Designing shapes that span multiple tables

Wrong:

```ts
const stream = new ShapeStream({
  url: '/api/data',
  params: {
    table: 'todos JOIN users ON todos.user_id = users.id',
  },
})
```

Correct:

```ts
const todoStream = new ShapeStream({ url: '/api/todos' })
const userStream = new ShapeStream({ url: '/api/users' })
```

Shapes are single-table only. Cross-table data requires multiple shapes joined client-side via TanStack DB live queries.

Source: `AGENTS.md:104-105`

### MEDIUM Using enum columns without casting to text in WHERE

Wrong:

```ts
// Proxy route
originUrl.searchParams.set('where', "status IN ('active', 'done')")
```

Correct:

```ts
originUrl.searchParams.set('where', "status::text IN ('active', 'done')")
```

Enum types in WHERE clauses require explicit `::text` cast. Without it, the query may fail or return unexpected results.

Source: `packages/sync-service/lib/electric/replication/eval/env/known_functions.ex`

### HIGH Not setting up txid handshake for optimistic writes

Wrong:

```ts
// Backend: just INSERT, return id
app.post('/api/todos', async (req, res) => {
  const result = await db.query(
    'INSERT INTO todos (text) VALUES ($1) RETURNING id',
    [req.body.text]
  )
  res.json({ id: result.rows[0].id })
})
```

Correct:

```ts
// Backend: INSERT and return txid in same transaction
app.post('/api/todos', async (req, res) => {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await client.query(
      'INSERT INTO todos (text) VALUES ($1) RETURNING id',
      [req.body.text]
    )
    const txResult = await client.query(
      'SELECT pg_current_xact_id()::xid::text AS txid'
    )
    await client.query('COMMIT')
    res.json({ id: result.rows[0].id, txid: parseInt(txResult.rows[0].txid) })
  } finally {
    client.release()
  }
})
```

Without txid, the UI flickers when optimistic state is dropped before the synced version arrives from Electric. The client uses `awaitTxId(txid)` to hold optimistic state until the real data syncs.

Source: `AGENTS.md:116-119`

See also: electric-shapes/SKILL.md — Shapes are immutable; dynamic filters require new ShapeStream instances.
See also: electric-orm/SKILL.md — Schema design affects both shapes (read) and ORM queries (write).

## Version

Targets @electric-sql/client v1.5.10.
