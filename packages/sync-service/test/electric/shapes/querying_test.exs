defmodule Electric.Shapes.QueryingTest do
  use Support.TransactionCase, async: true

  alias Electric.Postgres.Inspector
  alias Electric.Shapes.Shape
  alias Electric.Shapes.Querying

  test "should give information about the table and the result stream", %{db_conn: conn} do
    Postgrex.query!(
      conn,
      """
      CREATE TABLE items (
        id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
        value INTEGER
      )
      """,
      []
    )

    Postgrex.query!(conn, "INSERT INTO items (value) VALUES (1), (2), (3), (4), (5)", [])

    assert {query_info, stream} =
             Querying.stream_initial_data(conn, %Shape{root_table: {"public", "items"}})

    assert %{columns: ["id", "value"]} = query_info
    assert [[_, "1"], [_, "2"], [_, "3"], [_, "4"], [_, "5"]] = Enum.to_list(stream)
  end

  test "respects the where clauses", %{db_conn: conn} do
    Postgrex.query!(
      conn,
      """
      CREATE TABLE items (
        id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
        value INTEGER
      )
      """,
      []
    )

    Postgrex.query!(conn, "INSERT INTO items (value) VALUES (1), (2), (3), (4), (5)", [])
    shape = Shape.new!("items", where: "value > 3", inspector: {Inspector, conn})

    assert {query_info, stream} = Querying.stream_initial_data(conn, shape)

    assert %{columns: ["id", "value"]} = query_info
    assert [[_, "4"], [_, "5"]] = Enum.to_list(stream)
  end

  test "allows column names to have special characters", %{db_conn: conn} do
    Postgrex.query!(
      conn,
      """
      CREATE TABLE items (
        id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
        "col with "" in it" INTEGER
      )
      """,
      []
    )

    Postgrex.query!(
      conn,
      ~s|INSERT INTO items ("col with "" in it") VALUES (1), (2), (3), (4), (5)|,
      []
    )

    assert {query_info, stream} =
             Querying.stream_initial_data(conn, %Shape{root_table: {"public", "items"}})

    assert %{columns: ["id", ~s(col with " in it)]} = query_info
    assert [[_, "1"], [_, "2"], [_, "3"], [_, "4"], [_, "5"]] = Enum.to_list(stream)
  end
end
