---
name: electric-http-api
description: Electric HTTP API reference - endpoints, shape log, caching
triggers:
  - http api
  - api
  - endpoints
  - shape log
  - offset
  - live mode
metadata:
  sources:
    - website/docs/api/http.md
---

# Electric HTTP API

The HTTP API is the low-level interface for syncing shapes from Electric.

## Endpoints

### GET /v1/shape

Sync a shape from Postgres.

```bash
# Initial sync
curl 'http://localhost:3000/v1/shape?table=todos&offset=-1'

# Live mode (long-polling)
curl 'http://localhost:3000/v1/shape?table=todos&live=true&offset=0_0&handle=abc123'
```

### Query Parameters

| Parameter | Required | Description                                                    |
| --------- | -------- | -------------------------------------------------------------- |
| `table`   | Yes      | Table name (e.g., `todos` or `schema.todos`)                   |
| `offset`  | Yes      | Position in shape log (`-1` for start, or value from response) |
| `handle`  | For live | Shape handle from initial response                             |
| `live`    | No       | Enable long-polling for real-time updates                      |
| `where`   | No       | SQL WHERE clause filter                                        |
| `columns` | No       | Comma-separated column list (must include PK)                  |
| `params`  | No       | JSON object for WHERE placeholders (`$1`, `$2`)                |

### Response Headers

| Header            | Description                                   |
| ----------------- | --------------------------------------------- |
| `electric-handle` | Shape identifier for subsequent requests      |
| `electric-offset` | Next offset to request                        |
| `electric-schema` | JSON schema of the shape (first request only) |
| `cache-control`   | Caching directives                            |
| `etag`            | Version identifier for caching                |

## Shape Log

Responses contain a log of database operations:

```json
[
  {
    "key": "todo-1",
    "value": { "id": "todo-1", "title": "Buy milk", "done": false },
    "headers": { "operation": "insert" }
  },
  {
    "key": "todo-2",
    "value": { "id": "todo-2", "title": "Walk dog", "done": true },
    "headers": { "operation": "insert" }
  },
  {
    "headers": { "control": "up-to-date" }
  }
]
```

### Operations

| Operation | Description                        |
| --------- | ---------------------------------- |
| `insert`  | New row added                      |
| `update`  | Row modified                       |
| `delete`  | Row removed (value may be partial) |

### Control Messages

| Control        | Description                     |
| -------------- | ------------------------------- |
| `up-to-date`   | Client has all current data     |
| `must-refetch` | Client must resync from scratch |

## Sync Flow

### 1. Initial Sync

```bash
curl 'http://localhost:3000/v1/shape?table=todos&offset=-1'
```

Response includes all current data + `up-to-date` control message.

If data is too large for one response:

- Response includes `electric-offset` header
- Continue requesting with that offset until `up-to-date`

### 2. Live Mode

After catching up, switch to live mode:

```bash
curl 'http://localhost:3000/v1/shape?table=todos&offset=0_123&handle=abc&live=true'
```

Server holds connection until:

- New data arrives → returns changes
- Timeout → returns just `up-to-date`

Client reconnects immediately to continue receiving updates.

### 3. Server-Sent Events (SSE)

Alternative to long-polling for live mode:

```bash
curl 'http://localhost:3000/v1/shape?table=todos&offset=0_123&handle=abc&live=true&live_sse=true'
```

SSE provides persistent connection with lower latency.

```
data: {"key":"1","value":{"id":"1"},"headers":{"operation":"insert"}}

data: {"headers":{"control":"up-to-date"}}

: keep-alive
```

**Note**: Requires proxy configured for streaming (no buffering).

## Caching

### Response Headers

```http
cache-control: max-age=5, stale-while-revalidate=5
etag: "abc123"
```

### CDN Integration

Electric works with CDNs for:

- **Initial sync acceleration**: Cache shape log segments
- **Browser caching**: Avoid re-fetching unchanged data
- **Request collapsing**: Many clients waiting for same live update share one request

### Nginx Example

```nginx
proxy_cache_path /var/cache/nginx levels=1:2 keys_zone=electric:10m;

location /v1/shape {
    proxy_pass http://electric:3000;
    proxy_cache electric;
    proxy_cache_key "$uri$is_args$args";
    proxy_cache_valid 200 1m;
    proxy_read_timeout 60s;
    proxy_buffering off;  # Required for SSE
}
```

## Advanced Features

### Starting from Now

Skip historical data:

```bash
curl 'http://localhost:3000/v1/shape?table=todos&offset=now'
```

Returns immediate `up-to-date` with latest offset for live mode.

### Changes-Only Mode

Skip initial snapshot, only receive future changes:

```bash
curl 'http://localhost:3000/v1/shape?table=todos&offset=-1&log=changes_only'
```

Useful when initial state is loaded separately.

### Subset Snapshots

Fetch specific portions in changes-only mode:

```bash
curl 'http://localhost:3000/v1/shape?table=todos&offset=123_4&handle=abc&subset__where=priority=high&subset__limit=10'
```

Returns data with snapshot metadata for change deduplication.

## Error Responses

| Status | Meaning                         |
| ------ | ------------------------------- |
| 200    | Success                         |
| 204    | No new data (live mode timeout) |
| 400    | Invalid parameters              |
| 401    | Authentication required         |
| 403    | Access denied                   |
| 404    | Shape not found                 |
| 409    | Shape changed, must refetch     |

## Implementation Example

```typescript
async function syncShape(table: string) {
  let offset = '-1'
  let handle: string | null = null
  const rows = new Map()

  while (true) {
    const url = new URL('/v1/shape', ELECTRIC_URL)
    url.searchParams.set('table', table)
    url.searchParams.set('offset', offset)
    if (handle) {
      url.searchParams.set('handle', handle)
      url.searchParams.set('live', 'true')
    }

    const response = await fetch(url)
    const messages = await response.json()

    // Update handle and offset
    handle = response.headers.get('electric-handle') || handle
    offset = response.headers.get('electric-offset') || offset

    // Process messages
    for (const msg of messages) {
      if ('value' in msg) {
        const { key, value, headers } = msg
        if (headers.operation === 'delete') {
          rows.delete(key)
        } else {
          rows.set(key, value)
        }
      } else if (msg.headers?.control === 'must-refetch') {
        // Reset and start over
        rows.clear()
        offset = '-1'
        handle = null
      }
    }

    // If not in live mode yet and up-to-date, switch to live
    if (!handle && messages.some((m) => m.headers?.control === 'up-to-date')) {
      handle = response.headers.get('electric-handle')!
    }
  }
}
```

## TypeScript Client

The `@electric-sql/client` package handles this protocol:

```typescript
import { ShapeStream, Shape } from '@electric-sql/client'

const stream = new ShapeStream({
  url: '/api/todos',
})

const shape = new Shape(stream)

// All protocol handling is automatic
await shape.rows // Wait for initial sync
shape.subscribe(({ rows }) => {
  // Receive live updates
})
```

## References

- [OpenAPI Specification](https://electric-sql.com/openapi.html)
- [TypeScript Client](https://electric-sql.com/docs/api/clients/typescript)
- [Shapes Guide](https://electric-sql.com/docs/guides/shapes)
