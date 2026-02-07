# Electric Sync Service (Go)

A Go implementation of the Electric sync service, providing real-time PostgreSQL-to-HTTP synchronization.

## Overview

Electric syncs subsets of your PostgreSQL data into local apps and services. This Go implementation provides:

- **Shapes**: Subscribe to subsets of your database defined by table, WHERE clause, and column selection
- **Real-time sync**: Long-polling for live updates
- **HTTP API**: Compatible with the Electric TypeScript client
- **CDN-friendly**: Deterministic responses with proper cache headers

## Quick Start

### Prerequisites

- Go 1.21+
- PostgreSQL 14+ with logical replication enabled

### Build

```bash
cd packages/sync-service-go
go build -o electric ./cmd/electric
```

### Run

```bash
# Minimal configuration
export DATABASE_URL="postgresql://user:password@localhost:5432/mydb"
./electric

# With all options
export DATABASE_URL="postgresql://user:password@localhost:5432/mydb"
export ELECTRIC_PORT=3000
export ELECTRIC_SECRET=my-api-secret
./electric
```

### Test

```bash
# Run all tests
go test ./...

# Run with verbose output
go test -v ./...

# Run only integration tests
go test -v ./pkg/api/... -run Integration

# Run with coverage
go test -cover ./...

# Run with race detection
go test -race ./...
```

## Configuration

All configuration is via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | (required) | PostgreSQL connection string |
| `ELECTRIC_PORT` | `3000` | HTTP server port |
| `ELECTRIC_SECRET` | (none) | API secret for authentication |
| `ELECTRIC_DB_POOL_SIZE` | `20` | Database connection pool size |
| `ELECTRIC_LONG_POLL_TIMEOUT` | `20s` | Long-polling timeout |
| `ELECTRIC_CHUNK_THRESHOLD` | `10485760` | Chunk size threshold (10MB) |
| `ELECTRIC_MAX_SHAPES` | `0` | Max shapes (0 = unlimited) |

## API Reference

### GET /v1/shape

Sync a shape (subset of a table).

**Query Parameters:**

| Parameter | Required | Description |
|-----------|----------|-------------|
| `table` | Yes | Table name (e.g., `public.users` or just `users`) |
| `where` | No | WHERE clause filter (e.g., `status = 'active'`) |
| `columns` | No | Comma-separated column list |
| `replica` | No | `default` or `full` (include unchanged columns) |
| `offset` | No | Resume from offset (`-1` for beginning) |
| `handle` | No | Shape handle for existing shape |
| `live` | No | `true` for long-polling mode |
| `cursor` | No | Cursor for live mode cache-busting |

**Response Headers:**

| Header | Description |
|--------|-------------|
| `electric-handle` | Shape handle (use for subsequent requests) |
| `electric-offset` | Current offset in the log |
| `electric-schema` | JSON schema of columns and types |
| `electric-up-to-date` | Present when shape is fully synced |
| `electric-cursor` | Cursor for next live request |

**Example:**

```bash
# Initial sync
curl "http://localhost:3000/v1/shape?table=users&where=active=true"

# Resume from offset
curl "http://localhost:3000/v1/shape?table=users&handle=abc123-456&offset=100_5"

# Live mode (long-polling)
curl "http://localhost:3000/v1/shape?table=users&handle=abc123-456&offset=100_5&live=true"
```

### DELETE /v1/shape

Delete a shape and invalidate client caches.

**Query Parameters:**

| Parameter | Description |
|-----------|-------------|
| `table` | Delete shape by table name |
| `handle` | Delete shape by handle |

**Example:**

```bash
# Delete by handle
curl -X DELETE "http://localhost:3000/v1/shape?handle=abc123-456"

# Delete by table
curl -X DELETE "http://localhost:3000/v1/shape?table=users"
```

### GET /v1/health

Health check endpoint.

```bash
curl "http://localhost:3000/v1/health"
# Returns: {"status": "ok"}
```

## Wire Protocol

Responses are JSON arrays of log items:

```json
[
  {
    "offset": "100_0",
    "key": "\"public\".\"users\"/\"123\"",
    "value": {"id": "123", "name": "Alice", "email": "alice@example.com"},
    "headers": {"operation": "insert"}
  },
  {
    "offset": "100_1",
    "key": "\"public\".\"users\"/\"456\"",
    "value": {"id": "456", "name": "Bob"},
    "headers": {"operation": "update"}
  },
  {
    "headers": {"control": "up-to-date"}
  }
]
```

**Operation Types:**
- `insert` - New row
- `update` - Row updated (only changed columns in default replica mode)
- `delete` - Row deleted

**Control Messages:**
- `up-to-date` - Shape is fully synced
- `must-refetch` - Shape was deleted, client must re-sync

## Project Structure

```
packages/sync-service-go/
├── cmd/electric/          # Main entry point
│   └── main.go
├── pkg/
│   ├── api/               # HTTP handlers and router
│   ├── columns/           # Column selection parser
│   ├── config/            # Configuration loading
│   ├── offset/            # Log offset type
│   ├── operations/        # Operation types and key encoding
│   ├── replication/       # PostgreSQL replication client
│   ├── schema/            # Table schema types
│   ├── shape/             # Shape definition and consumer
│   ├── shapecache/        # Shape cache and chunking
│   ├── snapshot/          # Initial snapshot queries
│   ├── storage/           # Storage interface
│   │   └── memory/        # In-memory storage
│   ├── wal/               # WAL message parsing
│   └── where/             # WHERE clause parser
├── .golangci.yml          # Linting configuration
├── Makefile               # Build targets
├── go.mod
└── go.sum
```

## Development

### Makefile Targets

```bash
make build       # Build the binary
make test        # Run tests with race detection
make test-short  # Run tests without race detection
make lint        # Run golangci-lint
make fmt         # Format code
make vet         # Run go vet
make coverage    # Generate coverage report
make tidy        # Run go mod tidy
make check       # Run fmt, vet, and test
```

### Adding a New Package

1. Create directory under `pkg/`
2. Add implementation and tests
3. Run `make check` to verify

### Code Style

- Follow standard Go conventions
- Use `gofmt` and `goimports`
- Run `golangci-lint` before committing

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      HTTP Layer                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │   Router    │  │  Handlers   │  │  Middleware (CORS,  │  │
│  │             │──│             │──│  Auth, Recovery)    │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                    Shape Cache                               │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │   Cache     │  │   Chunker   │  │    Shape Info       │  │
│  │ (by handle) │──│ (10MB)      │──│ (state, offset)     │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                           │
          ┌────────────────┴────────────────┐
          ▼                                 ▼
┌──────────────────┐              ┌──────────────────┐
│     Storage      │              │  Shape Consumer  │
│  ┌────────────┐  │              │  ┌────────────┐  │
│  │   Memory   │  │              │  │  Snapshot  │  │
│  │  (or SQLite)│  │              │  │  Executor  │  │
│  └────────────┘  │              │  └────────────┘  │
└──────────────────┘              │  ┌────────────┐  │
                                  │  │   Change   │  │
                                  │  │   Filter   │  │
                                  │  └────────────┘  │
                                  └──────────────────┘
                                           │
                                           ▼
                                  ┌──────────────────┐
                                  │   Replication    │
                                  │  ┌────────────┐  │
                                  │  │  WAL Parser│  │
                                  │  └────────────┘  │
                                  │  ┌────────────┐  │
                                  │  │ Collector  │  │
                                  │  └────────────┘  │
                                  └──────────────────┘
                                           │
                                           ▼
                                  ┌──────────────────┐
                                  │   PostgreSQL     │
                                  │ (Logical Repl.)  │
                                  └──────────────────┘
```

## Testing

### Unit Tests

Each package has comprehensive unit tests:

```bash
go test -v ./pkg/offset/...     # LogOffset tests
go test -v ./pkg/where/...      # WHERE parser tests
go test -v ./pkg/shape/...      # Shape tests
go test -v ./pkg/shapecache/... # Cache tests
```

### Integration Tests

Integration tests use `httptest.Server` with in-memory storage:

```bash
go test -v ./pkg/api/... -run Integration
```

### Coverage Report

```bash
make coverage
# Opens coverage.html in browser
```

## Differences from Elixir Implementation

This Go implementation is a simplified version focused on core functionality:

**Included:**
- Shape sync (table, WHERE, columns)
- Long-polling live mode
- CDN-friendly caching
- PostgreSQL logical replication

**Not Included (by design):**
- SSE streaming mode
- Subset queries (ORDER BY, LIMIT, OFFSET)
- Shape dependencies / move tags
- Log compaction
- Admission control
- Multi-tenancy

## License

Apache 2.0 - See [LICENSE](../../LICENSE)
