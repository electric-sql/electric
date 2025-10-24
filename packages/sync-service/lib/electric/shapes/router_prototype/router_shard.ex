defmodule Electric.Shapes.RouterPrototype.RouterShard do
  @moduledoc """
  A single router shard responsible for a subset of shapes.

  Each shard owns:
  1. A posting list (ETS table) mapping values → shape IDs
  2. A map of shape_id → CompiledShape for evaluation
  3. A set of "slow lane" shapes that need full evaluation

  ## Shard Assignment

  Shapes are assigned to shards based on their routing key:

      shard_id = :erlang.phash2(routing_key, num_shards)

  For shapes with equality conditions like `id = 42`:
  - routing_key = {field_name, value} = {"id", 42}
  - All records with id=42 route to the same shard

  This provides:
  - **Parallelism**: Different shards process different keys concurrently
  - **Locality**: Same key always goes to same shard
  - **Load balancing**: Hash distributes keys evenly

  ## Fast Lane vs Slow Lane

  **Fast Lane**:
  - Shapes with simple equality conditions
  - Stored in posting list for O(1) lookup
  - No WHERE clause evaluation needed

  **Slow Lane**:
  - Shapes with complex conditions (ranges, LIKE, etc.)
  - Must evaluate WHERE clause for every record
  - Isolated to this shard, not global

  ## Example

      shard = RouterShard.new(shard_id: 0)

      # Register fast lane shape: id = 42
      shape1 = CompiledShape.compile(id: 1, table: "users", where: "id = 42", inspector: inspector)
      RouterShard.add_shape(shard, shape1)

      # Register slow lane shape: price > 100
      shape2 = CompiledShape.compile(id: 2, table: "products", where: "price > 100", inspector: inspector)
      RouterShard.add_shape(shard, shape2)

      # Route a record - fast lane lookup
      record = %{"id" => "42", "name" => "Alice"}
      RouterShard.affected_shapes(shard, "users", record)
      #=> [1]  # O(1) posting list lookup

      # Route a record - slow lane evaluation
      record = %{"id" => "100", "price" => "150"}
      RouterShard.affected_shapes(shard, "products", record)
      #=> [2]  # Evaluated WHERE clause
  """

  alias Electric.Shapes.RouterPrototype.{PostingList, CompiledShape}

  defstruct [
    :shard_id,
    :posting_list,
    :shapes,
    :slow_lane_shapes,
    :stats
  ]

  @type shard_id :: non_neg_integer()
  @type shape_id :: non_neg_integer()
  @type table_name :: String.t()

  @type t :: %__MODULE__{
          shard_id: shard_id(),
          posting_list: PostingList.table(),
          shapes: %{shape_id() => CompiledShape.t()},
          slow_lane_shapes: %{table_name() => [shape_id()]},
          stats: map()
        }

  @doc """
  Creates a new router shard.

  ## Options

  - `:shard_id` - Unique identifier for this shard (required)
  """
  @spec new(keyword()) :: t()
  def new(opts) do
    shard_id = Keyword.fetch!(opts, :shard_id)

    %__MODULE__{
      shard_id: shard_id,
      posting_list: PostingList.new(),
      shapes: %{},
      slow_lane_shapes: %{},
      stats: %{
        fast_lane_count: 0,
        slow_lane_count: 0,
        total_shapes: 0,
        lookups: 0,
        fast_lane_hits: 0,
        slow_lane_evaluations: 0
      }
    }
  end

  @doc """
  Adds a shape to this shard.

  Automatically routes to fast lane or slow lane based on the compiled shape type.
  """
  @spec add_shape(t(), CompiledShape.t()) :: t()
  def add_shape(shard, %CompiledShape{} = shape) do
    case CompiledShape.type(shape) do
      :fast ->
        add_fast_lane_shape(shard, shape)

      :slow ->
        add_slow_lane_shape(shard, shape)
    end
  end

  # Adds a shape to the fast lane (posting list)
  defp add_fast_lane_shape(shard, shape) do
    case CompiledShape.routing_key(shape) do
      {:ok, {field, value}} ->
        # Extract table name - would need to be stored in CompiledShape in real impl
        # For now, assume we have it
        table = extract_table_name(shape)

        # Insert into posting list
        PostingList.insert(shard.posting_list, table, field, value, shape.id)

        # Store shape
        shapes = Map.put(shard.shapes, shape.id, shape)

        # Update stats
        stats =
          shard.stats
          |> Map.update!(:fast_lane_count, &(&1 + 1))
          |> Map.update!(:total_shapes, &(&1 + 1))

        %{shard | shapes: shapes, stats: stats}

      :error ->
        # If no routing key, treat as slow lane
        add_slow_lane_shape(shard, shape)
    end
  end

  # Adds a shape to the slow lane (requires evaluation)
  defp add_slow_lane_shape(shard, shape) do
    table = extract_table_name(shape)

    # Add to slow lane list for this table
    slow_lane_shapes =
      Map.update(shard.slow_lane_shapes, table, [shape.id], fn existing ->
        [shape.id | existing]
      end)

    # Store shape
    shapes = Map.put(shard.shapes, shape.id, shape)

    # Update stats
    stats =
      shard.stats
      |> Map.update!(:slow_lane_count, &(&1 + 1))
      |> Map.update!(:total_shapes, &(&1 + 1))

    %{shard | shapes: shapes, slow_lane_shapes: slow_lane_shapes, stats: stats}
  end

  @doc """
  Finds all shapes affected by a record change.

  Returns a list of shape IDs (not MapSet) for minimal allocation.
  Uses early-exit optimization when possible.

  ## Options

  - `:early_exit` - Return after first match (default: false)
  - `:refs_fun` - Function to get refs for slow lane evaluation (required if slow lane shapes exist)
  """
  @spec affected_shapes(t(), table_name(), map(), keyword()) :: [shape_id()]
  def affected_shapes(shard, table, record, opts \\ []) do
    early_exit = Keyword.get(opts, :early_exit, false)
    refs_fun = Keyword.get(opts, :refs_fun)

    # Update lookup stats
    shard_with_stats = update_in(shard.stats[:lookups], &(&1 + 1))

    # Fast lane: Check posting lists for all fields in the record
    fast_lane_matches = fast_lane_lookup(shard_with_stats, table, record, early_exit)

    if early_exit and fast_lane_matches != [] do
      # Early exit: found match in fast lane
      fast_lane_matches
    else
      # Slow lane: Evaluate complex shapes
      slow_lane_matches = slow_lane_evaluate(shard_with_stats, table, record, refs_fun)

      # Combine results
      fast_lane_matches ++ slow_lane_matches
    end
  end

  # Fast lane: O(1) posting list lookups
  defp fast_lane_lookup(shard, table, record, early_exit) do
    # For each field in the record, check posting list
    Enum.reduce_while(record, [], fn {field, value}, acc ->
      matches = PostingList.lookup(shard.posting_list, table, field, value)

      if early_exit and matches != [] do
        {:halt, matches}
      else
        {:cont, acc ++ matches}
      end
    end)
  end

  # Slow lane: Full WHERE clause evaluation
  defp slow_lane_evaluate(shard, table, record, refs_fun) do
    case Map.get(shard.slow_lane_shapes, table) do
      nil ->
        []

      shape_ids ->
        # Update slow lane stats
        update_in(shard.stats[:slow_lane_evaluations], &(&1 + length(shape_ids)))

        # Evaluate each slow lane shape
        for shape_id <- shape_ids,
            shape = Map.fetch!(shard.shapes, shape_id),
            CompiledShape.matches?(shape, record, refs_fun) do
          shape_id
        end
    end
  end

  @doc """
  Removes a shape from this shard.
  """
  @spec remove_shape(t(), shape_id()) :: t()
  def remove_shape(shard, shape_id) do
    case Map.get(shard.shapes, shape_id) do
      nil ->
        shard

      shape ->
        case CompiledShape.type(shape) do
          :fast ->
            remove_fast_lane_shape(shard, shape)

          :slow ->
            remove_slow_lane_shape(shard, shape)
        end
    end
  end

  defp remove_fast_lane_shape(shard, shape) do
    # Remove from posting list
    PostingList.delete_shape(shard.posting_list, shape.id)

    # Remove from shapes map
    shapes = Map.delete(shard.shapes, shape.id)

    # Update stats
    stats =
      shard.stats
      |> Map.update!(:fast_lane_count, &(&1 - 1))
      |> Map.update!(:total_shapes, &(&1 - 1))

    %{shard | shapes: shapes, stats: stats}
  end

  defp remove_slow_lane_shape(shard, shape) do
    table = extract_table_name(shape)

    # Remove from slow lane list
    slow_lane_shapes =
      Map.update(shard.slow_lane_shapes, table, [], fn shape_ids ->
        List.delete(shape_ids, shape.id)
      end)

    # Remove from shapes map
    shapes = Map.delete(shard.shapes, shape.id)

    # Update stats
    stats =
      shard.stats
      |> Map.update!(:slow_lane_count, &(&1 - 1))
      |> Map.update!(:total_shapes, &(&1 - 1))

    %{shard | shapes: shapes, slow_lane_shapes: slow_lane_shapes, stats: stats}
  end

  @doc """
  Returns statistics about this shard.
  """
  @spec stats(t()) :: map()
  def stats(shard) do
    posting_list_stats = PostingList.stats(shard.posting_list)

    Map.merge(shard.stats, %{
      posting_list: posting_list_stats,
      avg_slow_lane_shapes_per_table:
        if(map_size(shard.slow_lane_shapes) > 0,
          do: shard.stats.slow_lane_count / map_size(shard.slow_lane_shapes),
          else: 0
        )
    })
  end

  # Helper to extract table name from shape
  # In real implementation, table would be stored in CompiledShape
  defp extract_table_name(_shape) do
    # Placeholder - would need to store table in CompiledShape
    "unknown"
  end
end
