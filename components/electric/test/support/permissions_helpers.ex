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

    def new(graph, attrs \\ []) do
      auth = Keyword.get(attrs, :auth, Auth.user())

      Permissions.new(
        auth,
        graph,
        Transient.name()
      )
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

    @type vertex() :: {{String.t(), String.t()}, String.t(), [vertex()]}

    @root :__root__

    def new(vs, fk_edges) do
      {__MODULE__, {data_tree(vs), fk_graph(fk_edges)}}
    end

    defp fk_graph(fk_edges) do
      Graph.add_edges(
        graph(),
        Enum.map(fk_edges, fn {v1, v2, label} -> {v1, v2, label: label} end)
      )
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

    @impl Electric.Satellite.Permissions.Graph
    def scope_id(state, {_, _} = root, {_, _} = relation, record) when is_map(record) do
      {table, id} = relation_id(relation, record)
      scope_id(state, root, table, id)
    end

    def scope_id(_state, {_, _} = root, {_, _} = root, id) when is_list(id) do
      {id, [{root, id}]}
    end

    def scope_id(state, {_, _} = root, {_, _} = relation, id) when is_list(id) do
      scope_root_id(state, root, relation, id)
    end

    @impl Electric.Satellite.Permissions.Graph
    def parent_scope_id({_graph, _fks} = state, {_, _} = root, {_, _} = relation, record) do
      with {parent_relation, parent_id} <- parent(state, root, relation, record) do
        scope_id(state, root, parent_relation, parent_id)
      end
    end

    @impl Electric.Satellite.Permissions.Graph
    def modifies_fk?({_graph, fks}, {_, _} = root, %Changes.UpdatedRecord{} = update) do
      case relation_fk(fks, root, update.relation) do
        {:ok, _parent, fks} ->
          Enum.any?(fks, &MapSet.member?(update.changed_columns, &1))

        nil ->
          false
      end
    end

    @impl Electric.Satellite.Permissions.Graph
    def primary_key(_state, _relation, record) do
      [Map.fetch!(record, "id")]
    end

    @impl Electric.Satellite.Permissions.Graph
    def parent({_graph, fks}, {_, _} = root, relation, record) when is_map(record) do
      with {:ok, parent_relation, fks} <- relation_fk(fks, root, relation) do
        {parent_relation, Enum.map(fks, &Map.get(record, &1, nil))}
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
                  graph

                parent ->
                  Graph.add_edge(graph, {relation, [id]}, parent)
              end

            %Changes.UpdatedRecord{} = change ->
              %{relation: relation, old_record: old, record: %{"id" => id} = new} = change
              child = {relation, [id]}
              old_parent = parent(state, root, relation, old)
              new_parent = parent(state, root, relation, new)

              graph
              |> Graph.delete_edge(child, old_parent)
              |> Graph.add_edge(child, new_parent)
          end
        end)

      {updated, fks}
    end

    @impl Electric.Satellite.Permissions.Graph
    def relation_path({_graph, fks}, root, relation) do
      fk_path(fks, root, relation)
    end

    defp scope_root_id({graph, fks}, root, table, id) do
      case Permissions.Graph.traverse_fks(graph, fk_path(fks, root, table), table, id) do
        {{^root, scope_id}, path} -> {scope_id, path}
        _ -> nil
      end
    end

    defp relation_fk(_fks, {_, _} = root, root) do
      nil
    end

    defp relation_fk(fks, {_, _} = root, relation) do
      # we guard against looking for a fk ref to the same table above so relation_path/3 is always
      # going to return a list of at least 2 items

      with [_ | _] = path <- fk_path(fks, root, relation) do
        edge =
          path
          |> Enum.chunk_every(2, 1, :discard)
          |> Enum.take(1)
          |> Enum.map(fn [a, b] -> Graph.edges(fks, a, b) |> List.first() end)
          |> hd()

        case edge do
          nil -> nil
          %Graph.Edge{v1: ^relation, v2: parent, label: fk} -> {:ok, parent, fk}
          %Graph.Edge{v1: parent, v2: ^relation, label: fk} -> {:ok, parent, fk}
        end
      end
    end

    defp fk_path(_fks, root, root) do
      [root]
    end

    defp fk_path(fks, root, relation) do
      if path = Graph.get_shortest_path(fks, relation, root) do
        path
      else
        # in the case of a join table, the relation doesn't point to anything,
        # but the join table points at it. so `get_shortest_path` returns nil
        # we deal with that case here by finding tables that point to us
        # and attempting to find their relation with the scope root
        # (that may end up being recursive \o/)
        fks
        |> Graph.in_neighbors(relation)
        |> Enum.find_value(&fk_path(fks, root, &1))
        |> then(fn
          nil -> nil
          path when is_list(path) -> [relation | path]
        end)
      end
    end

    defp relation_id(relation, %{"id" => id}) do
      {relation, [id]}
    end
  end

  def table(relation) do
    Electric.Utils.inspect_relation(relation)
  end

  def perms_build(tree_or_context, grants, roles, attrs \\ [])

  def perms_build(%{tree: tree} = _cxt, grants, roles, attrs) do
    perms_build(tree, grants, roles, attrs)
  end

  def perms_build({_, _} = tree, grants, roles, attrs) do
    tree
    |> Perms.new(attrs)
    |> Perms.update(grants, roles)
  end
end
