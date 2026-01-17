# Code Conventions

This document covers coding standards and patterns used in the sync-service.

## General Principles

1. **Clarity over cleverness** - Code should be readable and maintainable
2. **Explicit over implicit** - Prefer explicit patterns over magic
3. **Small functions** - Functions should do one thing well
4. **Meaningful names** - Names should describe intent

## Elixir Style

### Formatting

```bash
# Format all Elixir code
mix format

# Check formatting without changing
mix format --check-formatted
```

The project uses the default Elixir formatter with minimal customization.

### Module Structure

```elixir
defmodule Electric.Shapes.Consumer do
  @moduledoc """
  Brief description of the module's purpose.

  ## Overview

  Longer description if needed, explaining:
  - What this module does
  - How it fits into the system
  - Key concepts

  ## Examples

      iex> Consumer.start_link(opts)
      {:ok, pid}
  """

  # 1. use/import/alias/require
  use GenServer
  require Logger

  alias Electric.Shapes.Shape
  alias Electric.ShapeCache.Storage

  # 2. Module attributes
  @behaviour SomeBehaviour
  @type t :: %__MODULE__{}

  # 3. Struct definition (if applicable)
  defstruct [:field1, :field2]

  # 4. Public API functions
  def start_link(opts) do
    GenServer.start_link(__MODULE__, opts)
  end

  # 5. Callback implementations
  @impl GenServer
  def init(opts) do
    {:ok, initial_state(opts)}
  end

  # 6. Private functions (at the end)
  defp initial_state(opts) do
    # ...
  end
end
```

### Naming Conventions

```elixir
# Modules: PascalCase
defmodule Electric.ShapeCache.Storage do

# Functions: snake_case
def get_or_create_shape_handle(shape, stack_id) do

# Variables: snake_case
shape_handle = get_handle(shape)

# Constants: @snake_case
@default_timeout 5000

# Private functions: prefix with defp, no underscore needed
defp validate_params(params) do
```

### Pattern Matching

```elixir
# Prefer pattern matching in function heads
def handle_event(%TransactionFragment{} = fragment, state) do
  # ...
end

def handle_event(%Relation{} = relation, state) do
  # ...
end

# Use guards for type checking
def process(value) when is_binary(value) do
  # ...
end

# Avoid deep nesting with case/cond
# Bad
def process(result) do
  case result do
    {:ok, value} ->
      case validate(value) do
        :ok -> {:ok, transform(value)}
        {:error, reason} -> {:error, reason}
      end
    {:error, reason} ->
      {:error, reason}
  end
end

# Good
def process({:ok, value}) do
  with :ok <- validate(value) do
    {:ok, transform(value)}
  end
end

def process({:error, _} = error), do: error
```

### Error Handling

```elixir
# Use tagged tuples for errors
{:ok, result} | {:error, reason}

# Be specific about error reasons
{:error, :not_found}
{:error, {:invalid_param, :offset, "must be a valid log offset"}}

# Use with for chaining
with {:ok, shape} <- parse_shape(params),
     {:ok, handle} <- get_handle(shape),
     {:ok, data} <- fetch_data(handle) do
  {:ok, data}
end

# Let it crash for unexpected errors
# Don't rescue everything
def process(data) do
  # If transform/1 raises, let supervisor handle it
  result = transform(data)
  {:ok, result}
end
```

### GenServer Patterns

```elixir
defmodule Electric.Shapes.Consumer do
  use GenServer

  # Public API - always use GenServer calls/casts
  def get_state(pid) do
    GenServer.call(pid, :get_state)
  end

  def update(pid, data) do
    GenServer.cast(pid, {:update, data})
  end

  # Callbacks - use @impl
  @impl GenServer
  def init(opts) do
    # Initialize state
    {:ok, %{data: nil, opts: opts}}
  end

  @impl GenServer
  def handle_call(:get_state, _from, state) do
    {:reply, state, state}
  end

  @impl GenServer
  def handle_cast({:update, data}, state) do
    {:noreply, %{state | data: data}}
  end

  @impl GenServer
  def handle_info({:DOWN, _ref, :process, _pid, reason}, state) do
    # Handle process exit
    {:stop, reason, state}
  end
end
```

### Typespecs

```elixir
# Type all public functions
@spec get_or_create_shape_handle(Shape.t(), stack_id()) ::
        {:ok, shape_handle(), LogOffset.t()} | {:error, term()}
def get_or_create_shape_handle(shape, stack_id) do
  # ...
end

# Define custom types in the module
@type t :: %__MODULE__{
  root_table: {schema :: String.t(), name :: String.t()},
  root_pk: [String.t()],
  where: Expr.t() | nil
}

# Use type aliases for clarity
@type stack_id :: atom()
@type shape_handle :: String.t()
```

## Project Patterns

### Behaviours

Define behaviours for pluggable components:

```elixir
# Define the behaviour
defmodule Electric.ShapeCache.Storage do
  @callback make_new_snapshot!(stream :: Enum.t(), opts :: keyword()) :: :ok
  @callback append_to_log!(items :: list(), state :: term()) :: state :: term()
  # ...
end

# Implement it
defmodule Electric.ShapeCache.PureFileStorage do
  @behaviour Electric.ShapeCache.Storage

  @impl Storage
  def make_new_snapshot!(stream, opts) do
    # ...
  end
end
```

### Configuration

```elixir
# Use NimbleOptions for config validation
@schema NimbleOptions.new!([
  storage_dir: [
    type: :string,
    required: true,
    doc: "Directory for shape storage"
  ],
  chunk_size: [
    type: :pos_integer,
    default: 1_000_000,
    doc: "Size of log chunks in bytes"
  ]
])

def init(opts) do
  case NimbleOptions.validate(opts, @schema) do
    {:ok, validated} -> {:ok, init_state(validated)}
    {:error, error} -> {:error, error}
  end
end
```

### Telemetry

```elixir
# Emit telemetry events for observability
def process_transaction(txn) do
  start_time = System.monotonic_time()

  result = do_process(txn)

  :telemetry.execute(
    [:electric, :consumer, :transaction_processed],
    %{duration: System.monotonic_time() - start_time},
    %{shape_handle: state.shape_handle, xid: txn.xid}
  )

  result
end
```

### Testing

```elixir
# Use async tests when possible
defmodule MyTest do
  use ExUnit.Case, async: true

  # Group related tests
  describe "function_name/arity" do
    test "handles valid input" do
      # Arrange
      input = valid_input()

      # Act
      result = MyModule.function_name(input)

      # Assert
      assert {:ok, _} = result
    end

    test "returns error for invalid input" do
      assert {:error, :invalid} = MyModule.function_name(nil)
    end
  end
end
```

## Common Patterns in the Codebase

### Stack ID

Every operation is scoped to a stack (database connection):

```elixir
def get_shape(stack_id, shape_handle) do
  # Use stack_id to find the right processes/tables
  registry = Electric.ProcessRegistry.name(stack_id)
  # ...
end
```

### Shape Handle

Shape handles are deterministic hashes:

```elixir
# Same definition = same handle
def shape_handle(shape) do
  shape
  |> Shape.comparable()
  |> :erlang.term_to_binary()
  |> then(&:crypto.hash(:sha256, &1))
  |> Base.encode64(padding: false)
end
```

### Offset Comparison

Use the LogOffset module for comparisons:

```elixir
# Don't compare tuples directly
# Bad
if offset1 < offset2 do

# Good
if LogOffset.lt?(offset1, offset2) do

# Or use compare/2
case LogOffset.compare(offset1, offset2) do
  :lt -> # ...
  :eq -> # ...
  :gt -> # ...
end
```

### Process Registration

Use Registry for dynamic process lookup:

```elixir
# Register a process
Registry.register(registry, {:consumer, shape_handle}, [])

# Look up processes
case Registry.lookup(registry, {:consumer, shape_handle}) do
  [{pid, _}] -> {:ok, pid}
  [] -> {:error, :not_found}
end
```

## Commit Messages

Follow conventional commits:

```
type(scope): message (#PR)

Types:
- feat: New feature
- fix: Bug fix
- docs: Documentation
- style: Formatting
- refactor: Code restructuring
- test: Adding tests
- chore: Maintenance

Examples:
feat(sync-service): Add WHERE clause support (#123)
fix(sync-service): Fix offset comparison edge case (#456)
refactor(sync-service): Extract storage behaviour (#789)
```
