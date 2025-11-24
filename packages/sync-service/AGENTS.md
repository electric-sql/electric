# Electric Sync Service - Development Guide

> **Audience:** AI coding assistants working on the Electric sync service backend (Elixir)
> **Location:** `packages/sync-service/`

## Running Commands

### Docker-Based Testing (Recommended for Claude Code Cloud)

**IMPORTANT for Claude Code Cloud:** Always use Docker for testing. Do NOT attempt to install Elixir natively - it is very slow.

**Install Docker (if not already installed):**
```sh
sudo apt-get update -qq && sudo apt-get install -y -qq docker.io docker-compose && sudo service docker start
```

**Navigate to sync-service directory:**
```sh
cd packages/sync-service
```

**Start the test environment:**
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

**Why Docker:**
- No Elixir/Erlang installation needed (installing natively is very slow)
- All dependencies (including native NIFs like pg_query_ex) are pre-compiled in the image
- Source code (`lib/`, `test/`, `config/`) is mounted for live updates
- Only rebuild when dependencies change: `docker compose -f docker-compose.test.yml up -d --build`

**Stop environment:**
```sh
docker compose -f docker-compose.test.yml down
```

### Native Elixir (For Local Development Only)

If you have Elixir 1.19+ and Erlang/OTP 28+ already installed locally:

```sh
mix test                                    # Run all tests
mix test test/electric/shapes/              # Run tests in directory
mix test test/path/to/test.exs:42           # Run specific test by line
mix format                                  # Format code
mix dialyzer                                # Static analysis
```

## Test Commands

Common patterns:
- `mix test --failed` - Rerun only failed tests
- `mix test --max-failures 1` - Stop at first failure
- `mix coveralls.html` - Generate HTML coverage report

## Code Quality

- `mix format` - Format all code (auto-formats on save in most editors)
- `mix dialyzer` - Type checking (slow first run, then cached)
