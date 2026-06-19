defmodule ElectricTelemetry.ApplicationTelemetryTest do
  use ExUnit.Case, async: true

  alias ElectricTelemetry.ApplicationTelemetry

  describe "additional_prometheus_metrics" do
    setup do
      {:ok, opts} =
        ElectricTelemetry.validate_options(
          instance_id: "test-instance",
          version: "1.0.0",
          reporters: [prometheus?: true, statsd_host: "localhost", otel_metrics?: true],
          additional_prometheus_metrics: [Telemetry.Metrics.last_value("test.custom.gauge")]
        )

      {:ok, {_flags, children}} = ApplicationTelemetry.init(opts)
      %{children: children}
    end

    test "are exported to the Prometheus reporter", %{children: children} do
      metrics = reporter_metrics(children, :prometheus_metrics)
      assert Enum.any?(metrics, &(&1.name == [:test, :custom, :gauge]))
    end

    test "are not exported to the OTel or StatsD reporters", %{children: children} do
      refute Enum.any?(
               reporter_metrics(children, OtelMetricExporter),
               &(&1.name == [:test, :custom, :gauge])
             )

      refute Enum.any?(
               reporter_metrics(children, TelemetryMetricsStatsd),
               &(&1.name == [:test, :custom, :gauge])
             )
    end
  end

  # `Supervisor.init/2` normalises child specs into maps, nesting the reporter's start args
  # (which carry `:metrics`) inside `:start`. Reporters are identified by their child spec id.
  defp reporter_metrics(children, id) do
    Enum.find_value(children, [], fn
      %{id: ^id, start: {_m, _f, [opts]}} when is_list(opts) -> Keyword.get(opts, :metrics, [])
      _ -> false
    end)
  end

  describe "get_system_memory_usage" do
    test "returns calculated memory stats" do
      case :os.type() do
        {:unix, :darwin} ->
          assert %{
                   total_memory: _,
                   available_memory: _,
                   free_memory: _,
                   used_memory: _,
                   resident_memory: _
                 } = ApplicationTelemetry.get_system_memory_usage(%{})

        _ ->
          assert %{
                   total_memory: _,
                   available_memory: _,
                   buffered_memory: _,
                   cached_memory: _,
                   free_memory: _,
                   used_memory: _,
                   resident_memory: _,
                   total_swap: _,
                   free_swap: _,
                   used_swap: _
                 } = ApplicationTelemetry.get_system_memory_usage(%{})
      end
    end
  end

  describe "ets_table_memory/1" do
    test "emits a [:ets, :table] event per top table with memory/size and name/type tags" do
      table = :ets.new(:"ApplicationTelemetryTest:ets_table_memory", [:public, :named_table])
      for i <- 1..200, do: :ets.insert(table, {i, :binary.copy(<<0>>, 1000)})

      ref = make_ref()
      test_pid = self()
      handler_id = {__MODULE__, :ets_table, ref}

      :telemetry.attach(
        handler_id,
        [:ets, :table],
        fn _event, measurements, metadata, _config ->
          send(test_pid, {ref, measurements, metadata})
        end,
        nil
      )

      on_exit(fn -> :telemetry.detach(handler_id) end)

      ApplicationTelemetry.ets_table_memory(%{
        intervals_and_thresholds: %{top_ets_individual_count: 100}
      })

      events = collect_events(ref, [])

      assert events != []

      for {measurements, metadata} <- events do
        assert %{memory: memory, size: size} = measurements
        assert is_integer(memory) and memory > 0
        assert is_integer(size) and size >= 0
        # Tag values are left as-is (atom name, string type); every reporter
        # stringifies tag values itself, so no to_string/1 at the call site.
        assert %{table_name: name, table_type: type} = metadata
        assert is_atom(name)
        assert is_binary(type)
      end

      # Our named test table should be among the emitted tables.
      assert Enum.any?(events, fn {_measurements, metadata} ->
               metadata.table_name == :"ApplicationTelemetryTest:ets_table_memory"
             end)
    end
  end

  defp collect_events(ref, acc) do
    receive do
      {^ref, measurements, metadata} -> collect_events(ref, [{measurements, metadata} | acc])
    after
      0 -> Enum.reverse(acc)
    end
  end
end
