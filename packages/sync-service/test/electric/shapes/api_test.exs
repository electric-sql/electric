defmodule Electric.Shapes.ApiTest do
  use ExUnit.Case, async: true
  use Repatch.ExUnit, assert_expectations: true

  alias Electric.Postgres.Lsn
  alias Electric.Replication.LogOffset
  alias Electric.Shapes.Api
  alias Electric.Shapes.Shape

  import Support.ComponentSetup

  import Support.TestUtils,
    only: [
      set_status_to_active: 1,
      expect_storage: 1,
      patch_storage: 1,
      expect_shape_cache: 1,
      patch_shape_cache: 1
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
  @receive_timeout 1000

  @moduletag :tmp_dir

  defp configure_request(ctx) do
    Api.plug_opts(
      stack_id: ctx.stack_id,
      stack_ready_timeout: Access.get(ctx, :stack_ready_timeout, 100),
      inspector: @inspector,
      long_poll_timeout: long_poll_timeout(ctx),
      max_age: max_age(ctx),
      stale_age: stale_age(ctx),
      allow_shape_deletion: true,
      send_cache_headers?: send_cache_headers?(ctx),
      encoder: api_encoder(ctx)
    )
  end

  defp ready_stack(ctx) do
    {:via, _, {registry_name, registry_key}} = Electric.Shapes.Supervisor.name(ctx.stack_id)

    {:ok, _} = Registry.register(registry_name, registry_key, nil)
    Electric.LsnTracker.initialize(ctx.stack_id)
    Electric.LsnTracker.set_last_processed_lsn(ctx.stack_id, Lsn.from_integer(0))
    set_status_to_active(ctx)
  end

  defp max_age(ctx), do: Access.get(ctx, :max_age, 60)
  defp stale_age(ctx), do: Access.get(ctx, :stale_age, 300)
  defp long_poll_timeout(ctx), do: Access.get(ctx, :long_poll_timeout, 20_000)
  defp send_cache_headers?(ctx), do: Access.get(ctx, :send_cache_headers?, true)
  defp api_encoder(ctx), do: Access.get(ctx, :api_encoder, Electric.Shapes.Api.Encoder.Term)

  setup [
    :with_stack_id_from_test,
    :with_registry,
    :with_persistent_kv,
    :with_pure_file_storage,
    :with_status_monitor,
    :with_shape_cleaner
  ]

  describe "validate/2" do
    setup [:ready_stack, :configure_request]

    test "returns 400 for invalid table", ctx do
      assert {:error, %{status: 400} = response} =
               Api.validate(ctx.api, %{table: ".invalid_shape", offset: "-1"})

      assert response_body(response) == %{
               message: "Invalid request",
               errors: %{
                 table: [
                   "Invalid zero-length delimited identifier"
                 ]
               }
             }
    end

    test "returns error for invalid offset", ctx do
      assert {:error, %{status: 400} = response} =
               Api.validate(ctx.api, %{table: "foo", offset: "invalid"})

      assert response_body(response) == %{
               message: "Invalid request",
               errors: %{
                 offset: ["has invalid format"]
               }
             }
    end

    test "returns error when table param is missing", ctx do
      assert {:error, %{status: 400} = response} =
               Api.validate(ctx.api, %{offset: "-1"})

      assert response_body(response) == %{
               message: "Invalid request",
               errors: %{
                 table: ["can't be blank"]
               }
             }
    end

    test "returns error when table does not exist", ctx do
      assert {:error, %{status: 400} = response} =
               Api.validate(ctx.api, %{table: "_val1d_schëmaΦ$.Φtàble", offset: "-1"})

      assert response_body(response) == %{
               message: "Invalid request",
               errors: %{
                 table: [
                   "Table \"_val1d_schëmaΦ$\".\"Φtàble\" does not exist. If the table name contains capitals or special characters you must quote it."
                 ]
               }
             }
    end

    test "returns error when connection not available to parse schema", ctx do
      api = Map.put(ctx.api, :inspector, Support.StubInspector.no_conn())

      assert {:error, %{status: 503} = response} =
               Api.validate(api, %{table: "public.users", offset: "-1"})

      assert response_body(response) == %{
               message:
                 "Cannot connect to the database to verify the shape. Please try again later."
             }
    end

    test "returns error for missing shape_handle when offset != -1", ctx do
      assert {:error, %{status: 400} = response} =
               Api.validate(
                 ctx.api,
                 %{table: "public.users", offset: "#{LogOffset.first()}"}
               )

      assert response_body(response) == %{
               message: "Invalid request",
               errors: %{
                 handle: ["can't be blank when offset != -1"]
               }
             }
    end

    test "returns error for live request when offset == -1", ctx do
      assert {:error, %{status: 400} = response} =
               Api.validate(
                 ctx.api,
                 %{
                   table: "public.users",
                   live: true,
                   offset: "#{LogOffset.before_all()}"
                 }
               )

      assert response_body(response) == %{
               message: "Invalid request",
               errors: %{
                 live: ["can't be true when offset == -1"]
               }
             }
    end

    test "the shape handle does not match the shape definition", ctx do
      request_handle = @test_shape_handle <> "-wrong"

      expect_shape_cache(
        resolve_shape_handle: fn ^request_handle, @test_shape, _stack_id ->
          nil
        end,
        get_or_create_shape_handle: fn @test_shape, _stack_id, _opts ->
          {@test_shape_handle, @test_offset}
        end
      )

      assert {:error, %{status: 409} = response} =
               Api.validate(
                 ctx.api,
                 %{
                   table: "public.users",
                   handle: request_handle,
                   offset: "0_0"
                 }
               )

      assert response.handle == @test_shape_handle
      assert [%{headers: %{control: "must-refetch"}}] = response_body(response)
    end

    test "shape for handle does not match the shape definition", ctx do
      request_handle = @test_shape_handle <> "-wrong"

      expect_shape_cache(
        resolve_shape_handle: fn ^request_handle, @test_shape, _stack_id ->
          {@test_shape_handle, @before_all_offset}
        end
      )

      assert {:error, %{status: 409} = response} =
               Api.validate(
                 ctx.api,
                 %{
                   table: "public.users",
                   handle: request_handle,
                   offset: "0_0"
                 }
               )

      assert response.handle == @test_shape_handle
      assert [%{headers: %{control: "must-refetch"}}] = response_body(response)
    end

    test "returns a 409 error when requested shape handle does not exist", ctx do
      request_handle = @test_shape_handle <> "-wrong"

      expect_shape_cache(
        resolve_shape_handle: fn ^request_handle, @test_shape, _stack_id ->
          {@test_shape_handle, @before_all_offset}
        end
      )

      assert {:error, %{status: 409} = response} =
               Api.validate(
                 ctx.api,
                 %{
                   table: "public.users",
                   handle: request_handle,
                   offset: "0_0"
                 }
               )

      assert response.handle == @test_shape_handle
      assert [%{headers: %{control: "must-refetch"}}] = response_body(response)
    end

    test "creates a new shape when shape handle does not exist and sends a 409 redirecting to the newly created shape",
         ctx do
      new_shape_handle = "new-shape-handle"

      patch_shape_cache(has_shape?: fn @test_shape_handle, _opts -> false end)

      expect_shape_cache(
        resolve_shape_handle: fn @test_shape_handle, @test_shape, _stack_id -> nil end,
        get_or_create_shape_handle: fn @test_shape, _stack_id, _opts ->
          {new_shape_handle, @test_offset}
        end
      )

      patch_storage(for_shape: fn new_shape_handle, opts -> {new_shape_handle, opts} end)

      assert {:error, %{status: 409} = response} =
               Api.validate(
                 ctx.api,
                 %{
                   table: "public.users",
                   handle: @test_shape_handle,
                   offset: "50_12"
                 }
               )

      assert response.handle == new_shape_handle
      assert [%{headers: %{control: "must-refetch"}}] = response_body(response)
    end

    test "returns error when omitting primary key columns in selection", ctx do
      assert {:error, %{status: 400} = response} =
               Api.validate(
                 ctx.api,
                 %{
                   table: "public.users",
                   offset: "-1",
                   columns: "value"
                 }
               )

      assert response_body(response) == %{
               message: "Invalid request",
               errors: %{
                 columns: [
                   "The list of columns must include all primary key columns, missing: id"
                 ]
               }
             }
    end

    test "returns error for invalid column spec", ctx do
      assert {:error, %{status: 400} = response} =
               Api.validate(
                 ctx.api,
                 %{
                   table: "public.users",
                   offset: "-1",
                   columns: ",,,"
                 }
               )

      assert response_body(response) == %{
               message: "Invalid request",
               errors: %{
                 columns: ["Invalid zero-length delimited identifier"]
               }
             }

      assert {:error, %{status: 400} = _response} =
               Api.validate(
                 ctx.api,
                 %{
                   table: "public.users",
                   offset: "-1",
                   columns: ["id", ""]
                 }
               )

      assert {:error, %{status: 400} = _response} =
               Api.validate(
                 ctx.api,
                 %{
                   table: "public.users",
                   offset: "-1",
                   columns: ["id", nil]
                 }
               )
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

      patch_storage(for_shape: fn ^test_shape_handle, _opts -> @test_opts end)

      expect_storage(
        get_chunk_end_log_offset: fn @before_all_offset, _ -> next_offset end,
        get_log_stream: fn @before_all_offset, _, @test_opts ->
          [Jason.encode!(%{key: "log", value: "foo", headers: %{}, offset: next_offset})]
        end
      )

      assert {:ok, request} =
               Api.validate(
                 ctx.api,
                 %{
                   table: "public.users",
                   offset: "-1",
                   replica: "full"
                 }
               )

      assert response = Api.serve_shape_response(request)
      assert response.status == 200
      assert response.handle == test_shape_handle

      assert response_body(response) == [
               %{
                 "key" => "log",
                 "value" => "foo",
                 "headers" => %{},
                 "offset" => "#{next_offset}"
               }
             ]
    end

    @tag send_cache_headers?: false
    @tag api_encoder: Electric.Shapes.Api.Encoder.JSON
    test "doesn't send cache headers when configured", ctx do
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

      patch_storage(for_shape: fn ^test_shape_handle, _opts -> @test_opts end)

      expect_storage(
        get_chunk_end_log_offset: fn @before_all_offset, _ -> next_offset end,
        get_log_stream: fn @before_all_offset, _, @test_opts ->
          [Jason.encode!(%{key: "log", value: "foo", headers: %{}, offset: next_offset})]
        end
      )

      assert {:ok, request} =
               Api.validate(
                 ctx.api,
                 %{
                   table: "public.users",
                   offset: "-1",
                   replica: "full"
                 }
               )

      assert response = Api.serve_shape_response(Plug.Test.conn(:get, "/"), request)
      assert response.status == 200

      assert ["max-age=0, private, must-revalidate"] =
               Plug.Conn.get_resp_header(response, "cache-control")
    end

    test "returns error when offset is 'now' with live=true", ctx do
      # Note: validation fails before we need to call fetch_handle_by_shape
      assert {:error, %{status: 400} = response} =
               Api.validate(
                 ctx.api,
                 %{
                   table: "public.users",
                   offset: "now",
                   handle: @test_shape_handle,
                   live: "true"
                 }
               )

      assert response_body(response) == %{
               message: "Invalid request",
               errors: %{
                 live: ["can't be true when offset is 'now'"]
               }
             }
    end

    test "accepts 'now' offset with valid handle", ctx do
      expect_shape_cache(
        get_or_create_shape_handle: fn @test_shape, _stack_id, _opts ->
          {@test_shape_handle, @test_offset}
        end
      )

      patch_storage(for_shape: fn @test_shape_handle, opts -> {@test_shape_handle, opts} end)

      assert {:ok, %{handle: @test_shape_handle}} =
               Api.validate(
                 ctx.api,
                 %{
                   table: "public.users",
                   offset: "now",
                   handle: @test_shape_handle
                 }
               )
    end

    test "accepts 'now' offset without a handle", ctx do
      patch_shape_cache(has_shape?: fn @test_shape_handle, _opts -> true end)

      expect_shape_cache(
        get_or_create_shape_handle: fn @test_shape, _stack_id, _opts ->
          {@test_shape_handle, @first_offset}
        end
      )

      patch_storage(for_shape: fn @test_shape_handle, _opts -> @test_opts end)

      assert {:ok, %{response: %{handle: @test_shape_handle, offset: @first_offset}}} =
               Api.validate(
                 ctx.api,
                 %{
                   table: "public.users",
                   offset: "now"
                 }
               )
    end
  end

  describe "validate_for_delete/2" do
    setup [:ready_stack, :configure_request]

    setup do
      admin_shape =
        Shape.new!("public.users",
          where: "value = 'admin'",
          inspector: @inspector,
          storage: %{compaction: :disabled}
        )

      [admin_shape: admin_shape]
    end

    test "does not allow deletions if flag not set", ctx do
      assert {:error, %{status: 405} = _response} =
               Api.validate_for_delete(
                 Map.put(ctx.api, :allow_shape_deletion, false),
                 %{
                   table: "public.users",
                   where: "value = 'admin'"
                 }
               )
    end

    test "does not create a shape if one doesn't exist for the definition", ctx do
      %{admin_shape: admin_shape} = ctx

      expect_shape_cache(fetch_handle_by_shape: fn ^admin_shape, _opts -> :error end)

      assert {:error, %{status: 404} = _response} =
               Api.validate_for_delete(
                 ctx.api,
                 %{
                   table: "public.users",
                   where: "value = 'admin'"
                 }
               )
    end

    test "passes a request for an existing shape matching the handle", ctx do
      %{admin_shape: admin_shape} = ctx

      handle = "admin-shape-handle"

      expect_shape_cache(fetch_handle_by_shape: fn ^admin_shape, _opts -> {:ok, handle} end)

      assert {:ok, %{handle: ^handle} = _response} =
               Api.validate_for_delete(
                 ctx.api,
                 %{
                   table: "public.users",
                   where: "value = 'admin'",
                   handle: handle
                 }
               )
    end

    test "rejects requests where the handle does not match the shape", ctx do
      %{admin_shape: admin_shape} = ctx

      handle = "admin-shape-handle"

      expect_shape_cache(fetch_handle_by_shape: fn ^admin_shape, _opts -> {:ok, handle} end)

      assert {:error, %{status: 400} = _response} =
               Api.validate_for_delete(
                 ctx.api,
                 %{
                   table: "public.users",
                   where: "value = 'admin'",
                   handle: "not-the-" <> handle
                 }
               )
    end

    test "allows requests to delete by shape handle only", ctx do
      handle = "admin-shape-handle"

      expect_shape_cache(has_shape?: fn ^handle, _opts -> true end)

      assert {:ok, _request} =
               Api.validate_for_delete(
                 ctx.api,
                 %{handle: handle}
               )
    end
  end

  defp response_body(%{body: [message]} = _response) do
    message
  end

  defp response_body(%{body: body} = _response) do
    Enum.into(body, []) |> List.flatten()
  end

  describe "serve/1" do
    setup [:ready_stack, :configure_request]

    test "returns snapshot when offset is -1", ctx do
      expect_shape_cache(
        get_or_create_shape_handle: fn @test_shape, _stack_id, _opts ->
          {@test_shape_handle, @test_offset}
        end,
        await_snapshot_start: fn @test_shape_handle, _ -> :started end
      )

      patch_shape_cache(has_shape?: fn @test_shape_handle, _opts -> true end)

      next_offset = LogOffset.increment(@first_offset)

      patch_storage(for_shape: fn @test_shape_handle, _opts -> @test_opts end)

      expect_storage(
        get_chunk_end_log_offset: fn @before_all_offset, _ ->
          @first_offset
        end,
        get_log_stream: fn @before_all_offset, @first_offset, @test_opts ->
          [Jason.encode!(%{key: "log", value: "foo", headers: %{}, offset: next_offset})]
        end
      )

      assert {:ok, request} =
               Api.validate(
                 ctx.api,
                 %{table: "public.users", offset: "-1"}
               )

      assert response = Api.serve_shape_response(request)

      assert response.status == 200
      assert response.chunked

      assert response_body(response) == [
               %{
                 "key" => "log",
                 "value" => "foo",
                 "headers" => %{},
                 "offset" => "#{next_offset}"
               }
             ]

      assert response.handle == @test_shape_handle
      assert response.shape_definition == @test_shape
      assert response.offset == @first_offset
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

      patch_storage(for_shape: fn @test_shape_handle, _opts -> @test_opts end)

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

      assert {:ok, request} =
               Api.validate(
                 ctx.api,
                 %{
                   table: "public.users",
                   offset: "#{@start_offset_50}",
                   handle: @test_shape_handle
                 }
               )

      assert response = Api.serve_shape_response(request)
      assert response.status == 200
      assert response.chunked

      assert response_body(response) == [
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

      assert response.handle == @test_shape_handle
      assert response.shape_definition == @test_shape
      assert response.offset == next_next_offset
      refute response.up_to_date
      refute response.no_changes
    end

    test "returns immediate up-to-date message when offset is 'now'", ctx do
      patch_shape_cache(
        fetch_handle_by_shape: fn @test_shape, _opts -> {:ok, @test_shape_handle} end,
        has_shape?: fn @test_shape_handle, _opts -> true end
      )

      expect_shape_cache(
        get_or_create_shape_handle: fn @test_shape, _stack_id, _opts ->
          {@test_shape_handle, @test_offset}
        end
      )

      patch_storage(for_shape: fn @test_shape_handle, _opts -> @test_opts end)

      assert {:ok, request} =
               Api.validate(
                 ctx.api,
                 %{
                   table: "public.users",
                   offset: "now",
                   handle: @test_shape_handle
                 }
               )

      assert response = Api.serve_shape_response(request)
      assert response.status == 200
      assert response.up_to_date

      # Should return only an up-to-date control message
      body = response_body(response)
      assert [%{headers: %{control: "up-to-date"}}] = body

      # Should have the latest offset from the shape
      assert response.offset == @test_offset
      assert response.handle == @test_shape_handle
      assert response.no_changes
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

      patch_storage(for_shape: fn @test_shape_handle, _opts -> @test_opts end)

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
          assert {:ok, request} =
                   Api.validate(
                     ctx.api,
                     %{
                       table: "public.users",
                       offset: "#{@test_offset}",
                       handle: @test_shape_handle,
                       live: true
                     }
                   )

          response = Api.serve_shape_response(request)

          {response, response_body(response)}
        end)

      ref = Process.monitor(task.pid)
      assert_receive :got_log_stream, @receive_timeout

      # Simulate new changes arriving
      Registry.dispatch(ctx.registry, @test_shape_handle, fn [{pid, ref}] ->
        send(pid, {ref, :new_changes, next_offset})
      end)

      # The conn process should exit after sending the response
      assert {response, response_body} = Task.await(task)

      assert response.status == 200
      assert response.chunked

      assert response_body == [
               "test result",
               %{
                 headers: %{
                   control: "up-to-date",
                   global_last_seen_lsn: to_string(next_offset.tx_offset)
                 }
               }
             ]

      assert_receive {:DOWN, ^ref, :process, _pid, _reason}

      assert response.offset == next_offset
      assert response.up_to_date
      # Ensure registered listener is cleaned up after body is read
      assert [] == Registry.lookup(ctx.registry, @test_shape_handle)
    end

    test "raises if body is read from a different process", ctx do
      patch_shape_cache(
        resolve_shape_handle: fn @test_shape_handle, @test_shape, _stack_id ->
          {@test_shape_handle, @test_offset}
        end,
        has_shape?: fn @test_shape_handle, _opts -> true end,
        await_snapshot_start: fn @test_shape_handle, _ -> :started end
      )

      test_pid = self()
      next_offset = LogOffset.increment(@test_offset)

      patch_storage(for_shape: fn @test_shape_handle, _opts -> @test_opts end)

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
          assert {:ok, request} =
                   Api.validate(
                     ctx.api,
                     %{
                       table: "public.users",
                       offset: "#{@test_offset}",
                       handle: @test_shape_handle,
                       live: true
                     }
                   )

          Api.serve_shape_response(request)
        end)

      assert_receive :got_log_stream, @receive_timeout

      # Simulate new changes arriving
      Registry.dispatch(ctx.registry, @test_shape_handle, fn [{pid, ref}] ->
        send(pid, {ref, :new_changes, next_offset})
      end)

      # The conn process should exit after sending the response
      assert response = Task.await(task)

      assert_raise RuntimeError, fn ->
        response_body(response)
      end
    end

    @tag long_poll_timeout: 100
    test "returns error after timeout when offset is out of bounds", ctx do
      expect_shape_cache(
        resolve_shape_handle: fn @test_shape_handle, @test_shape, _stack_id ->
          {@test_shape_handle, @test_offset}
        end,
        resolve_shape_handle: fn @test_shape_handle, @test_shape, _stack_id ->
          {@test_shape_handle, @test_offset}
        end
      )

      out_of_bounds_offset = LogOffset.increment(@test_offset)

      assert {:ok, request} =
               Api.validate(
                 ctx.api,
                 %{
                   table: "public.users",
                   handle: "#{@test_shape_handle}",
                   offset: "#{out_of_bounds_offset}",
                   live: true
                 }
               )

      now = System.monotonic_time(:millisecond)
      assert response = Api.serve_shape_response(request)
      duration = System.monotonic_time(:millisecond) - now
      assert duration > 50 and duration < 100

      # this error returns as a list as it reaches the request stage
      # and so needs cleaning up. when encoded the result is the same
      assert response.status == 400

      assert response_body(response) == %{
               message: "Invalid request",
               errors: %{
                 offset: ["out of bounds for this shape"]
               }
             }
    end

    for live <- [true, false] do
      @live live
      test "live=#{@live} request recovers from out of bounds offset via subscription", ctx do
        next_offset = LogOffset.increment(@test_offset)
        next_next_offset = LogOffset.increment(next_offset)

        # resolve_shape_handle always returns @test_offset (behind next_offset),
        # so notify_changes_since_request_start won't self-send :new_changes.
        # Recovery must come from the Registry subscription added by ensure_subscribed.
        patch_shape_cache(
          has_shape?: fn @test_shape_handle, _opts -> true end,
          await_snapshot_start: fn @test_shape_handle, _ -> :started end,
          resolve_shape_handle: fn @test_shape_handle, @test_shape, _stack_id ->
            {@test_shape_handle, @test_offset}
          end
        )

        patch_storage(
          for_shape: fn @test_shape_handle, _opts -> @test_opts end,
          get_chunk_end_log_offset: fn ^next_offset, _ -> nil end
        )

        expect_storage(
          get_log_stream: fn ^next_offset, ^next_next_offset, @test_opts ->
            [Jason.encode!("test result")]
          end
        )

        # Use :trace to wait until the task process has entered hold_until_change, which runs
        # after ensure_subscribed, by which point it is safe to send it the new_changes
        # notification.
        trace_session = :trace.session_create(:oob_test, self(), [])
        :trace.function(trace_session, {Api, :hold_until_change, 1}, true, [:local])

        task =
          Task.async(fn ->
            :trace.process(trace_session, self(), true, [:call])

            assert {:ok, request} =
                     Api.validate(
                       ctx.api,
                       %{
                         table: "public.users",
                         offset: "#{next_offset}",
                         handle: @test_shape_handle,
                         live: @live
                       }
                     )

            response = Api.serve_shape_response(request)

            {response, response_body(response)}
          end)

        assert_receive {:trace, _, :call, {Api, :hold_until_change, _}}, @receive_timeout

        # Simulate new changes arriving via Registry.
        # Without ensure_subscribed, this dispatch would find no registered
        # process and the request would hang until out_of_bounds_timeout.
        Registry.dispatch(ctx.registry, @test_shape_handle, fn [{pid, ref}] ->
          send(pid, {ref, :new_changes, next_next_offset})
        end)

        assert {response, response_body} = Task.await(task)

        assert response.status == 200

        assert response_body == [
                 "test result",
                 %{
                   headers: %{
                     control: "up-to-date",
                     global_last_seen_lsn: to_string(next_offset.tx_offset)
                   }
                 }
               ]
      end
    end

    test "returns correct global_last_seen_lsn on non-live responses during data race", ctx do
      next_offset = LogOffset.increment(@start_offset_50)
      next_offset_lsn = next_offset.tx_offset
      last_minute_next_offset = %LogOffset{tx_offset: next_offset.tx_offset + 1, op_offset: 0}
      last_minute_next_offset_lsn = last_minute_next_offset.tx_offset

      # Initially set the last_processed_lsn to next_offset_lsn, with this being
      # the last seen log entry at the start of the request
      Electric.LsnTracker.set_last_processed_lsn(
        ctx.stack_id,
        next_offset_lsn
      )

      expect_shape_cache(
        resolve_shape_handle: fn @test_shape_handle, @test_shape, _stack_id ->
          {@test_shape_handle, next_offset}
        end,
        resolve_shape_handle: fn @test_shape_handle, @test_shape, _stack_id ->
          {@test_shape_handle, last_minute_next_offset}
        end
      )

      patch_shape_cache(
        has_shape?: fn @test_shape_handle, _opts -> true end,
        await_snapshot_start: fn @test_shape_handle, _ -> :started end
      )

      patch_storage(for_shape: fn @test_shape_handle, _opts -> @test_opts end)

      expect_storage(
        get_chunk_end_log_offset: fn @start_offset_50, _ ->
          # Set last_seen_lsn to last_minute_next_offset immediately after retrieving
          # the chunk end log offset, simulating the race where the next log entry
          # arrives in between determining the the end point of the log to read
          # and serving the log.
          Electric.LsnTracker.set_last_processed_lsn(
            ctx.stack_id,
            last_minute_next_offset_lsn
          )

          next_offset
        end,
        get_chunk_end_log_offset: fn @start_offset_50, _ -> last_minute_next_offset end,
        get_log_stream: fn @start_offset_50, ^next_offset, @test_opts ->
          [
            Jason.encode!(%{key: "log1", value: "foo", headers: %{}, offset: next_offset})
          ]
        end,
        get_log_stream: fn @start_offset_50, _, @test_opts ->
          [
            Jason.encode!(%{key: "log1", value: "foo", headers: %{}, offset: next_offset}),
            Jason.encode!(%{
              key: "log2",
              value: "bar",
              headers: %{},
              offset: last_minute_next_offset
            })
          ]
        end
      )

      assert {:ok, request} =
               Api.validate(
                 ctx.api,
                 %{
                   table: "public.users",
                   offset: "#{@start_offset_50}",
                   handle: @test_shape_handle
                 }
               )

      assert response = Api.serve_shape_response(request)
      assert response.status == 200

      # Should see the last seen log entry at the start of the request
      assert response_body(response) == [
               %{
                 "key" => "log1",
                 "value" => "foo",
                 "headers" => %{},
                 "offset" => "#{next_offset}"
               },
               %{
                 headers: %{
                   control: "up-to-date",
                   global_last_seen_lsn: "#{next_offset_lsn}"
                 }
               }
             ]

      assert response.offset == next_offset
      assert response.up_to_date

      # Subsequent request should see the last minute update as well
      {:ok, request} =
        Api.validate(
          ctx.api,
          %{
            table: "public.users",
            offset: "#{@start_offset_50}",
            handle: @test_shape_handle
          }
        )

      response = Api.serve_shape_response(request)

      assert response_body(response) == [
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
                 "offset" => "#{last_minute_next_offset}"
               },
               %{
                 headers: %{
                   control: "up-to-date",
                   global_last_seen_lsn: "#{last_minute_next_offset_lsn}"
                 }
               }
             ]

      assert response.offset == last_minute_next_offset
      assert response.up_to_date
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

      patch_storage(for_shape: fn @test_shape_handle, _opts -> @test_opts end)

      expect_storage(
        get_chunk_end_log_offset: fn @test_offset, _ -> nil end,
        get_log_stream: fn @test_offset, _, @test_opts ->
          send(test_pid, :got_log_stream)
          []
        end
      )

      task =
        Task.async(fn ->
          assert {:ok, request} =
                   Api.validate(
                     ctx.api,
                     %{
                       table: "public.users",
                       offset: "#{@test_offset}",
                       handle: @test_shape_handle,
                       live: true
                     }
                   )

          response = Api.serve_shape_response(request)
          {response, response_body(response)}
        end)

      assert_receive :got_log_stream, @receive_timeout

      # Simulate shape rotation
      Registry.dispatch(ctx.registry, @test_shape_handle, fn [{pid, ref}] ->
        send(pid, {ref, :shape_rotation})
      end)

      assert {response, response_body} = Task.await(task)

      assert response.status == 409
      refute response.chunked
      assert [%{headers: %{control: "must-refetch"}}] = response_body
    end

    @tag long_poll_timeout: 100
    test "picks up changes missed between loading shape and listening for changes", ctx do
      next_offset = LogOffset.increment(@test_offset)

      patch_shape_cache(
        has_shape?: fn @test_shape_handle, _opts -> true end,
        await_snapshot_start: fn @test_shape_handle, _ -> :started end
      )

      # # any subsequent get shape calls should return the new offset
      expect_shape_cache(
        resolve_shape_handle: fn @test_shape_handle, @test_shape, _stack_id ->
          # Simulate new changes arriving the moment we load the shape
          Registry.dispatch(ctx.registry, @test_shape_handle, fn [{pid, ref}] ->
            send(pid, {ref, :new_changes, next_offset})
          end)

          {@test_shape_handle, @test_offset}
        end,
        resolve_shape_handle: fn @test_shape_handle, @test_shape, _stack_id ->
          {@test_shape_handle, next_offset}
        end
      )

      patch_storage(
        for_shape: fn @test_shape_handle, _opts -> @test_opts end,
        get_chunk_end_log_offset: fn _, @test_opts -> nil end,
        get_log_stream: fn
          @test_offset, @test_offset, @test_opts ->
            []

          @test_offset, ^next_offset, @test_opts ->
            [
              Jason.encode!(%{key: "log1", value: "foo", headers: %{}, offset: next_offset})
            ]
        end
      )

      assert {:ok, request} =
               Api.validate(
                 ctx.api,
                 %{
                   table: "public.users",
                   offset: "#{@test_offset}",
                   handle: @test_shape_handle,
                   live: true
                 }
               )

      assert response = Api.serve_shape_response(request)

      assert response.status == 200

      assert [
               %{"key" => "log1"},
               %{headers: %{control: "up-to-date"}}
             ] = response_body(response)
    end

    @tag long_poll_timeout: 100
    test "picks up shape rotation missed between loading shape and listening for changes", ctx do
      expect_shape_cache(
        resolve_shape_handle: fn @test_shape_handle, @test_shape, _stack_id ->
          # Simulate shape rotating a moment after we load the shape
          Registry.dispatch(ctx.registry, @test_shape_handle, fn [{pid, ref}] ->
            send(pid, {ref, :shape_rotation})
          end)

          {@test_shape_handle, @test_offset}
        end,
        resolve_shape_handle: fn @test_shape_handle, @test_shape, _stack_id ->
          nil
        end
      )

      patch_shape_cache(
        has_shape?: fn @test_shape_handle, _opts -> true end,
        await_snapshot_start: fn @test_shape_handle, _ -> :started end
      )

      patch_storage(
        for_shape: fn @test_shape_handle, _opts -> @test_opts end,
        get_chunk_end_log_offset: fn _, @test_opts -> nil end,
        get_log_stream: fn @test_offset, _, @test_opts -> [] end
      )

      assert {:ok, request} =
               Api.validate(
                 ctx.api,
                 %{
                   table: "public.users",
                   offset: "#{@test_offset}",
                   handle: @test_shape_handle,
                   live: true
                 }
               )

      assert response = Api.serve_shape_response(request)
      assert response.status == 409
      assert [%{headers: %{control: "must-refetch"}}] = response_body(response)
    end

    @tag long_poll_timeout: 100
    test "handles shape offset regression during live polling (issue #3760)", ctx do
      # This test reproduces the CaseClauseError described in issue #3760.
      # The bug occurs when:
      # 1. A live request is waiting for changes
      # 2. Shape invalidation spawns an async cleanup task
      # 3. Between consumer termination and async cleanup completion,
      #    the writer ETS gets deleted while ShapeStatus retains the shape entry
      # 4. When notify_changes_since_request_start/1 calls resolve_shape_handle,
      #    it returns {shape_handle, LogOffset.last_before_real_offsets()} as a fallback
      # 5. This offset is *less than* the client's stored offset, causing a
      #    CaseClauseError because no case clause handles offset regression

      regressed_offset = LogOffset.last_before_real_offsets()

      expect_shape_cache(
        # First call during validation - returns valid offset
        resolve_shape_handle: fn @test_shape_handle, @test_shape, _stack_id ->
          {@test_shape_handle, @test_offset}
        end,
        # Second call during notify_changes_since_request_start - simulates
        # the race condition where shape metadata was partially cleaned up,
        # causing offset to regress to last_before_real_offsets()
        resolve_shape_handle: fn @test_shape_handle, @test_shape, _stack_id ->
          {@test_shape_handle, regressed_offset}
        end
      )

      patch_shape_cache(
        has_shape?: fn @test_shape_handle, _opts -> true end,
        await_snapshot_start: fn @test_shape_handle, _ -> :started end
      )

      patch_storage(
        for_shape: fn @test_shape_handle, _opts -> @test_opts end,
        get_chunk_end_log_offset: fn _, @test_opts -> nil end,
        get_log_stream: fn @test_offset, _, @test_opts -> [] end
      )

      # The flow is:
      # 1. validate() calls resolve_shape_handle (first expectation - returns valid offset)
      # 2. serve_shape_response() -> handle_live_request() -> notify_changes_since_request_start()
      # 3. notify_changes_since_request_start() calls resolve_shape_handle (second expectation)
      # 4. Second call returns regressed offset (last_before_real_offsets)
      # 5. The fix detects offset regression and sends :shape_rotation message
      # 6. hold_until_change() receives :shape_rotation and returns 409
      assert {:ok, request} =
               Api.validate(
                 ctx.api,
                 %{
                   table: "public.users",
                   offset: "#{@test_offset}",
                   handle: @test_shape_handle,
                   live: true
                 }
               )

      response = Api.serve_shape_response(request)

      # With the fix in place, offset regression should be treated as shape rotation
      # and return a 409 with must-refetch control header
      assert response.status == 409
      assert [%{headers: %{control: "must-refetch"}}] = response_body(response)
    end

    @tag long_poll_timeout: 100
    test "sends an up-to-date response after a timeout if no changes are observed", ctx do
      patch_shape_cache(
        resolve_shape_handle: fn @test_shape_handle, @test_shape, _stack_id ->
          {@test_shape_handle, @test_offset}
        end,
        has_shape?: fn @test_shape_handle, _opts -> true end,
        await_snapshot_start: fn @test_shape_handle, _ -> :started end
      )

      patch_storage(for_shape: fn @test_shape_handle, _opts -> @test_opts end)

      expect_storage(
        get_chunk_end_log_offset: fn @test_offset, _ -> nil end,
        get_log_stream: fn @test_offset, _, @test_opts -> [] end
      )

      assert {:ok, request} =
               Api.validate(
                 ctx.api,
                 %{
                   table: "public.users",
                   offset: "#{@test_offset}",
                   handle: @test_shape_handle,
                   live: true
                 }
               )

      assert response = Api.serve_shape_response(request)

      assert response.status == 200
      refute response.chunked

      assert [%{headers: %{control: "up-to-date"}}] = response_body(response)
      assert response.up_to_date
      assert response.no_changes
    end

    @tag long_poll_timeout: 100
    test "returns the latest lsn after the long poll timeout even if stack has failed", ctx do
      patch_shape_cache(
        resolve_shape_handle: fn @test_shape_handle, @test_shape, _stack_id ->
          {@test_shape_handle, @test_offset}
        end,
        has_shape?: fn @test_shape_handle, _opts -> true end,
        await_snapshot_start: fn @test_shape_handle, _ -> :started end
      )

      patch_storage(for_shape: fn @test_shape_handle, _opts -> @test_opts end)

      expect_storage(
        get_chunk_end_log_offset: fn @test_offset, _ -> nil end,
        get_log_stream: fn @test_offset, _, @test_opts -> [] end
      )

      stack_id = ctx.stack_id

      status_task =
        start_supervised!({
          Task,
          fn ->
            set_status_to_active(ctx)
            Process.sleep(:infinity)
          end
        })

      req_task =
        Task.async(fn ->
          assert {:ok, request} =
                   Api.validate(
                     ctx.api,
                     %{
                       table: "public.users",
                       offset: "#{@test_offset}",
                       handle: @test_shape_handle,
                       live: true
                     }
                   )

          Process.exit(status_task, :kill)
          Electric.StatusMonitor.wait_for_messages_to_be_processed(stack_id)
          Process.sleep(50)

          Api.serve_shape_response(request)
        end)

      assert %{status: 503} = Task.await(req_task)
    end
  end

  describe "Pre-defined shape API" do
    setup [:ready_stack, :configure_request]

    setup(ctx) do
      admin_shape =
        Shape.new!("public.users",
          where: "value = 'admin'",
          columns: ["id", "value"],
          replica: :full,
          inspector: @inspector,
          storage: %{compaction: :disabled}
        )

      {:ok, api} =
        Api.predefined_shape(ctx.api,
          relation: {"public", "users"},
          where: "value = 'admin'",
          replica: :full,
          columns: ["id", "value"],
          storage: %{compaction: :disabled}
        )

      [admin_shape: admin_shape, api: api]
    end

    test "ignores shape_definition parameters", ctx do
      %{admin_shape: shape} = ctx

      next_offset = LogOffset.increment(@first_offset)

      expect_shape_cache(
        get_or_create_shape_handle: fn ^shape, _stack_id, _opts ->
          {@test_shape_handle, @test_offset}
        end
      )

      patch_storage(for_shape: fn new_shape_handle, opts -> {new_shape_handle, opts} end)
      expect_storage(get_chunk_end_log_offset: fn @before_all_offset, _ -> next_offset end)

      assert {:ok, request} =
               Api.validate(ctx.api, %{
                 table: ".invalid_shape",
                 where: "something = false",
                 columns: "this,that",
                 offset: "-1"
               })

      assert request.params.shape_definition == shape
    end

    test "accepts simpler table and namespace options", ctx do
      %{admin_shape: shape} = ctx

      assert {:ok, api} =
               Api.predefined_shape(ctx.api,
                 table: "users",
                 where: "value = 'admin'",
                 replica: :full,
                 columns: ["id", "value"],
                 storage: %{compaction: :disabled}
               )

      assert api.shape == shape

      assert {:ok, api} =
               Api.predefined_shape(ctx.api,
                 schema: "public",
                 table: "users",
                 where: "value = 'admin'",
                 replica: :full,
                 columns: ["id", "value"],
                 storage: %{compaction: :disabled}
               )

      assert api.shape == shape
    end
  end

  describe "stack not ready" do
    setup [:configure_request]

    test "returns 503", ctx do
      assert {:error, response} =
               Api.validate(ctx.api, %{table: "public.users", offset: "-1"})

      assert response.status == 503

      assert response_body(response) == %{
               message: "Timeout waiting for Postgres lock acquisition"
             }
    end

    @tag stack_ready_timeout: 1000
    test "waits until stack ready and proceeds", ctx do
      task =
        Task.async(fn ->
          Api.validate(
            ctx.api,
            %{table: "public.users", offset: "-1", columns: "id,invalid"}
          )
        end)

      set_status_to_active(ctx)

      {:error, response} = Task.await(task)

      assert response.status == 400
    end
  end
end
