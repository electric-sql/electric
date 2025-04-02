defmodule Electric.Plug.RouterTest do
  @moduledoc """
  Integration router tests that set up entire stack with unique DB.

  Unit tests should be preferred wherever possible because they will run faster.
  """
  use ExUnit.Case, async: false

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

    setup :with_complete_stack

    setup(ctx, do: %{opts: Router.init(build_router_opts(ctx))})

    @tag with_sql: [
           "INSERT INTO items VALUES (gen_random_uuid(), 'test value 1')"
         ]
    test "GET returns a snapshot of initial data", %{opts: opts} do
      conn =
        conn("GET", "/v1/shape?table=items&offset=-1")
        |> Router.call(opts)

      assert %{status: 200} = conn

      assert [
               %{
                 "headers" => %{"operation" => "insert"},
                 "key" => _,
                 "value" => %{
                   "id" => _,
                   "value" => "test value 1"
                 }
               }
             ] = Jason.decode!(conn.resp_body)
    end

    test "GET returns an error when table is not found", %{opts: opts} do
      conn =
        conn("GET", "/v1/shape?table=nonexistent&offset=-1")
        |> Router.call(opts)

      assert %{status: 400} = conn

      assert %{
               "errors" => %{
                 "table" => [
                   ~s|Table "public"."nonexistent" does not exist. If the table name contains capitals or special characters you must quote it.|
                 ]
               }
             } = Jason.decode!(conn.resp_body)
    end

    @tag additional_fields: "num INTEGER NOT NULL"
    @tag with_sql: [
           "INSERT INTO items VALUES (gen_random_uuid(), 'test value 1', 1)"
         ]
    test "GET returns values in the snapshot and the rest of the log in the same format (as strings)",
         %{opts: opts, db_conn: db_conn} do
      conn = conn("GET", "/v1/shape?table=items&offset=-1") |> Router.call(opts)
      assert [%{"value" => %{"num" => "1"}}] = Jason.decode!(conn.resp_body)

      Postgrex.query!(
        db_conn,
        "INSERT INTO items VALUES (gen_random_uuid(), 'test value 2', 2)",
        []
      )

      shape_handle = get_resp_shape_handle(conn)

      conn =
        conn("GET", "/v1/shape?table=items&handle=#{shape_handle}&offset=0_0&live")
        |> Router.call(opts)

      assert [%{"value" => %{"num" => "2"}}, _] = Jason.decode!(conn.resp_body)
    end

    @tag with_sql: [
           "INSERT INTO items VALUES ('00000000-0000-0000-0000-000000000001', 'test value 1')"
         ]
    test "GET after a compaction proceeds correctly",
         %{opts: opts, db_conn: db_conn} do
      conn = conn("GET", "/v1/shape?table=items&offset=-1") |> Router.call(opts)
      assert [_] = Jason.decode!(conn.resp_body)

      for x <- 1..10 do
        Postgrex.query!(
          db_conn,
          "UPDATE items SET value = 'test value #{x}' WHERE id = '00000000-0000-0000-0000-000000000001'",
          []
        )
      end

      shape_handle = get_resp_shape_handle(conn)

      Process.sleep(500)

      conn =
        conn("GET", "/v1/shape?table=items&handle=#{shape_handle}&offset=0_0&live")
        |> Router.call(opts)

      assert length(Jason.decode!(conn.resp_body)) == 10
      {:ok, offset} = LogOffset.from_string(get_resp_header(conn, "electric-offset"))

      # Force compaction
      Electric.ShapeCache.Storage.for_shape(shape_handle, opts[:api].storage)
      |> Electric.ShapeCache.Storage.compact(offset)

      conn =
        conn("GET", "/v1/shape?table=items&handle=#{shape_handle}&offset=0_0")
        |> Router.call(opts)

      assert [%{"value" => %{"value" => "test value 10"}}, _] = Jason.decode!(conn.resp_body)
      assert LogOffset.from_string(get_resp_header(conn, "electric-offset")) == {:ok, offset}
    end

    @tag with_sql: [
           "INSERT INTO items VALUES (gen_random_uuid(), 'terrible')"
         ]
    test "GET with parameters avoids SQL-injection-like behaviour", %{opts: opts} do
      # Given this sql injection "request"
      value = ~S|'nonexistent' OR TRUE|

      # Requesting without escaping leads to all rows shown despie
      conn =
        conn("GET", "/v1/shape?table=items&offset=-1", %{where: "value = #{value}"})
        |> Router.call(opts)

      assert %{status: 200} = conn
      # Unfortunately, returns rows
      refute Jason.decode!(conn.resp_body) == []

      # Requesting with param makes it work
      conn =
        conn("GET", "/v1/shape?table=items&offset=-1", %{
          where: "value = $1",
          params: %{1 => value}
        })
        |> Router.call(opts)

      assert %{status: 200} = conn
      assert Jason.decode!(conn.resp_body) == []
    end

    @tag with_sql: [
           "INSERT INTO items VALUES (gen_random_uuid(), 'test value 1')"
         ]
    test "DELETE forces the shape handle to be different on reconnect and new snapshot to be created",
         %{opts: opts, db_conn: db_conn} do
      conn =
        conn("GET", "/v1/shape?table=items&offset=-1")
        |> Router.call(opts)

      assert %{status: 200} = conn
      shape1_handle = get_resp_shape_handle(conn)

      assert [%{"value" => %{"value" => "test value 1"}}] =
               Jason.decode!(conn.resp_body)

      assert %{status: 202} =
               conn("DELETE", "/v1/shape?table=items&handle=#{shape1_handle}")
               |> Router.call(opts)

      Postgrex.query!(db_conn, "DELETE FROM items", [])
      Postgrex.query!(db_conn, "INSERT INTO items VALUES (gen_random_uuid(), 'test value 2')", [])

      conn =
        conn("GET", "/v1/shape?table=items&offset=-1")
        |> Router.call(opts)

      assert %{status: 200} = conn
      shape2_handle = get_resp_shape_handle(conn)
      assert shape1_handle != shape2_handle

      assert [%{"value" => %{"value" => "test value 2"}}] =
               Jason.decode!(conn.resp_body)
    end

    @tag with_sql: ["INSERT INTO items VALUES (gen_random_uuid(), 'test value 1')"]
    test "follows a table and returns last-seen lsn", %{
      opts: opts,
      db_conn: db_conn
    } do
      # Request a snapshot
      conn =
        conn("GET", "/v1/shape?table=items&offset=-1")
        |> Router.call(opts)

      assert %{status: 200} = conn
      shape_handle = get_resp_shape_handle(conn)

      task =
        Task.async(fn ->
          conn("GET", "/v1/shape?table=items&offset=#{@first_offset}&handle=#{shape_handle}&live")
          |> Router.call(opts)
        end)

      # insert a new thing
      Postgrex.query!(
        db_conn,
        "INSERT INTO items VALUES (gen_random_uuid(), 'test value 2')",
        []
      )

      conn = Task.await(task)

      assert %{status: 200} = conn

      assert [
               %{
                 "headers" => %{"operation" => "insert", "lsn" => lsn},
                 "value" => %{
                   "value" => "test value 2"
                 }
               },
               %{"headers" => %{"control" => "up-to-date", "global_last_seen_lsn" => lsn}}
             ] = Jason.decode!(conn.resp_body)
    end

    @tag with_sql: ["INSERT INTO items VALUES (gen_random_uuid(), 'test value 1')"]
    test "non-live responses return last-seen lsn", %{
      opts: opts,
      db_conn: db_conn
    } do
      # Request a snapshot
      conn = conn("GET", "/v1/shape?table=items&offset=-1") |> Router.call(opts)
      conn2 = conn("GET", "/v1/shape?table=serial_ids&offset=-1") |> Router.call(opts)

      assert %{status: 200} = conn
      shape_handle = get_resp_shape_handle(conn)
      shape_handle2 = get_resp_shape_handle(conn2)
      # Wait to see the insert
      task =
        Task.async(fn ->
          conn("GET", "/v1/shape?table=items&offset=#{@first_offset}&handle=#{shape_handle}&live")
          |> Router.call(opts)
        end)

      Postgrex.query!(db_conn, "INSERT INTO items VALUES (gen_random_uuid(), 'test value 2')", [])
      assert %{status: 200} = Task.await(task)

      conn =
        conn("GET", "/v1/shape?table=items&offset=#{@first_offset}&handle=#{shape_handle}")
        |> Router.call(opts)

      assert [
               %{"headers" => %{"operation" => "insert", "lsn" => lsn}},
               %{"headers" => %{"control" => "up-to-date", "global_last_seen_lsn" => lsn}}
             ] = Jason.decode!(conn.resp_body)

      # Make another insert unrelated to observed shape and wait for that to be propagated
      task =
        Task.async(fn ->
          conn(
            "GET",
            "/v1/shape?table=serial_ids&offset=#{@first_offset}&handle=#{shape_handle2}&live"
          )
          |> Router.call(opts)
        end)

      Postgrex.query!(db_conn, "INSERT INTO serial_ids (id) VALUES (2)", [])
      assert %{status: 200} = conn = Task.await(task)

      assert [%{"headers" => %{"operation" => "insert", "lsn" => lsn}}, _] =
               Jason.decode!(conn.resp_body)

      # Now the "tail" on the original shape should have a different lsn
      conn =
        conn("GET", "/v1/shape?table=items&offset=#{@first_offset}&handle=#{shape_handle}")
        |> Router.call(opts)

      assert [
               %{"headers" => %{"operation" => "insert", "lsn" => lsn1}},
               %{"headers" => %{"control" => "up-to-date", "global_last_seen_lsn" => lsn2}}
             ] = Jason.decode!(conn.resp_body)

      assert lsn2 > lsn1
      assert lsn2 == lsn
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
        conn("GET", "/v1/shape?table=foo&offset=-1")
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
          conn("GET", "/v1/shape?table=foo&offset=#{@first_offset}&handle=#{shape_handle}&live")
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

    @all_types_table_name "all_types_table"
    @tag with_sql: [
           "CREATE TYPE mood AS ENUM ('sad', 'ok', 'happy')",
           "CREATE TYPE complex AS (r double precision, i double precision)",
           "CREATE DOMAIN posint AS integer CHECK (VALUE > 0)",
           "CREATE TABLE #{@all_types_table_name} (
              txt VARCHAR,
              i2 INT2 PRIMARY KEY,
              i4 INT4,
              i8 INT8,
              f8 FLOAT8,
              b  BOOLEAN,
              json JSON,
              jsonb JSONB,
              blob BYTEA,
              ints INT8[],
              ints2 INT8[][],
              int4s INT4[],
              doubles FLOAT8[],
              bools BOOLEAN[],
              moods mood[],
              moods2 mood[][],
              complexes complex[],
              posints posint[],
              jsons JSONB[],
              txts TEXT[]
            )"
         ]
    test "can sync all data types", %{opts: opts, db_conn: db_conn} do
      Postgrex.query!(db_conn, "
        INSERT INTO #{@all_types_table_name} (txt, i2, i4, i8, f8, b, json, jsonb, blob, ints, ints2, int4s, doubles, bools, moods, moods2, complexes, posints, jsons, txts)
        VALUES ( $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20 )
        ", [
        "test",
        1,
        2_147_483_647,
        9_223_372_036_854_775_807,
        4.5,
        true,
        %{foo: "bar"},
        %{foo: "bar"},
        <<0, 1, 255, 254>>,
        [1, 2, 3],
        [
          [1, 2, 3],
          [4, 5, 6]
        ],
        [1, 2, 3],
        [1.2, -3.2, :inf, :"-inf", :NaN],
        [true, false, true],
        ["sad", "ok", "happy"],
        [
          ["sad", "ok"],
          ["ok", "happy"]
        ],
        [{1.1, 2.2}, {3.3, 4.4}],
        [5, 9, 2],
        [%{foo: "bar"}, %{bar: "baz"}],
        ["foo", "bar", "baz"]
      ])

      conn =
        conn("GET", "/v1/shape?table=#{@all_types_table_name}&offset=-1") |> Router.call(opts)

      assert %{status: 200} = conn
      shape_handle = get_resp_shape_handle(conn)
      latest_offset = get_resp_last_offset(conn)

      assert [
               %{
                 "value" => %{
                   "txt" => "test",
                   "i2" => "1",
                   "i4" => "2147483647",
                   "i8" => "9223372036854775807",
                   "f8" => "4.5",
                   "b" => "true",
                   "json" => "{\"foo\":\"bar\"}",
                   "jsonb" => "{\"foo\": \"bar\"}",
                   "blob" => "\\x0001fffe",
                   "ints" => "{1,2,3}",
                   "ints2" => "{{1,2,3},{4,5,6}}",
                   "int4s" => "{1,2,3}",
                   "doubles" => "{1.2,-3.2,Infinity,-Infinity,NaN}",
                   "bools" => "{t,f,t}",
                   "moods" => "{sad,ok,happy}",
                   "moods2" => "{{sad,ok},{ok,happy}}",
                   "posints" => "{5,9,2}",
                   "complexes" => "{\"(1.1,2.2)\",\"(3.3,4.4)\"}",
                   "jsons" => "{\"{\\\"foo\\\": \\\"bar\\\"}\",\"{\\\"bar\\\": \\\"baz\\\"}\"}",
                   "txts" => "{foo,bar,baz}"
                 },
                 "key" => key
               }
             ] = Jason.decode!(conn.resp_body)

      task =
        Task.async(fn ->
          conn(
            "GET",
            "/v1/shape?table=#{@all_types_table_name}&offset=#{latest_offset}&handle=#{shape_handle}&live"
          )
          |> Router.call(opts)
        end)

      Postgrex.query!(db_conn, "UPDATE #{@all_types_table_name} SET
        txt = $1, i4 = $2, i8 = $3, f8 = $4, b = $5, json = $6,
        jsonb = $7, blob = $8, ints = $9, ints2 = $10, int4s = $11,
        doubles = $12, bools = $13, moods = $14, moods2 = $15,
        complexes = $16, posints = $17, jsons = $18, txts = $19
        WHERE i2 = 1
      ", [
        "changed",
        20,
        30,
        40.5,
        false,
        %{bar: "foo"},
        %{bar: "foo"},
        <<255, 254, 0, 1>>,
        [4, 5, 6],
        [
          [4, 5, 6],
          [7, 8, 9]
        ],
        [4, 5, 6],
        [-100.2, :"-inf", :NaN, 3.2],
        [false, true, false],
        ["sad", "happy"],
        [
          ["sad", "happy"],
          ["happy", "ok"]
        ],
        [{2.2, 3.3}, {4.4, 5.5}],
        [6, 10, 3],
        [%{bar: "baz"}],
        ["new", "values"]
      ])

      assert %{status: 200} = conn = Task.await(task)

      assert [
               %{
                 "key" => ^key,
                 "value" => %{
                   "txt" => "changed",
                   "i2" => "1",
                   "i4" => "20",
                   "i8" => "30",
                   "f8" => "40.5",
                   "b" => "f",
                   "json" => "{\"bar\":\"foo\"}",
                   "jsonb" => "{\"bar\": \"foo\"}",
                   "blob" => "\\xfffe0001",
                   "ints" => "{4,5,6}",
                   "ints2" => "{{4,5,6},{7,8,9}}",
                   "int4s" => "{4,5,6}",
                   "doubles" => "{-100.2,-Infinity,NaN,3.2}",
                   "bools" => "{f,t,f}",
                   "moods" => "{sad,happy}",
                   "moods2" => "{{sad,happy},{happy,ok}}",
                   "posints" => "{6,10,3}",
                   "complexes" => "{\"(2.2,3.3)\",\"(4.4,5.5)\"}",
                   "jsons" => "{\"{\\\"bar\\\": \\\"baz\\\"}\"}",
                   "txts" => "{new,values}"
                 }
               },
               @up_to_date
             ] = Jason.decode!(conn.resp_body)
    end

    @large_binary_table "large_binary_table"
    @tag with_sql: ["CREATE TABLE #{@large_binary_table} (id INT PRIMARY KEY, blob BYTEA)"]
    test "can sync large binaries", %{opts: opts, db_conn: db_conn} do
      # 10 MB
      blob_size = 10_000_000

      # ensure initial sync works
      blob = :rand.bytes(blob_size)
      hex_blob = "\\x" <> Base.encode16(blob, case: :lower)

      Postgrex.query!(db_conn, "INSERT INTO #{@large_binary_table} (id, blob) VALUES (1, $1)", [
        blob
      ])

      conn =
        conn("GET", "/v1/shape?table=#{@large_binary_table}&offset=-1") |> Router.call(opts)

      assert %{status: 200} = conn
      shape_handle = get_resp_shape_handle(conn)
      latest_offset = get_resp_last_offset(conn)
      assert [%{"value" => %{"id" => "1", "blob" => ^hex_blob}}] = Jason.decode!(conn.resp_body)

      task =
        Task.async(fn ->
          conn(
            "GET",
            "/v1/shape?table=#{@large_binary_table}&offset=#{latest_offset}&handle=#{shape_handle}&live"
          )
          |> Router.call(opts)
        end)

      # ensure that updates also work
      blob = :rand.bytes(blob_size)
      hex_blob = "\\x" <> Base.encode16(blob, case: :lower)

      Postgrex.query!(db_conn, "UPDATE #{@large_binary_table} SET blob = $1 WHERE id = 1", [
        blob
      ])

      assert %{status: 200} = conn = Task.await(task)

      assert [
               %{"value" => %{"id" => "1", "blob" => ^hex_blob}},
               @up_to_date
             ] = Jason.decode!(conn.resp_body)
    end

    @generated_pk_table "generated_pk_table"
    @tag with_sql: [
           "CREATE TABLE #{@generated_pk_table} (val JSONB NOT NULL, id uuid PRIMARY KEY GENERATED ALWAYS AS ((val->>'id')::uuid) STORED)"
         ]
    test "returns an error when trying to select a generated column", %{opts: opts} do
      # When selecting all columns
      conn = conn("GET", "/v1/shape?table=#{@generated_pk_table}&offset=-1") |> Router.call(opts)
      assert %{status: 400} = conn

      assert Jason.decode!(conn.resp_body) ==
               %{
                 "errors" => %{
                   "columns" => [
                     "The following columns are generated and cannot be included in replication: id"
                   ]
                 },
                 "message" => "Invalid request"
               }

      # When selecting a single column but PK is generated
      conn =
        conn("GET", "/v1/shape?table=#{@generated_pk_table}&offset=-1&columns=val")
        |> Router.call(opts)

      assert %{status: 400} = conn

      assert Jason.decode!(conn.resp_body) ==
               %{
                 "errors" => %{"columns" => ["Must include all primary key columns, missing: id"]},
                 "message" => "Invalid request"
               }

      # When selecting a generated column explicitly
      conn =
        conn("GET", "/v1/shape?table=#{@generated_pk_table}&offset=-1&columns=id,val")
        |> Router.call(opts)

      assert %{status: 400} = conn

      assert Jason.decode!(conn.resp_body) ==
               %{
                 "errors" => %{
                   "columns" => [
                     "The following columns are generated and cannot be included in replication: id"
                   ]
                 },
                 "message" => "Invalid request"
               }
    end

    @tag with_sql: [
           "CREATE TABLE wide_table (id BIGINT PRIMARY KEY, value1 TEXT NOT NULL, value2 TEXT NOT NULL, value3 TEXT NOT NULL)",
           "INSERT INTO wide_table VALUES (1, 'test value 1', 'test value 1', 'test value 1')"
         ]
    test "GET received only a diff when receiving updates", %{opts: opts, db_conn: db_conn} do
      conn = conn("GET", "/v1/shape?table=wide_table&offset=-1") |> Router.call(opts)
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
          conn("GET", "/v1/shape?table=wide_table&offset=0_0&handle=#{shape_handle}&live")
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
      conn = conn("GET", "/v1/shape?table=wide_table&offset=-1") |> Router.call(opts)
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
          conn("GET", "/v1/shape?table=wide_table&offset=0_0&handle=#{shape_handle}&live")
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
      conn = conn("GET", "/v1/shape?table=test_table&offset=-1") |> Router.call(opts)
      assert %{status: 200} = conn
      shape_handle = get_resp_shape_handle(conn)

      assert [%{"value" => %{"col1" => "test1", "col2" => "test2"}, "key" => key}] =
               Jason.decode!(conn.resp_body)

      task =
        Task.async(fn ->
          conn("GET", "/v1/shape?table=test_table&offset=0_0&handle=#{shape_handle}&live")
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
      conn =
        conn("GET", "/v1/shape?table=wide_table&offset=-1&columns=id,value1") |> Router.call(opts)

      assert %{status: 200} = conn
      shape_handle = get_resp_shape_handle(conn)
      next_offset = get_resp_last_offset(conn)

      assert [
               %{
                 "value" => %{"id" => "1", "value1" => "test value 1"},
                 "key" => key
               }
             ] = Jason.decode!(conn.resp_body)

      test_pid = self()

      task =
        Task.async(fn ->
          conn(
            "GET",
            "/v1/shape?table=wide_table&offset=#{next_offset}&columns=id,value1&handle=#{shape_handle}&live"
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
        conn("GET", "/v1/shape?table=items", %{offset: "-1", where: where})
        |> Router.call(opts)

      assert %{status: 200} = conn
      shape_handle = get_resp_shape_handle(conn)

      assert [] = Jason.decode!(conn.resp_body)

      task =
        Task.async(fn ->
          conn("GET", "/v1/shape?table=items", %{
            offset: "0_0",
            handle: shape_handle,
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
               conn("GET", "/v1/shape?table=items", %{
                 offset: new_offset,
                 handle: shape_handle,
                 where: where
               })
               |> Router.call(opts)

      assert [_] = Jason.decode!(conn.resp_body)
    end

    @tag with_sql: [
           "CREATE TABLE wide_table (id BIGINT PRIMARY KEY, value1 TEXT NOT NULL, value2 TEXT NOT NULL, value3 TEXT NOT NULL)",
           "INSERT INTO wide_table VALUES (1, 'test value 1', 'test value 1', 'test value 1')"
         ]
    test "GET receives old rows in updates when replica=full", %{opts: opts, db_conn: db_conn} do
      conn =
        conn("GET", "/v1/shape?table=wide_table&offset=-1&replica=full") |> Router.call(opts)

      assert %{status: 200} = conn
      shape_handle = get_resp_shape_handle(conn)
      json_body = Jason.decode!(conn.resp_body)

      assert [
               %{
                 "value" => %{"id" => _, "value1" => _, "value2" => _, "value3" => _},
                 "key" => key
               }
             ] = json_body

      # Old value cannot be present on the snapshot
      refute match?(%{"old_value" => _}, json_body)

      task =
        Task.async(fn ->
          conn(
            "GET",
            "/v1/shape?table=wide_table&offset=0_0&handle=#{shape_handle}&live&replica=full"
          )
          |> Router.call(opts)
        end)

      Postgrex.query!(db_conn, "UPDATE wide_table SET value2 = 'test value 2' WHERE id = 1", [])

      assert %{status: 200} = conn = Task.await(task)

      # No extra keys should be present, so this is a pin
      value = %{
        "id" => "1",
        "value2" => "test value 2",
        "value1" => "test value 1",
        "value3" => "test value 1"
      }

      old_value = %{
        "value2" => "test value 1"
      }

      assert [%{"key" => ^key, "value" => ^value, "old_value" => ^old_value}, @up_to_date] =
               Jason.decode!(conn.resp_body)
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
        conn("GET", "/v1/shape?table=serial_ids", %{offset: "-1", where: where})
        |> Router.call(opts)

      assert %{status: 200} = conn

      shape_handle = get_resp_shape_handle(conn)
      assert [op] = Jason.decode!(conn.resp_body)

      assert op == %{
               "headers" => %{"operation" => "insert", "relation" => ["public", "serial_ids"]},
               "key" => ~s|"public"."serial_ids"/"2"|,
               "value" => %{"id" => "2", "num" => "10"}
             }

      # Insert more rows and verify their delivery to a live shape subscriber.
      Postgrex.query!(db_conn, "INSERT INTO serial_ids(id, num) VALUES (3, 8), (4, 9)", [])

      task =
        Task.async(fn ->
          conn("GET", "/v1/shape?table=serial_ids", %{
            offset: "0_0",
            handle: shape_handle,
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
          conn("GET", "/v1/shape?table=serial_ids", %{
            offset: new_offset,
            handle: shape_handle,
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
                 "headers" => %{
                   "operation" => "insert",
                   "relation" => ["public", "serial_ids"],
                   "lsn" => op1_lsn,
                   "op_position" => op1_op_position
                 },
                 "key" => ~s|"public"."serial_ids"/"1"|,
                 "value" => %{"id" => "1", "num" => "6"}
               },
               %{
                 "headers" => %{
                   "operation" => "delete",
                   "relation" => ["public", "serial_ids"],
                   "lsn" => op2_lsn,
                   "op_position" => op2_op_position,
                   "last" => true
                 },
                 "key" => ~s|"public"."serial_ids"/"3"|,
                 "value" => %{"id" => "3"}
               }
             ] = [op1, op2]

      {:ok, last_log_offset} = LogOffset.from_string(get_resp_last_offset(conn))

      # Verify that both ops share the same tx offset and differ in their op offset by a known
      # amount.
      op1_log_offset = LogOffset.new(String.to_integer(op1_lsn), op1_op_position)
      op2_log_offset = LogOffset.new(String.to_integer(op2_lsn), op2_op_position)

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
        conn("GET", "/v1/shape?table=serial_ids", %{offset: "-1", where: where})
        |> Router.call(opts)

      assert %{status: 200} = conn
      shape_handle = get_resp_shape_handle(conn)
      assert [op1, op2] = Jason.decode!(conn.resp_body)

      assert [op1, op2] == [
               %{
                 "headers" => %{"operation" => "insert", "relation" => ["public", "serial_ids"]},
                 "key" => ~s|"public"."serial_ids"/"1"|,
                 "value" => %{"id" => "1", "num" => "1"}
               },
               %{
                 "headers" => %{"operation" => "insert", "relation" => ["public", "serial_ids"]},
                 "key" => ~s|"public"."serial_ids"/"2"|,
                 "value" => %{"id" => "2", "num" => "2"}
               }
             ]

      # Simulate a move-in and a move-out by changing the PK of some rows.
      task =
        Task.async(fn ->
          conn("GET", "/v1/shape?table=serial_ids", %{
            offset: "0_0",
            handle: shape_handle,
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
                 "headers" => %{
                   "operation" => "insert",
                   "relation" => ["public", "serial_ids"],
                   "lsn" => op1_lsn,
                   "op_position" => op1_op_position
                 },
                 "key" => ~s|"public"."serial_ids"/"3"|,
                 "value" => %{"id" => "3", "num" => "20"}
               },
               %{
                 "headers" => %{
                   "operation" => "delete",
                   "relation" => ["public", "serial_ids"],
                   "lsn" => op2_lsn,
                   "op_position" => op2_op_position
                 },
                 "key" => ~s|"public"."serial_ids"/"2"|,
                 "value" => %{"id" => "2"}
               }
             ] = [op1, op2]

      {:ok, last_log_offset} = LogOffset.from_string(get_resp_last_offset(conn))

      # Verify that both ops share the same tx offset and differ in their op offset by a known
      # amount.
      op1_log_offset = LogOffset.new(String.to_integer(op1_lsn), op1_op_position)
      op2_log_offset = LogOffset.new(String.to_integer(op2_lsn), op2_op_position)

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
      threshold = Electric.ShapeCache.LogChunker.default_chunk_size_threshold()

      first_val = String.duplicate("a", round(threshold * 0.6))
      second_val = String.duplicate("b", round(threshold * 0.7))
      third_val = String.duplicate("c", round(threshold * 0.4))

      conn = conn("GET", "/v1/shape?table=large_rows_table&offset=-1") |> Router.call(opts)
      assert %{status: 200} = conn
      [shape_handle] = Plug.Conn.get_resp_header(conn, "electric-handle")
      [next_offset] = Plug.Conn.get_resp_header(conn, "electric-offset")

      assert [] = Jason.decode!(conn.resp_body)

      # Use a live request to ensure data has been ingested
      task =
        Task.async(fn ->
          conn(
            "GET",
            "/v1/shape?table=large_rows_table&offset=#{next_offset}&handle=#{shape_handle}&live"
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
          "/v1/shape?table=large_rows_table&offset=#{next_offset}&handle=#{shape_handle}"
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

      [next_offset] = Plug.Conn.get_resp_header(conn, "electric-offset")

      conn =
        conn(
          "GET",
          "/v1/shape?table=large_rows_table&offset=#{next_offset}&handle=#{shape_handle}"
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

    test "GET receives 409 when shape handle does not match shape definition", %{
      opts: opts
    } do
      where = "value ILIKE 'yes%'"

      # Initial shape request
      # forces the shape to be created
      conn =
        conn("GET", "/v1/shape?table=items", %{offset: "-1", where: where})
        |> Router.call(opts)

      assert %{status: 200} = conn
      assert conn.resp_body != ""

      shape_handle = get_resp_shape_handle(conn)
      [next_offset] = Plug.Conn.get_resp_header(conn, "electric-offset")

      # Make the next request but forget to include the where clause
      conn =
        conn("GET", "/v1/shape?table=items", %{offset: next_offset, handle: shape_handle})
        |> Router.call(opts)

      assert %{status: 409} = conn

      assert Jason.decode!(conn.resp_body) == [
               %{"headers" => %{"control" => "must-refetch"}}
             ]

      new_shape_handle = get_resp_header(conn, "electric-handle")
      assert new_shape_handle != shape_handle

      assert get_resp_header(conn, "location") ==
               "/v1/shape?handle=#{new_shape_handle}&offset=-1&table=items"
    end

    test "GET receives 409 to a newly created shape when shape handle is not found and no shape matches the shape definition",
         %{
           opts: opts
         } do
      # Make the next request but forget to include the where clause
      conn =
        conn("GET", "/v1/shape?table=items&unrelated=foo", %{offset: "0_0", handle: "nonexistent"})
        |> Router.call(opts)

      assert %{status: 409} = conn
      assert conn.resp_body == Jason.encode!([%{headers: %{control: "must-refetch"}}])
      new_shape_handle = get_resp_header(conn, "electric-handle")

      assert get_resp_header(conn, "location") ==
               "/v1/shape?handle=#{new_shape_handle}&offset=-1&table=items&unrelated=foo"
    end

    test "GET receives 409 when shape handle is not found but there is another shape matching the definition",
         %{
           opts: opts
         } do
      where = "value ILIKE 'yes%'"

      # Initial shape request
      # forces the shape to be created
      conn =
        conn("GET", "/v1/shape?table=items", %{offset: "-1", where: where})
        |> Router.call(opts)

      assert %{status: 200} = conn
      assert conn.resp_body != ""

      shape_handle = get_resp_shape_handle(conn)

      # Request the same shape definition but with invalid shape_handle
      conn =
        conn("GET", "/v1/shape?table=items", %{
          offset: "0_0",
          handle: "nonexistent",
          where: where
        })
        |> Router.call(opts)

      assert %{status: 409} = conn
      [^shape_handle] = Plug.Conn.get_resp_header(conn, "electric-handle")
    end

    @tag with_sql: [
           "INSERT INTO items VALUES (gen_random_uuid(), 'test value 1')"
         ]
    test "GET returns a 409 on a truncate and can follow a new shape afterwards", %{
      opts: opts,
      db_conn: db_conn
    } do
      conn = Router.call(conn("GET", "/v1/shape?table=items&offset=-1"), opts)

      assert %{status: 200} = conn
      handle = get_resp_shape_handle(conn)
      offset = get_resp_last_offset(conn)
      assert [%{"value" => %{"value" => "test value 1"}}] = Jason.decode!(conn.resp_body)

      task =
        Task.async(fn ->
          Router.call(
            conn("GET", "/v1/shape?table=items&offset=#{offset}&handle=#{handle}&live"),
            opts
          )
        end)

      Postgrex.query!(db_conn, "INSERT INTO items VALUES (gen_random_uuid(), 'test value 2')", [])

      conn = Task.await(task)

      assert %{status: 200} = conn
      assert ^handle = get_resp_shape_handle(conn)
      offset = get_resp_last_offset(conn)
      assert [%{"value" => %{"value" => "test value 2"}}, _] = Jason.decode!(conn.resp_body)

      task =
        Task.async(fn ->
          Router.call(
            conn("GET", "/v1/shape?table=items&offset=#{offset}&handle=#{handle}&live"),
            opts
          )
        end)

      Postgrex.query!(db_conn, "TRUNCATE TABLE items", [])
      assert %{status: 200} = Task.await(task)

      conn =
        Router.call(conn("GET", "/v1/shape?table=items&offset=#{offset}&handle=#{handle}"), opts)

      assert %{status: 409} = conn
      assert [%{"headers" => %{"control" => "must-refetch"}}] = Jason.decode!(conn.resp_body)

      conn =
        Router.call(conn("GET", "/v1/shape?table=items&offset=-1"), opts)

      assert %{status: 200} = conn
      new_handle = get_resp_shape_handle(conn)
      refute new_handle == handle
      offset = get_resp_last_offset(conn)
      assert [] = Jason.decode!(conn.resp_body)

      task =
        Task.async(fn ->
          Router.call(
            conn("GET", "/v1/shape?table=items&offset=#{offset}&handle=#{new_handle}&live"),
            opts
          )
        end)

      Postgrex.query!(db_conn, "INSERT INTO items VALUES (gen_random_uuid(), 'test value 3')", [])

      conn = Task.await(task)

      assert %{status: 200} = conn
      assert ^new_handle = get_resp_shape_handle(conn)
      # offset = get_resp_last_offset(conn)
      assert [%{"value" => %{"value" => "test value 3"}}, @up_to_date] =
               Jason.decode!(conn.resp_body)
    end

    @tag with_sql: [
           "INSERT INTO items VALUES (gen_random_uuid(), 'test value 1')"
         ]
    test "HEAD receives all headers", %{opts: opts} do
      conn_res =
        conn("GET", "/v1/shape?table=items&offset=-1")
        |> Router.call(opts)

      assert %{status: 200} = conn_res
      assert conn_res.resp_body != ""

      get_response_headers =
        conn_res.resp_headers
        |> Enum.filter(&(Kernel.elem(&1, 0) != "x-request-id"))

      conn =
        conn("HEAD", "/v1/shape?table=items&offset=-1")
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
        conn("OPTIONS", "/v1/shape?table=items")
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

    @tag slow: true
    test "GET with a concurrent transaction doesn't crash irrecoverably", %{
      opts: opts,
      db_conn: db_conn
    } do
      # Start a transaction that has a lock on `items`.
      %{pid: child} =
        Task.async(fn ->
          Postgrex.transaction(db_conn, fn tx_conn ->
            Postgrex.query!(
              tx_conn,
              "INSERT INTO items VALUES (gen_random_uuid(), 'test value')",
              []
            )

            receive do
              :continue -> :ok
            end
          end)
        end)

      # This can't alter the publication, so crashes
      assert %{status: 500, resp_body: body} =
               conn("GET", "/v1/shape?table=items&offset=-1")
               |> Router.call(opts)

      assert %{"message" => "Unable to retrieve shape log" <> _} = Jason.decode!(body)

      # Now we can continue
      send(child, :continue)

      # This should work now
      assert %{status: 200, resp_body: body} =
               conn("GET", "/v1/shape?table=items&offset=-1")
               |> Router.call(opts)

      assert [_] = Jason.decode!(body)

      # And the identity should be correctly set too
      assert %{rows: [["f"]]} =
               Postgrex.query!(
                 db_conn,
                 """
                 SELECT relreplident
                 FROM pg_class
                 JOIN pg_namespace ON relnamespace = pg_namespace.oid
                 WHERE relname = $2 AND nspname = $1
                 """,
                 ["public", "items"]
               )
    end

    @tag with_sql: [
           "CREATE TABLE nullability_test (id INT PRIMARY KEY, value TEXT NOT NULL)"
         ]
    test "GET returns updated schema in header after column nullability changes", %{
      opts: opts,
      db_conn: db_conn
    } do
      # Initial request to create the shape and get the schema
      conn =
        conn("GET", "/v1/shape?table=nullability_test&offset=-1")
        |> Router.call(opts)

      assert %{status: 200} = conn
      shape_handle = get_resp_shape_handle(conn)
      offset = get_resp_last_offset(conn)
      initial_schema = get_resp_schema(conn)

      assert initial_schema["value"]["not_null"]

      # Make a write to trigger relation message processing
      # Use a live request first to ensure the change propagates and cache is cleaned
      task =
        Task.async(fn ->
          conn(
            "GET",
            "/v1/shape?table=nullability_test&offset=#{offset}&handle=#{shape_handle}&live"
          )
          |> Router.call(opts)
        end)

      Postgrex.query!(db_conn, "INSERT INTO nullability_test (id, value) VALUES (1, 'test')", [])
      assert %{status: 200} = Task.await(task)

      assert %{status: 200} =
               conn =
               conn(
                 "GET",
                 "/v1/shape?table=nullability_test&offset=#{offset}&handle=#{shape_handle}"
               )
               |> Router.call(opts)

      assert get_resp_schema(conn)["value"]["not_null"]

      # Alter table to make 'value' nullable
      Postgrex.query!(
        db_conn,
        "ALTER TABLE nullability_test ALTER COLUMN value DROP NOT NULL",
        []
      )

      # Make a write to trigger relation message processing
      # Use a live request first to ensure the change propagates and cache is cleaned
      task =
        Task.async(fn ->
          conn(
            "GET",
            "/v1/shape?table=nullability_test&offset=#{offset}&handle=#{shape_handle}&live"
          )
          |> Router.call(opts)
        end)

      Postgrex.query!(db_conn, "INSERT INTO nullability_test (id, value) VALUES (2, NULL)", [])
      assert %{status: 200} = Task.await(task)

      # Make a non-live request to get the updated schema header
      conn =
        conn("GET", "/v1/shape?table=nullability_test&offset=#{offset}&handle=#{shape_handle}")
        |> Router.call(opts)

      assert %{status: 200} = conn
      updated_schema = get_resp_schema(conn)
      refute updated_schema["value"]["not_null"]
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

  describe "secure mode" do
    setup [:with_unique_db, :with_basic_tables]

    setup :with_complete_stack
    setup :secure_mode

    setup(ctx, do: %{opts: Router.init(build_router_opts(ctx))})

    setup(ctx,
      do: %{
        api_opts:
          Electric.Shapes.Api.plug_opts(
            stack_id: ctx.stack_id,
            pg_id: "12345",
            stack_events_registry: Electric.stack_events_registry(),
            stack_ready_timeout: Access.get(ctx, :stack_ready_timeout, 100),
            shape_cache: {Mock.ShapeCache, []},
            storage: {Mock.Storage, []},
            inspector: {__MODULE__, []},
            registry: Registry.ServeShapePlugTest,
            long_poll_timeout: 20_000,
            max_age: 60,
            stale_age: 300,
            persistent_kv: ctx.persistent_kv,
            allow_shape_deletion: true
          )
      }
    )

    test "allows access to / without secret", %{secret: secret} do
      assert %{status: 200} = Router.call(conn("GET", "/"), secret: secret)
    end

    test "allows access to /nonexistent without secret", %{secret: secret} do
      assert %{status: 404} = Router.call(conn("GET", "/nonexistent"), secret: secret)
    end

    test "allows access to /v1/health without secret", %{secret: secret} do
      assert %{status: 200} =
               Router.call(conn("GET", "/v1/health"),
                 secret: secret,
                 get_service_status: fn -> :active end
               )
    end

    test "allows OPTIONS requests to /v1/shape without secret", %{secret: secret} do
      # No secret provided
      assert %{status: 204} = Router.call(conn("OPTIONS", "/v1/shape"), secret: secret)
    end

    test "requires secret for /v1/shape", %{secret: secret, api_opts: api_opts} do
      # No secret provided
      assert %{status: 401} = Router.call(conn("GET", "/v1/shape"), secret: secret)

      # Wrong secret
      assert %{status: 401} =
               Router.call(conn("GET", "/v1/shape?api_secret=wrong_secret"), secret: secret)

      # Correct secret
      assert %{status: 400} =
               Router.call(
                 conn("GET", "/v1/shape?api_secret=#{secret}"),
                 Keyword.merge([secret: secret], api_opts)
               )
    end

    test "requires secret for /v1/shape deletion", %{secret: secret, api_opts: api_opts} do
      # No secret provided
      assert %{status: 401} = Router.call(conn("DELETE", "/v1/shape"), secret: secret)

      # Wrong secret
      assert %{status: 401} =
               Router.call(conn("DELETE", "/v1/shape?api_secret=wrong_secret"), secret: secret)

      # Correct secret
      assert %{status: 400} =
               Router.call(
                 conn("DELETE", "/v1/shape?api_secret=#{secret}"),
                 Keyword.merge([secret: secret], api_opts)
               )

      # Note: Returns 400 because shape params are required, but authentication passed
    end
  end

  defp get_resp_shape_handle(conn), do: get_resp_header(conn, "electric-handle")
  defp get_resp_last_offset(conn), do: get_resp_header(conn, "electric-offset")

  defp get_resp_header(conn, header) do
    assert [val] = Plug.Conn.get_resp_header(conn, header)
    val
  end

  defp get_resp_schema(conn) do
    conn
    |> get_resp_header("electric-schema")
    |> Jason.decode!()
  end
end
