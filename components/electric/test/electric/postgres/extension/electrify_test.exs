defmodule Electric.Postgres.Extension.ElectrifyTest do
  use Electric.Extension.Case, async: false

  def electrified(conn) do
    :epgsql.equery(
      conn,
      "SELECT id, table_name, schema_name FROM #{Extension.electrified_tracking_table()} ORDER BY id ASC",
      []
    )
    |> then(fn {:ok, _, rows} ->
      {:ok,
       Enum.map(rows, fn {id, table_name, schema_name} ->
         %{id: id, table: table_name, schema: schema_name}
       end)}
    end)
  end

  test_tx "inserts a row into the electrified table", fn conn ->
    sql = "CREATE TABLE buttercup (id uuid PRIMARY KEY);"
    {:ok, _cols, _rows} = :epgsql.squery(conn, sql)

    sql = "CALL electric.electrify('buttercup');"

    {:ok, _cols, _rows} = :epgsql.squery(conn, sql)

    assert {:ok, [row]} = electrified(conn)

    assert row[:table] == "buttercup"
    assert row[:schema] == "public"
  end

  test_tx "inserts the DDL for the table into the migration table", fn conn ->
    sql = """
    CREATE TABLE buttercup (
      id uuid PRIMARY KEY,
      value text,
      secret integer
    );
    """

    {:ok, _cols, _rows} = :epgsql.squery(conn, sql)

    sql = "CALL electric.electrify('buttercup');"
    {:ok, _cols, _rows} = :epgsql.squery(conn, sql)

    assert {:ok, [row]} = electrified(conn)

    assert row[:table] == "buttercup"
    assert row[:schema] == "public"

    assert {:ok, [%{"query" => query}]} = Extension.ddl_history(conn)

    assert query =~ ~r/^CREATE TABLE buttercup/
  end

  test_tx "duplicate call does not raise", fn conn ->
    sql = """
    CREATE TABLE buttercup (
      id uuid PRIMARY KEY,
      value text,
      secret integer
    );
    """

    {:ok, _cols, _rows} = :epgsql.squery(conn, sql)

    sql = "CALL electric.electrify('buttercup');"
    {:ok, _cols, _rows} = :epgsql.squery(conn, sql)

    sql = "CALL electric.electrify('buttercup');"

    assert {:ok, [], []} = :epgsql.squery(conn, sql)
  end

  test_tx "handles quoted table names", fn conn ->
    sql = "CREATE TABLE \"la la daisy\" (id uuid PRIMARY KEY);"
    {:ok, _cols, _rows} = :epgsql.squery(conn, sql)

    sql = "CREATE TABLE \"la la buttercup\" (id uuid PRIMARY KEY);"
    {:ok, _cols, _rows} = :epgsql.squery(conn, sql)

    sql = "CALL electric.electrify('public', 'la la daisy');"
    {:ok, _cols, _rows} = :epgsql.squery(conn, sql)
    sql = "CALL electric.electrify('la la buttercup');"

    {:ok, _cols, _rows} = :epgsql.squery(conn, sql)

    assert {:ok, [row1, row2]} = electrified(conn)

    assert row1[:table] == "la la daisy"
    assert row1[:schema] == "public"
    assert row2[:table] == "la la buttercup"
    assert row2[:schema] == "public"
  end

  test_tx "allows for namespaced table names", fn conn ->
    sql = "CREATE TABLE daisy (id uuid PRIMARY KEY);"
    {:ok, _cols, _rows} = :epgsql.squery(conn, sql)

    sql = "CALL electric.electrify('public.daisy');"
    {:ok, _cols, _rows} = :epgsql.squery(conn, sql)

    assert {:ok, [row1]} = electrified(conn)

    assert row1[:table] == "daisy"
    assert row1[:schema] == "public"
  end

  test_tx "fails if the table does not exist", fn conn ->
    sql = "CALL electric.electrify('buttercup');"

    assert {:error, _msg} = :epgsql.squery(conn, sql)
  end

  test_tx "allows for specifying the schema", fn conn ->
    sql = """
    CREATE SCHEMA balloons;
    """

    {:ok, _cols, _rows} = :epgsql.squery(conn, sql)

    sql = """
    CREATE TABLE balloons.buttercup (
      id uuid PRIMARY KEY,
      value text,
      secret integer
    );
    """

    {:ok, _cols, _rows} = :epgsql.squery(conn, sql)

    sql = "CALL electric.electrify('balloons', 'buttercup');"

    {:ok, _, _} = :epgsql.squery(conn, sql)

    assert {:ok, [row]} = electrified(conn)

    assert row[:schema] == "balloons"
    assert row[:table] == "buttercup"
  end

  @tables_query """
  SELECT DISTINCT ON (t.schemaname, t.tablename)
    t.schemaname, t.tablename, c.oid, c.relreplident
  FROM pg_catalog.pg_publication_tables t
    JOIN pg_catalog.pg_namespace ns on t.schemaname = ns.nspname
    JOIN pg_catalog.pg_class c on (c.relname = t.tablename and c.relnamespace = ns.oid)
  WHERE t.pubname IN ($1)
  """

  def query_replicated_tables(conn, publication) do
    {:ok, _, rows} = :epgsql.equery(conn, @tables_query, [publication])

    Enum.map(rows, fn {schema, table, oid, replident} ->
      %{schema: schema, name: table, oid: oid, replident: replident}
    end)
  end

  def published_tables(conn) do
    conn
    |> query_replicated_tables(Extension.publication_name())
    |> Enum.reject(&(&1.schema == "electric"))
  end

  test_tx "adds the electrified table to the publication", fn conn ->
    assert published_tables(conn) == []

    sql = "CREATE TABLE buttercup (id uuid PRIMARY KEY, value text);"

    {:ok, _cols, _rows} = :epgsql.squery(conn, sql)

    sql = "CALL electric.electrify('buttercup');"

    {:ok, _cols, _rows} = :epgsql.squery(conn, sql)

    assert [%{name: "buttercup"}] = published_tables(conn)
  end

  test_tx "sets the replication mode of the electrified table", fn conn ->
    relreplident = """
    SELECT relreplident FROM pg_class WHERE relname = $1;
    """

    sql = """
    CREATE TABLE buttercup (
      id uuid PRIMARY KEY,
      value text,
      secret integer
    );
    """

    {:ok, _cols, _rows} = :epgsql.squery(conn, sql)

    sql = "CALL electric.electrify('buttercup');"

    {:ok, _cols, _rows} = :epgsql.squery(conn, sql)

    assert {:ok, _cols, [{?f}]} = :epgsql.equery(conn, relreplident, ["buttercup"])
  end
end
