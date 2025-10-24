defmodule Electric.Shapes.RouterPrototype.ShardedRouter do
  @moduledoc """
  A sharded routing system that distributes shapes across N shards for parallel processing.

  ## Architecture

  ```
                        ┌─────────────────────────────┐
                        │   Incoming WAL Transaction  │
                        └──────────────┬──────────────┘
                                       │
                        ┌──────────────▼──────────────┐
                        │   ShardedRouter             │
                        │   - Routes by hash          │
                        │   - Batches operations      │
                        └──────────────┬──────────────┘
                                       │
              ┌────────────────────────┼────────────────────────┐
              │                        │                        │
      ┌───────▼────────┐      ┌───────▼────────┐      ┌───────▼────────┐
      │  Shard 0       │      │  Shard 1       │      │  Shard N-1     │
      │  - Posting List│      │  - Posting List│      │  - Posting List│
      │  - Fast Lane   │      │  - Fast Lane   │      │  - Fast Lane   │
      │  - Slow Lane   │      │  - Slow Lane   │      │  - Slow Lane   │
      └────────────────┘      └────────────────┘      └────────────────┘
  ```

  ## Key Features

  1. **Deterministic Sharding**: Same routing key always goes to same shard
  2. **Parallel Processing**: Different shards handle requests concurrently
  3. **Batching**: Groups operations by shard to amortize overhead
  4. **Load Balancing**: Hash function distributes shapes evenly

  ## Shard Count Selection

  The number of shards should balance:
  - **Too few**: Limited parallelism, contention on popular shards
  - **Too many**: Overhead from coordination, memory fragmentation

  Recommended: `max(32, 4 * :erlang.system_info(:schedulers_online))`

  ## Performance Characteristics

  - Shape registration: O(1) - hash to find shard, insert to posting list
  - Routing lookup (fast lane): O(1) - hash to find shard, ETS lookup
  - Routing lookup (slow lane): O(slow_shapes_in_shard) - only eval shapes in this shard
  - Memory: ~24 bytes per posting + shape struct overhead
  - Parallelism: Up to N shards can process records concurrently

  ## Example

      # Create router with 32 shards
      router = ShardedRouter.new(num_shards: 32)

      # Register shapes
      router = ShardedRouter.add_shape(router, shape1)
      router = ShardedRouter.add_shape(router, shape2)

      # Route a record
      record = %{"id" => "42", "name" => "Alice"}
      affected = ShardedRouter.affected_shapes(router, "users", record)
      #=> [shape_id1, shape_id2]
  """

  alias Electric.Shapes.RouterPrototype.{RouterShard, CompiledShape}

  defstruct [
    :num_shards,
    :shards,
    :shape_to_shard,
    :stats
  ]

  @type shape_id :: non_neg_integer()
  @type table_name :: String.t()

  @type t :: %__MODULE__{
          num_shards: pos_integer(),
          shards: %{non_neg_integer() => RouterShard.t()},
          shape_to_shard: %{shape_id() => non_neg_integer()},
          stats: map()
        }

  @doc """
  Creates a new sharded router.

  ## Options

  - `:num_shards` - Number of shards (default: auto-calculated from CPU count)

  ## Examples

      # Auto-calculate shard count
      ShardedRouter.new()

      # Explicit shard count
      ShardedRouter.new(num_shards: 64)
  """
  @spec new(keyword()) :: t()
  def new(opts \\ []) do
    num_shards = Keyword.get(opts, :num_shards, default_num_shards())

    shards =
      for i <- 0..(num_shards - 1), into: %{} do
        {i, RouterShard.new(shard_id: i)}
      end

    %__MODULE__{
      num_shards: num_shards,
      shards: shards,
      shape_to_shard: %{},
      stats: %{
        shapes_added: 0,
        shapes_removed: 0,
        lookups: 0,
        fast_lane_hits: 0,
        slow_lane_evaluations: 0,
        shard_distribution: for(i <- 0..(num_shards - 1), into: %{}, do: {i, 0})
      }
    }
  end

  @doc """
  Adds a shape to the router.

  The shape is assigned to a shard based on its routing key.
  """
  @spec add_shape(t(), CompiledShape.t()) :: t()
  def add_shape(router, %CompiledShape{} = shape) do
    # Determine which shard should handle this shape
    shard_id = assign_shard(router, shape)

    # Add shape to the shard
    shard = Map.fetch!(router.shards, shard_id)
    updated_shard = RouterShard.add_shape(shard, shape)

    # Update router state
    shards = Map.put(router.shards, shard_id, updated_shard)
    shape_to_shard = Map.put(router.shape_to_shard, shape.id, shard_id)

    # Update stats
    stats =
      router.stats
      |> Map.update!(:shapes_added, &(&1 + 1))
      |> update_in([:shard_distribution, shard_id], &(&1 + 1))

    %{router | shards: shards, shape_to_shard: shape_to_shard, stats: stats}
  end

  @doc """
  Adds multiple shapes in batch.

  More efficient than individual adds for bulk registration.
  """
  @spec add_shapes(t(), [CompiledShape.t()]) :: t()
  def add_shapes(router, shapes) do
    Enum.reduce(shapes, router, fn shape, acc ->
      add_shape(acc, shape)
    end)
  end

  @doc """
  Removes a shape from the router.
  """
  @spec remove_shape(t(), shape_id()) :: t()
  def remove_shape(router, shape_id) do
    case Map.get(router.shape_to_shard, shape_id) do
      nil ->
        router

      shard_id ->
        # Remove from shard
        shard = Map.fetch!(router.shards, shard_id)
        updated_shard = RouterShard.remove_shape(shard, shape_id)

        # Update router state
        shards = Map.put(router.shards, shard_id, updated_shard)
        shape_to_shard = Map.delete(router.shape_to_shard, shape_id)

        # Update stats
        stats =
          router.stats
          |> Map.update!(:shapes_removed, &(&1 + 1))
          |> update_in([:shard_distribution, shard_id], &(&1 - 1))

        %{router | shards: shards, shape_to_shard: shape_to_shard, stats: stats}
    end
  end

  @doc """
  Finds all shapes affected by a record change.

  This is the core routing operation, optimized for the common case of
  "write to 0-1 shapes".

  ## Options

  - `:early_exit` - Stop after finding first match (default: false)
  - `:refs_fun` - Function to get refs for WHERE evaluation (required for slow lane)

  ## Algorithm

  1. **Determine target shards**: For each field in the record, hash to find shards
  2. **Parallel lookup**: Query all relevant shards concurrently (in real GenServer impl)
  3. **Merge results**: Combine and deduplicate shape IDs

  ## Performance

  - **Fast lane only**: O(fields * shards) = O(1) for bounded field count
  - **With slow lane**: O(fields * shards + slow_shapes_per_shard)
  - **Early exit**: Returns on first match, often O(1)
  """
  @spec affected_shapes(t(), table_name(), map(), keyword()) :: [shape_id()]
  def affected_shapes(router, table, record, opts \\ []) do
    early_exit = Keyword.get(opts, :early_exit, false)

    # Update lookup stats
    router_with_stats = update_in(router.stats[:lookups], &(&1 + 1))

    # Determine which shards might have matches
    # For each field in the record, hash to find relevant shard(s)
    target_shards = determine_target_shards(router_with_stats, table, record)

    # Query each shard (in real impl, these would be concurrent GenServer calls)
    results =
      Enum.reduce_while(target_shards, [], fn shard_id, acc ->
        shard = Map.fetch!(router_with_stats.shards, shard_id)
        matches = RouterShard.affected_shapes(shard, table, record, opts)

        if early_exit and matches != [] do
          {:halt, matches}
        else
          {:cont, acc ++ matches}
        end
      end)

    # Deduplicate (a record might match multiple shards)
    Enum.uniq(results)
  end

  @doc """
  Batch version of affected_shapes for multiple records.

  Processes a list of records and returns a map of record_index → [shape_ids].
  More efficient than individual calls because it can batch per-shard operations.

  ## Example

      records = [
        %{"id" => "1", "status" => "active"},
        %{"id" => "2", "status" => "inactive"}
      ]

      ShardedRouter.affected_shapes_batch(router, "users", records)
      #=> %{
      #     0 => [1, 5],    # Record 0 matches shapes 1 and 5
      #     1 => [3]        # Record 1 matches shape 3
      #   }
  """
  @spec affected_shapes_batch(t(), table_name(), [map()], keyword()) :: %{
          non_neg_integer() => [shape_id()]
        }
  def affected_shapes_batch(router, table, records, opts \\ []) do
    # Group records by target shards to batch shard operations
    records_by_shard =
      records
      |> Enum.with_index()
      |> Enum.group_by(fn {record, _idx} ->
        determine_target_shards(router, table, record)
      end)

    # Process each shard's batch
    for {shard_ids, records_with_idx} <- records_by_shard,
        shard_id <- shard_ids,
        {record, idx} <- records_with_idx,
        reduce: %{} do
      acc ->
        shard = Map.fetch!(router.shards, shard_id)
        matches = RouterShard.affected_shapes(shard, table, record, opts)
        Map.put(acc, idx, matches)
    end
  end

  @doc """
  Returns comprehensive statistics about the router.
  """
  @spec stats(t()) :: map()
  def stats(router) do
    shard_stats =
      for {shard_id, shard} <- router.shards, into: %{} do
        {shard_id, RouterShard.stats(shard)}
      end

    # Aggregate stats
    total_shapes = Enum.sum(for {_, s} <- shard_stats, do: s.total_shapes)
    total_fast_lane = Enum.sum(for {_, s} <- shard_stats, do: s.fast_lane_count)
    total_slow_lane = Enum.sum(for {_, s} <- shard_stats, do: s.slow_lane_count)

    Map.merge(router.stats, %{
      num_shards: router.num_shards,
      total_shapes: total_shapes,
      total_fast_lane_shapes: total_fast_lane,
      total_slow_lane_shapes: total_slow_lane,
      fast_lane_percentage:
        if(total_shapes > 0, do: Float.round(total_fast_lane / total_shapes * 100, 2), else: 0),
      avg_shapes_per_shard:
        if(router.num_shards > 0, do: Float.round(total_shapes / router.num_shards, 2), else: 0),
      shard_stats: shard_stats
    })
  end

  # Assigns a shape to a shard based on its routing key
  defp assign_shard(router, shape) do
    case CompiledShape.routing_key(shape) do
      {:ok, routing_key} ->
        # Hash routing key to determine shard
        :erlang.phash2(routing_key, router.num_shards)

      :error ->
        # No routing key - assign to all shards (or a designated "slow" shard)
        # For now, use shard 0 for shapes without routing keys
        0
    end
  end

  # Determines which shards might match a record
  # Returns a list of shard IDs to query
  defp determine_target_shards(router, _table, record) do
    # For each field-value pair in the record, hash to find shard
    shards =
      for {field, value} <- record do
        routing_key = {field, value}
        :erlang.phash2(routing_key, router.num_shards)
      end

    # Also include shard 0 (slow lane catch-all)
    [0 | shards]
    |> Enum.uniq()
  end

  # Calculates default number of shards based on CPU count
  defp default_num_shards do
    schedulers = :erlang.system_info(:schedulers_online)
    max(32, 4 * schedulers)
  end
end
