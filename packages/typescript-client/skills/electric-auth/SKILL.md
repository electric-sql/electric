---
name: electric-auth
description: Authentication and authorization patterns for Electric
triggers:
  - auth
  - authentication
  - authorization
  - security
  - proxy auth
  - gatekeeper
metadata:
  sources:
    - website/docs/guides/auth.md
    - website/docs/guides/security.md
---

# Electric Auth

Electric is just HTTP - use standard web auth patterns.

## Core Principle

Electric is public by default. **Always use an authenticated proxy** in production.

```
Client → Auth Proxy → Electric → Postgres
           ↓
    Validates user
    Adds shape params
    Injects secret
```

## Proxy Auth Pattern (Recommended)

### Client Code

```typescript
import { ShapeStream } from '@electric-sql/client'

const stream = new ShapeStream({
  url: '/api/todos', // Your proxy endpoint
  headers: {
    Authorization: `Bearer ${authToken}`,
  },
})
```

### Server Proxy

```typescript
import { ELECTRIC_PROTOCOL_QUERY_PARAMS } from '@electric-sql/client'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const origin = new URL(process.env.ELECTRIC_URL!)

  // 1. Authenticate user
  const user = await validateToken(request.headers.get('Authorization'))
  if (!user) {
    return new Response('Unauthorized', { status: 401 })
  }

  // 2. Only pass Electric protocol params
  url.searchParams.forEach((value, key) => {
    if (ELECTRIC_PROTOCOL_QUERY_PARAMS.includes(key)) {
      origin.searchParams.set(key, value)
    }
  })

  // 3. Server defines shape with user scoping
  origin.searchParams.set('table', 'todos')
  origin.searchParams.set('where', `user_id = $1`)
  origin.searchParams.set('params', JSON.stringify([user.id]))

  // 4. Inject server-side credentials
  origin.searchParams.set('source_id', process.env.ELECTRIC_SOURCE_ID!)
  origin.searchParams.set('secret', process.env.ELECTRIC_SECRET!)

  // 5. Proxy request
  const response = await fetch(origin)

  // 6. Clean up response headers
  const headers = new Headers(response.headers)
  headers.delete('content-encoding')
  headers.delete('content-length')

  // 7. Add cache isolation header
  headers.set('Vary', 'Authorization')

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}
```

## Dynamic Headers

For tokens that need refreshing:

```typescript
const stream = new ShapeStream({
  url: '/api/todos',
  headers: {
    // Function called for each request
    Authorization: async () => `Bearer ${await getAccessToken()}`,
  },
})
```

## Error Handling

Handle auth errors gracefully:

```typescript
const stream = new ShapeStream({
  url: '/api/todos',
  headers: {
    Authorization: `Bearer ${token}`,
  },
  onError: async (error) => {
    if (error instanceof FetchError && error.status === 401) {
      // Token expired - refresh and retry
      const newToken = await refreshAuthToken()
      return {
        headers: {
          Authorization: `Bearer ${newToken}`,
        },
      }
    }

    if (error instanceof FetchError && error.status === 403) {
      // No access to this resource
      showAccessDenied()
      return // Stop the stream
    }

    // Other errors - stop syncing
  },
})
```

**Return values:**

- `{ headers, params }` - Retry with new values
- `{}` - Retry with same config
- `void` - Stop the stream

## Gatekeeper Auth Pattern

For edge deployment or when auth logic is complex:

1. Client requests access token from gatekeeper
2. Gatekeeper validates user, generates shape-scoped JWT
3. Client uses JWT for shape requests
4. Edge proxy validates JWT matches requested shape

### 1. Request Token

```typescript
const response = await fetch('/gatekeeper/todos', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${userToken}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    table: 'todos',
    where: 'user_id = $1',
  }),
})

const { shapeToken } = await response.json()
```

### 2. Use Token for Shape

```typescript
const stream = new ShapeStream({
  url: '/proxy/v1/shape',
  headers: {
    Authorization: `Bearer ${shapeToken}`,
  },
  params: {
    table: 'todos',
    where: 'user_id = $1',
  },
})
```

### 3. Edge Proxy Validates

```typescript
// Edge function
export async function GET(request: Request) {
  const token = request.headers.get('Authorization')?.split(' ')[1]
  const claims = await verifyJWT(token)

  // Verify shape claim matches request
  const url = new URL(request.url)
  if (claims.table !== url.searchParams.get('table')) {
    return new Response('Shape mismatch', { status: 403 })
  }

  // Proxy to Electric
  return fetch(
    process.env.ELECTRIC_URL + request.url.pathname + request.url.search
  )
}
```

## Session Invalidation

Prevent cached shapes from being served after logout:

```typescript
// Always add Vary header based on auth method

// Bearer token auth
headers.set('Vary', 'Authorization')

// Cookie auth
headers.set('Vary', 'Cookie')

// Both
headers.set('Vary', 'Authorization, Cookie')
```

This tells browsers/CDNs to cache separately per auth context.

## Type-Safe Where Clauses

For complex where clauses, use query builders:

### With Drizzle

```typescript
import { QueryBuilder } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { todos } from './schema'

// Build type-safe where clause
const whereExpr = sql`${sql.identifier(todos.user_id.name)} = ${user.id}`

const qb = new QueryBuilder()
const { sql: query, params } = qb.select().from(todos).where(whereExpr).toSQL()

// Extract WHERE fragment
const fragment = query.replace(/^SELECT .* FROM .* WHERE\s+/i, '')
origin.searchParams.set('where', fragment)
params.forEach((value, index) => {
  origin.searchParams.set(`params[${index + 1}]`, String(value))
})
```

### With Kysely

```typescript
const query = db.selectFrom('todos').selectAll().where('user_id', '=', user.id)

const { sql, parameters } = query.compile()
const fragment = sql
  .replace(/^SELECT .* FROM .* WHERE\s+/i, '')
  .replace(/\b\w+\./g, '') // Remove table prefixes

origin.searchParams.set('where', fragment)
```

## External Auth Services

Electric works with any auth provider:

### Auth0 / Clerk / etc.

```typescript
// Validate JWT in proxy
import { auth } from '@clerk/nextjs'

export async function GET(request: Request) {
  const { userId } = auth()

  if (!userId) {
    return new Response('Unauthorized', { status: 401 })
  }

  // Use userId to scope shapes
  origin.searchParams.set('where', `user_id = $1`)
  origin.searchParams.set('params', JSON.stringify([userId]))
  // ...
}
```

### Supabase Auth

```typescript
import { createClient } from '@supabase/supabase-js'

export async function GET(request: Request) {
  const supabase = createClient(url, key)
  const {
    data: { user },
  } = await supabase.auth.getUser(
    request.headers.get('Authorization')?.split(' ')[1]
  )

  if (!user) {
    return new Response('Unauthorized', { status: 401 })
  }

  // Scope to user
  origin.searchParams.set('where', `user_id = $1`)
  origin.searchParams.set('params', JSON.stringify([user.id]))
  // ...
}
```

## Authorization Patterns

### Role-Based Access

```typescript
if (user.role === 'admin') {
  // Admins see all
  origin.searchParams.set('table', 'todos')
} else {
  // Users see their own
  origin.searchParams.set('table', 'todos')
  origin.searchParams.set('where', `user_id = $1`)
  origin.searchParams.set('params', JSON.stringify([user.id]))
}
```

### Team/Org Isolation

```typescript
origin.searchParams.set('table', 'todos')
origin.searchParams.set('where', `org_id = $1`)
origin.searchParams.set('params', JSON.stringify([user.orgId]))
```

### Resource-Level Access

```typescript
// Check access to specific resource
const canAccess = await checkAccess(user.id, projectId)
if (!canAccess) {
  return new Response('Forbidden', { status: 403 })
}

origin.searchParams.set('table', 'project_tasks')
origin.searchParams.set('where', `project_id = $1`)
origin.searchParams.set('params', JSON.stringify([projectId]))
```

## Anti-Patterns

```typescript
// ❌ WRONG: Secret in client
const stream = new ShapeStream({
  url: `https://electric.example.com/v1/shape?secret=${SECRET}`,
})

// ❌ WRONG: Client defines shape
const stream = new ShapeStream({
  url: `/api/shape`,
  params: { table: 'users', where: userInput }, // User controls shape!
})

// ❌ WRONG: No auth check
export async function GET(request: Request) {
  // Missing: validate user
  return fetch(ELECTRIC_URL + request.url.search)
}

// ❌ WRONG: Missing Vary header
return new Response(response.body, { headers }) // No Vary = cache leaks
```

## Related Skills

- `npx @electric-sql/playbook show electric-proxy` - Complete proxy implementation
- `npx @electric-sql/playbook show tanstack-start-quickstart` - TanStack Start setup
- `npx @electric-sql/playbook show electric-security-check` - Security audit checklist

## References

- [Auth Guide](https://electric-sql.com/docs/guides/auth)
- [Security Guide](https://electric-sql.com/docs/guides/security)
- [gatekeeper-auth example](https://github.com/electric-sql/electric/tree/main/examples/gatekeeper-auth)
- [proxy-auth example](https://github.com/electric-sql/electric/tree/main/examples/proxy-auth)
