defmodule Electric.Satellite.Permissions.Graph do
  @moduledoc """
  Utility functions for resolving record scopes using Graph instances.
  """

  def new do
    Graph.new(vertex_identifier: & &1)
  end

  # if the relation path is invalid, like going against the fks
  # then the relation_path is nil and so the scope is nil
  def scope_id(_graph, nil, _table, _id) do
    nil
  end

  # doesn't validate that the traversal reaches the given root
  def scope_id(graph, relation_path, table, id) do
    relation_path
    |> Enum.drop(1)
    |> Enum.reduce_while({{table, id}, []}, fn relation, {record, path} ->
      parent =
        graph
        |> Graph.edges(record)
        |> Enum.find_value(fn
          %{v1: {^relation, _id} = parent} -> parent
          %{v2: {^relation, _id} = parent} -> parent
          _ -> nil
        end)

      case parent do
        nil ->
          {:halt, {record, path}}

        {_, _} = _record ->
          {:cont, {parent, [parent | path]}}
      end
    end)
  end
end
