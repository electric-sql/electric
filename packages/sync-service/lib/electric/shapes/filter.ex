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
  alias Electric.Shapes.Filter
  alias Electric.Shapes.Filter.WhereCondition
  alias Electric.Shapes.Shape
  alias Electric.Telemetry.OpenTelemetry

  require Logger

  defstruct [
    :shapes_table,
    :tables_table,
    :where_cond_table,
    :eq_index_table,
    :incl_index_table,
    :refs_fun
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
      refs_fun: Keyword.get(opts, :refs_fun, fn _shape -> %{} end)
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
  Add a shape for the filter to track.

  The `shape_id` can be any term you like to identify the shape. Whatever you use will be returned
  by `affected_shapes/2` when the shape is affected by a change.
  """
  @spec add_shape(Filter.t(), shape_id(), Shape.t()) :: Filter.t()
  def add_shape(%Filter{} = filter, shape_id, shape) do
    if has_shape?(filter, shape_id), do: raise("duplicate shape #{shape_id}")

    # Store shape metadata
    :ets.insert(filter.shapes_table, {shape_id, shape})

    # Get or create WhereCondition for the table
    table_name = shape.root_table
    where_cond_id = get_or_create_table_condition(filter, table_name)

    # Add shape to the WhereCondition
    WhereCondition.add_shape(filter, where_cond_id, shape_id, shape.where)

    filter
  end

  defp get_or_create_table_condition(filter, table_name) do
    case :ets.lookup(filter.tables_table, table_name) do
      [] ->
        # Create new WhereCondition
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

    # Remove shape from WhereCondition, clean up table entry if condition deleted
    case WhereCondition.remove_shape(filter, where_cond_id, shape_id, shape.where) do
      :deleted -> :ets.delete(filter.tables_table, table_name)
      :ok -> :ok
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
      rescue
        error ->
          Logger.error("""
          Unexpected error in Filter.affected_shapes:
          #{Exception.format(:error, error, __STACKTRACE__)}
          """)

          OpenTelemetry.record_exception(:error, error, __STACKTRACE__)

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
    case :ets.lookup(filter.tables_table, table_name) do
      [] ->
        MapSet.new()

      [{_, where_cond_id}] ->
        WhereCondition.affected_shapes(filter, where_cond_id, record, filter.refs_fun)
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
end
