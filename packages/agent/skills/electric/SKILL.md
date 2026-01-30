---
name: electric
description: Electric sync engine for Postgres - routes to appropriate skills for building local-first apps
triggers:
  - electric
  - electricsql
  - local-first
  - postgres sync
  - real-time sync
  - tanstack db
  - durable streams
metadata:
  sources:
    - AGENTS.md
    - website/docs/quickstart.md
---

# Electric Ecosystem

Build local-first apps with real-time Postgres sync. The ecosystem has three main components:

```
Postgres → Electric → Durable Streams → TanStack DB (client)
```

| Component           | Purpose                                                            | Package                   |
| ------------------- | ------------------------------------------------------------------ | ------------------------- |
| **Electric**        | Postgres sync engine, streams changes as "shapes" over HTTP        | `@electric-sql/client`    |
| **Durable Streams** | Reliable message streaming with exactly-once delivery              | `@durable-streams/client` |
| **TanStack DB**     | Client-side collections with live queries and optimistic mutations | `@tanstack/db`            |

## Loading Skills

Each package has detailed skills. Load them as needed:

**TanStack DB** (live queries, mutations, collections, schemas):

```bash
npx db-skills list                    # See all available skills
npx db-skills show <skill-name>       # Load a specific skill
```

**Durable Streams** (streaming, state sync):

```bash
cat node_modules/@durable-streams/client/skills/durable-streams/SKILL.md
cat node_modules/@durable-streams/client/skills/durable-state/SKILL.md
```

**Electric** (shapes, auth, deployment):

```bash
npx @electric-sql/agent read-skill electric-quickstart
npx @electric-sql/agent read-skill electric-security-check
npx @electric-sql/agent read-skill electric-tanstack-integration
npx @electric-sql/agent list-skills   # See all available
```

## Security Essentials

1. **Never expose secrets to browser** - `SOURCE_SECRET` stays server-side
2. **Electric is public by default** - always put it behind an auth proxy
3. **Server defines shapes** - clients request from proxy, not Electric directly

## Quick Example

**Server proxy** (defines what data users can access):

```typescript
origin.searchParams.set('table', 'todos')
origin.searchParams.set('where', `user_id = $1`)
origin.searchParams.set('params', JSON.stringify([user.id]))
```

**Client collection** (syncs and enables mutations):

```typescript
const todoCollection = createCollection(
  electricCollectionOptions({
    id: 'todos',
    schema: todoSchema,
    shapeOptions: { url: '/api/todos' },
    onInsert: async ({ transaction }) => {
      const { txid } = await api.todos.create(transaction.mutations[0].modified)
      return { txid }
    },
  })
)
```

**Live query** (reactive, sub-ms updates):

```typescript
const { data: todos } = useLiveQuery((q) =>
  q
    .from({ todo: todoCollection })
    .where(({ todo }) => eq(todo.completed, false))
    .orderBy(({ todo }) => todo.created_at, 'desc')
)
```

## References

- [Electric Docs](https://electric-sql.com/docs)
- [TanStack DB](https://tanstack.com/db)
- [Durable Streams](https://github.com/durable-streams/durable-streams)
- [GitHub](https://github.com/electric-sql/electric)
