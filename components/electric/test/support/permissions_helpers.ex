defmodule ElectricTest.PermissionsHelpers do
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

  defmodule Perms do
    alias Electric.Satellite.SatPerms, as: P
    alias Electric.Satellite.Permissions

    defmodule Transient do
      @name __MODULE__.Transient

      def name do
        Process.get(__MODULE__)
      end

      def unique_name do
        id = System.unique_integer([:positive, :monotonic])
        Module.concat([@name, :"Instance_#{id}"])
      end

      def child_spec(_init_arg) do
        name = unique_name()

        default = %{
          id: @name,
          start: {Permissions.Transient, :start_link, [[name: name]]}
        }

        Process.put(__MODULE__, name)

        Supervisor.child_spec(default, [])
      end
    end

    def new(attrs \\ []) do
      auth = Keyword.get(attrs, :auth, Auth.user())

      Permissions.new(auth, Transient.name())
    end

    def update(perms, ddlx, roles) do
      Permissions.update(
        perms,
        to_rules(ddlx),
        roles
      )
    end

    def transient(attrs) do
      Permissions.Transient.new(attrs)
    end

    def add_transient(perms, attrs) do
      Permissions.Transient.update([transient(attrs)], Transient.name())
      perms
    end

    def to_rules(ddlx) do
      ddlx
      |> List.wrap()
      |> Enum.map(fn
        "ELECTRIC " <> _ = ddlx -> ddlx
        ddl -> "ELECTRIC " <> ddl
      end)
      |> Enum.map(&Electric.DDLX.parse!/1)
      |> Enum.flat_map(&Electric.DDLX.Command.to_protobuf/1)
      |> Enum.map_reduce(%{assign: 1, grant: 1}, fn
        # give each ddlx statement an id
        %P.Assign{} = assign, %{assign: id} = s ->
          {%{assign | id: "assign-#{id}"}, %{s | assign: id + 1}}

        %P.Grant{} = grant, %{grant: id} = s ->
          {%{grant | id: "grant-#{id}"}, %{s | grant: id + 1}}
      end)
      |> then(&elem(&1, 0))
      |> Enum.group_by(fn
        %P.Assign{} -> :assigns
        %P.Grant{} -> :grants
      end)
      |> then(&struct(%P.Rules{}, &1))
    end
  end

  defmodule LSN do
    def new(lsn) when is_integer(lsn) do
      Electric.Postgres.Lsn.from_integer(lsn)
    end

    def new(nil) do
      nil
    end
  end

  defmodule Chgs do
    alias Electric.Replication.Changes

    def tx(changes, attrs \\ []) do
      %Changes.Transaction{changes: changes}
      |> put_tx_attrs(attrs)
    end

    def insert(table, record, attrs \\ []) do
      %Changes.NewRecord{relation: table, record: record}
      |> put_change_attrs(attrs)
    end

    def update(table, old_record, changes, attrs \\ []) do
      Changes.UpdatedRecord.new(
        relation: table,
        old_record: old_record,
        record: Map.merge(old_record, changes)
      )
      |> put_change_attrs(attrs)
    end

    def delete(table, record, attrs \\ []) do
      %Changes.DeletedRecord{relation: table, old_record: record}
      |> put_change_attrs(attrs)
    end

    defp put_tx_attrs(tx, attrs) do
      Map.put(tx, :lsn, LSN.new(attrs[:lsn]))
    end

    defp put_change_attrs(change, attrs) do
      tags = Keyword.get(attrs, :tags, [])

      %{change | tags: tags}
    end
  end

  defmodule Roles do
    alias Electric.Satellite.SatPerms, as: P

    def role(role_name) do
      %P.Role{role: role_name}
    end

    def role(role_name, table, id, attrs \\ []) do
      %P.Role{
        assign_id: attrs[:assign_id],
        role: role_name,
        user_id: Keyword.get(attrs, :user_id, Auth.user_id()),
        scope: %P.Scope{table: relation(table), id: List.wrap(id)}
      }
    end

    defp relation({schema, name}) do
      %P.Table{schema: schema, name: name}
    end
  end

  defmodule Tree do
    @moduledoc """
    Simple implementation of the `Electric.Satellite.Permissions.Graph` behaviour using graphs
    """

    @behaviour Electric.Satellite.Permissions.Graph

    alias Electric.Replication.Changes
    alias Electric.Satellite.Permissions
    alias Electric.Postgres.Schema.FkGraph

    @type vertex() :: {{String.t(), String.t()}, String.t(), [vertex()]}

    @root :__root__

    def new(vs, fk_edges) do
      {__MODULE__, {data_tree(vs), fk_graph(fk_edges)}}
    end

    defp fk_graph(fk_edges) do
      FkGraph.new(fk_edges)
    end

    defp graph(attrs \\ []) do
      Permissions.Graph.graph(attrs)
    end

    def add_vertex({__MODULE__, {graph, fks}}, v) do
      graph = Graph.add_vertex(graph, v)
      {__MODULE__, {graph, fks}}
    end

    def delete_vertex({__MODULE__, {graph, fks}}, v) do
      graph = Graph.delete_vertex(graph, v)
      {__MODULE__, {graph, fks}}
    end

    def add_edge({__MODULE__, {graph, fks}}, a, b) do
      graph = Graph.add_edge(graph, a, b)
      {__MODULE__, {graph, fks}}
    end

    defp data_tree(vs) do
      {_, graph} = Enum.reduce(vs, {@root, graph()}, &build_data_tree/2)

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

    defp v(@root), do: @root

    defp v({table, id, _children}) do
      {table, [id]}
    end

    def scope_id(_state, {_, _} = root, {_, _} = root, id) when is_list(id) do
      [{id, [{root, id}]}]
    end

    def scope_id({graph, fks}, {_, _} = root, {_, _} = relation, id) when is_list(id) do
      graph
      |> Permissions.Graph.traverse_fks(fk_path(fks, root, relation), relation, id)
      |> Enum.flat_map(fn
        {{^root, id}, path} -> [{id, path}]
        _other -> []
      end)
    end

    @impl Electric.Satellite.Permissions.Graph
    def scope_path({graph, fks}, {_, _} = root, {_, _} = relation, id) when is_list(id) do
      graph
      |> Permissions.Graph.traverse_fks(fk_path(fks, root, relation), relation, id)
      |> Enum.flat_map(fn
        [{^root, _id} | _] = path -> [Enum.map(path, fn {relation, id} -> {relation, id, []} end)]
        _other -> []
      end)
    end

    @impl Electric.Satellite.Permissions.Graph
    def modified_fks({_graph, fks} = state, {_, _} = root, %Changes.UpdatedRecord{} = update) do
      %Changes.UpdatedRecord{
        changed_columns: changed_columns,
        old_record: old,
        record: new,
        relation: relation
      } = update

      case FkGraph.foreign_keys(fks, root, relation) do
        [] ->
          []

        foreign_keys ->
          path = FkGraph.path(fks, root, relation)

          foreign_keys
          |> Stream.filter(fn {_fk_relation, fk_cols} ->
            Enum.any?(fk_cols, &MapSet.member?(changed_columns, &1))
          end)
          |> Enum.map(fn {fk_relation, fk_cols} ->
            if fk_relation in path do
              # the change affects this row, that is fk changes pointing "up" the tree (towards
              # `root`)
              {relation, primary_key(state, relation, old), primary_key(state, relation, new)}
            else
              # the change affects a table "down" the tree, away from the `root` we're not
              # checking that the relation is in the scope because it *has* to be if the
              # update relation is
              {fk_relation, Enum.map(fk_cols, &Map.fetch!(old, &1)),
               Enum.map(fk_cols, &Map.fetch!(new, &1))}
            end
          end)
      end
    end

    @impl Electric.Satellite.Permissions.Graph
    def primary_key(_state, _relation, record) do
      [Map.fetch!(record, "id")]
    end

    @impl Electric.Satellite.Permissions.Graph
    def parent({_graph, fks}, {_, _} = root, relation, record) when is_map(record) do
      with [^relation, parent_rel | _] <- FkGraph.path(fks, root, relation),
           [_ | _] = relations <- FkGraph.foreign_keys(fks, root, relation),
           {^parent_rel, fk_cols} <- Enum.find(relations, &match?({^parent_rel, _}, &1)) do
        {parent_rel, Enum.map(fk_cols, &Map.get(record, &1, nil))}
      else
        _ -> nil
      end
    end

    @impl Electric.Satellite.Permissions.Graph
    def apply_change({graph, fks} = state, roots, change) do
      updated =
        Enum.reduce(roots, graph, fn root, graph ->
          case change do
            %Changes.DeletedRecord{relation: relation, old_record: %{"id" => id}} ->
              Graph.delete_vertex(graph, {relation, [id]})

            %Changes.NewRecord{relation: relation, record: %{"id" => id} = record} ->
              case parent(state, root, relation, record) do
                nil ->
                  Graph.add_vertex(graph, {relation, [id]})

                parent ->
                  validate_fk!(graph, parent)

                  Graph.add_edge(graph, {relation, [id]}, parent)
              end

            # we copy the satellite and treat all updates as upserts
            %Changes.UpdatedRecord{} = change ->
              %{relation: relation, old_record: old, record: %{"id" => id} = new} = change

              case modified_fks(state, root, change) do
                [] ->
                  graph

                modified_keys ->
                  child = {relation, [id]}

                  Enum.reduce(modified_keys, graph, fn
                    {^relation, _old_id, _new_id}, graph ->
                      old_parent = parent(state, root, relation, old)
                      new_parent = parent(state, root, relation, new)

                      validate_fk!(graph, new_parent)

                      graph
                      |> Graph.delete_edge(child, old_parent)
                      |> Graph.add_edge(child, new_parent)

                    {fk_relation, old_id, new_id}, graph ->
                      old_parent = {fk_relation, old_id}
                      new_parent = {fk_relation, new_id}
                      validate_fk!(graph, new_parent)

                      graph
                      |> Graph.delete_edge(child, old_parent)
                      |> Graph.add_edge(child, new_parent)
                  end)
              end
          end
        end)

      {updated, fks}
    end

    defp validate_fk!(graph, parent) do
      unless Graph.has_vertex?(graph, parent) do
        raise Permissions.Graph.Error,
          message: "foreign key reference to non-existent record #{inspect(parent)}"
      end
    end

    @impl Electric.Satellite.Permissions.Graph
    def relation_path({_graph, fks}, root, relation) do
      fk_path(fks, root, relation)
    end

    defp fk_path(_fks, root, root) do
      [root]
    end

    defp fk_path(fks, root, relation) do
      FkGraph.path(fks, root, relation)
    end
  end

  def table(relation) do
    Electric.Utils.inspect_relation(relation)
  end

  def perms_build(grants, roles, attrs \\ []) do
    attrs
    |> Perms.new()
    |> Perms.update(grants, roles)
  end
end
