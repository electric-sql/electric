---
title: Troubleshooting - Guide
description: >-
  Tips and FAQs on how to run Electric successfully.
outline: [2, 3]
---

<img src="/img/icons/troubleshoot.svg" class="product-icon"
    style="width: 72px"
/>

# Troubleshooting

Tips and answers to FAQs about how to run Electric successfully.

## Local development

### Slow shapes / slow HMR / slow dev server &mdash; why is my local development slow?

Sometimes people encounter mysterious slow-downs with Electric in local development &mdash; slow shape loading, sluggish HMR (Hot Module Replacement), or an unresponsive development server. This commonly happens when your web app is subscribed to 6 or more shapes. The slow-down is caused by a limitation of the legacy version of HTTP, 1.1.

With HTTP/1.1, browsers only allow 6 simultaneous requests to a specific backend. This is because each HTTP/1.1 request uses its own expensive TCP connection. As shapes are loaded over HTTP, this means only 6 shapes can be getting updates with HTTP/1.1 due to this browser restriction. All other requests pause until there's an opening.

This also affects your development server (Vite, webpack, etc.) because the browser's TCP connection limit is shared across all requests to your dev server &mdash; including HMR updates, asset loading, and shape sync. If Electric shapes are holding connections open, your HMR may take minutes instead of milliseconds.

Luckily, HTTP/2, introduced in 2015, fixes this problem by _multiplexing_ each request to a server over the same TCP connection. This allows essentially unlimited connections. HTTP/2 is standard across the vast majority of hosts now. Unfortunately it's not yet standard in local dev environments.

##### Solution &mdash; run Caddy

To fix this, you can setup a local reverse-proxy using the popular [Caddy server](https://caddyserver.com). Caddy automatically sets up HTTP/2 and proxies requests to Electric, getting around the 6 requests limitation with HTTP/1.1 in the browser.

1. Install Caddy for your OS — https://caddyserver.com/docs/install
2. Run `caddy trust` so Caddy can install its certificate into your OS. This is necessary for http/2 to Just Work™ without SSL warnings/errors in your browser — https://caddyserver.com/docs/command-line#caddy-trust

Note — it's really important you run Caddy directly from your computer and not in e.g. a Docker container as otherwise, Caddy won't be able to use http/2 and will fallback to http/1 defeating the purpose of using it!

Once you have Caddy installed and have added its certs — you can run this command to start Caddy listening on port 3001 and proxying shape requests to Electric on port 3000. If you're loading shapes through your API or framework dev server, replace `3000` with the port that your API or dev server is listening on. The browser should talk directly to Caddy.

```sh
caddy run \
    --config - \
    --adapter caddyfile \
    <<EOF
localhost:3001 {
  reverse_proxy localhost:3000
  encode {
    gzip
  }
}
EOF
```

Now change your shape URLs in your frontend code to use port `3001` instead of port 3000 and everything will run much faster 🚀

### SSE connections &mdash; why is my client falling back to long polling?

When using Server-Sent Events (SSE) mode for live updates (`liveSse: true`), you might see a warning in the console:

```
[Electric] SSE connections are closing immediately (possibly due to proxy buffering or misconfiguration).
Falling back to long polling.
```

This happens when the Electric client detects that SSE connections are closing immediately after opening, which typically indicates proxy buffering or caching issues.

##### Solution &mdash; configure your proxy for SSE streaming

SSE requires proxies to support **streaming** responses without buffering the complete response. Here's how to configure common proxies:

**Caddy**

Add `flush_interval -1` to your reverse_proxy configuration:

```caddyfile
localhost:3001 {
  reverse_proxy localhost:3000 {
    # SSE: disable internal buffering so events are flushed immediately
    flush_interval -1
  }

  encode gzip

  # Helpful headers for streaming
  header {
    Cache-Control "no-cache, no-transform"
    X-Accel-Buffering "no"
  }
}
```

**Nginx**

Disable proxy buffering for SSE endpoints:

```nginx
location /v1/shape {
  proxy_pass http://localhost:3000;
  proxy_buffering off;  # Disable buffering for SSE streaming
  proxy_http_version 1.1;

  # Preserve Electric's cache headers for request collapsing
  proxy_cache_valid 200 1s;
}
```

**Important:** Do NOT disable caching entirely! Electric uses cache headers to enable request collapsing/fanout for efficiency. Your proxy should:
- Support streaming (not buffer complete responses)
- Respect Electric's cache headers for request collapsing
- Flush SSE events immediately as they arrive

##### How the client handles SSE issues

When SSE connections close immediately, the Electric client:
1. Retries with exponential backoff (0-200ms, 0-400ms, 0-800ms)
2. After 3 consecutive short connections, automatically falls back to long polling
3. Continues working normally in long polling mode (slightly less efficient)

To verify your SSE setup is working, check that:
- Console shows no fallback warnings
- Network tab shows a persistent SSE connection (not rapidly reconnecting)
- `shapeStream.isConnected()` returns `true` after initial sync

### Shape logs &mdash; how do I clear the server state?

Electric writes [shape logs](/docs/api/http#shape-log) to disk.

During development, you may want to clear this state. However, just restarting Electric doesn't clear the underlying storage, which can lead to unexpected behaviour.

##### Solution &mdash; clear shape logs

You can remove [`STORAGE_DIR`](/docs/api/config#storage-dir) to delete all shape logs. This will ensure that following shape requests will be re-synced from scratch.

###### Using docker

If you're running using Docker Compose, the simplest solution is to bring the Postgres and Electric services down, using the `--volumes` flag to also clear their mounted storage volumes:

```sh
docker compose down --volumes
```

You can then bring a fresh backend up from scratch:

```sh
docker compose up
```

### Unexpected 409 &mdash; why is my shape handle invalid?

If, when you request a shape, you get an unexpected `409` status despite the shape existing (for example, straight after you've created it), e.g.:

```
url: http://localhost:3000/v1/shape?table=projects&offset=-1
sec: 0.086570622 seconds
status: 200

url: http://localhost:3000/v1/shape?table=projects&offset=0_0&handle=17612588-1732280609822
sec: 1.153542301 seconds
status: 409
conflict reading Location

url: http://localhost:3000/v1/shape?table=projects&offset=0_0&handle=51930383-1732543076951
sec: 0.003023737 seconds
status: 200
```

This indicates that your client library or proxy layer is caching requests to Electric and responding to them without actually hitting Electric for the correct response. For example, when running unit tests your library may be maintaining an unexpected global HTTP cache.

##### Solution &mdash; clear your cache

The problem will resolve itself as client/proxy caches empty. You can force this by clearing your client or proxy cache. See [Control messages](/docs/api/http#control-messages) for more context on 409 messages.

## Production

### 503 &mdash; concurrent request limit exceeded

When too many clients are connected simultaneously, Electric responds with a `503` status and a JSON body:

```json
{
  "code": "concurrent_request_limit_exceeded",
  "message": "Concurrent existing request limit exceeded (limit: 10000), please retry"
}
```

This happens when the number of in-flight requests exceeds the configured limit. Each `live=true` long-poll request holds the connection open for up to 20 seconds (the long-poll timeout), so concurrent connections add up quickly.

Note that this is an **application-level limit**, not a system resource issue. Your server's CPU and memory may look healthy while requests are being rejected.

##### Solution &mdash; use a CDN and/or increase the limit

**Put a CDN in front of Electric** (recommended). Electric's caching headers are designed for CDN [request collapsing](/docs/api/http#collapsing-live-requests). When multiple clients poll the same shape at the same offset, the CDN collapses them into a single request to Electric and fans out the response. This dramatically reduces concurrent connections. See the [deployment guide](/docs/guides/deployment) for CDN setup.

**Increase the concurrent request limit** as a stopgap. Set [`ELECTRIC_MAX_CONCURRENT_REQUESTS`](/docs/api/config#electric-max-concurrent-requests) to raise the limits:

```shell
ELECTRIC_MAX_CONCURRENT_REQUESTS='{"initial": 500, "existing": 30000}'
```

Live long-poll connections are lightweight Erlang processes, so most hardware can handle higher limits.

**Reduce the number of concurrent shape subscriptions** by lazy-loading shapes only when needed (e.g. per screen) rather than subscribing to all shapes on app boot.

### WAL growth &mdash; why is my Postgres database storage filling up?

Electric creates a logical replication slot in Postgres to stream changes. This slot tracks a position in the Write-Ahead Log (WAL) and prevents Postgres from removing WAL segments that Electric hasn't yet processed. If the slot doesn't advance, WAL accumulates and consumes disk space.

#### Understanding replication slot status

Run this query to check your replication slot's health:

```sql
SELECT
    slot_name,
    active,
    wal_status,
    pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)) AS retained_wal,
    pg_size_pretty(safe_wal_size) AS safe_wal_remaining,
    restart_lsn,
    confirmed_flush_lsn
FROM pg_replication_slots
WHERE slot_name LIKE 'electric%';
```

**Key columns:**

| Column | Meaning |
|--------|---------|
| `active` | `true` if Electric is currently connected |
| `wal_status` | Current WAL retention state (see below) |
| `retained_wal` | Total WAL size held by this slot |
| `confirmed_flush_lsn` | Last position Electric confirmed processing |

**Understanding `wal_status` values:**

| Status | Meaning | Action |
|--------|---------|--------|
| `reserved` | Normal &mdash; WAL is within `max_wal_size` | None required |
| `extended` | Warning &mdash; exceeded `max_wal_size` but protected by slot limits | Monitor closely |
| `unreserved` | Danger &mdash; WAL may be removed at next checkpoint | Urgent: slot will be invalidated |
| `lost` | Critical &mdash; required WAL was removed, slot is invalid | Must recreate slot |

#### Common causes and solutions

##### Electric is disconnected

When Electric isn't running, its replication slot remains but becomes inactive. WAL accumulates indefinitely until Electric reconnects or the slot is removed.

**Solution:** If stopping Electric for an extended period, remove the replication slot:

```sql
SELECT pg_drop_replication_slot('electric_slot_default');
```

When Electric restarts, it will recreate the slot and rebuild shape logs from scratch.

##### Slot is active but not advancing

If `active = true` but `confirmed_flush_lsn` isn't advancing, verify Electric is processing changes:

1. **Check for errors in Electric logs** &mdash; storage issues or database connectivity problems can prevent processing

2. **Verify shaped tables are in the publication:**
   ```sql
   SELECT * FROM pg_publication_tables
   WHERE pubname LIKE 'electric_publication%';
   ```

3. **Test that changes flow through** &mdash; make a change to a shaped table and check if `confirmed_flush_lsn` advances:
   ```sql
   -- Note the current position
   SELECT confirmed_flush_lsn FROM pg_replication_slots
   WHERE slot_name = 'electric_slot_default';

   -- Make a change to a table with an active shape
   UPDATE your_shaped_table SET updated_at = now() WHERE id = 1;

   -- After a few seconds, check if position advanced
   SELECT confirmed_flush_lsn FROM pg_replication_slots
   WHERE slot_name = 'electric_slot_default';
   ```

4. **Check Electric's storage** &mdash; if [`ELECTRIC_STORAGE_DIR`](/docs/api/config#electric-storage-dir) has disk space or permission issues, Electric can't flush data and won't acknowledge progress

##### High write volume

If your database has heavy write activity, there will always be some lag between writes and Electric's acknowledgment. This is normal, but you should configure limits to prevent unbounded growth.

**Solution:** Set `max_slot_wal_keep_size` to cap WAL retention:

```sql
-- Limit each slot to 10GB of WAL (adjust based on your needs)
ALTER SYSTEM SET max_slot_wal_keep_size = '10GB';
SELECT pg_reload_conf();
```

> [!WARNING]
> If a slot exceeds this limit, Postgres will invalidate it at the next checkpoint. Electric will detect this, drop all shapes, and recreate the slot. This is generally preferable to filling your disk.

#### Recommended PostgreSQL settings

| Setting | Recommended Value | Purpose |
|---------|-------------------|---------|
| `max_slot_wal_keep_size` | `10GB` - `50GB` | Prevents any single slot from causing unbounded WAL growth. Default is `-1` (unlimited). |
| `wal_keep_size` | `2GB` (RDS default) | Minimum WAL retained regardless of slots |

For AWS RDS, these can be set in your parameter group. Note that `max_slot_wal_keep_size` requires PostgreSQL 13+.

#### Monitoring replication health

Electric exposes metrics for monitoring replication slot health. If you have [Prometheus configured](/docs/api/config#electric-prometheus-port), watch these metrics:

- `electric.postgres.replication.slot_retained_wal_size` &mdash; bytes of WAL retained by the slot
- `electric.postgres.replication.slot_confirmed_flush_lsn_lag` &mdash; bytes between Electric's confirmed position and current WAL

Set alerts when retained WAL exceeds your threshold or when lag grows continuously.

#### Quick diagnostic checklist

1. **Is the slot active?** &mdash; `active = true` means Electric is connected
2. **Is `confirmed_flush_lsn` advancing?** &mdash; should increase after changes to shaped tables
3. **What's the `wal_status`?** &mdash; `reserved` is healthy, `extended` needs attention
4. **Is `max_slot_wal_keep_size` set?** &mdash; prevents unbounded growth (default is unlimited)
5. **Any errors in Electric logs?** &mdash; storage or connectivity issues prevent processing

### Database permissions &mdash; how do I configure PostgreSQL users for Electric?

Electric requires specific PostgreSQL permissions to function correctly, including the `REPLICATION` role and appropriate table permissions.

##### Solution &mdash; see the PostgreSQL Permissions guide

See the [PostgreSQL Permissions guide](/docs/guides/postgres-permissions) for detailed instructions on:
- Quick start setup for development and production
- Different permission levels (superuser, dedicated user, least-privilege)
- How to handle `REPLICA IDENTITY FULL` requirements

##### Common permission errors

**Error: "insufficient privilege to create publication"**

**Cause:** The user doesn't have `CREATE` privilege on the database.

**Solution:** Either:
- Grant `CREATE` privilege: `GRANT CREATE ON DATABASE mydb TO electric_user;`
- Or use manual publication management (create the publication as a superuser and set `ELECTRIC_MANUAL_TABLE_PUBLISHING=true`)

**Error: "publication not owned by the provided user"**

**Cause:** The publication exists but is owned by a different user.

**Solution:** Change the publication owner:
```sql
ALTER PUBLICATION electric_publication_default OWNER TO electric_user;
```

**Error: "table does not have its replica identity set to FULL"**

**Cause:** The table hasn't been configured with `REPLICA IDENTITY FULL`.

**Solution:** Set replica identity manually:
```sql
ALTER TABLE schema.tablename REPLICA IDENTITY FULL;
```

**Error: "permission denied for table"**

**Cause:** The Electric user doesn't have `SELECT` permission on the table.

**Solution:** Grant appropriate permissions:
```sql
GRANT SELECT ON schema.tablename TO electric_user;
```

**Error: "must be owner of table"**

**Cause:** You attempted an operation that requires ownership (e.g., `ALTER TABLE ... REPLICA IDENTITY FULL` or adding the table to a publication).

**Solution:** Run as the table owner (or superuser), or transfer ownership:
```sql
ALTER TABLE schema.tablename OWNER TO electric_user;
```

### Vercel CDN caching &mdash; why are my shapes not updating on Vercel?

Vercel's CDN can cache responses when you proxy requests to an external Electric service using [rewrites](https://vercel.com/docs/edge-network/caching). Vercel's [cache keys are not configurable](https://vercel.com/docs/cdn-cache/purge#cache-keys) and may not differentiate between requests with different query parameters. Since Electric uses query parameters like `offset` and `handle` to track shape log position, this can result in stale or incorrect cached responses being served instead of reaching your Electric backend.

##### Solution &mdash; disable Vercel CDN caching for Electric routes

Add the following to your `vercel.json` to disable CDN caching for Electric API routes:

```json
{
  "headers": [
    {
      "source": "/api/electric/(.*)",
      "headers": [
        {
          "key": "CDN-Cache-Control",
          "value": "no-store"
        },
        {
          "key": "Vercel-CDN-Cache-Control",
          "value": "no-store"
        }
      ]
    }
  ]
}
```

Adjust the `source` pattern to match the route where your Electric proxy is mounted.

The [`Vercel-CDN-Cache-Control`](https://vercel.com/docs/headers/cache-control-headers#cdn-cache-control-header) header specifically controls Vercel's edge cache without affecting browser caching or other CDNs. The `CDN-Cache-Control` header is a [standard](https://httpwg.org/specs/rfc9213.html) that also controls other CDN caches upstream of Vercel. Together, these ensure that shape requests always reach your Electric backend.

## IPv6 support

If Electric or Postgres are running behind an IPv6 network, you might have to perform additional configurations on your network.

### Postgres running behind IPv6 network

In order for Electric to connect to Postgres over IPv6, you need to set [`ELECTRIC_DATABASE_USE_IPV6`](/docs/api/config#database-use-ipv6) to `true`.

#### Local development

If you're running Electric on your own computer, check if you have IPv6 support by opening [test-ipv6.com](https://test-ipv6.com). If you see "No IPv6 address detected" on that page, consider `ssh`ing into another machine or using a VPN service that works with IPv6 networks.

When running Electric in a Docker container, there's an additional hurdle in that Docker does not enable IPv6 out-of-the-box. Follow the [official guide](https://docs.docker.com/config/daemon/ipv6/#use-ipv6-for-the-default-bridge-network) to configure your Docker daemon for IPv6.

#### Cloud

If you're running Electric in a Cloud provider, you need to ensure that your VPC is configured with IPv6 support. Check your Cloud provider documentation to learn how to set it up.

### Electric running behind IPv6 network

By default Electric only binds to IPv4 addresses. You need to set [`ELECTRIC_LISTEN_ON_IPV6`](/docs/api/config#electric-use-ipv6) to `true` to bind to bind to IPv6 addresses as well.

### Missing headers &mdash; why is the client complaining about missing headers?

When Electric responds to shape requests it includes headers that are required by the client to follow the shape log.
It is common to run Electric behind a proxy to authenticate users and authorise shape requests.
However, the proxy might not keep the response headers in which case the client may complain about missing headers.

##### Solution &mdash; configure proxy to keep headers

Verify the proxy configuration and make sure it doesn't remove any of the `electric-...` headers.

### 414 Request-URI Too Long &mdash; why are my subset snapshot requests failing?

When using subset snapshots (via `requestSnapshot` or `fetchSnapshot`), you might encounter a `414 Request-URI Too Long` error:

```
Bandit.HTTPError: Request URI is too long
```

This happens when the subset parameters (especially `WHERE` clauses with many values) exceed the maximum URL length. This is common when:
- Using `WHERE id = ANY($1)` with hundreds of IDs (typical in join queries)
- TanStack&nbsp;DB generates large filter lists from JOIN operations
- Any query with many positional parameters

##### Solution &mdash; use POST requests for subset snapshots

Instead of sending subset parameters as URL query parameters (GET), send them in the request body (POST). The Electric server supports both methods.

**TypeScript Client**

Set `subsetMethod: 'POST'` on the stream to use POST for all subset requests:

```typescript
const stream = new ShapeStream({
  url: 'http://localhost:3000/v1/shape',
  params: { table: 'items' },
  log: 'changes_only',
  subsetMethod: 'POST', // Use POST for all subset requests
})

// All subset requests will now use POST
const { metadata, data } = await stream.requestSnapshot({
  where: "id = ANY($1)",
  params: { '1': '{id1,id2,id3,...hundreds more...}' },
})
```

Or override per-request:

```typescript
const { metadata, data } = await stream.requestSnapshot({
  where: "id = ANY($1)",
  params: { '1': '{id1,id2,id3,...}' },
  method: 'POST', // Use POST for this request only
})
```

**Direct HTTP**

Use POST with subset parameters in the JSON body:

```sh
curl -X POST 'http://localhost:3000/v1/shape?table=items&offset=123_4&handle=abc-123' \
  -H 'Content-Type: application/json' \
  -d '{
    "where": "id = ANY($1)",
    "params": {"1": "{id1,id2,id3,...}"},
    "order_by": "created_at",
    "limit": 100
  }'
```

See the [HTTP API documentation](/docs/api/http#subset-snapshots) for more details.

:::info Future change
In Electric 2.0, GET requests for subset snapshots will be deprecated. Only POST will be supported. We recommend migrating to POST now to avoid future breaking changes.
:::
