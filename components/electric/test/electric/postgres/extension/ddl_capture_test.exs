defmodule Electric.Postgres.Extension.DDLCaptureTest do
  alias Postgrex.Extension
  alias Electric.Postgres.MockSchemaLoader
  alias Electric.Replication.Postgres.MigrationConsumer

  use Electric.Extension.Case,
    async: false,
    proxy: [
      listen: [
        port: 55555
      ],
      handler_config: [
        # injector: [capture_mode: Electric.Postgres.Proxy.Injector.Capture.Transparent]
        loader: MockSchemaLoader.agent_spec([], name: __MODULE__.Loader)
      ]
    ]

  test_tx "migration of non-electrified tables", fn conn ->
    sql1 = "CREATE TABLE buttercup (id int8 GENERATED ALWAYS AS IDENTITY)"
    sql2 = "CREATE TABLE daisy (id int8 GENERATED ALWAYS AS IDENTITY)"
    sql3 = "ALTER TABLE buttercup ADD COLUMN petal text"
    sql4 = "ALTER TABLE buttercup ADD COLUMN stem text, ADD COLUMN leaf text"

    for sql <- [sql1, sql2, sql3, sql4] do
      {:ok, _cols, _rows} = :epgsql.squery(conn, sql)
    end

    assert {:ok, []} = Extension.ddl_history(conn)
  end

  test_tx "ALTER electrified TABLE is captured", fn conn ->
    sql1 = "CREATE TABLE buttercup (id int GENERATED ALWAYS AS IDENTITY PRIMARY KEY)"
    sql2 = "CREATE TABLE daisy (id int GENERATED ALWAYS AS IDENTITY PRIMARY KEY)"
    sql3 = "ALTER TABLE buttercup ENABLE ELECTRIC"
    sql4 = "ALTER TABLE buttercup ADD COLUMN petal text"
    sql5 = "ALTER TABLE daisy ADD COLUMN stem text, ADD COLUMN leaf text"

    for sql <- [sql1, sql2, sql3, sql4, sql5] do
      {:ok, _cols, _rows} = :epgsql.squery(conn, sql)
    end

    assert {:ok, [ddl1, ddl2]} = Extension.ddl_history(conn)

    assert %{"id" => 1, "query" => "CREATE TABLE buttercup" <> _} = ddl1
    assert %{"id" => 2, "query" => ^sql4} = ddl2
  end

  test_tx "CREATE INDEX on electrified table is captured", fn conn ->
    sql1 = "CREATE TABLE buttercup (id int GENERATED ALWAYS AS IDENTITY PRIMARY KEY, value text)"
    sql2 = "CREATE TABLE daisy (id int GENERATED ALWAYS AS IDENTITY PRIMARY KEY, value text)"
    sql3 = "ALTER TABLE buttercup ENABLE ELECTRIC"
    sql4 = "CREATE INDEX buttercup_value_idx ON buttercup (value)"
    sql5 = "CREATE INDEX daisy_value_idx ON daisy (value)"

    for sql <- [sql1, sql2, sql3, sql4, sql5] do
      {:ok, _cols, _rows} = :epgsql.squery(conn, sql)
    end

    assert {:ok, [ddl1, ddl2]} = Extension.ddl_history(conn)

    assert %{"id" => 1, "query" => "CREATE TABLE " <> _} = ddl1
    assert %{"id" => 2, "query" => ^sql4} = ddl2
  end

  test_tx "DROP INDEX on electrified table is captured", fn conn ->
    # this loader instance is used by the proxy injector
    loader = MockSchemaLoader.agent_id(__MODULE__.Loader)

    sql1 = "CREATE TABLE buttercup (id int GENERATED ALWAYS AS IDENTITY PRIMARY KEY, value text)"
    sql2 = "CREATE TABLE daisy (id int GENERATED ALWAYS AS IDENTITY PRIMARY KEY, value text)"
    sql3 = "ALTER TABLE buttercup ENABLE ELECTRIC"
    sql4 = "CREATE INDEX buttercup_value_idx ON buttercup (value)"
    sql5 = "DROP INDEX buttercup_value_idx"

    # we have to setup the loader with knowledge of the electrified table
    # and the attached index, otherwise (since we're running in a tx via the proxy)
    # the default schema loader (backed by schemaloader.epgsql) therefore
    # can't lookup schema information
    {:ok, ^loader} = MigrationConsumer.apply_migration("001", [sql1], loader)
    {:ok, ^loader} = MigrationConsumer.apply_migration("002", [sql4], loader)

    for sql <- [sql1, sql2, sql3, sql4, sql5] do
      {:ok, _cols, _rows} = :epgsql.squery(conn, sql)
    end

    assert {:ok, [ddl1, ddl2, ddl3]} = Extension.ddl_history(conn)

    assert %{"id" => 1, "query" => "CREATE TABLE " <> _} = ddl1
    assert %{"id" => 2, "query" => ^sql4} = ddl2
    assert %{"id" => 3, "query" => ^sql5} = ddl3
  end

  test_tx "DROP electrified TABLE is rejected", fn conn ->
    sql1 = "CREATE TABLE buttercup (id int GENERATED ALWAYS AS IDENTITY PRIMARY KEY, value text)"
    sql2 = "CREATE TABLE daisy (id int GENERATED ALWAYS AS IDENTITY PRIMARY KEY, value text)"
    sql3 = "ALTER TABLE buttercup ENABLE ELECTRIC"

    for sql <- [sql1, sql2, sql3] do
      {:ok, _cols, _rows} = :epgsql.squery(conn, sql)
    end

    sql4 = "DROP TABLE buttercup;"

    assert {:error, _error} = :epgsql.squery(conn, sql4)
  end

  test_tx "ALTER electrified TABLE DROP COLUMN is rejected", fn conn ->
    sql1 = "CREATE TABLE buttercup (id int GENERATED ALWAYS AS IDENTITY PRIMARY KEY, value text)"
    sql2 = "CREATE TABLE daisy (id int GENERATED ALWAYS AS IDENTITY PRIMARY KEY, value text)"
    sql3 = "ALTER TABLE buttercup ENABLE ELECTRIC"

    for sql <- [sql1, sql2, sql3] do
      {:ok, _cols, _rows} = :epgsql.squery(conn, sql)
    end

    sql4 = "ALTER TABLE buttercup DROP COLUMN value;"

    assert {:error, _error} = :epgsql.squery(conn, sql4)
  end

  test_tx "ALTER electrified TABLE RENAME COLUMN is rejected", fn conn ->
    sql1 = "CREATE TABLE buttercup (id int GENERATED ALWAYS AS IDENTITY PRIMARY KEY, value text)"
    sql2 = "CREATE TABLE daisy (id int GENERATED ALWAYS AS IDENTITY PRIMARY KEY, value text)"
    sql3 = "ALTER TABLE buttercup ENABLE ELECTRIC"

    for sql <- [sql1, sql2, sql3] do
      {:ok, _cols, _rows} = :epgsql.squery(conn, sql)
    end

    sql4 = "ALTER TABLE buttercup RENAME COLUMN value TO variable"

    assert {:error, _error} = :epgsql.squery(conn, sql4)
  end

  @tag prisma_support: true
  test_tx "ADD column; CREATE INDEX only adds a single migration", fn conn ->
    sql1 =
      "CREATE TABLE public.buttercup (id text PRIMARY KEY, value text)"

    sql2 = "ALTER TABLE buttercup ENABLE ELECTRIC"

    for sql <- [sql1, sql2] do
      {:ok, _cols, _rows} = :epgsql.squery(conn, sql)
    end

    assert {:ok, [_]} = Extension.ddl_history(conn)

    sql3 =
      "ALTER TABLE public.buttercup ADD COLUMN amount int4"

    sql4 =
      "CREATE INDEX buttercup_amount_idx ON public.buttercup (amount)"

    sql34 = sql3 <> "; " <> sql4
    [{:ok, _, _}, {:ok, _, _}] = :epgsql.squery(conn, sql34)

    assert {:ok, [_, %{"query" => ^sql3}, %{"query" => ^sql4}]} = Extension.ddl_history(conn)
  end

  @tag prisma_support: true
  test_tx "CREATE INDEX; DROP <electrified> COLUMN", fn conn ->
    sql1 =
      "CREATE TABLE public.buttercup (id text PRIMARY KEY, value text)"

    sql2 = "ALTER TABLE buttercup ENABLE ELECTRIC"

    for sql <- [sql1, sql2] do
      {:ok, _cols, _rows} = :epgsql.squery(conn, sql)
    end

    assert {:ok, [_]} = Extension.ddl_history(conn)

    sql3 =
      "CREATE INDEX buttercup_amount_idx ON public.buttercup (amount); ALTER TABLE public.buttercup DROP COLUMN value; "

    {:error, _} = :epgsql.squery(conn, sql3)

    assert {:ok, [_]} = Extension.ddl_history(conn)
  end

  test_tx "ddl capture assigns automatic migration version", fn conn ->
    sql1 =
      "CREATE TABLE public.buttercup (id text PRIMARY KEY, value text)"

    sql2 = "ALTER TABLE buttercup ENABLE ELECTRIC"

    for sql <- [sql1, sql2] do
      {:ok, _cols, _rows} = :epgsql.squery(conn, sql)
    end

    assert {:ok, [migration]} = Extension.ddl_history(conn)
    assert {:ok, _version} = Extension.tx_version(conn, migration)
  end

  test_tx "user assigned version gets priority over automatic assign", fn conn ->
    sql1 =
      "CREATE TABLE public.buttercup (id text PRIMARY KEY, value text)"

    sql2 = "ALTER TABLE buttercup ENABLE ELECTRIC"
    sql3 = "CALL electric.migration_version('1234')"

    for sql <- [sql1, sql2, sql3] do
      {:ok, _cols, _rows} = :epgsql.squery(conn, sql)
    end

    assert {:ok, [migration]} = Extension.ddl_history(conn)
    assert {:ok, "1234"} = Extension.tx_version(conn, migration)
  end

  test_tx "version priority is honoured", fn conn ->
    sql1 =
      "CREATE TABLE public.buttercup (id text PRIMARY KEY, value text)"

    sql2 = "ALTER TABLE buttercup ENABLE ELECTRIC"

    for sql <- [sql1, sql2] do
      {:ok, _cols, _rows} = :epgsql.squery(conn, sql)
    end

    assert {:ok, [migration]} = Extension.ddl_history(conn)
    assert {:ok, version} = Extension.tx_version(conn, migration)

    assign_version = fn version, priority ->
      {:ok, _cols, _rows} =
        :epgsql.equery(conn, "CALL electric.assign_migration_version($1, $2)", [version, priority])
    end

    assign_version.("1111", 0)
    assert {:ok, ^version} = Extension.tx_version(conn, migration)

    version = "1111"
    assign_version.(version, 1)
    assert {:ok, ^version} = Extension.tx_version(conn, migration)

    version = "2222"
    assign_version.(version, 2)
    assert {:ok, ^version} = Extension.tx_version(conn, migration)

    assign_version.("3333", 2)
    assert {:ok, ^version} = Extension.tx_version(conn, migration)

    version = "4444"
    assign_version.(version, 8)
    assert {:ok, ^version} = Extension.tx_version(conn, migration)
  end
end
