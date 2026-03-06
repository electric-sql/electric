---
name: electric-debugging
description: >
  Troubleshoot Electric sync issues. Covers fast-loop detection from CDN/proxy
  cache key misconfiguration, stale cache diagnosis (StaleCacheError),
  MissingHeadersError from CORS misconfiguration, 409 shape expired handling,
  SSE proxy buffering (nginx proxy_buffering off, Caddy flush_interval -1),
  HTTP/1.1 6-connection limit in local dev (Caddy HTTP/2 proxy), WAL growth
  from replication slots (max_slot_wal_keep_size), Vercel CDN cache issues,
  and onError/backoff behavior. Load when shapes are not receiving updates,
  sync is slow, or errors appear in the console.
type: lifecycle
library: electric
library_version: '1.5.10'
requires:
  - electric-shapes
  - electric-proxy-auth
sources:
  - 'electric-sql/electric:packages/typescript-client/src/client.ts'
  - 'electric-sql/electric:packages/typescript-client/src/fetch.ts'
  - 'electric-sql/electric:packages/typescript-client/src/error.ts'
  - 'electric-sql/electric:website/docs/guides/troubleshooting.md'
---

This skill builds on electric-shapes and electric-proxy-auth. Read those first.

# Electric — Debugging Sync Issues

## Setup

Enable debug logging to see retry and state machine behavior:

```ts
import { ShapeStream, FetchError } from '@electric-sql/client'

const stream = new ShapeStream({
  url: '/api/todos',
  backoffOptions: {
    initialDelay: 1000,
    maxDelay: 32000,
    multiplier: 2,
    debug: true, // Logs retry attempts
  },
  onError: (error) => {
    if (error instanceof FetchError) {
      console.error(`Sync error: ${error.status} at ${error.url}`, error.json)
    }
    return {} // Always return {} to retry
  },
})
```

## Core Patterns

### Error retry behavior

| Error                 | Auto-retry?                | Action                                                        |
| --------------------- | -------------------------- | ------------------------------------------------------------- |
| 5xx server errors     | Yes (exponential backoff)  | Wait and retry                                                |
| 429 rate limit        | Yes (respects Retry-After) | Wait and retry                                                |
| Network errors        | Yes (exponential backoff)  | Wait and retry                                                |
| 4xx (non-429)         | No                         | Calls `onError` — return `{}` to retry manually               |
| 409 shape expired     | Yes (automatic reset)      | Client resets and refetches                                   |
| `MissingHeadersError` | Never                      | Fix CORS/proxy — not retryable even if `onError` returns `{}` |

### Diagnosing MissingHeadersError

This error means Electric response headers (`electric-offset`, `electric-handle`) are being stripped, usually by CORS:

```
MissingHeadersError: This is often due to a proxy not setting CORS correctly
so that all Electric headers can be read by the client.
```

Fix: expose Electric headers in proxy CORS configuration:

```ts
headers.set(
  'Access-Control-Expose-Headers',
  'electric-offset, electric-handle, electric-schema, electric-cursor'
)
```

### Diagnosing fast-loop detection

Console message: "Detected possible fast loop" with diagnostic info.

Cause: proxy/CDN cache key doesn't include `handle` and `offset` query params, so the client gets the same stale response repeatedly.

Fix: ensure your proxy/CDN includes all query parameters in its cache key.

For Vercel, add to `vercel.json`:

```json
{
  "headers": [
    {
      "source": "/api/(.*)",
      "headers": [
        { "key": "CDN-Cache-Control", "value": "no-store" },
        { "key": "Vercel-CDN-Cache-Control", "value": "no-store" }
      ]
    }
  ]
}
```

## Common Mistakes

### HIGH Proxy or CDN not including query params in cache key

Wrong:

```nginx
# nginx caching without query params in key
proxy_cache_key $scheme$host$uri;
```

Correct:

```nginx
# Include query params (handle, offset) in cache key
proxy_cache_key $scheme$host$request_uri;
```

Fast-loop detection fires after 5 requests in 500ms at the same offset. The client auto-clears caches once, then applies backoff, then throws after 5 consecutive detections.

Source: `packages/typescript-client/src/client.ts:929-1002`

### HIGH SSE responses buffered by proxy

Wrong:

```nginx
location /v1/shape {
  proxy_pass http://electric:3000;
  # Default: proxy_buffering on — SSE responses delayed
}
```

Correct:

```nginx
location /v1/shape {
  proxy_pass http://electric:3000;
  proxy_buffering off;
}
```

For Caddy:

```
reverse_proxy localhost:3000 {
  flush_interval -1
}
```

Nginx and Caddy buffer responses by default, causing long delays for SSE live updates. Disable buffering for Electric endpoints. Do NOT disable caching entirely — Electric uses cache headers for request collapsing.

Source: `website/docs/guides/troubleshooting.md:69-109`

### MEDIUM Running 6+ shapes in local dev without HTTP/2

Wrong:

```sh
# Running Electric directly on localhost:3000
# With 7+ shapes, browser HTTP/1.1 queues all requests (6 connection limit)
```

Correct:

```sh
# Run Caddy as HTTP/2 proxy on host (not in Docker — Docker prevents HTTP/2)
caddy run --config - --adapter caddyfile <<EOF
localhost:3001 {
  reverse_proxy localhost:3000
}
EOF
```

Browser HTTP/1.1 limits to 6 TCP connections per origin. With many shapes, requests queue behind each other. Use Caddy as a local HTTP/2 proxy.

Source: `website/docs/guides/troubleshooting.md:28-53`

### HIGH Leaving replication slot active when Electric is stopped

Wrong:

```sh
docker stop electric
# Replication slot retains WAL indefinitely — disk fills up
```

Correct:

```sh
docker stop electric

# Drop slot when stopping for extended periods
psql -c "SELECT pg_drop_replication_slot('electric_slot_default');"

# Or set a safety limit
psql -c "ALTER SYSTEM SET max_slot_wal_keep_size = '10GB';"
psql -c "SELECT pg_reload_conf();"
```

Replication slots retain WAL indefinitely when Electric is disconnected. Postgres disk fills up. Either drop the slot or set `max_slot_wal_keep_size`.

Source: `website/docs/guides/troubleshooting.md:203-316`

See also: electric-deployment/SKILL.md — Many sync issues stem from deployment configuration.
See also: electric-shapes/SKILL.md — onError semantics and backoff behavior.

## Version

Targets @electric-sql/client v1.5.10.
