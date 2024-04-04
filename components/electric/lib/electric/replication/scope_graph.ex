defmodule Electric.Replication.ScopeGraph do
  alias Electric.Replication.Changes
  alias Electric.Satellite.Permissions.Structure

  @behaviour Electric.Satellite.Permissions.Graph

  def impl(graph) do
    {__MODULE__, graph}
  end

  @impl Electric.Satellite.Permissions.Graph
  def scope_path(graph, structure, scope_root, relation, id) do
    path = Structure.path(structure, scope_root, relation)

    graph
    |> traverse_fks(path, relation, id)
    |> Enum.flat_map(fn
      [{^scope_root, _id} | _] = path ->
        [Enum.map(path, fn {relation, id} -> {relation, id, []} end)]

      _other ->
        []
    end)
  end

  @impl Electric.Satellite.Permissions.Graph
  def apply_change(graph, structure, %{relation: relation} = change) do
    {:ok, pk_cols} = Structure.pk_col(structure, relation)

    case change do
      %Changes.DeletedRecord{old_record: old} ->
        pks = Enum.map(pk_cols, &Map.fetch!(old, &1))

        Graph.delete_vertex(graph, {relation, pks})

      %Changes.NewRecord{record: record} ->
        pks = Enum.map(pk_cols, &Map.fetch!(record, &1))

        Graph.add_vertex(graph, {relation, pks})

        structure
        |> Structure.foreign_keys(relation)
        |> Enum.reduce(graph, fn {target_relation, fk_cols}, graph ->
          target = {target_relation, Enum.map(fk_cols, &Map.get(record, &1, nil))}
          Graph.add_edge(graph, {relation, pks}, target)
        end)

      %Changes.UpdatedRecord{old_record: old, record: new} ->
        pks = Enum.map(pk_cols, &Map.fetch!(old, &1))
        child = {relation, pks}

        structure
        |> Structure.foreign_keys(relation)
        |> Enum.reduce(graph, fn {target_relation, fk_cols}, graph ->
          old_target = {target_relation, Enum.map(fk_cols, &Map.get(old, &1, nil))}
          new_target = {target_relation, Enum.map(fk_cols, &Map.get(new, &1, nil))}

          graph
          |> Graph.delete_edge(child, old_target)
          |> Graph.add_edge(child, new_target)
        end)
    end
  end

  # if the relation path is invalid, like going against the fks
  # then the relation_path is nil and so the scope is nil
  defp traverse_fks(_graph, nil, _table, _id) do
    []
  end

  # doesn't validate that the traversal reaches the given root
  defp traverse_fks(graph, [table | relation_path], table, id) do
    do_traverse_fks(graph, relation_path, {table, id}, [{table, id}])
  end

  defp do_traverse_fks(_graph, [], _record, path) do
    [path]
  end

  defp do_traverse_fks(graph, [relation | relation_path], record, path) do
    parents =
      graph
      |> Graph.edges(record)
      |> Enum.flat_map(fn
        %{v1: {^relation, _id} = parent} ->
          [parent]

        %{v2: {^relation, _id} = parent} ->
          [parent]

        _ ->
          []
      end)

    case parents do
      [] ->
        # rather than returning an empty result at this point, we want to return the partial
        # result so that it's possible to continue the resolution elsewhere if necessary
        [path]

      parents ->
        Enum.flat_map(parents, &do_traverse_fks(graph, relation_path, &1, [&1 | path]))
    end
  end
end
