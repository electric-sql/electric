---
name: electric-quickstart
description: >
  Scaffolding a new Electric project — prerequisites, pnpm install, first shape,
  ShapeStream, Shape, proxy route, ELECTRIC_PROTOCOL_QUERY_PARAMS, secure-by-default
type: sub-skill
library: '@electric-sql/client'
library_version: '1.5.8'
sources:
  - 'electric:AGENTS.md'
  - 'electric:website/docs/quickstart.md'
---

# Electric Quickstart

Start a new Electric project with the **secure proxy pattern from the start**.
Security is not a production upgrade step.

## Prerequisites

- Node.js 18+
- Postgres 14+ with `wal_level=logical` and a user with `REPLICATION` role
- Electric sync service running (Cloud or Docker)

## Scaffold from Starter

```bash
npx gitpick electric-sql/electric/tree/main/examples/tanstack-db-web-starter my-app
cd my-app
cp .env.example .env
pnpm install
pnpm dev
# in new terminal
pnpm migrate
```

## Minimal Manual Setup

### 1. Install

```bash
pnpm add @electric-sql/client
```

### 2. Create Proxy Route (Server)

```typescript
// api/todos.ts
import { ELECTRIC_PROTOCOL_QUERY_PARAMS } from '@electric-sql/client'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const origin = new URL(`${process.env.ELECTRIC_URL}/v1/shape`)

  url.searchParams.forEach((value, key) => {
    if (ELECTRIC_PROTOCOL_QUERY_PARAMS.includes(key)) {
      origin.searchParams.set(key, value)
    }
  })

  origin.searchParams.set('table', 'todos')

  if (process.env.ELECTRIC_SOURCE_ID) {
    origin.searchParams.set('source_id', process.env.ELECTRIC_SOURCE_ID)
    origin.searchParams.set('secret', process.env.ELECTRIC_SECRET!)
  }

  const res = await fetch(origin)
  const headers = new Headers(res.headers)
  headers.delete('content-encoding')
  headers.delete('content-length')

  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  })
}
```

### 3. Consume Shape (Client)

```typescript
import { ShapeStream, Shape } from '@electric-sql/client'

const stream = new ShapeStream({ url: `/api/todos` })
const shape = new Shape(stream)

const rows = await shape.rows
shape.subscribe(({ rows }) => {
  console.log('Synced todos:', rows)
})
```

### 4. Environment

```bash
# .env
ELECTRIC_URL=http://localhost:3000        # or https://api.electric-sql.cloud
ELECTRIC_SOURCE_ID=your-source-id         # Cloud only
ELECTRIC_SECRET=your-secret-keep-server   # Cloud only
```

## Core Patterns

- **One proxy route per table** — server hardcodes `table`, never the client
- **Forward only protocol params** — use `ELECTRIC_PROTOCOL_QUERY_PARAMS`
- **Delete encoding headers** — `content-encoding` and `content-length` must go
- **Add Vary header** — `Vary: Authorization` or `Vary: Cookie`

## Common Mistakes

### [CRITICAL] Using electrify() or db.table.create() from old Electric

Wrong:

```typescript
import { electrify } from 'electric-sql/wa-sqlite'
const { db } = await electrify(conn, schema)
await db.todos.create({ text: 'Buy milk' })
```

Correct:

```typescript
import { ShapeStream, Shape } from '@electric-sql/client'
const stream = new ShapeStream({ url: `/api/todos` })
const shape = new Shape(stream)
```

Old Electric had bidirectional SQLite sync. New Electric is read-only HTTP —
`electrify()` does not exist. Writes go through your API to Postgres.

Source: AGENTS.md lines 379-393

### [HIGH] Skipping HTTP/2 proxy in local dev

Wrong:

```typescript
// Direct connection, HTTP/1.1
const stream = new ShapeStream({ url: 'http://localhost:3000/v1/shape' })
```

Correct:

```typescript
// Through proxy (Caddy/nginx with HTTP/2)
const stream = new ShapeStream({ url: `/api/todos` })
```

HTTP/1.1 has a 6-connection limit per origin. Multiple shapes cause visible
delays. Use an HTTP/2 proxy (Caddy or nginx) even in development.

Source: AGENTS.md line 296

### [HIGH] Setting up without a proxy (treating security as a later step)

Wrong:

```typescript
// "I'll add auth later"
const stream = new ShapeStream({
  url: 'http://localhost:3000/v1/shape?table=todos',
})
```

Correct:

```typescript
// Proxy from day one
const stream = new ShapeStream({ url: `/api/todos` })
```

The quickstart must include a proxy from the start. Direct Electric connection is
never the right starting point — it creates insecure patterns that are hard to
retrofit.

Source: Maintainer interview, domain discovery feedback

## Tension: Secure-by-default vs tutorial simplicity

Tutorials naturally want the fewest possible steps. But skipping the proxy means
every quickstart reader starts insecure and must retrofit auth later. This skill
uses the proxy pattern from step 1.

Cross-reference: `electric-auth`, `electric-security-check`

## References

- [Quickstart Guide](https://electric-sql.com/docs/quickstart)
- [Shapes Guide](https://electric-sql.com/docs/guides/shapes)
- [TypeScript Client](https://electric-sql.com/docs/api/clients/typescript)
