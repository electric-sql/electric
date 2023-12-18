defmodule ElectricTest.PermissionsHelpers do
  defmodule Perms do
    alias Electric.Satellite.SatPerms, as: P

    def build(ddlx, roles \\ [], auth) do
      Electric.Satellite.Permissions.build(to_grants(ddlx), roles, auth)
      # %P{
      #   rules: %P.Rules{
      #     grants: to_grants(ddlx)
      #   },
      #   roles: %P.Roles{
      #     roles: roles
      #   }
      # }
    end

    defp to_grants(ddlx) do
      ddlx
      |> List.wrap()
      |> Enum.map(fn
        "ELECTRIC " <> _ = ddlx -> ddlx
        ddl -> "ELECTRIC " <> ddl
      end)
      |> Enum.map(&Electric.DDLX.parse!/1)
      |> Enum.map(&Electric.DDLX.Command.Grant.to_protobuf/1)
    end
  end

  defmodule Table do
    alias Electric.Satellite.SatPerms, as: P

    def relation({schema, name}) do
      %P.Table{schema: schema, name: name}
    end
  end

  defmodule Chgs do
    alias Electric.Replication.Changes

    def insert(table, record) do
      %Changes.NewRecord{relation: table, record: record}
    end

    def update(table, old_record, changes) do
      Changes.UpdatedRecord.new(
        relation: table,
        old_record: old_record,
        record: Map.merge(old_record, changes)
      )
    end
  end

  defmodule Grants do
    alias Electric.Satellite.SatPerms, as: P

    def authenticated do
      %P.RoleName{role: {:predefined, :AUTHENTICATED}}
    end

    def anyone do
      %P.RoleName{role: {:predefined, :ANYONE}}
    end

    def role(role) when is_binary(role) do
      %P.RoleName{role: {:application, role}}
    end
  end

  defmodule Roles do
    alias Electric.Satellite.SatPerms, as: P

    def role(role_name) do
      %P.Role{role: role_name}
    end

    def role(role_name, table, id) do
      %P.Role{
        role: role_name,
        scope: %P.Scope{table: Table.relation(table), id: id}
      }
    end
  end

  defmodule Privs do
    def all do
      [
        :SELECT,
        :INSERT,
        :UPDATE,
        :DELETE
      ]
    end

    def insert(), do: [:INSERT]
    def select(), do: [:SELECT]
    def update(), do: [:UPDATE]
  end

  defmodule Auth do
    def user_id do
      "92bafe18-a818-4a3f-874f-590324140478"
    end

    def user(id \\ user_id()) do
      %Electric.Satellite.Auth{user_id: id}
    end

    def nobody do
      %Electric.Satellite.Auth{user_id: nil}
    end
  end

  defmodule Tree do
    @moduledoc """
    Simple implementation of the `Electric.Satellite.Permissions.Scope` behaviour using graphs
    """

    @behaviour Electric.Satellite.Permissions.Scope

    alias Electric.Replication.Changes

    @type vertex() :: {{String.t(), String.t()}, String.t(), [vertex()]}

    @root :__root__

    def new(vs, fks) do
      {__MODULE__, {data_tree(vs), fk_tree(fks)}}
    end

    def path(graph, table, id) do
      Graph.get_shortest_path(graph, {table, id}, @root)
    end

    defp fk_tree(fks) do
      {_, graph} =
        Enum.reduce(fks, {@root, Graph.new()}, &build_fk_tree/2)

      graph
    end

    defp data_tree(vs) do
      {_, graph} =
        Enum.reduce(vs, {@root, Graph.new()}, &build_data_tree/2)

      graph
    end

    defp build_data_tree({table, id}, {parent, graph}) do
      build_data_tree({table, id, []}, {parent, graph})
    end

    defp build_data_tree({_table, _id, children} = v, {parent, graph}) do
      graph = Graph.add_edge(graph, v(v), v(parent))

      {_v, graph} = Enum.reduce(children, {v, graph}, &build_data_tree/2)
      {parent, graph}
    end

    defp build_fk_tree({table, fk}, acc) do
      build_fk_tree({table, fk, []}, acc)
    end

    defp build_fk_tree({table, fk, children}, {parent, graph}) do
      graph = Graph.add_edge(graph, table, parent, label: fk)

      {_, graph} = Enum.reduce(children, {table, graph}, &build_fk_tree/2)
      {parent, graph}
    end

    defp v(@root), do: @root

    defp v({table, id, _children}) do
      {table, id}
    end

    @impl Electric.Satellite.Permissions.Scope
    # for the new record case, we need to find the parent table we're adding a child of
    # in order to find its place in the tree
    def scope_id!({graph, fks}, {_, _} = root, %Changes.NewRecord{} = change) do
      with {:ok, parent, parent_id} <- fk_for_change(fks, change) do
        scope_root_id(graph, root, parent, parent_id)
      end
    end

    def scope_id!({graph, _fks}, {_, _} = root, change) do
      {table, id} = relation_id(change)

      scope_root_id(graph, root, table, id)
    end

    @impl Electric.Satellite.Permissions.Scope
    def modifies_fk?({_graph, fks}, update) do
      {:ok, _parent, fk} = relation_fk(fks, update)
      {:ok, MapSet.member?(update.changed_columns, fk)}
    end

    defp scope_root_id(graph, root, table, id) do
      case path(graph, table, id) do
        nil ->
          {:error, "record #{inspect(table)} id: #{inspect(id)} does not exist"}

        # we're already at the root of the tree
        [{^root, ^id} | _path] ->
          {:ok, id}

        [{^table, ^id} | path] ->
          error = {:error, "#{inspect(table)} not in scope #{inspect(root)}"}

          with {:ok, root_id} <-
                 Enum.find_value(path, error, fn
                   {^root, id} -> {:ok, id}
                   _ -> false
                 end) do
            {:ok, root_id}
          end
      end
    end

    defp relation_fk(fks, %{relation: relation}) do
      %Graph.Edge{v2: parent, label: fk} =
        Graph.get_shortest_path(fks, relation, @root)
        |> Enum.chunk_every(2, 1, :discard)
        |> Enum.take(1)
        |> Enum.map(fn [a, b] -> Graph.edges(fks, a, b) |> hd() end)
        |> hd()

      {:ok, parent, fk}
    end

    # there's probably a better way to do this
    defp fk_for_change(fks, %{record: record} = change) do
      {:ok, parent, fk} = relation_fk(fks, change)

      case Map.fetch(record, fk) do
        {:ok, id} ->
          {:ok, parent, id}

        :error ->
          {:error, "record does not have a foreign key"}
      end
    end

    defp relation_id(%Changes.DeletedRecord{relation: relation, old_record: record}) do
      relation_id(relation, record)
    end

    defp relation_id(%{relation: relation, record: record}) do
      relation_id(relation, record)
    end

    defp relation_id(relation, %{"id" => id}) do
      {relation, id}
    end
  end
end
