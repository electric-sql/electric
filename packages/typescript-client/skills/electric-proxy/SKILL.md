---
name: electric-proxy
description: >
  Implementing proxy routes — ELECTRIC_PROTOCOL_QUERY_PARAMS, prepareElectricUrl,
  proxyElectricRequest, content-encoding deletion, Vary header, one route per
  table, server-defined shapes, parameterized WHERE, TanStack Start, Next.js,
  Express, Hono framework examples
type: sub-skill
library: '@electric-sql/client'
library_version: '1.5.8'
sources:
  - 'electric:examples/tanstack-db-web-starter/src/lib/electric-proxy.ts'
  - 'electric:website/docs/guides/auth.md'
  - 'electric:AGENTS.md'
---

# Electric Proxy Implementation

Electric is public by default — **always use a proxy in production**.

## Setup

```typescript
import { ELECTRIC_PROTOCOL_QUERY_PARAMS } from '@electric-sql/client'
```

## Core Patterns

### Reusable Helper Functions

```typescript
// lib/electric-proxy.ts
import { ELECTRIC_PROTOCOL_QUERY_PARAMS } from '@electric-sql/client'

export function prepareElectricUrl(requestUrl: string): URL {
  const url = new URL(requestUrl)
  const originUrl = new URL(
    `${process.env.ELECTRIC_URL || 'http://localhost:3000'}/v1/shape`
  )

  url.searchParams.forEach((value, key) => {
    if (ELECTRIC_PROTOCOL_QUERY_PARAMS.includes(key)) {
      originUrl.searchParams.set(key, value)
    }
  })

  if (process.env.ELECTRIC_SOURCE_ID && process.env.ELECTRIC_SECRET) {
    originUrl.searchParams.set('source_id', process.env.ELECTRIC_SOURCE_ID)
    originUrl.searchParams.set('secret', process.env.ELECTRIC_SECRET)
  }

  return originUrl
}

export async function proxyElectricRequest(originUrl: URL): Promise<Response> {
  const response = await fetch(originUrl)
  const headers = new Headers(response.headers)
  headers.delete('content-encoding')
  headers.delete('content-length')
  headers.set('vary', 'authorization')

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}
```

### One Route Per Table

```typescript
// /api/todos — server hardcodes table
const originUrl = prepareElectricUrl(request.url)
originUrl.searchParams.set('table', 'todos')
return proxyElectricRequest(originUrl)

// /api/projects — separate route, separate table
const originUrl = prepareElectricUrl(request.url)
originUrl.searchParams.set('table', 'projects')
return proxyElectricRequest(originUrl)
```

### Parameterized WHERE (user scoping)

```typescript
originUrl.searchParams.set('where', 'user_id = $1')
originUrl.searchParams.set('params', JSON.stringify([userId]))
```

### Passing Client Arguments to Proxy

```typescript
// Client
shapeOptions: {
  url: `/api/todos?projectId=${projectId}`
}

// Server
const projectId = new URL(request.url).searchParams.get('projectId')
originUrl.searchParams.set('where', 'project_id = $1')
originUrl.searchParams.set('params', JSON.stringify([projectId]))
```

### Framework Examples

**Next.js App Router:**

```typescript
// app/api/todos/route.ts
export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return new Response('Unauthorized', { status: 401 })

  const originUrl = prepareElectricUrl(request.url)
  originUrl.searchParams.set('table', 'todos')
  originUrl.searchParams.set('where', 'user_id = $1')
  originUrl.searchParams.set('params', JSON.stringify([session.user.id]))
  return proxyElectricRequest(originUrl)
}
```

**TanStack Start:**

```typescript
const serve = async ({ request }: { request: Request }) => {
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session) return new Response('Unauthorized', { status: 401 })

  const originUrl = prepareElectricUrl(request.url)
  originUrl.searchParams.set('table', 'todos')
  return proxyElectricRequest(originUrl)
}
```

**Express:**

```typescript
router.get('/todos', async (req, res) => {
  const fullUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`
  const originUrl = prepareElectricUrl(fullUrl)
  originUrl.searchParams.set('table', 'todos')

  const response = await proxyElectricRequest(originUrl)
  res.status(response.status)
  response.headers.forEach((v, k) => res.setHeader(k, v))
  res.send(Buffer.from(await response.arrayBuffer()))
})
```

## Common Mistakes

### [CRITICAL] Letting client define table and WHERE params

Wrong:

```typescript
app.get('/api/shape', (req) => {
  const { table, where } = req.query
  originUrl.searchParams.set('table', table)
  originUrl.searchParams.set('where', where)
})
```

Correct:

```typescript
// /api/todos.ts — server hardcodes the table
originUrl.searchParams.set('table', 'todos')
originUrl.searchParams.set('where', 'user_id = $1')
originUrl.searchParams.set('params', JSON.stringify([session.user.id]))
```

Client-controlled shape params allow data exfiltration. A generic `/api/shape?table=X`
endpoint lets clients query ANY table. Server must define table and WHERE.

Source: AGENTS.md Security Rules #4

### [HIGH] Proxy strips required Electric response headers

Wrong:

```typescript
const headers = new Headers()
headers.set('content-type', response.headers.get('content-type')!)
return new Response(response.body, { headers })
```

Correct:

```typescript
const headers = new Headers(response.headers)
headers.delete('content-encoding')
headers.delete('content-length')
return new Response(response.body, { headers })
```

These headers must be forwarded to the client:

- `electric-offset` — next position in the shape log
- `electric-handle` — shape identifier for subsequent requests
- `electric-schema` — JSON schema (first request only)
- `cache-control`, `etag` — caching directives for CDN/browser

Stripping the `electric-*` headers throws `MissingHeadersError` in the client.
Stripping cache headers breaks request collapsing and CDN efficiency.

Source: packages/typescript-client/src/fetch.ts

### [HIGH] Not forwarding Electric protocol query params

Wrong:

```typescript
const originUrl = new URL(`${ELECTRIC_URL}/v1/shape`)
originUrl.searchParams.set('table', 'todos')
return fetch(originUrl)
```

Correct:

```typescript
const originUrl = prepareElectricUrl(request.url)
originUrl.searchParams.set('table', 'todos')
return proxyElectricRequest(originUrl)
```

Must pass `offset`, `handle`, `live`, `cursor` through the proxy. Use the
`ELECTRIC_PROTOCOL_QUERY_PARAMS` constant to know which params to forward.

Source: AGENTS.md proxy example

## References

- [Auth Guide](https://electric-sql.com/docs/guides/auth)
- [Security Guide](https://electric-sql.com/docs/guides/security)
- [proxy-auth example](https://github.com/electric-sql/electric/tree/main/examples/proxy-auth)
