defmodule Electric.Shapes.Filter.Indexes.LsmEqualityIndex do
  @moduledoc """
  LSM-based equality index for high-performance route lookups.

  This is a prototype implementation that uses an LSM-tree style index with:
  - Minimal Perfect Hash (MPH) functions for immutable segments
  - Fast mutable overlay for recent changes
  - Lane-based partitioning to bound read amplification
  - Memory-mapped segment storage
  - Atomic manifest swaps

  ## Design Goals

  - **Latency**: 10-20μs per lookup
  - **Memory**: ~12-13 bytes/key (vs ~20+ for standard hash maps)
  - **Scale**: Support millions of keys
  - **Churn**: Efficient handling of constant add/remove operations
  - **Multi-tenant**: Easy backup, migration, zero-downtime updates

  ## Architecture

  The index is partitioned into lanes (default 64) using jump consistent hash.
  Each lane has:
  - One mutable overlay (fast hash table for recent changes)
  - Multiple immutable segments (MPH-based, levels L0, L1, L2...)

  Lookups probe:
  1. Overlay first (newest data)
  2. Segments from newest to oldest

  When overlay exceeds threshold, it's compacted into a new segment.

  ## Usage

      # Create a new index
      index = LsmEqualityIndex.new(:int4, num_lanes: 64)

      # Add a shape
      index = Index.add_shape(index, 42, shape_id, and_where)

      # Lookup affected shapes
      shapes = Index.affected_shapes(index, "user_id", %{"user_id" => "42"}, shapes_map)

  ## Prototype Limitations

  This is a prototype for evaluation and discussion. Production implementation would need:
  - True RecSplit or BBHash MPH (currently uses simple HashMap)
  - Memory-mapped segment files for persistence
  - Background compaction worker pool
  - Atomic manifest swaps for zero-downtime updates
  - xor-filters for miss-heavy workloads
  - Comprehensive error handling and monitoring
  """

  alias Electric.Replication.Eval.Env
  alias Electric.Shapes.Filter.Index
  alias Electric.Shapes.Filter.Indexes.LsmEqualityIndex
  alias Electric.Shapes.Filter.WhereCondition

  @default_num_lanes 64
  @default_compaction_threshold 10_000

  defstruct [
    :type,
    :nif_ref,
    :num_lanes,
    :compaction_threshold,
    # Map of value -> WhereCondition (same as EqualityIndex)
    # This allows us to support nested where conditions
    :value_to_condition,
    # Track which values map to which shape IDs for reverse lookups
    :shape_to_values
  ]

  @doc """
  Create a new LSM equality index.

  ## Options

  - `:num_lanes` - Number of lanes for partitioning (default: 64)
  - `:compaction_threshold` - Overlay size before compaction (default: 10,000)
  """
  def new(type, opts \\ []) do
    num_lanes = Keyword.get(opts, :num_lanes, @default_num_lanes)
    compaction_threshold = Keyword.get(opts, :compaction_threshold, @default_compaction_threshold)

    nif_ref = Nif.nif_new(num_lanes)

    %LsmEqualityIndex{
      type: type,
      nif_ref: nif_ref,
      num_lanes: num_lanes,
      compaction_threshold: compaction_threshold,
      value_to_condition: %{},
      shape_to_values: %{}
    }
  end

  @doc """
  Get statistics about the index.
  """
  def stats(%LsmEqualityIndex{nif_ref: nif_ref}) do
    Nif.nif_stats(nif_ref)
  end

  @doc """
  Manually trigger compaction if needed.
  """
  def compact(%LsmEqualityIndex{} = index) do
    Nif.nif_maybe_compact(index.nif_ref, index.compaction_threshold)
    index
  end

  # NIF module (defined inline for prototype)
  defmodule Nif do
    @moduledoc false
    use Rustler, otp_app: :electric, crate: "lsm_index_nif"

    # Placeholder implementations (will be replaced by NIF)
    def nif_new(_num_lanes), do: :erlang.nif_error(:nif_not_loaded)
    def nif_insert(_ref, _key, _shape_id), do: :erlang.nif_error(:nif_not_loaded)
    def nif_remove(_ref, _key, _shape_id), do: :erlang.nif_error(:nif_not_loaded)
    def nif_lookup(_ref, _key), do: :erlang.nif_error(:nif_not_loaded)
    def nif_all_shape_ids(_ref), do: :erlang.nif_error(:nif_not_loaded)
    def nif_is_empty(_ref), do: :erlang.nif_error(:nif_not_loaded)
    def nif_maybe_compact(_ref, _threshold), do: :erlang.nif_error(:nif_not_loaded)
    def nif_stats(_ref), do: :erlang.nif_error(:nif_not_loaded)
  end

  defmodule Stats do
    @moduledoc """
    Statistics about the LSM index.
    """
    defstruct [
      :num_lanes,
      :total_overlay_entries,
      :total_segment_entries,
      :total_segments,
      :total_entries
    ]
  end

  defimpl Index.Protocol, for: LsmEqualityIndex do
    def empty?(%LsmEqualityIndex{value_to_condition: values}), do: values == %{}

    def add_shape(%LsmEqualityIndex{} = index, value, shape_id, and_where) do
      # Store in value_to_condition map (same as EqualityIndex)
      new_value_to_condition =
        index.value_to_condition
        |> Map.put_new(value, WhereCondition.new())
        |> Map.update!(value, &WhereCondition.add_shape(&1, shape_id, and_where))

      # Track reverse mapping
      new_shape_to_values =
        Map.update(index.shape_to_values, shape_id, [value], fn values ->
          if value in values, do: values, else: [value | values]
        end)

      # Insert into NIF index
      # Convert value to binary key
      key = value_to_key(value)
      :ok = LsmEqualityIndex.Nif.nif_insert(index.nif_ref, key, shape_id)

      # Maybe trigger compaction
      maybe_compact(index)

      %{
        index
        | value_to_condition: new_value_to_condition,
          shape_to_values: new_shape_to_values
      }
    end

    def remove_shape(%LsmEqualityIndex{} = index, value, shape_id, and_where) do
      # Remove from value_to_condition map
      condition =
        index.value_to_condition
        |> Map.fetch!(value)
        |> WhereCondition.remove_shape(shape_id, and_where)

      new_value_to_condition =
        if WhereCondition.empty?(condition) do
          Map.delete(index.value_to_condition, value)
        else
          Map.put(index.value_to_condition, value, condition)
        end

      # Update reverse mapping
      new_shape_to_values =
        Map.update(index.shape_to_values, shape_id, [], fn values ->
          List.delete(values, value)
        end)
        |> Map.reject(fn {_k, v} -> v == [] end)

      # Remove from NIF index
      key = value_to_key(value)
      :ok = LsmEqualityIndex.Nif.nif_remove(index.nif_ref, key, shape_id)

      %{
        index
        | value_to_condition: new_value_to_condition,
          shape_to_values: new_shape_to_values
      }
    end

    def affected_shapes(%LsmEqualityIndex{} = index, field, record, shapes) do
      value = value_from_record(record, field, index.type)

      case Map.get(index.value_to_condition, value) do
        nil ->
          MapSet.new()

        condition ->
          WhereCondition.affected_shapes(condition, record, shapes)
      end
    end

    @env Env.new()
    defp value_from_record(record, field, type) do
      case Env.parse_const(@env, record[field], type) do
        {:ok, value} ->
          value

        :error ->
          raise RuntimeError,
            message: "Could not parse value for field #{inspect(field)} of type #{inspect(type)}"
      end
    end

    def all_shape_ids(%LsmEqualityIndex{value_to_condition: values}) do
      Enum.reduce(values, MapSet.new(), fn {_value, condition}, ids ->
        MapSet.union(ids, WhereCondition.all_shape_ids(condition))
      end)
    end

    # Convert a value to a binary key for the NIF
    defp value_to_key(value) when is_integer(value) do
      <<value::64-big>>
    end

    defp value_to_key(value) when is_binary(value) do
      value
    end

    defp value_to_key(value) when is_atom(value) do
      Atom.to_string(value)
    end

    defp value_to_key(value) do
      # Fallback: use term_to_binary
      :erlang.term_to_binary(value)
    end

    # Maybe trigger compaction if overlay is getting large
    defp maybe_compact(index) do
      stats = LsmEqualityIndex.Nif.nif_stats(index.nif_ref)

      if stats.total_overlay_entries >= index.compaction_threshold do
        LsmEqualityIndex.Nif.nif_maybe_compact(
          index.nif_ref,
          index.compaction_threshold
        )
      end
    end
  end
end
