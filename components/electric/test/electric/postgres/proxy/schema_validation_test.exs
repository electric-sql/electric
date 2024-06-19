defmodule Electric.Postgres.Proxy.SchemaValidationTest do
  use ExUnit.Case, async: true

  alias Electric.DDLX
  alias Electric.Postgres.NameParser
  alias Electric.Postgres.Proxy.Injector
  alias Electric.Postgres.Proxy.TestScenario
  alias Electric.Postgres.Extension.SchemaLoader
  alias Electric.Postgres.MockSchemaLoader

  import Electric.Postgres.Proxy.TestScenario
  import Electric.Utils, only: [inspect_relation: 1]

  defmodule Simple do
    def name, do: "simple protocol"
    def tag, do: :simple

    def ddl(injector, ddl, tag, state) do
      ddl = String.trim_trailing(ddl)

      injector
      |> client(ddl)
      |> server(complete_ready(tag, state))
    end

    def ddlx_ok(injector, ddlx, ddl, state) do
      {:ok, command} = DDLX.parse(ddlx)

      electric(
        injector,
        [client: ddlx],
        command,
        ddl,
        client: complete_ready(command.tag, state)
      )
    end

    def ddlx_error(injector, ddlx, ddl, _state) do
      {:ok, command} = DDLX.parse(ddlx)

      injector
      |> electric_preamble([client: ddlx], command)
      |> server(introspect_result(ddl), client: [error(), ready(:failed)])
    end
  end

  defmodule Extended do
    def name, do: "extended protocol"
    def tag, do: :extended

    def ddl(injector, ddl, tag, state) do
      ddl = String.trim_trailing(ddl)

      injector
      |> client(parse_describe(ddl))
      |> server(parse_describe_complete())
      |> client(bind_execute())
      |> server(bind_execute_complete(tag, state))
    end

    def ddlx_ok(injector, ddlx, ddl, state) do
      {:ok, command} = DDLX.parse(ddlx)

      injector
      |> client(parse_describe(ddlx), client: parse_describe_complete(), server: [])
      |> electric(
        [client: bind_execute()],
        command,
        ddl,
        client: bind_execute_complete(command.tag, state)
      )
    end

    def ddlx_error(injector, ddlx, ddl, _state) do
      {:ok, command} = DDLX.parse(ddlx)

      injector
      |> client(parse_describe(ddlx), client: parse_describe_complete(), server: [])
      |> electric_preamble([client: bind_execute()], command)
      |> server(introspect_result(ddl), client: [error(), ready(:failed)])
    end
  end

  defp txn(injector) do
    electric_begin(injector, client: begin())
  end

  defp start_transaction(cxt) do
    Map.update!(cxt, :injector, &txn/1)
  end

  defp electrify(injector, scenario, name, columns, state \\ :tx) do
    relation = NameParser.parse!(name)

    ddl = create_table_ddl(name, columns)

    scenario.ddlx_ok(
      injector,
      "ALTER TABLE #{inspect_relation(relation)} ENABLE ELECTRIC",
      ddl,
      state
    )
  end

  defp create_table(injector, scenario, name, columns, state \\ :tx) do
    ddl = create_table_ddl(name, columns)
    scenario.ddl(injector, ddl, "CREATE TABLE", state)
  end

  defp create_table_ddl({_, _} = relation, columns) do
    "CREATE TABLE #{inspect_relation(relation)} (\n#{Enum.join(columns, ",\n")})"
  end

  defp create_table_ddl(name, columns) when is_binary(name) do
    create_table_ddl({"public", name}, columns)
  end

  defp grant_valid(injector, scenario, name, columns, permission, state \\ :tx) do
    ddlx = grant(name, permission)
    ddlx_valid(injector, scenario, ddlx, name, columns, state)
  end

  defp grant_error(injector, scenario, name, columns, permission, state \\ :tx) do
    ddlx = grant(name, permission)
    ddlx_error(injector, scenario, ddlx, name, columns, state)
  end

  defp ddlx_valid(injector, scenario, ddlx, name, columns, state) do
    ddl = create_table_ddl(name, columns)

    scenario.ddlx_ok(injector, ddlx, ddl, state)
  end

  defp ddlx_error(injector, scenario, ddlx, name, columns, _state) do
    ddl = create_table_ddl(name, columns)

    scenario.ddlx_error(injector, ddlx, ddl, :tx)
  end

  defp grant(name, permission) do
    relation = {"public", name}
    "ELECTRIC GRANT #{permission} ON #{inspect_relation(relation)} TO 'some-role'"
  end

  setup do
    # enable all the optional ddlx features
    Electric.Features.process_override(
      proxy_grant_write_permissions: true,
      proxy_ddlx_sqlite: true
    )

    migrations = [
      {"0001",
       [
         "CREATE TABLE public.truths (id uuid PRIMARY KEY, value text)",
         "CREATE INDEX truths_idx ON public.truths (value)"
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

    %{injector: injector}
  end

  describe "electrification:" do
    # run inside an explicit tx to make the interaction simpler
    setup [:start_transaction]

    test "succeeds with a valid schema", cxt do
      ddl = "CREATE TABLE public.i_am_ok (id uuid PRIMARY KEY, value TEXT UNIQUE)"
      ddlx = "ALTER TABLE i_am_ok ENABLE ELECTRIC"
      {:ok, command} = DDLX.parse(ddlx)

      cxt.injector
      |> electric_preamble([client: ddlx], command)
      |> server(introspect_result([ddl]),
        server: "CALL electric.electrify_with_ddl('public', 'i_am_ok', $query$#{ddl}$query$);\n"
      )
      |> server(complete_ready("CALL", :tx),
        client: complete_ready("ELECTRIC ENABLE", :tx)
      )
      |> client(commit(), server: capture_version_query())
      |> server(complete_ready("CALL", :tx), server: commit())
      |> server(complete_ready("COMMIT", :idle))
      |> idle!()
    end

    test "fails with an invalid schema", cxt do
      ddl = "CREATE TABLE public.i_am_bad (id uuid, value cidr)"
      ddlx = "ALTER TABLE i_am_bad ENABLE ELECTRIC"
      {:ok, command} = DDLX.parse(ddlx)

      cxt.injector
      |> electric_preamble([client: ddlx], command)
      |> server(introspect_result([ddl]),
        client: [error(), ready(:failed)]
      )
      |> client(rollback())
      |> server(complete_ready("ROLLBACK", :idle))
      |> idle!()
    end

    test "fails when fk refers to un-electrified table", cxt do
      ddl =
        """
        CREATE TABLE public.i_am_bad (
          id uuid PRIMARY KEY,
          value text, 
          other_id uuid references public.others (id)
        )
        """

      ddlx = "ALTER TABLE i_am_bad ENABLE ELECTRIC"
      {:ok, command} = DDLX.parse(ddlx)

      cxt.injector
      |> electric_preamble([client: ddlx], command)
      |> server(introspect_result([ddl]),
        client: [error(), ready(:failed)]
      )
      |> client(rollback())
      |> server(complete_ready("ROLLBACK", :idle))
      |> idle!()
    end
  end

  @scenarios [Simple, Extended]

  describe "granting permissions" do
    # run inside an explicit tx to make the interaction simpler
    setup [:start_transaction]

    for scenario <- @scenarios do
      test "#{scenario.name()} is allowed for a valid schema", cxt do
        name = "i_am_ok"

        columns = [
          "id uuid PRIMARY KEY",
          "value TEXT UNIQUE"
        ]

        cxt.injector
        |> create_table(unquote(scenario), name, columns)
        |> electrify(unquote(scenario), name, columns)
        |> grant_valid(unquote(scenario), name, columns, :SELECT)
      end

      test "#{scenario.name()} is disallowed for an invalid schema", cxt do
        name = "i_am_ok"

        columns = [
          "id uuid PRIMARY KEY",
          "value TEXT UNIQUE"
        ]

        cxt.injector
        |> create_table(unquote(scenario), name, columns)
        |> electrify(unquote(scenario), name, columns)
        |> grant_error(unquote(scenario), name, columns, :UPDATE)
      end
    end
  end

  describe "ddlx error handling" do
    test "client tx", cxt do
      name = "fish"
      relation = {"public", name}
      columns = ["id uuid PRIMARY KEY", "ip cidr"]
      ddl = create_table_ddl(relation, columns)
      ddlx = "ALTER TABLE #{name} ENABLE ELECTRIC"
      {:ok, command} = DDLX.parse(ddlx)

      cxt.injector
      |> electric_begin(client: begin())
      |> electric_preamble([client: ddlx], command)
      |> server(
        introspect_result(ddl),
        client: [error(), ready(:failed)]
      )
      |> client(rollback())
      |> server(complete_ready("ROLLBACK", :idle))
      |> idle!()
    end

    test "proxy tx", cxt do
      name = "fish"
      relation = {"public", name}
      ddlx = "ALTER TABLE #{name} ENABLE ELECTRIC"
      {:ok, command} = DDLX.parse(ddlx)
      columns = ["id uuid PRIMARY KEY", "ip cidr"]
      ddl = create_table_ddl(relation, columns)

      cxt.injector
      |> client("ALTER TABLE #{name} ENABLE ELECTRIC", server: begin())
      |> server(complete_ready("BEGIN", :tx), server: permissions_rules_query())
      |> electric_preamble([server: rules_query_result()], command)
      |> server(
        introspect_result(ddl),
        server: "ROLLBACK"
      )
      |> server(complete_ready("ROLLBACK", :idle), client: [error(), ready(:failed)])
      |> idle!()
    end

    test "error prevents commit of client tx", cxt do
      name = "fish"
      relation = {"public", name}
      columns = ["id uuid PRIMARY KEY", "ip cidr"]
      ddl = create_table_ddl(relation, columns)
      ddlx = "ALTER TABLE #{name} ENABLE ELECTRIC"
      {:ok, command} = DDLX.parse(ddlx)

      cxt.injector
      |> electric_begin(client: begin())
      |> electric_preamble([client: ddlx], command)
      |> server(
        introspect_result(ddl),
        client: [error(), ready(:failed)]
      )
      |> client(commit(), client: [error(), ready(:failed)])
      |> client(rollback())
      |> server(complete_ready("ROLLBACK", :idle))
      |> idle!()
    end
  end
end
