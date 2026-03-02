---
name: electric-cloud-reference
parent: deploying-electric
---

# Electric Cloud Reference

Managed Electric hosting — no infrastructure to manage.

## Quick Setup

```bash
npx @electric-sql/start my-app
pnpm claim && pnpm deploy
```

## Environment Variables

| Variable             | Description                                       |
| -------------------- | ------------------------------------------------- |
| `ELECTRIC_SOURCE_ID` | Source identifier (from Electric Cloud dashboard) |
| `ELECTRIC_SECRET`    | Source secret (server-side only, never in client) |

## Proxy Configuration

```typescript
// In your proxy route
if (process.env.ELECTRIC_SOURCE_ID && process.env.ELECTRIC_SECRET) {
  originUrl.searchParams.set('source_id', process.env.ELECTRIC_SOURCE_ID)
  originUrl.searchParams.set('secret', process.env.ELECTRIC_SECRET)
}
```

## Cloud API Endpoint

```
https://api.electric-sql.cloud/v1/shape
```

## Postgres Requirements

Same as self-hosted:

- PostgreSQL 14+ with `wal_level=logical`
- User with `REPLICATION` role
- Network access from Electric Cloud to your Postgres instance
