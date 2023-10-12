defmodule Electric.DDLX.TestHelper do
  @moduledoc """
  Documentation for `DDLX.TestHelper`.
  """
  use ExUnit.Case

  def init_db(params \\ []) do
    defaults = [
      port: System.get_env("PG_PORT", "54321") |> String.to_integer(),
      hostname: System.get_env("PG_HOST", "localhost"),
      username: System.get_env("PG_USERNAME", "electric"),
      password: System.get_env("PGPASSWORD", "password"),
      database: System.get_env("PG_DB", "electric")
    ]

    connection_params =
      Enum.reduce(defaults, params, fn {k, v}, params -> Keyword.put_new(params, k, v) end)

    with {:ok, conn} = Postgrex.start_link(connection_params) do
      sql_do(conn, "DROP SCHEMA public CASCADE;")
      sql_do(conn, "DROP SCHEMA electric CASCADE;")
      sql_do(conn, "CREATE SCHEMA public;")
      sql_do(conn, "CREATE SCHEMA electric;")
      sql_do(conn, "GRANT ALL ON SCHEMA public TO postgres;")
      sql_do(conn, "GRANT ALL ON SCHEMA electric TO postgres;")
      sql_do(conn, "GRANT ALL ON SCHEMA public TO public;")
      sql_do(conn, "GRANT ALL ON SCHEMA electric TO public;")

      {:ok, conn}
    end
  end

  def sql_do_many(conn, statements) when is_list(statements) do
    Postgrex.transaction(conn, fn conn ->
      Enum.reduce_while(statements, {:ok, 0}, fn statement, acc ->
        query = Postgrex.prepare!(conn, "", statement)

        case Postgrex.execute(conn, query, []) do
          {:ok, _, _} ->
            {:cont, {:ok, elem(acc, 1) + 1}}

          {:error, error} ->
            IO.inspect(error)
            {:halt, {:error, error}}
        end
      end)
    end)
  end

  def sql_do(conn, statement) do
    query = Postgrex.prepare!(conn, "", statement)

    with {:ok, executed_query, result} <- Postgrex.execute(conn, query, []) do
      #      IO.inspect({:ok, executed_query, result})
      {:ok, executed_query, result}
    else
      err ->
        #        IO.inspect(statement)
        #        IO.inspect(err)
        err
    end
  end

  def sql_do_params(conn, statement, params) do
    query = Postgrex.prepare!(conn, "", statement)

    with {:ok, executed_query, result} <- Postgrex.execute(conn, query, params) do
      #      IO.inspect({:ok, executed_query, result})
      {:ok, executed_query, result}
    else
      err ->
        #        IO.inspect(statement)
        #        IO.inspect(err)
        err
    end
  end

  def list_tables(conn) do
    {:ok, _query, result} =
      sql_do(
        conn,
        "select table_name from information_schema.tables WHERE table_schema = 'public'"
      )

    for row <- result.rows do
      List.first(row)
    end
  end

  def list_tables_in_schema(conn, schema) do
    {:ok, _query, result} =
      sql_do(
        conn,
        "select table_name from information_schema.tables WHERE table_schema = '#{schema}'"
      )

    for row <- result.rows do
      List.first(row)
    end
  end

  def list_columns(conn, table_name) do
    {:ok, _query, result} =
      sql_do(conn, "select * from information_schema.columns WHERE table_name = '#{table_name}'")

    column_name_index = Enum.find_index(result.columns, &(&1 == "column_name"))

    for row <- result.rows, into: %{} do
      column_name = Enum.at(row, column_name_index)

      attrs =
        for {k, v} <- Enum.zip(result.columns, row), into: %{} do
          {k, v}
        end

      {column_name, attrs}
    end
  end

  def assert_tables(conn, table_names) do
    existing = list_tables(conn)
    assert MapSet.new(existing) == MapSet.new(table_names)
  end

  def assert_table(conn, table_name, desired_columns) do
    existing_columns = list_columns(conn, table_name)

    Enum.each(desired_columns, fn {column_name, assertions} ->
      for {attribute_name, value} <- assertions do
        #        IO.inspect(existing_columns[column_name][attribute_name])
        #        IO.inspect(value)
        assert(
          existing_columns[column_name][attribute_name] == value,
          "Column assertion failed on #{table_name} #{column_name} #{attribute_name}, #{existing_columns[column_name][attribute_name]} != #{value}\n"
        )
      end
    end)
  end

  def assert_rows(conn, table_name, expected_rows) do
    {:ok, _query, result} = sql_do(conn, "select * from #{table_name}")

    assert(
      result.rows == expected_rows,
      "Row assertion failed on #{table_name}, #{inspect(result.rows)} != #{inspect(expected_rows)}\n"
    )
  end

  def assert_rows_slice(conn, table_name, expected_rows, range) do
    {:ok, _query, result} = sql_do(conn, "select * from #{table_name}")

    res =
      for row <- result.rows do
        Enum.slice(row, range)
      end

    assert(
      res == expected_rows,
      "Row assertion failed on #{table_name}, #{inspect(res)} != #{inspect(expected_rows)}\n"
    )
  end

  def get_foreign_keys(conn, table_name) do
    query_str = """
      SELECT sch.nspname                               AS "from_schema",
             tbl.relname                                   AS "from_table",
             ARRAY_AGG(col.attname ORDER BY u.attposition) AS "from_columns",
             f_sch.nspname                                 AS "to_schema",
             f_tbl.relname                                 AS "to_table",
             ARRAY_AGG(f_col.attname ORDER BY f_u.attposition) AS "to_columns",
             ARRAY_AGG((SELECT data_type FROM information_schema.columns WHERE table_name = '#{table_name}' and column_name = col.attname) ORDER BY f_u.attposition) AS "to_types"
          FROM pg_constraint c
                 LEFT JOIN LATERAL UNNEST(c.conkey) WITH ORDINALITY AS u(attnum, attposition) ON TRUE
                 LEFT JOIN LATERAL UNNEST(c.confkey) WITH ORDINALITY AS f_u(attnum, attposition) ON f_u.attposition = u.attposition
                 JOIN pg_class tbl ON tbl.oid = c.conrelid
                 JOIN pg_namespace sch ON sch.oid = tbl.relnamespace
                 LEFT JOIN pg_attribute col ON (col.attrelid = tbl.oid AND col.attnum = u.attnum)
                 LEFT JOIN pg_class f_tbl ON f_tbl.oid = c.confrelid
                 LEFT JOIN pg_namespace f_sch ON f_sch.oid = f_tbl.relnamespace
                 LEFT JOIN pg_attribute f_col ON (f_col.attrelid = f_tbl.oid AND f_col.attnum = f_u.attnum)
          WHERE c.contype = 'f' and tbl.relname = '#{table_name}'
          GROUP BY "from_schema", "from_table", "to_schema", "to_table"
          ORDER BY "from_schema", "from_table";
    """

    {:ok, _query, result} = sql_do(conn, query_str)
    result.rows
  end
end
