defmodule Electric.Postgres.Proxy.DDLXModificationTest do
  use ExUnit.Case, async: true
  use Electric.Postgres.MockSchemaLoader

  alias PgProtocol.Message, as: M
  alias Electric.Postgres.Proxy.Injector
  alias Electric.DDLX
  alias Electric.Satellite.Permissions

  alias Electric.Postgres.Proxy.TestScenario

  import Electric.Postgres.Proxy.TestScenario

  @projects "CREATE TABLE public.projects (id uuid PRIMARY KEY, name text)"
  setup do
    # enable all the optional ddlx features
    Electric.Features.process_override(
      proxy_grant_write_permissions: true,
      proxy_ddlx_sqlite: true
    )

    migrations = [
      {"0001",
       [
         "CREATE TABLE public.users (id uuid PRIMARY KEY, name text)",
         @projects,
         "CREATE TABLE public.project_memberships (id uuid PRIMARY KEY, project_id uuid REFERENCES projects (id), user_id uuid REFERENCES users (id), role text)",
         "CREATE TABLE public.issues (id uuid PRIMARY KEY, name text, project_id uuid REFERENCES projects (id))"
       ]}
    ]

    spec = MockSchemaLoader.backend_spec(migrations: migrations)

    {:ok, loader} = SchemaLoader.connect(spec, [])

    {:ok, injector} =
      Injector.new(
        [loader: loader, query_generator: TestScenario.MockInjector],
        username: "electric",
        database: "electric"
      )

    {:ok, rules} = SchemaLoader.global_permissions(loader)

    %{injector: injector, loader: loader, rules: rules}
  end

  defp rules(rules, stmts) do
    stmts
    |> Enum.map(fn stmt ->
      {:ok, command} = DDLX.parse(stmt)

      {stmt, command}
    end)
    |> Enum.map_reduce(rules, fn {stmt, command}, rules ->
      {{stmt, command}, Permissions.State.apply_ddlx_txn!(command.action, rules)}
    end)
    |> then(fn {stmts, rules} ->
      {stmts, Permissions.State.commit(rules)}
    end)
  end

  test "ddlx updates are saved", cxt do
    ddlx = [
      "ELECTRIC ASSIGN (projects, project_memberships.role) TO project_memberships.user_id",
      "ELECTRIC GRANT ALL ON projects TO 'member'"
    ]

    {[{ddlx1, command1}, {ddlx2, command2}], rules} = rules(cxt.rules, ddlx)

    cxt.injector
    |> electric_begin(client: begin())
    |> electric_preamble([client: ddlx1], command1)
    |> server(
      introspect_result(@projects),
      client: [complete_ready("ELECTRIC ASSIGN", :tx)]
    )
    |> electric_preamble([client: ddlx2], command2)
    |> server(
      introspect_result(@projects),
      client: [complete_ready("ELECTRIC GRANT", :tx)]
    )
    |> client(commit(), server: [activate_write_mode_query({"public", "projects"})])
    |> server(complete_ready(), server: [save_permissions_rules_query(rules)])
    |> server(complete_ready(), server: [capture_version_query()])
    |> server(complete_ready(), server: commit())
    |> server(complete_ready("COMMIT", :idle))
  end

  test "electrification commands are passed through", cxt do
    ddlx = "ALTER TABLE something ENABLE ELECTRIC"
    table_schema = "create table something (id uuid primary key, value text)"
    {:ok, command} = DDLX.parse(ddlx)
    [call] = proxy_sql(command, table_schema)

    cxt.injector
    |> electric_begin([client: begin()], rules: cxt.rules)
    |> electric_preamble([client: ddlx], command)
    |> server(introspect_result(table_schema), server: [call])
    |> server(electric_call_complete(),
      client: [complete_ready("ELECTRIC ENABLE", :tx)]
    )
    |> client(commit(), server: [capture_version_query()])
    |> server(complete_ready(), server: commit())
    |> server(complete_ready("COMMIT", :idle))
  end

  test "psycopg ddlx", cxt do
    ddlx = [
      "ELECTRIC ASSIGN (projects, project_memberships.role) TO project_memberships.user_id",
      "ELECTRIC GRANT ALL ON projects TO 'member'"
    ]

    {[{ddlx1, command1}, {ddlx2, command2}], rules} = rules(cxt.rules, ddlx)

    cxt.injector
    |> electric_begin(
      [
        client: [%M.Parse{query: "BEGIN"}, %M.Bind{}, %M.Describe{}, %M.Execute{}, %M.Sync{}]
      ],
      client: [
        %M.ParseComplete{},
        %M.BindComplete{},
        %M.NoData{},
        %M.CommandComplete{tag: "BEGIN"},
        %M.ReadyForQuery{status: :tx}
      ]
    )
    |> electric_preamble([client: [%M.Query{query: ddlx1}]], command1)
    |> server(
      introspect_result(@projects),
      client: [complete_ready("ELECTRIC ASSIGN", :tx)]
    )
    |> electric_preamble([client: ddlx2], command2)
    |> server(
      introspect_result(@projects),
      client: [complete_ready("ELECTRIC GRANT", :tx)]
    )
    |> client(
      [
        %M.Parse{name: "", query: "COMMIT", params: []},
        %M.Bind{},
        %M.Describe{},
        %M.Execute{},
        %M.Sync{}
      ],
      server: [activate_write_mode_query({"public", "projects"})]
    )
    |> server(complete_ready(), server: [save_permissions_rules_query(rules)])
    |> server(complete_ready(), server: [capture_version_query()])
    |> server(complete_ready(), server: commit())
    |> server(complete_ready("COMMIT", :idle),
      client: [
        %M.ParseComplete{},
        %M.BindComplete{},
        %M.NoData{},
        %M.CommandComplete{tag: "COMMIT"},
        %M.ReadyForQuery{status: :idle}
      ]
    )
  end

  test "granting write perms to table creates triggers and shadow tables", cxt do
    ddlx = [
      "ELECTRIC GRANT ALL ON projects TO 'member'"
    ]

    {[{ddlx1, command1}], rules} = rules(cxt.rules, ddlx)

    cxt.injector
    |> electric_begin([client: begin()], rules: cxt.rules)
    |> electric_preamble([client: ddlx1], command1)
    |> server(
      introspect_result(@projects),
      client: [complete_ready("ELECTRIC GRANT", :tx)]
    )
    |> client(commit(), server: [activate_write_mode_query({"public", "projects"})])
    |> server(complete_ready(), server: [save_permissions_rules_query(rules)])
    |> server(complete_ready(), server: [capture_version_query()])
    |> server(complete_ready(), server: commit())
    |> server(complete_ready("COMMIT", :idle))
  end

  test "granting read perms to table does not create triggers and shadow tables", cxt do
    ddlx = [
      "ELECTRIC GRANT READ ON projects TO 'member'"
    ]

    {[{ddlx1, command1}], rules} = rules(cxt.rules, ddlx)

    cxt.injector
    |> electric_begin([client: begin()], rules: cxt.rules)
    |> electric_preamble([client: ddlx1], command1)
    |> server(
      introspect_result(@projects),
      client: [complete_ready("ELECTRIC GRANT", :tx)]
    )
    |> client(commit(), server: [save_permissions_rules_query(rules)])
    |> server(complete_ready(), server: [capture_version_query()])
    |> server(complete_ready(), server: commit())
    |> server(complete_ready("COMMIT", :idle))
  end

  test "add column to writable table triggers modification to shadow", cxt do
  end
end
