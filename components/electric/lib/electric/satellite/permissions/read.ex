defmodule Electric.Satellite.Permissions.Read do
  @moduledoc """
  Read permissions implementation on top of the functions provided by `Permissions`.

  Read permissions do not involve rejecting transaction changes, merely filtering their contents.
  This filtering needs to return information to the shape implementation to tell it when a record
  has been updated in such a way to move it out of the the valid permissions scope.

  This is done via a list of `%Permissions.MoveOut{}` structs -- simply removing a change from a
  transaction is not enough as the shapes system won't even know that the change was there.

  ## MoveOut

  There are two reasons why we would want to issue a `MoveOut` message for a given change:

  1. The change moves a row out of a permissions scope that we have read permissions on and into
     one we don't have permissions to see.

  2. The change alters the row information so that it no longer passes a GRANT's `WHERE` clause.

  In both these cases we remove the offending row from the list of visible changes but also add a
  move-out message so the client can be informed of the loss of access to data.
  """

  alias Electric.Replication.Changes
  alias Electric.Satellite.Permissions
  alias Electric.Satellite.Permissions.Eval
  alias Electric.Satellite.Permissions.MoveOut
  alias Electric.Satellite.Permissions.Role
  alias Electric.Satellite.Permissions.Graph
  alias Electric.Satellite.Permissions.Structure

  @type mapper_fun() :: (term() -> Changes.change())
  @type change_list() :: Enumerable.t(term())
  @type changes() :: [Changes.change()]
  @type referenced_records() :: Changes.Transaction.referenced_records()
  @type moves() :: [Permissions.move_out()]
  @type xid() :: Electric.Postgres.xid()
  @type graph() :: Permissions.Graph.impl()
  @type perms() :: Permissions.t()

  @spec filter_changes(perms(), graph(), change_list(), referenced_records(), xid(), mapper_fun()) ::
          {[term()], referenced_records(), [term()], moves()}
  def filter_changes(perms, graph, changes, referenced_records, xid, mapper_fun) do
    tx_graph = Graph.transaction_context(graph, perms.structure, changes, referenced_records)

    filter_with_context(perms, graph, tx_graph, changes, referenced_records, xid, mapper_fun)
  end

  @spec filter_shape_data(perms(), graph(), change_list(), xid()) :: {[term()], [term()]}
  def filter_shape_data(perms, graph, changes, xid) do
    graph_impl = Electric.Replication.ScopeGraph.impl(graph)

    {accepted_changes, rejected_changes, _scope_moves} =
      filter_with_context(perms, nil, graph_impl, changes, xid, fn {_key, {change, _}} ->
        change
      end)

    {accepted_changes, rejected_changes}
  end

  @spec filter_with_context(
          perms(),
          graph(),
          graph(),
          change_list(),
          referenced_records(),
          xid(),
          mapper_fun()
        ) :: {[term()], referenced_records(), [term()], moves()}
  defp filter_with_context(perms, old_graph, graph, changes, referenced_records, xid, mapper_fun) do
    {readable_changes, excluded_changes, moves} =
      filter_with_context(perms, old_graph, graph, changes, xid, mapper_fun)

    readable_referenced_records = filter_referenced_records(perms, graph, referenced_records, xid)

    {readable_changes, readable_referenced_records, excluded_changes, moves}
  end

  @spec filter_with_context(perms(), graph() | nil, graph(), change_list(), xid(), mapper_fun()) ::
          {[term()], [term()], moves()}
  defp filter_with_context(perms, old_graph, graph, changes, xid, mapper_fun) do
    results =
      Enum.map(changes, fn elem ->
        change = mapper_fun.(elem)
        results = Permissions.read_permissions(change, perms, graph, xid)
        {elem, change, results}
      end)

    {readable_changes, excluded_changes} =
      Enum.split_with(results, fn {_elem, _change, results} ->
        Enum.any?(results, fn {readable?, _} -> readable? end)
      end)

    moves =
      excluded_changes
      |> Enum.map(fn {_elem, change, results} -> {change, results} end)
      |> resolve_moves(old_graph, perms)

    {Enum.map(readable_changes, &elem(&1, 0)), Enum.map(excluded_changes, &elem(&1, 0)), moves}
  end

  defp filter_referenced_records(perms, graph, referenced_records, xid) do
    referenced_records
    |> Enum.flat_map(fn {relation, records} ->
      records
      |> Enum.filter(fn {_pk, referenced_record} ->
        can_read_referenced_record?(referenced_record, perms, graph, xid)
      end)
      |> case do
        [] ->
          []

        records ->
          [{relation, Map.new(records)}]
      end
    end)
    |> Map.new()
  end

  defp can_read_referenced_record?(%Changes.ReferencedRecord{} = referenced, perms, graph, xid) do
    %Changes.NewRecord{relation: referenced.relation, record: referenced.record}
    |> Permissions.read_permissions(perms, graph, xid)
    |> Enum.any?(&elem(&1, 0))
  end

  defp resolve_moves(change_results, nil, perms) do
    change_results
    |> resolve_where_clause_changes(perms)
    |> Enum.uniq()
  end

  defp resolve_moves(change_results, graph, perms) do
    Enum.concat([
      resolve_scope_moves(change_results, graph, perms),
      resolve_where_clause_changes(change_results, perms)
    ])
    |> Enum.uniq()
  end

  defp resolve_scope_moves(change_results, old_graph, perms) do
    %{scopes: scopes, scoped_roles: scoped_roles, structure: structure} = perms
    roles = Enum.map(scopes, &{&1, Map.get(scoped_roles, &1, [])})
    Enum.flat_map(change_results, &resolve_scope_moves(&1, old_graph, structure, roles))
  end

  # newrecord can never remove access to a change
  defp resolve_scope_moves({%Changes.NewRecord{}, _}, _old_graph, _structure, _scoped_roles) do
    []
  end

  defp resolve_scope_moves(
         {%Changes.UpdatedRecord{} = change, _results},
         graph,
         structure,
         scoped_roles
       ) do
    Enum.flat_map(scoped_roles, fn {scope, roles} ->
      case Structure.modified_fks(structure, scope, change) do
        [] ->
          []

        _modified ->
          classify_change(change, scope, graph, structure, roles)
      end
    end)
  end

  defp resolve_scope_moves(
         {%Changes.DeletedRecord{} = change, _results},
         graph,
         structure,
         scoped_roles
       ) do
    Enum.flat_map(scoped_roles, fn {scope, roles} ->
      classify_change(change, scope, graph, structure, roles)
    end)
  end

  defp classify_change(%c{} = change, scope, graph, structure, roles)
       when c in [Changes.UpdatedRecord, Changes.DeletedRecord] do
    %{relation: relation, old_record: old} = change

    # this gets the scope id in the pre-tx graph
    case Graph.scope_id(graph, structure, scope, relation, old) do
      [] ->
        # the row doesn't have a scope so the removal must have been due to global perms
        []

      scopes ->
        Enum.flat_map(scopes, fn {old_scope_id, scope_path} ->
          # do we have any roles that gave us access to the old record in the old graph?
          # if so then the perms status of this change has altered due to changes in this tx
          if Enum.any?(roles, &role_matches_scope?(&1, scope, old_scope_id)) do
            [moveout(structure, change, old, scope_path)]
          else
            # we didn't have perms on this update in the first place
            []
          end
        end)
    end
  end

  defp role_matches_scope?(%Role{scope: {scope_relation, scope_id}}, scope, id) do
    scope_relation == scope && scope_id == id
  end

  defp resolve_where_clause_changes(change_results, perms) do
    Enum.flat_map(change_results, &resolve_where_clause_change(&1, perms))
  end

  defp resolve_where_clause_change({%Changes.UpdatedRecord{} = change, results}, perms) do
    results
    |> Enum.flat_map(fn
      {_, %{grant: %{check: nil}}} ->
        []

      {_, %{grant: %{check: check}}} ->
        find_where_clause_change(check, change, change.old_record, change.record, perms.structure)
    end)
    |> Enum.uniq()
  end

  defp resolve_where_clause_change({_change, _results}, _perms) do
    []
  end

  defp find_where_clause_change(check, change, old, new, structure) do
    case {Eval.evaluate!(check, old), Eval.evaluate!(check, new)} do
      {true, false} ->
        [moveout(structure, change, old)]

      _ ->
        []
    end
  end

  defp moveout(structure, %{relation: relation} = change, record, scope_path \\ []) do
    %MoveOut{
      change: change,
      relation: relation,
      id: Structure.pk_val(structure, relation, record),
      scope_path: scope_path
    }
  end
end
