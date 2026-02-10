# HTTP API Reference

This document covers the sync-service HTTP API layer.

## Endpoints

### GET /v1/shape

Fetch shape data (snapshot and/or changes).

**Query Parameters**:

| Parameter  | Type    | Required           | Description                                             |
| ---------- | ------- | ------------------ | ------------------------------------------------------- |
| `table`    | string  | Yes (if no handle) | Table name (e.g., `users` or `public.users`)            |
| `handle`   | string  | Yes (if no table)  | Existing shape handle                                   |
| `offset`   | string  | No                 | Position to read from (`-1` for initial, or log offset) |
| `live`     | boolean | No                 | Enable long-polling for updates                         |
| `live_sse` | boolean | No                 | Enable Server-Sent Events streaming                     |
| `where`    | string  | No                 | SQL WHERE clause filter                                 |
| `columns`  | string  | No                 | Comma-separated column list                             |
| `replica`  | string  | No                 | Replication mode (`default` or `full`)                  |

**Response Headers**:

| Header                | Description                                                |
| --------------------- | ---------------------------------------------------------- |
| `electric-handle`     | Shape identifier for subsequent requests                   |
| `electric-offset`     | Last offset included in response                           |
| `electric-schema`     | JSON schema of table (initial requests only)               |
| `electric-up-to-date` | Present when client is caught up                           |
| `electric-cursor`     | Live polling timestamp                                     |
| `etag`                | Cache validation (`handle:request_offset:response_offset`) |

**Response Codes**:

| Code | Meaning                                   |
| ---- | ----------------------------------------- |
| 200  | Success                                   |
| 204  | No changes (long-poll timeout)            |
| 400  | Invalid request parameters                |
| 401  | Authentication failed                     |
| 409  | Shape rotated (redirect to new handle)    |
| 503  | Service unavailable (DB down, overloaded) |

### DELETE /v1/shape

Delete a shape (if enabled).

**Query Parameters**:

| Parameter | Type   | Required | Description            |
| --------- | ------ | -------- | ---------------------- |
| `handle`  | string | Yes      | Shape handle to delete |

### GET /v1/health

Service health check.

**Response**: JSON with service status.

### GET /

Basic health check (returns 200).

## Request Flow

### Initial Sync (offset=-1)

```
Client                          Server
  │                               │
  │  GET /v1/shape?table=users    │
  │  &offset=-1                   │
  │──────────────────────────────▶│
  │                               │
  │                               │ Create/retrieve shape
  │                               │ Run snapshot query
  │                               │
  │  200 OK                       │
  │  electric-handle: abc123      │
  │  electric-offset: 0_1000      │
  │  electric-schema: {...}       │
  │  [snapshot data...]           │
  │  {control: "up-to-date"}      │
  │◀──────────────────────────────│
```

### Catch-up (with offset)

```
Client                          Server
  │                               │
  │  GET /v1/shape?handle=abc123  │
  │  &offset=100_5                │
  │──────────────────────────────▶│
  │                               │
  │                               │ Read log since offset
  │                               │
  │  200 OK                       │
  │  electric-offset: 200_3       │
  │  [changes since 100_5...]     │
  │◀──────────────────────────────│
```

### Long-Polling (live=true)

```
Client                          Server
  │                               │
  │  GET /v1/shape?handle=abc123  │
  │  &offset=200_3&live=true      │
  │──────────────────────────────▶│
  │                               │
  │                               │ Subscribe to changes
  │                               │ Wait up to 20s
  │                               │
  │  ... time passes ...          │
  │                               │ New change arrives
  │                               │
  │  200 OK                       │
  │  electric-offset: 300_1       │
  │  [new changes...]             │
  │◀──────────────────────────────│
```

### Server-Sent Events (live_sse=true)

```
Client                          Server
  │                               │
  │  GET /v1/shape?handle=abc123  │
  │  &offset=200_3&live=true      │
  │  &live_sse=true               │
  │──────────────────────────────▶│
  │                               │
  │  200 OK                       │
  │  Content-Type: text/event-stream
  │◀─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─│
  │                               │
  │  data: [change1]              │
  │◀──────────────────────────────│
  │                               │
  │  : keep-alive                 │
  │◀──────────────────────────────│
  │                               │
  │  data: [change2]              │
  │◀──────────────────────────────│
  │         ...                   │
```

## Response Format

### Data Operations

```json
{
  "offset": "100_1",
  "key": "\"public\".\"users\"/\"123\"",
  "headers": {
    "operation": "insert",
    "txid": "100"
  },
  "value": {
    "id": 123,
    "name": "Alice",
    "email": "alice@example.com"
  }
}
```

**Operations**:

- `insert` - New row
- `update` - Modified row
- `delete` - Removed row (value contains only PK)

### Control Messages

```json
// End of snapshot
{"headers": {"control": "snapshot-end"}}

// Client is up-to-date
{"headers": {"control": "up-to-date", "global_last_seen_lsn": "0/1234567"}}

// Shape rotated (409 response)
{"headers": {"control": "must-refetch"}}
```

## Authentication

Simple secret-based authentication via query parameter:

```
GET /v1/shape?table=users&secret=your-secret-here
```

- Configured via `ELECTRIC_SECRET` environment variable
- If not set, runs in insecure mode (no auth)
- Returns 401 if secret doesn't match

## Caching Strategy

| Request Type        | Cache-Control                                  |
| ------------------- | ---------------------------------------------- |
| Initial (offset=-1) | `max-age=604800, stale-while-revalidate=86400` |
| Live requests       | `max-age=5`                                    |
| SSE streams         | `max-age={sse_timeout}`                        |
| Errors              | `no-store`                                     |
| 409 redirects       | `max-age=60`                                   |

**ETag Format**: `{handle}:{request_offset}:{response_offset}`

## Admission Control

Prevents overload with concurrent request limits:

- Separate limits for initial (offset=-1) vs existing requests
- Returns 503 with `Retry-After` header when overloaded
- Configurable via `ELECTRIC_ADMISSION_CONTROL_*` env vars

## Error Responses

### 400 Bad Request

```json
{
  "message": "Invalid table parameter",
  "errors": {
    "table": ["is required"]
  }
}
```

### 409 Conflict (Shape Rotated)

```json
{
  "message": "Shape has been rotated",
  "new_handle": "new-handle-123"
}
```

Response includes:

- `electric-handle` header with new handle
- Cacheable for 60s to coalesce concurrent requests

### 503 Service Unavailable

```json
{
  "message": "Database unavailable"
}
```

Response includes:

- `Retry-After` header (5-10s with jitter)

## Key Implementation Files

| File                                    | Purpose                                |
| --------------------------------------- | -------------------------------------- |
| `lib/electric/plug/router.ex`           | Endpoint definitions, middleware       |
| `lib/electric/plug/serve_shape_plug.ex` | Shape request handling                 |
| `lib/electric/shapes/api.ex`            | Business logic (validation, streaming) |
| `lib/electric/shapes/api/params.ex`     | Parameter validation                   |
| `lib/electric/shapes/api/response.ex`   | Response formatting                    |
| `lib/electric/shapes/api/encoder.ex`    | JSON/SSE encoding                      |
| `lib/electric/admission_control.ex`     | Rate limiting                          |
