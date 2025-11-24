# Electric Sync Service - Development Guide

> **Audience:** AI coding assistants working on the Electric sync service backend (Elixir)
> **Location:** `packages/sync-service/`

## Running Commands

### Option 1: With Elixir Installed (Native)

If you have Elixir 1.19+ and Erlang/OTP 28+ installed:

```sh
mix test                                    # Run all tests
mix test test/electric/shapes/              # Run tests in directory
mix test test/path/to/test.exs:42           # Run specific test by line
mix format                                  # Format code
mix dialyzer                                # Static analysis
```

### Option 2: Without Elixir (Docker)

If Elixir/Erlang are not installed, use Docker:

**First time - start the environment:**
```sh
docker compose -f docker-compose.test.yml up -d --build
```

**Run any mix command:**
```sh
docker compose -f docker-compose.test.yml exec sync-service mix test
docker compose -f docker-compose.test.yml exec sync-service mix test test/electric/shapes/
docker compose -f docker-compose.test.yml exec sync-service mix format
docker compose -f docker-compose.test.yml exec sync-service mix dialyzer
```

**Key benefits:**
- No local Elixir/Erlang installation needed
- All dependencies (including native NIFs like pg_query_ex) are pre-compiled
- Source code (`lib/`, `test/`, `config/`) is mounted, so changes are immediately available
- Only rebuild when dependencies change: `docker compose -f docker-compose.test.yml up -d --build`

**Stop environment:**
```sh
docker compose -f docker-compose.test.yml down
```

## Test Commands

Common patterns:
- `mix test --failed` - Rerun only failed tests
- `mix test --max-failures 1` - Stop at first failure
- `mix coveralls.html` - Generate HTML coverage report

## Code Quality

- `mix format` - Format all code (auto-formats on save in most editors)
- `mix dialyzer` - Type checking (slow first run, then cached)

## Common Issues

**"PgQuery.Parser not available" or "invalid ELF header"**
- Native dependency compilation issue
- Solution: Use Docker environment (has pre-compiled NIFs)

**"all replication slots are in use"**
- Postgres config limit reached
- Solution: Increase `max_replication_slots` in `dev/postgres.conf` or run fewer tests in parallel

**Tests hang/timeout**
- Postgres not running
- Solution: Docker environment starts Postgres automatically, or run `docker compose -f dev/docker-compose.yml up -d`
