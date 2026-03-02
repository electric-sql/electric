---
name: electric-http-api
description: >
  Electric HTTP protocol — GET /v1/shape, offsets, handles, live mode, SSE,
  control messages, up-to-date, must-refetch, shape log, caching, CDN,
  request collapsing, POST subset snapshots, changes-only mode
type: sub-skill
library: '@electric-sql/client'
library_version: '1.5.8'
sources:
  - 'electric:website/docs/api/http.md'
  - 'electric:website/electric-api.yaml'
---

# Electric HTTP API

The HTTP API is the low-level interface for syncing shapes. In production, always
proxy through your backend. See `electric-proxy` for implementation patterns.

## Setup

The TypeScript client handles the protocol automatically:

```typescript
import { ShapeStream, Shape } from '@electric-sql/client'

const stream = new ShapeStream({ url: `/api/todos` })
const shape = new Shape(stream)
```

## Core Patterns

### Sync Flow

1. **Initial sync** — `GET /v1/shape?table=todos&offset=-1`
2. **Catch up** — continue with `offset` from response until `up-to-date`
3. **Live mode** — add `live=true&handle=<handle>` for real-time updates
4. **SSE mode** — add `live_sse=true` for persistent streaming connection

### Response Format

```json
[
  {
    "key": "1",
    "value": { "id": "1", "title": "Buy milk" },
    "headers": { "operation": "insert" }
  },
  { "headers": { "control": "up-to-date" } }
]
```

Operations: `insert`, `update`, `delete`
Control messages: `up-to-date`, `must-refetch`

### Response Headers

| Header            | Description                              |
| ----------------- | ---------------------------------------- |
| `electric-handle` | Shape identifier for subsequent requests |
| `electric-offset` | Next offset to request                   |
| `electric-schema` | JSON schema (first request only)         |

### SSE Mode

```bash
curl 'http://localhost:3000/v1/shape?table=todos&offset=0_0&handle=abc&live=true&live_sse=true'
```

SSE provides persistent streaming with lower latency. Keep-alive comments sent
every 21 seconds. Client auto-detects buffered SSE and falls back to long-polling.

### Caching and CDN

Electric responses include `cache-control` and `etag` headers enabling:

- CDN caching of shape log segments
- Browser cache for unchanged data
- Request collapsing (many clients share one upstream request)

### Subset Snapshots (POST)

For large WHERE clauses that exceed URL limits, use POST:

```typescript
const stream = new ShapeStream({
  url: `/api/items`,
  params: { table: 'items' },
  log: 'changes_only',
  subsetMethod: 'POST',
})

const { data } = await stream.requestSnapshot({
  where: 'id = ANY($1)',
  params: { '1': '{id1,id2,id3}' },
})
```

## Common Mistakes

### [HIGH] Not handling must-refetch control message

Wrong:

```typescript
stream.subscribe((messages) => {
  for (const msg of messages) {
    if ('value' in msg) {
      rows.set(msg.key, msg.value)
    }
  }
})
```

Correct:

```typescript
stream.subscribe((messages) => {
  for (const msg of messages) {
    if ('value' in msg) {
      rows.set(msg.key, msg.value)
    } else if (msg.headers?.control === 'must-refetch') {
      rows.clear()
      // stream will automatically restart
    }
  }
})
```

Shape rotation sends `must-refetch`. Ignoring it means the client has stale data
with no error signal.

Source: website/electric-api.yaml

### [HIGH] Using offset > -1 without providing handle

Wrong:

```typescript
const url = `/v1/shape?table=todos&offset=0_5`
```

Correct:

```typescript
const url = `/v1/shape?table=todos&offset=0_5&handle=abc123`
```

Requesting with a non-initial offset without a handle throws
`MissingShapeHandleError`. The handle identifies which shape log to continue from.

Source: packages/typescript-client/src/client.ts

### [MEDIUM] Using GET for large subset snapshots

Wrong:

```typescript
// URL exceeds 8KB with hundreds of IDs
const url = `/v1/shape?table=items&subset__where=id=ANY($1)&subset__params=...`
```

Correct:

```typescript
const stream = new ShapeStream({
  url: `/api/items`,
  log: 'changes_only',
  subsetMethod: 'POST',
})
```

Complex WHERE clauses with many values hit HTTP 414 (URI Too Long). Use POST
with JSON body. GET for subset snapshots is planned for deprecation
(see [troubleshooting docs](https://electric-sql.com/docs/guides/troubleshooting#414-request-uri-too-long)).

Source: typescript-client CHANGELOG.md v1.5.0

## Tension: CDN cacheability vs real-time freshness

Electric's HTTP caching enables CDN-scale distribution but can cause stale data
if caching is too aggressive. Electric manages this with short `max-age` and
`stale-while-revalidate`, but proxy/CDN config must preserve these headers.

Cross-reference: `deploying-electric`

## Tension: SSE efficiency vs proxy compatibility

SSE provides lower-latency streaming but requires proxies to disable buffering.
Most proxies buffer by default, causing SSE to silently degrade to long-polling.

Cross-reference: `electric-proxy-config`

## References

- [OpenAPI Specification](https://electric-sql.com/openapi.html)
- [HTTP API Docs](https://electric-sql.com/docs/api/http)
- Reference: `electric-http-api/references/subset-params.md`
