# These tests exercise real span creation/export through the :opentelemetry SDK, which is
# only a dependency when building for the telemetry target (MIX_TARGET=application, the
# configuration CI runs the test suite with).
if Electric.telemetry_enabled?() do
  defmodule Electric.Plug.ServeShapePlugSampleRateTest do
    # async: false — reconfigures the global :opentelemetry application to export
    # finished spans to the test process.
    use ExUnit.Case, async: false
    use Repatch.ExUnit

    alias Electric.Plug.ServeShapePlug
    alias Electric.Plug.TraceContextPlug
    alias Electric.Postgres.Lsn
    alias Electric.Replication.LogOffset
    alias Electric.Shapes.Api
    alias Electric.Shapes.Shape

    import Support.ComponentSetup

    import Support.TestUtils,
      only: [
        set_status_to_active: 1,
        patch_shape_cache: 1,
        expect_shape_cache: 1,
        patch_storage: 1,
        expect_storage: 1
      ]

    require Record

    Record.defrecordp(
      :span_record,
      :span,
      Record.extract(:span, from_lib: "opentelemetry/include/otel_span.hrl")
    )

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

    @receive_timeout 2000

    @trace_id_hex "0af7651916cd43dd8448eb211c80319c"
    @parent_span_id_hex "b7ad6b7169203331"
    @trace_id String.to_integer(@trace_id_hex, 16)
    @parent_span_id String.to_integer(@parent_span_id_hex, 16)

    @sampled_headers [
      {"traceparent", "00-#{@trace_id_hex}-#{@parent_span_id_hex}-01"},
      {"tracestate", "electric=rate:20"}
    ]
    @unsampled_headers [
      {"traceparent", "00-#{@trace_id_hex}-#{@parent_span_id_hex}-00"},
      {"tracestate", "electric=rate:20"}
    ]

    @moduletag :tmp_dir

    setup [
      :with_stack_id_from_test,
      :with_registry,
      :with_persistent_kv,
      :with_pure_file_storage,
      :with_status_monitor,
      :with_shape_cleaner,
      :with_lsn_tracker
    ]

    setup ctx do
      # Restart the :opentelemetry application with a simple processor that exports
      # every finished span as a `{:span, span}` message to the test process.
      restart_opentelemetry([
        {:otel_simple_processor, %{exporter: {:otel_exporter_pid, self()}}}
      ])

      on_exit(fn -> restart_opentelemetry([]) end)

      {:via, _, {registry_name, registry_key}} =
        Electric.Shapes.Supervisor.name(ctx.stack_id)

      {:ok, _} = Registry.register(registry_name, registry_key, nil)
      set_status_to_active(ctx)

      %{plug_opts: build_plug_opts(ctx)}
    end

    # NOTE: this mutates VM-global telemetry state (stops/starts the :opentelemetry
    # app and erases its persistent-term tracer cache). The module is `async: false`
    # and `on_exit` restores the default (empty) processor pipeline, so other test
    # modules are not affected — but tests in this module must not assume any OTel
    # state set up outside of it.
    defp restart_opentelemetry(processors) do
      Application.stop(:opentelemetry)

      # The OTel API caches per-application tracers in persistent terms. A cached
      # tracer embeds the span-processor pipeline of the tracer provider it was
      # created against, and opentelemetry's create_application_tracers keeps stale
      # cache entries across an application restart — so without this, spans started
      # via OpentelemetryTelemetry (which uses the per-application tracer) would
      # still go to the previous provider's processors. Erase the cache so tracers
      # are re-created against the new provider on app start.
      for {key, _} <- :persistent_term.get(),
          match?({:opentelemetry, _, :tracer, _}, key) do
        :persistent_term.erase(key)
      end

      Application.put_env(:opentelemetry, :processors, processors)
      {:ok, _} = Application.ensure_all_started(:opentelemetry)
    end

    defp build_plug_opts(ctx) do
      Api.plug_opts(
        stack_id: ctx.stack_id,
        inspector: @inspector,
        feature_flags: [],
        stack_ready_timeout: 100,
        long_poll_timeout: 20_000,
        sse_timeout: 20_000,
        max_age: 60,
        stale_age: 300,
        max_concurrent_requests: %{initial: 300, existing: 10_000}
      )
    end

    defp mock_successful_snapshot_response do
      patch_storage(for_shape: fn @test_shape_handle, _opts -> @test_opts end)

      expect_shape_cache(
        get_or_create_shape_handle: fn @test_shape, _stack_id, _opts ->
          {@test_shape_handle, @test_offset}
        end,
        await_snapshot_start: fn @test_shape_handle, _ -> :started end
      )

      patch_shape_cache(has_shape?: fn @test_shape_handle, _opts -> true end)

      expect_storage(
        get_chunk_end_log_offset: fn @before_all_offset, _ -> @first_offset end,
        get_log_stream: fn @before_all_offset, @first_offset, @test_opts ->
          [Jason.encode!(%{key: "log", value: "foo", headers: %{}, offset: @first_offset})]
        end
      )
    end

    # Mirrors the production plug order: TraceContextPlug runs in the router pipeline
    # before ServeShapePlug, in the same process.
    defp request(ctx, headers) do
      headers
      |> Enum.reduce(
        Plug.Test.conn(:get, "/?offset=-1", %{"table" => "public.users"}),
        fn {key, value}, conn -> Plug.Conn.put_req_header(conn, key, value) end
      )
      |> TraceContextPlug.call([])
      |> ServeShapePlug.call(ctx.plug_opts)
    end

    # 5xx requests go through ServeShapePlug's error handling, which re-raises after
    # sending the 500 response (so outer layers see the error too).
    defp request_expecting_crash(ctx, headers) do
      try do
        request(ctx, headers)
      catch
        _kind, _reason -> :ok
      end
    end

    defp crash_load_shape_info do
      Repatch.patch(Api, :load_shape_info, fn _request ->
        raise RuntimeError, "simulated crash"
      end)
    end

    defp attrs_map(attributes), do: :otel_attributes.map(attributes)

    test "sampled remote parent + success: root span stamped with SampleRate=N", ctx do
      mock_successful_snapshot_response()

      conn = request(ctx, @sampled_headers)
      assert conn.status == 200

      assert_receive {:span,
                      span_record(
                        name: "Plug_shape_get",
                        trace_id: @trace_id,
                        parent_span_id: @parent_span_id,
                        attributes: attributes
                      )},
                     @receive_timeout

      assert attrs_map(attributes)["SampleRate"] == 20
    end

    test "sampled remote parent + success: stream_chunk child spans stamped too", ctx do
      mock_successful_snapshot_response()

      conn = request(ctx, @sampled_headers)
      assert conn.status == 200

      assert_receive {:span,
                      span_record(
                        name: "shape_get.plug.stream_chunk",
                        trace_id: @trace_id,
                        attributes: attributes
                      )},
                     @receive_timeout

      assert attrs_map(attributes)["SampleRate"] == 20
    end

    test "sampled remote parent + 5xx: root span stamped with SampleRate=1", ctx do
      crash_load_shape_info()

      request_expecting_crash(ctx, @sampled_headers)

      assert_receive {:span,
                      span_record(
                        name: "Plug_shape_get",
                        trace_id: @trace_id,
                        parent_span_id: @parent_span_id,
                        attributes: attributes
                      )},
                     @receive_timeout

      assert attrs_map(attributes)["SampleRate"] == 1
    end

    test "unsampled remote parent + success: no spans exported", ctx do
      mock_successful_snapshot_response()

      conn = request(ctx, @unsampled_headers)
      assert conn.status == 200

      refute_receive {:span, _}, 100
    end

    test "unsampled remote parent + 5xx: exactly one root span exported in the same trace",
         ctx do
      crash_load_shape_info()

      request_expecting_crash(ctx, @unsampled_headers)

      assert_receive {:span,
                      span_record(
                        name: "Plug_shape_get",
                        trace_id: @trace_id,
                        parent_span_id: @parent_span_id,
                        start_time: start_time,
                        end_time: end_time,
                        status: status,
                        attributes: attributes
                      )},
                     @receive_timeout

      attrs = attrs_map(attributes)
      assert attrs["SampleRate"] == 1
      # Synthesized at response time but backdated to the request start.
      assert start_time <= end_time
      # Standard root-span attributes are carried over.
      assert attrs["shape_req.is_error"] == true
      assert Map.has_key?(attrs, "shape.root_table")
      # The span records the error.
      assert {:status, :error, _message} = status

      # The error-tail span is the only thing exported for this trace.
      refute_receive {:span, _}, 100
    end

    test "no remote parent: spans exported without a SampleRate attribute", ctx do
      mock_successful_snapshot_response()

      conn = request(ctx, [])
      assert conn.status == 200

      assert_receive {:span, span_record(name: "Plug_shape_get", attributes: attributes)},
                     @receive_timeout

      refute Map.has_key?(attrs_map(attributes), "SampleRate")
    end

    test "no remote parent + 5xx: no SampleRate and no synthesized duplicates", ctx do
      crash_load_shape_info()

      request_expecting_crash(ctx, [])

      assert_receive {:span, span_record(name: "Plug_shape_get", attributes: attributes)},
                     @receive_timeout

      refute Map.has_key?(attrs_map(attributes), "SampleRate")
      refute_receive {:span, span_record(name: "Plug_shape_get")}, 100
    end
  end
end
