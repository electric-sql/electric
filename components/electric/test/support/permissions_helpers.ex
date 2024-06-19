defmodule ElectricTest.PermissionsHelpers do
  alias Electric.Postgres.Extension.SchemaLoader

  defmodule Schema do
    alias Electric.Postgres.MockSchemaLoader

    def migrations do
      [
        {"01",
         [
           "create table users (id text primary key, name text, role text not null default 'normie')",
           "create table regions (id text primary key, name text)",
           "create table offices (id text primary key, region_id text not null references regions (id))",
           "create table workspaces (id text primary key)",
           "create table projects (id text primary key, workspace_id text not null references workspaces (id))",
           "create table issues (id text primary key, project_id text not null references projects (id), description text)",
           "create table comments (id text primary key, issue_id text not null references issues (id), comment text, owner text, author_id text references users (id))",
           "create table reactions (id text primary key, comment_id text not null references comments (id), is_public bool)",
           "create table teams (id text primary key)",
           "create table tags (id text primary key, tag text not null)",
           "create table addresses (id text primary key, user_id text not null references users (id), address text)",
           """
           create table issue_tags (
              id text primary key,
              issue_id text not null references issues (id),
              tag_id text not null references tags (id)
           )
           """,
           """
           create table project_memberships (
              id text primary key,
              user_id text not null references users (id),
              project_id text not null references projects (id),
              role text not null,
              valid bool
           )
           """,
           """
           create table team_memberships (
              id text primary key,
              user_id text not null references users (id),
              team_id text not null references teams (id),
              team_role text not null
           )
           """,
           """
           create table site_admins (
              id text primary key,
              user_id text not null references users (id),
              role text not null
           )
           """,
           """
           create table admin_users (
              id text primary key,
              user_id text not null references users (id)
           )
           """,
           """
           create table compound_root (
              id1 text,
              id2 text,
              primary key (id1, id2)
           )
           """,
           """
           create table compound_level1 (
              id1 text,
              id2 text,
              root_id1 text not null,
              root_id2 text not null,
              value1 text,
              value2 text,
              primary key (id1, id2),
              foreign key (root_id1, root_id2) references compound_root (id1, id2)
           )
           """,
           """
           create table compound_level2 (
              id1 text,
              id2 text,
              level1_id1 text not null,
              level1_id2 text not null,
              value1 text,
              value2 text,
              primary key (id1, id2),
              foreign key (level1_id1, level1_id2) references compound_level1 (id1, id2)
           )
           """,
           """
           create table compound_memberships (
              id text primary key,
              root_id1 text not null,
              root_id2 text not null,
              user_id text not null references users (id),
              role text not null,
              foreign key (root_id1, root_id2) references compound_root (id1, id2)
           )
           """,
           """
           create table lotsoftypes (
             id text primary key,
             user_id text not null,
             parent_id text not null,
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
    alias Electric.Postgres.MockSchemaLoader

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

    def update!(perms, schema_version, ddlx, roles) do
      Permissions.update!(
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

    # Generate some rules and push them into our mock loader we need to do this
    # because the schema loader is no longer responsible for saving the global
    # perms, which happens at the point of mutation (e.g. in the proxy). Without
    # knowledge of the current global perms, the `user_permissions/[23]` will
    # return user perms pointing to the wrong global permissions, which
    # wouldn't happen with a real (from pg) loader
    def rules(mock_loader, %P.Rules{} = rules) do
      {:ok, mock_loader} = MockSchemaLoader.save_global_permissions(mock_loader, rules)

      {mock_loader, rules}
    end

    def rules(mock_loader, attrs) do
      {:ok, old_rules} = SchemaLoader.global_permissions(mock_loader)

      rules = %P.Rules{
        id: old_rules.id,
        parent_id: old_rules.parent_id,
        grants: Keyword.get(attrs, :grants, []),
        assigns: Keyword.get(attrs, :assigns, [])
      }

      rules(mock_loader, Permissions.State.commit(rules))
    end

    def to_rules(ddlx) do
      ddlx
      |> make_ddlx()
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

    def make_ddlx(ddlx) do
      ddlx
      |> List.wrap()
      |> Enum.map(fn
        "ELECTRIC " <> _ = ddlx -> ddlx
        ddl -> "ELECTRIC " <> ddl
      end)
      |> Enum.map(&Electric.DDLX.parse!/1)
    end
  end

  defmodule XID do
    def new(xid) when is_integer(xid) do
      xid
    end

    def new(nil) do
      nil
    end
  end

  defmodule Chgs do
    alias Electric.Satellite.SatPerms, as: P
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

    def rules(%P.Rules{} = rules) do
      bytes = Protox.encode!(rules) |> IO.iodata_to_binary()

      # this table is append-only
      %Changes.NewRecord{
        relation: Extension.global_perms_relation(),
        record: %{
          "id" => rules.id,
          "parent_id" => rules.parent_id,
          "rules" => bytes
        }
      }
    end

    def migration(attrs \\ []) do
      attrs =
        attrs
        |> Keyword.put_new(:version, "20240425")

      struct(Changes.Migration, attrs)
    end

    defp put_tx_attrs(tx, attrs) do
      tx
      |> Map.put(:xid, XID.new(attrs[:xid]))
      |> Map.put(
        :referenced_records,
        attrs |> Access.get(:referenced_records, []) |> referenced_records()
      )
    end

    def referenced_records(rrs) when is_list(rrs) do
      rrs
      |> Enum.map(&referenced_record/1)
      |> Enum.group_by(&elem(&1, 0), &elem(&1, 1))
      |> Enum.map(fn {relation, rr} -> {relation, Map.new(rr)} end)
      |> Map.new()
    end

    defp referenced_record({relation, record}) when is_map(record) do
      pk = [Map.fetch!(record, "id")]

      {
        relation,
        {pk,
         %Changes.ReferencedRecord{
           relation: relation,
           record: record,
           pk: pk,
           tags: []
         }}
      }
    end

    defp referenced_record({relation, [id] = pk}) do
      {
        relation,
        {pk,
         %Changes.ReferencedRecord{
           relation: relation,
           record: %{"id" => id},
           pk: pk,
           tags: []
         }}
      }
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

    alias Electric.Satellite.Permissions
    alias Electric.Postgres.Schema.FkGraph
    alias Electric.Replication.ScopeGraph

    @type vertex() :: {{String.t(), String.t()}, String.t(), [vertex()]}

    @root :root

    def new(vs, schema) do
      ScopeGraph.impl(data_tree(vs, fk_graph(schema)))
    end

    defp fk_graph(%SchemaLoader.Version{schema: schema}) do
      FkGraph.for_schema(schema)
    end

    defp graph(attrs \\ []) do
      Permissions.Graph.graph(attrs)
    end

    def add_vertex({module, {graph, schema}}, v) do
      graph = Graph.add_vertex(graph, v)
      {module, {graph, schema}}
    end

    def delete_vertex({module, {graph, schema}}, v) do
      graph = Graph.delete_vertex(graph, v)
      {module, {graph, schema}}
    end

    def add_edge({module, {graph, schema}}, a, b) do
      graph = Graph.add_edge(graph, a, b)
      {module, {graph, schema}}
    end

    defp data_tree(vs, fks) do
      {_, graph} = Enum.reduce(vs, {@root, graph()}, &build_data_tree(&1, &2, fks))

      graph
    end

    defp build_data_tree({table, id, children}, {parent, graph}, fks) when is_list(children) do
      build_data_tree({table, id, %{}, children}, {parent, graph}, fks)
    end

    defp build_data_tree({table, id}, {parent, graph}, fks) do
      build_data_tree({table, id, %{}, []}, {parent, graph}, fks)
    end

    defp build_data_tree({table, _id, attrs, children} = v, {parent, graph}, fks) do
      foreign_keys =
        case parent do
          {parent_table, _id, _attrs, _children} ->
            fks
            |> FkGraph.foreign_keys(table)
            |> Map.drop([parent_table])
            |> Enum.map(fn {table, cols} ->
              {table, Enum.map(cols, &Map.get(attrs, &1, nil))}
            end)
            |> Enum.reject(fn {_table, cols} -> Enum.any?(cols, &is_nil/1) end)

          @root ->
            []
        end

      graph =
        Enum.reduce(foreign_keys ++ [v(parent)], graph, fn e, g ->
          Graph.add_edge(g, v(v), e)
        end)

      {_v, graph} = Enum.reduce(children, {v, graph}, &build_data_tree(&1, &2, fks))
      {parent, graph}
    end

    defp v(@root), do: @root

    defp v({table, id, _attrs, _children}) do
      {table, List.wrap(id)}
    end
  end

  def table(relation) do
    Electric.Utils.inspect_relation(relation)
  end

  def perms_build(cxt, grants, roles, attrs \\ [])

  def perms_build(%{schema_version: schema_version}, grants, roles, attrs) do
    perms_build(schema_version, grants, roles, attrs)
  end

  def perms_build(%SchemaLoader.Version{} = schema_version, grants, roles, attrs) do
    attrs
    |> Perms.new()
    |> Perms.update!(schema_version, grants, roles)
  end

  defmodule Proto do
    alias Electric.DDLX.Command
    alias Electric.Satellite.SatPerms

    def table({schema, name}) do
      %SatPerms.Table{schema: schema, name: name}
    end

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

    def apply_change({module, state}, relations, tx) do
      state = module.apply_change(state, relations, tx)
      {module, state}
    end

    def validate_write(perms, tree, tx) do
      Permissions.validate_write(perms, tree, tx)
    end
  end
end
