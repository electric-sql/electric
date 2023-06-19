defmodule Electric.Postgres.Extension.ElectrifyTest do
  use Electric.Extension.Case, async: false

  alias Electric.Replication.Postgres.Client

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

  test "inserts a row into the electrified table", cxt do
    tx(
      fn conn ->
        migrate(conn)

        sql = "CREATE TABLE buttercup (id uuid PRIMARY KEY DEFAULT uuid_generate_v4());"
        {:ok, _cols, _rows} = :epgsql.squery(conn, sql)

        sql = "CALL electric.electrify('buttercup');"

        {:ok, _cols, _rows} = :epgsql.squery(conn, sql)

        assert {:ok, [row]} = electrified(conn)

        assert row[:table] == "buttercup"
        assert row[:schema] == "public"
      end,
      cxt
    )
  end

  test "inserts the DDL for the table into the migration table", cxt do
    tx(
      fn conn ->
        migrate(conn)

        sql = """
        CREATE TABLE buttercup (
          id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
          value text,
          secret bool
        );
        """

        {:ok, _cols, _rows} = :epgsql.squery(conn, sql)

        sql = "CALL electric.electrify('buttercup');"
        {:ok, _cols, _rows} = :epgsql.squery(conn, sql)

        assert {:ok, [row]} = electrified(conn)

        assert row[:table] == "buttercup"
        assert row[:schema] == "public"

        assert {:ok, [{_, _, _, query}]} = Extension.ddl_history(conn)

        assert query =~ ~r/^CREATE TABLE buttercup/
      end,
      cxt
    )
  end

  test "duplicate calls do nothing", cxt do
    tx(
      fn conn ->
        migrate(conn)

        sql = """
        CREATE TABLE buttercup (
          id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
          value text,
          secret bool
        );
        """

        {:ok, _cols, _rows} = :epgsql.squery(conn, sql)

        sql = "CALL electric.electrify('buttercup');"

        {:ok, _cols, _rows} = :epgsql.squery(conn, sql)

        sql = "CALL electric.electrify('buttercup');"

        {:ok, _cols, _rows} = :epgsql.squery(conn, sql)

        assert {:ok, [row]} = electrified(conn)

        assert row[:table] == "buttercup"
        assert row[:schema] == "public"
      end,
      cxt
    )
  end

  test "handles quoted table names", cxt do
    tx(
      fn conn ->
        migrate(conn)

        sql = "CREATE TABLE \"la la daisy\" (id uuid PRIMARY KEY DEFAULT uuid_generate_v4());"
        {:ok, _cols, _rows} = :epgsql.squery(conn, sql)

        sql = "CREATE TABLE \"la la buttercup\" (id uuid PRIMARY KEY DEFAULT uuid_generate_v4());"
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
      end,
      cxt
    )
  end

  test "allows for namespaced table names", cxt do
    tx(
      fn conn ->
        migrate(conn)

        sql = "CREATE TABLE daisy (id uuid PRIMARY KEY DEFAULT uuid_generate_v4());"
        {:ok, _cols, _rows} = :epgsql.squery(conn, sql)

        sql = "CALL electric.electrify('public.daisy');"
        {:ok, _cols, _rows} = :epgsql.squery(conn, sql)

        assert {:ok, [row1]} = electrified(conn)

        assert row1[:table] == "daisy"
        assert row1[:schema] == "public"
      end,
      cxt
    )
  end

  test "fails if the table does not exist", cxt do
    tx(
      fn conn ->
        migrate(conn)

        sql = "CALL electric.electrify('buttercup');"

        assert {:error, _msg} = :epgsql.squery(conn, sql)
      end,
      cxt
    )
  end

  test "allows for specifying the schema", cxt do
    tx(
      fn conn ->
        migrate(conn)

        sql = """
        CREATE SCHEMA balloons;
        """

        {:ok, _cols, _rows} = :epgsql.squery(conn, sql)

        sql = """
        CREATE TABLE balloons.buttercup (
          id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
          value text,
          secret bool
        );
        """

        {:ok, _cols, _rows} = :epgsql.squery(conn, sql)

        sql = "CALL electric.electrify('balloons', 'buttercup');"

        {:ok, _, _} = :epgsql.squery(conn, sql)

        assert {:ok, [row]} = electrified(conn)

        assert row[:schema] == "balloons"
        assert row[:table] == "buttercup"
      end,
      cxt
    )
  end

  def published_tables(conn) do
    conn
    |> Client.query_replicated_tables(Extension.publication_name())
    |> Enum.reject(&(&1.schema == "electric"))
  end

  test "adds the electrified table to the publication", cxt do
    tx(
      fn conn ->
        migrate(conn)

        assert published_tables(conn) == []

        sql =
          "CREATE TABLE buttercup (id uuid PRIMARY KEY DEFAULT uuid_generate_v4(), value text);"

        {:ok, _cols, _rows} = :epgsql.squery(conn, sql)

        sql = "CALL electric.electrify('buttercup');"

        {:ok, _cols, _rows} = :epgsql.squery(conn, sql)

        assert [%{name: "buttercup"}] = published_tables(conn)
      end,
      cxt
    )
  end

  test "sets the replication mode of the electrified table", cxt do
    tx(
      fn conn ->
        migrate(conn)

        relreplident = """
        SELECT relreplident FROM pg_class WHERE relname = $1;
        """

        sql = """
        CREATE TABLE buttercup (
          id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
          value text,
          secret bool
        );
        """

        {:ok, _cols, _rows} = :epgsql.squery(conn, sql)

        sql = "CALL electric.electrify('buttercup');"

        {:ok, _cols, _rows} = :epgsql.squery(conn, sql)

        assert {:ok, _cols, [{?f}]} = :epgsql.equery(conn, relreplident, ["buttercup"])
      end,
      cxt
    )
  end
end
