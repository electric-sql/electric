---
title: Building a server
description: >-
  Use the conformance tests to one-shot a Durable Streams server. Covers protocol requirements, storage layer design and reference implementations.
outline: [2, 3]
---

# Building a server

The Durable Streams protocol is designed to support server implementations in any language or platform. A server exposes a single URL-per-stream HTTP interface -- the protocol does not prescribe URL structure, so you can organize streams however you choose (e.g., `/v1/stream/{path}`, `/streams/{id}`, or domain-specific paths).

The [Protocol specification](https://github.com/durable-streams/durable-streams/blob/main/PROTOCOL.md) is the authoritative reference for HTTP operations, headers, response codes, and content modes. The [`@durable-streams/server-conformance-tests`](https://github.com/durable-streams/durable-streams/tree/main/packages/server-conformance-tests) package validates your implementation against it -- point it at your running server and it tells you what's passing and what's not. For existing server implementations, see the [Deployment](deployment) docs.

## What to implement

A conforming server handles these HTTP methods:

| Method   | Purpose                                                          |
| -------- | ---------------------------------------------------------------- |
| `PUT`    | Create stream (idempotent)                                       |
| `POST`   | Append to stream, close stream                                   |
| `GET`    | Read -- catch-up, long-poll (`live=long-poll`), SSE (`live=sse`) |
| `HEAD`   | Stream metadata                                                  |
| `DELETE` | Delete stream                                                    |

Servers may implement the read and write paths independently. For example, a database sync server might only implement reads and use its own injection system for writes.

## Storage layer

Your storage backend needs to support these operations:

- **Durable append** -- persist data reliably so that once an append is acknowledged, the data survives restarts
- **Offset generation** -- produce opaque, lexicographically sortable offset tokens that are strictly increasing and unique within a stream
- **Read from offset** -- return all data starting from a given offset, up to a server-defined chunk size
- **Stream metadata** -- track content type, current tail offset, TTL/expiry, and closed status per stream
- **Stream deletion** -- remove a stream and its data

Possible backends include in-memory stores (for development), file-based storage (log files with LMDB indexes), relational databases (Postgres, SQLite), and object storage (S3).

The reference implementations use in-memory and file-backed stores. See the [Dev Server](https://github.com/durable-streams/durable-streams/tree/main/packages/server) and [Caddy Plugin](https://github.com/durable-streams/durable-streams/tree/main/packages/caddy-plugin) source for concrete examples.

## Key protocol requirements

These invariants are enforced by the conformance tests and must hold for any server implementation.

### Byte-exact resumption

Reading from an offset must return exactly the bytes that follow that offset -- no skips, no duplicates. A client that reads a stream in chunks using `Stream-Next-Offset` must reconstruct the exact same byte sequence as reading the entire stream at once.

### Offset monotonicity

Offsets must be strictly increasing. Every append must produce an offset that is lexicographically greater than all previously assigned offsets. Schemes that can produce duplicate or non-monotonic values (such as raw UTC timestamps) are not conforming.

### Stream closure (EOF)

Once a stream is closed, no further appends are permitted. Closure is durable (survives restarts) and monotonic (cannot be reversed). Readers observe closure as a `Stream-Closed: true` header when they reach the final offset.

When rejecting appends to a closed stream, the response must include both `Stream-Closed: true` and `Stream-Next-Offset` so clients can detect the condition programmatically.

### Idempotent creates

`PUT` must be idempotent: creating a stream that already exists with matching configuration returns `200 OK`. Mismatched configuration returns `409 Conflict`.

### Content-Type preservation

The content type is set on stream creation and returned on every read. Appends with a mismatched content type are rejected with `409 Conflict`.

### Long-poll closure behavior

When the stream is closed and the client is at the tail, return `204 No Content` with `Stream-Closed: true` immediately -- do not wait for the timeout.

### HEAD non-cacheability

HEAD responses should include `Cache-Control: no-store` to prevent stale metadata.

## Optional features

These features are tested by the conformance suite but are not strictly required for a minimal implementation.

### Idempotent producers

Handle `Producer-Id`, `Producer-Epoch`, and `Producer-Seq` request headers on POST for exactly-once write semantics. The server tracks `(producerId, epoch, lastSeq)` state per stream and deduplicates retries. Key behaviors:

- All three headers must be present together or not at all
- Epoch must be monotonically non-decreasing; a stale epoch returns `403 Forbidden`
- Sequence numbers must be strictly increasing within an epoch; duplicates return `204 No Content` (idempotent success); gaps return `409 Conflict`
- A new epoch must start at `seq=0`
- Producer state and log appends should be committed atomically where possible

See [Section 5.2.1 of the protocol spec](https://github.com/durable-streams/durable-streams/blob/main/PROTOCOL.md#521-idempotent-producers) for the full validation logic.

### JSON mode

Streams with `Content-Type: application/json` have special semantics:

- Message boundaries are preserved: each POST stores messages as distinct units
- Array flattening: a POST body of `[a, b, c]` stores three messages, not one
- GET responses return a JSON array of all messages in the range
- Empty array POSTs (`[]`) are rejected with `400`
- POST bodies must be valid JSON

### Caching headers

Support CDN-friendly caching:

- `Cache-Control` on catch-up reads (e.g., `public, max-age=60, stale-while-revalidate=300`)
- `ETag` on GET responses for conditional requests (`If-None-Match` / `304 Not Modified`)
- ETags must vary with closure status so clients don't receive stale `304` responses that hide an EOF signal
- `Stream-Cursor` on live responses to enable CDN request collapsing

### TTL / expiry

Support `Stream-TTL` and `Stream-Expires-At` headers on PUT for automatic stream cleanup after a time-to-live. The two headers are mutually exclusive.

## Conformance tests

The conformance test suite is the definitive way to verify your server implements the protocol correctly. Unlike the client conformance tests (which use a stdin/stdout adapter protocol), the server tests make HTTP requests directly against your running server -- no adapter needed.

### Install

```bash
npm install @durable-streams/server-conformance-tests
```

### Architecture

The test suite uses [vitest](https://vitest.dev/) internally. It starts, makes HTTP requests to your server, and validates responses against the protocol spec. Each test uses unique stream paths, so tests are isolated and can run in parallel.

<ServerConformanceDiagram />

### CLI usage

Run tests once against a running server (for CI):

```bash
npx @durable-streams/server-conformance-tests --run http://localhost:4437
```

Watch mode re-runs tests automatically when your source files change (for development):

```bash
npx @durable-streams/server-conformance-tests --watch src http://localhost:4437

# Watch multiple directories
npx @durable-streams/server-conformance-tests --watch src lib http://localhost:4437
```

### Programmatic usage

Run the tests from your own test suite:

```typescript
import { runConformanceTests } from "@durable-streams/server-conformance-tests"

describe("My Server", () => {
  const config = { baseUrl: "" }

  beforeAll(async () => {
    const server = await startMyServer({ port: 0 })
    config.baseUrl = server.url
  })

  afterAll(async () => {
    await server.stop()
  })

  runConformanceTests(config)
})
```

### CI integration

```yaml
# GitHub Actions example
jobs:
  conformance:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
      - run: npm install
      - run: npm run start:server &
      - run: npx wait-on http://localhost:4437
      - run: npx @durable-streams/server-conformance-tests --run http://localhost:4437
```

### Test coverage

The 232 tests cover:

- **Basic operations** -- create, delete, idempotent creates
- **Append operations** -- string data, binary data, chunking, sequences
- **Read operations** -- empty/full streams, offset reads, up-to-date signals
- **Long-poll** -- waiting for data, timeouts, cancellation, edge cases
- **SSE mode** -- Server-Sent Events streaming and control events
- **JSON mode** -- array flattening, message boundaries, validation
- **HTTP protocol** -- headers, status codes, content types, case-insensitivity, browser security headers
- **TTL / expiry** -- TTL and Expires-At handling, expiration behavior
- **Stream closure** -- EOF signaling, closed status propagation
- **Byte-exactness** -- data integrity, no loss or duplication on resumption
- **Caching and ETag** -- ETag generation, `304 Not Modified`, cache headers
- **Idempotent producers** -- deduplication, epoch fencing, sequence validation
- **Read-your-writes consistency** -- immediate visibility after writes
- **Property-based fuzzing** -- random append/read sequences via fast-check
- **Malformed input fuzzing** -- security-focused edge cases

## Reference implementations

Two official implementations are available as reference:

- **Node.js Dev Server** ([packages/server](https://github.com/durable-streams/durable-streams/tree/main/packages/server)) -- a TypeScript implementation good for understanding the basics. Uses in-memory or file-backed storage.
- **Caddy Plugin** ([packages/caddy-plugin](https://github.com/durable-streams/durable-streams/tree/main/packages/caddy-plugin)) -- a production-grade Go implementation built as a Caddy v2 plugin. Uses LMDB for persistence.

See [Deployment](deployment) for usage details on the official server options.

---

See also: [Protocol specification](https://github.com/durable-streams/durable-streams/blob/main/PROTOCOL.md) | [Core concepts](concepts) | [Benchmarking](benchmarking) | [Building a client](building-a-client)
