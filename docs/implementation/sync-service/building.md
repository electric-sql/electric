# Building the Sync-Service

This document covers build setup, dependencies, and development environment.

## Prerequisites

### Required Tools

- **Elixir**: 1.17+ (check `.tool-versions` for exact version)
- **Erlang/OTP**: 27+ (check `.tool-versions` for exact version)
- **PostgreSQL**: 14+ with logical replication enabled
- **asdf**: Recommended for version management

### Version Management

```bash
# Install correct versions
cd packages/sync-service
asdf install

# Verify versions
elixir --version
erl -eval 'erlang:display(erlang:system_info(otp_release)), halt().'
```

## Quick Start

```bash
# From repository root
pnpm install

# Navigate to sync-service
cd packages/sync-service

# Install Elixir dependencies
mix deps.get

# Compile
mix compile

# Start development database (Docker)
mix start_dev

# Run the service
mix run --no-halt
```

## Dependencies

### Key Dependencies

| Dependency       | Purpose                  |
| ---------------- | ------------------------ |
| `postgrex`       | PostgreSQL driver        |
| `plug`           | HTTP middleware          |
| `bandit`         | HTTP server              |
| `jason`          | JSON encoding            |
| `nimble_options` | Configuration validation |
| `cubdb`          | Embedded key-value store |
| `telemetry`      | Metrics and tracing      |
| `opentelemetry`  | Distributed tracing      |

### Installing Dependencies

```bash
# Install all dependencies
mix deps.get

# Update dependencies
mix deps.update --all

# Check for outdated
mix hex.outdated
```

## Compilation

```bash
# Development build
mix compile

# Production release
MIX_ENV=prod mix release

# Force recompilation
mix compile --force
```

## Configuration

### Environment Variables

| Variable               | Description                  | Default         |
| ---------------------- | ---------------------------- | --------------- |
| `DATABASE_URL`         | PostgreSQL connection string | Required        |
| `ELECTRIC_PORT`        | HTTP server port             | 3000            |
| `ELECTRIC_SECRET`      | API authentication secret    | None (insecure) |
| `ELECTRIC_STORAGE_DIR` | Shape storage directory      | `./shapes`      |
| `ELECTRIC_LOG_LEVEL`   | Logging level                | `info`          |

### Database URL Format

```
postgresql://user:password@host:port/database?sslmode=prefer
```

### Development Configuration

```elixir
# config/dev.exs
config :electric,
  service_port: 3000,
  storage_dir: "shapes",
  log_level: :debug
```

## Development Database

### Using Docker

```bash
# Start PostgreSQL with logical replication
mix start_dev

# This runs:
# docker run -p 54321:5432 \
#   -e POSTGRES_PASSWORD=password \
#   -e POSTGRES_DB=electric \
#   postgres:15 \
#   -c wal_level=logical
```

### Manual Setup

```sql
-- Enable logical replication (in postgresql.conf)
wal_level = logical
max_replication_slots = 10
max_wal_senders = 10

-- Create replication user
CREATE USER electric WITH REPLICATION PASSWORD 'password';
GRANT ALL ON DATABASE yourdb TO electric;
```

## Running the Service

### Development Mode

```bash
# Interactive shell
iex -S mix

# Without shell
mix run --no-halt

# With specific config
ELECTRIC_PORT=4000 mix run --no-halt
```

### Production Release

```bash
# Build release
MIX_ENV=prod mix release

# Run release
_build/prod/rel/electric/bin/electric start
```

## Docker

### Building Image

```bash
# From repository root
docker build -f packages/sync-service/Dockerfile -t electric .
```

### Running Container

```bash
docker run -p 3000:3000 \
  -e DATABASE_URL="postgresql://..." \
  -e ELECTRIC_SECRET="your-secret" \
  electric
```

## Troubleshooting

### Common Issues

**"wal_level must be 'logical'"**

```bash
# Check current setting
psql -c "SHOW wal_level;"

# Update in postgresql.conf
wal_level = logical
# Restart PostgreSQL
```

**"Replication slot already active"**

```bash
# Check active connections
SELECT * FROM pg_replication_slots;

# Drop slot if needed
SELECT pg_drop_replication_slot('electric_slot');
```

**"Permission denied"**

```sql
-- Grant replication permission
ALTER USER electric WITH REPLICATION;
GRANT ALL ON ALL TABLES IN SCHEMA public TO electric;
```

### Debugging

```bash
# Verbose compilation
mix compile --verbose

# Debug logging
ELECTRIC_LOG_LEVEL=debug mix run --no-halt

# Interactive debugging
iex -S mix
> :observer.start()  # Opens GUI observer
```

## IDE Setup

### VS Code

Recommended extensions:

- ElixirLS
- Elixir Formatter

```json
// .vscode/settings.json
{
  "elixirLS.dialyzerEnabled": true,
  "editor.formatOnSave": true,
  "[elixir]": {
    "editor.defaultFormatter": "JakeBecker.elixir-ls"
  }
}
```

### IntelliJ/WebStorm

- Install Elixir plugin
- Configure SDK to use asdf-managed Elixir
