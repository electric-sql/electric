defmodule Electric.Shapes.QueryingTest do
  use Support.TransactionCase, async: true

  alias Electric.Replication.Eval.Parser
  alias Electric.Shapes.DnfPlan
  alias Electric.Postgres.Inspector.DirectInspector
  alias Electric.Shapes.Querying
  alias Electric.Shapes.Shape

  @refs %{
    ["id"] => :int4,
    ["x"] => :int4,
    ["y"] => :int4,
    ["z"] => :int4,
    ["status"] => :text,
    ["name"] => :text,
    ["a"] => :int4,
    ["b"] => :int4
  }
  @stack_id "test_stack"
  @shape_handle "test_shape"

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
               %{
                 value: %{value: "10", parent_id: "1"},
                 headers: %{
                   tags: [^tag1 <> "/", "/1"],
                   active_conditions: [true, false]
                 }
               },
               %{
                 value: %{value: "20", parent_id: nil},
                 headers: %{
                   tags: [^tag_null <> "/", "/1"],
                   active_conditions: [false, true]
                 }
               },
               %{
                 value: %{value: "30", parent_id: "2"},
                 headers: %{
                   tags: [^tag2 <> "/", "/1"],
                   active_conditions: [true, false]
                 }
               }
             ] = result
    end

    test "if shape has a negated subquery, computes DNF tags and active conditions", %{
      db_conn: conn
    } do
      for statement <- [
            "CREATE TABLE parent (id SERIAL PRIMARY KEY, excluded BOOLEAN NOT NULL DEFAULT FALSE)",
            "CREATE TABLE child (id SERIAL PRIMARY KEY, value INTEGER, parent_id INTEGER REFERENCES parent(id))",
            "INSERT INTO parent (excluded) VALUES (false), (true)",
            "INSERT INTO child (value, parent_id) VALUES (10, 1), (20, 2)"
          ],
          do: Postgrex.query!(conn, statement)

      shape =
        Shape.new!("child",
          where: "parent_id NOT IN (SELECT id FROM parent WHERE excluded = true)",
          inspector: {DirectInspector, conn}
        )

      tag1 =
        :crypto.hash(:md5, "dummy-stack-id" <> "dummy-shape-handle" <> "v:1")
        |> Base.encode16(case: :lower)

      assert [
               %{
                 value: %{value: "10", parent_id: "1"},
                 headers: %{
                   tags: [^tag1],
                   active_conditions: [true]
                 }
               }
             ] =
               decode_stream(
                 Querying.stream_initial_data(conn, "dummy-stack-id", "dummy-shape-handle", shape)
               )
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

    test "preserves space padding for char(n) columns in pk-less table", %{db_conn: conn} do
      Postgrex.query!(
        conn,
        """
        CREATE TABLE padded_no_pk (
          code CHAR(6),
          name TEXT
        )
        """,
        []
      )

      Postgrex.query!(
        conn,
        "INSERT INTO padded_no_pk VALUES ('ab', 'first'), ('cd', 'second'), (NULL, 'third')",
        []
      )

      shape = Shape.new!("padded_no_pk", inspector: {DirectInspector, conn})

      assert [
               %{
                 key: ~S["public"."padded_no_pk"/"ab    "/"first"],
                 value: %{code: "ab    ", name: "first"}
               },
               %{
                 key: ~S["public"."padded_no_pk"/"cd    "/"second"],
                 value: %{code: "cd    ", name: "second"}
               },
               %{
                 key: ~S["public"."padded_no_pk"/_/"third"],
                 value: %{code: nil, name: "third"}
               }
             ] =
               decode_stream(
                 Querying.stream_initial_data(conn, "dummy-stack-id", "dummy-shape-handle", shape)
               )
    end

    test "preserves space padding for char(n) columns", %{db_conn: conn} do
      Postgrex.query!(
        conn,
        """
        CREATE TABLE padded (
          id CHAR(8) PRIMARY KEY,
          name CHAR(10),
          label TEXT
        )
        """,
        []
      )

      Postgrex.query!(
        conn,
        "INSERT INTO padded VALUES ('ab', 'hello', 'world'), ('cd', NULL, 'test')",
        []
      )

      shape = Shape.new!("padded", inspector: {DirectInspector, conn})

      assert [
               %{
                 key: ~S["public"."padded"/"ab      "],
                 value: %{
                   id: "ab      ",
                   name: "hello     ",
                   label: "world"
                 },
                 headers: %{operation: "insert", relation: ["public", "padded"]}
               },
               %{
                 key: ~S["public"."padded"/"cd      "],
                 value: %{
                   id: "cd      ",
                   name: nil,
                   label: "test"
                 },
                 headers: %{operation: "insert", relation: ["public", "padded"]}
               }
             ] =
               decode_stream(
                 Querying.stream_initial_data(conn, "dummy-stack-id", "dummy-shape-handle", shape)
               )
    end
  end

  describe "query_move_in/5 with Querying.move_in_where_clause/5" do
    test "preserves space padding for char(n) join columns", %{db_conn: conn} do
      for statement <- [
            "CREATE TABLE parent (id CHAR(8) PRIMARY KEY, value INTEGER)",
            "CREATE TABLE child (id SERIAL PRIMARY KEY, value INTEGER, parent_id CHAR(8) REFERENCES parent(id))",
            "INSERT INTO parent VALUES ('ab', 1), ('cd', 2), ('ef', 3)",
            "INSERT INTO child (value, parent_id) VALUES (4, 'ab'), (5, 'cd'), (6, 'ef')"
          ],
          do: Postgrex.query!(conn, statement)

      shape =
        Shape.new!("child",
          where: "parent_id IN (SELECT id FROM parent)",
          inspector: {DirectInspector, conn}
        )
        |> fill_handles()

      {:ok, dnf_plan} = DnfPlan.compile(shape)
      move_in_values = ["ab      ", "cd      "]

      assert {where, params} =
               Querying.move_in_where_clause(
                 dnf_plan,
                 0,
                 move_in_values,
                 %{["$sublink", "0"] => MapSet.new()},
                 shape.where.used_refs
               )

      assert [
               %{value: %{parent_id: "ab      "}},
               %{value: %{parent_id: "cd      "}}
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

      {:ok, dnf_plan} = DnfPlan.compile(shape)
      move_in_values = [1, 2]

      assert {where, params} =
               Querying.move_in_where_clause(
                 dnf_plan,
                 0,
                 move_in_values,
                 %{["$sublink", "0"] => MapSet.new()},
                 shape.where.used_refs
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

      {:ok, dnf_plan} = DnfPlan.compile(shape)
      move_in_values = [{1, 1}, {2, 2}]

      assert {where, params} =
               Querying.move_in_where_clause(
                 dnf_plan,
                 0,
                 move_in_values,
                 %{["$sublink", "0"] => MapSet.new()},
                 shape.where.used_refs
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

  describe "move_in_where_clause/5 - x IN sq1 OR y IN sq2" do
    setup do
      {where, deps} =
        parse_where_with_sublinks(
          ~S"x IN (SELECT id FROM dep1) OR y IN (SELECT id FROM dep2)",
          2
        )

      shape = make_shape(where, deps)
      {:ok, plan} = DnfPlan.compile(shape)
      %{plan: plan, where: where}
    end

    test "move on dep 0 generates candidate for sq1 and exclusion for sq2",
         %{plan: plan, where: where} do
      move_in_values = [1, 2, 3]
      views = %{["$sublink", "0"] => MapSet.new([10]), ["$sublink", "1"] => MapSet.new([20, 30])}

      {sql, params} =
        Querying.move_in_where_clause(plan, 0, move_in_values, views, where.used_refs)

      assert sql =~ "= ANY ($1::"
      assert sql =~ "AND NOT"
      assert sql =~ "= ANY ($2::"
      assert length(params) == 2
      assert Enum.at(params, 0) == [1, 2, 3]
      assert Enum.sort(Enum.at(params, 1)) == [20, 30]
    end

    test "move on dep 1 generates candidate for sq2 and exclusion for sq1",
         %{plan: plan, where: where} do
      move_in_values = [100]
      views = %{["$sublink", "0"] => MapSet.new([5]), ["$sublink", "1"] => MapSet.new([10])}

      {sql, params} =
        Querying.move_in_where_clause(plan, 1, move_in_values, views, where.used_refs)

      assert sql =~ "AND NOT"
      assert length(params) == 2
      assert Enum.at(params, 0) == [100]
      assert Enum.at(params, 1) == [5]
    end
  end

  describe "move_in_where_clause/5 - (x IN sq1 AND status = 'open') OR y IN sq2" do
    setup do
      {where, deps} =
        parse_where_with_sublinks(
          ~S"(x IN (SELECT id FROM dep1) AND status = 'open') OR y IN (SELECT id FROM dep2)",
          2
        )

      shape = make_shape(where, deps)
      {:ok, plan} = DnfPlan.compile(shape)
      %{plan: plan, where: where}
    end

    test "move on dep 0 includes row predicate in candidate",
         %{plan: plan, where: where} do
      move_in_values = [1, 2]
      views = %{["$sublink", "0"] => MapSet.new([10]), ["$sublink", "1"] => MapSet.new([20])}

      {sql, params} =
        Querying.move_in_where_clause(plan, 0, move_in_values, views, where.used_refs)

      assert sql =~ "= ANY ($1::"
      assert sql =~ ~s|"status" = 'open'|
      assert sql =~ "AND NOT"
      assert length(params) == 2
    end
  end

  describe "move_in_where_clause/5 - negated subqueries" do
    test "uses positive delta membership for x NOT IN sq1" do
      {where, deps} =
        parse_where_with_sublinks(~S"NOT x IN (SELECT id FROM dep1)", 1)

      shape = make_shape(where, deps)
      {:ok, plan} = DnfPlan.compile(shape)

      {sql, params} =
        Querying.move_in_where_clause(
          plan,
          0,
          [1, 2],
          %{["$sublink", "0"] => MapSet.new([1, 2, 3])},
          where.used_refs
        )

      assert sql =~ ~s|"x" = ANY ($1::|
      refute sql =~ ~s|NOT ("x" = ANY ($1::|
      assert params == [[1, 2]]
    end

    test "uses delta membership only for the triggering negated subquery position" do
      {where, deps} =
        parse_where_with_sublinks(~S"NOT (x = 7 OR y IN (SELECT id FROM dep1))", 1)

      shape = make_shape(where, deps)
      {:ok, plan} = DnfPlan.compile(shape)

      {sql, params} =
        Querying.move_in_where_clause(
          plan,
          0,
          [5],
          %{["$sublink", "0"] => MapSet.new([5, 6])},
          where.used_refs
        )

      assert sql =~ ~s|NOT ("x" = 7)|
      assert sql =~ ~s|"y" = ANY ($1::|
      refute sql =~ ~s|NOT ("y" = ANY ($1::|
      assert params == [[5]]
    end
  end

  describe "active_conditions_sql/1" do
    test "generates per-position boolean SQL expressions" do
      {where, deps} =
        parse_where_with_sublinks(
          ~S"(x IN (SELECT id FROM dep1) AND status = 'open') OR y IN (SELECT id FROM dep2)",
          2
        )

      shape = make_shape(where, deps)
      {:ok, plan} = DnfPlan.compile(shape)

      sqls = Querying.active_conditions_sql(plan)

      assert length(sqls) == plan.position_count

      Enum.each(sqls, fn sql ->
        assert sql =~ "::boolean"
      end)
    end
  end

  describe "tags_sql/3" do
    test "generates per-disjunct tag SQL with position slots" do
      {where, deps} =
        parse_where_with_sublinks(
          ~S"(x IN (SELECT id FROM dep1) AND status = 'open') OR y IN (SELECT id FROM dep2)",
          2
        )

      shape = make_shape(where, deps)
      {:ok, plan} = DnfPlan.compile(shape)

      sqls = Querying.tags_sql(plan, @stack_id, @shape_handle)

      assert length(sqls) == length(plan.disjuncts)

      Enum.each(sqls, fn sql ->
        assert sql =~ "'/' ||"
      end)

      [tag0_sql, _tag1_sql] = sqls
      assert tag0_sql =~ "md5("
      assert tag0_sql =~ "'1'"
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

  defp parse_where_with_sublinks(where_clause, num_deps, opts \\ []) do
    sublink_refs =
      Keyword.get_lazy(opts, :sublink_refs, fn ->
        Map.new(0..(num_deps - 1), fn i ->
          {["$sublink", "#{i}"], {:array, :int4}}
        end)
      end)

    dep_columns = Keyword.get(opts, :dep_columns, nil)

    sublink_queries =
      Map.new(0..(num_deps - 1), fn i ->
        cols =
          if dep_columns do
            Enum.at(dep_columns, i) |> Enum.join(", ")
          else
            "id"
          end

        {i, "SELECT #{cols} FROM dep#{i + 1}"}
      end)

    all_refs = Map.merge(@refs, sublink_refs)
    {:ok, pgquery} = Parser.parse_query(where_clause)

    {:ok, expr} =
      Parser.validate_where_ast(pgquery,
        refs: all_refs,
        sublink_queries: sublink_queries
      )

    deps =
      Enum.map(0..(num_deps - 1), fn _i ->
        %Shape{
          root_table: {"public", "dep"},
          root_table_id: 100,
          root_pk: ["id"],
          root_column_count: 1,
          where: nil,
          selected_columns: ["id"],
          explicitly_selected_columns: ["id"]
        }
      end)

    {expr, deps}
  end

  defp make_shape(where, deps) do
    %Shape{
      root_table: {"public", "test"},
      root_table_id: 1,
      root_pk: ["id"],
      root_column_count: 5,
      where: where,
      selected_columns: ["id", "x", "y", "status"],
      explicitly_selected_columns: ["id", "x", "y", "status"],
      shape_dependencies: deps,
      shape_dependencies_handles: Enum.with_index(deps, fn _, i -> "dep_handle_#{i}" end)
    }
  end
end
