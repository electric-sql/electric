defmodule Electric.Shapes.ApiTest do
  use ExUnit.Case, async: true

  alias Electric.Postgres.Lsn
  alias Electric.Replication.LogOffset
  alias Electric.Shapes.Api
  alias Electric.Shapes.Shape

  alias Support.Mock

  import Support.ComponentSetup
  import Mox

  @test_shape %Shape{
    root_table: {"public", "users"},
    root_table_id: :erlang.phash2({"public", "users"}),
    table_info: %{
      {"public", "users"} => %{
        columns: [
          %{name: "id", type: "int8", type_id: {20, 1}, pk_position: 0, array_dimensions: 0},
          %{name: "value", type: "text", type_id: {28, 1}, pk_position: nil, array_dimensions: 0}
        ],
        pk: ["id"]
      }
    }
  }
  @registry __MODULE__.Registry
  @test_shape_handle "test-shape-handle"
  @test_opts %{foo: "bar"}
  @before_all_offset LogOffset.before_all()
  @first_offset LogOffset.first()
  @test_offset LogOffset.new(Lsn.from_integer(100), 0)
  @start_offset_50 LogOffset.new(Lsn.from_integer(50), 0)
  @test_pg_id "12345"

  # Higher timeout is needed for some tests that tend to run slower on CI.
  @receive_timeout 1000

  def load_column_info({"public", "users"}, _) do
    {:ok, @test_shape.table_info[{"public", "users"}][:columns]}
  end

  def load_column_info(_, _),
    do: :table_not_found

  def load_relation(tbl, _),
    do: Support.StubInspector.load_relation(tbl, nil)

  defp configure_request(ctx) do
    Api.plug_opts(
      stack_id: ctx.stack_id,
      pg_id: @test_pg_id,
      stack_events_registry: Registry.StackEvents,
      stack_ready_timeout: Access.get(ctx, :stack_ready_timeout, 100),
      shape_cache: {Mock.ShapeCache, []},
      storage: {Mock.Storage, []},
      inspector: {__MODULE__, []},
      registry: @registry,
      long_poll_timeout: long_poll_timeout(ctx),
      max_age: max_age(ctx),
      stale_age: stale_age(ctx),
      allow_shape_deletion: true,
      encoder: Electric.Shapes.Api.Encoder.Term
    )
  end

  defp ready_stack(ctx) do
    {:via, _, {registry_name, registry_key}} = Electric.Replication.Supervisor.name(ctx)

    {:ok, _} = Registry.register(registry_name, registry_key, nil)
    :ok
  end

  defp max_age(ctx), do: Access.get(ctx, :max_age, 60)
  defp stale_age(ctx), do: Access.get(ctx, :stale_age, 300)
  defp long_poll_timeout(ctx), do: Access.get(ctx, :long_poll_timeout, 20_000)

  setup :verify_on_exit!

  setup do
    start_link_supervised!({Registry, keys: :duplicate, name: @registry})
    :ok
  end

  describe "validate/2" do
    setup [:with_stack_id_from_test, :ready_stack, :configure_request]

    test "returns 400 for invalid table", ctx do
      assert {:error, %{status: 400} = response} =
               Api.validate(ctx.api, %{table: ".invalid_shape", offset: "-1"})

      assert response_body(response) == %{
               table: [
                 "Invalid zero-length delimited identifier"
               ]
             }
    end

    test "returns error for invalid offset", ctx do
      assert {:error, %{status: 400} = response} =
               Api.validate(ctx.api, %{table: "foo", offset: "invalid"})

      assert response_body(response) == %{offset: ["has invalid format"]}
    end

    test "returns error when table param is missing", ctx do
      assert {:error, %{status: 400} = response} =
               Api.validate(ctx.api, %{offset: "-1"})

      assert response_body(response) == %{table: ["can't be blank"]}
    end

    test "returns error when table does not exist", ctx do
      assert {:error, %{status: 400} = response} =
               Api.validate(ctx.api, %{table: "_val1d_schëmaΦ$.Φtàble", offset: "-1"})

      assert response_body(response) == %{table: ["table not found"]}
    end

    test "returns error for missing shape_handle when offset != -1", ctx do
      assert {:error, %{status: 400} = response} =
               Api.validate(
                 ctx.api,
                 %{table: "public.users", offset: "#{LogOffset.first()}"}
               )

      assert response_body(response) == %{handle: ["can't be blank when offset != -1"]}
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

      assert response_body(response) == %{live: ["can't be true when offset == -1"]}
    end

    test "returns error when offset is out of bounds", ctx do
      Mock.ShapeCache
      |> expect(:get_shape, fn @test_shape, _opts ->
        {@test_shape_handle, @test_offset}
      end)

      invalid_offset = LogOffset.increment(@test_offset)

      assert {:error, %{status: 400} = response} =
               Api.validate(
                 ctx.api,
                 %{
                   table: "public.users",
                   handle: "#{@test_shape_handle}",
                   offset: "#{invalid_offset}"
                 }
               )

      assert response_body(response) == %{offset: ["out of bounds for this shape"]}
    end

    test "the shape handle does not match the shape definition", ctx do
      request_handle = @test_shape_handle <> "-wrong"

      Mock.ShapeCache
      |> expect(:get_shape, fn @test_shape, _opts ->
        nil
      end)
      |> expect(:has_shape?, fn ^request_handle, _opts ->
        true
      end)

      assert {:error, %{status: 400} = response} =
               Api.validate(
                 ctx.api,
                 %{
                   table: "public.users",
                   handle: "#{request_handle}",
                   offset: "-1"
                 }
               )

      assert %{
               message: "The specified shape definition and handle do not match" <> _
             } = response_body(response)
    end

    test "shape for handle does not match the shape definition", ctx do
      request_handle = @test_shape_handle <> "-wrong"

      Mock.ShapeCache
      |> expect(:get_shape, fn @test_shape, _opts ->
        {@test_shape_handle, @before_all_offset}
      end)
      |> expect(:has_shape?, fn ^request_handle, _opts ->
        true
      end)

      assert {:error, %{status: 400} = response} =
               Api.validate(
                 ctx.api,
                 %{
                   table: "public.users",
                   handle: request_handle,
                   offset: "-1"
                 }
               )

      assert %{
               message: "The specified shape definition and handle do not match" <> _
             } = response_body(response)
    end

    test "returns a 409 error when requested shape handle does not exist", ctx do
      request_handle = @test_shape_handle <> "-wrong"

      Mock.ShapeCache
      |> expect(:get_shape, fn @test_shape, _opts ->
        {@test_shape_handle, @before_all_offset}
      end)
      |> expect(:has_shape?, fn ^request_handle, _opts ->
        false
      end)

      assert {:error, %{status: 409} = response} =
               Api.validate(
                 ctx.api,
                 %{
                   table: "public.users",
                   handle: request_handle,
                   offset: "-1"
                 }
               )

      assert response.handle == @test_shape_handle
      assert [%{headers: %{control: "must-refetch"}}] = response_body(response)
    end

    test "creates a new shape when shape handle does not exist and sends a 409 redirecting to the newly created shape",
         ctx do
      new_shape_handle = "new-shape-handle"

      Mock.ShapeCache
      |> expect(:get_shape, fn @test_shape, _opts -> nil end)
      |> stub(:has_shape?, fn @test_shape_handle, _opts -> false end)
      |> expect(:get_or_create_shape_handle, fn @test_shape, _opts ->
        {new_shape_handle, @test_offset}
      end)

      Mock.Storage
      |> stub(:for_shape, fn new_shape_handle, opts -> {new_shape_handle, opts} end)

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
               columns: ["Must include all primary key columns, missing: id"]
             }
    end

    test "honours replica query param for shape", ctx do
      test_shape_handle = "test-shape-without-deltas"
      next_offset = LogOffset.increment(@first_offset)

      Mock.ShapeCache
      |> expect(:get_or_create_shape_handle, fn %{root_table: {"public", "users"}, replica: :full},
                                                _opts ->
        {test_shape_handle, @test_offset}
      end)
      |> stub(:has_shape?, fn ^test_shape_handle, _opts -> true end)
      |> expect(:await_snapshot_start, fn ^test_shape_handle, _ -> :started end)

      Mock.Storage
      |> stub(:for_shape, fn ^test_shape_handle, _opts -> @test_opts end)
      |> expect(:get_chunk_end_log_offset, fn @before_all_offset, _ ->
        next_offset
      end)
      |> expect(:get_log_stream, fn @before_all_offset, _, @test_opts ->
        [Jason.encode!(%{key: "log", value: "foo", headers: %{}, offset: next_offset})]
      end)

      assert {:ok, request} =
               Api.validate(
                 ctx.api,
                 %{
                   table: "public.users",
                   offset: "-1",
                   replica: "full"
                 }
               )

      assert response = Api.serve_shape_log(request)
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
  end

  describe "validate_for_delete/2" do
    setup [:with_stack_id_from_test, :ready_stack, :configure_request]

    setup do
      admin_shape =
        Shape.new!("public.users",
          where: "value = 'admin'",
          inspector: {__MODULE__, []},
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

      Mock.ShapeCache
      |> expect(:get_shape, fn ^admin_shape, _opts ->
        nil
      end)

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

      Mock.ShapeCache
      |> expect(:get_shape, fn ^admin_shape, _opts ->
        {handle, @before_all_offset}
      end)

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

      Mock.ShapeCache
      |> expect(:get_shape, fn ^admin_shape, _opts ->
        {handle, @before_all_offset}
      end)

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

      Mock.ShapeCache
      |> expect(:has_shape?, fn ^handle, _opts -> true end)

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
    Enum.into(body, [])
  end

  describe "serve/1" do
    setup [:with_stack_id_from_test, :ready_stack, :configure_request]

    # test "hold_conn_until_stack_ready"

    test "returns snapshot when offset is -1", ctx do
      Mock.ShapeCache
      |> expect(:get_or_create_shape_handle, fn @test_shape, _opts ->
        {@test_shape_handle, @test_offset}
      end)
      |> stub(:has_shape?, fn @test_shape_handle, _opts -> true end)
      |> expect(:await_snapshot_start, fn @test_shape_handle, _ -> :started end)

      next_offset = LogOffset.increment(@first_offset)

      Mock.Storage
      |> stub(:for_shape, fn @test_shape_handle, _opts -> @test_opts end)
      |> expect(:get_chunk_end_log_offset, fn @before_all_offset, _ ->
        @first_offset
      end)
      |> expect(:get_log_stream, fn @before_all_offset, @first_offset, @test_opts ->
        [Jason.encode!(%{key: "log", value: "foo", headers: %{}, offset: next_offset})]
      end)

      assert {:ok, request} =
               Api.validate(
                 ctx.api,
                 %{table: "public.users", offset: "-1"}
               )

      assert response = Api.serve_shape_log(request)

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
      Mock.ShapeCache
      |> expect(:get_shape, fn @test_shape, _opts ->
        {@test_shape_handle, @test_offset}
      end)
      |> stub(:has_shape?, fn @test_shape_handle, _opts -> true end)
      |> stub(:await_snapshot_start, fn @test_shape_handle, _ -> :started end)

      next_offset = LogOffset.increment(@start_offset_50)
      next_next_offset = LogOffset.increment(next_offset)

      Mock.Storage
      |> stub(:for_shape, fn @test_shape_handle, _opts -> @test_opts end)
      |> expect(:get_chunk_end_log_offset, fn @start_offset_50, _ ->
        next_next_offset
      end)
      |> expect(:get_log_stream, fn @start_offset_50, _, @test_opts ->
        [
          Jason.encode!(%{key: "log1", value: "foo", headers: %{}, offset: next_offset}),
          Jason.encode!(%{key: "log2", value: "bar", headers: %{}, offset: next_next_offset})
        ]
      end)

      assert {:ok, request} =
               Api.validate(
                 ctx.api,
                 %{
                   table: "public.users",
                   offset: "#{@start_offset_50}",
                   handle: @test_shape_handle
                 }
               )

      assert response = Api.serve_shape_log(request)
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
    end

    test "handles live updates", ctx do
      Mock.ShapeCache
      |> expect(:get_shape, fn @test_shape, _opts ->
        {@test_shape_handle, @test_offset}
      end)
      |> stub(:has_shape?, fn @test_shape_handle, _opts -> true end)
      |> stub(:await_snapshot_start, fn @test_shape_handle, _ -> :started end)

      test_pid = self()
      next_offset = LogOffset.increment(@test_offset)

      Mock.Storage
      |> stub(:for_shape, fn @test_shape_handle, _opts -> @test_opts end)
      |> expect(:get_chunk_end_log_offset, fn @test_offset, _ ->
        nil
      end)
      |> expect(:get_log_stream, fn @test_offset, @test_offset, @test_opts ->
        send(test_pid, :got_log_stream)
        []
      end)
      |> expect(:get_log_stream, fn @test_offset, ^next_offset, @test_opts ->
        [Jason.encode!("test result")]
      end)

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

          Api.serve_shape_log(request)
        end)

      assert_receive :got_log_stream, @receive_timeout

      # Simulate new changes arriving
      Registry.dispatch(@registry, @test_shape_handle, fn [{pid, ref}] ->
        send(pid, {ref, :new_changes, next_offset})
      end)

      # The conn process should exit after sending the response
      assert response = Task.await(task)

      assert response.status == 200
      assert response.chunked

      assert response_body(response) == [
               "test result",
               %{"headers" => %{"control" => "up-to-date"}}
             ]

      assert response.offset == next_offset
      assert response.up_to_date
    end

    test "handles shape rotation", ctx do
      Mock.ShapeCache
      |> expect(:get_shape, fn @test_shape, _opts ->
        {@test_shape_handle, @test_offset}
      end)
      |> stub(:has_shape?, fn @test_shape_handle, _opts -> true end)
      |> stub(:await_snapshot_start, fn @test_shape_handle, _ -> :started end)

      test_pid = self()

      Mock.Storage
      |> stub(:for_shape, fn @test_shape_handle, _opts -> @test_opts end)
      |> expect(:get_chunk_end_log_offset, fn @test_offset, _ ->
        nil
      end)
      |> expect(:get_log_stream, fn @test_offset, _, @test_opts ->
        send(test_pid, :got_log_stream)
        []
      end)

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

          Api.serve_shape_log(request)
        end)

      assert_receive :got_log_stream, @receive_timeout

      # Simulate shape rotation
      Registry.dispatch(@registry, @test_shape_handle, fn [{pid, ref}] ->
        send(pid, {ref, :shape_rotation})
      end)

      assert response = Task.await(task)

      assert response.status == 204
      refute response.chunked
      assert response_body(response) == [%{headers: %{control: "up-to-date"}}]
      assert response.up_to_date
    end

    @tag long_poll_timeout: 100
    test "sends an up-to-date response after a timeout if no changes are observed", ctx do
      Mock.ShapeCache
      |> expect(:get_shape, fn @test_shape, _opts ->
        {@test_shape_handle, @test_offset}
      end)
      |> stub(:has_shape?, fn @test_shape_handle, _opts -> true end)
      |> stub(:await_snapshot_start, fn @test_shape_handle, _ -> :started end)

      Mock.Storage
      |> stub(:for_shape, fn @test_shape_handle, _opts -> @test_opts end)
      |> expect(:get_chunk_end_log_offset, fn @test_offset, _ ->
        nil
      end)
      |> expect(:get_log_stream, fn @test_offset, _, @test_opts ->
        []
      end)

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

      assert response = Api.serve_shape_log(request)

      assert response.status == 204
      refute response.chunked

      assert response_body(response) == [%{headers: %{control: "up-to-date"}}]
      assert response.up_to_date
    end
  end

  describe "stack not ready" do
    setup [:with_stack_id_from_test, :configure_request]

    test "returns 503", ctx do
      assert {:error, response} =
               Api.validate(ctx.api, %{table: "public.users", offset: "-1"})

      assert response.status == 503

      assert response_body(response) == %{message: "Stack not ready"}
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

      # Wait for the task process to subscribe to stack events
      wait_until_subscribed(ctx.stack_id, 50, 4)

      Electric.StackSupervisor.dispatch_stack_event(Registry.StackEvents, ctx.stack_id, :ready)

      {:error, response} = Task.await(task)

      assert response.status == 400
    end
  end

  defp wait_until_subscribed(stack_id, _sleep, 0) do
    raise "Timed out waiting for a process to subscribe to stack events in stack \"#{stack_id}\""
  end

  defp wait_until_subscribed(stack_id, sleep, num_attempts) do
    if Registry.lookup(Registry.StackEvents, {:stack_status, stack_id}) != [] do
      :ok
    else
      Process.sleep(sleep)
      wait_until_subscribed(stack_id, sleep, num_attempts - 1)
    end
  end
end
