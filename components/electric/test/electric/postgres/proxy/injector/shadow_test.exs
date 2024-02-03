defmodule Electric.Postgres.Proxy.Injector.ShadowTest do
  use ExUnit.Case, async: true

  alias Electric.Postgres.Proxy.Injector.Shadow

  import Electric.Postgres.Proxy.TestScenario

  setup do
    {:ok, injector} = Shadow.injector()
    {:ok, injector: injector}
  end

  describe "extended protocol" do
    test "shortcuts DDLX", cxt do
      cxt.injector
      |> client(begin())
      |> server(complete_ready("BEGIN", :tx))
      |> client(parse_describe("SELECT * FROM something"))
      |> server(parse_describe_complete())
      |> client(bind_execute())
      |> server(bind_execute_complete())
      |> client(
        parse_describe("ALTER TABLE public.items ENABLE ELECTRIC"),
        server: [],
        client: parse_describe_complete()
      )
      |> client(bind_execute(), client: bind_execute_complete("ELECTRIC ENABLE"), server: [])
      |> client(commit())
      |> server(complete_ready("COMMIT", :idle))
      |> idle!(Shadow)
    end
  end

  describe "simple protocol" do
    test "shortcuts DDLX", cxt do
      cxt.injector
      |> client(begin())
      |> server(complete_ready("BEGIN", :tx))
      |> client(query("SELECT * FROM something"))
      |> server(complete_ready("SELECT 1", :tx))
      |> client(query("ALTER TABLE public.items ENABLE ELECTRIC"),
        server: [],
        client: complete_ready("ELECTRIC ENABLE", :tx)
      )
      |> client(commit())
      |> server(complete_ready("COMMIT", :idle))
      |> idle!(Shadow)
    end

    test "shortcuts DDLX within multiple commands", cxt do
      cxt.injector
      |> client(begin())
      |> server(complete_ready("BEGIN", :tx))
      |> client(
        query("""
        CREATE TABLE something (id uuid PRIMARY KEY);
        CREATE TABLE something_else (id uuid PRIMARY KEY);

        ALTER TABLE something ENABLE ELECTRIC;
        ALTER TABLE something_else ENABLE ELECTRIC;

        ELECTRIC GRANT ALL ON something TO 'admin';

        CREATE TABLE fish (id uuid PRIMARY KEY);
        ELECTRIC GRANT ALL ON something_else TO 'admin';
        """),
        server: [
          query("CREATE TABLE something (id uuid PRIMARY KEY)"),
          query("CREATE TABLE something_else (id uuid PRIMARY KEY)"),
          query("CREATE TABLE fish (id uuid PRIMARY KEY)")
        ]
      )
      |> server(
        [
          complete("CREATE TABLE"),
          complete("CREATE TABLE"),
          complete("CREATE TABLE"),
          ready(:tx)
        ],
        client: [
          complete("CREATE TABLE"),
          complete("CREATE TABLE"),
          complete("ELECTRIC ENABLE"),
          complete("ELECTRIC ENABLE"),
          complete("ELECTRIC GRANT"),
          complete("CREATE TABLE"),
          complete("ELECTRIC GRANT"),
          ready(:tx)
        ]
      )
      |> client(commit())
      |> server(complete_ready("COMMIT", :idle))
      |> idle!(Shadow)
    end
  end
end
