defmodule Electric.Plug.RouterTest do
  @moduledoc """
  Integration router tests that set up entire stack with unique DB.

  Unit tests should be preferred wherever possible because they will run faster.
  """
  use ExUnit.Case

  import Support.ComponentSetup
  import Support.DbSetup
  import Support.DbStructureSetup
  import Plug.Test

  alias Electric.Plug.Router
  alias Electric.Replication.Changes
  alias Electric.Replication.LogOffset

  @moduletag :tmp_dir
  @moduletag :capture_log

  @first_offset to_string(LogOffset.first())

  describe "/" do
    test "returns 200" do
      assert %{status: 200, resp_body: ""} = Router.call(conn("GET", "/"), [])
    end
  end

  describe "/nonexistent" do
    test "returns 404" do
      assert %{status: 404, resp_body: "Not found"} = Router.call(conn("GET", "/nonexistent"), [])
    end
  end

  describe "/v1/shapes" do
    setup [:with_unique_db, :with_basic_tables, :with_sql_execute]

    setup do
      %{publication_name: "electric_test_publication", slot_name: "electric_test_slot"}
    end

    setup :with_complete_stack

    setup(ctx, do: %{opts: Router.init(build_router_opts(ctx))})

    @tag with_sql: [
           "INSERT INTO items VALUES (gen_random_uuid(), 'test value 1')"
         ]
    test "GET returns a snapshot of initial data", %{opts: opts} do
      conn =
        conn("GET", "/v1/shape/items?offset=-1")
        |> Router.call(opts)

      assert %{status: 200} = conn

      assert [
               %{
                 "headers" => %{"operation" => "insert"},
                 "key" => _,
                 "offset" => @first_offset,
                 "value" => %{
                   "id" => _,
                   "value" => "test value 1"
                 }
               },
               %{"headers" => %{"control" => "up-to-date"}}
             ] = Jason.decode!(conn.resp_body)
    end

    test "GET returns an error when table is not found", %{opts: opts} do
      conn =
        conn("GET", "/v1/shape/nonexistent?offset=-1")
        |> Router.call(opts)

      assert %{status: 400} = conn

      assert %{"root_table" => ["table not found"]} = Jason.decode!(conn.resp_body)
    end

    @tag additional_fields: "num INTEGER NOT NULL"
    @tag with_sql: [
           "INSERT INTO items VALUES (gen_random_uuid(), 'test value 1', 1)"
         ]
    test "GET returns values in the snapshot and the rest of the log in the same format (as strings)",
         %{opts: opts, db_conn: db_conn} do
      conn = conn("GET", "/v1/shape/items?offset=-1") |> Router.call(opts)
      assert [%{"value" => %{"num" => "1"}}, _] = Jason.decode!(conn.resp_body)

      Postgrex.query!(
        db_conn,
        "INSERT INTO items VALUES (gen_random_uuid(), 'test value 2', 2)",
        []
      )

      [shape_id] = Plug.Conn.get_resp_header(conn, "x-electric-shape-id")

      conn =
        conn("GET", "/v1/shape/items?shape_id=#{shape_id}&offset=0_0&live") |> Router.call(opts)

      assert [%{"value" => %{"num" => "2"}}, _] = Jason.decode!(conn.resp_body)
    end

    @tag with_sql: [
           "INSERT INTO items VALUES (gen_random_uuid(), 'test value 1')"
         ]
    test "DELETE forces the shape ID to be different on reconnect and new snapshot to be created",
         %{opts: opts, db_conn: db_conn} do
      conn =
        conn("GET", "/v1/shape/items?offset=-1")
        |> Router.call(opts)

      assert %{status: 200} = conn
      assert [shape_id] = Plug.Conn.get_resp_header(conn, "x-electric-shape-id")

      assert [%{"value" => %{"value" => "test value 1"}}, %{"headers" => _}] =
               Jason.decode!(conn.resp_body)

      assert %{status: 202} =
               conn("DELETE", "/v1/shape/items?shape_id=#{shape_id}")
               |> Router.call(opts)

      Postgrex.query!(db_conn, "DELETE FROM items", [])
      Postgrex.query!(db_conn, "INSERT INTO items VALUES (gen_random_uuid(), 'test value 2')", [])

      conn =
        conn("GET", "/v1/shape/items?offset=-1")
        |> Router.call(opts)

      assert %{status: 200} = conn
      assert [shape_id2] = Plug.Conn.get_resp_header(conn, "x-electric-shape-id")
      assert shape_id != shape_id2

      assert [%{"value" => %{"value" => "test value 2"}}, %{"headers" => _}] =
               Jason.decode!(conn.resp_body)
    end

    @tag with_sql: [
           "CREATE TABLE foo (second TEXT NOT NULL, first TEXT NOT NULL, fourth TEXT, third TEXT NOT NULL, PRIMARY KEY (first, second, third))",
           "INSERT INTO foo (first, second, third, fourth) VALUES ('a', 'b', 'c', 'd')"
         ]
    test "correctly snapshots and follows a table with a composite PK", %{
      opts: opts,
      db_conn: db_conn
    } do
      # Request a snapshot
      conn =
        conn("GET", "/v1/shape/foo?offset=-1")
        |> Router.call(opts)

      assert %{status: 200} = conn
      assert [shape_id] = Plug.Conn.get_resp_header(conn, "x-electric-shape-id")

      key =
        Changes.build_key({"public", "foo"}, %{"first" => "a", "second" => "b", "third" => "c"}, [
          "first",
          "second",
          "third"
        ])

      assert [
               %{
                 "headers" => %{"operation" => "insert"},
                 "key" => ^key,
                 "offset" => @first_offset,
                 "value" => %{
                   "first" => "a",
                   "second" => "b",
                   "third" => "c",
                   "fourth" => "d"
                 }
               },
               %{"headers" => %{"control" => "up-to-date"}}
             ] = Jason.decode!(conn.resp_body)

      task =
        Task.async(fn ->
          conn("GET", "/v1/shape/foo?offset=#{@first_offset}&shape_id=#{shape_id}&live")
          |> Router.call(opts)
        end)

      # insert a new thing
      Postgrex.query!(
        db_conn,
        "INSERT INTO foo (first, second, third, fourth) VALUES ('e', 'f', 'g', 'h')",
        []
      )

      conn = Task.await(task)

      assert %{status: 200} = conn

      key2 =
        Changes.build_key({"public", "foo"}, %{"first" => "e", "second" => "f", "third" => "g"}, [
          "first",
          "second",
          "third"
        ])

      assert [
               %{
                 "headers" => %{"operation" => "insert"},
                 "key" => ^key2,
                 "offset" => _,
                 "value" => %{
                   "first" => "e",
                   "second" => "f",
                   "third" => "g",
                   "fourth" => "h"
                 }
               },
               %{"headers" => %{"control" => "up-to-date"}}
             ] = Jason.decode!(conn.resp_body)
    end

    @tag with_sql: [
           "CREATE TABLE wide_table (id BIGINT PRIMARY KEY, value1 TEXT NOT NULL, value2 TEXT NOT NULL, value3 TEXT NOT NULL)",
           "INSERT INTO wide_table VALUES (1, 'test value 1', 'test value 1', 'test value 1')"
         ]
    test "GET received only a diff when receiving updates", %{opts: opts, db_conn: db_conn} do
      conn = conn("GET", "/v1/shape/wide_table?offset=-1") |> Router.call(opts)
      assert %{status: 200} = conn
      [shape_id] = Plug.Conn.get_resp_header(conn, "x-electric-shape-id")

      assert [
               %{
                 "value" => %{"id" => _, "value1" => _, "value2" => _, "value3" => _},
                 "key" => key
               },
               _
             ] =
               Jason.decode!(conn.resp_body)

      task =
        Task.async(fn ->
          conn("GET", "/v1/shape/wide_table?offset=0_0&shape_id=#{shape_id}&live")
          |> Router.call(opts)
        end)

      Postgrex.query!(db_conn, "UPDATE wide_table SET value2 = 'test value 2' WHERE id = 1", [])

      assert %{status: 200} = conn = Task.await(task)

      # No extra keys should be present, so this is a pin
      value = %{"id" => "1", "value2" => "test value 2"}
      assert [%{"key" => ^key, "value" => ^value}, _] = Jason.decode!(conn.resp_body)
    end

    @tag with_sql: [
           "CREATE TABLE wide_table (id BIGINT PRIMARY KEY, value1 TEXT NOT NULL, value2 TEXT NOT NULL, value3 TEXT NOT NULL)",
           "INSERT INTO wide_table VALUES (1, 'test value 1', 'test value 1', 'test value 1')"
         ]
    test "GET splits up updates into 2 operations if PK was changed", %{
      opts: opts,
      db_conn: db_conn
    } do
      conn = conn("GET", "/v1/shape/wide_table?offset=-1") |> Router.call(opts)
      assert %{status: 200} = conn
      [shape_id] = Plug.Conn.get_resp_header(conn, "x-electric-shape-id")

      assert [
               %{
                 "value" => %{"id" => _, "value1" => _, "value2" => _, "value3" => _},
                 "key" => key
               },
               _
             ] =
               Jason.decode!(conn.resp_body)

      task =
        Task.async(fn ->
          conn("GET", "/v1/shape/wide_table?offset=0_0&shape_id=#{shape_id}&live")
          |> Router.call(opts)
        end)

      Postgrex.transaction(db_conn, fn tx_conn ->
        Postgrex.query!(
          tx_conn,
          "UPDATE wide_table SET id = 2, value2 = 'test value 2' WHERE id = 1",
          []
        )

        Postgrex.query!(
          tx_conn,
          "INSERT INTO wide_table VALUES (3, 'other', 'other', 'other')",
          []
        )
      end)

      assert %{status: 200} = conn = Task.await(task)

      assert [
               %{
                 "headers" => %{"operation" => "delete"},
                 "value" => %{"id" => "1"},
                 "key" => ^key
               },
               %{
                 "headers" => %{"operation" => "insert"},
                 "value" => %{"id" => "2", "value1" => _, "value2" => _, "value3" => _},
                 "key" => key2
               },
               %{
                 "headers" => %{"operation" => "insert"},
                 "value" => %{"id" => "3", "value1" => _, "value2" => _, "value3" => _},
                 "key" => key3
               },
               _
             ] = Jason.decode!(conn.resp_body)

      assert key2 != key
      assert key3 != key2
      assert key3 != key
    end

    @tag with_sql: [
           "CREATE TABLE test_table (col1 TEXT NOT NULL, col2 TEXT NOT NULL)",
           "INSERT INTO test_table VALUES ('test1', 'test2')"
         ]
    test "GET works correctly when table has no PK",
         %{opts: opts, db_conn: db_conn} do
      conn = conn("GET", "/v1/shape/test_table?offset=-1") |> Router.call(opts)
      assert %{status: 200} = conn
      [shape_id] = Plug.Conn.get_resp_header(conn, "x-electric-shape-id")

      assert [%{"value" => %{"col1" => "test1", "col2" => "test2"}, "key" => key}, _] =
               Jason.decode!(conn.resp_body)

      task =
        Task.async(fn ->
          conn("GET", "/v1/shape/test_table?offset=0_0&shape_id=#{shape_id}&live")
          |> Router.call(opts)
        end)

      # We're doing multiple operations here to check if splitting an operation breaks offsets in some manner
      Postgrex.transaction(db_conn, fn tx_conn ->
        Postgrex.query!(tx_conn, "UPDATE test_table SET col1 = 'test3'", [])
        Postgrex.query!(tx_conn, "INSERT INTO test_table VALUES ('test4', 'test5')", [])
      end)

      assert %{status: 200} = conn = Task.await(task)

      assert [
               %{
                 "headers" => %{"operation" => "delete"},
                 "value" => %{"col1" => "test1", "col2" => "test2"},
                 "key" => ^key
               },
               %{
                 "headers" => %{"operation" => "insert"},
                 "value" => %{"col1" => "test3", "col2" => "test2"},
                 "key" => key2
               },
               %{
                 "headers" => %{"operation" => "insert"},
                 "value" => %{"col1" => "test4", "col2" => "test5"},
                 "key" => key3
               },
               _
             ] = Jason.decode!(conn.resp_body)

      assert key2 != key
      assert key3 != key2
      assert key3 != key
    end

    test "GET works when there are changes not related to the shape in the same txn", %{
      opts: opts,
      db_conn: db_conn
    } do
      params = %{offset: "-1", where: "value ILIKE 'yes%'"}

      conn =
        conn("GET", "/v1/shape/items", params)
        |> Router.call(opts)

      assert %{status: 200} = conn
      [shape_id] = Plug.Conn.get_resp_header(conn, "x-electric-shape-id")

      assert [_] = Jason.decode!(conn.resp_body)

      params = Map.merge(params, %{offset: "0_0", shape_id: shape_id, live: true})

      task =
        Task.async(fn -> conn("GET", "/v1/shape/items", params) |> Router.call(opts) end)

      Postgrex.query!(
        db_conn,
        "INSERT INTO items (id, value) VALUES (gen_random_uuid(), $1), (gen_random_uuid(), $2)",
        ["yes!", "no :("]
      )

      assert %{status: 200} = conn = Task.await(task)

      assert [%{"value" => %{"value" => "yes!"}}, _] = Jason.decode!(conn.resp_body)
      assert [new_offset] = Plug.Conn.get_resp_header(conn, "x-electric-chunk-last-offset")

      params = params |> Map.put(:offset, new_offset) |> Map.delete(:live)

      assert %{status: 200} =
               conn =
               conn("GET", "/v1/shape/items", params)
               |> Router.call(opts)

      assert [_] = Jason.decode!(conn.resp_body)
    end
  end
end
