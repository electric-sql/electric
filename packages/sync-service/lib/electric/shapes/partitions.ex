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
  def add_shape(%__MODULE__{} = transformer, shape_id, shape) do
    case Inspector.load_relation(shape.root_table, transformer.inspector) do
      {:ok, relation} ->
        children = List.wrap(Map.get(relation, :children, []))

        transformer
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

      {:error, "ERROR 42P01 " <> _} ->
        # https://www.postgresql.org/docs/current/errcodes-appendix.html
        # 42P01 : undefined_table
        # tables that don't exist will be caught later in the stack (hard to
        # run a snapshot against a non-existent table)
        transformer

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
  def remove_shape(%__MODULE__{} = transformer, shape_id) do
    transformer
    |> Map.update!(:partition_ownership, fn ownership ->
      Map.new(ownership, fn {relation, shape_ids} ->
        {relation, MapSet.delete(shape_ids, shape_id)}
      end)
    end)
    |> clean_up_partitions()
  end

  defp clean_up_partitions(transformer) do
    {empty, full} =
      Enum.split_with(transformer.partition_ownership, fn {_relation, shape_ids} ->
        Enum.empty?(shape_ids)
      end)

    remove_relations = Enum.map(empty, &elem(&1, 0))

    %{transformer | partition_ownership: Map.new(full)}
    |> Map.update!(:partitions, fn partitions ->
      Enum.reduce(remove_relations, partitions, &Map.delete(&2, &1))
    end)
    |> update_active()
  end

  defp update_active(transformer) do
    %{transformer | active: map_size(transformer.partitions)}
  end

  @doc """
  Utility function to update the partition map with the given relation.
  """
  @spec handle_relation(t(), Relation.t()) :: t()
  def handle_relation(%__MODULE__{} = transformer, %Relation{} = relation) do
    table = table(relation)

    case Inspector.load_relation(table, transformer.inspector) do
      {:ok, %{parent: {_, _} = parent}} ->
        Map.update!(transformer, :partitions, &Map.put(&1, table, [parent]))

      {:ok, _} ->
        transformer
    end
  end

  @doc """
  Handle events from the replication stream, updating the partition mapping or
  expanding changes to partitions into the partition root as appropriate.
  """
  @spec handle_event(t(), Transaction.t() | Relation.t()) :: {t(), Transaction.t() | Relation.t()}
  def handle_event(%__MODULE__{} = transformer, %Relation{} = relation) do
    {handle_relation(transformer, relation), relation}
  end

  # no shapes on partitioned tables is probably the overwhelming majority of
  # cases, so let's shortcut to avoid churn
  def handle_event(%__MODULE__{active: 0} = transformer, %Transaction{} = transaction) do
    {transformer, transaction}
  end

  def handle_event(%__MODULE__{} = transformer, %Transaction{changes: changes} = transaction) do
    {transformer, %{transaction | changes: expand_changes(changes, transformer)}}
  end

  defp expand_changes(changes, %__MODULE__{} = transformer) do
    Enum.flat_map(changes, &expand_change(&1, transformer))
  end

  # Truncate handling:
  # - Truncate partition root: truncation of the root plus all partitions
  #   if you truncate the root then your basically emptying it and all partitions
  #
  # - Truncate partition: truncate that partition plus the partition root
  #   truncating a partition empties it and also invalidates the contents of
  #   any shapes on the root. other partitions are untouched as, by definition,
  #   they don't overlap with the truncated partition.
  defp expand_change(%TruncatedRelation{relation: relation} = change, transformer) do
    [
      change
      | transformer |> truncation_dependencies(relation) |> Enum.map(&%{change | relation: &1})
    ]
  end

  defp expand_change(%{relation: relation} = change, transformer) do
    [
      change
      | transformer.partitions
        |> Map.get(relation, [])
        |> Enum.map(&%{change | relation: &1})
    ]
  end

  defp table(%{schema: schema, table: table}), do: {schema, table}

  defp truncation_dependencies(transformer, root_or_partition) do
    transformer.partitions
    |> Map.get(root_or_partition, [])
    |> MapSet.new()
    |> MapSet.union(
      transformer
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
