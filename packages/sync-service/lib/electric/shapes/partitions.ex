defmodule Electric.Shapes.Partitions do
  @moduledoc ~S"""
  Keeps track of shapes defined on partitioned tables and re-writes
  transactions to send an equivalent change on the root partitioned table for
  every change to a partition of that table.
  """
  alias Electric.Postgres.Inspector
  alias Electric.Replication.Changes.Relation
  alias Electric.Replication.Changes.Transaction
  alias Electric.Replication.Changes.TruncatedRelation

  defstruct [:inspector, active: 0, partitions: %{}, partition_ownership: %{}]

  @type partition_table :: Electric.relation()
  @type root_table :: Electric.relation()
  @type shape_id :: term()
  @type t :: %__MODULE__{
          inspector: Inspector.inspector(),
          active: non_neg_integer(),
          partitions: %{partition_table() => root_table()},
          partition_ownership: %{Electric.relation() => MapSet.t(shape_id())}
        }
  @type options :: [{:inspector, Inspector.inspector()}]

  @spec new(options()) :: t()
  def new(opts) when is_list(opts) do
    {:ok, inspector} = Keyword.fetch(opts, :inspector)
    %__MODULE__{inspector: inspector}
  end

  @doc """
  Update the partition information table with the given shape.

  If the shape is  defined on a partitioned table (not a partition of that
  table) then this will expand the mapping function to add a change to the
  partition root for every change to a partition of that root.
  """
  @spec add_shape(t(), shape_id(), Electric.Shapes.Shape.t()) :: t()
  def add_shape(%__MODULE__{} = state, shape_id, shape) do
    case Inspector.load_relation_info(shape.root_table_id, state.inspector) do
      {:ok, relation} ->
        children = List.wrap(Map.get(relation, :children, []))

        state =
          state
          |> Map.update!(:partitions, fn partitions ->
            Enum.reduce(children, partitions, fn child, partitions ->
              Map.put(partitions, child, [shape.root_table])
            end)
          end)
          |> Map.update!(:partition_ownership, fn ownership ->
            [shape.root_table | children]
            |> Enum.reduce(ownership, fn relation, relation_ownership ->
              Map.update(
                relation_ownership,
                relation,
                MapSet.new([shape_id]),
                &MapSet.put(&1, shape_id)
              )
            end)
          end)
          |> update_active()

        {:ok, state}

      :table_not_found ->
        # tables that don't exist will be caught later in the stack (hard to
        # run a snapshot against a non-existent table)
        {:ok, state}

      {:error, :connection_not_available} ->
        {:error, :connection_not_available}

      {:error, reason} ->
        raise RuntimeError,
          message:
            "Unable to introspect table #{Electric.Utils.inspect_relation(shape.root_table)}: #{inspect(reason)}"
    end
  end

  @doc """
  Remove a shape that was previously added under the given id.

  If that shape was defined on a partitioned table, this will clean up the
  partition mapping table.
  """
  @spec remove_shape(t(), shape_id()) :: t()
  def remove_shape(%__MODULE__{} = state, shape_id) do
    state
    |> Map.update!(:partition_ownership, fn ownership ->
      Map.new(ownership, fn {relation, shape_ids} ->
        {relation, MapSet.delete(shape_ids, shape_id)}
      end)
    end)
    |> clean_up_partitions()
  end

  defp clean_up_partitions(state) do
    {empty, full} =
      Enum.split_with(state.partition_ownership, fn {_relation, shape_ids} ->
        Enum.empty?(shape_ids)
      end)

    remove_relations = Enum.map(empty, &elem(&1, 0))

    %{state | partition_ownership: Map.new(full)}
    |> Map.update!(:partitions, fn partitions ->
      Enum.reduce(remove_relations, partitions, &Map.delete(&2, &1))
    end)
    |> update_active()
  end

  defp update_active(state) do
    %{state | active: map_size(state.partitions)}
  end

  @doc """
  Handle relation changes from the replication stream,
  expanding changes to partitions into the partition root as appropriate.
  """
  @spec handle_relation(t(), Relation.t()) :: {:ok, t()} | {:error, :connection_not_available}
  def handle_relation(%__MODULE__{} = state, %Relation{} = relation) do
    table = table(relation)

    case Inspector.load_relation_info(relation.id, state.inspector) do
      {:ok, %{parent: {_, _} = parent}} ->
        # TODO: we should probabaly have a way to clean the inspector cache
        # just based on the relation, there's a chance that this results in
        # a query to pg just to then drop the info
        with {:ok, {parent_id, _}} <-
               Inspector.load_relation_oid(parent, state.inspector) do
          Inspector.clean(parent_id, state.inspector)
        end

        {:ok, state |> Map.update!(:partitions, &Map.put(&1, table, [parent])) |> update_active()}

      {:ok, _} ->
        {:ok, state}

      {:error, :connection_not_available} ->
        {:error, :connection_not_available}
    end
  end

  @doc """
  Handle transactions from the replication stream, updating the partition mapping as appropriate.
  """

  # no shapes on partitioned tables is probably the overwhelming majority of
  # cases, so let's shortcut to avoid churn
  @spec handle_transaction(t(), Transaction.t() | Relation.t()) ::
          {t(), Transaction.t() | Relation.t()}
  def handle_transaction(%__MODULE__{active: 0} = state, %Transaction{} = transaction) do
    {state, transaction}
  end

  def handle_transaction(%__MODULE__{} = state, %Transaction{changes: changes} = transaction) do
    {state, %{transaction | changes: expand_changes(changes, state)}}
  end

  defp expand_changes(changes, %__MODULE__{} = state) do
    Enum.flat_map(changes, &expand_change(&1, state))
  end

  # Truncate handling:
  # - Truncate partition root: truncation of the root plus all partitions
  #   if you truncate the root then your basically emptying it and all partitions
  #
  # - Truncate partition: truncate that partition plus the partition root
  #   truncating a partition empties it and also invalidates the contents of
  #   any shapes on the root. other partitions are untouched as, by definition,
  #   they don't overlap with the truncated partition.
  defp expand_change(%TruncatedRelation{relation: relation} = change, state) do
    [
      change
      | state |> truncation_dependencies(relation) |> Enum.map(&%{change | relation: &1})
    ]
  end

  defp expand_change(%{relation: relation} = change, state) do
    [
      change
      | state.partitions
        |> Map.get(relation, [])
        |> Enum.map(&%{change | relation: &1})
    ]
  end

  defp table(%{schema: schema, table: table}), do: {schema, table}

  defp truncation_dependencies(state, root_or_partition) do
    state.partitions
    |> Map.get(root_or_partition, [])
    |> MapSet.new()
    |> MapSet.union(
      state
      |> invert_partition_map()
      |> Map.get(root_or_partition, [])
      |> MapSet.new()
    )
    |> MapSet.delete(root_or_partition)
    |> MapSet.to_list()
  end

  defp invert_partition_map(%__MODULE__{partitions: partitions}) do
    Enum.reduce(partitions, %{}, fn {partition, roots}, inverted when is_list(roots) ->
      Enum.reduce(roots, inverted, fn root, inverted ->
        Map.update(inverted, root, [partition], &[partition | &1])
      end)
    end)
  end
end
