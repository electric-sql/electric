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

  @first_offset to_string(LogOffset.first())
  @up_to_date %{"headers" => %{"control" => "up-to-date"}}

  defmacrop up_to_date_ctl() do
    quote do
      %{"headers" => %{"control" => "up-to-date"}}
    end
  end

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

    setup(ctx) do
      :ok = Electric.StatusMonitor.wait_until_active(ctx.stack_id, timeout: 1000)
      %{opts: Router.init(build_router_opts(ctx))}
    end

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

    setup(ctx) do
      :ok = Electric.StatusMonitor.wait_until_active(ctx.stack_id, timeout: 1000)
      %{opts: Router.init(build_router_opts(ctx))}
    end

    @tag with_sql: [
           "INSERT INTO items VALUES (gen_random_uuid(), 'test value 1')"
         ]
    test "GET returns a snapshot of initial data", %{opts: opts} do
      conn =
        conn("GET", "/v1/shape?table=items&offset=-1")
        |> Router.call(opts)

      assert %{status: 200} = conn

      response = Jason.decode!(conn.resp_body)

      # Should contain the data record and the snapshot-end control message
      assert [
               %{
                 "headers" => %{"operation" => "insert"},
                 "key" => _,
                 "value" => %{
                   "id" => _,
                   "value" => "test value 1"
                 }
               },
               %{"headers" => %{"control" => "snapshot-end"}}
             ] = response
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
      response = Jason.decode!(conn.resp_body)

      # Should contain the data record and the snapshot-end control message
      assert [
               %{"headers" => %{"operation" => "insert"}, "key" => _, "value" => %{"num" => "1"}},
               %{"headers" => %{"control" => "snapshot-end"}}
             ] = response

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

    @tag chunk_size: 10
    @tag with_sql: [
           "INSERT INTO items VALUES ('00000000-0000-0000-0000-000000000001', 'test value 0')"
         ]
    test "GET after a compaction proceeds correctly",
         %{opts: opts, db_conn: db_conn, storage: storage} do
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

      # Here, we should have exactly 10 chunks with data (and 1 chunk with snapshot control messages)

      final_offset =
        for x <- 0..10, reduce: "0_0" do
          offset ->
            conn =
              conn("GET", "/v1/shape?table=items&handle=#{shape_handle}&offset=#{offset}&live")
              |> Router.call(opts)

            expected_value = "test value #{x}"

            response = Jason.decode!(conn.resp_body)

            case x do
              0 -> assert [%{"headers" => %{"control" => "snapshot-end"}}] = response
              10 -> assert [%{"value" => %{"value" => ^expected_value}}, @up_to_date] = response
              _ -> assert [%{"value" => %{"value" => ^expected_value}}] = response
            end

            {:ok, offset} = LogOffset.from_string(get_resp_header(conn, "electric-offset"))

            offset
        end

      # Force compaction, but it's done in chunks, so we're using small chunks
      Electric.Shapes.Consumer.whereis(opts[:stack_id], shape_handle)
      |> Electric.ShapeCache.Storage.trigger_compaction(storage, 0)

      # If this test is flaking, then the compaction didn't have time to complete - we don't have a good way to wait for it to complete though.
      Process.sleep(200)

      conn =
        conn("GET", "/v1/shape?table=items&handle=#{shape_handle}&offset=0_inf")
        |> Router.call(opts)

      assert [%{"value" => %{"value" => "test value 10"}}, _] = Jason.decode!(conn.resp_body)

      assert LogOffset.from_string(get_resp_header(conn, "electric-offset")) ==
               {:ok, final_offset}
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
      response = Jason.decode!(conn.resp_body)

      # Should contain only the snapshot-end control message (no data records)
      assert length(response) == 1

      assert %{"headers" => %{"control" => "snapshot-end"}} =
               Enum.find(response, &(Map.get(&1, "headers", %{})["control"] == "snapshot-end"))
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

      response = Jason.decode!(conn.resp_body)

      # Should contain the data record and the snapshot-end control message
      assert [
               %{
                 "headers" => %{"operation" => "insert"},
                 "key" => _,
                 "value" => %{"value" => "test value 1"}
               },
               %{"headers" => %{"control" => "snapshot-end"}}
             ] = response

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

      response = Jason.decode!(conn.resp_body)

      # Should contain the data record and the snapshot-end control message
      assert [
               %{
                 "headers" => %{"operation" => "insert"},
                 "key" => _,
                 "value" => %{"value" => "test value 2"}
               },
               %{"headers" => %{"control" => "snapshot-end"}}
             ] = response
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

      response = Jason.decode!(conn.resp_body)

      # Should contain the data record and the snapshot-end control message
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
               },
               %{"headers" => %{"control" => "snapshot-end"}}
             ] = response

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

      response = Jason.decode!(conn.resp_body)

      # Should contain the data record and the snapshot-end control message
      assert [
               %{
                 "headers" => %{"operation" => "insert"},
                 "key" => key,
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
                 }
               },
               %{"headers" => %{"control" => "snapshot-end"}}
             ] = response

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

    @tag slow: true
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

      req = make_shape_req(@large_binary_table, [])

      assert {req, 200, [%{"value" => %{"id" => "1", "blob" => ^hex_blob}}]} =
               shape_req(req, opts)

      assert {req, 200, [%{"headers" => %{"control" => "snapshot-end"}}]} =
               shape_req(req, opts)

      task = live_shape_req(req, opts)

      # ensure that updates also work
      blob = :rand.bytes(blob_size)
      hex_blob = "\\x" <> Base.encode16(blob, case: :lower)

      Postgrex.query!(db_conn, "UPDATE #{@large_binary_table} SET blob = $1 WHERE id = 1", [
        blob
      ])

      assert {_req, 200, body} = Task.await(task)

      assert [%{"value" => %{"id" => "1", "blob" => ^hex_blob}}, @up_to_date] = body
    end

    @generated_pk_table "generated_pk_table"
    @tag with_sql: [
           "CREATE TABLE #{@generated_pk_table} (val JSONB NOT NULL, id uuid PRIMARY KEY GENERATED ALWAYS AS ((val->>'id')::uuid) STORED)"
         ]
    test "returns an error when trying to select a generated column in unsupported dbs",
         %{opts: opts} = ctx do
      %{supports_generated_column_replication: supports_generated_column_replication} =
        Support.TestUtils.fetch_supported_features(ctx.pool)

      if not supports_generated_column_replication do
        # When selecting all columns
        conn =
          conn("GET", "/v1/shape?table=#{@generated_pk_table}&offset=-1") |> Router.call(opts)

        assert %{status: 400} = conn

        assert Jason.decode!(conn.resp_body) ==
                 %{
                   "errors" => %{
                     "columns" => [
                       "The following columns are generated and cannot be included in the shape: id. " <>
                         "You can exclude them from the shape by explicitly listing which columns to fetch in the 'columns' query param"
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
                   "errors" => %{
                     "columns" => [
                       "The list of columns must include all primary key columns, missing: id"
                     ]
                   },
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
                       "The following columns are generated and cannot be included in the shape: id"
                     ]
                   },
                   "message" => "Invalid request"
                 }
      end
    end

    @tag with_sql: [
           "CREATE TABLE #{@generated_pk_table} (val JSONB NOT NULL, id uuid PRIMARY KEY GENERATED ALWAYS AS ((val->>'id')::uuid) STORED)"
         ]
    test "returns an error when trying to select a generated column if not configured",
         %{opts: opts} = ctx do
      %{supports_generated_column_replication: supports_generated_column_replication} =
        Support.TestUtils.fetch_supported_features(ctx.pool)

      if supports_generated_column_replication do
        # disable generated column replication
        Postgrex.query!(
          ctx.pool,
          "ALTER PUBLICATION #{ctx.publication_name} SET (publish_generated_columns = 'none')",
          []
        )

        conn =
          conn("GET", "/v1/shape?table=#{@generated_pk_table}&offset=-1") |> Router.call(opts)

        assert %{status: 503} = conn

        assert Jason.decode!(conn.resp_body) ==
                 %{
                   "message" =>
                     "Publication \"#{ctx.publication_name}\" does not publish generated columns." <>
                       " This is a feature introduced in PostgreSQL 18 and requires setting the publication" <>
                       " parameter 'publish_generated_columns' to 'stored'. Alternatively, you can exclude them" <>
                       " from the shape by explicitly listing which columns to fetch in the 'columns' query param."
                 }
      end
    end

    @generated_uuid "00000000-0000-0000-0000-000000000001"
    @tag with_sql: [
           "CREATE TABLE #{@generated_pk_table} (val JSONB NOT NULL, id uuid PRIMARY KEY GENERATED ALWAYS AS ((val->>'id')::uuid) STORED)",
           "INSERT INTO #{@generated_pk_table} (val) VALUES ('{\"id\": \"#{@generated_uuid}\", \"other\": \"data\"}')"
         ]
    test "can sync generated columns when supported and enabled",
         %{opts: opts} = ctx do
      %{supports_generated_column_replication: supports_generated_column_replication} =
        Support.TestUtils.fetch_supported_features(ctx.pool)

      if supports_generated_column_replication do
        # When selecting all columns
        conn =
          conn("GET", "/v1/shape?table=#{@generated_pk_table}&offset=-1") |> Router.call(opts)

        assert %{status: 200} = conn
        shape_handle = get_resp_shape_handle(conn)

        assert [
                 %{
                   "headers" => %{"operation" => "insert"},
                   "key" => "\"public\".\"generated_pk_table\"/\"#{@generated_uuid}\"" = key,
                   "value" => %{
                     "id" => "#{@generated_uuid}",
                     "val" => "{\"id\": \"#{@generated_uuid}\", \"other\": \"data\"}"
                   }
                 },
                 %{"headers" => %{"control" => "snapshot-end"}}
               ] = Jason.decode!(conn.resp_body)

        task =
          Task.async(fn ->
            conn(
              "GET",
              "/v1/shape?table=#{@generated_pk_table}&offset=0_0&handle=#{shape_handle}&live"
            )
            |> Router.call(opts)
          end)

        Postgrex.query!(
          ctx.pool,
          "UPDATE #{@generated_pk_table} SET val = '{\"id\": \"#{@generated_uuid}\", \"other\": \"different\"}'::jsonb WHERE id = '#{@generated_uuid}'",
          []
        )

        assert %{status: 200} = conn = Task.await(task)

        assert [
                 %{
                   "headers" => %{"operation" => "update"},
                   "key" => ^key,
                   "value" => %{
                     "id" => "#{@generated_uuid}",
                     "val" => "{\"id\": \"#{@generated_uuid}\", \"other\": \"different\"}"
                   }
                 },
                 @up_to_date
               ] = Jason.decode!(conn.resp_body)
      end
    end

    @tag with_sql: [
           "CREATE TABLE wide_table (id BIGINT PRIMARY KEY, value1 TEXT NOT NULL, value2 TEXT NOT NULL, value3 TEXT NOT NULL)",
           "INSERT INTO wide_table VALUES (1, 'test value 1', 'test value 1', 'test value 1')"
         ]
    test "GET received only a diff when receiving updates", %{opts: opts, db_conn: db_conn} do
      conn = conn("GET", "/v1/shape?table=wide_table&offset=-1") |> Router.call(opts)
      assert %{status: 200} = conn
      shape_handle = get_resp_shape_handle(conn)

      response = Jason.decode!(conn.resp_body)

      # Should contain the data record and the snapshot-end control message
      assert [
               %{
                 "headers" => %{"operation" => "insert"},
                 "key" => key,
                 "value" => %{"id" => _, "value1" => _, "value2" => _, "value3" => _}
               },
               %{"headers" => %{"control" => "snapshot-end"}}
             ] = response

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

      response = Jason.decode!(conn.resp_body)

      # Should contain the data record and the snapshot-end control message
      assert [
               %{
                 "headers" => %{"operation" => "insert"},
                 "key" => key,
                 "value" => %{"id" => _, "value1" => _, "value2" => _, "value3" => _}
               },
               %{"headers" => %{"control" => "snapshot-end"}}
             ] = response

      task =
        Task.async(fn ->
          conn("GET", "/v1/shape?table=wide_table&offset=0_0&handle=#{shape_handle}&live")
          |> Router.call(opts)
        end)

      Postgrex.transaction(db_conn, fn tx_conn ->
        Postgrex.query!(
          tx_conn,
          "INSERT INTO wide_table VALUES (3, 'other', 'other', 'other')",
          []
        )

        Postgrex.query!(
          tx_conn,
          "UPDATE wide_table SET id = 2, value2 = 'test value 2' WHERE id = 1",
          []
        )
      end)

      assert %{status: 200} = conn = Task.await(task)

      assert [
               %{
                 "headers" => %{"operation" => "insert"},
                 "value" => %{"id" => "3", "value1" => _, "value2" => _, "value3" => _},
                 "key" => key3
               },
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

      response = Jason.decode!(conn.resp_body)

      # Should contain the data record and the snapshot-end control message
      assert [
               %{
                 "headers" => %{"operation" => "insert"},
                 "key" => key,
                 "value" => %{"col1" => "test1", "col2" => "test2"}
               },
               %{"headers" => %{"control" => "snapshot-end"}}
             ] = response

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

      response = Jason.decode!(conn.resp_body)

      # Should contain the data record and the snapshot-end control message
      assert [
               %{
                 "headers" => %{"operation" => "insert"},
                 "key" => key,
                 "value" => %{"id" => "1", "value1" => "test value 1"}
               },
               %{"headers" => %{"control" => "snapshot-end"}}
             ] = response

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

      response = Jason.decode!(conn.resp_body)

      # Should contain only the snapshot-end control message (no data records)
      assert length(response) == 1

      assert %{"headers" => %{"control" => "snapshot-end"}} =
               Enum.find(response, &(Map.get(&1, "headers", %{})["control"] == "snapshot-end"))

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

      # Should contain the data record and the snapshot-end control message
      assert length(json_body) == 2

      assert %{
               "value" => %{"id" => _, "value1" => _, "value2" => _, "value3" => _},
               "key" => key
             } = Enum.find(json_body, &Map.has_key?(&1, "key"))

      assert %{"headers" => %{"control" => "snapshot-end"}} =
               Enum.find(json_body, &(Map.get(&1, "headers", %{})["control"] == "snapshot-end"))

      # Old value cannot be present on the data records in the snapshot
      data_records = Enum.filter(json_body, &Map.has_key?(&1, "key"))
      refute Enum.any?(data_records, &Map.has_key?(&1, "old_value"))

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
      response = Jason.decode!(conn.resp_body)

      # Should contain the data record and the snapshot-end control message
      assert [
               op = %{
                 "headers" => %{"operation" => "insert", "relation" => ["public", "serial_ids"]},
                 "key" => ~s|"public"."serial_ids"/"2"|,
                 "value" => %{"id" => "2", "num" => "10"}
               },
               %{"headers" => %{"control" => "snapshot-end"}}
             ] = response

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
      response = Jason.decode!(conn.resp_body)

      # Should contain 2 data records and the snapshot-end control message
      assert length(response) == 3

      # Filter out control messages to get just the data records
      data_records = Enum.filter(response, &Map.has_key?(&1, "key"))
      assert length(data_records) == 2

      assert [op1, op2] = data_records

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

      response = Jason.decode!(conn.resp_body)

      # Should contain only the snapshot-end control message (no data records)
      assert length(response) == 1

      assert %{"headers" => %{"control" => "snapshot-end"}} =
               Enum.find(response, &(Map.get(&1, "headers", %{})["control"] == "snapshot-end"))

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
      assert new_shape_handle = get_resp_header(conn, "electric-handle")
      assert is_binary(new_shape_handle)
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
      response = Jason.decode!(conn.resp_body)

      # Should contain the data record and the snapshot-end control message
      assert [
               %{
                 "headers" => %{"operation" => "insert"},
                 "key" => _,
                 "value" => %{"value" => "test value 1"}
               },
               %{"headers" => %{"control" => "snapshot-end"}}
             ] = response

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
      assert %{status: 409} = conn = Task.await(task)
      assert [%{"headers" => %{"control" => "must-refetch"}}] = Jason.decode!(conn.resp_body)

      conn =
        Router.call(conn("GET", "/v1/shape?table=items&offset=-1"), opts)

      assert %{status: 200} = conn
      new_handle = get_resp_shape_handle(conn)
      refute new_handle == handle
      offset = get_resp_last_offset(conn)
      response = Jason.decode!(conn.resp_body)

      # Should contain only the snapshot-end control message (no data records)
      assert length(response) == 1

      assert %{"headers" => %{"control" => "snapshot-end"}} =
               Enum.find(response, &(Map.get(&1, "headers", %{})["control"] == "snapshot-end"))

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

      assert allowed_methods == MapSet.new(["GET", "POST", "HEAD", "OPTIONS", "DELETE"])
    end

    @tag slow: true
    test "GET with a concurrent transaction doesn't crash irrecoverably", %{
      opts: opts,
      db_conn: db_conn
    } do
      # Start a transaction that has a lock on `items`.
      child =
        start_supervised!(
          Supervisor.child_spec(
            {
              Task,
              fn ->
                Postgrex.transaction(
                  db_conn,
                  fn tx_conn ->
                    Postgrex.query!(
                      tx_conn,
                      "INSERT INTO items VALUES (gen_random_uuid(), 'test value')",
                      []
                    )

                    receive(do: (:continue -> :ok))
                  end,
                  timeout: :infinity
                )
              end
            },
            restart: :temporary
          )
        )

      # This can't alter the publication, so crashes
      assert %{status: 503, resp_body: body} =
               conn("GET", "/v1/shape?table=items&offset=-1")
               |> Router.call(opts)

      assert %{"message" => "Snapshot timed out while waiting for a table lock"} =
               Jason.decode!(body)

      # Now we can continue
      ref = Process.monitor(child)
      send(child, :continue)
      assert_receive {:DOWN, ^ref, :process, _pid, _reason}

      # TODO: fix issue with shape crashing before it is initialised
      Process.sleep(100)

      # This should work now
      assert %{status: 200, resp_body: body} =
               conn("GET", "/v1/shape?table=items&offset=-1")
               |> Router.call(opts)

      assert [_, %{"headers" => %{"control" => "snapshot-end"}}] = Jason.decode!(body)

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

      offset = get_resp_last_offset(conn)

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

    @tag with_sql: [
           "CREATE TABLE droppability_test (id INT PRIMARY KEY, value TEXT NOT NULL)",
           "INSERT INTO droppability_test (id, value) VALUES (1, 'test')"
         ]
    test "Recreating the table causes a 409", %{
      opts: opts,
      db_conn: db_conn,
      publication_name: publication_name
    } do
      assert %{status: 200} =
               conn =
               conn("GET", "/v1/shape", %{table: "droppability_test", offset: "-1"})
               |> Router.call(opts)

      shape_handle = get_resp_shape_handle(conn)

      task =
        Task.async(fn ->
          conn(
            "GET",
            "/v1/shape?table=droppability_test&offset=0_0&handle=#{shape_handle}&live"
          )
          |> Router.call(opts)
        end)

      Postgrex.query!(db_conn, "DROP TABLE droppability_test", [])

      Postgrex.query!(
        db_conn,
        "CREATE TABLE droppability_test (id INT PRIMARY KEY, value TEXT NOT NULL)",
        []
      )

      # The table will not be automatically added to the publication, however since we have
      # the table definition cached with old OID and column information, any further shape creation
      # with where clauses will cause us to run a `ALTER PUBLICATION SET ...` command effectively re-adding
      # the table. This emulates that behaviour.
      Postgrex.query!(
        db_conn,
        "ALTER PUBLICATION #{publication_name} ADD TABLE droppability_test",
        []
      )

      Postgrex.query!(db_conn, "INSERT INTO droppability_test (id, value) VALUES (1, 'test')", [])

      # 1 sec timeout to make sure we see the change instead of acting as if no changes have been observed
      assert %{status: 409} = Task.await(task, 1_000)

      assert %{status: 409} =
               conn("GET", "/v1/shape", %{
                 table: "droppability_test",
                 offset: "0_0",
                 handle: shape_handle
               })
               |> Router.call(opts)
    end

    @tag with_sql: [
           "CREATE TABLE droppability_test (id INT PRIMARY KEY, value TEXT NOT NULL)",
           "INSERT INTO droppability_test (id, value) VALUES (1, 'test')"
         ]
    test "recreating the table with a different column set doesn't trigger a failure", %{
      opts: opts,
      db_conn: db_conn
    } do
      assert %{status: 200} =
               conn("GET", "/v1/shape", %{
                 table: "droppability_test",
                 offset: "-1"
               })
               |> Router.call(opts)

      Postgrex.query!(db_conn, "DROP TABLE droppability_test", [])

      Postgrex.query!(
        db_conn,
        "CREATE TABLE droppability_test (id INT PRIMARY KEY, column_other_than_value TEXT NOT NULL)",
        []
      )

      assert %{status: 409} =
               conn("GET", "/v1/shape", %{
                 table: "droppability_test",
                 offset: "-1",
                 where: "value = 'test' AND 2 = 2"
               })
               |> Router.call(opts)
    end

    @tag with_sql: [
           "CREATE TABLE droppability_test (id INT PRIMARY KEY, value INTEGER NOT NULL)",
           "INSERT INTO droppability_test (id, value) VALUES (1, 1)"
         ]
    test "dropping a table doesn't cause a 500", %{
      opts: opts,
      db_conn: db_conn
    } do
      assert %{status: 200} =
               conn("GET", "/v1/shape", %{
                 table: "droppability_test",
                 offset: "-1",
                 where: "id = 1"
               })
               |> Router.call(opts)

      Postgrex.query!(db_conn, "DROP TABLE droppability_test", [])

      assert %{status: 409} =
               conn("GET", "/v1/shape", %{
                 table: "droppability_test",
                 offset: "-1",
                 where: "value + 1 >= 2"
               })
               |> Router.call(opts)
    end

    @tag with_sql: [
           "CREATE TABLE droppability_test (id INT PRIMARY KEY, value INTEGER NOT NULL)",
           "CREATE TABLE droppability_test_2 (id INT PRIMARY KEY, value INTEGER NOT NULL)"
         ]

    test "dropping and creating the table (same structure) causes a 409 after poller had noticed it",
         %{
           opts: opts,
           db_conn: db_conn,
           stack_id: stack_id
         } do
      assert %{status: 200} =
               conn1 =
               conn("GET", "/v1/shape", %{table: "droppability_test", offset: "-1"})
               |> Router.call(opts)

      assert %{status: 200} =
               conn2 =
               conn("GET", "/v1/shape", %{table: "droppability_test_2", offset: "-1"})
               |> Router.call(opts)

      shape_handle1 = get_resp_shape_handle(conn1)
      shape_handle2 = get_resp_shape_handle(conn2)

      Postgrex.query!(db_conn, "DROP TABLE droppability_test", [])

      Postgrex.query!(
        db_conn,
        "CREATE TABLE droppability_test (id INT PRIMARY KEY, value INTEGER NOT NULL)",
        []
      )

      Postgrex.query!(
        db_conn,
        "ALTER TABLE droppability_test_2 DROP COLUMN value",
        []
      )

      ref1 = Process.monitor(Electric.Shapes.Consumer.whereis(stack_id, shape_handle1))
      ref2 = Process.monitor(Electric.Shapes.Consumer.whereis(stack_id, shape_handle2))

      # Trigger the reconciler to notice the dropped/created table (OID change)
      Electric.Replication.SchemaReconciler.name(stack_id)
      |> Electric.Replication.SchemaReconciler.reconcile_now()

      assert_receive {:DOWN, ^ref1, :process, _, _}
      assert_receive {:DOWN, ^ref2, :process, _, _}

      # Now we should get a 409 when trying to continue reading
      assert %{status: 409} =
               conn("GET", "/v1/shape", %{
                 table: "droppability_test",
                 offset: "0_0",
                 handle: shape_handle1
               })
               |> Router.call(opts)

      assert %{status: 409} =
               conn("GET", "/v1/shape", %{
                 table: "droppability_test_2",
                 offset: "0_0",
                 handle: shape_handle2
               })
               |> Router.call(opts)
    end

    test "now offset returns an up-to-date response regardless of existing data", %{
      opts: opts,
      db_conn: db_conn
    } do
      req = make_shape_req("items")

      assert {req, 200, _} = shape_req(req, opts)

      task = live_shape_req(req, opts)

      Postgrex.query!(
        db_conn,
        "INSERT INTO items (id, value) VALUES (gen_random_uuid(), 'test')",
        []
      )

      assert {r1, 200, _} = Task.await(task)

      # If we do a direct request with now offset, we shouldn't get any data, but correct offset in the header
      assert {r2, 200, [%{"headers" => %{"control" => "up-to-date"}}]} =
               shape_req(req, opts, offset: "now")

      assert r1.offset == r2.offset
    end

    test "now offset returns an up-to-date response with 0_inf offset when shape is new", %{
      opts: opts
    } do
      req = make_shape_req("items", offset: "now")

      assert {req, 200, [%{"headers" => %{"control" => "up-to-date"}}]} = shape_req(req, opts)
      assert req.offset == "0_inf"
    end
  end

  describe "/v1/shapes - admission control" do
    setup [:with_unique_db, :with_basic_tables, :with_sql_execute]

    setup :with_complete_stack

    setup(ctx) do
      :ok = Electric.StatusMonitor.wait_until_active(ctx.stack_id, timeout: 1000)

      # Build router opts with low max_concurrent limit for testing
      router_opts =
        ctx
        |> build_router_opts()
        |> Keyword.update!(:api, fn api ->
          %{api | max_concurrent_requests: %{initial: 2, existing: 2}}
        end)

      %{opts: Router.init(router_opts)}
    end

    @tag with_sql: [
           "INSERT INTO items VALUES (gen_random_uuid(), 'test value 1')"
         ]
    test "rejects requests when at capacity with 503", %{opts: opts, db_conn: db_conn} do
      # Get initial snapshot to create the shape
      conn = conn("GET", "/v1/shape?table=items&offset=-1") |> Router.call(opts)
      assert %{status: 200} = conn
      shape_handle = get_resp_shape_handle(conn)
      offset = get_resp_last_offset(conn)

      # Start 2 live requests (which will hold permits)
      task1 =
        Task.async(fn ->
          conn("GET", "/v1/shape?table=items&offset=#{offset}&handle=#{shape_handle}&live")
          |> Router.call(opts)
        end)

      task2 =
        Task.async(fn ->
          conn("GET", "/v1/shape?table=items&offset=#{offset}&handle=#{shape_handle}&live")
          |> Router.call(opts)
        end)

      # Give the live requests time to acquire permits
      Process.sleep(100)

      # Third request should be rejected with 503
      conn3 =
        conn("GET", "/v1/shape?table=items&offset=#{offset}&handle=#{shape_handle}&live")
        |> Router.call(opts)

      assert %{status: 503} = conn3

      body = Jason.decode!(conn3.resp_body)
      assert body["code"] == "concurrent_request_limit_exceeded"
      assert body["message"] =~ "Concurrent existing request limit exceeded"

      # Should have Retry-After header
      assert [retry_after] = Plug.Conn.get_resp_header(conn3, "retry-after")
      assert String.to_integer(retry_after) >= 5
      assert String.to_integer(retry_after) <= 10

      # Complete the live requests by inserting data
      Postgrex.query!(db_conn, "INSERT INTO items VALUES (gen_random_uuid(), 'test value 2')", [])

      # Live requests should complete successfully
      assert %{status: 200} = Task.await(task1)
      assert %{status: 200} = Task.await(task2)
    end

    @tag with_sql: [
           "INSERT INTO items VALUES (gen_random_uuid(), 'test value 1')"
         ]
    test "tracks initial and existing requests separately", %{
      opts: opts,
      db_conn: db_conn,
      stack_id: stack_id
    } do
      # Get initial snapshot to create the shape
      req = make_shape_req("items")
      assert {req, 200, _} = shape_req(req, opts)

      # Verify no permits are held initially
      assert %{initial: 0, existing: 0} = Electric.AdmissionControl.get_current(stack_id)

      # Start 2 live requests with existing offsets (these will wait for data, holding permits)
      task_existing1 = live_shape_req(req, opts)
      task_existing2 = live_shape_req(req, opts)

      # Give the live requests time to acquire permits
      Process.sleep(300)

      # Verify 2 existing permits are held
      assert %{initial: 0, existing: 2} = Electric.AdmissionControl.get_current(stack_id)

      # Third existing request should be rejected (limit is 2)
      {_, status_existing, _} = shape_req(req, opts)
      assert status_existing == 503

      # But initial requests should still work since they're tracked separately
      # Use non-live requests which complete quickly
      conn_initial1 =
        conn("GET", "/v1/shape?table=items&offset=-1&where=value='test'") |> Router.call(opts)

      assert %{status: 200} = conn_initial1

      conn_initial2 =
        conn("GET", "/v1/shape?table=items&offset=-1&where=value='other'") |> Router.call(opts)

      assert %{status: 200} = conn_initial2

      # After they complete, permits should still be 0 for initial (released) and 2 for existing (still held)
      assert %{initial: 0, existing: 2} = Electric.AdmissionControl.get_current(stack_id)

      # Insert data to complete the existing live requests
      Postgrex.query!(db_conn, "INSERT INTO items VALUES (gen_random_uuid(), 'test value 2')", [])

      # Wait for live requests to complete
      assert {_, 200, _} = Task.await(task_existing1)
      assert {_, 200, _} = Task.await(task_existing2)

      # After completion, all permits should be released
      assert %{initial: 0, existing: 0} = Electric.AdmissionControl.get_current(stack_id)
    end
  end

  describe "/v1/shapes - subqueries" do
    setup [:with_unique_db, :with_basic_tables, :with_sql_execute]

    setup :with_complete_stack

    setup(ctx) do
      :ok = Electric.StatusMonitor.wait_until_active(ctx.stack_id, timeout: 1000)
      %{opts: Router.init(build_router_opts(ctx))}
    end

    @tag with_sql: [
           "CREATE TABLE parent (id INT PRIMARY KEY, value INT NOT NULL)",
           "CREATE TABLE child (id INT PRIMARY KEY, parent_id INT NOT NULL REFERENCES parent(id), value INT NOT NULL)",
           "INSERT INTO parent (id, value) VALUES (1, 1), (2, 2)",
           "INSERT INTO child (id, parent_id, value) VALUES (1, 1, 10), (2, 2, 20)"
         ]
    test "allows subquery in where clause", %{opts: opts, db_conn: db_conn} do
      where = "parent_id in (SELECT id FROM parent WHERE value = 1)"

      assert %{status: 200} =
               conn =
               conn("GET", "/v1/shape", %{
                 table: "child",
                 offset: "-1",
                 where: where
               })
               |> Router.call(opts)

      shape_handle = get_resp_shape_handle(conn)

      response = Jason.decode!(conn.resp_body)

      # Should contain the data record and the snapshot-end control message
      assert [
               %{
                 "headers" => %{"operation" => "insert"},
                 "key" => _,
                 "value" => %{"id" => "1", "parent_id" => "1", "value" => "10"}
               },
               %{"headers" => %{"control" => "snapshot-end"}}
             ] = response

      task =
        Task.async(fn ->
          conn("GET", "/v1/shape", %{
            table: "child",
            offset: "0_0",
            handle: shape_handle,
            where: where,
            live: true
          })
          |> Router.call(opts)
        end)

      Postgrex.query!(db_conn, "INSERT INTO child (id, parent_id, value) VALUES (3, 1, 30)", [])

      assert %{status: 200} = conn = Task.await(task)

      assert [%{"value" => %{"value" => "30"}}, _] = Jason.decode!(conn.resp_body)
    end

    test "return 400 if subquery references unknown table", %{opts: opts} do
      assert %{status: 400} =
               conn("GET", "/v1/shape", %{
                 table: "items",
                 offset: "-1",
                 where: "id in (SELECT id FROM unknown_table WHERE value = 1)"
               })
               |> Router.call(opts)
    end

    @tag with_sql: [
           "CREATE TABLE parent (id INT PRIMARY KEY, value INT NOT NULL)",
           "CREATE TABLE child (id INT PRIMARY KEY, parent_id INT NOT NULL REFERENCES parent(id), value INT NOT NULL)",
           "INSERT INTO parent (id, value) VALUES (1, 1), (2, 2)",
           "INSERT INTO child (id, parent_id, value) VALUES (1, 1, 10), (2, 2, 20)"
         ]
    test "a move-out from the inner shape is propagated to the outer shape", %{
      opts: opts,
      db_conn: db_conn
    } do
      req = make_shape_req("child", where: "parent_id in (SELECT id FROM parent WHERE value = 1)")

      assert {req, 200, [data, snapshot_end]} = shape_req(req, opts)

      assert %{
               "value" => %{"id" => "1", "parent_id" => "1", "value" => "10"},
               "headers" => %{"operation" => "insert", "tags" => [tag]}
             } = data

      assert %{"headers" => %{"control" => "snapshot-end"}} = snapshot_end

      task = live_shape_req(req, opts)

      Postgrex.query!(db_conn, "UPDATE parent SET value = 3 WHERE id = 1", [])

      assert {_req, 200, [data, %{"headers" => %{"control" => "up-to-date"}}]} = Task.await(task)

      assert %{
               "headers" => %{
                 "event" => "move-out",
                 "patterns" => [%{"pos" => 0, "value" => ^tag}]
               }
             } = data
    end

    @tag with_sql: [
           "CREATE TABLE parent (id INT PRIMARY KEY, value INT NOT NULL)",
           "CREATE TABLE child (id INT PRIMARY KEY, parent_id INT NOT NULL REFERENCES parent(id), value INT NOT NULL)",
           "INSERT INTO parent (id, value) VALUES (1, 1), (2, 2)",
           "INSERT INTO child (id, parent_id, value) VALUES (1, 1, 10), (2, 2, 20)"
         ]
    test "a move-in from the inner shape causes a query and new entries in the outer shape", %{
      opts: opts,
      db_conn: db_conn,
      stack_id: stack_id
    } do
      req = make_shape_req("child", where: "parent_id in (SELECT id FROM parent WHERE value = 1)")
      assert {req, 200, [data, snapshot_end]} = shape_req(req, opts)

      tag =
        :crypto.hash(:md5, stack_id <> req.handle <> "v:1")
        |> Base.encode16(case: :lower)

      assert %{"id" => "1", "parent_id" => "1", "value" => "10"} = data["value"]
      assert %{"operation" => "insert", "tags" => [^tag]} = data["headers"]
      assert %{"headers" => %{"control" => "snapshot-end"}} = snapshot_end

      task = live_shape_req(req, opts)

      # Move in reflects in the new shape without invalidating it
      Postgrex.query!(db_conn, "UPDATE parent SET value = 1 WHERE id = 2", [])

      tag2 =
        :crypto.hash(:md5, stack_id <> req.handle <> "v:2")
        |> Base.encode16(case: :lower)

      assert {_, 200, [data, %{"headers" => %{"control" => "snapshot-end"}}, up_to_date_ctl()]} =
               Task.await(task)

      assert %{"id" => "2", "parent_id" => "2", "value" => "20"} = data["value"]

      assert %{"operation" => "insert", "is_move_in" => true, "tags" => [^tag2]} =
               data["headers"]
    end

    @tag with_sql: [
           "CREATE TABLE parent (id INT PRIMARY KEY, excluded BOOLEAN NOT NULL DEFAULT FALSE)",
           "CREATE TABLE child (id INT PRIMARY KEY, parent_id INT NOT NULL REFERENCES parent(id), value INT NOT NULL)",
           "INSERT INTO parent (id, excluded) VALUES (1, false), (2, true)",
           "INSERT INTO child (id, parent_id, value) VALUES (1, 1, 10), (2, 2, 20)"
         ]
    test "NOT IN subquery should return 409 on move-in to subquery", %{
      opts: opts,
      db_conn: db_conn
    } do
      # Child rows where parent_id is NOT IN the set of excluded parents
      # Initially: parent 1 is not excluded, so child 1 is in the shape
      # parent 2 is excluded, so child 2 is NOT in the shape
      req =
        make_shape_req("child",
          where: "parent_id NOT IN (SELECT id FROM parent WHERE excluded = true)"
        )

      assert {req, 200, [data, snapshot_end]} = shape_req(req, opts)

      # Only child 1 should be in the shape (parent 1 is not excluded)
      assert %{
               "value" => %{"id" => "1", "parent_id" => "1", "value" => "10"},
               "headers" => %{"operation" => "insert"}
             } = data

      assert %{"headers" => %{"control" => "snapshot-end"}} = snapshot_end

      task = live_shape_req(req, opts)

      # Now set parent 1 to excluded = true
      # This causes parent 1 to move INTO the subquery result
      # Which should cause child 1 to move OUT of the outer shape
      # Since NOT IN subquery move-out isn't implemented, we expect a 409
      Postgrex.query!(db_conn, "UPDATE parent SET excluded = true WHERE id = 1", [])

      assert {_req, 409, _response} = Task.await(task)
    end

    @tag with_sql: [
           "CREATE TABLE parent (id INT PRIMARY KEY, value INT NOT NULL, other_value INT NOT NULL)",
           "CREATE TABLE child (id INT PRIMARY KEY, value INT NOT NULL, other_value INT NOT NULL)",
           "INSERT INTO parent (id, value, other_value) VALUES (1, 10, 10), (2, 20, 5)",
           "INSERT INTO child (id, value, other_value) VALUES (1, 10, 10)"
         ]
    test "allows subquery in where clauses that reference non-PK columns", %{
      opts: opts,
      db_conn: db_conn
    } do
      req =
        make_shape_req("child",
          where: "value in (SELECT value FROM parent WHERE other_value >= 10)"
        )

      assert {req, 200, response} = shape_req(req, opts)
      # Should contain the data record and the snapshot-end control message
      assert length(response) == 2

      assert %{"value" => %{"id" => "1", "value" => "10"}} =
               Enum.find(response, &Map.has_key?(&1, "key"))

      assert %{"headers" => %{"control" => "snapshot-end"}} =
               Enum.find(response, &(Map.get(&1, "headers", %{})["control"] == "snapshot-end"))

      # Updating the parent in a way that doesn't change the condition
      task = live_shape_req(req, opts)
      Postgrex.query!(db_conn, "UPDATE parent SET other_value = 13 WHERE id = 1")
      # This change should thus be visible
      Postgrex.query!(db_conn, "UPDATE child SET other_value = 2 WHERE id = 1")

      assert {req, 200, [%{"value" => %{"id" => "1", "other_value" => "2"}}, _]} =
               Task.await(task)

      # Adding another parent row in a way that's not changing the target value
      task = live_shape_req(req, opts)
      Postgrex.query!(db_conn, "INSERT INTO parent (id, value, other_value) VALUES (3, 10, 30)")
      # This change should thus be visible
      Postgrex.query!(db_conn, "UPDATE child SET other_value = 3 WHERE id = 1")

      assert {req, 200, [%{"value" => %{"id" => "1", "other_value" => "3"}}, _]} =
               Task.await(task)

      # But adding a new value to the target set does
      task = live_shape_req(req, opts)
      Postgrex.query!(db_conn, "INSERT INTO child (id, value, other_value) VALUES (2, 20, 4)", [])
      Postgrex.query!(db_conn, "UPDATE parent SET other_value = 10 WHERE id = 2")

      assert {_, 200,
              [
                %{"value" => %{"id" => "2", "other_value" => "4"}},
                %{"headers" => %{"control" => "snapshot-end"}},
                up_to_date_ctl()
              ]} = Task.await(task)
    end

    @tag with_sql: [
           "CREATE TABLE grandparent (id INT PRIMARY KEY, value INT NOT NULL)",
           "CREATE TABLE parent (id INT PRIMARY KEY, value INT NOT NULL, grandparent_id INT NOT NULL REFERENCES grandparent(id))",
           "CREATE TABLE child (id INT PRIMARY KEY, value INT NOT NULL, parent_id INT NOT NULL REFERENCES parent(id))",
           "INSERT INTO grandparent (id, value) VALUES (1, 10), (2, 20)",
           "INSERT INTO parent (id, value, grandparent_id) VALUES (1, 10, 1), (2, 20, 2)",
           "INSERT INTO child (id, value, parent_id) VALUES (1, 10, 1), (2, 20, 2)"
         ]
    test "allows 3 level subquery in where clauses", %{
      opts: opts,
      db_conn: db_conn
    } do
      orig_req =
        make_shape_req("child",
          where:
            "parent_id in (SELECT id FROM parent WHERE grandparent_id in (SELECT id FROM grandparent WHERE value = 10))"
        )

      assert {req, 200, response} = shape_req(orig_req, opts)
      # Should contain the data record and the snapshot-end control message
      assert length(response) == 2

      assert %{"value" => %{"id" => "1", "value" => "10"}} =
               Enum.find(response, &Map.has_key?(&1, "key"))

      assert %{"headers" => %{"control" => "snapshot-end"}} =
               Enum.find(response, &(Map.get(&1, "headers", %{})["control"] == "snapshot-end"))

      # Basic update should be visible
      task = live_shape_req(req, opts)
      Postgrex.query!(db_conn, "UPDATE child SET value = 2 WHERE id = 1")

      assert {req, 200, [%{"value" => %{"id" => "1", "value" => "2"}}, _]} =
               Task.await(task)

      # Grandparent move should eventually result in a move-in
      task = live_shape_req(req, opts)
      Postgrex.query!(db_conn, "UPDATE grandparent SET value = 10 WHERE id = 2")

      assert {req, 200,
              [
                %{
                  "value" => %{"id" => "2", "value" => "20"},
                  "headers" => %{"operation" => "insert", "is_move_in" => true, "tags" => [tag]}
                },
                %{"headers" => %{"control" => "snapshot-end"}},
                up_to_date_ctl()
              ]} =
               Task.await(task)

      # And move-out should be propagated
      task = live_shape_req(req, opts)
      Postgrex.query!(db_conn, "UPDATE grandparent SET value = 20 WHERE id = 2")

      assert {_, 200,
              [
                %{
                  "headers" => %{
                    "event" => "move-out",
                    "patterns" => [%{"pos" => 0, "value" => ^tag}]
                  }
                },
                _
              ]} = Task.await(task)
    end

    @tag with_sql: [
           "CREATE TABLE parent (id INT PRIMARY KEY, include_parent BOOLEAN NOT NULL DEFAULT FALSE)",
           "CREATE TABLE child (id INT PRIMARY KEY, parent_id INT NOT NULL REFERENCES parent(id), include_child BOOLEAN NOT NULL DEFAULT FALSE)",
           "INSERT INTO parent (id, include_parent) VALUES (1, true)",
           "INSERT INTO child (id, parent_id, include_child) VALUES (1, 1, true)"
         ]
    test "subquery combined with OR should return a 409 on move-out", %{
      opts: opts,
      db_conn: db_conn
    } do
      orig_req =
        make_shape_req("child",
          where:
            "parent_id in (SELECT id FROM parent WHERE include_parent = true) OR include_child = true"
        )

      assert {req, 200, response} = shape_req(orig_req, opts)
      # Should contain the data record and the snapshot-end control message
      assert length(response) == 2

      assert %{"value" => %{"id" => "1", "include_child" => "true"}} =
               Enum.find(response, &Map.has_key?(&1, "key"))

      task = live_shape_req(req, opts)

      # Setting include_parent to false may cause a move out, but it doesn't in this case because include_child is still true
      Postgrex.query!(db_conn, "UPDATE parent SET include_parent = false WHERE id = 1", [])

      # Rather than working out whether this is a move out or not we return a 409
      assert {_req, 409, _response} = Task.await(task)
    end

    @tag with_sql: [
           "CREATE TABLE parent (id INT PRIMARY KEY, include_parent BOOLEAN NOT NULL DEFAULT FALSE)",
           "CREATE TABLE child (id INT PRIMARY KEY, parent_id INT NOT NULL REFERENCES parent(id), include_child BOOLEAN NOT NULL DEFAULT FALSE)",
           "INSERT INTO parent (id, include_parent) VALUES (1, false)",
           "INSERT INTO child (id, parent_id, include_child) VALUES (1, 1, true)"
         ]
    test "subquery combined with OR should return a 409 on move-in", %{
      opts: opts,
      db_conn: db_conn
    } do
      orig_req =
        make_shape_req("child",
          where:
            "parent_id in (SELECT id FROM parent WHERE include_parent = true) OR include_child = true"
        )

      assert {req, 200, response} = shape_req(orig_req, opts)
      # Should contain the data record and the snapshot-end control message
      assert length(response) == 2

      assert %{"value" => %{"id" => "1", "include_child" => "true"}} =
               Enum.find(response, &Map.has_key?(&1, "key"))

      task = live_shape_req(req, opts)

      # Setting include_parent to true may cause a move in, but it doesn't in this case because include_child is already true
      Postgrex.query!(db_conn, "UPDATE parent SET include_parent = true WHERE id = 1", [])

      # Rather than working out whether this is a move in or not we return a 409
      assert {_req, 409, _response} = Task.await(task)
    end

    @tag with_sql: [
           "CREATE TABLE grandparent (id INT PRIMARY KEY, include_grandparent BOOLEAN NOT NULL DEFAULT FALSE)",
           "CREATE TABLE parent (id INT PRIMARY KEY, grandparent_id INT NOT NULL REFERENCES grandparent(id), include_parent BOOLEAN NOT NULL DEFAULT FALSE)",
           "CREATE TABLE child (id INT PRIMARY KEY, parent_id INT NOT NULL REFERENCES parent(id))",
           "INSERT INTO grandparent (id, include_grandparent) VALUES (1, false)",
           "INSERT INTO parent (id, grandparent_id, include_parent) VALUES (1, 1, true)",
           "INSERT INTO child (id, parent_id) VALUES (1, 1)"
         ]
    test "nested subquery combined with OR should return a 409 on move-in", %{
      opts: opts,
      db_conn: db_conn
    } do
      orig_req =
        make_shape_req("child",
          where:
            "parent_id in (SELECT id FROM parent WHERE include_parent = true OR grandparent_id in (SELECT id FROM grandparent WHERE include_grandparent = true))"
        )

      assert {req, 200, response} = shape_req(orig_req, opts)
      # Should contain the data record and the snapshot-end control message
      assert length(response) == 2

      assert %{"value" => %{"id" => "1"}} =
               Enum.find(response, &Map.has_key?(&1, "key"))

      task = live_shape_req(req, opts)

      # Setting include_grandparent to true may cause a move in, but it doesn't in this case because include_parent is already true
      Postgrex.query!(
        db_conn,
        "UPDATE grandparent SET include_grandparent = true WHERE id = 1",
        []
      )

      # Rather than working out whether this is a move in or not we return a 409
      assert {_req, 409, _response} = Task.await(task)
    end

    @tag with_sql: [
           "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL)",
           "CREATE TABLE teams (id INTEGER PRIMARY KEY, name TEXT NOT NULL)",
           "CREATE TABLE members (user_id INTEGER REFERENCES users(id), team_id INTEGER REFERENCES teams(id), PRIMARY KEY (user_id, team_id))",
           "INSERT INTO users (id, name) VALUES (1, 'John'), (2, 'Jane')",
           "INSERT INTO teams (id, name) VALUES (1, 'Team A'), (2, 'Team B')",
           "INSERT INTO members (user_id, team_id) VALUES (1, 1), (2, 2)"
         ]
    test "table with a composite PK can be used in a subquery", ctx do
      orig_req =
        make_shape_req("teams",
          where: "id IN (SELECT team_id FROM members WHERE user_id = 1)"
        )

      assert {req, 200, response} = shape_req(orig_req, ctx.opts)
      # Should contain the data record and the snapshot-end control message
      assert length(response) == 2

      assert %{"value" => %{"id" => "1", "name" => "Team A"}} =
               Enum.find(response, &Map.has_key?(&1, "key"))

      assert %{"headers" => %{"control" => "snapshot-end"}} =
               Enum.find(response, &(Map.get(&1, "headers", %{})["control"] == "snapshot-end"))

      # Basic update should be visible
      task = live_shape_req(req, ctx.opts)
      Postgrex.query!(ctx.db_conn, "UPDATE teams SET name = 'Team C' WHERE id = 1")

      assert {req, 200, [%{"value" => %{"id" => "1", "name" => "Team C"}}, _]} =
               Task.await(task)

      # Move-in should cause data to appear
      task = live_shape_req(req, ctx.opts)
      Postgrex.query!(ctx.db_conn, "INSERT INTO members (user_id, team_id) VALUES (1, 2)")

      tag =
        :crypto.hash(:md5, ctx.stack_id <> req.handle <> "v:2")
        |> Base.encode16(case: :lower)

      assert {req, 200,
              [
                %{
                  "value" => %{"id" => "2", "name" => "Team B"},
                  "headers" => %{"tags" => [^tag], "is_move_in" => true}
                },
                %{"headers" => %{"control" => "snapshot-end"}},
                up_to_date_ctl()
              ]} =
               Task.await(task)

      # And move-out should be propagated
      task = live_shape_req(req, ctx.opts)
      Postgrex.query!(ctx.db_conn, "DELETE FROM members WHERE user_id = 1 AND team_id = 2")

      assert {_, 200,
              [
                %{
                  "headers" => %{
                    "event" => "move-out",
                    "patterns" => [%{"pos" => 0, "value" => ^tag}]
                  }
                },
                _
              ]} =
               Task.await(task)
    end

    @tag with_sql: [
           "CREATE TABLE members (user_id INTEGER, team_id INTEGER, flag BOOLEAN, PRIMARY KEY (user_id, team_id))",
           """
           CREATE TABLE member_details (
             id SERIAL PRIMARY KEY,
             user_id INTEGER,
             team_id INTEGER,
             role TEXT NOT NULL,
             FOREIGN KEY (user_id, team_id) REFERENCES members(user_id, team_id)
           )
           """,
           "INSERT INTO members (user_id, team_id, flag) VALUES (1, 1, TRUE), (2, 2, FALSE)",
           "INSERT INTO member_details (user_id, team_id, role) VALUES (1, 1, 'Member'), (2, 2, 'Member')"
         ]
    test "subqueries can reference composite PKs", ctx do
      orig_req =
        make_shape_req("member_details",
          where: "(user_id, team_id) IN (SELECT user_id, team_id FROM members WHERE flag = TRUE)"
        )

      assert {req, 200, response} = shape_req(orig_req, ctx.opts)
      # Should contain the data record and the snapshot-end control message
      assert length(response) == 2

      assert %{"value" => %{"id" => "1", "role" => "Member"}} =
               Enum.find(response, &Map.has_key?(&1, "key"))

      assert %{"headers" => %{"control" => "snapshot-end"}} =
               Enum.find(response, &(Map.get(&1, "headers", %{})["control"] == "snapshot-end"))

      # Basic update should be visible
      task = live_shape_req(req, ctx.opts)
      Postgrex.query!(ctx.db_conn, "UPDATE member_details SET role = 'Admin' WHERE id = 1")

      assert {req, 200, [%{"value" => %{"id" => "1", "role" => "Admin"}}, _]} =
               Task.await(task)

      # And a move should be visible
      task = live_shape_req(req, ctx.opts)

      Postgrex.query!(
        ctx.db_conn,
        "UPDATE members SET flag = TRUE WHERE (user_id, team_id) = (2, 2)"
      )

      tag =
        :crypto.hash(:md5, ctx.stack_id <> req.handle <> "user_id:v:2" <> "team_id:v:2")
        |> Base.encode16(case: :lower)

      assert {req, 200,
              [
                %{
                  "headers" => %{"tags" => [^tag]},
                  "value" => %{"id" => "2", "role" => "Member"}
                },
                %{"headers" => %{"control" => "snapshot-end"}},
                up_to_date_ctl()
              ]} =
               Task.await(task)

      # And move-out should be propagated
      task = live_shape_req(req, ctx.opts)

      Postgrex.query!(
        ctx.db_conn,
        "UPDATE members SET flag = FALSE WHERE (user_id, team_id) = (2, 2)"
      )

      assert {_, 200,
              [
                %{
                  "headers" => %{
                    "event" => "move-out",
                    "patterns" => [%{"pos" => 0, "value" => ^tag}]
                  }
                },
                _
              ]} =
               Task.await(task)
    end

    @tag with_sql: [
           "CREATE TABLE parent (id INT PRIMARY KEY, value INT NOT NULL, other_value INT NOT NULL)",
           "CREATE TABLE child (id INT PRIMARY KEY, value INT NOT NULL, other_value INT NOT NULL)",
           "INSERT INTO parent (id, value, other_value) VALUES (1, 10, 10), (2, 20, 5)",
           "INSERT INTO child (id, value, other_value) VALUES (1, 10, 10), (2, 10, 5), (3, 20, 20)"
         ]
    test "subqueries work with params", ctx do
      base_req =
        make_shape_req("child",
          where:
            "value in (SELECT value FROM parent WHERE other_value >= $2) AND other_value >= $1",
          params: %{"1" => "10", "2" => "6"}
        )

      assert {req, 200, response} = shape_req(base_req, ctx.opts)
      # Should contain the data record and the snapshot-end control message
      assert length(response) == 2

      assert %{"value" => %{"id" => "1", "value" => "10"}} =
               Enum.find(response, &Map.has_key?(&1, "key"))

      assert %{"headers" => %{"control" => "snapshot-end"}} =
               Enum.find(response, &(Map.get(&1, "headers", %{})["control"] == "snapshot-end"))

      # Basic update should be visible
      task = live_shape_req(req, ctx.opts)
      Postgrex.query!(ctx.db_conn, "UPDATE child SET other_value = 20 WHERE id = 2")

      assert {req, 200, [%{"value" => %{"id" => "2", "other_value" => "20"}}, _]} =
               Task.await(task)

      # Move should be visible
      task = live_shape_req(req, ctx.opts)
      Postgrex.query!(ctx.db_conn, "UPDATE parent SET other_value = 10 WHERE id = 2")

      tag =
        :crypto.hash(:md5, ctx.stack_id <> req.handle <> "v:20")
        |> Base.encode16(case: :lower)

      assert {_, 200,
              [
                %{"headers" => %{"tags" => [^tag]}, "value" => %{"id" => "3"}},
                %{"headers" => %{"control" => "snapshot-end"}},
                up_to_date_ctl()
              ]} =
               Task.await(task)
    end

    @tag with_sql: [
           ~S|CREATE TABLE "Parent" (id INT PRIMARY KEY, "Value" INT NOT NULL, "otherValue" INT NOT NULL)|,
           ~S|CREATE TABLE "Child" (id INT PRIMARY KEY, "Value" INT NOT NULL, "parentId" INT NOT NULL)|,
           ~S|INSERT INTO "Parent" (id, "Value", "otherValue") VALUES (1, 10, 10), (2, 20, 5)|,
           ~S|INSERT INTO "Child" (id, "Value", "parentId") VALUES (1, 10, 1), (2, 10, 2), (3, 20, 2)|
         ]
    test "subqueries work with quoted column names and are tagged correctly", ctx do
      orig_req =
        make_shape_req(~S|"Child"|,
          where:
            ~S|"parentId" in (SELECT "id" FROM "Parent" WHERE "otherValue" >= $2) AND "Value" >= $1|,
          params: %{"1" => "10", "2" => "6"}
        )

      assert {req, 200, response} = shape_req(orig_req, ctx.opts)
      # Should contain the data record and the snapshot-end control message
      assert length(response) == 2

      tag = :crypto.hash(:md5, ctx.stack_id <> req.handle <> "v:1") |> Base.encode16(case: :lower)

      assert %{
               "value" => %{"id" => "1", "parentId" => "1", "Value" => "10"},
               "headers" => %{"tags" => [^tag]}
             } =
               Enum.find(response, &Map.has_key?(&1, "key"))

      assert %{"headers" => %{"control" => "snapshot-end"}} =
               Enum.find(response, &(Map.get(&1, "headers", %{})["control"] == "snapshot-end"))
    end

    @tag with_sql: [
           "CREATE TABLE parent (id INT PRIMARY KEY, value INT NOT NULL)",
           "CREATE TABLE child (id INT PRIMARY KEY, parent_id INT NOT NULL REFERENCES parent(id), value INT NOT NULL)",
           "INSERT INTO parent (id, value) VALUES (1, 1), (2, 2)",
           "INSERT INTO child (id, parent_id, value) VALUES (1, 1, 10), (2, 2, 20)"
         ]
    test "multiple actions result in a correct event sequence", ctx do
      req = make_shape_req("child", where: "parent_id in (SELECT id FROM parent WHERE value = 1)")

      assert {req, 200, [data, _snapshot_end]} = shape_req(req, ctx.opts)

      assert %{
               "value" => %{"id" => "1", "parent_id" => "1", "value" => "10"},
               "headers" => %{"operation" => "insert", "tags" => [tag]}
             } = data

      for stmt <- [
            # Move-out
            "UPDATE parent SET value = 2 WHERE id = 1",
            # Move-in
            "UPDATE parent SET value = 1 WHERE id = 2",
            "UPDATE child SET value = 11 WHERE id = 1",
            "UPDATE child SET value = 12 WHERE id = 2",
            # Move-in again
            "UPDATE parent SET value = 1 WHERE id = 1",
            "UPDATE child SET value = 13 WHERE id = 1"
          ],
          do: Postgrex.query!(ctx.db_conn, stmt)

      Process.sleep(120)

      assert {req, 200,
              [
                %{"headers" => %{"event" => "move-out"}},
                %{
                  "headers" => %{"operation" => "insert", "is_move_in" => true, "tags" => [tag2]},
                  "value" => %{"parent_id" => "2", "value" => "12"}
                },
                %{"headers" => %{"control" => "snapshot-end"}},
                %{
                  "headers" => %{"operation" => "insert", "is_move_in" => true, "tags" => [^tag]},
                  "value" => %{"id" => "1", "parent_id" => "1", "value" => "13"}
                },
                %{"headers" => %{"control" => "snapshot-end"}},
                up_to_date_ctl()
              ]} = shape_req(req, ctx.opts)

      task = live_shape_req(req, ctx.opts)

      # Total move-out
      Postgrex.query!(ctx.db_conn, "UPDATE parent SET value = 2")

      assert {_, 200,
              [
                %{
                  "headers" => %{
                    "event" => "move-out",
                    "patterns" => [
                      %{"pos" => 0, "value" => ^tag},
                      %{"pos" => 0, "value" => ^tag2}
                    ]
                  }
                },
                %{"headers" => %{"control" => "up-to-date"}}
              ]} = Task.await(task)
    end

    @tag with_sql: [
           "CREATE TABLE parent (id INT PRIMARY KEY, value INT NOT NULL)",
           "CREATE TABLE child (id INT PRIMARY KEY, parent_id INT NOT NULL REFERENCES parent(id), value INT NOT NULL)",
           "INSERT INTO parent (id, value) VALUES (1, 1), (2, 2), (3, 3)",
           "INSERT INTO child (id, parent_id, value) VALUES (1, 1, 10), (2, 2, 20), (3, 3, 30)"
         ]
    test "move-in into move-out into move-in of the same parent results in a ", ctx do
      req = make_shape_req("child", where: "parent_id in (SELECT id FROM parent WHERE value = 1)")

      assert {req, 200, [data, _snapshot_end]} = shape_req(req, ctx.opts)

      assert %{
               "value" => %{"id" => "1", "parent_id" => "1", "value" => "10"},
               "headers" => %{"operation" => "insert", "tags" => [_tag]}
             } = data

      for stmt <- [
            # Move-in
            "UPDATE parent SET value = 1 WHERE id = 2",
            # Move-out
            "UPDATE parent SET value = 2 WHERE id = 2",
            # Move-in
            "UPDATE parent SET value = 1 WHERE id = 2 OR id = 3",
            # Move-out
            "UPDATE parent SET value = 2 WHERE id = 2"
          ],
          do: Postgrex.query!(ctx.db_conn, stmt)

      # Hard to wait exactly what we want, so this should be OK
      Process.sleep(1000)

      # We're essentially guaranteed, in this test environment, to see move-out before move-in resolves.
      # It's safe to propagate a move-out even for stuff client hasn't seen (because of hashing in the pattern)
      # as it's just a no-op.
      # So we should see 2 move-outs and a move-in but only for the 3rd parent. The move-in should be filtered despite
      # being triggered for 2 moved in parents initially
      assert {_req, 200,
              [
                %{"headers" => %{"event" => "move-out", "patterns" => p1}},
                %{"headers" => %{"event" => "move-out", "patterns" => p1}},
                %{"headers" => %{"control" => "snapshot-end"}},
                %{
                  "headers" => %{"operation" => "insert", "is_move_in" => true},
                  "value" => %{"id" => "3", "parent_id" => "3", "value" => "30"}
                },
                %{"headers" => %{"control" => "snapshot-end"}},
                up_to_date_ctl()
              ]} = shape_req(req, ctx.opts)
    end

    @tag with_sql: [
           "CREATE TABLE parent (id INT PRIMARY KEY, value INT NOT NULL)",
           "CREATE TABLE child (id INT PRIMARY KEY, parent_id INT NOT NULL REFERENCES parent(id), value INT NOT NULL)"
         ]
    test "move-outs while processing move-ins are handled correctly", ctx do
      req = make_shape_req("child", where: "parent_id in (SELECT id FROM parent WHERE value = 1)")

      assert {req, 200, [%{"headers" => %{"control" => "snapshot-end"}}]} =
               shape_req(req, ctx.opts)

      task = live_shape_req(req, ctx.opts)

      Postgrex.query!(ctx.db_conn, "INSERT INTO parent (id, value) VALUES (1, 1)")
      Postgrex.query!(ctx.db_conn, "INSERT INTO child (id, parent_id, value) VALUES (1, 1, 10)")

      assert {req, 200,
              [
                %{
                  "value" => %{"id" => "1", "parent_id" => "1", "value" => "10"},
                  "headers" => %{"operation" => "insert", "tags" => [tag]}
                },
                %{"headers" => %{"control" => "snapshot-end"}},
                up_to_date_ctl()
              ]} =
               Task.await(task)

      task = live_shape_req(req, ctx.opts)

      Postgrex.query!(ctx.db_conn, "UPDATE parent SET value = 2 WHERE id = 1")

      assert {_req, 200,
              [
                %{
                  "headers" => %{
                    "event" => "move-out",
                    "patterns" => [%{"pos" => 0, "value" => ^tag}]
                  }
                },
                up_to_date_ctl()
              ]} =
               Task.await(task)
    end

    @tag with_sql: [
           "CREATE TABLE projects (id INT PRIMARY KEY, workspace_id INT NOT NULL, name TEXT NOT NULL)",
           "CREATE TABLE workspace_members (workspace_id INT, user_id INT, PRIMARY KEY (workspace_id, user_id))",
           "CREATE TABLE project_members (project_id INT, user_id INT, PRIMARY KEY (project_id, user_id))",
           "INSERT INTO workspace_members (workspace_id, user_id) VALUES (1, 100)",
           "INSERT INTO project_members (project_id, user_id) VALUES (1, 100), (3, 100)",
           "INSERT INTO projects (id, workspace_id, name) VALUES (1, 1, 'project 1'), (2, 1, 'project 2')"
         ]
    test "supports two subqueries at the same level but returns 409 on move-in", %{
      opts: opts,
      db_conn: db_conn
    } do
      where =
        "workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = 100) " <>
          "AND id IN (SELECT project_id FROM project_members WHERE user_id = 100)"

      assert %{status: 200} =
               conn =
               conn("GET", "/v1/shape", %{
                 table: "projects",
                 offset: "-1",
                 where: where
               })
               |> Router.call(opts)

      shape_handle = get_resp_header(conn, "electric-handle")

      task =
        Task.async(fn ->
          conn("GET", "/v1/shape", %{
            table: "projects",
            offset: get_resp_header(conn, "electric-offset"),
            handle: shape_handle,
            where: where,
            live: "true"
          })
          |> Router.call(opts)
        end)

      # Insert a project that satisfies both subqueries - user 100 is already a member of project 3
      # (added in setup) and workspace 1
      Postgrex.query!(
        db_conn,
        "INSERT INTO projects (id, workspace_id, name) VALUES (3, 1, 'project 3')",
        []
      )

      assert %{status: 200} = conn = Task.await(task)

      assert [
               %{
                 "headers" => %{"operation" => "insert"},
                 "value" => %{"id" => "3", "workspace_id" => "1", "name" => "project 3"}
               },
               _
             ] = Jason.decode!(conn.resp_body)

      task =
        Task.async(fn ->
          conn("GET", "/v1/shape", %{
            table: "projects",
            offset: get_resp_header(conn, "electric-offset"),
            handle: shape_handle,
            where: where,
            live: "true"
          })
          |> Router.call(opts)
        end)

      # Cause a move-in by adding user 100 to project 2's project_members
      Postgrex.query!(
        db_conn,
        "INSERT INTO project_members (project_id, user_id) VALUES (2, 100)",
        []
      )

      # Should get a 409 because multiple same-level subqueries cannot currently correctly handle move-ins
      assert %{status: 409} = Task.await(task)
    end
  end

  describe "/v1/shapes - subset snapshots" do
    setup [:with_unique_db, :with_basic_tables, :with_sql_execute]

    setup :with_complete_stack

    setup(ctx) do
      :ok = Electric.StatusMonitor.wait_until_active(ctx.stack_id, timeout: 1000)
      %{opts: Router.init(build_router_opts(ctx))}
    end

    @tag with_sql: [
           "INSERT INTO items VALUES (gen_random_uuid(), 'test value 1')"
         ]
    test "GET with log=changes_only doesn't return any data initial but lets all updates through",
         ctx do
      req = make_shape_req("items", log: "changes_only")

      assert {req, 200, [%{"headers" => %{"control" => "snapshot-end"}}]} =
               shape_req(req, ctx.opts)

      task = live_shape_req(req, ctx.opts)

      Postgrex.query!(ctx.db_conn, "UPDATE items SET value = 'test value 2'")

      assert {_, 200, [%{"value" => %{"id" => _, "value" => "test value 2"}}, _]} =
               Task.await(task)
    end

    @tag with_sql: [
           "INSERT INTO items VALUES (gen_random_uuid(), 'test value 1')"
         ]
    test "GET with any parameter mentioning a subset returns a subset snapshot", ctx do
      req = make_shape_req("items", log: "changes_only")

      assert {_, 200,
              %{
                "metadata" => %{
                  "xmin" => _,
                  "xmax" => _,
                  "xip_list" => _,
                  "snapshot_mark" => mark,
                  "database_lsn" => _
                },
                "data" => [
                  %{
                    "value" => %{"id" => _, "value" => "test value 1"},
                    "headers" => %{"operation" => "insert", "snapshot_mark" => mark}
                  }
                ]
              }} = shape_req(req, ctx.opts, subset: %{})
    end

    @tag with_sql: [
           "INSERT INTO items VALUES (gen_random_uuid(), 'test value 1')",
           "INSERT INTO items VALUES (gen_random_uuid(), 'test value 2')"
         ]
    test "subsets can be filtered", ctx do
      req = make_shape_req("items", log: "changes_only")

      assert {_, 200,
              %{
                "metadata" => _,
                "data" => [
                  %{
                    "value" => %{"id" => _, "value" => "test value 2"}
                  }
                ]
              }} =
               shape_req(req, ctx.opts,
                 subset: %{where: "value ILIKE $1", params: %{"1" => "%2"}}
               )
    end

    @tag with_sql: [
           "INSERT INTO items VALUES (gen_random_uuid(), 'test value 1')",
           "INSERT INTO items VALUES (gen_random_uuid(), 'test value 2')"
         ]
    test "subsets can be sorted and limited", ctx do
      req = make_shape_req("items", log: "changes_only")

      assert {_, 400, %{"errors" => %{"subset" => %{"order_by" => _}}}} =
               shape_req(req, ctx.opts, subset: %{limit: 1})

      assert {_, 200,
              %{
                "metadata" => _,
                "data" => [
                  %{
                    "value" => %{"id" => _, "value" => "test value 1"}
                  }
                ]
              }} =
               shape_req(req, ctx.opts, subset: %{limit: 1, order_by: "value ASC"})

      assert {_, 200,
              %{
                "metadata" => _,
                "data" => [
                  %{
                    "value" => %{"id" => _, "value" => "test value 2"}
                  }
                ]
              }} =
               shape_req(req, ctx.opts, subset: %{limit: 1, order_by: "value DESC"})
    end

    @tag with_sql: [
           "CREATE TYPE my_enum AS ENUM ('value1', 'value2', 'value3')",
           "CREATE TABLE enum_table (id UUID PRIMARY KEY, status my_enum NOT NULL)",
           "INSERT INTO enum_table VALUES (gen_random_uuid(), 'value1')",
           "INSERT INTO enum_table VALUES (gen_random_uuid(), 'value2')"
         ]
    test "subsets can filter by enum values", ctx do
      req = make_shape_req("enum_table", log: "changes_only")

      assert {_, 200,
              %{
                "metadata" => _,
                "data" => [
                  %{
                    "value" => %{"id" => _, "status" => "value1"}
                  }
                ]
              }} =
               shape_req(req, ctx.opts,
                 subset: %{where: "status = $1", params: %{"1" => "value1"}}
               )
    end

    @tag with_sql: [
           "CREATE TYPE my_enum AS ENUM ('value1', 'value2', 'value3')",
           "CREATE TABLE enum_table (id UUID PRIMARY KEY, status my_enum NOT NULL)",
           "INSERT INTO enum_table VALUES (gen_random_uuid(), 'value1')"
         ]
    test "subsets return 400 for invalid enum values", ctx do
      req = make_shape_req("enum_table", log: "changes_only")

      assert {_, 400, %{"errors" => %{"subset" => %{"where" => message}}}} =
               shape_req(req, ctx.opts, subset: %{where: "status = 'invalid_value'"})

      assert message =~ "invalid_value"
    end

    @tag with_sql: [
           "CREATE TYPE my_enum AS ENUM ('value1', 'value2', 'value3')",
           "CREATE TABLE enum_table (id UUID PRIMARY KEY, status my_enum NOT NULL)",
           "INSERT INTO enum_table VALUES (gen_random_uuid(), 'value1')",
           "INSERT INTO enum_table VALUES (gen_random_uuid(), 'value2')"
         ]
    test "subsets can filter by enum values using IN", ctx do
      req = make_shape_req("enum_table", log: "changes_only")

      assert {_, 200,
              %{
                "metadata" => _,
                "data" => [
                  %{
                    "value" => %{"id" => _, "status" => "value1"}
                  }
                ]
              }} =
               shape_req(req, ctx.opts, subset: %{where: "status IN ('value1', 'value3')"})
    end

    @tag with_sql: [
           "CREATE TYPE my_enum AS ENUM ('value1', 'value2', 'value3')",
           "CREATE TABLE enum_table (id UUID PRIMARY KEY, status my_enum NOT NULL)",
           "INSERT INTO enum_table VALUES (gen_random_uuid(), 'value1')"
         ]
    test "subsets return 400 for invalid enum values in IN clause", ctx do
      req = make_shape_req("enum_table", log: "changes_only")

      assert {_, 400, %{"errors" => %{"subset" => %{"where" => message}}}} =
               shape_req(req, ctx.opts,
                 subset: %{where: "status = ANY($1)", params: %{"1" => "{invalid_value}"}}
               )

      assert message =~ "invalid_value"
    end

    @tag with_sql: [
           "INSERT INTO items VALUES (gen_random_uuid(), 'test value 1')"
         ]
    test "subsets can filter with explicit type cast on parameter", ctx do
      req = make_shape_req("items", log: "changes_only")

      # Explicit casts on parameters (e.g. $1::text) must preserve param_ref
      # metadata so the parameter can be resolved during query rebuilding
      assert {_, 200,
              %{
                "metadata" => _,
                "data" => [
                  %{
                    "value" => %{"id" => _, "value" => "test value 1"}
                  }
                ]
              }} =
               shape_req(req, ctx.opts,
                 subset: %{where: "value = $1::text", params: %{"1" => "test value 1"}}
               )
    end

    test "GET requests aren't cached", ctx do
      req = make_shape_req("items", log: "changes_only", subset: %{}, offset: "-1")

      result =
        conn("GET", "/v1/shape", req)
        |> Router.call(ctx.opts)

      assert %{status: 200} = result

      assert Plug.Conn.get_resp_header(result, "cache-control") == ["no-cache"]
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

    setup(ctx) do
      :ok = Electric.StatusMonitor.wait_until_active(ctx.stack_id, timeout: 1000)

      %{
        api_opts:
          Electric.Shapes.Api.plug_opts(
            stack_id: ctx.stack_id,
            pg_id: "12345",
            stack_events_registry: Electric.stack_events_registry(),
            stack_ready_timeout: Access.get(ctx, :stack_ready_timeout, 100),
            shape_cache: {Mock.ShapeCache, []},
            storage: {Electric.ShapeCache.Storage.PureFileStorage, []},
            inspector: {__MODULE__, []},
            registry: Registry.ServeShapePlugTest,
            long_poll_timeout: 20_000,
            max_age: 60,
            stale_age: 300,
            persistent_kv: ctx.persistent_kv,
            allow_shape_deletion: true
          )
      }
    end

    test "allows access to / without secret", %{secret: secret} do
      assert %{status: 200} = Router.call(conn("GET", "/"), secret: secret)
    end

    test "allows access to /nonexistent without secret", %{secret: secret} do
      assert %{status: 404} = Router.call(conn("GET", "/nonexistent"), secret: secret)
    end

    test "allows access to /v1/health without secret", %{opts: opts} do
      assert %{status: 200} = Router.call(conn("GET", "/v1/health"), opts)
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
               Router.call(conn("GET", "/v1/shape?secret=wrong_secret"), secret: secret)

      # Correct secret
      assert %{status: 400} =
               Router.call(
                 conn("GET", "/v1/shape?secret=#{secret}"),
                 Keyword.merge([secret: secret], api_opts)
               )
    end

    test "also supports old api_secret parameter", %{secret: secret, api_opts: api_opts} do
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
               Router.call(conn("DELETE", "/v1/shape?secret=wrong_secret"), secret: secret)

      # Correct secret
      assert %{status: 400} =
               Router.call(
                 conn("DELETE", "/v1/shape?secret=#{secret}"),
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

  defp make_shape_req(table, opts \\ []) do
    opts
    |> Map.new()
    |> Map.put(:table, table)
  end

  defp shape_req(orig_base, router_opts, opts \\ []) do
    base =
      orig_base
      |> Map.put_new(:offset, "-1")
      |> Map.put_new(:live, false)
      |> Map.merge(Map.new(opts))

    result =
      conn("GET", "/v1/shape", base)
      |> Router.call(router_opts)

    case {result.status, Plug.Conn.get_resp_header(result, "electric-snapshot")} do
      {200, ["true"]} ->
        base
        |> Map.put(:handle, get_resp_shape_handle(result))
        |> then(&{&1, result.status, Jason.decode!(result.resp_body)})

      {200, _} ->
        base
        |> Map.put(:handle, get_resp_shape_handle(result))
        |> Map.put(:offset, get_resp_last_offset(result))
        |> then(&{&1, result.status, Jason.decode!(result.resp_body)})

      _ ->
        {base, result.status, Jason.decode!(result.resp_body)}
    end
  end

  defp live_shape_req(base, router_opts, opts \\ []) do
    Task.async(fn ->
      shape_req(base |> Map.put(:live, true), router_opts, opts)
    end)
  end
end
