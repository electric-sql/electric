---
name: electric-go-live
description: Production readiness checklist for Electric apps
triggers:
  - production
  - go live
  - deploy
  - launch
  - ship
metadata:
  sources:
    - website/docs/guides/security.md
    - website/docs/guides/auth.md
    - AGENTS.md
---

# Electric Go-Live Checklist

Complete this checklist before launching your Electric application.

## Security (Critical)

Run the full security audit first:

```bash
npx @electric-sql/agent read-skill electric-security-check
```

- [ ] Electric behind authenticated proxy
- [ ] SOURCE_SECRET only server-side
- [ ] Shapes defined server-side only
- [ ] User scoping in WHERE clauses
- [ ] Vary headers for cache isolation

## Infrastructure

### Electric Deployment

- [ ] Electric Cloud setup OR self-hosted Electric running
- [ ] DATABASE_URL configured with production Postgres
- [ ] Health checks configured
- [ ] Monitoring/alerting in place

### Postgres Requirements

- [ ] Postgres 14+ with logical replication enabled
- [ ] `wal_level = logical` in postgresql.conf
- [ ] Electric user has REPLICATION role
- [ ] Sufficient `max_replication_slots` (default 10)
- [ ] Sufficient `max_wal_senders` (at least 1 per Electric instance)

```sql
-- Verify settings
SHOW wal_level;  -- Should be 'logical'
SELECT * FROM pg_replication_slots;  -- Check slot usage
```

### CDN/Caching (Recommended)

- [ ] CDN in front of Electric (Cloudflare, Fastly, etc.)
- [ ] Request collapsing enabled for live mode
- [ ] Cache headers working (check `electric-offset` caching)
- [ ] Edge proxy for auth (if using gatekeeper pattern)

## Performance

### Shape Optimization

- [ ] Shapes use `columns` to limit data when possible
- [ ] `where` clauses use indexed columns
- [ ] Large tables have appropriate scoping

```typescript
// Efficient: Only sync user's data
origin.searchParams.set('where', `user_id = $1`) // Indexed column
origin.searchParams.set('columns', 'id,title,status') // Minimal columns
```

### Where Clause Performance

Electric optimizes these patterns (5000+ changes/sec regardless of shape count):

- `field = constant`
- `field = constant AND other_condition`

Non-optimized where clauses: throughput inversely proportional to shape count.

- [ ] High-volume shapes use optimized where patterns
- [ ] OR tested performance impact with expected shape count

### HTTP/2

- [ ] Production serving over HTTP/2
- [ ] Local development uses Caddy (included in starter)

HTTP/1.1 browsers limit to 6 connections, causing slow shapes.

## Client Configuration

### Error Handling

```typescript
shapeOptions: {
  url: '/api/todos',
  onError: async (error) => {
    if (error instanceof FetchError) {
      if (error.status === 401) {
        // Redirect to login
        return
      }
      if (error.status === 403) {
        // Show permission error
        return
      }
    }
    // Log to error tracking
    Sentry.captureException(error)
  }
}
```

- [ ] Auth errors (401/403) handled gracefully
- [ ] Error tracking integration (Sentry, etc.)
- [ ] Offline state handling

### Optimistic Mutations

- [ ] All write handlers return `{ txid }` for reconciliation
- [ ] Backend returns `pg_current_xact_id()` correctly
- [ ] Tested mutation → sync → reconciliation flow

```typescript
// Verify txid flow
onInsert: async ({ transaction }) => {
  const item = transaction.mutations[0].modified
  const { txid } = await api.create(item)
  console.log('txid received:', txid) // Should be integer
  return { txid }
}
```

## Monitoring

### Metrics to Track

- [ ] Shape sync latency (initial + live)
- [ ] Active shape count
- [ ] Database replication lag
- [ ] Proxy auth latency
- [ ] Error rates by type

### Electric Cloud Metrics

If using Electric Cloud, dashboard provides:

- Shape subscriptions
- Data throughput
- Replication status

### Self-Hosted Metrics

Electric exposes Prometheus metrics:

```
electric_shape_count
electric_replication_lag_seconds
electric_request_duration_seconds
```

## Rollback Plan

- [ ] Database backup before launch
- [ ] Previous app version tagged/accessible
- [ ] Kill switch for Electric sync (fallback to REST API)
- [ ] Tested rollback procedure

### Feature Flag Pattern

```typescript
const useElectric = process.env.FEATURE_ELECTRIC === 'true'

const todoCollection = useElectric
  ? createCollection(electricCollectionOptions({ ... }))
  : createCollection(queryCollectionOptions({ ... }))  // REST fallback
```

## Launch Day

### Pre-Launch

1. [ ] Run security checklist
2. [ ] Load test with expected traffic
3. [ ] Verify monitoring dashboards
4. [ ] Team on standby

### During Launch

1. [ ] Monitor error rates
2. [ ] Watch replication lag
3. [ ] Check CDN cache hit rates
4. [ ] Monitor database connections

### Post-Launch

1. [ ] Verify sync working across devices
2. [ ] Check optimistic mutation reconciliation
3. [ ] Review error logs
4. [ ] Confirm metrics collection

## Common Launch Issues

### "Shapes are slow"

- Check HTTP/2 enabled
- Verify CDN caching working
- Look for large initial syncs

### "Optimistic updates flicker"

- Verify txid returned as integer
- Check `pg_current_xact_id()` in backend
- Ensure collection `onInsert`/`onUpdate` return `{ txid }`

### "Auth errors after logout"

- Add `Vary: Authorization` (or Cookie) header
- Clear browser cache
- Check CDN cache invalidation

### "Replication lag increasing"

- Check Postgres WAL settings
- Verify disk I/O capacity
- Look for long-running transactions

## Resources

- [Deployment Guide](https://electric-sql.com/docs/guides/deployment)
- [Troubleshooting](https://electric-sql.com/docs/guides/troubleshooting)
- [Discord Support](https://discord.electric-sql.com)
