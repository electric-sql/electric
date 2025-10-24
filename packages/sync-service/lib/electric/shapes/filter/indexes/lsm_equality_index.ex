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

  **CRITICAL**: Lookups hit the native index (NIF), NOT BEAM maps.
  BEAM only holds residual predicates (additional WHERE clauses beyond equality).

  The index is partitioned into lanes (default 64) using jump consistent hash.
  Each lane has:
  - One mutable overlay (fast hash table for recent changes)
  - Multiple immutable segments (MPH-based, levels L0, L1, L2...)

  Lookup path:
  1. Hash key → lane (jump consistent hash)
  2. NIF lookup: overlay → L0 → L1 → L2
  3. Apply residual predicates (if any) in BEAM
  4. Return matching shape IDs

  When overlay exceeds threshold, it's compacted into a new segment.

  ## Memory Model

  - Routing data (value → shape_id): **Native memory** (overlay + segments)
  - Residual predicates: **BEAM memory** (only when shapes have additional WHERE clauses)
  - Total BEAM footprint: O(shapes with residuals), NOT O(values)

  ## Usage

      # Create a new index
      index = LsmEqualityIndex.new(:int4, num_lanes: 64)

      # Add a shape
      index = Index.add_shape(index, 42, shape_id, and_where)

      # Lookup affected shapes (hits NIF)
      shapes = Index.affected_shapes(index, "user_id", %{"user_id" => "42"}, shapes_map)

  ## Prototype Limitations

  This is a prototype for evaluation and discussion. Production implementation would need:
  - True RecSplit or BBHash MPH (currently uses simple HashMap)
  - Memory-mapped segment files for persistence
  - Background compaction worker pool (DirtyCpu schedulers)
  - Atomic manifest swaps for zero-downtime updates
  - xor-filters for miss-heavy workloads
  - Comprehensive error handling and monitoring
  - Batch lookup API for transaction routing
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
    # ONLY store residual predicates (shapes with additional WHERE clauses)
    # NOT per-value routing data (that's in the NIF)
    :residuals
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
      residuals: %{}  # shape_id => residual_predicate
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

    # Returns: {:found, [shape_id, ...]} | :miss
    def nif_lookup(_ref, _key), do: :erlang.nif_error(:nif_not_loaded)

    # Batch lookup for transaction routing (amortizes NIF overhead)
    # Returns: [result, ...] where result is {:found, [shape_id, ...]} | :miss
    def nif_lookup_many(_ref, _keys), do: :erlang.nif_error(:nif_not_loaded)

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
    # Use NIF for emptiness check
    def empty?(%LsmEqualityIndex{nif_ref: nif_ref}), do: LsmEqualityIndex.Nif.nif_is_empty(nif_ref)

    def add_shape(%LsmEqualityIndex{} = index, value, shape_id, and_where) do
      # Insert into NIF index (this is the source of truth)
      key = value_to_key(value)
      :ok = LsmEqualityIndex.Nif.nif_insert(index.nif_ref, key, shape_id)

      # Only store residuals in BEAM (shapes with additional WHERE clauses)
      new_residuals =
        case and_where do
          nil ->
            # No residual, don't store anything in BEAM
            index.residuals

          residual_predicate ->
            # Store residual checker for this shape
            # In production, precompile AST to fast predicate
            Map.put(index.residuals, shape_id, residual_predicate)
        end

      # Maybe trigger compaction
      maybe_compact(index)

      %{index | residuals: new_residuals}
    end

    def remove_shape(%LsmEqualityIndex{} = index, value, shape_id, _and_where) do
      # Remove from NIF index
      key = value_to_key(value)
      :ok = LsmEqualityIndex.Nif.nif_remove(index.nif_ref, key, shape_id)

      # Remove residual if it exists
      new_residuals = Map.delete(index.residuals, shape_id)

      %{index | residuals: new_residuals}
    end

    # CRITICAL: This is the hot path - must go through NIF, not BEAM maps
    def affected_shapes(%LsmEqualityIndex{} = index, field, record, shapes) do
      value = value_from_record(record, field, index.type)
      key = value_to_key(value)

      # Lookup in NIF (overlay → segments)
      case LsmEqualityIndex.Nif.nif_lookup(index.nif_ref, key) do
        {:found, shape_ids} ->
          # Apply residual predicates if any
          Enum.reduce(shape_ids, MapSet.new(), fn shape_id, acc ->
            if residual_ok?(shape_id, record, shapes, index.residuals) do
              MapSet.put(acc, shape_id)
            else
              acc
            end
          end)

        :miss ->
          MapSet.new()
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

    # Check residual predicate for a shape
    defp residual_ok?(shape_id, record, shapes, residuals) do
      case Map.get(residuals, shape_id) do
        nil ->
          # No residual, shape matches
          true

        residual_predicate ->
          # Evaluate residual (simplified for prototype)
          # Production would use precompiled predicate
          case Map.get(shapes, shape_id) do
            nil ->
              # Shape not in shapes map, skip
              false

            shape ->
              # Use WhereCondition to evaluate residual
              # This is a simplification; production would optimize this
              condition = WhereCondition.new() |> WhereCondition.add_shape(shape_id, residual_predicate)
              affected = WhereCondition.affected_shapes(condition, record, shapes)
              MapSet.member?(affected, shape_id)
          end
      end
    end

    # Use NIF for shape enumeration
    def all_shape_ids(%LsmEqualityIndex{nif_ref: nif_ref}) do
      LsmEqualityIndex.Nif.nif_all_shape_ids(nif_ref)
      |> MapSet.new()
    end

    # Convert a value to a binary key for the NIF
    # NOTE: Production hashing (SipHash-2-4) happens in the NIF
    # This BEAM conversion is just a convenience for the prototype
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
