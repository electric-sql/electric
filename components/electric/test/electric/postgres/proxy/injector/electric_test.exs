defmodule Electric.Postgres.Proxy.Injector.ElectricTest do
  use ExUnit.Case, async: true

  alias Electric.Postgres.MockSchemaLoader
  alias Electric.Postgres.Extension.SchemaLoader
  alias PgProtocol.Message, as: M
  alias Electric.Postgres.Proxy.{Injector, Parser}
  alias Electric.Postgres.Proxy.TestScenario

  alias ElectricTest.PermissionsHelpers.Perms

  def simple(sql), do: %M.Query{query: sql}

  def analyse(sql, cxt) when is_binary(sql) do
    analyse(simple(sql), cxt)
  end

  def analyse(msg, cxt) do
    with {:ok, stmts} <- Parser.parse(msg) do
      Enum.map(stmts, &Parser.analyse(&1, cxt.state))
    end
  end

  describe "requires_tx?/2" do
    setup do
      migrations = [
        {"0001",
         [
           "CREATE TABLE public.truths (id uuid PRIMARY KEY, value text)",
           "CREATE INDEX truths_idx ON public.truths (value)"
         ]}
      ]

      spec = MockSchemaLoader.backend_spec(migrations: migrations)

      {:ok, loader} =
        SchemaLoader.connect(spec, [])

      rules = Perms.to_rules([])

      state =
        %Injector.State{loader: loader}
        |> Injector.State.begin()
        |> Injector.State.tx_permissions(rules)

      {:ok, state: state, loader: loader}
    end

    test "select, update, delete non-electrified", cxt do
      sql = """
      SELECT * FROM something;
      DELETE FROM something;
      UPDATE something SET available = true;
      """

      refute Injector.Electric.requires_tx?(analyse(sql, cxt))
    end

    test "select, update, delete electrified", cxt do
      sql = """
      SELECT * FROM public.truths;
      DELETE FROM public.truths;
      UPDATE public.truths SET available = true;
      """

      refute Injector.Electric.requires_tx?(analyse(sql, cxt))
    end

    test "insert schema migration", cxt do
      sql = """
      SELECT * FROM public.truths;
      DELETE FROM public.truths;
      INSERT INTO public.schema_migrations (inserted_at, version) values ('2023-10-05T10:24:17', '1234567890');
      """

      refute Injector.Electric.requires_tx?(analyse(sql, cxt))
    end

    test "ddl statements", cxt do
      sql = """
      SELECT * FROM public.truths;
      ALTER TABLE anything ADD bananas text;
      """

      assert Injector.Electric.requires_tx?(analyse(sql, cxt))
    end

    test "ELECTRIC *", cxt do
      sql = """
      SELECT * FROM public.truths;
      ALTER TABLE anything ADD bananas text;
      ALTER TABLE anything ENABLE ELECTRIC;
      """

      assert Injector.Electric.requires_tx?(analyse(sql, cxt))
    end
  end

  describe "disabling ddlx via feature flags" do
    setup do
      # the injector tests override the default feature flags to ensure that 
      # all ddlx features are enabled, so we need tests that validate 
      # the behaviour when the features are disabled
      Electric.Features.process_override(
        proxy_grant_write_permissions: false,
        proxy_ddlx_sqlite: false
      )

      ddl = "CREATE TABLE public.items (id uuid PRIMARY KEY, value text)"

      migrations = [
        {"0001",
         [
           ddl,
           "CREATE INDEX items_idx ON public.items (value)"
         ]}
      ]

      spec = MockSchemaLoader.backend_spec(migrations: migrations)

      {:ok, loader} =
        SchemaLoader.connect(spec, [])

      {:ok, injector} =
        Injector.new(
          [loader: loader, query_generator: TestScenario.MockInjector],
          username: "electric",
          database: "electric"
        )

      {:ok, ddl: ddl, injector: injector}
    end

    for scenario <- TestScenario.scenarios() do
      setup do
        {:ok, scenario: unquote(scenario)}
      end

      test "#{scenario.description()} ELECTRIC ENABLE", cxt do
        query = "ALTER TABLE public.items ENABLE ELECTRIC;"

        for framework <- TestScenario.frameworks() do
          cxt.scenario.assert_valid_electric_command(cxt.injector, framework, query, ddl: cxt.ddl)
        end
      end

      test "#{scenario.description()} ELECTRIC GRANT READ", cxt do
        query =
          "ELECTRIC GRANT READ ON public.items TO (projects, 'house.admin') WHERE (name = Paul);"

        for framework <- TestScenario.frameworks() do
          cxt.scenario.assert_valid_electric_command(cxt.injector, framework, query, ddl: cxt.ddl)
        end
      end

      test "#{scenario.description()} ELECTRIC GRANT WRITE", cxt do
        query =
          "ELECTRIC GRANT UPDATE ON public.items TO (projects, 'house.admin') WHERE (name = Paul);"

        cxt.scenario.assert_injector_error(cxt.injector, query, code: "EX900")
      end

      test "#{scenario.description()} ELECTRIC SQLITE", cxt do
        query =
          "ELECTRIC SQLITE $$create table local_table (id text primary key)$$;"

        cxt.scenario.assert_injector_error(cxt.injector, query, code: "EX900")
      end
    end
  end
end
