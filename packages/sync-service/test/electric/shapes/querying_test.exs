defmodule Electric.Shapes.QueryingTest do
  use Support.TransactionCase, async: true

  alias Electric.Postgres.Inspector.DirectInspector
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
    shape = Shape.new!("items", inspector: {DirectInspector, conn})

    assert [
             %{
               key: ~S["public"."items"/"1"],
               value: %{id: "1", value: "1"},
               headers: %{operation: "insert", relation: ["public", "items"]}
             },
             %{
               key: ~S["public"."items"/"2"],
               value: %{id: "2", value: "2"},
               headers: %{operation: "insert", relation: ["public", "items"]}
             },
             %{
               key: ~S["public"."items"/"3"],
               value: %{id: "3", value: "3"},
               headers: %{operation: "insert", relation: ["public", "items"]}
             },
             %{
               key: ~S["public"."items"/"4"],
               value: %{id: "4", value: "4"},
               headers: %{operation: "insert", relation: ["public", "items"]}
             },
             %{
               key: ~S["public"."items"/"5"],
               value: %{id: "5", value: "5"},
               headers: %{operation: "insert", relation: ["public", "items"]}
             }
           ] == decode_stream(Querying.stream_initial_data(conn, "dummy-stack-id", shape))
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

    assert [
             %{key: ~S["public"."items"/"4"], value: %{value: "4"}},
             %{key: ~S["public"."items"/"5"], value: %{value: "5"}}
           ] = decode_stream(Querying.stream_initial_data(conn, "dummy-stack-id", shape))
  end

  test "respects the where clauses with params", %{db_conn: conn} do
    Postgrex.query!(
      conn,
      """
      CREATE TABLE items (
        id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
        value INTEGER,
        test INTEGER[]
      )
      """,
      []
    )

    Postgrex.query!(
      conn,
      "INSERT INTO items (value, test) VALUES (1, '{1,2,3}'), (2, '{4,5,6}'), (3, '{7,8,9}'), (4, '{10,11,12}'), (5, '{12,14,15}')",
      []
    )

    shape =
      Shape.new!("items",
        where: "test @> $1",
        inspector: {DirectInspector, conn},
        params: %{"1" => "{12}"}
      )

    assert [
             %{key: ~S["public"."items"/"4"], value: %{value: "4"}},
             %{key: ~S["public"."items"/"5"], value: %{value: "5"}}
           ] = decode_stream(Querying.stream_initial_data(conn, "dummy-stack-id", shape))
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
      ~s|INSERT INTO items ("col with ""' in it") VALUES (1)|,
      []
    )

    shape = Shape.new!("items", inspector: {DirectInspector, conn})

    assert [
             %{key: ~S["public"."items"/"1"], value: %{"col with \"' in it": "1"}}
           ] = decode_stream(Querying.stream_initial_data(conn, "dummy-stack-id", shape))
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

    assert [
             %{key: ~S["public"."items"/"1"/"2"], value: %{test: "1"}},
             %{key: ~S["public"."items"/"3"/"4"], value: %{test: "2"}}
           ] = decode_stream(Querying.stream_initial_data(conn, "dummy-stack-id", shape))
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

    assert [
             %{key: ~S["public"."items"/"1"], value: %{value: "1"}},
             %{key: ~S["public"."items"/"2"], value: %{value: nil}},
             %{key: ~S["public"."items"/"3"], value: %{value: ~s["test\\x0001\n"]}}
           ] = decode_stream(Querying.stream_initial_data(conn, "dummy-stack-id", shape))
  end

  test "splits the result into chunks according to the chunk size threshold", %{db_conn: conn} do
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

    assert [
             %{key: ~S["public"."items"/"1"], value: %{value: "1"}},
             :chunk_boundary,
             %{key: ~S["public"."items"/"2"], value: %{value: nil}},
             :chunk_boundary,
             %{key: ~S["public"."items"/"3"], value: %{value: ~s["test\\x0001\n"]}},
             :chunk_boundary
           ] = decode_stream(Querying.stream_initial_data(conn, "dummy-stack-id", shape, 10))
  end

  defp decode_stream(stream),
    do:
      stream
      |> Enum.to_list()
      |> Enum.map(fn
        :chunk_boundary -> :chunk_boundary
        json_item -> Jason.decode!(json_item, keys: :atoms)
      end)
end
