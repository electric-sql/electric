defmodule Electric.Postgres.Proxy.EctoTest do
  use ExUnit.Case, async: false

  alias Electric.Postgres.Extension
  alias Electric.Postgres.Extension.SchemaLoader

  import Electric.Postgres.TestConnection

  @moduletag capture_log: true

  setup do
    context = create_test_db()

    assert {:ok, _versions} = Electric.Postgres.Extension.migrate(context.conn)

    port = 9931
    loader = {SchemaLoader.Epgsql, []}
    conn_config = [origin: "my_origin", connection: context.pg_config]

    {:ok, _proxy} =
      start_supervised({Electric.Postgres.Proxy,
       proxy: [port: port],
       handler_config: [
         loader: loader
         # injector: [capture_mode: Electric.Postgres.Proxy.Injector.Capture.Transparent]
       ],
       conn_config: conn_config})

    {:ok, _repo} =
      start_supervised(
        {Electric.Postgres.Proxy.TestRepo,
         Keyword.merge(context.pg_config, port: port, pool_size: 2)}
      )

    {:ok, Map.merge(context, %{repo: Electric.Postgres.Proxy.TestRepo})}
  end

  @tag ecto: true
  test "migrations", cxt do
    migration_path = Path.expand("../../../support/migrations/proxy/ecto", __DIR__)
    assert File.dir?(migration_path)

    Ecto.Migrator.with_repo(cxt.repo, fn repo ->
      Ecto.Migrator.run(repo, migration_path, :up, all: true)
    end)

    assert {:ok, [{1, txid1, txts1, ddl1}, {2, txid2, txts2, ddl2}]} =
             Extension.ddl_history(cxt.conn)

    assert ddl1 ==
             "CREATE TABLE table1 (\n    id text NOT NULL,\n    name text,\n    CONSTRAINT table1_pkey PRIMARY KEY (id)\n);\n\n\n"

    assert ddl2 == "ALTER TABLE \"public\".\"table1\" ADD COLUMN \"value\" text"

    assert {:ok, "20230904162657"} ==
             Extension.tx_version(cxt.conn, %{"txid" => txid1, "txts" => txts1})

    assert {:ok, "20230905122033"} ==
             Extension.tx_version(cxt.conn, %{"txid" => txid2, "txts" => txts2})
  end
end
