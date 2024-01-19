defmodule Electric.Postgres.ProxyTest do
  use ExUnit.Case, async: false

  alias Electric.Postgres.Extension
  alias Electric.Postgres.Extension.SchemaLoader
  alias Electric.Postgres.Proxy.UpstreamConnection

  import Electric.Postgres.TestConnection

  setup do
    context = create_test_db()

    assert {:ok, _versions} = Electric.Postgres.Extension.migrate(context.conn)

    port = 9931
    loader = {SchemaLoader.Epgsql, []}

    connector_config = [
      origin: "my_origin",
      connection: context.conn_opts,
      proxy: [listen: [port: port], password: "password"]
    ]

    {:ok, _proxy} =
      start_supervised({Electric.Postgres.Proxy,
       connector_config: connector_config,
       handler_config: [
         loader: loader
         # injector: [capture_mode: Electric.Postgres.Proxy.Injector.Capture.Transparent]
       ]})

    {:ok, _repo} =
      start_supervised(
        {Electric.Postgres.Proxy.TestRepo,
         Keyword.merge(context.pg_config, port: port, pool_size: 2)}
      )

    {:ok, Map.merge(context, %{repo: Electric.Postgres.Proxy.TestRepo})}
  end

  test "electrified index tracking", cxt do
    sqls = [
      "CREATE SCHEMA meadow;",
      "CREATE TABLE public.buttercup (id int4 GENERATED ALWAYS AS IDENTITY PRIMARY KEY);",
      "CREATE TABLE meadow.daisy (id int4 GENERATED ALWAYS AS IDENTITY PRIMARY KEY);",
      "CREATE TABLE public.daisy (id int4 GENERATED ALWAYS AS IDENTITY PRIMARY KEY);",
      "ALTER TABLE buttercup ENABLE ELECTRIC",
      "ALTER TABLE meadow.daisy ENABLE ELECTRIC",
      "CREATE INDEX buttercup_id_idx ON public.buttercup (id)",
      "CREATE INDEX daisy_id_idx ON meadow.daisy (id)",
      "CREATE INDEX daisy_id_idx ON public.daisy (id)"
    ]

    for sql <- sqls do
      cxt.repo.transaction(fn ->
        {:ok, _} = cxt.repo.query(sql)
      end)
    end

    assert {:ok, [_, _, _, _] = ddl} = Extension.ddl_history(cxt.conn)

    for r <- ddl do
      assert {:ok, _version} = Extension.tx_version(cxt.conn, r)
    end

    assert {:ok, true} = Extension.electrified?(cxt.conn, "public", "buttercup")
    assert {:ok, true} = Extension.electrified?(cxt.conn, "meadow", "daisy")
    assert {:ok, false} = Extension.electrified?(cxt.conn, "public", "daisy")

    assert {:ok, true} = Extension.index_electrified?(cxt.conn, "public", "buttercup_id_idx")
    assert {:ok, true} = Extension.index_electrified?(cxt.conn, "meadow", "daisy_id_idx")
    assert {:ok, false} = Extension.index_electrified?(cxt.conn, "public", "daisy_id_idx")
    assert {:ok, false} = Extension.index_electrified?(cxt.conn, "public", "parsley_id_idx")

    query = "DROP INDEX meadow.daisy_id_idx"

    cxt.repo.transaction(fn ->
      {:ok, _} = cxt.repo.query(query)
    end)

    assert {:ok, [_, _, _, _, %{"query" => ^query}]} = Extension.ddl_history(cxt.conn)

    assert {:ok, false} = Extension.index_electrified?(cxt.conn, "meadow", "daisy_id_idx")
  end

  test "gracefully handles upstream connection closure", cxt do
    cxt.repo.checkout(fn ->
      # The test Ecto repo is configured with pool size = 2. So we're expecting the proxy to establish two upstream
      # connections.
      [{pid1, mon1}, {pid2, mon2}] =
        for session_id <- Electric.reg_names(UpstreamConnection) do
          name = UpstreamConnection.name(session_id)
          pid = Electric.lookup_pid(name)
          {pid, Process.monitor(pid)}
        end

      # Terminate active backends in Postgres, causing it to close the TCP connections from the Proxy.
      terminate_all_connections(cxt.conn, cxt.db)

      # Verify that both upstream connections have shut down without errors.
      assert_receive {:DOWN, ^mon1, :process, ^pid1, :normal}
      assert_receive {:DOWN, ^mon2, :process, ^pid2, :normal}
    end)
  end
end
