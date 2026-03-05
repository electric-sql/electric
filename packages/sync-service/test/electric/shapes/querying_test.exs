defmodule Electric.Shapes.QueryingTest do
  use Support.TransactionCase, async: true

  alias Electric.Shapes.Shape.SubqueryMoves
  alias Electric.Postgres.Inspector.DirectInspector
  alias Electric.Shapes.Shape
  alias Electric.Shapes.Querying

  describe "stream_initial_data/4" do
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
             ] ==
               decode_stream(
                 Querying.stream_initial_data(conn, "dummy-stack-id", "dummy-shape-handle", shape)
               )
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
             ] =
               decode_stream(
                 Querying.stream_initial_data(conn, "dummy-stack-id", "dummy-shape-handle", shape)
               )
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
             ] =
               decode_stream(
                 Querying.stream_initial_data(conn, "dummy-stack-id", "dummy-shape-handle", shape)
               )
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
             ] =
               decode_stream(
                 Querying.stream_initial_data(conn, "dummy-stack-id", "dummy-shape-handle", shape)
               )
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
             ] =
               decode_stream(
                 Querying.stream_initial_data(conn, "dummy-stack-id", "dummy-shape-handle", shape)
               )
    end

    test "works with null values when no PK constraint is present", %{db_conn: conn} do
      Postgrex.query!(
        conn,
        """
        CREATE TABLE items (
          id INTEGER,
          val TEXT
        )
        """,
        []
      )

      Postgrex.query!(
        conn,
        "INSERT INTO items (id, val) VALUES (1, ''), (2, null), (null, ''), (null, null)",
        []
      )

      shape = Shape.new!("items", inspector: {DirectInspector, conn})

      assert [
               %{key: ~S["public"."items"/"1"/""], value: %{id: "1", val: ""}},
               %{key: ~S["public"."items"/"2"/_], value: %{id: "2", val: nil}},
               %{key: ~S["public"."items"/_/""], value: %{id: nil, val: ""}},
               %{key: ~S["public"."items"/_/_], value: %{id: nil, val: nil}}
             ] =
               decode_stream(
                 Querying.stream_initial_data(conn, "dummy-stack-id", "dummy-shape-handle", shape)
               )
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
             ] =
               decode_stream(
                 Querying.stream_initial_data(conn, "dummy-stack-id", "dummy-shape-handle", shape)
               )
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
             ] =
               decode_stream(
                 Querying.stream_initial_data(
                   conn,
                   "dummy-stack-id",
                   "dummy-shape-handle",
                   shape,
                   10
                 )
               )
    end

    test "if shape has a subquery, tags the results", %{db_conn: conn} do
      for statement <- [
            "CREATE TABLE parent (id SERIAL PRIMARY KEY, value INTEGER)",
            "CREATE TABLE child (id SERIAL PRIMARY KEY, value INTEGER, parent_id INTEGER REFERENCES parent(id))",
            "INSERT INTO parent (value) VALUES (1), (2), (3)",
            "INSERT INTO child (value, parent_id) VALUES (4, 1), (5, 2), (6, 3)"
          ],
          do: Postgrex.query!(conn, statement)

      shape =
        Shape.new!("child",
          where: "parent_id IN (SELECT id FROM parent)",
          inspector: {DirectInspector, conn}
        )

      tag1 =
        :crypto.hash(:md5, "dummy-stack-id" <> "dummy-shape-handle" <> "v:1")
        |> Base.encode16(case: :lower)

      tag2 =
        :crypto.hash(:md5, "dummy-stack-id" <> "dummy-shape-handle" <> "v:2")
        |> Base.encode16(case: :lower)

      tag3 =
        :crypto.hash(:md5, "dummy-stack-id" <> "dummy-shape-handle" <> "v:3")
        |> Base.encode16(case: :lower)

      assert [
               %{value: %{value: "4"}, headers: %{tags: [^tag1]}},
               %{value: %{value: "5"}, headers: %{tags: [^tag2]}},
               %{value: %{value: "6"}, headers: %{tags: [^tag3]}}
             ] =
               decode_stream(
                 Querying.stream_initial_data(conn, "dummy-stack-id", "dummy-shape-handle", shape)
               )
    end

    test "if shape has a subquery, computes correct tags for NULL column values", %{
      db_conn: conn
    } do
      for statement <- [
            "CREATE TABLE parent (id SERIAL PRIMARY KEY, value INTEGER)",
            # parent_id is nullable
            "CREATE TABLE child (id SERIAL PRIMARY KEY, value INTEGER, parent_id INTEGER REFERENCES parent(id))",
            "INSERT INTO parent (value) VALUES (1), (2)",
            # Insert rows with both non-NULL and NULL parent_id
            "INSERT INTO child (value, parent_id) VALUES (10, 1), (20, NULL), (30, 2)"
          ],
          do: Postgrex.query!(conn, statement)

      shape =
        Shape.new!("child",
          where: "parent_id IN (SELECT id FROM parent) OR parent_id IS NULL",
          inspector: {DirectInspector, conn}
        )

      # Tag for NULL uses 'NULL' (no prefix), values use 'v:' prefix
      # This ensures NULL and the string 'NULL' produce different hashes
      tag_null =
        :crypto.hash(:md5, "dummy-stack-id" <> "dummy-shape-handle" <> "NULL")
        |> Base.encode16(case: :lower)

      tag1 =
        :crypto.hash(:md5, "dummy-stack-id" <> "dummy-shape-handle" <> "v:1")
        |> Base.encode16(case: :lower)

      tag2 =
        :crypto.hash(:md5, "dummy-stack-id" <> "dummy-shape-handle" <> "v:2")
        |> Base.encode16(case: :lower)

      result =
        decode_stream(
          Querying.stream_initial_data(conn, "dummy-stack-id", "dummy-shape-handle", shape)
        )

      assert [
               %{value: %{value: "10", parent_id: "1"}, headers: %{tags: [^tag1]}},
               %{value: %{value: "20", parent_id: nil}, headers: %{tags: [^tag_null]}},
               %{value: %{value: "30", parent_id: "2"}, headers: %{tags: [^tag2]}}
             ] = result
    end

    test "if shape has a subquery, tags the results (with composite keys)", %{db_conn: conn} do
      tag1 =
        :crypto.hash(
          :md5,
          "dummy-stack-id" <> "dummy-shape-handle" <> "parent_id1:v:1" <> "parent_id2:v:1"
        )
        |> Base.encode16(case: :lower)

      tag2 =
        :crypto.hash(
          :md5,
          "dummy-stack-id" <> "dummy-shape-handle" <> "parent_id1:v:2" <> "parent_id2:v:2"
        )
        |> Base.encode16(case: :lower)

      tag3 =
        :crypto.hash(
          :md5,
          "dummy-stack-id" <> "dummy-shape-handle" <> "parent_id1:v:3" <> "parent_id2:v:3"
        )
        |> Base.encode16(case: :lower)

      for statement <- [
            "CREATE TABLE parent (id1 SERIAL, id2 SERIAL, value INTEGER, PRIMARY KEY (id1, id2))",
            "CREATE TABLE child (id1 SERIAL, id2 SERIAL, value INTEGER, parent_id1 INTEGER, parent_id2 INTEGER, PRIMARY KEY (id1, id2), FOREIGN KEY (parent_id1, parent_id2) REFERENCES parent(id1, id2))",
            "INSERT INTO parent (value) VALUES (1), (2), (3)",
            "INSERT INTO child (value, parent_id1, parent_id2) VALUES (4, 1, 1), (5, 2, 2), (6, 3, 3)"
          ],
          do: Postgrex.query!(conn, statement)

      shape =
        Shape.new!("child",
          where: "(parent_id1, parent_id2) IN (SELECT id1, id2 FROM parent)",
          inspector: {DirectInspector, conn}
        )

      assert [
               %{value: %{value: "4"}, headers: %{tags: [^tag1]}},
               %{value: %{value: "5"}, headers: %{tags: [^tag2]}},
               %{value: %{value: "6"}, headers: %{tags: [^tag3]}}
             ] =
               decode_stream(
                 Querying.stream_initial_data(conn, "dummy-stack-id", "dummy-shape-handle", shape)
               )
    end

    test "if shape has a subquery, tags the results (with quoted column names)", %{db_conn: conn} do
      for statement <- [
            "CREATE TABLE parent (id SERIAL PRIMARY KEY, value INTEGER)",
            "CREATE TABLE child (id SERIAL PRIMARY KEY, value INTEGER, \"parentId\" INTEGER REFERENCES parent(id))",
            "INSERT INTO parent (value) VALUES (1), (2), (3)",
            "INSERT INTO child (value, \"parentId\") VALUES (4, 1), (5, 2), (6, 3)"
          ],
          do: Postgrex.query!(conn, statement)

      shape =
        Shape.new!("child",
          where: "\"parentId\" IN (SELECT id FROM parent)",
          inspector: {DirectInspector, conn}
        )

      tag1 =
        :crypto.hash(:md5, "dummy-stack-id" <> "dummy-shape-handle" <> "v:1")
        |> Base.encode16(case: :lower)

      tag2 =
        :crypto.hash(:md5, "dummy-stack-id" <> "dummy-shape-handle" <> "v:2")
        |> Base.encode16(case: :lower)

      tag3 =
        :crypto.hash(:md5, "dummy-stack-id" <> "dummy-shape-handle" <> "v:3")
        |> Base.encode16(case: :lower)

      assert [
               %{value: %{value: "4"}, headers: %{tags: [^tag1]}},
               %{value: %{value: "5"}, headers: %{tags: [^tag2]}},
               %{value: %{value: "6"}, headers: %{tags: [^tag3]}}
             ] =
               decode_stream(
                 Querying.stream_initial_data(conn, "dummy-stack-id", "dummy-shape-handle", shape)
               )
    end
  end

  describe "query_move_in/5 with SubqueryMoves.move_in_where_clause/3" do
    test "builds the correct query which executes", %{db_conn: conn} do
      for statement <- [
            "CREATE TABLE parent (id SERIAL PRIMARY KEY, value INTEGER)",
            "CREATE TABLE child (id SERIAL PRIMARY KEY, value INTEGER, parent_id INTEGER REFERENCES parent(id))",
            "INSERT INTO parent (value) VALUES (1), (2), (3)",
            "INSERT INTO child (value, parent_id) VALUES (4, 1), (5, 2), (6, 3)"
          ],
          do: Postgrex.query!(conn, statement)

      shape =
        Shape.new!("child",
          where: "parent_id IN (SELECT id FROM parent)",
          inspector: {DirectInspector, conn}
        )
        |> fill_handles()

      move_in_values = ["1", "2"]

      assert {where, params} =
               SubqueryMoves.move_in_where_clause(
                 shape,
                 hd(shape.shape_dependencies_handles),
                 move_in_values
               )

      tag1 =
        :crypto.hash(:md5, "dummy-stack-id" <> "dummy-shape-handle" <> "v:1")
        |> Base.encode16(case: :lower)

      tag2 =
        :crypto.hash(:md5, "dummy-stack-id" <> "dummy-shape-handle" <> "v:2")
        |> Base.encode16(case: :lower)

      assert [
               %{value: %{value: "4"}, headers: %{tags: [^tag1]}},
               %{value: %{value: "5"}, headers: %{tags: [^tag2]}}
             ] =
               Querying.query_move_in(
                 conn,
                 "dummy-stack-id",
                 "dummy-shape-handle",
                 shape,
                 {where, params}
               )
               |> Enum.map(fn [_key, _tags, json] -> json end)
               |> decode_stream()
    end

    test "builds the correct query which executes with a composite PK", %{db_conn: conn} do
      for statement <- [
            "CREATE TABLE parent (id1 SERIAL, id2 SERIAL, value INTEGER, PRIMARY KEY (id1, id2))",
            "CREATE TABLE child (id1 SERIAL, id2 SERIAL, value INTEGER, parent_id1 INTEGER, parent_id2 INTEGER, PRIMARY KEY (id1, id2), FOREIGN KEY (parent_id1, parent_id2) REFERENCES parent(id1, id2))",
            "INSERT INTO parent (value) VALUES (1), (2), (3)",
            "INSERT INTO child (value, parent_id1, parent_id2) VALUES (4, 1, 1), (5, 2, 2), (6, 3, 3)"
          ],
          do: Postgrex.query!(conn, statement)

      shape =
        Shape.new!("child",
          where: "(parent_id1, parent_id2) IN (SELECT id1, id2 FROM parent)",
          inspector: {DirectInspector, conn}
        )
        |> fill_handles()

      move_in_values = [{"1", "1"}, {"2", "2"}]

      assert {where, params} =
               SubqueryMoves.move_in_where_clause(
                 shape,
                 hd(shape.shape_dependencies_handles),
                 move_in_values
               )

      tag1 =
        :crypto.hash(
          :md5,
          "dummy-stack-id" <> "dummy-shape-handle" <> "parent_id1:v:1" <> "parent_id2:v:1"
        )
        |> Base.encode16(case: :lower)

      tag2 =
        :crypto.hash(
          :md5,
          "dummy-stack-id" <> "dummy-shape-handle" <> "parent_id1:v:2" <> "parent_id2:v:2"
        )
        |> Base.encode16(case: :lower)

      assert [
               %{value: %{value: "4"}, headers: %{tags: [^tag1]}},
               %{value: %{value: "5"}, headers: %{tags: [^tag2]}}
             ] =
               Querying.query_move_in(
                 conn,
                 "dummy-stack-id",
                 "dummy-shape-handle",
                 shape,
                 {where, params}
               )
               |> Enum.map(fn [_key, _tags, json] -> json end)
               |> decode_stream()
    end
  end

  defp decode_stream(stream),
    do:
      stream
      |> Enum.to_list()
      |> Enum.map(fn
        :chunk_boundary -> :chunk_boundary
        json_item -> Jason.decode!(json_item, keys: :atoms)
      end)

  defp fill_handles(shape) do
    filled_deps = Enum.map(shape.shape_dependencies, &fill_handles/1)
    handles = Enum.map(filled_deps, &Shape.generate_id/1)
    %{shape | shape_dependencies: filled_deps, shape_dependencies_handles: handles}
  end
end
