if Electric.telemetry_enabled?() and Code.ensure_loaded?(ElectricTelemetry.Reporters.Prometheus) do
  defmodule Electric.StackSupervisor.TelemetryTest do
    use ExUnit.Case, async: true

    alias Electric.StackSupervisor.Telemetry

    describe "prometheus_metrics/0" do
      test "the curated stack metrics are scrapable via the Prometheus reporter" do
        name = :"test_prometheus_#{System.unique_integer([:positive])}"

        # Build the core through the real reporter so distribution buckets are applied, exactly
        # as ApplicationTelemetry does for the /metrics endpoint.
        {mod, opts} =
          ElectricTelemetry.Reporters.Prometheus.child_spec(
            %{reporters: %{prometheus?: true}},
            name: name,
            metrics: Telemetry.prometheus_metrics()
          )

        start_supervised!({mod, opts})

        # The core attaches its telemetry handlers asynchronously (via a `:setup` message).
        # A scrape is a synchronous call to the registry, so it drains that message and
        # guarantees the handlers are attached before we emit events below.
        _ = TelemetryMetricsPrometheus.Core.scrape(name)

        stack_id = "test-stack"

        :telemetry.execute(
          [:electric, :shapes, :total_shapes],
          %{count: 7, count_indexed: 4, count_unindexed: 3},
          %{stack_id: stack_id}
        )

        :telemetry.execute(
          [:electric, :shapes, :active_shapes],
          %{count: 3},
          %{stack_id: stack_id}
        )

        :telemetry.execute(
          [:electric, :postgres, :replication],
          %{pg_wal_offset: 1, slot_retained_wal_size: 1234, slot_confirmed_flush_lsn_lag: 56},
          %{stack_id: stack_id}
        )

        :telemetry.execute(
          [:electric, :postgres, :replication, :transaction_received],
          %{receive_lag: 12, bytes: 0, count: 1, operations: 1},
          %{stack_id: stack_id}
        )

        scrape = TelemetryMetricsPrometheus.Core.scrape(name)

        # defined shapes
        assert scrape =~ "electric_shapes_total_shapes_count 7"
        # active shapes
        assert scrape =~ "electric_shapes_active_shapes_count 3"
        # retained WAL size
        assert scrape =~ "electric_postgres_replication_slot_retained_wal_size 1234"
        # byte-based replication lag
        assert scrape =~ "electric_postgres_replication_slot_confirmed_flush_lsn_lag 56"
        # time-based replication lag (histogram)
        assert scrape =~ "electric_postgres_replication_transaction_received_receive_lag"
      end

      test "per-status HTTP request counts are scrapable" do
        name = :"test_prometheus_status_#{System.unique_integer([:positive])}"

        {mod, opts} =
          ElectricTelemetry.Reporters.Prometheus.child_spec(
            %{reporters: %{prometheus?: true}},
            name: name,
            metrics: Telemetry.prometheus_metrics()
          )

        start_supervised!({mod, opts})
        _ = TelemetryMetricsPrometheus.Core.scrape(name)

        for status <- [200, 200, 409] do
          :telemetry.execute(
            [:electric, :plug, :serve_shape],
            %{count: 1},
            %{status: status, known_error: false, live: false, stack_id: "test-stack"}
          )
        end

        scrape = TelemetryMetricsPrometheus.Core.scrape(name)

        assert scrape =~ ~r/electric_plug_serve_shape_requests_count\{status="200"\} 2/
        assert scrape =~ ~r/electric_plug_serve_shape_requests_count\{status="409"\} 1/
      end

      test "admission control metrics are scrapable" do
        name = :"test_prometheus_admission_#{System.unique_integer([:positive])}"

        {mod, opts} =
          ElectricTelemetry.Reporters.Prometheus.child_spec(
            %{reporters: %{prometheus?: true}},
            name: name,
            metrics: Telemetry.prometheus_metrics()
          )

        start_supervised!({mod, opts})
        _ = TelemetryMetricsPrometheus.Core.scrape(name)

        :telemetry.execute(
          [:electric, :admission_control, :acquire],
          %{count: 1, current: 5, limit: 10},
          %{stack_id: "test-stack", kind: :shape}
        )

        for _ <- 1..2 do
          :telemetry.execute(
            [:electric, :admission_control, :reject],
            %{count: 1, limit: 10},
            %{stack_id: "test-stack", reason: :overloaded, kind: :shape, current: 11}
          )
        end

        scrape = TelemetryMetricsPrometheus.Core.scrape(name)

        # current concurrency gauge
        assert scrape =~ ~r/electric_admission_control_acquire_current\{kind="shape"\} 5/
        # rejection count
        assert scrape =~ ~r/electric_admission_control_reject_count\{kind="shape"\} 2/
      end
    end

    describe "shape_dir_group_depth/1" do
      alias Electric.ShapeCache.PureFileStorage

      # The depth must land exactly on the shape-handle directory produced by the
      # real storage code, for both deployment layouts. We derive the expected
      # depth from PureFileStorage.shape_data_dir/3 rather than hard-coding it, so
      # config/sharding drift can't silently re-introduce the off-by-one bug.
      defp expected_depth(walk_root, shape_storage_dir, stack_id) do
        base_path = Path.join(shape_storage_dir, stack_id)
        shape_dir = PureFileStorage.shape_data_dir(base_path, "00000000-0000")
        length(Path.split(shape_dir)) - length(Path.split(walk_root))
      end

      test "standalone layout: walk root is the bare storage dir, shapes nested under shapes/" do
        # ELECTRIC_STORAGE_DIR walked directly; PureFileStorage at <root>/shapes.
        walk_root = "/var/electric"
        shape_storage_dir = Path.join(walk_root, "shapes")
        stack_id = "single-stack"

        config = %{
          stack_id: stack_id,
          storage_dir: walk_root,
          storage: {PureFileStorage, storage_dir: shape_storage_dir}
        }

        depth = Telemetry.shape_dir_group_depth(config)

        # <root>/shapes/<stack_id>/<p1>/<p2>/<handle> => depth 5.
        assert depth == 5
        assert depth == expected_depth(walk_root, shape_storage_dir, stack_id)
        # Guard the exact bug: bucketing at 4 would key by the <p2> shard prefix.
        refute depth == 4
      end

      test "cloud layout: walk root is the per-tenant shapes dir" do
        # Cloud passes the per-tenant <root>/<tenant_id>/shapes as BOTH the walk
        # root and the PureFileStorage storage_dir.
        tenant_id = "tenant-abc"
        walk_root = Path.join(["/var/electric", tenant_id, "shapes"])
        shape_storage_dir = walk_root

        config = %{
          stack_id: tenant_id,
          storage_dir: walk_root,
          storage: {PureFileStorage, storage_dir: shape_storage_dir}
        }

        depth = Telemetry.shape_dir_group_depth(config)

        # <walk_root>/<tenant_id>/<p1>/<p2>/<handle> => depth 4.
        assert depth == 4
        assert depth == expected_depth(walk_root, shape_storage_dir, tenant_id)
      end

      test "non-file storage backends disable grouping" do
        config = %{
          stack_id: "s",
          storage_dir: "/var/electric",
          storage: {Electric.ShapeCache.InMemoryStorage, []}
        }

        assert Telemetry.shape_dir_group_depth(config) == nil
      end
    end
  end
end
