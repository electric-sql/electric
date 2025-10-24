defmodule Electric.ShapeRouter do
  @moduledoc """
  High-performance WAL→Shape routing using a 4-layer architecture:

  1. **Presence Filter** (Binary Fuse) - Fast negative path, ~9-10 bits/key
  2. **Exact Membership** (MPHF + shape-id pool + delta) - Compact exact lookup
  3. **Predicate Gate** - Compiled WHERE clause evaluation
  4. **Write Path** - Append to shape logs

  ## Design Goals

  - **Latency**: 10-20 μs/lookup for typical cases
  - **Memory**: ~12-13 bytes/key (present keys only)
  - **Scale**: Millions of keys, hundreds of shapes
  - **Churn**: O(1) updates via delta overlay, periodic rebuilds

  ## Usage

      # Create a router for a (tenant, table) pair
      {:ok, router} = ShapeRouter.new("tenant_1", "todos")

      # Register a shape
      ShapeRouter.add_shape(router, shape_id, where_clause, initial_pks)

      # Route a WAL operation
      matched_shapes = ShapeRouter.route(router, wal_op)

      # Get performance metrics
      metrics = ShapeRouter.metrics(router)
  """

  alias Electric.ShapeRouter.Native

  @type router_ref :: reference()
  @type shape_id :: non_neg_integer()
  @type pk_hash :: non_neg_integer()

  @doc """
  Create a new router instance for a (tenant, table) pair.
  """
  @spec new(String.t(), String.t()) :: {:ok, router_ref()} | {:error, term()}
  def new(_tenant, _table) do
    case Native.new_router() do
      {:ok, router} -> {:ok, router}
      error -> {:error, error}
    end
  end

  @doc """
  Route a WAL operation to matching shapes.

  ## Parameters

  - `router`: Router reference
  - `wal_op`: WAL operation map with keys:
    - `:pk`: Primary key (will be hashed)
    - `:old_record`: Old row data (for UPDATEs/DELETEs)
    - `:new_record`: New row data (for INSERTs/UPDATEs)
    - `:changed_columns`: List of changed column IDs (for UPDATEs)

  ## Returns

  List of matching shape IDs.

  ## Examples

      # INSERT operation
      shapes = ShapeRouter.route(router, %{
        pk: 42,
        new_record: %{id: 42, user_id: 1, status: "active"},
        changed_columns: []
      })

      # UPDATE operation
      shapes = ShapeRouter.route(router, %{
        pk: 42,
        old_record: %{id: 42, user_id: 1, status: "pending"},
        new_record: %{id: 42, user_id: 1, status: "active"},
        changed_columns: [2]  # status column
      })
  """
  @spec route(router_ref(), map()) :: [shape_id()]
  def route(router, wal_op) do
    pk_hash = hash_pk(wal_op[:pk])
    old_row = encode_row(wal_op[:old_record])
    new_row = encode_row(wal_op[:new_record])
    changed_columns = wal_op[:changed_columns] || []

    Native.route(router, pk_hash, old_row, new_row, changed_columns)
  end

  @doc """
  Add a shape to the router.

  ## Parameters

  - `router`: Router reference
  - `shape_id`: Unique shape identifier
  - `where_clause`: WHERE clause string (simplified syntax for prototype)
  - `initial_pks`: List of primary keys currently matching the shape

  ## Examples

      ShapeRouter.add_shape(router, 1, "user_id = 123", [1, 2, 3])
      ShapeRouter.add_shape(router, 2, "status IN (1, 2, 3)", [4, 5, 6])
  """
  @spec add_shape(router_ref(), shape_id(), String.t(), [term()]) ::
          :ok | {:error, term()}
  def add_shape(router, shape_id, where_clause, initial_pks) do
    # Compile predicate
    case compile_predicate(where_clause) do
      {:ok, predicate_bytes} ->
        pk_hashes = Enum.map(initial_pks, &hash_pk/1)

        case Native.add_shape(router, shape_id, predicate_bytes, pk_hashes) do
          true -> :ok
          false -> {:error, :add_failed}
        end

      {:error, reason} ->
        {:error, {:invalid_predicate, reason}}
    end
  end

  @doc """
  Remove a shape from the router.
  """
  @spec remove_shape(router_ref(), shape_id()) :: :ok
  def remove_shape(router, shape_id) do
    Native.remove_shape(router, shape_id)
    :ok
  end

  @doc """
  Trigger a rebuild of the router's base structures.

  This rebuilds the presence filter and compacts the delta overlay.
  Should be called periodically or when delta grows too large.

  This operation is expensive and should be run asynchronously.
  """
  @spec rebuild(router_ref()) :: :ok
  def rebuild(router) do
    Task.start(fn ->
      Native.rebuild(router)
    end)

    :ok
  end

  @doc """
  Get performance metrics from the router.

  Returns a map with:
  - `presence_checks`: Total presence filter checks
  - `presence_hits`: Number of hits in presence filter
  - `presence_hit_rate`: Hit rate (0.0 - 1.0)
  - `route_calls`: Total route() calls
  - `route_hits`: Calls that matched shapes
  - `route_misses`: Calls that matched no shapes
  - `false_positives`: Presence hits that didn't match
  - `false_positive_rate`: FP rate (0.0 - 1.0)
  - `avg_presence_us`: Average presence check time (μs)
  - `avg_route_us`: Average route time (μs)
  - `avg_shapes_per_hit`: Average shapes matched per hit
  - `rebuilds`: Number of rebuilds performed
  - `avg_rebuild_ms`: Average rebuild time (ms)
  """
  @spec metrics(router_ref()) :: map()
  def metrics(router) do
    case Native.get_metrics(router) do
      json when is_binary(json) ->
        Jason.decode!(json)

      _ ->
        %{}
    end
  end

  ## Private functions

  # Hash a primary key to u64 using XXH3
  defp hash_pk(pk) when is_integer(pk) do
    # Simple hash for integers
    # In production: use xxh3 via NIF
    :erlang.phash2(pk, 1 <<< 64)
  end

  defp hash_pk(pk) when is_binary(pk) do
    :erlang.phash2(pk, 1 <<< 64)
  end

  defp hash_pk(pk) when is_tuple(pk) do
    # Composite PK
    :erlang.phash2(pk, 1 <<< 64)
  end

  # Encode a row to bytes for predicate evaluation
  defp encode_row(nil), do: nil

  defp encode_row(record) when is_map(record) do
    # Simplified: serialize to JSON for prototype
    # Production: use PostgreSQL wire format or custom compact encoding
    Jason.encode!(record)
  end

  # Compile a WHERE clause to predicate bytecode
  defp compile_predicate(where_clause) do
    # For prototype: use simplified compiler in Elixir
    # Production: use pg_query_ex to parse, then compile in Rust

    # Simplified: just pass the where clause as JSON
    # The Rust side will compile it
    predicate = %{
      type: "simple",
      clause: where_clause,
      # Mock column map (in production, get from schema)
      column_map: %{
        "user_id" => 0,
        "status" => 1,
        "tenant_id" => 2
      }
    }

    {:ok, Jason.encode!(predicate)}
  end
end
