---
name: electric-drizzle
description: >
  Drizzle ORM with Electric — pgTable schema, drizzle-kit migrations,
  drizzle-zod createSchemaFactory, createSelectSchema, createInsertSchema,
  generateTxId, pg_current_xact_id, transaction txid pattern, snake_case casing
type: composition
library: '@electric-sql/client'
library_version: '1.5.8'
requires:
  - 'drizzle-orm'
  - 'drizzle-kit'
  - 'drizzle-zod'
sources:
  - 'electric:examples/tanstack-db-web-starter/src/db'
  - 'electric:examples/tanstack-db-web-starter/drizzle.config.ts'
---

# Drizzle ORM with Electric

Drizzle handles schema definition, migrations, Zod validation, and txid
generation for the Electric write path.

## Setup

```bash
pnpm add drizzle-orm pg drizzle-zod zod
pnpm add -D drizzle-kit @types/pg
```

## Core Patterns

### Schema Definition

```typescript
// src/db/schema.ts
import {
  pgTable,
  text,
  varchar,
  boolean,
  integer,
  timestamp,
} from 'drizzle-orm/pg-core'

export const todosTable = pgTable('todos', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  text: varchar({ length: 500 }).notNull(),
  completed: boolean().notNull().default(false),
  created_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  user_id: text('user_id').notNull(),
})
```

### Zod Schema Generation

```typescript
import { createSchemaFactory } from 'drizzle-zod'
import { z } from 'zod'

const { createSelectSchema, createInsertSchema } = createSchemaFactory({
  zodInstance: z,
})

export const selectTodoSchema = createSelectSchema(todosTable)
export const insertTodoSchema = createInsertSchema(todosTable)
export const createTodoSchema = insertTodoSchema.omit({
  id: true,
  created_at: true,
})
```

### Transaction ID Generation

```typescript
import { sql } from 'drizzle-orm'

async function generateTxId(tx: any): Promise<number> {
  const result = await tx.execute(
    sql`SELECT pg_current_xact_id()::xid::text as txid`
  )
  return parseInt(result.rows[0].txid, 10)
}
```

The `::xid` cast strips the epoch to match Electric's replication stream format.

### Mutations with txid

```typescript
export async function createTodo(input: NewTodo) {
  return await db.transaction(async (tx) => {
    const txid = await generateTxId(tx)
    const [newTodo] = await tx.insert(todosTable).values(input).returning()
    return { item: newTodo, txid }
  })
}
```

### Drizzle Config

```typescript
// drizzle.config.ts
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  out: './src/db/migrations',
  schema: './src/db/schema.ts',
  dialect: 'postgresql',
  casing: 'snake_case',
  dbCredentials: { url: process.env.DATABASE_URL! },
})
```

### Migrations

```bash
pnpm drizzle-kit generate   # generate migration from schema changes
pnpm drizzle-kit migrate    # apply migrations
pnpm drizzle-kit push       # push directly (dev only)
```

## Common Mistakes

### [CRITICAL] Not generating txid in Drizzle mutation

Wrong:

```typescript
export async function createTodo(input: NewTodo) {
  const [todo] = await db.insert(todosTable).values(input).returning()
  return { todo }
}
```

Correct:

```typescript
export async function createTodo(input: NewTodo) {
  return await db.transaction(async (tx) => {
    const txid = await generateTxId(tx)
    const [todo] = await tx.insert(todosTable).values(input).returning()
    return { todo, txid }
  })
}
```

Must call `pg_current_xact_id()::xid::text` in the same transaction as the write.
Without txid, the TanStack DB collection can't drop optimistic state.

Source: AGENTS.md Write-path contract

### [HIGH] Schema mismatch between Drizzle and Electric shape

Wrong:

```typescript
// Drizzle schema has "createdAt" (camelCase)
// But Electric shape uses column name "created_at" (snake_case)
origin.searchParams.set('columns', 'id,createdAt')
```

Correct:

```typescript
// Use the actual Postgres column names in shape params
origin.searchParams.set('columns', 'id,created_at')
```

Shape `columns` param must match the actual Postgres column names, not Drizzle's
JavaScript property names.

Source: examples/tanstack-db-web-starter

### [HIGH] Using timestamp without timezone

Wrong:

```typescript
created_at: timestamp().notNull().defaultNow(),
```

Correct:

```typescript
created_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
```

Always use `withTimezone: true` for timestamps. Electric preserves timezone info,
and timestamps without timezone can cause inconsistencies across time zones.

Source: examples/tanstack-db-web-starter/src/db/schema.ts

## References

- [Drizzle ORM Docs](https://orm.drizzle.team)
- [drizzle-zod](https://orm.drizzle.team/docs/zod)
- [tanstack-db-web-starter](https://github.com/electric-sql/electric/tree/main/examples/tanstack-db-web-starter)
