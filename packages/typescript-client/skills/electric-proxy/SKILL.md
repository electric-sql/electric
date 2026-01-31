---
name: electric-proxy
description: Complete Electric proxy implementation - helper functions, headers, auth, framework examples
triggers:
  - electric proxy
  - proxy electric
  - shape proxy
  - electric api route
  - electric server route
metadata:
  sources:
    - examples/tanstack-db-web-starter/src/lib/electric-proxy.ts
    - website/docs/guides/auth.md
---

# Electric Proxy Implementation

Complete guide to implementing Electric shape proxies. Electric is public by default - **always use a proxy in production**.

## Why Proxy?

```
Client → Your Proxy → Electric → Postgres
           ↓
    1. Authenticate user
    2. Define shape (table, where clause)
    3. Inject server secrets
    4. Add cache headers
```

**Never expose Electric directly.** The proxy:

- Keeps secrets server-side (ELECTRIC_SECRET)
- Controls what data users can access
- Scopes shapes to authenticated users

## Core Pattern: Helper Functions

Create reusable helpers for all your proxy routes:

```typescript
// lib/electric-proxy.ts
import { ELECTRIC_PROTOCOL_QUERY_PARAMS } from '@electric-sql/client'

function getElectricUrl(): string {
  return process.env.ELECTRIC_URL || 'http://localhost:30000'
}

/**
 * Prepares Electric URL from incoming request.
 * - Copies only Electric protocol params (offset, handle, etc.)
 * - Adds cloud auth if configured
 */
export function prepareElectricUrl(requestUrl: string): URL {
  const url = new URL(requestUrl)
  const originUrl = new URL(`${getElectricUrl()}/v1/shape`)

  // IMPORTANT: Only copy Electric protocol params
  // Never pass through table/where from client!
  url.searchParams.forEach((value, key) => {
    if (ELECTRIC_PROTOCOL_QUERY_PARAMS.includes(key)) {
      originUrl.searchParams.set(key, value)
    }
  })

  // Electric Cloud auth (if configured)
  if (process.env.ELECTRIC_SOURCE_ID && process.env.ELECTRIC_SECRET) {
    originUrl.searchParams.set('source_id', process.env.ELECTRIC_SOURCE_ID)
    originUrl.searchParams.set('secret', process.env.ELECTRIC_SECRET)
  }

  return originUrl
}

/**
 * Proxies request to Electric with proper header handling.
 */
export async function proxyElectricRequest(originUrl: URL): Promise<Response> {
  const response = await fetch(originUrl)
  const headers = new Headers(response.headers)

  // REQUIRED: Remove headers that break browser decoding
  // fetch() decompresses but doesn't update these headers
  // See: https://github.com/whatwg/fetch/issues/1729
  headers.delete('content-encoding')
  headers.delete('content-length')

  // Cache isolation - different auth = different cache
  headers.set('vary', 'cookie') // or "authorization" for bearer tokens

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}
```

## ELECTRIC_PROTOCOL_QUERY_PARAMS

The client exports this constant containing params safe to forward:

```typescript
// These are the params Electric uses for sync protocol
;[
  'offset',
  'handle',
  'live',
  'cursor',
  // ... other protocol params
]
```

**Never forward `table`, `where`, or `columns` from client.** Always set these server-side.

## Framework Implementations

### TanStack Start

```typescript
// src/routes/api/todos.ts
import { createFileRoute } from '@tanstack/react-router'
import { prepareElectricUrl, proxyElectricRequest } from '@/lib/electric-proxy'
import { auth } from '@/lib/auth' // your auth

const serve = async ({ request }: { request: Request }) => {
  // 1. Authenticate
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    })
  }

  // 2. Build Electric URL
  const originUrl = prepareElectricUrl(request.url)

  // 3. Set shape server-side
  originUrl.searchParams.set('table', 'todos')

  // 4. Scope to user
  const filter = `'${session.user.id}' = ANY(user_ids)`
  originUrl.searchParams.set('where', filter)

  // 5. Proxy
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

### Next.js App Router

```typescript
// app/api/todos/route.ts
import { NextRequest } from 'next/server'
import { prepareElectricUrl, proxyElectricRequest } from '@/lib/electric-proxy'
import { auth } from '@/lib/auth'

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user) {
    return new Response('Unauthorized', { status: 401 })
  }

  const originUrl = prepareElectricUrl(request.url)
  originUrl.searchParams.set('table', 'todos')
  originUrl.searchParams.set('where', `user_id = '${session.user.id}'`)

  return proxyElectricRequest(originUrl)
}
```

### Express

```typescript
// routes/api/todos.ts
import express from 'express'
import { prepareElectricUrl, proxyElectricRequest } from '../lib/electric-proxy'

const router = express.Router()

router.get('/todos', async (req, res) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const fullUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`
  const originUrl = prepareElectricUrl(fullUrl)
  originUrl.searchParams.set('table', 'todos')
  originUrl.searchParams.set('where', `user_id = '${req.user.id}'`)

  const response = await proxyElectricRequest(originUrl)

  // Forward response
  res.status(response.status)
  response.headers.forEach((value, key) => res.setHeader(key, value))
  const body = await response.arrayBuffer()
  res.send(Buffer.from(body))
})

export default router
```

### Hono

```typescript
// routes/todos.ts
import { Hono } from 'hono'
import { prepareElectricUrl, proxyElectricRequest } from '../lib/electric-proxy'

const app = new Hono()

app.get('/api/todos', async (c) => {
  const user = c.get('user')
  if (!user) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const originUrl = prepareElectricUrl(c.req.url)
  originUrl.searchParams.set('table', 'todos')
  originUrl.searchParams.set('where', `user_id = '${user.id}'`)

  return proxyElectricRequest(originUrl)
})

export default app
```

## Parameterized Where Clauses

For SQL injection safety, use parameterized queries:

```typescript
// Instead of string interpolation:
originUrl.searchParams.set('where', `user_id = '${userId}'`) // risky

// Use params:
originUrl.searchParams.set('where', 'user_id = $1')
originUrl.searchParams.set('params', JSON.stringify([userId]))
```

## Multi-Condition Filters

```typescript
// AND conditions
originUrl.searchParams.set('where', 'user_id = $1 AND status = $2')
originUrl.searchParams.set('params', JSON.stringify([userId, 'active']))

// Array membership
originUrl.searchParams.set('where', `'${userId}' = ANY(user_ids)`)

// Org-based access
originUrl.searchParams.set('where', 'org_id = $1')
originUrl.searchParams.set('params', JSON.stringify([user.orgId]))
```

## Headers Reference

### Must Delete

```typescript
headers.delete('content-encoding') // fetch decompresses, header lies
headers.delete('content-length') // content length changed after decompression
```

### Must Add

```typescript
// For cookie-based auth:
headers.set('vary', 'cookie')

// For bearer token auth:
headers.set('vary', 'authorization')

// For both:
headers.set('vary', 'authorization, cookie')
```

The `Vary` header ensures browsers/CDNs cache separately per user.

## Electric Cloud vs Self-Hosted

### Self-Hosted (Docker)

```bash
# .env
ELECTRIC_URL=http://localhost:30000
```

No additional auth params needed.

### Electric Cloud

```bash
# .env
ELECTRIC_URL=https://api.electric-sql.cloud
ELECTRIC_SOURCE_ID=your-source-id
ELECTRIC_SECRET=your-secret-keep-server-side
```

The helper functions auto-detect and add these.

## Error Handling

```typescript
export async function proxyElectricRequest(originUrl: URL): Promise<Response> {
  try {
    const response = await fetch(originUrl)

    // Electric returns 400 for invalid shapes
    if (response.status === 400) {
      const error = await response.text()
      console.error('Electric shape error:', error)
      return new Response(
        JSON.stringify({ error: 'Invalid shape configuration' }),
        {
          status: 500,
          headers: { 'content-type': 'application/json' },
        }
      )
    }

    // ... header handling
  } catch (error) {
    console.error('Electric proxy error:', error)
    return new Response(JSON.stringify({ error: 'Sync service unavailable' }), {
      status: 503,
      headers: { 'content-type': 'application/json' },
    })
  }
}
```

## Anti-Patterns

```typescript
// ❌ WRONG: Client defines shape
app.get('/api/shape', (req) => {
  const { table, where } = req.query // User controls shape!
  originUrl.searchParams.set('table', table)
})

// ❌ WRONG: Secret in client code
const stream = new ShapeStream({
  url: `${ELECTRIC_URL}/v1/shape?secret=${SECRET}`, // Exposed!
})

// ❌ WRONG: No auth check
const serve = async ({ request }) => {
  // Missing: validate user before proxying
  return proxyElectricRequest(prepareElectricUrl(request.url))
}

// ❌ WRONG: Missing Vary header
return new Response(response.body, { headers }) // Cache leaks between users

// ❌ WRONG: Forgetting to delete encoding headers
const headers = new Headers(response.headers)
// Missing: headers.delete("content-encoding")
return new Response(response.body, { headers }) // Browser decode fails
```

## Testing Locally

```bash
# Check Electric is running
curl http://localhost:30000/health

# Test shape directly (no auth)
curl "http://localhost:30000/v1/shape?table=todos"

# Test through your proxy
curl http://localhost:5173/api/todos
```

## Related Skills

- `npx @electric-sql/playbook show tanstack-start-quickstart` - Complete TanStack Start setup
- `npx @electric-sql/playbook show electric-auth` - Authentication patterns
- `npx @electric-sql/playbook show electric-security-check` - Security audit checklist
