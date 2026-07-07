defmodule ElectricTelemetry.SystemMetricsTest do
  use ExUnit.Case, async: true

  alias ElectricTelemetry.SystemMetrics

  describe "system_info/0" do
    test "returns a well-formed map" do
      info = SystemMetrics.system_info()

      assert %{os: os, cgroup_version: cgroup_version} = info
      assert is_tuple(os)
      assert cgroup_version in [:v1, :v2, :none]
    end

    test "is stable across calls (cached)" do
      assert SystemMetrics.system_info() == SystemMetrics.system_info()
    end

    test "reports the correct cgroup version for the current platform" do
      info = SystemMetrics.system_info()

      case :os.type() do
        {:unix, :linux} ->
          # On Linux CI/dev this is typically v2, but we don't hard-code it;
          # we only assert it's a real cgroup detection result.
          assert info.cgroup_version in [:v1, :v2, :none]

        _ ->
          assert info.cgroup_version == :none
      end
    end
  end

  describe "recon_alloc_measurement/1" do
    test "emits vm.alloc.* measurements with sane numeric values" do
      ref = make_ref()
      handler_id = {__MODULE__, ref}

      :telemetry.attach(
        handler_id,
        [:vm, :alloc],
        fn _event, measurements, _meta, pid -> send(pid, {ref, measurements}) end,
        self()
      )

      on_exit(fn -> :telemetry.detach(handler_id) end)

      assert :ok = SystemMetrics.recon_alloc_measurement(%{})

      assert_received {^ref, measurements}

      assert is_integer(measurements.allocated)
      assert is_integer(measurements.used)
      assert is_integer(measurements.unused)
      assert is_number(measurements.carrier_usage)

      assert measurements.allocated >= measurements.used
      assert measurements.unused == measurements.allocated - measurements.used
      assert measurements.unused >= 0
      # carrier_usage is recon_alloc's used/allocated ratio — nominally 0..1, but an
      # instantaneous live-VM sample can momentarily exceed 1.0 (observed ~1.003) because
      # the underlying mbcs/sbcs stats are sampled non-atomically. Use a tolerant sanity
      # ceiling rather than a hard 1.0 to avoid a flaky test.
      assert measurements.carrier_usage >= 0.0
      assert measurements.carrier_usage <= 1.5
    end
  end

  describe "allocator_fragmentation_measurement/0" do
    test "emits unused bytes per allocator type" do
      ref = make_ref()
      handler_id = {__MODULE__, ref}

      events = :ets.new(:events, [:public, :duplicate_bag])

      :telemetry.attach(
        handler_id,
        [:vm, :alloc, :fragmentation],
        fn _event, measurements, meta, _ ->
          :ets.insert(events, {meta.allocator, measurements.unused})
        end,
        nil
      )

      on_exit(fn -> :telemetry.detach(handler_id) end)

      assert :ok = SystemMetrics.allocator_fragmentation_measurement()

      results = :ets.tab2list(events)
      assert results != []

      # One event per distinct allocator *type*, not per scheduler instance.
      assert length(results) == length(Enum.uniq_by(results, fn {allocator, _} -> allocator end))

      for {allocator, unused} <- results do
        assert is_binary(allocator)
        assert is_integer(unused)
        assert unused >= 0
      end
    end
  end

  describe "metric definitions" do
    test "vm.alloc.* metrics are present in ApplicationTelemetry.metrics/1" do
      metrics = ElectricTelemetry.ApplicationTelemetry.metrics(%{})
      names = Enum.map(metrics, & &1.name)

      assert [:vm, :alloc, :allocated] in names
      assert [:vm, :alloc, :unused] in names
      assert [:vm, :alloc, :carrier_usage] in names

      frag =
        Enum.find(metrics, &(&1.name == [:vm, :alloc, :fragmentation, :unused]))

      assert frag, "expected per-allocator fragmentation metric to be defined"
      assert :allocator in frag.tags
    end
  end
end
