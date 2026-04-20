---
title: Building a client
description: >-
  Use the conformance tests to one-shot a Durable Streams client in any language.
outline: [2, 3]
---

# Building a client

The Durable Streams protocol is pure HTTP -- any language that can make HTTP requests can implement a client. This guide covers the implementation considerations beyond what the protocol specifies, and how to validate your client against the [conformance test suite](#conformance-tests).

The [Protocol specification](https://github.com/durable-streams/durable-streams/blob/main/PROTOCOL.md) is the authoritative reference for HTTP operations, headers, response codes, and content modes. The [`@durable-streams/client-conformance-tests`](https://github.com/durable-streams/durable-streams/tree/main/packages/client-conformance-tests) package validates your implementation against it -- start your server, wire up an adapter, and the suite tells you what's passing and what's not.

## What to implement

A complete client covers six HTTP operations (create, append, read, head, close, delete), two live modes (long-poll and SSE), JSON mode, idempotent producers, and retry logic. Not all of these are required -- a useful client can start with just append and catch-up reads.

A typical client library exposes:

- **Stream creation** -- `PUT` with content type and optional TTL/expiry
- **Append** -- `POST` with body data, tracking `Stream-Next-Offset` from responses
- **Read** -- `GET` with offset tracking, supporting catch-up, long-poll, and SSE modes
- **Metadata** -- `HEAD` for stream info without transferring data
- **Close** -- `POST` with `Stream-Closed: true` header
- **Delete** -- `DELETE` to remove a stream
- **Idempotent producer** -- a higher-level abstraction that manages `Producer-Id`, `Producer-Epoch`, and `Producer-Seq` headers, with auto-claim and sequence tracking

### Read-only API

Many use cases only consume streams -- they never create, append, or delete. Where your language supports it, consider offering a separate read-only entry point with a smaller dependency footprint. The [TypeScript client](https://github.com/durable-streams/durable-streams/tree/main/packages/client) does this with a `stream()` function (a fetch-like API for consuming streams) alongside the full `DurableStream` class. This keeps bundle sizes small for browser consumers that only need to read.

## Implementation notes

These are things the protocol specification defines but that are easy to get wrong, or where client libraries need to make design decisions.

### Offsets are opaque

Offsets are strings. Never parse them, never construct them, never assume a format. The only operations you can rely on are:

- **Lexicographic comparison** -- for ordering
- **Equality** -- for deduplication

Always store and forward the `Stream-Next-Offset` header value exactly as received.

### Error classification

The protocol defines which HTTP status codes are retryable. Your client should classify errors so callers don't need to interpret status codes:

| Retryable                   | Non-retryable           |
| --------------------------- | ----------------------- |
| `500 Internal Server Error` | `400 Bad Request`       |
| `503 Service Unavailable`   | `404 Not Found`         |
| `429 Too Many Requests`     | `409 Conflict`          |
|                             | `403 Forbidden`         |
|                             | `413 Payload Too Large` |

For `429`, respect the `Retry-After` header. For all retryable errors, use exponential backoff with jitter.

### Idempotent producer abstraction

The protocol defines the `Producer-Id` / `Producer-Epoch` / `Producer-Seq` headers, but clients typically wrap these in an `IdempotentProducer` abstraction that:

- Tracks the current sequence number automatically
- Increments the epoch on restart
- Implements auto-claim: start at `(epoch=0, seq=0)`, and if the server returns `403` with a `Producer-Epoch` header, retry with `(epoch=serverEpoch+1, seq=0)`
- Handles `409 Conflict` for sequence gaps (retry with the expected sequence)
- Reports duplicate detection (`204` responses) separately from successful appends

### SSE reconnection

For SSE mode, the server eventually closes the connection (controlled by its `sse_reconnect_interval`). Your client should:

1. Track the last `streamNextOffset` from control events
2. Reconnect with that offset when the connection drops
3. Stop reconnecting when `streamClosed: true` appears in a control event

### Cursor forwarding

In long-poll mode, the server may return a `Stream-Cursor` header. Echo it back as `cursor=<value>` on the next request. This enables CDN request collapsing -- multiple clients waiting at the same offset share a single upstream connection.

## Conformance tests

The conformance test suite validates that your client correctly implements the protocol. It covers producer operations, consumer reads (catch-up, long-poll, SSE), idempotent producers, stream lifecycle, error handling, and more.

Once you have the conformance tests wired up, LLM coding agents are remarkably effective at implementing clients. The test suite provides a tight feedback loop -- the agent can run tests, see failures, and iterate. Several of the existing client implementations were built this way.

### Install

```bash
npm install @durable-streams/client-conformance-tests
```

### Architecture

The test runner is a Node.js process that starts a reference server, spawns your client adapter as a subprocess, and communicates via JSON lines over stdin/stdout:

<ClientAdapterDiagram />

### Writing an adapter

Create an executable that reads JSON commands from stdin and writes JSON results to stdout, one per line. The adapter bridges the test runner and your client library.

**Lifecycle:**

1. The test runner starts your adapter as a subprocess
2. The first command is always `init`, providing the `serverUrl`
3. Subsequent commands exercise your client's operations
4. The final command is `shutdown`

**Core commands:**

| Command    | Description                                                             |
| ---------- | ----------------------------------------------------------------------- |
| `init`     | Receive server URL, report client name, version, and supported features |
| `create`   | Create a stream (`PUT`)                                                 |
| `append`   | Append data to a stream (`POST`)                                        |
| `read`     | Read from a stream -- catch-up, long-poll, or SSE (`GET`)               |
| `head`     | Get stream metadata (`HEAD`)                                            |
| `close`    | Close a stream                                                          |
| `delete`   | Delete a stream (`DELETE`)                                              |
| `shutdown` | Clean up and exit                                                       |

**Idempotent producer commands** (if your client supports them):

| Command                   | Description                                                      |
| ------------------------- | ---------------------------------------------------------------- |
| `connect`                 | Connect to an existing stream (for producer setup)               |
| `idempotent-append`       | Append via `IdempotentProducer` with automatic sequence tracking |
| `idempotent-append-batch` | Batch append via `IdempotentProducer`                            |
| `idempotent-close`        | Close a stream via `IdempotentProducer` (with producer headers)  |
| `idempotent-detach`       | Detach producer without closing stream                           |

**Optional commands** (feature-gated):

| Command              | Description                                                  |
| -------------------- | ------------------------------------------------------------ |
| `set-dynamic-header` | Configure per-request header evaluation (e.g., OAuth tokens) |
| `set-dynamic-param`  | Configure per-request URL parameter evaluation               |
| `clear-dynamic`      | Clear dynamic headers/params                                 |
| `validate`           | Test client-side input validation                            |

### Feature reporting

The `init` response tells the runner which features your client supports. Tests requiring unsupported features are skipped:

```json
{
  "type": "init",
  "success": true,
  "clientName": "my-client",
  "clientVersion": "1.0.0",
  "features": {
    "batching": true,
    "sse": true,
    "longPoll": true,
    "auto": false,
    "streaming": false,
    "dynamicHeaders": false
  }
}
```

| Feature          | Description                                                     |
| ---------------- | --------------------------------------------------------------- |
| `batching`       | Client supports automatic batching of appends                   |
| `sse`            | Client supports SSE live mode                                   |
| `longPoll`       | Client supports long-poll live mode                             |
| `auto`           | Client supports auto mode (catch-up then auto-select live mode) |
| `streaming`      | Client supports streaming reads                                 |
| `dynamicHeaders` | Client supports per-request header/param functions              |

### Command and result examples

**Append:**

```json
{ "type": "append", "path": "/my-stream", "data": "Hello, World!" }
```

```json
{ "type": "append", "success": true, "status": 200, "offset": "13" }
```

**Read:**

```json
{
  "type": "read",
  "path": "/my-stream",
  "offset": "0",
  "live": "long-poll",
  "timeoutMs": 5000
}
```

```json
{
  "type": "read",
  "success": true,
  "status": 200,
  "chunks": [{ "data": "Hello, World!", "offset": "13" }],
  "offset": "13",
  "upToDate": true
}
```

**Error:**

```json
{
  "type": "error",
  "success": false,
  "commandType": "append",
  "status": 404,
  "errorCode": "NOT_FOUND",
  "message": "Stream not found"
}
```

### Error codes

Map your client's errors to these standard codes in error results:

| Code                | Meaning                               |
| ------------------- | ------------------------------------- |
| `NETWORK_ERROR`     | Network connection failed             |
| `TIMEOUT`           | Operation timed out                   |
| `CONFLICT`          | Stream already exists (409)           |
| `NOT_FOUND`         | Stream not found (404)                |
| `SEQUENCE_CONFLICT` | Sequence number conflict (409)        |
| `STREAM_CLOSED`     | Stream is closed (409)                |
| `INVALID_OFFSET`    | Invalid offset format (400)           |
| `INVALID_ARGUMENT`  | Invalid argument passed to client API |
| `UNEXPECTED_STATUS` | Unexpected HTTP status                |
| `PARSE_ERROR`       | Failed to parse response              |
| `INTERNAL_ERROR`    | Client internal error                 |
| `NOT_SUPPORTED`     | Operation not supported               |

### Running tests

```bash
# Run all tests
npx @durable-streams/client-conformance-tests --run ./your-adapter

# Run a specific test suite
npx @durable-streams/client-conformance-tests --run ./your-adapter --suite producer

# Filter by tag
npx @durable-streams/client-conformance-tests --run ./your-adapter --tag core

# Verbose output
npx @durable-streams/client-conformance-tests --run ./your-adapter --verbose

# Stop on first failure
npx @durable-streams/client-conformance-tests --run ./your-adapter --fail-fast

# Custom timeout (default 30s)
npx @durable-streams/client-conformance-tests --run ./your-adapter --timeout 60000
```

### Adapter wrapper script

By convention, adapters use a `run-conformance-adapter.sh` wrapper script that handles environment setup:

```bash
#!/bin/bash
cd "$(dirname "$0")"
exec python3 conformance_adapter.py
```

This is the path you pass to `--run`.

### Binary data

Binary data in the adapter protocol is transmitted as base64. The `binary: true` flag on commands and results indicates base64 encoding.

### Test coverage

The tests cover five categories:

- **Producer** -- stream creation, append operations, sequence ordering, batching, error handling
- **Consumer** -- catch-up reads, long-poll, SSE, offset handling, message ordering, retry/resilience, fault injection, cache headers
- **Lifecycle** -- full create/append/read/delete flows, HEAD requests, stream closure, custom headers, dynamic headers
- **Idempotent Producer** -- epoch management, auto-claim, batching, concurrent requests, multi-producer, sequence validation, error handling
- **Validation** -- client-side input validation (retry options, producer parameters)

### Protocol types for TypeScript

TypeScript adapters can import the protocol types directly:

```typescript
import {
  type TestCommand,
  type TestResult,
  parseCommand,
  serializeResult,
  ErrorCodes,
} from "@durable-streams/client-conformance-tests/protocol"
```

## Reference implementations

Use these as examples when building your own client:

- [TypeScript](https://github.com/durable-streams/durable-streams/tree/main/packages/client) -- reference client with full feature support
- [Python](https://github.com/durable-streams/durable-streams/tree/main/packages/client-py)
- [Go](https://github.com/durable-streams/durable-streams/tree/main/packages/client-go)
- [Elixir](https://github.com/durable-streams/durable-streams/tree/main/packages/client-elixir)
- [.NET](https://github.com/durable-streams/durable-streams/tree/main/packages/client-dotnet)
- [Swift](https://github.com/durable-streams/durable-streams/tree/main/packages/client-swift)
- [PHP](https://github.com/durable-streams/durable-streams/tree/main/packages/client-php)
- [Java](https://github.com/durable-streams/durable-streams/tree/main/packages/client-java)
- [Rust](https://github.com/durable-streams/durable-streams/tree/main/packages/client-rust)
- [Ruby](https://github.com/durable-streams/durable-streams/tree/main/packages/client-rb)

All pass the conformance test suite. See [Client libraries](./clients/other) for details.

---

See also: [Protocol specification](https://github.com/durable-streams/durable-streams/blob/main/PROTOCOL.md) | [Core concepts](concepts) | [Building a server](building-a-server)
