---
name: electric-proxy-auth
description: >
  Set up a server-side proxy to forward Electric shape requests securely.
  Covers ELECTRIC_PROTOCOL_QUERY_PARAMS forwarding, server-side shape
  definition (table, where, params), content-encoding/content-length header
  cleanup, CORS configuration for electric-offset/electric-handle/
  electric-schema/electric-cursor headers, auth token injection,
  ELECTRIC_SECRET/SOURCE_SECRET server-side only, tenant isolation via
  WHERE positional params, onError 401 token refresh, and subset security
  (AND semantics). Load when creating proxy routes, adding auth, or
  configuring CORS for Electric.
type: core
library: electric
library_version: '1.5.10'
requires:
  - electric-shapes
sources:
  - 'electric-sql/electric:packages/typescript-client/src/constants.ts'
  - 'electric-sql/electric:examples/proxy-auth/app/shape-proxy/route.ts'
  - 'electric-sql/electric:website/docs/guides/auth.md'
  - 'electric-sql/electric:website/docs/guides/security.md'
---

This skill builds on electric-shapes. Read it first for ShapeStream configuration.

# Electric — Proxy and Auth

## Setup

```ts
import { ELECTRIC_PROTOCOL_QUERY_PARAMS } from '@electric-sql/client'

// Server route (Next.js App Router example)
export async function GET(request: Request) {
  const url = new URL(request.url)
  const originUrl = new URL('/v1/shape', process.env.ELECTRIC_URL)

  // Only forward Electric protocol params — never table/where from client
  url.searchParams.forEach((value, key) => {
    if (ELECTRIC_PROTOCOL_QUERY_PARAMS.includes(key)) {
      originUrl.searchParams.set(key, value)
    }
  })

  // Server decides shape definition
  originUrl.searchParams.set('table', 'todos')
  originUrl.searchParams.set('secret', process.env.ELECTRIC_SOURCE_SECRET!)

  const response = await fetch(originUrl)
  const headers = new Headers(response.headers)
  headers.delete('content-encoding')
  headers.delete('content-length')

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}
```

Client usage:

```ts
import { ShapeStream } from '@electric-sql/client'

const stream = new ShapeStream({
  url: '/api/todos', // Points to your proxy, not Electric directly
})
```

## Core Patterns

### Tenant isolation with WHERE params

```ts
// In proxy route — inject user context server-side
const user = await getAuthUser(request)
originUrl.searchParams.set('table', 'todos')
originUrl.searchParams.set('where', 'org_id = $1')
originUrl.searchParams.set('params[1]', user.orgId)
```

### Auth token refresh on 401

```ts
const stream = new ShapeStream({
  url: '/api/todos',
  headers: {
    Authorization: async () => `Bearer ${await getToken()}`,
  },
  onError: async (error) => {
    if (error instanceof FetchError && error.status === 401) {
      const newToken = await refreshToken()
      return { headers: { Authorization: `Bearer ${newToken}` } }
    }
    return {}
  },
})
```

### CORS configuration for cross-origin proxies

```ts
// In proxy response headers
headers.set(
  'Access-Control-Expose-Headers',
  'electric-offset, electric-handle, electric-schema, electric-cursor'
)
```

### Subset security (AND semantics)

Electric combines the main shape WHERE (set in proxy) with subset WHERE (from POST body) using AND. Subsets can only narrow results, never widen them:

```sql
-- Main shape: WHERE org_id = $1 (set by proxy)
-- Subset: WHERE status = 'active' (from client POST)
-- Effective: WHERE org_id = $1 AND status = 'active'
```

Even `WHERE 1=1` in the subset cannot bypass the main shape's WHERE.

## Common Mistakes

### CRITICAL Forwarding all client params to Electric

Wrong:

```ts
url.searchParams.forEach((value, key) => {
  originUrl.searchParams.set(key, value)
})
```

Correct:

```ts
import { ELECTRIC_PROTOCOL_QUERY_PARAMS } from '@electric-sql/client'

url.searchParams.forEach((value, key) => {
  if (ELECTRIC_PROTOCOL_QUERY_PARAMS.includes(key)) {
    originUrl.searchParams.set(key, value)
  }
})
originUrl.searchParams.set('table', 'todos')
```

Forwarding all params lets the client control `table`, `where`, and `columns`, accessing any Postgres table. Only forward `ELECTRIC_PROTOCOL_QUERY_PARAMS`.

Source: `examples/proxy-auth/app/shape-proxy/route.ts`

### CRITICAL Not deleting content-encoding and content-length headers

Wrong:

```ts
return new Response(response.body, {
  status: response.status,
  headers: response.headers,
})
```

Correct:

```ts
const headers = new Headers(response.headers)
headers.delete('content-encoding')
headers.delete('content-length')
return new Response(response.body, { status: response.status, headers })
```

`fetch()` decompresses the response body but keeps the original `content-encoding` and `content-length` headers, causing browser decoding failures.

Source: `examples/proxy-auth/app/shape-proxy/route.ts:49-56`

### CRITICAL Exposing ELECTRIC_SECRET or SOURCE_SECRET to browser

Wrong:

```ts
// Client-side code
const url = `/v1/shape?table=todos&secret=${import.meta.env.VITE_ELECTRIC_SOURCE_SECRET}`
```

Correct:

```ts
// Server proxy only
originUrl.searchParams.set('secret', process.env.ELECTRIC_SOURCE_SECRET!)
```

Bundlers like Vite expose `VITE_*` env vars to client code. The secret must only be injected server-side in the proxy.

Source: `AGENTS.md:17-20`

### CRITICAL SQL injection in WHERE clause via string interpolation

Wrong:

```ts
originUrl.searchParams.set('where', `org_id = '${user.orgId}'`)
```

Correct:

```ts
originUrl.searchParams.set('where', 'org_id = $1')
originUrl.searchParams.set('params[1]', user.orgId)
```

String interpolation in WHERE clauses enables SQL injection. Use positional params (`$1`, `$2`).

Source: `website/docs/guides/auth.md`

### HIGH Not exposing Electric response headers via CORS

Wrong:

```ts
// No CORS header configuration — browser strips custom headers
return new Response(response.body, { headers })
```

Correct:

```ts
headers.set(
  'Access-Control-Expose-Headers',
  'electric-offset, electric-handle, electric-schema, electric-cursor'
)
return new Response(response.body, { headers })
```

The client throws `MissingHeadersError` if Electric response headers are stripped by CORS. Expose `electric-offset`, `electric-handle`, `electric-schema`, and `electric-cursor`.

Source: `packages/typescript-client/src/error.ts:109-118`

### CRITICAL Calling Electric directly from production client

Wrong:

```ts
new ShapeStream({
  url: 'https://my-electric.example.com/v1/shape',
  params: { table: 'todos' },
})
```

Correct:

```ts
new ShapeStream({
  url: '/api/todos', // Your proxy route
})
```

Electric's HTTP API is public by default with no auth. Always proxy through your server so the server controls shape definitions and injects secrets.

Source: `AGENTS.md:19-20`

See also: electric-shapes/SKILL.md — Shape URLs must point to proxy routes, not directly to Electric.
See also: electric-deployment/SKILL.md — Production requires ELECTRIC_SECRET and proxy; dev uses ELECTRIC_INSECURE=true.
See also: electric-postgres-security/SKILL.md — Proxy injects secrets that Postgres security enforces.

## Version

Targets @electric-sql/client v1.5.10.
