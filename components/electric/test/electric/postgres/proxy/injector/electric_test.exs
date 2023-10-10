defmodule Electric.Postgres.Proxy.Injector.ElectricTest do
  use ExUnit.Case, async: true

  alias Electric.Postgres.MockSchemaLoader
  alias Electric.Postgres.Extension.SchemaLoader
  alias PgProtocol.Message, as: M
  alias Electric.Postgres.Proxy.{Injector, Parser}

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

      state = %Injector.State{loader: loader}

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
end
