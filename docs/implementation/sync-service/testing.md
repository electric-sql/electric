# Testing

This document covers test suites and how to run them for the sync-service.

## Quick Start

```bash
cd packages/sync-service

# Ensure test database is running
mix start_dev

# Run all tests
mix test

# Run with coverage
mix test --cover
```

## Test Structure

```
test/
├── electric/                    # Unit tests by module
│   ├── shapes/
│   │   ├── shape_test.exs
│   │   ├── consumer_test.exs
│   │   └── api_test.exs
│   ├── replication/
│   │   ├── shape_log_collector_test.exs
│   │   └── log_offset_test.exs
│   ├── shape_cache/
│   │   ├── storage_test.exs
│   │   └── pure_file_storage_test.exs
│   └── plug/
│       ├── router_test.exs
│       └── serve_shape_plug_test.exs
├── support/                     # Test helpers
│   ├── component_setup.ex
│   ├── db_setup.ex
│   └── fixtures/
└── test_helper.exs
```

## Running Tests

### Basic Commands

```bash
# Run all tests
mix test

# Run specific file
mix test test/electric/shapes/shape_test.exs

# Run specific test
mix test test/electric/shapes/shape_test.exs:42

# Run tests matching pattern
mix test --only shape

# Exclude slow tests
mix test --exclude slow

# Run with seed for reproducibility
mix test --seed 12345
```

### Filtering Tests

```bash
# Only unit tests
mix test --only unit

# Only integration tests
mix test --only integration

# Exclude database tests
mix test --exclude database

# Only tests tagged with specific feature
mix test --only feature:replication
```

### Parallel Execution

```bash
# Run with max parallelism
mix test --max-cases 16

# Run sequentially (useful for debugging)
mix test --max-cases 1
```

## Test Database

### Setup

Tests require a PostgreSQL database with logical replication:

```bash
# Start development database (Docker)
mix start_dev

# Or manually configure DATABASE_URL
export DATABASE_URL="postgresql://postgres:password@localhost:54321/electric_test"
```

### Database Configuration

```elixir
# config/test.exs
config :electric,
  connection_opts: [
    hostname: "localhost",
    port: 54321,
    username: "postgres",
    password: "password",
    database: "electric_test"
  ]
```

### Isolation

Each test that needs a database gets a fresh schema:

```elixir
defmodule MyTest do
  use Electric.Case, async: true

  setup do
    # Creates isolated schema for this test
    {:ok, ctx} = Electric.Test.DbSetup.setup_test_db()
    {:ok, ctx}
  end
end
```

## Test Helpers

### Component Setup

```elixir
# Start full stack for integration tests
defmodule MyIntegrationTest do
  use Electric.Case

  setup ctx do
    {:ok, stack} = Electric.Test.ComponentSetup.start_stack(ctx)
    {:ok, Map.merge(ctx, stack)}
  end

  test "full flow", ctx do
    # ctx contains: shape_cache, storage, shape_log_collector, etc.
  end
end
```

### Storage Testing

```elixir
# Use in-memory storage for fast tests
setup do
  storage = Electric.ShapeCache.InMemoryStorage.new()
  {:ok, storage: storage}
end
```

### API Testing

```elixir
# Use Plug.Test for HTTP tests
defmodule ApiTest do
  use Electric.Case
  use Plug.Test

  test "GET /v1/shape returns data" do
    conn = conn(:get, "/v1/shape", %{table: "users", offset: "-1"})
    conn = Router.call(conn, Router.init([]))

    assert conn.status == 200
    assert get_resp_header(conn, "electric-handle") != []
  end
end
```

## Writing Tests

### Unit Test Example

```elixir
defmodule Electric.Shapes.ShapeTest do
  use ExUnit.Case, async: true

  alias Electric.Shapes.Shape

  describe "new/2" do
    test "creates shape with valid params" do
      params = %{
        root_table: {"public", "users"},
        root_table_id: 123,
        root_pk: ["id"]
      }

      assert {:ok, shape} = Shape.new(params, inspector)
      assert shape.root_table == {"public", "users"}
    end

    test "returns error for invalid table" do
      params = %{root_table: nil}

      assert {:error, _} = Shape.new(params, inspector)
    end
  end
end
```

### Integration Test Example

```elixir
defmodule Electric.Integration.ShapeFlowTest do
  use Electric.Case

  @moduletag :integration

  setup ctx do
    {:ok, stack} = ComponentSetup.start_stack(ctx)
    {:ok, Map.merge(ctx, stack)}
  end

  test "shape receives changes from database", ctx do
    # Insert data
    Postgrex.query!(ctx.conn, "INSERT INTO users (name) VALUES ($1)", ["Alice"])

    # Wait for shape to receive change
    assert_receive {:shape_update, _}, 5000

    # Verify in storage
    {:ok, changes} = Storage.get_log_stream(ctx.storage, first_offset(), last_offset())
    assert length(Enum.to_list(changes)) > 0
  end
end
```

### Property-Based Testing

```elixir
defmodule Electric.Replication.LogOffsetPropertyTest do
  use ExUnit.Case
  use ExUnitProperties

  alias Electric.Replication.LogOffset

  property "offsets are totally ordered" do
    check all a <- log_offset_generator(),
              b <- log_offset_generator() do
      # Exactly one must be true
      assert LogOffset.compare(a, b) in [:lt, :eq, :gt]

      # Transitivity
      if LogOffset.compare(a, b) == :lt do
        assert LogOffset.compare(b, a) == :gt
      end
    end
  end

  defp log_offset_generator do
    gen all tx <- positive_integer(),
            op <- positive_integer() do
      LogOffset.new(tx, op)
    end
  end
end
```

## Coverage

```bash
# Run with coverage report
mix test --cover

# Generate HTML coverage report
mix coveralls.html

# Coverage by module
mix coveralls.detail
```

## Continuous Integration

Tests are run in CI with:

```yaml
# .github/workflows/test.yml
- name: Run tests
  env:
    DATABASE_URL: postgresql://postgres:postgres@localhost:5432/electric_test
  run: |
    cd packages/sync-service
    mix deps.get
    mix compile
    mix test
```

## Debugging Tests

```bash
# Run with IEx for debugging
iex -S mix test test/path/to/test.exs:42

# Print to console
IO.inspect(value, label: "debug")

# Verbose assertions
ExUnit.configure(trace: true)
```

## Performance Testing

```bash
# Run benchmarks
mix bench

# Profile specific test
mix profile.eprof test/path/to/test.exs:42
```
