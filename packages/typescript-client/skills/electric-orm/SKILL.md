---
name: electric-orm
description: >
  Use Electric with Drizzle ORM or Prisma for the write path. Covers getting
  pg_current_xact_id() from ORM transactions using Drizzle tx.execute(sql)
  and Prisma $queryRaw, running migrations that preserve REPLICA IDENTITY
  FULL, and schema management patterns compatible with Electric shapes.
  Load when using Drizzle or Prisma alongside Electric for writes.
type: composition
library: electric
library_version: '1.5.10'
requires:
  - electric-shapes
  - electric-schema-shapes
sources:
  - 'electric-sql/electric:AGENTS.md'
  - 'electric-sql/electric:website/docs/guides/troubleshooting.md'
---

This skill builds on electric-shapes and electric-schema-shapes. Read those first.

# Electric — ORM Integration

## Setup

### Drizzle ORM

```ts
import { drizzle } from 'drizzle-orm/node-postgres'
import { sql } from 'drizzle-orm'
import { todos } from './schema'

const db = drizzle(pool)

// Write with txid for Electric reconciliation
async function createTodo(text: string, userId: string) {
  return await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(todos)
      .values({
        id: crypto.randomUUID(),
        text,
        userId,
      })
      .returning()

    const [{ txid }] = await tx.execute<{ txid: string }>(
      sql`SELECT pg_current_xact_id()::xid::text AS txid`
    )

    return { id: row.id, txid: parseInt(txid) }
  })
}
```

### Prisma

```ts
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function createTodo(text: string, userId: string) {
  return await prisma.$transaction(async (tx) => {
    const todo = await tx.todo.create({
      data: { id: crypto.randomUUID(), text, userId },
    })

    const [{ txid }] = await tx.$queryRaw<[{ txid: string }]>`
      SELECT pg_current_xact_id()::xid::text AS txid
    `

    return { id: todo.id, txid: parseInt(txid) }
  })
}
```

## Core Patterns

### Drizzle migration with REPLICA IDENTITY

```ts
// In migration file
import { sql } from 'drizzle-orm'

export async function up(db) {
  await db.execute(sql`
    CREATE TABLE todos (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      text TEXT NOT NULL,
      completed BOOLEAN DEFAULT false
    )
  `)
  await db.execute(sql`ALTER TABLE todos REPLICA IDENTITY FULL`)
}
```

### Prisma migration with REPLICA IDENTITY

```sql
-- prisma/migrations/001_init/migration.sql
CREATE TABLE "todos" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "text" TEXT NOT NULL,
  "completed" BOOLEAN DEFAULT false
);

ALTER TABLE "todos" REPLICA IDENTITY FULL;
```

### Collection onInsert with ORM

```ts
import { createCollection } from '@tanstack/react-db'
import { electricCollectionOptions } from '@tanstack/electric-db-collection'

export const todoCollection = createCollection(
  electricCollectionOptions({
    id: 'todos',
    schema: todoSchema,
    getKey: (row) => row.id,
    shapeOptions: { url: '/api/todos' },
    onInsert: async ({ transaction }) => {
      const newTodo = transaction.mutations[0].modified
      const { txid } = await createTodo(newTodo.text, newTodo.userId)
      return { txid }
    },
  })
)
```

## Common Mistakes

### HIGH Not returning txid from ORM write operations

Wrong:

```ts
// Drizzle — no txid returned
const [todo] = await db.insert(todos).values({ text: 'New' }).returning()
return { id: todo.id }
```

Correct:

```ts
// Drizzle — txid in same transaction
const result = await db.transaction(async (tx) => {
  const [row] = await tx.insert(todos).values({ text: 'New' }).returning()
  const [{ txid }] = await tx.execute<{ txid: string }>(
    sql`SELECT pg_current_xact_id()::xid::text AS txid`
  )
  return { id: row.id, txid: parseInt(txid) }
})
```

ORMs do not return `pg_current_xact_id()` by default. Add a raw SQL query for txid within the same transaction. Without it, optimistic state may drop before the synced version arrives, causing UI flicker.

Source: `AGENTS.md:116-119`

### MEDIUM Running migrations that drop replica identity

Wrong:

```ts
// ORM migration recreates table without REPLICA IDENTITY
await db.execute(sql`DROP TABLE todos`)
await db.execute(sql`CREATE TABLE todos (...)`)
// Missing: ALTER TABLE todos REPLICA IDENTITY FULL
```

Correct:

```ts
await db.execute(sql`DROP TABLE todos`)
await db.execute(sql`CREATE TABLE todos (...)`)
await db.execute(sql`ALTER TABLE todos REPLICA IDENTITY FULL`)
```

Some migration tools reset table properties. Always ensure `REPLICA IDENTITY FULL` is set after table recreation. Without it, Electric cannot stream updates and deletes correctly.

Source: `website/docs/guides/troubleshooting.md:373`

See also: electric-new-feature/SKILL.md — Full write-path journey including txid handshake.
See also: electric-schema-shapes/SKILL.md — Schema design affects both shapes and ORM queries.

## Version

Targets @electric-sql/client v1.5.10.
