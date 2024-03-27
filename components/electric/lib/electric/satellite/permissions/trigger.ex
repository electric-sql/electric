defmodule Electric.Satellite.Permissions.Trigger do
  alias Electric.Replication.Changes
  alias Electric.Satellite.{Auth, SatPerms}
  alias Electric.Satellite.Permissions
  alias Electric.Satellite.Permissions.Graph

  @type assign_trigger_fun() ::
          (Permissions.change(), Graph.impl(), Auth.t() -> [Permissions.Role.t()])

  @spec for_assign(%SatPerms.Assign{}) :: [{Permissions.relation(), assign_trigger_fun()}]
  def for_assign(assign) do
    %{table: %{schema: schema, name: name}} = assign

    [
      {{schema, name}, &role_for_assign(&1, &2, &3, assign)}
    ]
  end

  defp role_for_assign(%Changes.NewRecord{} = insert, graph, auth, assign) do
    scopes = role_scopes(insert, assign, graph)

    for {role, id} <- build_roles(insert, graph, auth, assign, scopes) do
      {:insert, {insert.relation, id}, role}
    end
  end

  defp role_for_assign(%Changes.UpdatedRecord{} = update, graph, auth, assign) do
    scopes = role_scopes(update, assign, graph)

    for {role, id} <- build_roles(update, graph, auth, assign, scopes) do
      {:update, {update.relation, id}, role}
    end
  end

  defp role_for_assign(%Changes.DeletedRecord{} = delete, graph, auth, assign) do
    # for deletes we need to know about the upstream graph because the local graph will already
    # have the record as deleted, so we won't get scope information
    upstream_graph = Electric.Satellite.Permissions.WriteBuffer.upstream_graph(graph)
    scopes = role_scopes(delete, assign, upstream_graph)

    id = Graph.primary_key(graph, delete.relation, delete.old_record)

    # include a force delete for any roles in the buffer plus a delete for
    # any roles in the underlying shape data
    [
      {:delete, {delete.relation, id}}
      | for(
          {role, id} <- build_roles(delete, graph, auth, assign, scopes),
          do: {:delete, {delete.relation, id}, role}
        )
    ]
  end

  defp build_roles(change, graph, auth, assign, scopes) do
    record =
      case change do
        %Changes.DeletedRecord{old_record: record} -> record
        %{record: record} -> record
      end

    %{user_id: user_id} = auth
    %{user_column: user_column} = assign

    with ^user_id <- Map.get(record, user_column, nil),
         role_name = role_name(record, assign) do
      id = Graph.primary_key(graph, change.relation, record)

      Enum.map(scopes, fn scope ->
        {%Permissions.Role{
           id: id,
           role: role_name,
           user_id: user_id,
           assign_id: assign.id,
           scope: scope
         }, id}
      end)
    else
      _ -> []
    end
  end

  defp role_name(record, assign) do
    case assign do
      %{role_name: role_name, role_column: column}
      when role_name in [nil, ""] and is_binary(column) ->
        Map.fetch!(record, column)

      %{role_name: name, role_column: role_column}
      when role_column in [nil, ""] and is_binary(name) ->
        name
    end
  end

  defp role_scopes(change, assign, graph) do
    case assign do
      %{scope: nil} ->
        [nil]

      %{scope: %{schema: schema, name: name}} ->
        root = {schema, name}

        graph
        |> Graph.scope_id(root, change)
        |> Enum.map(fn {id, _} -> {root, id} end)
    end
  end
end
