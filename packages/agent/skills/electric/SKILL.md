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
metadata:
  sources:
    - AGENTS.md
    - website/docs/quickstart.md
---

# Electric

Electric is a Postgres sync engine that streams data to apps via HTTP. Combined with TanStack DB, it enables local-first applications with instant UI, real-time sync, and optimistic mutations.

## How It Works

```
Postgres → Electric → HTTP → Proxy (auth) → TanStack DB (client)
```

- **Electric**: Streams Postgres changes as "shapes" (table subsets) over HTTP
- **TanStack DB**: Client-side collections with live queries and optimistic mutations
- **Proxy**: Your server authenticates users and defines what data they can access
- **Writes**: Client → API → Postgres → Electric streams back → UI reconciles

## What I Can Help With

- **New projects**: Scaffold with TanStack Start + Electric Cloud
- **Adding sync to existing apps**: Set up collections, proxies, live queries
- **Security review**: Audit your Electric setup before production
- **Production readiness**: Go-live checklist, deployment options
- **TanStack DB patterns**: Collections, live queries, optimistic mutations, joins

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
- [GitHub](https://github.com/electric-sql/electric)
