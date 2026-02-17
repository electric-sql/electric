defmodule Electric.Plug.ServeShapePlugTest do
  use ExUnit.Case, async: true
  use Repatch.ExUnit, assert_expectations: true

  import Plug.Conn

  alias Electric.Postgres.Lsn
  alias Electric.Replication.LogOffset
  alias Electric.Plug.ServeShapePlug
  alias Electric.Shapes.Api
  alias Electric.Shapes.Shape

  import Support.ComponentSetup

  import Support.TestUtils,
    only: [
      set_status_to_active: 1,
      patch_shape_cache: 1,
      expect_shape_cache: 1,
      patch_storage: 1,
      patch_storage: 2,
      expect_storage: 1
    ]

  @inspector Support.StubInspector.new(
               tables: ["users"],
               columns: [
                 %{name: "id", type: "int8", pk_position: 0, type_id: {20, 1}},
                 %{name: "value", type: "text", pk_position: nil, type_id: {28, 1}}
               ]
             )

  @test_shape %Shape{
    root_table: {"public", "users"},
    root_table_id: :erlang.phash2({"public", "users"}),
    root_column_count: 2,
    root_pk: ["id"],
    selected_columns: ["id", "value"],
    explicitly_selected_columns: ["id", "value"],
    flags: %{selects_all_columns: true}
  }
  @test_shape_handle "test-shape-handle"
  @test_opts %{foo: "bar"}
  @before_all_offset LogOffset.before_all()
  @first_offset LogOffset.first()
  @test_offset LogOffset.new(Lsn.from_integer(100), 0)
  @start_offset_50 LogOffset.new(Lsn.from_integer(50), 0)

  # Higher timeout is needed for some tests that tend to run slower on CI.
  @receive_timeout 2000

  @moduletag :tmp_dir

  setup [
    :with_stack_id_from_test,
    :with_registry,
    :with_persistent_kv,
    :with_pure_file_storage,
    :with_status_monitor,
    :with_shape_cleaner
  ]

  def conn(_ctx, method, params, "?" <> _ = query_string) do
    Plug.Test.conn(method, "/" <> query_string, params)
  end

  def call_serve_shape_plug(conn, ctx) do
    opts =
      Api.plug_opts(
        stack_id: ctx.stack_id,
        inspector: @inspector,
        stack_ready_timeout: Access.get(ctx, :stack_ready_timeout, 100),
        long_poll_timeout: long_poll_timeout(ctx),
        sse_timeout: sse_timeout(ctx),
        max_age: max_age(ctx),
        stale_age: stale_age(ctx),
        max_concurrent_requests: %{initial: 300, existing: 10_000}
      )

    ServeShapePlug.call(conn, opts)
  end

  describe "serving shape" do
    setup :with_lsn_tracker

    setup ctx do
      {:via, _, {registry_name, registry_key}} =
        Electric.Shapes.Supervisor.name(ctx.stack_id)

      {:ok, _} = Registry.register(registry_name, registry_key, nil)
      set_status_to_active(ctx)

      patch_storage(for_shape: fn @test_shape_handle, _opts -> @test_opts end)

      :ok
    end

    test "returns 400 for invalid table", ctx do
      conn =
        ctx
        |> conn(:get, %{"table" => ".invalid_shape"}, "?offset=-1")
        |> call_serve_shape_plug(ctx)

      assert conn.status == 400

      assert Jason.decode!(conn.resp_body) == %{
               "message" => "Invalid request",
               "errors" => %{
                 "table" => [
                   "Invalid zero-length delimited identifier"
                 ]
               }
             }

      assert get_resp_header(conn, "electric-has-data") == []
    end

    test "returns 400 for invalid offset", ctx do
      conn =
        ctx
        |> conn(:get, %{"table" => "foo"}, "?offset=invalid")
        |> call_serve_shape_plug(ctx)

      assert conn.status == 400

      assert Jason.decode!(conn.resp_body) == %{
               "message" => "Invalid request",
               "errors" => %{
                 "offset" => ["has invalid format"]
               }
             }
    end

    test "returns 400 when table param is missing", ctx do
      conn =
        ctx
        |> conn(:get, %{}, "?offset=-1")
        |> call_serve_shape_plug(ctx)

      assert conn.status == 400

      assert %{
               "message" => "Invalid request",
               "errors" => %{
                 "table" => ["can't be blank"]
               }
             } = Jason.decode!(conn.resp_body)
    end

    test "returns 400 when table does not exist", ctx do
      # this will pass table name validation
      # but will fail to find the table
      conn =
        ctx
        |> conn(:get, %{"table" => "_val1d_schëmaΦ$.Φtàble"}, "?offset=-1")
        |> call_serve_shape_plug(ctx)

      assert conn.status == 400

      assert Jason.decode!(conn.resp_body) == %{
               "message" => "Invalid request",
               "errors" => %{
                 "table" => [
                   "Table \"_val1d_schëmaΦ$\".\"Φtàble\" does not exist. If the table name contains capitals or special characters you must quote it."
                 ]
               }
             }
    end

    test "returns 400 for missing shape_handle when offset != -1", ctx do
      conn =
        ctx
        |> conn(:get, %{"table" => "public.users"}, "?offset=#{LogOffset.first()}")
        |> call_serve_shape_plug(ctx)

      assert conn.status == 400

      assert Jason.decode!(conn.resp_body) == %{
               "message" => "Invalid request",
               "errors" => %{
                 "handle" => ["can't be blank when offset != -1"]
               }
             }
    end

    @tag long_poll_timeout: 100
    test "returns 400 when offset is out of bounds after a timeout", ctx do
      out_of_bounds_offset = LogOffset.increment(@test_offset)

      patch_shape_cache(
        resolve_shape_handle: fn @test_shape_handle, @test_shape, _stack_id ->
          {@test_shape_handle, @test_offset}
        end
      )

      conn =
        ctx
        |> conn(
          :get,
          %{"table" => "public.users"},
          "?handle=#{@test_shape_handle}&offset=#{out_of_bounds_offset}"
        )
        |> call_serve_shape_plug(ctx)

      assert conn.status == 400

      assert Jason.decode!(conn.resp_body) == %{
               "message" => "Invalid request",
               "errors" => %{
                 "offset" => ["out of bounds for this shape"]
               }
             }
    end

    test "returns 400 for live request when offset == -1", ctx do
      conn =
        ctx
        |> conn(
          :get,
          %{"table" => "public.users"},
          "?offset=#{LogOffset.before_all()}&live=true"
        )
        |> call_serve_shape_plug(ctx)

      assert conn.status == 400

      assert Jason.decode!(conn.resp_body) == %{
               "message" => "Invalid request",
               "errors" => %{
                 "live" => ["can't be true when offset == -1"]
               }
             }
    end

    test "returns snapshot when offset is -1", ctx do
      expect_shape_cache(
        get_or_create_shape_handle: fn @test_shape, _stack_id, _opts ->
          {@test_shape_handle, @test_offset}
        end,
        await_snapshot_start: fn @test_shape_handle, _ -> :started end
      )

      patch_shape_cache(has_shape?: fn @test_shape_handle, _opts -> true end)

      next_offset = LogOffset.increment(@first_offset)

      expect_storage(
        get_chunk_end_log_offset: fn @before_all_offset, _ ->
          @first_offset
        end,
        get_log_stream: fn @before_all_offset, @first_offset, @test_opts ->
          [Jason.encode!(%{key: "log", value: "foo", headers: %{}, offset: next_offset})]
        end
      )

      conn =
        ctx
        |> conn(:get, %{"table" => "public.users"}, "?offset=-1")
        |> call_serve_shape_plug(ctx)

      assert conn.status == 200

      assert Jason.decode!(conn.resp_body) == [
               %{
                 "key" => "log",
                 "value" => "foo",
                 "headers" => %{},
                 "offset" => "#{next_offset}"
               }
             ]

      assert get_resp_header(conn, "etag") == [
               ~s|"#{@test_shape_handle}:-1:#{@first_offset}"|
             ]

      assert get_resp_header(conn, "electric-handle") == [@test_shape_handle]
    end

    test "snapshot has correct cache control headers", ctx do
      expect_shape_cache(
        get_or_create_shape_handle: fn @test_shape, _stack_id, _opts ->
          {@test_shape_handle, @test_offset}
        end,
        await_snapshot_start: fn @test_shape_handle, _ -> :started end
      )

      patch_shape_cache(has_shape?: fn @test_shape_handle, _opts -> true end)

      next_offset = LogOffset.increment(@first_offset)

      expect_storage(
        get_chunk_end_log_offset: fn @before_all_offset, _ ->
          next_offset
        end,
        get_log_stream: fn @before_all_offset, _, @test_opts ->
          [Jason.encode!(%{key: "log", value: "foo", headers: %{}, offset: next_offset})]
        end
      )

      max_age = 62
      stale_age = 312

      ctx =
        ctx
        |> Map.put(:max_age, max_age)
        |> Map.put(:stale_age, stale_age)

      conn =
        ctx
        |> conn(:get, %{"table" => "public.users"}, "?offset=-1")
        |> call_serve_shape_plug(ctx)

      assert conn.status == 200

      assert get_resp_header(conn, "cache-control") == [
               "public, max-age=604800, s-maxage=3600, stale-while-revalidate=2629746"
             ]
    end

    test "sets correct CORS headers for Access-Control-Expose-Headers", ctx do
      expect_shape_cache(
        get_or_create_shape_handle: fn @test_shape, _stack_id, _opts ->
          {@test_shape_handle, @test_offset}
        end,
        await_snapshot_start: fn @test_shape_handle, _ -> :started end
      )

      patch_shape_cache(has_shape?: fn @test_shape_handle, _opts -> true end)

      expect_storage(
        get_chunk_end_log_offset: fn @before_all_offset, _ ->
          @first_offset
        end,
        get_log_stream: fn @before_all_offset, _, @test_opts ->
          []
        end
      )

      conn =
        ctx
        |> conn(:get, %{"table" => "public.users"}, "?offset=-1")
        # Apply the CORS headers manually since we're not going through the router
        |> Electric.Plug.Router.put_cors_headers([])
        |> call_serve_shape_plug(ctx)

      # Verify that all Electric headers are included in the response
      assert [expose_header] = get_resp_header(conn, "access-control-expose-headers")
      exposed_headers_in_response = String.split(expose_header, ",")

      assert Enum.sort(exposed_headers_in_response) ==
               Enum.sort(Electric.Shapes.Api.Response.electric_headers())
    end

    test "invalid response specifies it should not be cached", ctx do
      conn =
        ctx
        |> conn(:get, %{"table" => "public.users"}, "?offset=bababa")
        |> call_serve_shape_plug(ctx)

      assert conn.status == 400
      assert get_resp_header(conn, "cache-control") == ["no-store"]
    end

    test "response has correct schema header", ctx do
      expect_shape_cache(
        get_or_create_shape_handle: fn @test_shape, _stack_id, _opts ->
          {@test_shape_handle, @test_offset}
        end,
        await_snapshot_start: fn @test_shape_handle, _ -> :started end
      )

      patch_shape_cache(has_shape?: fn @test_shape_handle, _opts -> true end)

      next_offset = LogOffset.increment(@first_offset)

      expect_storage(
        get_chunk_end_log_offset: fn @before_all_offset, _ ->
          next_offset
        end,
        get_log_stream: fn @before_all_offset, _, @test_opts ->
          [Jason.encode!(%{key: "log", value: "foo", headers: %{}, offset: next_offset})]
        end
      )

      conn =
        ctx
        |> conn(:get, %{"table" => "public.users"}, "?offset=-1")
        |> call_serve_shape_plug(ctx)

      assert get_resp_header(conn, "electric-schema") == [
               ~s|{"id":{"type":"int8","pk_index":0},"value":{"type":"text"}}|
             ]
    end

    test "returns log when offset is >= 0", ctx do
      patch_shape_cache(
        resolve_shape_handle: fn @test_shape_handle, @test_shape, _stack_id ->
          {@test_shape_handle, @test_offset}
        end,
        has_shape?: fn @test_shape_handle, _opts -> true end,
        await_snapshot_start: fn @test_shape_handle, _ -> :started end
      )

      next_offset = LogOffset.increment(@start_offset_50)
      next_next_offset = LogOffset.increment(next_offset)

      expect_storage(
        get_chunk_end_log_offset: fn @start_offset_50, _ ->
          next_next_offset
        end,
        get_log_stream: fn @start_offset_50, _, @test_opts ->
          [
            Jason.encode!(%{key: "log1", value: "foo", headers: %{}, offset: next_offset}),
            Jason.encode!(%{key: "log2", value: "bar", headers: %{}, offset: next_next_offset})
          ]
        end
      )

      conn =
        ctx
        |> conn(
          :get,
          %{"table" => "public.users"},
          "?offset=#{@start_offset_50}&handle=#{@test_shape_handle}"
        )
        |> call_serve_shape_plug(ctx)

      assert conn.status == 200

      assert Jason.decode!(conn.resp_body) == [
               %{
                 "key" => "log1",
                 "value" => "foo",
                 "headers" => %{},
                 "offset" => "#{next_offset}"
               },
               %{
                 "key" => "log2",
                 "value" => "bar",
                 "headers" => %{},
                 "offset" => "#{next_next_offset}"
               }
             ]

      assert get_resp_header(conn, "etag") == [
               ~s|"#{@test_shape_handle}:#{@start_offset_50}:#{next_next_offset}"|
             ]

      assert get_resp_header(conn, "electric-handle") == [@test_shape_handle]

      assert get_resp_header(conn, "electric-offset") == [
               "#{next_next_offset}"
             ]

      assert get_resp_header(conn, "electric-up-to-date") == []
      assert get_resp_header(conn, "electric-has-data") == ["true"]
    end

    test "returns 304 Not Modified when If-None-Match matches ETag",
         ctx do
      patch_shape_cache(
        resolve_shape_handle: fn @test_shape_handle, @test_shape, _stack_id ->
          {@test_shape_handle, @test_offset}
        end,
        has_shape?: fn @test_shape_handle, _opts -> true end
      )

      expect_storage(
        get_chunk_end_log_offset: fn @start_offset_50, _ ->
          @test_offset
        end
      )

      conn = get_shape_with_etag(ctx, @start_offset_50)
      assert conn.status == 304
      assert conn.resp_body == ""
    end

    test "the 304 response includes caching headers that are appropriate for the offset", ctx do
      patch_shape_cache(
        has_shape?: fn @test_shape_handle, _opts -> true end,
        get_or_create_shape_handle: fn @test_shape, _stack_id, _opts ->
          {@test_shape_handle, @test_offset}
        end,
        resolve_shape_handle: fn @test_shape_handle, @test_shape, _stack_id ->
          {@test_shape_handle, @test_offset}
        end
      )

      expect_storage(
        get_chunk_end_log_offset: fn @before_all_offset, _ -> @test_offset end,
        get_chunk_end_log_offset: {fn @start_offset_50, _ -> @test_offset end, exactly: 2}
      )

      conn = get_shape_with_etag(ctx, @before_all_offset)
      assert conn.status == 304
      cache_control = "public, max-age=604800, s-maxage=3600, stale-while-revalidate=2629746"
      assert {"cache-control", cache_control} in conn.resp_headers

      conn = get_shape_with_etag(ctx, @start_offset_50)
      assert conn.status == 304
      cache_control = "public, max-age=#{max_age(ctx)}, stale-while-revalidate=#{stale_age(ctx)}"
      assert {"cache-control", cache_control} in conn.resp_headers

      conn = get_shape_with_etag(ctx, @start_offset_50, live: true)
      assert conn.status == 304

      cache_control = "public, max-age=5, stale-while-revalidate=5"
      assert {"cache-control", cache_control} in conn.resp_headers

      expected_cursor =
        Electric.Plug.Utils.get_next_interval_timestamp(long_poll_timeout(ctx), nil)
        |> to_string()

      assert {"electric-cursor", expected_cursor} in conn.resp_headers
    end

    test "handles live updates", ctx do
      patch_shape_cache(
        resolve_shape_handle: fn @test_shape_handle, @test_shape, _stack_id ->
          {@test_shape_handle, @test_offset}
        end,
        has_shape?: fn @test_shape_handle, _opts -> true end,
        await_snapshot_start: fn @test_shape_handle, _ -> :started end
      )

      test_pid = self()
      next_offset = LogOffset.increment(@test_offset)
      next_offset_str = "#{next_offset}"

      expect_storage(
        get_chunk_end_log_offset: fn @test_offset, _ -> nil end,
        get_log_stream: fn @test_offset, @test_offset, @test_opts ->
          send(test_pid, :got_log_stream)
          []
        end,
        get_chunk_end_log_offset: fn @test_offset, _ -> nil end,
        get_log_stream: fn @test_offset, ^next_offset, @test_opts ->
          [Jason.encode!("test result")]
        end
      )

      task =
        Task.async(fn ->
          ctx
          |> conn(
            :get,
            %{"table" => "public.users"},
            "?offset=#{@test_offset}&handle=#{@test_shape_handle}&live=true"
          )
          |> call_serve_shape_plug(ctx)
        end)

      assert_receive :got_log_stream, @receive_timeout

      # Simulate new changes arriving
      Registry.dispatch(ctx.registry, @test_shape_handle, fn [{pid, ref}] ->
        send(pid, {ref, :new_changes, next_offset})
      end)

      # The conn process should exit after sending the response
      conn = Task.await(task)

      assert conn.status == 200

      assert Jason.decode!(conn.resp_body) == [
               "test result",
               %{
                 "headers" => %{
                   "control" => "up-to-date",
                   "global_last_seen_lsn" => to_string(next_offset.tx_offset)
                 }
               }
             ]

      assert get_resp_header(conn, "cache-control") == [
               "public, max-age=5, stale-while-revalidate=5"
             ]

      assert get_resp_header(conn, "electric-offset") == [next_offset_str]
      assert get_resp_header(conn, "electric-up-to-date") == [""]
      assert get_resp_header(conn, "electric-has-data") == ["true"]
      assert get_resp_header(conn, "electric-schema") == []

      expected_cursor =
        Electric.Plug.Utils.get_next_interval_timestamp(long_poll_timeout(ctx), nil)
        |> to_string()

      assert {"electric-cursor", expected_cursor} in conn.resp_headers
    end

    test "handles shape rotation", ctx do
      patch_shape_cache(
        resolve_shape_handle: fn @test_shape_handle, @test_shape, _stack_id ->
          {@test_shape_handle, @test_offset}
        end,
        has_shape?: fn @test_shape_handle, _opts -> true end,
        await_snapshot_start: fn @test_shape_handle, _ -> :started end
      )

      test_pid = self()

      expect_storage(
        get_chunk_end_log_offset: fn @test_offset, _ ->
          nil
        end,
        get_log_stream: fn @test_offset, _, @test_opts ->
          send(test_pid, :got_log_stream)
          []
        end
      )

      task =
        Task.async(fn ->
          ctx
          |> conn(
            :get,
            %{"table" => "public.users"},
            "?offset=#{@test_offset}&handle=#{@test_shape_handle}&live=true"
          )
          |> call_serve_shape_plug(ctx)
        end)

      assert_receive :got_log_stream, @receive_timeout

      # Simulate shape rotation
      Registry.dispatch(ctx.registry, @test_shape_handle, fn [{pid, ref}] ->
        send(pid, {ref, :shape_rotation})
      end)

      conn = Task.await(task)

      # The conn process should exit after sending the response
      refute Process.alive?(conn.owner)

      assert conn.status == 409
      assert [%{"headers" => %{"control" => "must-refetch"}}] = Jason.decode!(conn.resp_body)
    end

    test "sends an up-to-date response after a timeout if no changes are observed",
         ctx do
      patch_shape_cache(
        resolve_shape_handle: fn @test_shape_handle, @test_shape, _stack_id ->
          {@test_shape_handle, @test_offset}
        end,
        has_shape?: fn @test_shape_handle, _opts -> true end,
        await_snapshot_start: fn @test_shape_handle, _ -> :started end
      )

      expect_storage(
        get_chunk_end_log_offset: fn @test_offset, _ -> nil end,
        get_log_stream: fn @test_offset, _, @test_opts -> [] end
      )

      ctx = Map.put(ctx, :long_poll_timeout, 100)

      conn =
        ctx
        |> conn(
          :get,
          %{"table" => "public.users"},
          "?offset=#{@test_offset}&handle=#{@test_shape_handle}&live=true"
        )
        |> call_serve_shape_plug(ctx)

      assert conn.status == 200

      assert [%{"headers" => %{"control" => "up-to-date"}}] = Jason.decode!(conn.resp_body)

      assert get_resp_header(conn, "cache-control") == [
               "public, max-age=5, stale-while-revalidate=5"
             ]

      expected_etag_part = "\"#{@test_shape_handle}:#{@test_offset}:#{@test_offset}:"
      assert [^expected_etag_part <> _rest] = get_resp_header(conn, "etag")

      assert get_resp_header(conn, "electric-up-to-date") == [""]
      assert get_resp_header(conn, "electric-has-data") == ["false"]
    end

    test "returns electric-has-data: false for offset=now requests", ctx do
      patch_shape_cache(
        get_or_create_shape_handle: fn @test_shape, _stack_id, _opts ->
          {@test_shape_handle, @test_offset}
        end
      )

      conn =
        ctx
        |> conn(
          :get,
          %{"table" => "public.users"},
          "?offset=now&handle=#{@test_shape_handle}"
        )
        |> call_serve_shape_plug(ctx)

      assert conn.status == 200
      assert get_resp_header(conn, "electric-has-data") == ["false"]
      assert get_resp_header(conn, "electric-up-to-date") == [""]
    end

    test "sends 409 with a redirect to existing shape when requested shape handle does not exist",
         ctx do
      patch_shape_cache(
        resolve_shape_handle: fn "foo", @test_shape, _stack_id -> nil end,
        fetch_handle_by_shape: fn @test_shape, _opts -> {:ok, @test_shape_handle} end,
        has_shape?: fn "foo", _opts -> false end
      )

      patch_storage(fetch_latest_offset: fn _ -> {:ok, LogOffset.last_before_real_offsets()} end)

      conn =
        ctx
        |> conn(
          :get,
          %{"table" => "public.users"},
          "?offset=#{"50_12"}&handle=foo"
        )
        |> call_serve_shape_plug(ctx)

      assert conn.status == 409

      assert Jason.decode!(conn.resp_body) == [%{"headers" => %{"control" => "must-refetch"}}]
      assert get_resp_header(conn, "electric-handle") == [@test_shape_handle]
      assert get_resp_header(conn, "cache-control") == ["public, max-age=60, must-revalidate"]
    end

    test "creates a new shape when shape handle does not exist and sends a 409 redirecting to the newly created shape",
         ctx do
      new_shape_handle = "new-shape-handle"

      patch_shape_cache(has_shape?: fn @test_shape_handle, _opts -> false end)

      expect_shape_cache(
        resolve_shape_handle: fn @test_shape_handle, @test_shape, _stack_id ->
          nil
        end,
        get_or_create_shape_handle: fn @test_shape, _stack_id, _opts ->
          {new_shape_handle, @test_offset}
        end
      )

      conn =
        ctx
        |> conn(
          :get,
          %{"table" => "public.users"},
          "?offset=#{"50_12"}&handle=#{@test_shape_handle}"
        )
        |> call_serve_shape_plug(ctx)

      assert conn.status == 409

      assert Jason.decode!(conn.resp_body) == [%{"headers" => %{"control" => "must-refetch"}}]
      assert get_resp_header(conn, "electric-handle") == [new_shape_handle]
    end

    test "sends 409 when shape handle does not match shape definition",
         ctx do
      new_shape_handle = "new-shape-handle"

      expect_shape_cache(
        resolve_shape_handle: fn @test_shape_handle, @test_shape, _stack_id ->
          nil
        end,
        get_or_create_shape_handle: fn @test_shape, _stack_id, _opts ->
          {new_shape_handle, @test_offset}
        end
      )

      conn =
        ctx
        |> conn(
          :get,
          %{"table" => "public.users"},
          "?offset=#{"50_12"}&handle=#{@test_shape_handle}"
        )
        |> call_serve_shape_plug(ctx)

      assert conn.status == 409
      assert get_resp_header(conn, "cache-control") == ["public, max-age=60, must-revalidate"]

      assert Jason.decode!(conn.resp_body) == [%{"headers" => %{"control" => "must-refetch"}}]
      assert get_resp_header(conn, "electric-handle") == [new_shape_handle]
    end

    test "sends 400 when omitting primary key columns in selection", ctx do
      conn =
        ctx
        |> conn(:get, %{"table" => "public.users", "columns" => "value"}, "?offset=-1")
        |> call_serve_shape_plug(ctx)

      assert conn.status == 400

      assert Jason.decode!(conn.resp_body) == %{
               "message" => "Invalid request",
               "errors" => %{
                 "columns" => [
                   "The list of columns must include all primary key columns, missing: id"
                 ]
               }
             }
    end

    test "sends 400 when selecting invalid columns", ctx do
      conn =
        ctx
        |> conn(:get, %{"table" => "public.users", "columns" => "id,invalid"}, "?offset=-1")
        |> call_serve_shape_plug(ctx)

      assert conn.status == 400

      assert Jason.decode!(conn.resp_body) == %{
               "message" => "Invalid request",
               "errors" => %{
                 "columns" => ["The following columns are not found on the table: invalid"]
               }
             }
    end

    test "honours replica query param for shape", ctx do
      test_shape_handle = "test-shape-without-deltas"
      next_offset = LogOffset.increment(@first_offset)

      patch_shape_cache(has_shape?: fn ^test_shape_handle, _opts -> true end)

      expect_shape_cache(
        get_or_create_shape_handle: fn %{root_table: {"public", "users"}, replica: :full},
                                       _stack_id,
                                       _opts ->
          {test_shape_handle, @test_offset}
        end,
        await_snapshot_start: fn ^test_shape_handle, _ -> :started end
      )

      patch_storage([force: true],
        for_shape: fn ^test_shape_handle, _opts -> @test_opts end
      )

      expect_storage(
        get_chunk_end_log_offset: fn @before_all_offset, _ ->
          next_offset
        end,
        get_log_stream: fn @before_all_offset, _, @test_opts ->
          [Jason.encode!(%{key: "log", value: "foo", headers: %{}, offset: next_offset})]
        end
      )

      conn =
        ctx
        |> conn(:get, %{"table" => "public.users"}, "?offset=-1&replica=full")
        |> call_serve_shape_plug(ctx)

      assert conn.status == 200

      assert Jason.decode!(conn.resp_body) == [
               %{
                 "key" => "log",
                 "value" => "foo",
                 "headers" => %{},
                 "offset" => "#{next_offset}"
               }
             ]

      assert get_resp_header(conn, "etag") == [
               ~s|"#{test_shape_handle}:-1:#{next_offset}"|
             ]

      assert get_resp_header(conn, "electric-handle") == [test_shape_handle]
    end
  end

  describe "serving shapes with sse mode" do
    setup :with_lsn_tracker

    setup ctx do
      {:via, _, {registry_name, registry_key}} =
        Electric.Shapes.Supervisor.name(ctx.stack_id)

      {:ok, _} = Registry.register(registry_name, registry_key, nil)
      set_status_to_active(ctx)

      patch_storage(for_shape: fn @test_shape_handle, _opts -> @test_opts end)

      :ok
    end

    test "returns proper SSE format response when live_sse=true and live=true", ctx do
      patch_shape_cache(
        resolve_shape_handle: fn @test_shape_handle, @test_shape, _stack_id ->
          {@test_shape_handle, @test_offset}
        end,
        has_shape?: fn @test_shape_handle, _opts -> true end,
        await_snapshot_start: fn @test_shape_handle, _ -> :started end
      )

      expect_storage(
        get_chunk_end_log_offset: fn @test_offset, _ -> nil end,
        get_log_stream: fn @test_offset, @test_offset, @test_opts -> [] end
      )

      # Use a short SSE timeout for the test
      ctx = Map.put(ctx, :sse_timeout, 100)

      conn =
        ctx
        |> conn(
          :get,
          %{"table" => "public.users"},
          "?offset=#{@test_offset}&handle=#{@test_shape_handle}&live=true&live_sse=true"
        )
        |> call_serve_shape_plug(ctx)

      assert {"content-type", "text/event-stream"} in conn.resp_headers
      assert {"connection", "keep-alive"} in conn.resp_headers

      cache_control =
        Enum.find_value(conn.resp_headers, fn
          {"cache-control", value} -> value
          _ -> nil
        end)

      assert cache_control =~ "public"
      assert cache_control =~ "max-age="

      assert conn.state == :chunked

      assert conn.status == 200
      assert conn.state == :chunked
    end

    test "returns 400 when live_sse=true but live=false", ctx do
      conn =
        ctx
        |> conn(
          :get,
          %{"table" => "public.users"},
          "?offset=#{@test_offset}&handle=#{@test_shape_handle}&live_sse=true"
        )
        |> call_serve_shape_plug(ctx)

      assert conn.status == 400

      assert Jason.decode!(conn.resp_body) == %{
               "message" => "Invalid request",
               "errors" => %{
                 "live_sse" => ["can't be true unless live is also true"]
               }
             }
    end

    test "sends properly formatted SSE events", ctx do
      next_offset = LogOffset.increment(@test_offset)
      test_content = %{key: "test-key", value: "test-value", headers: %{}, offset: next_offset}

      patch_shape_cache(
        has_shape?: fn @test_shape_handle, _opts -> true end,
        await_snapshot_start: fn @test_shape_handle, _ -> :started end
      )

      expect_shape_cache(
        resolve_shape_handle: fn @test_shape_handle, @test_shape, _stack_id ->
          {@test_shape_handle, @test_offset}
        end
      )

      expect_storage(
        get_chunk_end_log_offset: fn @test_offset, _ -> next_offset end,
        get_log_stream: fn @test_offset, _, @test_opts -> [test_content] end
      )

      %{resp_body: body} =
        ctx
        |> conn(
          :get,
          %{"table" => "public.users"},
          "?offset=#{@test_offset}&handle=#{@test_shape_handle}&live=true&live_sse=true"
        )
        |> call_serve_shape_plug(ctx)

      assert body =~ "data:"
      assert body =~ "test-key"
      assert body =~ "test-value"
    end

    test "works with deprecated experimental_live_sse=true", ctx do
      patch_shape_cache(
        resolve_shape_handle: fn @test_shape_handle, @test_shape, _stack_id ->
          {@test_shape_handle, @test_offset}
        end,
        has_shape?: fn @test_shape_handle, _opts -> true end,
        await_snapshot_start: fn @test_shape_handle, _ -> :started end
      )

      expect_storage(
        get_chunk_end_log_offset: fn @test_offset, _ -> nil end,
        get_log_stream: fn @test_offset, @test_offset, @test_opts -> [] end
      )

      # Use a short SSE timeout for the test
      ctx = Map.put(ctx, :sse_timeout, 100)

      conn =
        ctx
        |> conn(
          :get,
          %{"table" => "public.users"},
          "?offset=#{@test_offset}&handle=#{@test_shape_handle}&live=true&experimental_live_sse=true"
        )
        |> call_serve_shape_plug(ctx)

      assert {"content-type", "text/event-stream"} in conn.resp_headers
      assert {"connection", "keep-alive"} in conn.resp_headers

      cache_control =
        Enum.find_value(conn.resp_headers, fn
          {"cache-control", value} -> value
          _ -> nil
        end)

      assert cache_control =~ "public"
      assert cache_control =~ "max-age="

      assert conn.state == :chunked

      assert conn.status == 200
      assert conn.state == :chunked
    end
  end

  describe "stack not ready" do
    test "returns 503", ctx do
      conn =
        ctx
        |> conn(:get, %{"table" => "public.users"}, "?offset=-1&replica=full")
        |> call_serve_shape_plug(ctx)

      assert conn.status == 503

      assert Jason.decode!(conn.resp_body) == %{
               "message" => "Timeout waiting for Postgres lock acquisition"
             }
    end

    @tag stack_ready_timeout: 5000
    test "waits until stack ready and proceeds", ctx do
      conn_task =
        Task.async(fn ->
          ctx
          |> conn(:get, %{"table" => "public.users", "columns" => "id,invalid"}, "?offset=-1")
          |> call_serve_shape_plug(ctx)
        end)

      set_status_to_active(ctx)

      conn = Task.await(conn_task)

      assert conn.status == 400
      assert get_resp_header(conn, "cache-control") == ["no-store"]
    end
  end

  defp get_shape_with_etag(ctx, offset, extra_query_params \\ []) do
    query_str =
      URI.encode_query([offset: offset, handle: @test_shape_handle] ++ extra_query_params)

    ctx
    |> conn(:get, %{"table" => "public.users"}, "?" <> query_str)
    |> put_req_header(
      "if-none-match",
      ~s("#{@test_shape_handle}:#{offset}:#{@test_offset}")
    )
    |> call_serve_shape_plug(ctx)
  end

  defp max_age(ctx), do: Access.get(ctx, :max_age, 60)
  defp stale_age(ctx), do: Access.get(ctx, :stale_age, 300)
  defp long_poll_timeout(ctx), do: Access.get(ctx, :long_poll_timeout, 20_000)
  defp sse_timeout(ctx), do: Access.get(ctx, :sse_timeout, 60_000)
end
