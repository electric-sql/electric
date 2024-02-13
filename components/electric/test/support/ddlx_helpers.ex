defmodule ElectricTest.DDLXHelpers do
  import ExUnit.Assertions

  def assert_rows(conn, table_name, expected_rows) do
    {:ok, _cols, rows} = query(conn, "select * from #{table_name}")

    assert(
      rows == expected_rows,
      "Row assertion failed on #{table_name}, #{inspect(rows)} != #{inspect(expected_rows)}\n"
    )
  end

  def assert_rows_slice(conn, table_name, expected_rows, range) do
    {:ok, _cols, rows} = query(conn, "select * from #{table_name}")

    rows =
      rows
      |> Enum.map(&Enum.slice(&1, range))

    assert(
      rows == expected_rows,
      "Row assertion failed on #{table_name}, #{inspect(rows)} != #{inspect(expected_rows)}\n"
    )
  end

  def query(conn, query, params \\ []) do
    case :epgsql.equery(conn, query, params) do
      {:ok, _n, cols, rows} ->
        {:ok, cols, map_rows(rows)}

      {:ok, cols, rows} ->
        {:ok, cols, map_rows(rows)}

      {:ok, n} when is_integer(n) ->
        {:ok, [], []}

      {:error, error} ->
        {:error, error}
    end
  end

  def map_rows(rows) do
    Enum.map(rows, &Tuple.to_list/1)
  end

  def quote_table({schema, table}) do
    ~s["#{schema}"."#{table}"]
  end

  def quote_table(%{schema: schema, name: table}) do
    ~s["#{schema}"."#{table}"]
  end
end
