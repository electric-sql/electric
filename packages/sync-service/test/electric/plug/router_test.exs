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
  @up_to_date %{"headers" => %{"control" => "up-to-date"}}

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

  describe "/v1/health" do
    setup [:with_unique_db]

    setup do
      %{publication_name: "electric_test_publication", slot_name: "electric_test_slot"}
    end

    setup :with_complete_stack

    setup(ctx,
      do: %{opts: Router.init(build_router_opts(ctx, get_service_status: fn -> :active end))}
    )

    test "GET returns health status of service", %{opts: opts} do
      conn =
        conn("GET", "/v1/health")
        |> Router.call(opts)

      assert %{status: 200} = conn
      assert Jason.decode!(conn.resp_body) == %{"status" => "active"}
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
               }
             ] = Jason.decode!(conn.resp_body)
    end

    test "GET returns an error when table is not found", %{opts: opts} do
      conn =
        conn("GET", "/v1/shape/nonexistent?offset=-1")
        |> Router.call(opts)

      assert %{status: 400} = conn

      assert %{
               "root_table" => [
                 ~s|Table "nonexistent" does not exist. If the table name contains capitals or special characters you must quote it.|
               ]
             } = Jason.decode!(conn.resp_body)
    end

    @tag additional_fields: "num INTEGER NOT NULL"
    @tag with_sql: [
           "INSERT INTO items VALUES (gen_random_uuid(), 'test value 1', 1)"
         ]
    test "GET returns values in the snapshot and the rest of the log in the same format (as strings)",
         %{opts: opts, db_conn: db_conn} do
      conn = conn("GET", "/v1/shape/items?offset=-1") |> Router.call(opts)
      assert [%{"value" => %{"num" => "1"}}] = Jason.decode!(conn.resp_body)

      Postgrex.query!(
        db_conn,
        "INSERT INTO items VALUES (gen_random_uuid(), 'test value 2', 2)",
        []
      )

      shape_handle = get_resp_shape_handle(conn)

      conn =
        conn("GET", "/v1/shape/items?shape_handle=#{shape_handle}&offset=0_0&live")
        |> Router.call(opts)

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
      shape1_id = get_resp_shape_handle(conn)

      assert [%{"value" => %{"value" => "test value 1"}}] =
               Jason.decode!(conn.resp_body)

      assert %{status: 202} =
               conn("DELETE", "/v1/shape/items?shape_handle=#{shape1_id}")
               |> Router.call(opts)

      Postgrex.query!(db_conn, "DELETE FROM items", [])
      Postgrex.query!(db_conn, "INSERT INTO items VALUES (gen_random_uuid(), 'test value 2')", [])

      conn =
        conn("GET", "/v1/shape/items?offset=-1")
        |> Router.call(opts)

      assert %{status: 200} = conn
      shape2_id = get_resp_shape_handle(conn)
      assert shape1_id != shape2_id

      assert [%{"value" => %{"value" => "test value 2"}}] =
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
      shape_handle = get_resp_shape_handle(conn)

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
               }
             ] = Jason.decode!(conn.resp_body)

      task =
        Task.async(fn ->
          conn("GET", "/v1/shape/foo?offset=#{@first_offset}&shape_handle=#{shape_handle}&live")
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
               @up_to_date
             ] = Jason.decode!(conn.resp_body)
    end

    @tag with_sql: [
           "CREATE TABLE wide_table (id BIGINT PRIMARY KEY, value1 TEXT NOT NULL, value2 TEXT NOT NULL, value3 TEXT NOT NULL)",
           "INSERT INTO wide_table VALUES (1, 'test value 1', 'test value 1', 'test value 1')"
         ]
    test "GET received only a diff when receiving updates", %{opts: opts, db_conn: db_conn} do
      conn = conn("GET", "/v1/shape/wide_table?offset=-1") |> Router.call(opts)
      assert %{status: 200} = conn
      shape_handle = get_resp_shape_handle(conn)

      assert [
               %{
                 "value" => %{"id" => _, "value1" => _, "value2" => _, "value3" => _},
                 "key" => key
               }
             ] = Jason.decode!(conn.resp_body)

      task =
        Task.async(fn ->
          conn("GET", "/v1/shape/wide_table?offset=0_0&shape_handle=#{shape_handle}&live")
          |> Router.call(opts)
        end)

      Postgrex.query!(db_conn, "UPDATE wide_table SET value2 = 'test value 2' WHERE id = 1", [])

      assert %{status: 200} = conn = Task.await(task)

      # No extra keys should be present, so this is a pin
      value = %{"id" => "1", "value2" => "test value 2"}
      assert [%{"key" => ^key, "value" => ^value}, @up_to_date] = Jason.decode!(conn.resp_body)
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
      shape_handle = get_resp_shape_handle(conn)

      assert [
               %{
                 "value" => %{"id" => _, "value1" => _, "value2" => _, "value3" => _},
                 "key" => key
               }
             ] = Jason.decode!(conn.resp_body)

      task =
        Task.async(fn ->
          conn("GET", "/v1/shape/wide_table?offset=0_0&shape_handle=#{shape_handle}&live")
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
               @up_to_date
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
      shape_handle = get_resp_shape_handle(conn)

      assert [%{"value" => %{"col1" => "test1", "col2" => "test2"}, "key" => key}] =
               Jason.decode!(conn.resp_body)

      task =
        Task.async(fn ->
          conn("GET", "/v1/shape/test_table?offset=0_0&shape_handle=#{shape_handle}&live")
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
               @up_to_date
             ] = Jason.decode!(conn.resp_body)

      assert key2 != key
      assert key3 != key2
      assert key3 != key
    end

    @tag with_sql: [
           "CREATE TABLE wide_table (id BIGINT PRIMARY KEY, value1 TEXT NOT NULL, value2 TEXT NOT NULL, value3 TEXT NOT NULL)",
           "INSERT INTO wide_table VALUES (1, 'test value 1', 'test value 1', 'test value 1')"
         ]
    test "GET receives only specified columns out of wide table", %{opts: opts, db_conn: db_conn} do
      conn = conn("GET", "/v1/shape/wide_table?offset=-1&columns=id,value1") |> Router.call(opts)
      assert %{status: 200} = conn
      shape_id = get_resp_shape_id(conn)

      assert [
               %{
                 "value" => %{"id" => "1", "value1" => "test value 1"},
                 "key" => key,
                 "offset" => next_offset
               }
             ] = Jason.decode!(conn.resp_body)

      test_pid = self()

      task =
        Task.async(fn ->
          conn(
            "GET",
            "/v1/shape/wide_table?offset=#{next_offset}&columns=id,value1&shape_id=#{shape_id}&live"
          )
          |> Router.call(opts)
          |> then(fn conn ->
            send(test_pid, :got_response)
            conn
          end)
        end)

      # Ensure updates to not-selected columns do not trigger responses
      Postgrex.query!(db_conn, "UPDATE wide_table SET value2 = 'test value 2' WHERE id = 1", [])
      refute_receive :got_response, 1000

      Postgrex.query!(db_conn, "UPDATE wide_table SET value1 = 'test value 3' WHERE id = 1", [])

      assert_receive :got_response
      assert %{status: 200} = conn = Task.await(task)

      value = %{"id" => "1", "value1" => "test value 3"}
      assert [%{"key" => ^key, "value" => ^value}, _] = Jason.decode!(conn.resp_body)
    end

    test "GET works when there are changes not related to the shape in the same txn", %{
      opts: opts,
      db_conn: db_conn
    } do
      where = "value ILIKE 'yes%'"

      conn =
        conn("GET", "/v1/shape/items", %{offset: "-1", where: where})
        |> Router.call(opts)

      assert %{status: 200} = conn
      shape_handle = get_resp_shape_handle(conn)

      assert [] = Jason.decode!(conn.resp_body)

      task =
        Task.async(fn ->
          conn("GET", "/v1/shape/items", %{
            offset: "0_0",
            shape_handle: shape_handle,
            where: where,
            live: true
          })
          |> Router.call(opts)
        end)

      Postgrex.query!(
        db_conn,
        "INSERT INTO items (id, value) VALUES (gen_random_uuid(), $1), (gen_random_uuid(), $2)",
        ["yes!", "no :("]
      )

      assert %{status: 200} = conn = Task.await(task)

      assert [%{"value" => %{"value" => "yes!"}}, _] = Jason.decode!(conn.resp_body)
      new_offset = get_resp_last_offset(conn)

      assert %{status: 200} =
               conn =
               conn("GET", "/v1/shape/items", %{
                 offset: new_offset,
                 shape_handle: shape_handle,
                 where: where
               })
               |> Router.call(opts)

      assert [_] = Jason.decode!(conn.resp_body)
    end

    @tag additional_fields: "num INTEGER NOT NULL"
    @tag with_sql: [
           "INSERT INTO serial_ids (id, num) VALUES (1, 1), (2, 10)"
         ]
    test "GET returns correct INSERT and DELETE operations that have been converted from UPDATEs",
         %{opts: opts, db_conn: db_conn} do
      where = "num > 5"

      # Verify that a single row is in-shape initially.
      conn =
        conn("GET", "/v1/shape/serial_ids", %{offset: "-1", where: where})
        |> Router.call(opts)

      assert %{status: 200} = conn

      shape_handle = get_resp_shape_id(conn)
      assert [op] = Jason.decode!(conn.resp_body)

      assert op == %{
               "headers" => %{"operation" => "insert", "relation" => ["public", "serial_ids"]},
               "key" => ~s|"public"."serial_ids"/"2"|,
               "offset" => "0_0",
               "value" => %{"id" => "2", "num" => "10"}
             }

      # Insert more rows and verify their delivery to a live shape subscriber.
      Postgrex.query!(db_conn, "INSERT INTO serial_ids(id, num) VALUES (3, 8), (4, 9)", [])

      task =
        Task.async(fn ->
          conn("GET", "/v1/shape/serial_ids", %{
            offset: "0_0",
            shape_handle: shape_handle,
            where: where,
            live: true
          })
          |> Router.call(opts)
        end)

      assert %{status: 200} = conn = Task.await(task)
      new_offset = get_resp_last_offset(conn)
      assert [op1, op2, @up_to_date] = Jason.decode!(conn.resp_body)

      assert [
               %{
                 "headers" => %{"operation" => "insert", "relation" => ["public", "serial_ids"]},
                 "key" => ~s|"public"."serial_ids"/"3"|,
                 "value" => %{"id" => "3", "num" => "8"}
               },
               %{
                 "headers" => %{"operation" => "insert", "relation" => ["public", "serial_ids"]},
                 "key" => ~s|"public"."serial_ids"/"4"|,
                 "value" => %{"id" => "4", "num" => "9"}
               }
             ] = [op1, op2]

      # Simulate a move-in and a move-out and verify their correct delivery as INSERT and
      # DELETE operations, respectively.
      task =
        Task.async(fn ->
          conn("GET", "/v1/shape/serial_ids", %{
            offset: new_offset,
            shape_handle: shape_handle,
            where: where,
            live: true
          })
          |> Router.call(opts)
        end)

      Postgrex.transaction(db_conn, fn conn ->
        Postgrex.query!(conn, "UPDATE serial_ids SET num = 6 WHERE id = 1", [])
        Postgrex.query!(conn, "UPDATE serial_ids SET num = 5 WHERE id = 3", [])
      end)

      assert %{status: 200} = conn = Task.await(task)
      assert [op1, op2, @up_to_date] = Jason.decode!(conn.resp_body)

      assert [
               %{
                 "headers" => %{"operation" => "insert", "relation" => ["public", "serial_ids"]},
                 "key" => ~s|"public"."serial_ids"/"1"|,
                 "value" => %{"id" => "1", "num" => "6"},
                 "offset" => op1_offset
               },
               %{
                 "headers" => %{"operation" => "delete", "relation" => ["public", "serial_ids"]},
                 "key" => ~s|"public"."serial_ids"/"3"|,
                 "value" => %{"id" => "3"},
                 "offset" => op2_offset
               }
             ] = [op1, op2]

      last_offset = get_resp_last_offset(conn)

      # Verify that both ops share the same tx offset and differ in their op offset by a known
      # amount.
      [op1_log_offset, op2_log_offset, last_log_offset] =
        Enum.map([op1_offset, op2_offset, last_offset], fn offset ->
          {:ok, log_offset} = LogOffset.from_string(offset)
          log_offset
        end)

      assert op2_log_offset == last_log_offset

      # An UPDATE op always increments the log offset by two to accommodate a possible split
      # into two operations when the PK changes. Hence the distance of 2 between op1 and op2.
      assert op2_log_offset == LogOffset.increment(op1_log_offset, 2)
    end

    @tag additional_fields: "num INTEGER NOT NULL"
    @tag with_sql: [
           "INSERT INTO serial_ids (id, num) VALUES (1, 1), (2, 2), (10, 10), (20, 20)"
         ]
    test "GET returns correct INSERT and DELETE operations that have been converted from UPDATEs of PK columns",
         %{opts: opts, db_conn: db_conn} do
      where = "id < 10"

      # Verify that a two rows are in-shape initially.
      conn =
        conn("GET", "/v1/shape/serial_ids", %{offset: "-1", where: where})
        |> Router.call(opts)

      assert %{status: 200} = conn
      shape_handle = get_resp_shape_id(conn)
      assert [op1, op2] = Jason.decode!(conn.resp_body)

      assert [op1, op2] == [
               %{
                 "headers" => %{"operation" => "insert", "relation" => ["public", "serial_ids"]},
                 "key" => ~s|"public"."serial_ids"/"1"|,
                 "offset" => "0_0",
                 "value" => %{"id" => "1", "num" => "1"}
               },
               %{
                 "headers" => %{"operation" => "insert", "relation" => ["public", "serial_ids"]},
                 "key" => ~s|"public"."serial_ids"/"2"|,
                 "offset" => "0_0",
                 "value" => %{"id" => "2", "num" => "2"}
               }
             ]

      # Simulate a move-in and a move-out by changing the PK of some rows.
      task =
        Task.async(fn ->
          conn("GET", "/v1/shape/serial_ids", %{
            offset: "0_0",
            shape_handle: shape_handle,
            where: where,
            live: true
          })
          |> Router.call(opts)
        end)

      Postgrex.transaction(db_conn, fn conn ->
        Postgrex.query!(conn, "UPDATE serial_ids SET id = 3 WHERE id = 20", [])
        Postgrex.query!(conn, "UPDATE serial_ids SET id = 11 WHERE id = 2", [])
      end)

      assert %{status: 200} = conn = Task.await(task)
      assert [op1, op2, @up_to_date] = Jason.decode!(conn.resp_body)

      assert [
               %{
                 "headers" => %{"operation" => "insert", "relation" => ["public", "serial_ids"]},
                 "key" => ~s|"public"."serial_ids"/"3"|,
                 "value" => %{"id" => "3", "num" => "20"},
                 "offset" => op1_offset
               },
               %{
                 "headers" => %{"operation" => "delete", "relation" => ["public", "serial_ids"]},
                 "key" => ~s|"public"."serial_ids"/"2"|,
                 "value" => %{"id" => "2"},
                 "offset" => op2_offset
               }
             ] = [op1, op2]

      last_offset = get_resp_last_offset(conn)

      # Verify that both ops share the same tx offset and differ in their op offset by a known
      # amount.
      [op1_log_offset, op2_log_offset, last_log_offset] =
        Enum.map([op1_offset, op2_offset, last_offset], fn offset ->
          {:ok, log_offset} = LogOffset.from_string(offset)
          log_offset
        end)

      assert op2_log_offset == last_log_offset

      # An UPDATE op always increments the log offset by two to accommodate a possible split
      # into two operations when the PK changes. Hence the distance of 2 between op1 and op2.
      assert op2_log_offset == LogOffset.increment(op1_log_offset, 2)
    end

    @tag with_sql: [
           "CREATE TABLE large_rows_table (id BIGINT PRIMARY KEY, value TEXT NOT NULL)"
         ]
    test "GET receives chunked results based on size", %{
      opts: opts,
      db_conn: db_conn
    } do
      threshold = Access.fetch!(opts, :chunk_bytes_threshold)

      first_val = String.duplicate("a", round(threshold * 0.6))
      second_val = String.duplicate("b", round(threshold * 0.7))
      third_val = String.duplicate("c", round(threshold * 0.4))

      conn = conn("GET", "/v1/shape/large_rows_table?offset=-1") |> Router.call(opts)
      assert %{status: 200} = conn
      [shape_handle] = Plug.Conn.get_resp_header(conn, "electric-shape-id")
      [next_offset] = Plug.Conn.get_resp_header(conn, "electric-chunk-last-offset")

      assert [] = Jason.decode!(conn.resp_body)

      # Use a live request to ensure data has been ingested
      task =
        Task.async(fn ->
          conn(
            "GET",
            "/v1/shape/large_rows_table?offset=#{next_offset}&shape_handle=#{shape_handle}&live"
          )
          |> Router.call(opts)
        end)

      Postgrex.query!(db_conn, "INSERT INTO large_rows_table VALUES (1, $1), (2, $2), (3, $3)", [
        first_val,
        second_val,
        third_val
      ])

      assert %{status: 200} = Task.await(task)

      conn =
        conn(
          "GET",
          "/v1/shape/large_rows_table?offset=#{next_offset}&shape_handle=#{shape_handle}"
        )
        |> Router.call(opts)

      assert %{status: 200} = conn

      assert [
               %{
                 "headers" => %{"operation" => "insert"},
                 "value" => %{"id" => "1", "value" => ^first_val},
                 "key" => _
               },
               %{
                 "headers" => %{"operation" => "insert"},
                 "value" => %{"id" => "2", "value" => ^second_val},
                 "key" => _
               }
             ] = Jason.decode!(conn.resp_body)

      [next_offset] = Plug.Conn.get_resp_header(conn, "electric-chunk-last-offset")

      conn =
        conn(
          "GET",
          "/v1/shape/large_rows_table?offset=#{next_offset}&shape_handle=#{shape_handle}"
        )
        |> Router.call(opts)

      assert %{status: 200} = conn

      assert [
               %{
                 "headers" => %{"operation" => "insert"},
                 "value" => %{"id" => "3", "value" => ^third_val},
                 "key" => _
               },
               %{
                 "headers" => %{"control" => "up-to-date"}
               }
             ] = Jason.decode!(conn.resp_body)
    end

    test "GET receives 400 when shape ID does not match shape definition", %{
      opts: opts
    } do
      where = "value ILIKE 'yes%'"

      # Initial shape request
      # forces the shape to be created
      conn =
        conn("GET", "/v1/shape/items", %{offset: "-1", where: where})
        |> Router.call(opts)

      assert %{status: 200} = conn
      assert conn.resp_body != ""

      shape_handle = get_resp_shape_handle(conn)
      [next_offset] = Plug.Conn.get_resp_header(conn, "electric-chunk-last-offset")

      # Make the next request but forget to include the where clause
      conn =
        conn("GET", "/v1/shape/items", %{offset: next_offset, shape_handle: shape_handle})
        |> Router.call(opts)

      assert %{status: 400} = conn

      assert conn.resp_body ==
               Jason.encode!(%{
                 message:
                   "The specified shape definition and ID do not match. Please ensure the shape definition is correct or omit the shape ID from the request to obtain a new one."
               })
    end

    test "GET receives 409 to a newly created shape when shape ID is not found and no shape matches the shape definition",
         %{
           opts: opts
         } do
      # Make the next request but forget to include the where clause
      conn =
        conn("GET", "/v1/shape/items", %{offset: "0_0", shape_handle: "nonexistent"})
        |> Router.call(opts)

      assert %{status: 409} = conn
      assert conn.resp_body == Jason.encode!([%{headers: %{control: "must-refetch"}}])
      new_shape_handle = get_resp_header(conn, "electric-shape-id")

      assert get_resp_header(conn, "location") ==
               "/v1/shape/items?shape_handle=#{new_shape_handle}&offset=-1"
    end

    test "GET receives 409 when shape ID is not found but there is another shape matching the definition",
         %{
           opts: opts
         } do
      where = "value ILIKE 'yes%'"

      # Initial shape request
      # forces the shape to be created
      conn =
        conn("GET", "/v1/shape/items", %{offset: "-1", where: where})
        |> Router.call(opts)

      assert %{status: 200} = conn
      assert conn.resp_body != ""

      shape_handle = get_resp_shape_handle(conn)

      # Request the same shape definition but with invalid shape_handle
      conn =
        conn("GET", "/v1/shape/items", %{offset: "0_0", shape_handle: "nonexistent", where: where})
        |> Router.call(opts)

      assert %{status: 409} = conn
      [^shape_handle] = Plug.Conn.get_resp_header(conn, "electric-shape-id")
    end

    @tag with_sql: [
           "INSERT INTO items VALUES (gen_random_uuid(), 'test value 1')"
         ]
    test "HEAD receives all headers", %{opts: opts} do
      conn_res =
        conn("GET", "/v1/shape/items?offset=-1")
        |> Router.call(opts)

      assert %{status: 200} = conn_res
      assert conn_res.resp_body != ""

      get_response_headers =
        conn_res.resp_headers
        |> Enum.filter(&(Kernel.elem(&1, 0) != "x-request-id"))

      conn =
        conn("HEAD", "/v1/shape/items?offset=-1")
        |> Router.call(opts)

      assert %{status: 200} = conn

      head_response_headers =
        conn.resp_headers
        |> Enum.filter(&(Kernel.elem(&1, 0) != "x-request-id"))

      assert get_response_headers == head_response_headers
      assert conn.resp_body == ""
    end

    test "OPTIONS receives supported methods", %{opts: opts} do
      conn =
        conn("OPTIONS", "/v1/shape/items")
        |> Router.call(opts)

      assert %{status: 204} = conn

      allowed_methods =
        conn
        |> Plug.Conn.get_resp_header("access-control-allow-methods")
        |> List.first("")
        |> String.split(",")
        |> Enum.map(&String.trim/1)
        |> MapSet.new()

      assert allowed_methods == MapSet.new(["GET", "HEAD", "OPTIONS", "DELETE"])
    end
  end

  describe "404" do
    test "GET on invalid path returns 404", _ do
      conn =
        conn("GET", "/invalidpath")
        |> Router.call([])

      assert %{status: 404} = conn

      allowed_methods =
        conn
        |> Plug.Conn.get_resp_header("access-control-allow-methods")
        |> List.first("")
        |> String.split(",")
        |> Enum.map(&String.trim/1)
        |> MapSet.new()

      assert allowed_methods == MapSet.new(["GET", "HEAD"])
    end
  end

  defp get_resp_shape_handle(conn), do: get_resp_header(conn, "electric-shape-id")
  defp get_resp_last_offset(conn), do: get_resp_header(conn, "electric-chunk-last-offset")

  defp get_resp_header(conn, header) do
    assert [val] = Plug.Conn.get_resp_header(conn, header)
    val
  end
end
