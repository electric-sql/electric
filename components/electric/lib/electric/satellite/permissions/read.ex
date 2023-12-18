defmodule Electric.Satellite.Permissions.Read do
  alias Electric.Replication.Changes
  alias Electric.Satellite.Permissions
  alias Electric.Satellite.Permissions.MoveOut
  alias Electric.Satellite.Permissions.Role
  alias Electric.Satellite.Permissions.Graph

  def filter_read(perms, tx) do
    %{graph: %{read: graph}, scopes: scopes, scoped_roles: scoped_roles} = perms

    tx_graph = Graph.transaction_context(graph, scopes, tx)

    {readable_changes, excluded_changes} =
      Enum.split_with(tx.changes, &Permissions.validate_read(&1, perms, tx_graph, tx.lsn))

    scopes = Enum.map(scopes, &{&1, Map.get(scoped_roles, &1, [])})

    moves =
      Enum.flat_map(
        excluded_changes,
        &resolve_scope_moves(&1, graph, scopes)
      )

    {%{tx | changes: readable_changes}, moves}
  end

  defp role_matches_scope?(%Role{scope: {scope_relation, scope_id}}, scope, id) do
    scope_relation == scope && scope_id == id
  end

  # newrecord can never remove access to a change
  defp resolve_scope_moves(%Changes.NewRecord{}, _graph, _scoped_roles) do
    []
  end

  defp resolve_scope_moves(%Changes.UpdatedRecord{} = change, graph, scoped_roles) do
    Enum.flat_map(scoped_roles, fn {scope, roles} ->
      case Graph.modified_fks(graph, scope, change) do
        [] ->
          []

        _modified ->
          classify_change(change, scope, graph, roles)
      end
    end)
  end

  defp resolve_scope_moves(%Changes.DeletedRecord{} = change, graph, scoped_roles) do
    Enum.flat_map(scoped_roles, fn {scope, roles} ->
      classify_change(change, scope, graph, roles)
    end)
  end

  defp classify_change(%c{} = change, scope, graph, roles)
       when c in [Changes.UpdatedRecord, Changes.DeletedRecord] do
    %{relation: relation, old_record: old} = change

    # this gets the scope id in the pre-tx graph
    case Graph.scope_id(graph, scope, relation, old) do
      [] ->
        # the row doesn't have a scope so the removal must have been due to global perms
        []

      scopes ->
        Enum.flat_map(scopes, fn {old_scope_id, scope_path} ->
          # do we have any roles that gave us access to the old record in the old graph?
          # if so then the perms status of this change has altered due to changes in this tx
          if Enum.any?(roles, &role_matches_scope?(&1, scope, old_scope_id)) do
            [
              %MoveOut{
                change: change,
                relation: relation,
                id: Graph.primary_key(graph, relation, old),
                scope_path: scope_path
              }
            ]
          else
            # we didn't have perms on this update in the first place
            []
          end
        end)
    end
  end
end
