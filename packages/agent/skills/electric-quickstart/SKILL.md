---
name: electric-quickstart
description: Getting started with Electric and TanStack DB - scaffold and run your first app
triggers:
  - quickstart
  - getting started
  - new project
  - scaffold
  - starter
metadata:
  sources:
    - website/docs/quickstart.md
    - AGENTS.md
---

# Electric Quickstart

Get up and running with Electric and TanStack DB in minutes.

## Prerequisites

- Node.js 18+
- pnpm (recommended) or npm
- Caddy (for local HTTP/2 development)

```bash
# Install Caddy's root certificate (first time only)
caddy trust
```

## Option 1: Electric Cloud (Recommended)

The fastest path - uses Electric Cloud for managed sync service.

```bash
# Scaffold the project
npx @electric-sql/start my-electric-app
cd my-electric-app

# Start dev server
pnpm dev
```

Open https://localhost:5173

### Verify Real-Time Sync

```bash
# In another terminal
pnpm psql

# Update data and watch the UI update instantly
UPDATE projects SET name = 'Hello Electric!';
```

### Deploy

```bash
pnpm claim   # Claim Electric Cloud resources
pnpm deploy  # Deploy to Netlify (or your preferred host)
```

## Option 2: Docker (Self-Hosted)

Run Electric and Postgres locally.

```bash
# Clone starter template
npx gitpick electric-sql/electric/tree/main/examples/tanstack-db-web-starter my-electric-app
cd my-electric-app

# Setup environment
cp .env.example .env

# Install dependencies
pnpm install

# Start backend services
pnpm backend:up

# Apply migrations
pnpm migrate

# Start dev server
pnpm dev
```

## Project Structure

```
my-electric-app/
├── app/
│   ├── routes/           # TanStack Start routes
│   ├── db/
│   │   ├── collections/  # Electric collections
│   │   └── schema.ts     # Zod schemas
│   └── api/              # Server routes (proxies)
├── drizzle/              # Database migrations
├── docker-compose.yml    # Backend services
└── AGENTS.md             # AI agent instructions
```

## Key Files to Modify

### 1. Database Schema (`drizzle/`)

Add tables via Drizzle migrations:

```typescript
// drizzle/0001_add_tasks.sql
CREATE TABLE tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  completed BOOLEAN DEFAULT FALSE,
  project_id UUID REFERENCES projects(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

Apply: `pnpm migrate`

### 2. Zod Schema (`app/db/schema.ts`)

```typescript
import { z } from 'zod'

export const taskSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  completed: z.boolean(),
  project_id: z.string().uuid(),
  created_at: z.string(),
})
```

### 3. Collection (`app/db/collections/tasks.ts`)

```typescript
import { createCollection } from '@tanstack/react-db'
import { electricCollectionOptions } from '@tanstack/electric-db-collection'
import { taskSchema } from '../schema'

export const taskCollection = createCollection(
  electricCollectionOptions({
    id: 'tasks',
    schema: taskSchema,
    getKey: (row) => row.id,
    shapeOptions: { url: '/api/tasks' },
    onInsert: async ({ transaction }) => {
      const task = transaction.mutations[0].modified
      const { txid } = await api.tasks.create(task)
      return { txid }
    },
    onUpdate: async ({ transaction }) => {
      const task = transaction.mutations[0].modified
      const { txid } = await api.tasks.update(task)
      return { txid }
    },
    onDelete: async ({ transaction }) => {
      const id = transaction.mutations[0].key
      const { txid } = await api.tasks.delete(id)
      return { txid }
    },
  })
)
```

### 4. Proxy Route (`app/api/tasks.ts`)

```typescript
import { createServerFileRoute } from '@tanstack/react-start/server'
import { ELECTRIC_PROTOCOL_QUERY_PARAMS } from '@electric-sql/client'

const serve = async ({ request }: { request: Request }) => {
  const url = new URL(request.url)
  const origin = new URL(process.env.ELECTRIC_URL!)

  url.searchParams.forEach((v, k) => {
    if (ELECTRIC_PROTOCOL_QUERY_PARAMS.includes(k))
      origin.searchParams.set(k, v)
  })

  // Shape defined server-side
  origin.searchParams.set('table', 'tasks')
  origin.searchParams.set('source_id', process.env.SOURCE_ID!)
  origin.searchParams.set('secret', process.env.SOURCE_SECRET!)

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

export const ServerRoute = createServerFileRoute('/api/tasks').methods({
  GET: serve,
})
```

### 5. Component

```tsx
import { useLiveQuery, eq } from '@tanstack/react-db'
import { taskCollection } from '../db/collections/tasks'

export function TaskList({ projectId }: { projectId: string }) {
  const { data: tasks } = useLiveQuery((q) =>
    q
      .from({ task: taskCollection })
      .where(({ task }) => eq(task.project_id, projectId))
      .orderBy(({ task }) => task.created_at, 'desc')
  )

  const addTask = (title: string) => {
    taskCollection.insert({
      id: crypto.randomUUID(),
      title,
      completed: false,
      project_id: projectId,
      created_at: new Date().toISOString(),
    })
  }

  return (
    <ul>
      {tasks.map((task) => (
        <li key={task.id}>{task.title}</li>
      ))}
    </ul>
  )
}
```

## Common Issues

### Slow Shapes in Development

Electric uses HTTP/2 for performance. Browsers limit HTTP/1.1 to 6 connections.

**Solution**: Use Caddy (included in starter) or configure nginx with HTTP/2.

### Missing txid Handshake

If optimistic updates "flicker", ensure your API returns `txid`:

```typescript
// API handler
const result = await db.execute(sql`
  INSERT INTO tasks (...) VALUES (...)
  RETURNING (SELECT pg_current_xact_id()::xid::text) as txid
`)
return { txid: parseInt(result.rows[0].txid) }
```

## Next Steps

- `npx @electric-sql/agent read-skill electric-tanstack-integration` - Deep patterns
- `npx @electric-sql/agent read-skill electric-security-check` - Before production
- `npx @electric-sql/agent read-skill deploying-electric` - Deployment options
