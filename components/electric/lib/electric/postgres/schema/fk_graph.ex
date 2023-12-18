defmodule Electric.Postgres.Schema.FkGraph do
  @moduledoc """
  Handles foreign key lookups and fk graph following.

  Splits path following from fk lookup because for the path following we don't want the
  directionality of a directed graph - we need to follow relations across e.g. join tables where
  the fks point against the flow of the graph.

  So we use an undirected graph for the path traversal and keep the directionality of the foreign
  key relations in a separate map of `%{relation() => %{relation() => [column_name()]}}`.
  """
  alias Electric.Postgres.Schema.Proto

  defstruct [:graph, fks: %{}]

  def for_schema(%Proto.Schema{tables: tables}) do
    tables
    |> Stream.flat_map(fn %Proto.Table{constraints: constraints, name: name} ->
      constraints
      |> Stream.filter(&match?(%{constraint: {:foreign, _}}, &1))
      |> Enum.map(fn %{constraint: {:foreign, fk}} ->
        {{name.schema, name.name}, {fk.pk_table.schema, fk.pk_table.name}, fk.fk_cols}
      end)
    end)
    |> new()
  end

  defp new_graph do
    Graph.new(type: :undirected, vertex_identifier: & &1)
  end

  def new(edges) do
    {graph, fks} =
      edges
      |> Enum.reduce({new_graph(), %{}}, fn edge, {graph, fks} ->
        {v1, v2, fk_cols} = normalise_edge(edge)

        {
          Graph.add_edge(graph, v1, v2),
          Map.update(fks, v1, %{v2 => fk_cols}, fn relations ->
            Map.put(relations, v2, fk_cols)
          end)
        }
      end)

    %__MODULE__{graph: graph, fks: fks}
  end

  defp normalise_edge({{_, _} = v1, {_, _} = v2, label: fk_columns}) when is_list(fk_columns) do
    {v1, v2, fk_columns}
  end

  defp normalise_edge({{_, _} = v1, {_, _} = v2, fk_columns}) when is_list(fk_columns) do
    {v1, v2, fk_columns}
  end

  # [VAX-1626] we don't support recursive relations
  def foreign_keys(%__MODULE__{}, {_, _} = root, root) do
    []
  end

  def foreign_keys(%__MODULE__{fks: fks} = fk_graph, {_, _} = root, {_, _} = relation) do
    # we guard against looking for a fk ref to the same table above so relation_path/3 is always
    # going to return a list of at least 2 items or nil if there is no route between the two
    # tables

    case path(fk_graph, root, relation) do
      [r1 | _] ->
        case Map.get(fks, r1, nil) do
          table_fks when is_map(table_fks) ->
            # this gives us a list of the fks pointing out of this table
            # we now need to find which of those live within the `root` scope
            Enum.filter(table_fks, fn {fk_relation, _fk_cols} ->
              is_list(path(fk_graph, root, fk_relation))
            end)

          _ ->
            []
        end

      nil ->
        []
    end
  end

  def path(%__MODULE__{}, {_, _} = root, root) do
    [root]
  end

  def path(%__MODULE__{graph: graph}, {_, _} = root, {_, _} = relation) do
    Graph.get_shortest_path(graph, relation, root)
  end
end
