defmodule Electric.Postgres.PublicationManager do
  use GenServer
  alias Electric.Shapes.Shape

  @type relation_filter :: %{
          relation: Electric.relation(),
          where_clauses: MapSet.t(Electric.Replication.Eval.Expr.t()),
          selected_columns: MapSet.t(String.t())
        }

  defstruct [
    :publication_filters_table
  ]

  @relation_filters :relation_filters
  @relation_where :relation_where
  @relation_column :relation_column

  def add_shape(%__MODULE__{} = publication_manager, shape) do
    update_relation_counters(publication_manager, shape, +1)
  end

  def remove_shape(%__MODULE__{} = publication_manager, shape) do
    update_relation_counters(publication_manager, shape, -1)
  end

  def start_link(opts) do
    GenServer.start_link(__MODULE__, opts)
  end

  def init(%{stack_id: stack_id} = opts) do
    publication_filters_table =
      :ets.new(:"#{stack_id}:publication_filters", [:named_table, :public, :ordered_set])

    {:ok,
     %{
       publication_filters_table: publication_filters_table
     }}
  end

  defp update_relation_counters(
         %__MODULE__{publication_filters_table: ets_table} = _publication_manager,
         %{root_table: table, where: where, selected_columns: columns} = _shape,
         increment
       ) do
    key = {@relation_filters, table, @relation_where, where}
    :ets.update_counter(ets_table, key, increment, {key, 0})

    Enum.each(columns, fn col ->
      key = {@relation_filters, table, @relation_column, col}
      :ets.update_counter(ets_table, key, increment, {key, 0})
    end)

    :ok
  end

  @spec get_shape_filters(%__MODULE__{}, Electric.Shapes.Shape.t()) ::
          nil | %{Electric.relation() => relation_filter()}
  defp get_shape_filters(%__MODULE__{publication_filters_table: ets_table}, shape) do
    relations = Shape.affected_tables(shape)

    matched_filters =
      :ets.select(ets_table, [
        {
          {{@relation_filters, :"$1", :"$2", :"$3"}, :"$4"},
          [Enum.map(relations, &{:==, :"$1", &1}) | [{:>, :"$4", 0}]],
          [{:"$1", :"$2", :"$3"}]
        }
      ])

    case matched_filters do
      [] ->
        nil

      filters ->
        filters
        |> Enum.group_by(fn {relation, _, _} -> relation end, fn {_, filter_tag, filter} ->
          {filter_tag, filter}
        end)
        |> Enum.map(fn {relation, filters} ->
          {relation,
           Enum.reduce(
             filters,
             %{
               relation: relation,
               where_clauses: MapSet.new(),
               selected_columns: MapSet.new()
             },
             fn
               {@relation_where, where}, acc ->
                 %{acc | where_clauses: MapSet.put(acc.where_clauses, where)}

               {@relation_column, column}, acc ->
                 %{acc | selected_columns: MapSet.put(acc.selected_columns, column)}
             end
           )}
        end)
        |> Map.new()
    end
  end
end
