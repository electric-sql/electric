defmodule Electric.Shapes.Filter do
  @moduledoc """
  Responsible for knowing which shapes are affected by a change.

  `affected_shapes(filter, change)` will return a set of IDs for the shapes that are affected by the change
  considering all the shapes that have been added to the filter using `add_shape/3`.


  The `Filter` module keeps track of what tables are referenced by the shapes and changes and delegates
  the table specific logic to the `Filter.WhereCondition` module.

  Data is stored in ETS tables (outside the process heap) to avoid GC pressure with large numbers of shapes.
  """

  alias Electric.Replication.Changes
  alias Electric.Replication.Changes.DeletedRecord
  alias Electric.Replication.Changes.NewRecord
  alias Electric.Replication.Changes.Relation
  alias Electric.Replication.Changes.TruncatedRelation
  alias Electric.Replication.Changes.UpdatedRecord
  alias Electric.Replication.Eval
  alias Electric.Replication.Eval.Parser.Func
  alias Electric.Replication.Eval.Parser.Ref
  alias Electric.Replication.Eval.Walker
  alias Electric.Shapes.Consumer.Materializer
  alias Electric.Shapes.Filter
  alias Electric.Shapes.Filter.WhereCondition
  alias Electric.Shapes.Shape
  alias Electric.Shapes.WhereClause
  alias Electric.Telemetry.OpenTelemetry

  require Logger

  defstruct [
    :shapes_table,
    :tables_table,
    :where_cond_table,
    :eq_index_table,
    :incl_index_table,
    :refs_fun,
    :stack_id,
    # {relation, field_name} -> [{dep_handle, field_type}]
    :sublink_field_table,
    # dep_handle -> MapSet(outer_shape_ids)
    :sublink_dep_table,
    # MapSet of shape_ids registered in the inverted index — enables O(1) membership
    # check in the hot path without loading the shape or touching dep ETS tables.
    :sublink_shapes_set
  ]

  @type t :: %Filter{}
  @type shape_id :: any()

  @spec new(keyword()) :: Filter.t()
  def new(opts \\ []) do
    %Filter{
      shapes_table: :ets.new(:filter_shapes, [:set, :private]),
      tables_table: :ets.new(:filter_tables, [:set, :private]),
      where_cond_table: :ets.new(:filter_where, [:set, :private]),
      eq_index_table: :ets.new(:filter_eq, [:set, :private]),
      incl_index_table: :ets.new(:filter_incl, [:set, :private]),
      refs_fun: Keyword.get(opts, :refs_fun, fn _shape -> %{} end),
      stack_id: Keyword.get(opts, :stack_id),
      sublink_field_table: :ets.new(:filter_sublink_field, [:set, :private]),
      sublink_dep_table: :ets.new(:filter_sublink_dep, [:set, :private]),
      sublink_shapes_set: MapSet.new()
    }
  end

  @spec has_shape?(t(), shape_id()) :: boolean()
  def has_shape?(%Filter{shapes_table: table}, shape_handle) do
    :ets.member(table, shape_handle)
  end

  @spec active_shapes(t()) :: [shape_id()]
  def active_shapes(%Filter{shapes_table: table}) do
    :ets.select(table, [{{:"$1", :_}, [], [:"$1"]}])
  end

  @doc """
  Returns `true` when ShapeLogCollector can route the shape through any of its
  indexes instead of relying exclusively on `other_shapes` scans.

  This includes both the primary equality/inclusion indexes and the sublink
  inverted index used for dependency-driven subquery routing.
  """
  @spec indexed_shape?(Shape.t()) :: boolean()
  def indexed_shape?(%Shape{} = shape) do
    WhereCondition.indexed_where?(shape.where) or
      (Shape.dependency_handles_known?(shape) and
         map_size(extract_sublink_fields(shape.where)) > 0)
  end

  @doc """
  Add a shape for the filter to track.

  The `shape_id` can be any term you like to identify the shape. Whatever you use will be returned
  by `affected_shapes/2` when the shape is affected by a change.
  """
  @spec add_shape(Filter.t(), shape_id(), Shape.t()) :: Filter.t()
  def add_shape(%Filter{} = filter, shape_id, shape) do
    if has_shape?(filter, shape_id), do: raise("duplicate shape #{shape_id}")

    :ets.insert(filter.shapes_table, {shape_id, shape})

    where_cond_id = get_or_create_table_condition(filter, shape.root_table)

    WhereCondition.add_shape(filter, where_cond_id, shape_id, shape.where)

    # Only register in the inverted index when the WHERE is non-optimisable
    # (landed in other_shapes). Indexed dep shapes use the equality/inclusion path.
    if shape.shape_dependencies_handles != [] and
         in_other_shapes?(filter, where_cond_id, shape_id) do
      register_sublink_shape(filter, shape_id, shape)
    else
      filter
    end
  end

  defp get_or_create_table_condition(filter, table_name) do
    case :ets.lookup(filter.tables_table, table_name) do
      [] ->
        where_cond_id = make_ref()
        WhereCondition.init(filter, where_cond_id)
        :ets.insert(filter.tables_table, {table_name, where_cond_id})
        where_cond_id

      [{_, where_cond_id}] ->
        where_cond_id
    end
  end

  @doc """
  Remove a shape from the filter.
  """
  @spec remove_shape(Filter.t(), shape_id()) :: Filter.t()
  def remove_shape(%Filter{} = filter, shape_id) do
    [{_, shape}] = :ets.lookup(filter.shapes_table, shape_id)
    table_name = shape.root_table

    [{_, where_cond_id}] = :ets.lookup(filter.tables_table, table_name)

    case WhereCondition.remove_shape(filter, where_cond_id, shape_id, shape.where) do
      :deleted -> :ets.delete(filter.tables_table, table_name)
      :ok -> :ok
    end

    filter =
      if registered_in_inverted_index?(filter, shape_id) do
        unregister_sublink_shape(filter, shape_id, shape)
      else
        filter
      end

    :ets.delete(filter.shapes_table, shape_id)

    filter
  end

  @doc """
  Returns the shape IDs for all shapes that have been added to the filter
  that are affected by the given change.
  """
  @spec affected_shapes(Filter.t(), Changes.change() | Relation.t()) ::
          MapSet.t(shape_id())
  def affected_shapes(%Filter{} = filter, change) do
    OpenTelemetry.timed_fun("filter.affected_shapes.duration_µs", fn ->
      try do
        shapes_affected_by_change(filter, change)
      catch
        kind, error ->
          Logger.error("""
          Unexpected error in Filter.affected_shapes:
          #{Exception.format(kind, error, __STACKTRACE__)}
          """)

          OpenTelemetry.record_exception(kind, error, __STACKTRACE__)

          # We can't tell which shapes are affected, the safest thing to do is return all shapes
          all_shape_ids(filter)
      end
    end)
  end

  defp shapes_affected_by_change(%Filter{} = filter, %Relation{} = relation) do
    # Check all shapes is all tables because the table may have been renamed
    for shape_id <- all_shape_ids(filter),
        [{_, shape}] = :ets.lookup(filter.shapes_table, shape_id),
        Shape.is_affected_by_relation_change?(shape, relation),
        into: MapSet.new() do
      shape_id
    end
  end

  defp shapes_affected_by_change(%Filter{} = filter, %NewRecord{
         relation: relation,
         record: record
       }) do
    shapes_affected_by_record(filter, relation, record)
  end

  defp shapes_affected_by_change(%Filter{} = filter, %DeletedRecord{
         relation: relation,
         old_record: record
       }) do
    shapes_affected_by_record(filter, relation, record)
  end

  defp shapes_affected_by_change(%Filter{} = filter, %UpdatedRecord{relation: relation} = change) do
    MapSet.union(
      shapes_affected_by_record(filter, relation, change.record),
      shapes_affected_by_record(filter, relation, change.old_record)
    )
  end

  defp shapes_affected_by_change(%Filter{} = filter, %TruncatedRelation{relation: table_name}) do
    shape_ids_for_table(filter, table_name)
  end

  defp shapes_affected_by_record(filter, table_name, record) do
    where_cond_results =
      case :ets.lookup(filter.tables_table, table_name) do
        [] -> MapSet.new()
        [{_, where_cond_id}] -> WhereCondition.affected_shapes(filter, where_cond_id, record)
      end

    MapSet.union(where_cond_results, sublink_affected_shapes(filter, table_name, record))
  end

  # Inverted-index lookup for dep shapes that live in other_shapes.
  # Returns affected outer shapes in O(fields × dep_handles_per_field) instead
  # of the O(N×D) loop that WhereCondition.other_shapes_affected would do.
  defp sublink_affected_shapes(%Filter{stack_id: nil}, _table_name, _record), do: MapSet.new()

  defp sublink_affected_shapes(filter, table_name, record) do
    link_values_table = Materializer.link_values_table_name(filter.stack_id)

    candidates =
      Enum.reduce(record, MapSet.new(), fn {field_name, string_value}, acc ->
        case :ets.lookup(filter.sublink_field_table, {table_name, field_name}) do
          [] ->
            acc

          [{_, dep_infos}] ->
            Enum.reduce(dep_infos, acc, fn {dep_handle, field_type}, inner_acc ->
              if record_matches_dep?(
                   link_values_table,
                   dep_handle,
                   field_type,
                   string_value
                 ) do
                union_shapes_for_dep(filter, dep_handle, inner_acc)
              else
                inner_acc
              end
            end)
        end
      end)

    OpenTelemetry.add_span_attributes("filter.sublink_candidates_count": MapSet.size(candidates))

    # Re-evaluate full WHERE for candidates to handle any non-sublink conditions
    OpenTelemetry.timed_fun("filter.sublink_reeval.duration_µs", fn ->
      for shape_id <- candidates,
          shape = get_shape(filter, shape_id),
          not is_nil(shape),
          WhereClause.includes_record?(shape.where, record, filter.refs_fun.(shape)),
          into: MapSet.new() do
        shape_id
      end
    end)
  rescue
    # The named ETS table may not exist during a ConsumerRegistry restart window.
    # Return empty rather than propagating to the broad "return all shapes" fallback.
    ArgumentError -> MapSet.new()
  end

  # Returns true if the record's field value is present in the dep handle's
  # cached link values, or if no cached values exist yet (optimistic inclusion).
  defp record_matches_dep?(link_values_table, dep_handle, _field_type, nil = _string_value) do
    # Null field values never match link values, but we still include
    # candidates when no cache exists (materializer not started).
    :ets.lookup(link_values_table, dep_handle) == []
  end

  defp record_matches_dep?(link_values_table, dep_handle, field_type, string_value) do
    case :ets.lookup(link_values_table, dep_handle) do
      [] ->
        # No cached values yet (materializer not started) -- include as candidate
        # so the re-eval via refs_fun handles it correctly.
        true

      [{_, linked_values}] ->
        case Eval.Env.parse_const(Eval.Env.new(), string_value, field_type) do
          {:ok, parsed_value} -> MapSet.member?(linked_values, parsed_value)
          _ -> false
        end
    end
  end

  defp union_shapes_for_dep(filter, dep_handle, acc) do
    case :ets.lookup(filter.sublink_dep_table, dep_handle) do
      [{_, shape_ids}] -> MapSet.union(acc, shape_ids)
      [] -> acc
    end
  end

  defp all_shape_ids(%Filter{} = filter) do
    :ets.foldl(
      fn {_table_name, where_cond_id}, acc ->
        MapSet.union(acc, WhereCondition.all_shape_ids(filter, where_cond_id))
      end,
      MapSet.new(),
      filter.tables_table
    )
  end

  defp shape_ids_for_table(%Filter{} = filter, table_name) do
    case :ets.lookup(filter.tables_table, table_name) do
      [] -> MapSet.new()
      [{_, where_cond_id}] -> WhereCondition.all_shape_ids(filter, where_cond_id)
    end
  end

  @doc """
  Get a shape by its ID. Used internally for where clause evaluation.
  """
  def get_shape(%Filter{shapes_table: table}, shape_id) do
    case :ets.lookup(table, shape_id) do
      [{_, shape}] -> shape
      [] -> nil
    end
  end

  @doc """
  Returns true if a dep shape is registered in the sublink inverted index.

  Only dep shapes in top-level other_shapes (non-optimisable WHERE) are registered.
  Dep shapes that go through an equality index end up in nested other_shapes and
  must be evaluated normally by `other_shapes_affected`.
  """
  @spec registered_in_inverted_index?(t(), shape_id()) :: boolean()
  def registered_in_inverted_index?(%Filter{sublink_shapes_set: set}, shape_id),
    do: MapSet.member?(set, shape_id)

  defp in_other_shapes?(filter, where_cond_id, shape_id) do
    case :ets.lookup(filter.where_cond_table, where_cond_id) do
      [{_, {_index_keys, other_shapes}}] -> Map.has_key?(other_shapes, shape_id)
      [] -> false
    end
  end

  # Walks the WHERE expression tree and returns a map of
  # %{sublink_index => {field_name, field_type}} for each
  # sublink_membership_check node with a simple field reference on the left.
  # Returns an empty map for nil or complex (RowExpr) left-hand sides.
  defp extract_sublink_fields(nil), do: %{}

  defp extract_sublink_fields(%{eval: eval}) do
    Walker.reduce!(
      eval,
      fn
        %Func{
          name: "sublink_membership_check",
          args: [
            %Ref{path: [field_name], type: field_type},
            %Ref{path: ["$sublink", n_str]}
          ]
        },
        acc,
        _ ->
          {:ok, Map.put(acc, String.to_integer(n_str), {field_name, field_type})}

        _, acc, _ ->
          {:ok, acc}
      end,
      %{}
    )
  end

  defp register_sublink_shape(filter, shape_id, shape) do
    sublink_fields = extract_sublink_fields(shape.where)

    for {sublink_index, {field_name, field_type}} <- sublink_fields do
      dep_handle = Enum.at(shape.shape_dependencies_handles, sublink_index)

      field_key = {shape.root_table, field_name}

      existing_entries =
        case :ets.lookup(filter.sublink_field_table, field_key) do
          [{_, entries}] -> entries
          [] -> []
        end

      unless Enum.any?(existing_entries, fn {h, _} -> h == dep_handle end) do
        :ets.insert(
          filter.sublink_field_table,
          {field_key, [{dep_handle, field_type} | existing_entries]}
        )
      end

      existing_shapes =
        case :ets.lookup(filter.sublink_dep_table, dep_handle) do
          [{_, shapes}] -> shapes
          [] -> MapSet.new()
        end

      :ets.insert(filter.sublink_dep_table, {dep_handle, MapSet.put(existing_shapes, shape_id)})
    end

    # RowExpr subqueries (e.g. `(a, b) IN (SELECT ...)`) produce no indexable fields;
    # those shapes stay in other_shapes and must not be marked as indexed.
    if map_size(sublink_fields) > 0 do
      %{filter | sublink_shapes_set: MapSet.put(filter.sublink_shapes_set, shape_id)}
    else
      filter
    end
  end

  defp unregister_sublink_shape(filter, shape_id, shape) do
    sublink_fields = extract_sublink_fields(shape.where)

    for {sublink_index, {field_name, _field_type}} <- sublink_fields do
      dep_handle = Enum.at(shape.shape_dependencies_handles, sublink_index)

      dep_now_empty? =
        case :ets.lookup(filter.sublink_dep_table, dep_handle) do
          [{_, shapes}] ->
            new_shapes = MapSet.delete(shapes, shape_id)

            if MapSet.size(new_shapes) == 0 do
              :ets.delete(filter.sublink_dep_table, dep_handle)
              true
            else
              :ets.insert(filter.sublink_dep_table, {dep_handle, new_shapes})
              false
            end

          [] ->
            true
        end

      if dep_now_empty? do
        field_key = {shape.root_table, field_name}

        case :ets.lookup(filter.sublink_field_table, field_key) do
          [{_, entries}] ->
            new_entries = Enum.reject(entries, fn {h, _} -> h == dep_handle end)

            if new_entries == [] do
              :ets.delete(filter.sublink_field_table, field_key)
            else
              :ets.insert(filter.sublink_field_table, {field_key, new_entries})
            end

          [] ->
            :ok
        end
      end
    end

    %{filter | sublink_shapes_set: MapSet.delete(filter.sublink_shapes_set, shape_id)}
  end
end
