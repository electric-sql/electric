---
name: electric-drizzle
description: Drizzle ORM setup for Electric - schemas, migrations, Zod integration, txid generation
triggers:
  - drizzle
  - drizzle orm
  - drizzle electric
  - drizzle schema
  - drizzle zod
metadata:
  sources:
    - examples/tanstack-db-web-starter/src/db
    - examples/tanstack-db-web-starter/drizzle.config.ts
---

# Drizzle ORM with Electric

Complete guide to using Drizzle ORM with Electric and TanStack DB.

## Setup

```bash
pnpm add drizzle-orm pg drizzle-zod zod
pnpm add -D drizzle-kit @types/pg
```

## Database Connection

```typescript
// src/db/connection.ts
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
})

export const db = drizzle({
  client: pool,
  casing: 'snake_case', // Converts camelCase to snake_case
})
```

## Drizzle Config

```typescript
// drizzle.config.ts
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  out: './src/db/migrations',
  schema: './src/db/schema.ts',
  dialect: 'postgresql',
  casing: 'snake_case',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
})
```

## Schema Definition

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

// Use text() for UUIDs if you want app-generated IDs
// Use integer().generatedAlwaysAsIdentity() for auto-increment
export const todosTable = pgTable('todos', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  text: varchar({ length: 500 }).notNull(),
  completed: boolean().notNull().default(false),
  created_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  user_id: text('user_id')
    .notNull()
    .references(() => usersTable.id, { onDelete: 'cascade' }),
})

export const usersTable = pgTable('users', {
  id: text('id').primaryKey(), // UUID from auth provider
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  created_at: timestamp('created_at').notNull().defaultNow(),
})
```

### Array Columns (for user access lists)

```typescript
export const projectsTable = pgTable('projects', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  name: varchar({ length: 255 }).notNull(),
  owner_id: text('owner_id').notNull(),
  // Array of user IDs who can access this project
  // Note: In Drizzle v1.0.0-beta.2+, .array() is not chainable
  // For multidimensional arrays, use .array('[][]')
  shared_user_ids: text('shared_user_ids').array().notNull().default([]),
})
```

## Generating Zod Schemas

Use `drizzle-zod` to generate Zod schemas from Drizzle tables.

**Requirements:** Zod v3.25.1+, Drizzle ORM v0.36.0+

**Zod v4 Note:** Support is being added but not fully stable yet. Stick with Zod v3.25.x for now. If using Zod v4, you may need `--legacy-peer-deps` and could encounter type issues with tRPC.

```typescript
// src/db/schema.ts
import { createSchemaFactory } from 'drizzle-zod'
import { z } from 'zod'

// Basic usage
const { createSelectSchema, createInsertSchema, createUpdateSchema } =
  createSchemaFactory({ zodInstance: z })

// With date coercion (recommended for forms)
const { createSelectSchema } = createSchemaFactory({
  zodInstance: z,
  coerce: { date: true }, // Coerce date strings to Date objects
})

// Generate schemas from table
export const selectTodoSchema = createSelectSchema(todosTable)
export const insertTodoSchema = createInsertSchema(todosTable)
export const updateTodoSchema = createUpdateSchema(todosTable)

// Omit server-generated fields for insert
export const createTodoSchema = insertTodoSchema.omit({
  id: true, // Auto-generated
  created_at: true, // Server default
})

// Export types
export type Todo = z.infer<typeof selectTodoSchema>
export type NewTodo = z.infer<typeof createTodoSchema>
```

**Security Note:** Be careful about which schemas you export to client code. Server-only validation logic or internal database structures can leak into the client bundle. Only export schemas needed for client-side validation.

### Using with TanStack DB Collections

```typescript
// src/lib/collections.ts
import { createCollection } from '@tanstack/react-db'
import { electricCollectionOptions } from '@tanstack/electric-db-collection'
import { selectTodoSchema } from '@/db/schema'

export const todoCollection = createCollection(
  electricCollectionOptions({
    id: 'todos',
    schema: selectTodoSchema, // Zod schema from Drizzle
    getKey: (item) => item.id,
    shapeOptions: { url: '/api/todos' },
  })
)
```

## Transaction ID Generation

**Critical for Electric sync.** The `::xid` cast is required to match Electric's replication stream format.

```typescript
// src/lib/db-utils.ts
import { sql } from 'drizzle-orm'
import type { PgTransaction } from 'drizzle-orm/pg-core'

/**
 * Get transaction ID for Electric sync.
 * MUST be called inside a transaction.
 * The ::xid cast strips the epoch to match Electric's format.
 */
export async function generateTxId(
  tx: PgTransaction<any, any, any>
): Promise<number> {
  const result = await tx.execute(
    sql`SELECT pg_current_xact_id()::xid::text as txid`
  )
  const txid = result.rows[0]?.txid
  if (txid === undefined) {
    throw new Error('Failed to get transaction ID')
  }
  return parseInt(txid as string, 10)
}
```

### Using in Mutations

```typescript
// src/api/todos.ts
import { db } from '@/db/connection'
import { todosTable } from '@/db/schema'
import { generateTxId } from '@/lib/db-utils'

export async function createTodo(input: NewTodo) {
  return await db.transaction(async (tx) => {
    // Get txid INSIDE the transaction
    const txid = await generateTxId(tx)

    const [newTodo] = await tx.insert(todosTable).values(input).returning()

    return { item: newTodo, txid }
  })
}

export async function updateTodo(id: number, data: Partial<Todo>) {
  return await db.transaction(async (tx) => {
    const txid = await generateTxId(tx)

    const [updated] = await tx
      .update(todosTable)
      .set(data)
      .where(eq(todosTable.id, id))
      .returning()

    return { item: updated, txid }
  })
}
```

## Migrations

```bash
# Generate migration from schema changes
pnpm drizzle-kit generate

# Apply migrations
pnpm drizzle-kit migrate

# Or push directly (dev only)
pnpm drizzle-kit push
```

### Migration with Custom SQL

Add triggers or functions in migrations:

```sql
-- src/db/migrations/0001_add_sync_trigger.sql

-- Trigger to auto-populate user access on insert
CREATE OR REPLACE FUNCTION populate_todo_user_ids()
RETURNS TRIGGER AS $$
BEGIN
    SELECT ARRAY(SELECT DISTINCT unnest(ARRAY[owner_id] || shared_user_ids))
    INTO NEW.user_ids
    FROM projects
    WHERE id = NEW.project_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER populate_todo_user_ids_trigger
    BEFORE INSERT ON todos
    FOR EACH ROW
    EXECUTE FUNCTION populate_todo_user_ids();
```

## Query Patterns

### With User Scoping

```typescript
import { eq, and, arrayContains } from 'drizzle-orm'

// Check user has access via array column
const todos = await db
  .select()
  .from(todosTable)
  .where(
    and(
      eq(todosTable.project_id, projectId),
      arrayContains(todosTable.user_ids, [userId])
    )
  )
```

### Building WHERE Clauses for Electric Proxy

```typescript
import { sql } from 'drizzle-orm'

// For Electric proxy - get unqualified column name
const whereClause = `'${userId}' = ANY(user_ids)`
originUrl.searchParams.set('where', whereClause)
```

## Type Safety Tips

### Infer Types from Schema

```typescript
// Infer insert type (what you pass to insert())
type NewTodo = typeof todosTable.$inferInsert

// Infer select type (what you get from queries)
type Todo = typeof todosTable.$inferSelect
```

### Strict Null Handling

```typescript
// Columns with .notNull() won't be nullable in types
const todosTable = pgTable('todos', {
  text: varchar({ length: 500 }).notNull(), // string
  description: text(), // string | null
})
```

## Common Patterns

### Timestamps with Timezone

Always use `withTimezone: true` for timestamps - Electric preserves timezone info:

```typescript
created_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
updated_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
```

### Soft Deletes

```typescript
const todosTable = pgTable('todos', {
  // ...
  deleted_at: timestamp({ withTimezone: true }),
})

// Query non-deleted
const todos = await db
  .select()
  .from(todosTable)
  .where(isNull(todosTable.deleted_at))
```

### Optimistic Locking

```typescript
const todosTable = pgTable('todos', {
  // ...
  version: integer().notNull().default(1),
})

// Update with version check
const [updated] = await tx
  .update(todosTable)
  .set({ ...data, version: sql`${todosTable.version} + 1` })
  .where(and(eq(todosTable.id, id), eq(todosTable.version, expectedVersion)))
  .returning()

if (!updated) throw new Error('Concurrent modification')
```

## Related Skills

- `npx @electric-sql/playbook show electric-tanstack-integration` - Collection setup
- `npx @electric-sql/playbook show electric-proxy` - Proxy patterns
- `npx @electric-sql/playbook show tanstack-start-quickstart` - Full setup guide
