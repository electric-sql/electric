defmodule Electric.Satellite.Permissions.Trigger do
  alias Electric.Replication.Changes
  alias Electric.Satellite.{Auth, SatPerms}
  alias Electric.Satellite.Permissions
  alias Electric.Satellite.Permissions.Graph

  @type assign_trigger_fun() ::
          (Permissions.change(), Graph.t(), Auth.t() -> [Permissions.Role.t()])

  @spec for_assign(%SatPerms.Assign{}) :: [{Permissions.relation(), assign_trigger_fun()}]
  def for_assign(assign) do
    %{table: %{schema: schema, name: name}} = assign

    [
      {{schema, name}, &role_for_assign(&1, &2, &3, assign)}
    ]
  end

  defp role_for_assign(%Changes.NewRecord{} = insert, tree, auth, assign) do
    for {role, id} <- build_roles(insert, tree, auth, assign) do
      {:insert, {insert.relation, id}, role}
    end
  end

  defp role_for_assign(%Changes.UpdatedRecord{} = update, tree, auth, assign) do
    for {role, id} <- build_roles(update, tree, auth, assign) do
      {:update, {update.relation, id}, role}
    end
  end

  defp role_for_assign(%Changes.DeletedRecord{} = delete, tree, _auth, _assign) do
    id = Graph.primary_key(tree, delete.relation, delete.old_record)

    [
      {:delete, {delete.relation, id}}
    ]
  end

  defp build_roles(change, tree, auth, assign) do
    %{record: record} = change
    %{user_id: user_id} = auth
    %{user_column: user_column} = assign

    with ^user_id <- Map.get(record, user_column, nil),
         role_name = role_name(record, assign),
         scopes = role_scopes(change, assign, tree) do
      id = Graph.primary_key(tree, change.relation, record)

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

  defp role_scopes(change, assign, tree) do
    case assign do
      %{scope: nil} ->
        [nil]

      %{scope: %{schema: schema, name: name}} ->
        root = {schema, name}

        tree
        |> Graph.scope_id(root, change)
        |> Enum.map(fn {id, _} -> {root, id} end)
    end
  end
end
