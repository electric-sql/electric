---
name: tanstack-start-quickstart
description: Complete TanStack Start + Electric setup - copy-paste-ready files
triggers:
  - tanstack start
  - tanstack start electric
  - tanstack start setup
  - tanstack start proxy
  - ssr electric
metadata:
  sources:
    - examples/tanstack-db-web-starter
    - AGENTS.md
---

# TanStack Start + Electric Quickstart

Complete, copy-paste-ready setup for TanStack Start with Electric sync.

## Prerequisites Checklist

Before starting, ensure you have:

```bash
# Required packages
pnpm add @tanstack/react-start @tanstack/react-router nitro @electric-sql/client

# For collections (optional but recommended)
pnpm add @tanstack/react-db @tanstack/electric-db-collection
```

Required files you'll create:

- [ ] `src/server.ts` - Server entry point
- [ ] `src/start.tsx` - TanStack Start config (SSR disabled)
- [ ] `src/lib/electric-proxy.ts` - Proxy helper functions
- [ ] `src/routes/api/{table}.ts` - API routes for each shape
- [ ] `vite.config.ts` - With nitro plugin

## Step 1: Vite Config with Nitro

```typescript
// vite.config.ts
import { defineConfig } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { nitro } from 'nitro/vite'

export default defineConfig({
  plugins: [nitro(), tanstackStart(), viteReact()],
})
```

## Step 2: Server Entry Point

```typescript
// src/server.ts
import handler from '@tanstack/react-start/server-entry'

export default {
  fetch(request: Request) {
    return handler.fetch(request)
  },
}
```

## Step 3: Configure SPA Mode (Disable SSR)

TanStack DB uses client-side state that doesn't work with SSR. You need to configure SPA mode.

See: [TanStack Start SPA Mode Guide](https://tanstack.com/start/latest/docs/framework/react/guide/spa-mode)

### Option A: Disable SSR Globally (Recommended)

```typescript
// src/start.tsx
import { createStart } from '@tanstack/react-start'

export const startInstance = createStart(() => ({
  defaultSsr: false,
}))
```

### Option B: Disable SSR Per-Route

```typescript
// src/routes/my-route.tsx
export const Route = createFileRoute('/my-route')({
  ssr: false,
  component: MyComponent,
})
```

### Required: Shell Component

Even with SSR disabled, the `<html>` shell must be rendered on the server. Configure this via `shellComponent`:

```typescript
// src/routes/__root.tsx
import { createRootRoute, Outlet, HeadContent, Scripts } from "@tanstack/react-router"

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
    ],
  }),
  // Shell is ALWAYS SSR'd - it provides the HTML wrapper
  shellComponent: RootDocument,
  // Component is NOT SSR'd when defaultSsr: false
  component: () => <Outlet />,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  )
}
```

**Important:** The `shellComponent` is always server-rendered. It wraps your route components, which are client-rendered when SSR is disabled.

## Step 4: Electric Proxy Helpers

```typescript
// src/lib/electric-proxy.ts
import { ELECTRIC_PROTOCOL_QUERY_PARAMS } from '@electric-sql/client'

function getElectricUrl(): string {
  return process.env.ELECTRIC_URL || 'http://localhost:30000'
}

/**
 * Prepares the Electric URL from an incoming request.
 * Copies Electric protocol params and optionally adds cloud auth.
 */
export function prepareElectricUrl(requestUrl: string): URL {
  const url = new URL(requestUrl)
  const electricUrl = getElectricUrl()
  const originUrl = new URL(`${electricUrl}/v1/shape`)

  // Copy only Electric-specific query params
  url.searchParams.forEach((value, key) => {
    if (ELECTRIC_PROTOCOL_QUERY_PARAMS.includes(key)) {
      originUrl.searchParams.set(key, value)
    }
  })

  // Add Electric Cloud auth if configured
  if (process.env.ELECTRIC_SOURCE_ID && process.env.ELECTRIC_SECRET) {
    originUrl.searchParams.set('source_id', process.env.ELECTRIC_SOURCE_ID)
    originUrl.searchParams.set('secret', process.env.ELECTRIC_SECRET)
  }

  return originUrl
}

/**
 * Proxies a request to Electric and returns the response.
 * Removes problematic headers and adds cache isolation.
 */
export async function proxyElectricRequest(originUrl: URL): Promise<Response> {
  const response = await fetch(originUrl)
  const headers = new Headers(response.headers)

  // Remove headers that break browser decoding
  // See: https://github.com/whatwg/fetch/issues/1729
  headers.delete('content-encoding')
  headers.delete('content-length')

  // Add cache isolation for authenticated requests
  headers.set('vary', 'cookie')

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}
```

## Step 5: API Route for Shape

```typescript
// src/routes/api/todos.ts
import { createFileRoute } from '@tanstack/react-router'
import { prepareElectricUrl, proxyElectricRequest } from '@/lib/electric-proxy'

const serve = async ({ request }: { request: Request }) => {
  // Optional: Add auth check here
  // const session = await auth.api.getSession({ headers: request.headers })
  // if (!session) {
  //   return new Response(JSON.stringify({ error: "Unauthorized" }), {
  //     status: 401,
  //     headers: { "content-type": "application/json" },
  //   })
  // }

  const originUrl = prepareElectricUrl(request.url)
  originUrl.searchParams.set('table', 'todos')

  // Optional: Add user scoping
  // originUrl.searchParams.set("where", `user_id = '${session.user.id}'`)

  return proxyElectricRequest(originUrl)
}

export const Route = createFileRoute('/api/todos')({
  server: {
    handlers: {
      GET: serve,
    },
  },
})
```

## Step 6: Collection Setup

```typescript
// src/db/collections/todos.ts
import { createCollection } from '@tanstack/react-db'
import { electricCollectionOptions } from '@tanstack/electric-db-collection'
import { z } from 'zod'

export const todoSchema = z.object({
  id: z.string().uuid(),
  text: z.string(),
  completed: z.boolean(),
  created_at: z.string(),
})

export const todoCollection = createCollection(
  electricCollectionOptions({
    id: 'todos',
    schema: todoSchema,
    getKey: (row) => row.id,
    shapeOptions: {
      // IMPORTANT: Use full URL construction for SSR safety
      // Relative URLs like '/api/todos' fail during SSR
      url: new URL(
        '/api/todos',
        typeof window !== 'undefined'
          ? window.location.origin
          : 'http://localhost:5173'
      ).toString(),
      // Parse Postgres timestamps to Date objects
      parser: {
        timestamptz: (date: string) => new Date(date),
      },
    },
  })
)
```

**Why full URLs?** Collections may be imported during SSR where `window` doesn't exist. The `new URL()` pattern ensures a valid absolute URL in all contexts.

## Step 7: Authentication with better-auth (Optional)

```typescript
// src/lib/auth.ts (server)
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { tanstackStartCookies } from 'better-auth/tanstack-start'
import { db } from '@/db/connection'

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: 'pg' }),
  emailAndPassword: { enabled: true },
  plugins: [tanstackStartCookies()], // Required for TanStack Start
})
```

```typescript
// src/lib/auth-client.ts (client)
import { createAuthClient } from 'better-auth/react'

export const authClient = createAuthClient({
  baseURL: typeof window !== 'undefined' ? window.location.origin : undefined,
})
```

```typescript
// src/routes/api/auth/$.ts (catch-all route)
import { createFileRoute } from '@tanstack/react-router'
import { auth } from '@/lib/auth'

export const Route = createFileRoute('/api/auth/$')({
  server: {
    handlers: {
      GET: ({ request }) => auth.handler(request),
      POST: ({ request }) => auth.handler(request),
    },
  },
})
```

## Step 8: Protected Routes Pattern

```typescript
// src/routes/_authenticated.tsx
import { createFileRoute, Outlet } from '@tanstack/react-router'
import { authClient } from '@/lib/auth-client'

export const Route = createFileRoute('/_authenticated')({
  ssr: false,  // Auth requires client-side
  beforeLoad: async () => {
    const result = await authClient.getSession()
    if (!result.data?.session) {
      throw new Error('Not authenticated')
    }
    return result.data
  },
  errorComponent: () => {
    // Redirect to login on auth error
    if (typeof window !== 'undefined') {
      window.location.href = '/login'
    }
    return null
  },
  component: () => <Outlet />,
})
```

Routes under `_authenticated/` are automatically protected.

## Step 9: Use in Component

```tsx
// src/routes/_authenticated/index.tsx
import { createFileRoute } from '@tanstack/react-router'
import { useLiveQuery } from '@tanstack/react-db'
import { todoCollection } from '@/db/collections/todos'

export const Route = createFileRoute('/_authenticated/')({
  ssr: false,
  // Preload collections to prevent flash of empty state
  loader: async () => {
    await todoCollection.preload()
  },
  component: Home,
})

function Home() {
  const { data: todos } = useLiveQuery((q) =>
    q
      .from({ todo: todoCollection })
      .orderBy(({ todo }) => todo.created_at, 'desc')
  )

  const addTodo = (text: string) => {
    todoCollection.insert({
      id: crypto.randomUUID(),
      text,
      completed: false,
      created_at: new Date().toISOString(),
    })
  }

  return (
    <div>
      <h1>Todos</h1>
      <ul>
        {todos.map((todo) => (
          <li key={todo.id}>{todo.text}</li>
        ))}
      </ul>
    </div>
  )
}
```

## Troubleshooting

### Empty SSR Output (`<!--$--><!--/$-->`)

**Symptom:** Page renders empty HTML comments instead of content.

**Solution:** You need ALL THREE SSR configurations:

1. `defaultSsr: false` in `src/start.tsx`
2. `shellComponent` pattern in `__root.tsx`
3. nitro plugin in vite.config.ts

### TypeScript Error: "server" property doesn't exist

**Symptom:** TypeScript shows error on `server.handlers` in route config.

**Solution:** This is a known type lag. The code works at runtime. You can:

```typescript
// @ts-expect-error - server.handlers types are lagging
server: {
  handlers: {
    GET: serve
  }
}
```

### API Routes Return 404

**Symptom:** `/api/todos` returns 404 in development.

**Checklist:**

1. Is nitro installed? `pnpm add nitro`
2. Does `src/server.ts` exist with correct export?
3. Is nitro() plugin in vite.config.ts?
4. Did you restart the dev server after adding these?

### Shape Requests Hang

**Symptom:** Shape never syncs, request hangs.

**Possible causes:**

1. Electric not running - check `http://localhost:30000/health`
2. Wrong ELECTRIC_URL - check env vars
3. Missing table - run migrations first
4. Firewall blocking - check Docker network

### "content-encoding" Errors

**Symptom:** Browser fails to decode response.

**Solution:** Your proxy must delete these headers:

```typescript
headers.delete('content-encoding')
headers.delete('content-length')
```

### Optimistic Updates Flicker

**Symptom:** Item appears, disappears, reappears.

**Solution:** Return txid from your API:

```typescript
// API handler
const result = await db.execute(sql`
  INSERT INTO todos (...) VALUES (...)
  RETURNING (SELECT pg_current_xact_id()::xid::text) as txid
`)
return { txid: parseInt(result.rows[0].txid) }
```

## File Structure Reference

```
my-app/
├── src/
│   ├── server.ts              # Server entry (REQUIRED)
│   ├── start.tsx              # SSR config (REQUIRED)
│   ├── lib/
│   │   └── electric-proxy.ts  # Proxy helpers
│   ├── db/
│   │   └── collections/
│   │       └── todos.ts       # Electric collections
│   └── routes/
│       ├── __root.tsx         # Root with shellComponent
│       ├── index.tsx          # Your pages
│       └── api/
│           └── todos.ts       # Shape proxy routes
├── vite.config.ts             # With nitro plugin
└── package.json
```

## Local Development Setup

### Docker Compose for Electric + Postgres

```yaml
# docker-compose.yaml
version: '3.3'
services:
  postgres:
    image: postgres:17-alpine
    environment:
      POSTGRES_DB: electric
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: password
    ports:
      - 54321:5432
    command:
      - -c
      - listen_addresses=*
      - -c
      - wal_level=logical # REQUIRED for Electric replication

  electric:
    image: electricsql/electric:latest
    environment:
      DATABASE_URL: postgresql://postgres:password@postgres:5432/electric?sslmode=disable
      ELECTRIC_INSECURE: true # Dev only - see security docs
    ports:
      - 30000:3000
    depends_on:
      - postgres
```

**Critical:** `wal_level=logical` is required for Electric's replication.

### HTTP/2 with Caddy

Electric works best with HTTP/2 (browsers limit HTTP/1.1 to 6 connections). Use Caddy for local HTTPS:

```bash
# Install Caddy and trust certificates (one-time)
brew install caddy  # or see https://caddyserver.com/docs/install
caddy trust

# Caddyfile (auto-generated by vite-plugin-caddy)
localhost:5173 {
  reverse_proxy localhost:5174
  encode gzip
}
```

The example includes a Vite plugin that auto-starts Caddy.

### Environment Variables

```bash
# .env
DATABASE_URL=postgresql://postgres:password@localhost:54321/electric
ELECTRIC_URL=http://localhost:30000
BETTER_AUTH_SECRET=your-secret-min-32-chars
```

## Electric Cloud Setup

For production with Electric Cloud:

```bash
# .env
ELECTRIC_URL=https://api.electric-sql.cloud
ELECTRIC_SOURCE_ID=your-source-id
ELECTRIC_SECRET=your-secret
```

The proxy helpers automatically add these when present.

## Next Steps

- `npx @electric-sql/playbook show electric-proxy` - Advanced proxy patterns
- `npx @electric-sql/playbook show electric-tanstack-integration` - Deep collection patterns
- `npx @electric-sql/playbook show electric-security-check` - Before production
