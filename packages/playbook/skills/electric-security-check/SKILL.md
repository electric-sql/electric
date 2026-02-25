---
name: electric-security-check
description: Security audit checklist for Electric apps - verify before production
triggers:
  - security
  - auth
  - authorization
  - secure
  - audit
  - production ready
metadata:
  sources:
    - website/docs/guides/security.md
    - website/docs/guides/auth.md
    - AGENTS.md
---

# Electric Security Checklist

Run through this checklist before deploying any Electric application to production.

## Critical Rules (MUST)

### 1. Never Expose ELECTRIC_SECRET to Browser

```typescript
// ❌ CRITICAL VULNERABILITY
const stream = new ShapeStream({
  url: `${ELECTRIC_URL}?secret=${process.env.ELECTRIC_SECRET}`,
})

// ✅ CORRECT: Secret injected server-side
// Client code
const stream = new ShapeStream({ url: '/api/todos' })

// Server proxy
origin.searchParams.set('secret', process.env.ELECTRIC_SECRET!)
```

**Check**: Search codebase for `ELECTRIC_SECRET` or `secret` - should only appear in server code.

### 2. Electric HTTP API is Public by Default

Electric exposes **any data** its database user can access to **any client** that can connect.

```typescript
// ❌ DANGEROUS: Direct client access to Electric
const stream = new ShapeStream({
  url: 'https://electric.example.com/v1/shape',
  params: { table: 'users' }, // All users exposed!
})

// ✅ CORRECT: Proxy with auth
const stream = new ShapeStream({
  url: '/api/users', // Server validates auth, scopes shape
})
```

**Check**: No production client code should reference Electric URL directly.

### 3. Put Electric Behind Server/Proxy

Never expose Electric directly to the internet in production.

```
❌ Client → Electric (direct)
✅ Client → Proxy (auth) → Electric
```

**Check**: Electric should not be publicly accessible. Use firewall/network rules.

### 4. Define Shapes in Server/Proxy

Shape parameters (table, where, columns) must be set server-side.

```typescript
// ❌ DANGEROUS: Client-controlled shape
const table = userInput // Client can access any table!
const stream = new ShapeStream({
  url: `/api/shape?table=${table}`,
})

// ✅ CORRECT: Server defines shape
// Server code only
origin.searchParams.set('table', 'todos')
origin.searchParams.set('where', `user_id = $1`)
origin.searchParams.set('params', JSON.stringify([session.userId]))
```

**Check**: Client code should only pass Electric protocol params, never shape definition.

## Proxy Authentication Pattern

### Recommended: Proxy Auth

```typescript
import { ELECTRIC_PROTOCOL_QUERY_PARAMS } from '@electric-sql/client'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const origin = new URL(process.env.ELECTRIC_URL!)

  // 1. Authenticate user
  const user = await validateAuth(request.headers.get('Authorization'))
  if (!user) {
    return new Response('Unauthorized', { status: 401 })
  }

  // 2. Only pass Electric protocol params
  url.searchParams.forEach((v, k) => {
    if (ELECTRIC_PROTOCOL_QUERY_PARAMS.includes(k)) {
      origin.searchParams.set(k, v)
    }
  })

  // 3. Server defines shape with user scoping
  origin.searchParams.set('table', 'todos')
  origin.searchParams.set('where', `user_id = $1`)
  origin.searchParams.set('params', JSON.stringify([user.id]))
  origin.searchParams.set('source_id', process.env.ELECTRIC_SOURCE_ID!)
  origin.searchParams.set('secret', process.env.ELECTRIC_SECRET!)

  // 4. Proxy request
  const res = await fetch(origin)
  const headers = new Headers(res.headers)
  headers.delete('content-encoding')
  headers.delete('content-length')

  // 5. Add Vary header for cache isolation
  headers.set('Vary', 'Authorization')

  return new Response(res.body, {
    status: res.status,
    headers,
  })
}
```

### Alternative: Gatekeeper Auth

For edge deployment or CDN scenarios:

1. Client POSTs to gatekeeper endpoint with auth + shape definition
2. Gatekeeper validates, generates JWT with shape claim
3. Client uses JWT for shape requests via proxy
4. Proxy validates JWT claim matches requested shape

See [gatekeeper-auth example](https://github.com/electric-sql/electric/tree/main/examples/gatekeeper-auth).

## Database Permissions

### Principle of Least Privilege

Electric's database user should only access what's needed:

```sql
-- Create restricted user
CREATE USER electric_user WITH PASSWORD 'xxx' REPLICATION;

-- Grant only necessary permissions
GRANT CONNECT ON DATABASE mydb TO electric_user;
GRANT USAGE ON SCHEMA public TO electric_user;
GRANT SELECT ON todos, projects TO electric_user;  -- Only needed tables
```

### Row-Level Security (Multi-Tenant Apps Only)

RLS is useful for **multi-tenant apps at scale** as defense-in-depth. For single-tenant apps or small projects, the proxy auth pattern above is sufficient.

```sql
-- Only needed for multi-tenant apps with shared database
ALTER TABLE todos ENABLE ROW LEVEL SECURITY;

CREATE POLICY todos_user_isolation ON todos
  FOR SELECT
  USING (user_id = current_setting('app.user_id')::uuid);
```

Skip RLS if: single-tenant, small team, or data isn't sensitive.

## Audit Checklist

### Environment Variables

- [ ] `ELECTRIC_SECRET` only in server environment, never bundled
- [ ] `ELECTRIC_URL` is internal URL, not public
- [ ] Different secrets for dev/staging/production

### Network

- [ ] Electric not publicly accessible (firewall/VPC)
- [ ] HTTPS enforced for all client connections
- [ ] Proxy deployed at edge or in front of CDN

### Proxy Implementation

- [ ] All shape requests go through auth proxy
- [ ] Shape params (table/where/columns) set server-side only
- [ ] `ELECTRIC_PROTOCOL_QUERY_PARAMS` filter applied
- [ ] User scoping in WHERE clause
- [ ] Vary header set for auth method used

### Client Code

- [ ] No direct Electric URLs in client code
- [ ] No shape definitions in client code
- [ ] Auth tokens handled securely (HttpOnly cookies or secure storage)
- [ ] Error handling for 401/403 responses

### Database

- [ ] Electric user has minimal permissions
- [ ] Sensitive tables excluded from Electric access
- [ ] RLS enabled (multi-tenant apps only - skip for single-tenant/small projects)

## Session Invalidation

Ensure cached shapes don't leak after logout:

```typescript
// Add Vary header based on auth method
headers.set('Vary', 'Authorization') // For Bearer tokens
headers.set('Vary', 'Cookie') // For cookie auth
headers.set('Vary', 'Authorization, Cookie') // Both
```

## Common Vulnerabilities

### SQL Injection in WHERE Clause

```typescript
// ❌ VULNERABLE
origin.searchParams.set('where', `user_id = '${userId}'`)

// ✅ SAFE: Use parameterized queries
origin.searchParams.set('where', `user_id = $1`)
origin.searchParams.set('params', JSON.stringify([userId]))
```

### Insecure Shape Forwarding

```typescript
// ❌ VULNERABLE: Forwards client-provided table
const table = url.searchParams.get('table')
origin.searchParams.set('table', table!)

// ✅ SAFE: Server defines table
origin.searchParams.set('table', 'todos') // Hardcoded
```

## Related Skills

- `npx @electric-sql/playbook show electric-proxy` - Complete proxy implementation
- `npx @electric-sql/playbook show electric-auth` - Authentication patterns in depth
- `npx @electric-sql/playbook show electric-go-live` - Production deployment checklist

## Need Help?

- [Auth Guide](https://electric-sql.com/docs/guides/auth)
- [Security Guide](https://electric-sql.com/docs/guides/security)
- [Discord](https://discord.electric-sql.com)
