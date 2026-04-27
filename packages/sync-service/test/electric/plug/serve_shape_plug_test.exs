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
  @subquery_inspector Support.StubInspector.new(%{
                        {"public", "parent"} => [
                          %{name: "id", type: "int8", pk_position: 0, type_id: {20, 1}},
                          %{name: "value", type: "int8", pk_position: nil, type_id: {20, 1}}
                        ],
                        {"public", "child"} => [
                          %{name: "id", type: "int8", pk_position: 0, type_id: {20, 1}},
                          %{name: "parent_id", type: "int8", pk_position: nil, type_id: {20, 1}},
                          %{name: "value", type: "int8", pk_position: nil, type_id: {20, 1}}
                        ]
                      })
  @subquery_where "parent_id in (SELECT id FROM parent WHERE value = 1)"

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

  defp build_plug_opts(ctx) do
    Api.plug_opts(
      stack_id: ctx.stack_id,
      inspector: Access.get(ctx, :inspector, @inspector),
      feature_flags: Access.get(ctx, :feature_flags, []),
      stack_ready_timeout: Access.get(ctx, :stack_ready_timeout, 100),
      long_poll_timeout: long_poll_timeout(ctx),
      sse_timeout: sse_timeout(ctx),
      max_age: max_age(ctx),
      stale_age: stale_age(ctx),
      max_concurrent_requests: %{initial: 300, existing: 10_000}
    )
  end

  def call_serve_shape_plug(conn, ctx) do
    ServeShapePlug.call(conn, build_plug_opts(ctx))
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
        resolve_shape_handle: fn @test_shape_handle, @test_shape, _stack_id, _opts ->
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

    test "returns 400 when creating a subquery shape with compaction enabled", ctx do
      ctx =
        ctx
        |> Map.put(:inspector, @subquery_inspector)
        |> Map.put(:feature_flags, ["allow_subqueries"])

      Repatch.patch(Electric.Shapes, :fetch_handle_by_shape, fn _, _ ->
        flunk("should reject before checking whether the shape already exists")
      end)

      conn =
        ctx
        |> conn(
          :get,
          %{
            "table" => "public.child",
            "where" => @subquery_where,
            "experimental_compaction" => "true"
          },
          "?offset=now"
        )
        |> call_serve_shape_plug(ctx)

      assert conn.status == 400

      assert Jason.decode!(conn.resp_body) == %{
               "message" => "Invalid request",
               "errors" => %{
                 "experimental_compaction" => ["can't be enabled for shapes with subqueries"]
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
        resolve_shape_handle: fn @test_shape_handle, @test_shape, _stack_id, _opts ->
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
        resolve_shape_handle: fn @test_shape_handle, @test_shape, _stack_id, _opts ->
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
        resolve_shape_handle: fn @test_shape_handle, @test_shape, _stack_id, _opts ->
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
        resolve_shape_handle: fn @test_shape_handle, @test_shape, _stack_id, _opts ->
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
        resolve_shape_handle: fn @test_shape_handle, @test_shape, _stack_id, _opts ->
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

      assert conn.status == 409
      assert [%{"headers" => %{"control" => "must-refetch"}}] = Jason.decode!(conn.resp_body)
    end

    test "sends an up-to-date response after a timeout if no changes are observed",
         ctx do
      patch_shape_cache(
        resolve_shape_handle: fn @test_shape_handle, @test_shape, _stack_id, _opts ->
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
        resolve_shape_handle: fn "foo", @test_shape, _stack_id, _opts -> nil end,
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
        resolve_shape_handle: fn @test_shape_handle, @test_shape, _stack_id, _opts ->
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
        resolve_shape_handle: fn @test_shape_handle, @test_shape, _stack_id, _opts ->
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
        resolve_shape_handle: fn @test_shape_handle, @test_shape, _stack_id, _opts ->
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
        resolve_shape_handle: fn @test_shape_handle, @test_shape, _stack_id, _opts ->
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
        resolve_shape_handle: fn @test_shape_handle, @test_shape, _stack_id, _opts ->
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

  describe "parse_body error handling" do
    setup :with_lsn_tracker

    setup ctx do
      {:via, _, {registry_name, registry_key}} =
        Electric.Shapes.Supervisor.name(ctx.stack_id)

      {:ok, _} = Registry.register(registry_name, registry_key, nil)
      set_status_to_active(ctx)

      patch_storage(for_shape: fn @test_shape_handle, _opts -> @test_opts end)

      :ok
    end

    test "returns 400 for invalid JSON body without crashing", ctx do
      conn =
        Plug.Test.conn(:post, "/?offset=-1", "not valid json")
        |> put_req_header("content-type", "application/json")
        |> call_serve_shape_plug(ctx)

      assert conn.status == 400
      assert %{"error" => "Invalid JSON in request body"} = Jason.decode!(conn.resp_body)
    end

    test "returns 400 for non-object JSON body without crashing", ctx do
      conn =
        Plug.Test.conn(:post, "/?offset=-1", Jason.encode!(["an", "array"]))
        |> put_req_header("content-type", "application/json")
        |> call_serve_shape_plug(ctx)

      assert conn.status == 400
      assert %{"error" => "Request body must be a JSON object"} = Jason.decode!(conn.resp_body)
    end

    test "returns 413 for oversized body without crashing", ctx do
      Repatch.patch(Plug.Conn, :read_body, fn conn, _opts -> {:more, "partial", conn} end)

      conn =
        Plug.Test.conn(:post, "/?offset=-1", "body")
        |> put_req_header("content-type", "application/json")
        |> call_serve_shape_plug(ctx)

      assert conn.status == 413
      assert %{"error" => "Request body too large"} = Jason.decode!(conn.resp_body)
    end

    test "returns 400 for body read failure without crashing", ctx do
      Repatch.patch(Plug.Conn, :read_body, fn _conn, _opts -> {:error, :timeout} end)

      conn =
        Plug.Test.conn(:post, "/?offset=-1", "body")
        |> put_req_header("content-type", "application/json")
        |> call_serve_shape_plug(ctx)

      assert conn.status == 400
      assert %{"error" => "Failed to read request body"} = Jason.decode!(conn.resp_body)
    end
  end

  describe "admission control release on error" do
    setup :with_lsn_tracker

    setup ctx do
      {:via, _, {registry_name, registry_key}} =
        Electric.Shapes.Supervisor.name(ctx.stack_id)

      {:ok, _} = Registry.register(registry_name, registry_key, nil)
      set_status_to_active(ctx)

      %{plug_opts: build_plug_opts(ctx)}
    end

    test "releases permit when load_shape raises RuntimeError", ctx do
      Repatch.patch(Electric.Shapes.Api, :load_shape_info, fn _request ->
        raise RuntimeError, "simulated crash"
      end)

      call_plug_expecting_crash(ctx)

      assert %{initial: 0, existing: 0} == Electric.AdmissionControl.get_current(ctx.stack_id)
    end

    test "releases permit when load_shape raises DBConnection.ConnectionError", ctx do
      Repatch.patch(Electric.Shapes.Api, :load_shape_info, fn _request ->
        raise DBConnection.ConnectionError, "connection refused"
      end)

      call_plug_expecting_crash(ctx)

      assert %{initial: 0, existing: 0} == Electric.AdmissionControl.get_current(ctx.stack_id)
    end

    test "does not call release when exception occurs before check_admission runs", ctx do
      :ok = Electric.AdmissionControl.try_acquire(ctx.stack_id, :initial, max_concurrent: 1000)
      :ok = Electric.AdmissionControl.try_acquire(ctx.stack_id, :initial, max_concurrent: 1000)
      :ok = Electric.AdmissionControl.try_acquire(ctx.stack_id, :existing, max_concurrent: 1000)

      # If validation raises before check_admission, no permit was acquired,
      # so permit counters remain at their previous values.
      Repatch.patch(Electric.Shapes.Api, :validate_params, fn _api, _params ->
        raise RuntimeError, "crash during validation"
      end)

      call_plug_expecting_crash(ctx)

      assert %{initial: 2, existing: 1} == Electric.AdmissionControl.get_current(ctx.stack_id)
    end

    test "releases correct :existing permit when shape exists and offset is -1", ctx do
      # Regression: when an existing shape is requested with offset=-1 (reconnecting
      # client), resolve_existing_shape classifies the request as :existing. If
      # load_shape then raises, the error handler must release :existing — not
      # :initial (which the old offset-based heuristic would have picked).
      Repatch.patch(Electric.Shapes, :fetch_handle_by_shape, fn _stack_id, _shape ->
        {:ok, @test_shape_handle}
      end)

      Repatch.patch(Electric.Shapes.Api, :load_shape_info, fn _request ->
        raise RuntimeError, "simulated crash"
      end)

      call_plug_expecting_crash(ctx)

      assert %{initial: 0, existing: 0} == Electric.AdmissionControl.get_current(ctx.stack_id)
    end

    test "releases correct :initial permit when shape does not exist", ctx do
      # Complement to the above: when the shape doesn't exist, the permit kind
      # is :initial. Verify the counter returns to zero on exception.
      Repatch.patch(Electric.Shapes, :fetch_handle_by_shape, fn _stack_id, _shape ->
        :error
      end)

      Repatch.patch(Electric.Shapes.Api, :load_shape_info, fn _request ->
        raise RuntimeError, "simulated crash"
      end)

      call_plug_expecting_crash(ctx)

      assert %{initial: 0, existing: 0} == Electric.AdmissionControl.get_current(ctx.stack_id)
    end

    # The `catch` only fires on the re-raise path (`handle_caught` sees
    # `{:plug_conn, :sent}` in the mailbox and re-raises). For the tests
    # in this describe block the exception is raised before any response is
    # sent, so `handle_errors` sends a 500 and `call/2` returns normally —
    # the `catch` is defensive for generality.
    defp call_plug_expecting_crash(ctx) do
      try do
        ctx
        |> conn(:get, %{"table" => "public.users"}, "?offset=-1")
        |> ServeShapePlug.call(ctx.plug_opts)
      catch
        _kind, _reason -> :ok
      end
    end

    test "resolve_existing_shape unexpected exception does not leak permit", ctx do
      # resolve_existing_shape runs BEFORE check_admission, so a non-ArgumentError
      # raise here must propagate without a permit having been acquired. Counter
      # must stay at zero.
      Repatch.patch(Electric.Shapes, :fetch_handle_by_shape, fn _stack_id, _shape ->
        raise RuntimeError, "unexpected failure in shape cache lookup"
      end)

      call_plug_expecting_crash(ctx)

      assert %{initial: 0, existing: 0} == Electric.AdmissionControl.get_current(ctx.stack_id)
    end

    test "successful snapshot response releases permit via after-block", ctx do
      # Covers the chunked streaming success path — permit release happens only after
      # Api.Response.send_stream finishes streaming the whole response to the client.
      patch_storage(for_shape: fn @test_shape_handle, _opts -> @test_opts end)

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
        get_log_stream: fn @before_all_offset, @first_offset, @test_opts ->
          [Jason.encode!(%{key: "log", value: "foo", headers: %{}, offset: @first_offset})]
        end
      )

      conn =
        ctx
        |> conn(:get, %{"table" => "public.users"}, "?offset=-1")
        |> ServeShapePlug.call(ctx.plug_opts)

      assert conn.status == 200

      assert %{initial: 0, existing: 0} == Electric.AdmissionControl.get_current(ctx.stack_id)
    end
  end

  # The old register_before_send approach emitted the telemetry span when
  # send_chunked started, not when it finished, losing streaming_bytes_sent
  # and duration. The current try/after in call/2 emits telemetry only after
  # super/2 returns (i.e. after the chunk reduction has drained the body),
  # so the event reflects the full request lifecycle.
  describe "telemetry span covers full chunked response" do
    setup :with_lsn_tracker

    setup ctx do
      {:via, _, {registry_name, registry_key}} =
        Electric.Shapes.Supervisor.name(ctx.stack_id)

      {:ok, _} = Registry.register(registry_name, registry_key, nil)
      set_status_to_active(ctx)

      %{plug_opts: build_plug_opts(ctx)}
    end

    test "emits [:electric, :plug, :serve_shape] after chunked body fully drained", ctx do
      patch_storage(for_shape: fn @test_shape_handle, _opts -> @test_opts end)

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
        get_log_stream: fn @before_all_offset, @first_offset, @test_opts ->
          [Jason.encode!(%{key: "log", value: "foo", headers: %{}, offset: @first_offset})]
        end
      )

      test_pid = self()
      ref = make_ref()
      handler_id = "test-serve-shape-telemetry-#{inspect(ref)}"

      :telemetry.attach(
        handler_id,
        [:electric, :plug, :serve_shape],
        fn event, measurements, metadata, _ ->
          send(test_pid, {:serve_shape_telemetry, event, measurements, metadata})
        end,
        nil
      )

      try do
        conn =
          ctx
          |> conn(:get, %{"table" => "public.users"}, "?offset=-1")
          |> ServeShapePlug.call(ctx.plug_opts)

        assert conn.status == 200

        assert_receive {:serve_shape_telemetry, [:electric, :plug, :serve_shape], measurements,
                        metadata},
                       @receive_timeout

        # Request was fully drained before telemetry fired — bytes must reflect
        # the chunk actually streamed, duration must be non-zero, and status
        # must be the final 200 (not pre-response state).
        assert measurements.count == 1
        assert measurements.bytes > 0
        assert measurements.duration > 0
        assert metadata.status == 200
        assert metadata.stack_id == ctx.stack_id
      after
        :telemetry.detach(handler_id)
      end
    end

    test "emits telemetry on error path with final status from handle_errors", ctx do
      Repatch.patch(Electric.Shapes.Api, :load_shape_info, fn _request ->
        raise RuntimeError, "simulated crash"
      end)

      test_pid = self()
      ref = make_ref()
      handler_id = "test-serve-shape-error-telemetry-#{inspect(ref)}"

      :telemetry.attach(
        handler_id,
        [:electric, :plug, :serve_shape],
        fn event, measurements, metadata, _ ->
          send(test_pid, {:serve_shape_telemetry, event, measurements, metadata})
        end,
        nil
      )

      try do
        call_plug_expecting_crash(ctx)

        assert_receive {:serve_shape_telemetry, [:electric, :plug, :serve_shape], measurements,
                        metadata},
                       @receive_timeout

        # Error path: handle_errors sends 500, try body returns the sent conn,
        # emit_shape_telemetry sees the final status before after pops the span.
        assert measurements.count == 1
        assert measurements.duration > 0
        assert metadata.status == 500
        assert metadata.stack_id == ctx.stack_id
      after
        :telemetry.detach(handler_id)
      end
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
