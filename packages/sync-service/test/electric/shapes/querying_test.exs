defmodule Electric.Shapes.QueryingTest do
  use Support.TransactionCase, async: true

  alias Electric.Postgres.Inspector.DirectInspector
  alias Electric.Shapes.Shape
  alias Electric.Shapes.Querying

  test "should give the resulting JSON stream", %{db_conn: conn} do
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
    shape = Shape.new!("items", inspector: {DirectInspector, conn})

    assert stream = Querying.stream_initial_data(conn, shape)

    assert [
             %{
               key: ~S["public"."items"/"1"],
               value: %{id: "1", value: "1"},
               headers: %{operation: "insert", relation: ["public", "items"]},
               offset: "0_0"
             },
             %{
               key: ~S["public"."items"/"2"],
               value: %{id: "2", value: "2"},
               headers: %{operation: "insert", relation: ["public", "items"]},
               offset: "0_0"
             },
             %{
               key: ~S["public"."items"/"3"],
               value: %{id: "3", value: "3"},
               headers: %{operation: "insert", relation: ["public", "items"]},
               offset: "0_0"
             },
             %{
               key: ~S["public"."items"/"4"],
               value: %{id: "4", value: "4"},
               headers: %{operation: "insert", relation: ["public", "items"]},
               offset: "0_0"
             },
             %{
               key: ~S["public"."items"/"5"],
               value: %{id: "5", value: "5"},
               headers: %{operation: "insert", relation: ["public", "items"]},
               offset: "0_0"
             }
           ] == stream |> Enum.to_list() |> Enum.map(&Jason.decode!(&1, keys: :atoms))
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
    shape = Shape.new!("items", where: "value > 3", inspector: {DirectInspector, conn})

    assert stream = Querying.stream_initial_data(conn, shape)

    assert [
             %{key: ~S["public"."items"/"4"], value: %{value: "4"}},
             %{key: ~S["public"."items"/"5"], value: %{value: "5"}}
           ] = stream |> Enum.to_list() |> Enum.map(&Jason.decode!(&1, keys: :atoms))
  end

  test "allows column names to have special characters", %{db_conn: conn} do
    Postgrex.query!(
      conn,
      """
      CREATE TABLE items (
        id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
        "col with ""' in it" INTEGER
      )
      """,
      []
    )

    Postgrex.query!(
      conn,
      ~s|INSERT INTO items ("col with ""' in it") VALUES (1), (2)|,
      []
    )

    shape = Shape.new!("items", inspector: {DirectInspector, conn})

    assert stream = Querying.stream_initial_data(conn, shape)

    assert [
             %{key: ~S["public"."items"/"1"], value: %{"col with \"' in it": "1"}},
             %{key: ~S["public"."items"/"2"], value: %{"col with \"' in it": "2"}}
           ] = stream |> Enum.to_list() |> Enum.map(&Jason.decode!(&1, keys: :atoms))
  end

  test "works with composite PKs", %{db_conn: conn} do
    Postgrex.query!(
      conn,
      """
      CREATE TABLE items (
        id1 INTEGER,
        id2 INTEGER,
        "test" INTEGER,
        PRIMARY KEY (id1, id2)
      )
      """,
      []
    )

    Postgrex.query!(
      conn,
      ~s|INSERT INTO items (id1, id2, "test") VALUES (1, 2, 1), (3,4, 2)|,
      []
    )

    shape = Shape.new!("items", inspector: {DirectInspector, conn})

    assert stream = Querying.stream_initial_data(conn, shape)

    assert [
             %{key: ~S["public"."items"/"1"/"2"], value: %{test: "1"}},
             %{key: ~S["public"."items"/"3"/"4"], value: %{test: "2"}}
           ] = stream |> Enum.to_list() |> Enum.map(&Jason.decode!(&1, keys: :atoms))
  end

  test "works with null values & values with special characters", %{db_conn: conn} do
    Postgrex.query!(
      conn,
      """
      CREATE TABLE items (
        id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
        value TEXT
      )
      """,
      []
    )

    Postgrex.query!(
      conn,
      ~s|INSERT INTO items (value) VALUES ('1'), (NULL), ('"test\\x0001\n"')|,
      []
    )

    shape = Shape.new!("items", inspector: {DirectInspector, conn})

    assert stream = Querying.stream_initial_data(conn, shape)

    assert [
             %{key: ~S["public"."items"/"1"], value: %{value: "1"}},
             %{key: ~S["public"."items"/"2"], value: %{value: nil}},
             %{key: ~S["public"."items"/"3"], value: %{value: ~s["test\\x0001\n"]}}
           ] = stream |> Enum.to_list() |> Enum.map(&Jason.decode!(&1, keys: :atoms))
  end
end
