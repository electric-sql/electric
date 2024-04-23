defmodule ElectricTest.PermissionsHelpers do
  defmodule Schema do
    alias Electric.Postgres.MockSchemaLoader
    alias Electric.Postgres.Extension.SchemaLoader

    def migrations do
      [
        {"01",
         [
           "create table regions (id uuid primary key, name text)",
           "create table offices (id uuid primary key, region_id uuid not null references regions (id))",
           "create table workspaces (id uuid primary key)",
           "create table projects (id uuid primary key, workspace_id uuid not null references workspaces (id))",
           "create table issues (id uuid primary key, project_id uuid not null references projects (id), description text)",
           "create table comments (id uuid primary key, issue_id uuid not null references issues (id), comment text, owner text, author_id uuid references users (id))",
           "create table reactions (id uuid primary key, comment_id uuid not null references comments (id), is_public bool)",
           "create table users (id uuid primary key, role text not null default 'normie')",
           "create table teams (id uuid primary key)",
           "create table tags (id uuid primary key, tag text not null)",
           "create table addresses (id uuid primary key, user_id uuid not null references users (id), address text)",
           """
           create table issue_tags (
              id uuid primary key,
              issue_id uuid not null references issues (id),
              tag_id uuid not null references tags (id)
           )
           """,
           """
           create table project_memberships (
              id uuid primary key,
              user_id uuid not null references users (id),
              project_id uuid not null references projects (id),
              role text not null,
              valid bool
           )
           """,
           """
           create table team_memberships (
              id uuid primary key,
              user_id uuid not null references users (id),
              team_id uuid not null references teams (id),
              team_role text not null
           )
           """,
           """
           create table site_admins (
              id uuid primary key,
              user_id uuid not null references users (id),
              role text not null
           )
           """,
           """
           create table admin_users (
              id uuid primary key,
              user_id uuid not null references users (id)
           )
           """,
           """
           create table compound_root (
              id1 uuid,
              id2 uuid,
              primary key (id1, id2)
           )
           """,
           """
           create table compound_level1 (
              id1 uuid,
              id2 uuid,
              root_id1 uuid not null,
              root_id2 uuid not null,
              value1 text,
              value2 text,
              primary key (id1, id2),
              foreign key (root_id1, root_id2) references compound_root (id1, id2)
           )
           """,
           """
           create table compound_level2 (
              id1 uuid,
              id2 uuid,
              level1_id1 uuid not null,
              level1_id2 uuid not null,
              value1 text,
              value2 text,
              primary key (id1, id2),
              foreign key (level1_id1, level1_id2) references compound_level1 (id1, id2)
           )
           """,
           """
           create table compound_memberships (
              id uuid primary key,
              root_id1 uuid not null,
              root_id2 uuid not null,
              user_id uuid not null references users (id),
              role text not null,
              foreign key (root_id1, root_id2) references compound_root (id1, id2)
           )
           """,
           """
           create table lotsoftypes (
             id uuid primary key,
             user_id uuid not null,
             parent_id uuid not null,
             name text,
             value text,
             amount integer,
             valid bool,
             percent float,
             ilist integer[],
             slist text[],
             inserted_at timestamp with time zone
           )
           """
         ]}
      ]
    end

    def loader(migrations \\ migrations()) do
      loader_spec =
        MockSchemaLoader.backend_spec(migrations: migrations)

      {:ok, _loader} = SchemaLoader.connect(loader_spec, [])
    end

    def load(migrations \\ migrations()) do
      {:ok, loader} = loader(migrations)

      {:ok, _schema_version} = SchemaLoader.load(loader)
    end
  end

  defmodule Auth do
    def user_id do
      "92bafe18-a818-4a3f-874f-590324140478"
    end

    def not_user_id do
      "e0a09d39-d620-4a28-aa18-8d3eacc5da4e"
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

    def update(perms, schema_version, ddlx, roles) do
      Permissions.update(
        perms,
        schema_version,
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
      |> Enum.reduce(
        {%P.Rules{}, {1, 1}},
        fn %{action: %{assigns: assigns, grants: grants}}, {rules, {assign_id, grant_id}} ->
          # give all the rules deterministic ids based on order
          # which makes it easier to assign roles to rules in tests
          {assigns, assign_id} =
            Enum.map_reduce(assigns, assign_id, fn assign, id ->
              {%{assign | id: "assign-#{id}"}, id + 1}
            end)

          {grants, grant_id} =
            Enum.map_reduce(grants, grant_id, fn grant, id ->
              {%{grant | id: "grant-#{id}"}, id + 1}
            end)

          {%{
             rules
             | assigns: rules.assigns ++ assigns,
               grants: rules.grants ++ grants
           }, {assign_id, grant_id}}
        end
      )
      |> then(&elem(&1, 0))
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
    alias Electric.DDLX.Command
    alias Electric.Replication.Changes
    alias Electric.Postgres.Extension

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

    def ddlx(attrs) when is_list(attrs) do
      attrs
      |> Command.ddlx()
      |> ddlx()
    end

    def ddlx(ddlx) do
      bytes = Protox.encode!(ddlx) |> IO.iodata_to_binary()

      %Changes.NewRecord{
        relation: Extension.ddlx_relation(),
        record: %{
          "ddlx" => bytes
        }
      }
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

    def role(role_name, assign_id) do
      %P.Role{role: role_name, assign_id: assign_id}
    end

    def role(role_name, table, id, assign_id, attrs \\ []) do
      struct(
        %P.Role{
          assign_id: assign_id,
          role: role_name,
          user_id: Keyword.get(attrs, :user_id, Auth.user_id()),
          scope: %P.Scope{table: relation(table), id: List.wrap(id)}
        },
        attrs
      )
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

    alias Electric.Postgres.Extension.SchemaLoader
    alias Electric.Replication.Changes
    alias Electric.Satellite.Permissions
    alias Electric.Postgres.Schema.FkGraph

    @type vertex() :: {{String.t(), String.t()}, String.t(), [vertex()]}

    @root :__root__

    def new(vs, schema) do
      {__MODULE__, {data_tree(vs), fk_graph(schema), schema}}
    end

    defp fk_graph(%SchemaLoader.Version{schema: schema}) do
      FkGraph.for_schema(schema)
    end

    defp graph(attrs \\ []) do
      Permissions.Graph.graph(attrs)
    end

    def add_vertex({__MODULE__, {graph, fks, schema}}, v) do
      graph = Graph.add_vertex(graph, v)
      {__MODULE__, {graph, fks, schema}}
    end

    def delete_vertex({__MODULE__, {graph, fks, schema}}, v) do
      graph = Graph.delete_vertex(graph, v)
      {__MODULE__, {graph, fks, schema}}
    end

    def add_edge({__MODULE__, {graph, fks, schema}}, a, b) do
      graph = Graph.add_edge(graph, a, b)
      {__MODULE__, {graph, fks, schema}}
    end

    defp data_tree(vs) do
      {_, graph} = Enum.reduce(vs, {@root, graph()}, &build_data_tree/2)

      graph
    end

    defp build_data_tree({table, id, children}, {parent, graph}) when is_list(children) do
      build_data_tree({table, id, %{}, children}, {parent, graph})
    end

    defp build_data_tree({table, id}, {parent, graph}) do
      build_data_tree({table, id, %{}, []}, {parent, graph})
    end

    defp build_data_tree({_table, _id, _attrs, children} = v, {parent, graph}) do
      graph = Graph.add_edge(graph, v(v), v(parent))

      {_v, graph} = Enum.reduce(children, {v, graph}, &build_data_tree/2)
      {parent, graph}
    end

    defp v(@root), do: @root

    defp v({table, id, _attrs, _children}) do
      {table, List.wrap(id)}
    end

    def scope_id(_state, {_, _} = root, {_, _} = root, id) when is_list(id) do
      [{id, [{root, id}]}]
    end

    def scope_id({graph, fks, _schema}, {_, _} = root, {_, _} = relation, id) when is_list(id) do
      graph
      |> Permissions.Graph.traverse_fks(fk_path(fks, root, relation), relation, id)
      |> Enum.flat_map(fn
        {{^root, id}, path} -> [{id, path}]
        _other -> []
      end)
    end

    @impl Electric.Satellite.Permissions.Graph
    def scope_path({graph, fks, _schema}, {_, _} = root, {_, _} = relation, id)
        when is_list(id) do
      graph
      |> Permissions.Graph.traverse_fks(fk_path(fks, root, relation), relation, id)
      |> Enum.flat_map(fn
        [{^root, _id} | _] = path -> [Enum.map(path, fn {relation, id} -> {relation, id, []} end)]
        _other -> []
      end)
    end

    @impl Electric.Satellite.Permissions.Graph
    def modified_fks(
          {_graph, fks, _schema} = state,
          {_, _} = root,
          %Changes.UpdatedRecord{} = update
        ) do
      %Changes.UpdatedRecord{
        changed_columns: changed_columns,
        old_record: old,
        record: new,
        relation: relation
      } = update

      case FkGraph.foreign_keys(fks, root, relation) do
        nil ->
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
    def parent({_graph, fks, _schema}, {_, _} = root, relation, record) when is_map(record) do
      with [^relation, parent_rel | _] <- FkGraph.path(fks, root, relation),
           [_ | _] = relations <- FkGraph.foreign_keys(fks, root, relation),
           {^parent_rel, fk_cols} <- Enum.find(relations, &match?({^parent_rel, _}, &1)) do
        {parent_rel, Enum.map(fk_cols, &Map.get(record, &1, nil))}
      else
        _ -> nil
      end
    end

    @impl Electric.Satellite.Permissions.Graph
    def apply_change({graph, fks, schema} = state, roots, change) do
      updated =
        Enum.reduce(roots, graph, fn root, graph ->
          case change do
            %Changes.DeletedRecord{relation: relation, old_record: old} ->
              {:ok, pk_cols} = SchemaLoader.Version.primary_keys(schema, relation)
              pks = Enum.map(pk_cols, &Map.fetch!(old, &1))

              Graph.delete_vertex(graph, {relation, pks})

            %Changes.NewRecord{relation: relation, record: record} ->
              {:ok, pk_cols} = SchemaLoader.Version.primary_keys(schema, relation)
              pks = Enum.map(pk_cols, &Map.fetch!(record, &1))

              case parent(state, root, relation, record) do
                nil ->
                  Graph.add_vertex(graph, {relation, pks})

                parent ->
                  validate_fk!(graph, parent)

                  Graph.add_edge(graph, {relation, pks}, parent)
              end

            # we copy the satellite and treat all updates as upserts
            %Changes.UpdatedRecord{} = change ->
              %{relation: relation, old_record: old, record: new} = change

              case modified_fks(state, root, change) do
                [] ->
                  graph

                modified_keys ->
                  {:ok, pk_cols} = SchemaLoader.Version.primary_keys(schema, relation)
                  pks = Enum.map(pk_cols, &Map.fetch!(old, &1))
                  child = {relation, pks}

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

      {updated, fks, schema}
    end

    defp validate_fk!(graph, parent) do
      unless Graph.has_vertex?(graph, parent) do
        raise Permissions.Graph.Error,
          message: "foreign key reference to non-existent record #{inspect(parent)}"
      end
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

  def perms_build(cxt, grants, roles, attrs \\ []) do
    %{schema_version: schema_version} = cxt

    attrs
    |> Perms.new()
    |> Perms.update(schema_version, grants, roles)
  end

  defmodule Proto do
    alias Electric.DDLX.Command
    alias Electric.Satellite.SatPerms

    def table(schema \\ "public", name) do
      %SatPerms.Table{schema: schema, name: name}
    end

    def scope(schema \\ "public", name) do
      table(schema, name)
    end

    def role(name) do
      %SatPerms.RoleName{role: {:application, name}}
    end

    def authenticated() do
      %SatPerms.RoleName{role: {:predefined, :AUTHENTICATED}}
    end

    def anyone() do
      %SatPerms.RoleName{role: {:predefined, :ANYONE}}
    end

    def assign(attrs) do
      SatPerms.Assign |> struct(attrs) |> Command.put_id()
    end

    def unassign(attrs) do
      SatPerms.Unassign |> struct(attrs) |> Command.put_id()
    end

    def grant(attrs) do
      SatPerms.Grant |> struct(attrs) |> Command.put_id()
    end

    def revoke(attrs) do
      SatPerms.Revoke |> struct(attrs) |> Command.put_id()
    end

    def sqlite(stmt) do
      %SatPerms.Sqlite{stmt: stmt} |> Command.put_id()
    end

    def encode(struct) do
      Protox.encode!(struct) |> IO.iodata_to_binary()
    end
  end

  defmodule Server do
    use Electric.Postgres.MockSchemaLoader

    alias ElectricTest.PermissionsHelpers.{
      Tree
    }

    alias Electric.Satellite.Permissions

    def setup(cxt) do
      %{migrations: migrations, data: data} = cxt

      loader_spec = MockSchemaLoader.backend_spec(migrations: migrations)

      {:ok, loader} = SchemaLoader.connect(loader_spec, [])
      {:ok, schema_version} = SchemaLoader.load(loader)

      {:ok, tree: Tree.new(data, schema_version), loader: loader, schema_version: schema_version}
    end

    def reset(cxt) do
      cxt
    end

    def name, do: "Server"

    def perms(cxt, grants, roles, attrs \\ []) do
      ElectricTest.PermissionsHelpers.perms_build(cxt, grants, roles, attrs)
    end

    def table(relation) do
      Electric.Utils.inspect_relation(relation)
    end

    def apply_change({Tree, tree}, roots, tx) do
      tree = Tree.apply_change(tree, roots, tx)
      {Tree, tree}
    end

    def validate_write(perms, tree, tx) do
      Permissions.validate_write(perms, tree, tx)
    end
  end
end
