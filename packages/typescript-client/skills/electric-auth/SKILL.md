---
name: electric-auth
description: >
  Authentication and authorization — proxy auth pattern, gatekeeper tokens,
  shape-scoped access, session isolation, Vary header, dynamic headers,
  FetchError 401/403 handling, role-based access, team isolation, Clerk,
  Auth0, Supabase Auth integration
type: sub-skill
library: '@electric-sql/client'
library_version: '1.5.8'
sources:
  - 'electric:website/docs/guides/auth.md'
  - 'electric:website/docs/guides/security.md'
---

# Electric Auth

Electric is just HTTP — use standard web auth patterns.

## Setup

```typescript
import { ShapeStream, FetchError } from '@electric-sql/client'
```

## Core Patterns

### Proxy Auth (Recommended)

```
Client → Auth Proxy → Electric → Postgres
           ↓
    Validates user → Scopes shape → Injects secret
```

```typescript
// Client
const stream = new ShapeStream({
  url: '/api/todos',
  headers: { Authorization: `Bearer ${authToken}` },
})

// Server proxy
const user = await validateToken(request.headers.get('Authorization'))
if (!user) return new Response('Unauthorized', { status: 401 })

originUrl.searchParams.set('table', 'todos')
originUrl.searchParams.set('where', 'user_id = $1')
originUrl.searchParams.set('params', JSON.stringify([user.id]))
originUrl.searchParams.set('secret', process.env.ELECTRIC_SECRET!)

const headers = new Headers(response.headers)
headers.set('Vary', 'Authorization') // cache isolation
```

### Dynamic Header Refresh

```typescript
const stream = new ShapeStream({
  url: '/api/todos',
  headers: {
    Authorization: async () => `Bearer ${await getAccessToken()}`,
  },
})
```

### Error Handling for Auth

```typescript
const stream = new ShapeStream({
  url: '/api/todos',
  onError: async (error) => {
    if (error instanceof FetchError && error.status === 401) {
      const newToken = await refreshAuthToken()
      return { headers: { Authorization: `Bearer ${newToken}` } }
    }
    if (error instanceof FetchError && error.status === 403) {
      showAccessDenied()
      return // stop stream
    }
  },
})
```

### Authorization Patterns

**Role-based:**

```typescript
if (user.role === 'admin') {
  originUrl.searchParams.set('table', 'todos')
} else {
  originUrl.searchParams.set('table', 'todos')
  originUrl.searchParams.set('where', 'user_id = $1')
  originUrl.searchParams.set('params', JSON.stringify([user.id]))
}
```

**Team/org isolation:**

```typescript
originUrl.searchParams.set('where', 'org_id = $1')
originUrl.searchParams.set('params', JSON.stringify([user.orgId]))
```

### External Auth Providers

Works with any provider (Clerk, Auth0, Supabase):

```typescript
// Clerk example
import { auth } from '@clerk/nextjs'

export async function GET(request: Request) {
  const { userId } = auth()
  if (!userId) return new Response('Unauthorized', { status: 401 })

  originUrl.searchParams.set('where', 'user_id = $1')
  originUrl.searchParams.set('params', JSON.stringify([userId]))
}
```

## Common Mistakes

### [CRITICAL] Exposing ELECTRIC_SECRET to browser client

Wrong:

```typescript
const stream = new ShapeStream({
  url: `https://electric.example.com/v1/shape?secret=${SECRET}`,
})
```

Correct:

```typescript
// Client: no secret
const stream = new ShapeStream({ url: '/api/todos' })

// Server proxy: inject secret
originUrl.searchParams.set('secret', process.env.ELECTRIC_SECRET!)
```

ELECTRIC_SECRET is for server-to-Electric auth. It must be injected server-side
in the proxy, never included in client-side code or bundles.

Source: AGENTS.md Security Rules #1

### [CRITICAL] Calling Electric directly from client in production

Wrong:

```typescript
const stream = new ShapeStream({
  url: 'https://api.electric-sql.cloud/v1/shape?table=todos',
})
```

Correct:

```typescript
const stream = new ShapeStream({ url: '/api/todos' })
```

Electric is public by default. Without a proxy, any client can request any table.
Always route through your authenticated backend.

Source: AGENTS.md Security Rules #2-3

### [HIGH] Not setting Vary header on proxy response

Wrong:

```typescript
return new Response(response.body, { headers })
```

Correct:

```typescript
// Bearer token auth:
headers.set('Vary', 'Authorization')
// Cookie/session auth:
headers.set('Vary', 'Cookie')

// For CDN-fronted deployments, also consider:
headers.set('Cache-Control', 'private, no-store')
return new Response(response.body, { headers })
```

Without `Vary`, CDN or browser caches serve one user's shape response to another
user. Use `Vary: Authorization` for bearer tokens, `Vary: Cookie` for session
cookies. For authenticated shapes behind a CDN, add `Cache-Control: private,
no-store` to prevent the CDN from caching user-scoped data.

Source: website/docs/guides/auth.md

### [MEDIUM] Using deprecated api_secret parameter

Wrong:

```typescript
originUrl.searchParams.set('api_secret', process.env.ELECTRIC_SECRET!)
```

Correct:

```typescript
originUrl.searchParams.set('secret', process.env.ELECTRIC_SECRET!)
```

`api_secret` is deprecated in favor of `secret`. Removal planned for v2.

Source: website/electric-api.yaml

## Tension: Secure-by-default vs tutorial simplicity

The simplest tutorial skips auth. But starting without a proxy means every reader
builds insecure patterns they must retrofit later. All Electric skills use the
proxy pattern from step one.

Cross-reference: `electric-quickstart`, `electric-security-check`

## References

- [Auth Guide](https://electric-sql.com/docs/guides/auth)
- [Security Guide](https://electric-sql.com/docs/guides/security)
- [gatekeeper-auth example](https://github.com/electric-sql/electric/tree/main/examples/gatekeeper-auth)
- [proxy-auth example](https://github.com/electric-sql/electric/tree/main/examples/proxy-auth)
