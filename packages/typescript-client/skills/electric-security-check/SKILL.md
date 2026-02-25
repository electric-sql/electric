---
name: electric-security-check
description: >
  Security audit checklist before production — verify proxy, ELECTRIC_SECRET,
  shape scoping, Vary headers, session isolation, no client-controlled shapes,
  ELECTRIC_INSECURE removal
type: security
library: '@electric-sql/client'
library_version: '1.5.8'
sources:
  - 'electric:AGENTS.md'
  - 'electric:website/docs/guides/security.md'
---

# Electric Security Audit

Run through this checklist before production deployment.

## Security Checklist

### Proxy & Access Control

- [ ] **Electric behind proxy** — client never talks to Electric directly
- [ ] **Every route authenticates** — no proxy routes without auth checks
- [ ] **Server defines shapes** — `table` and `where` set server-side, not from client params
- [ ] **User scoping on all routes** — `where user_id = $1` or equivalent
- [ ] **One route per table** — no generic `/api/shape?table=X` endpoint

### Secrets

- [ ] **`ELECTRIC_SECRET` set** — not `ELECTRIC_INSECURE=true`
- [ ] **No secrets in client bundle** — `ELECTRIC_SECRET`, `SOURCE_SECRET` server-only
- [ ] **Env vars not in client code** — check for `process.env.ELECTRIC_SECRET` in browser code

### Headers & Caching

- [ ] **`Vary` header set** — `Authorization` or `Cookie` on every proxy response
- [ ] **Electric headers forwarded** — `electric-handle`, `electric-offset`, `electric-schema`
- [ ] **Encoding headers removed** — `content-encoding` and `content-length` deleted

### Session Isolation

- [ ] **Cache per user** — `Vary` header prevents serving cached shape to wrong user
- [ ] **Auth token refresh** — dynamic headers handle token expiry
- [ ] **403 handling** — graceful UI when user lacks access

## Quick Audit Script

```bash
# Check for secrets in client code
grep -r "ELECTRIC_SECRET\|SOURCE_SECRET" src/ --include="*.ts" --include="*.tsx" | \
  grep -v "process.env\|server\|api\|route"

# Check for direct Electric URLs in client
grep -r "localhost:3000/v1/shape\|electric-sql.cloud/v1/shape" src/ \
  --include="*.ts" --include="*.tsx"

# Check proxy routes have auth
grep -rn "prepareElectricUrl\|proxyElectricRequest" src/ --include="*.ts" -A5 | \
  grep -c "session\|auth\|user"
```

## Common Mistakes

### [CRITICAL] Dev patterns in production

Wrong:

```yaml
# docker-compose.prod.yml
environment:
  ELECTRIC_INSECURE: true # "same as dev, it works!"
```

Correct:

```yaml
environment:
  ELECTRIC_SECRET: ${ELECTRIC_SECRET} # from secure env
```

`ELECTRIC_INSECURE=true` disables all auth. `ELECTRIC_SECRET` is required since
v1.0. Direct client connections bypass all access control.

Source: AGENTS.md Security Rules

### [CRITICAL] Generic shape endpoint

Wrong:

```typescript
app.get('/api/shape', (req) => {
  const { table } = req.query
  originUrl.searchParams.set('table', table as string)
})
```

Correct:

```typescript
// /api/todos.ts
originUrl.searchParams.set('table', 'todos')
originUrl.searchParams.set('where', 'user_id = $1')
originUrl.searchParams.set('params', JSON.stringify([session.user.id]))
```

Client-controlled `table` param lets any user query any table in the database.

Source: AGENTS.md Security Rules #4

### [HIGH] Missing Vary header allows cache data leakage

Wrong:

```typescript
return new Response(response.body, { headers })
```

Correct:

```typescript
headers.set('Vary', 'Authorization')
return new Response(response.body, { headers })
```

Without Vary, CDN or browser caches may serve one user's shape data to another.

Source: website/docs/guides/auth.md

## Tension: Secure-by-default vs tutorial simplicity

Every Electric skill uses proxy-first patterns. This checklist validates that no
shortcuts from development leaked into production.

Cross-reference: `electric-quickstart`, `electric-auth`

## References

- [Security Guide](https://electric-sql.com/docs/guides/security)
- [Auth Guide](https://electric-sql.com/docs/guides/auth)
