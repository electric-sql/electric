defmodule Electric.StackSupervisor.Telemetry do
  require Logger

  def configure(config) do
    # Set shared OpenTelemetry span attributes for the given stack. They are stored in
    # persistent_term so it doesn't matter which process this function is called from.
    telemetry_span_attrs = Access.get(config, :telemetry_span_attrs, %{})

    if is_map(telemetry_span_attrs) and map_size(telemetry_span_attrs) > 0 do
      Electric.Telemetry.OpenTelemetry.set_stack_span_attrs(
        config.stack_id,
        telemetry_span_attrs
      )
    end

    child_spec(config)
  end

  def child_spec(%{stack_telemetry: stack_telemetry}), do: stack_telemetry

  if Code.ensure_loaded?(ElectricTelemetry.StackTelemetry) do
    def child_spec(config) when is_map(config) do
      telemetry_opts =
        config.telemetry_opts
        |> Keyword.put(:stack_id, config.stack_id)
        |> Keyword.put(:storage_dir, config.storage_dir)
        # Always enable default periodic measurements in addition to the user-provided ones
        |> Keyword.update(
          :periodic_measurements,
          default_periodic_measurements(config),
          &(default_periodic_measurements(config) ++ &1)
        )
        # Add metrics for the default periodic measurements regardless of whether the
        # measurements themselves are occuring.
        |> Keyword.update(
          :additional_metrics,
          default_metrics_from_periodic_measurements(),
          &(default_metrics_from_periodic_measurements() ++ &1)
        )

      {ElectricTelemetry.StackTelemetry, telemetry_opts}
    end

    defp default_metrics_from_periodic_measurements do
      [
        Telemetry.Metrics.last_value("electric.shapes.total_shapes.count"),
        Telemetry.Metrics.last_value("electric.shapes.active_shapes.count"),
        Telemetry.Metrics.last_value("electric.shape_db.write_buffer.pending_writes.count"),
        Telemetry.Metrics.last_value("electric.postgres.replication.pg_wal_offset"),
        Telemetry.Metrics.last_value("electric.postgres.replication.slot_retained_wal_size",
          unit: :byte
        ),
        Telemetry.Metrics.last_value("electric.postgres.replication.slot_confirmed_flush_lsn_lag",
          unit: :byte
        ),
        Telemetry.Metrics.last_value("electric.shape_db.sqlite.total_memory", unit: :byte),
        Telemetry.Metrics.last_value("electric.shape_db.sqlite.disk_size", unit: :byte)
      ]
    end

    defp default_periodic_measurements(%{stack_id: stack_id} = config) do
      [
        {__MODULE__, :count_shapes, [stack_id]},
        {__MODULE__, :report_write_buffer_size, [stack_id]},
        {__MODULE__, :report_retained_wal_size, [stack_id, config.replication_opts[:slot_name]]},
        {__MODULE__, :report_disk_usage, [stack_id]},
        {__MODULE__, :report_shape_db_stats, [stack_id]}
      ]
    end

    def count_shapes(stack_id, _telemetry_opts) do
      # Telemetry is started before everything else in the stack, so we need to handle
      # the case where the shape cache is not started yet.
      with num_shapes when is_integer(num_shapes) <- Electric.ShapeCache.count_shapes(stack_id) do
        Electric.Telemetry.OpenTelemetry.execute(
          [:electric, :shapes, :total_shapes],
          %{count: num_shapes},
          %{stack_id: stack_id}
        )
      end

      Electric.Telemetry.OpenTelemetry.execute(
        [:electric, :shapes, :active_shapes],
        %{count: Electric.Shapes.ConsumerRegistry.active_consumer_count(stack_id)},
        %{stack_id: stack_id}
      )
    end

    def report_write_buffer_size(stack_id, _telemetry_opts) do
      alias Electric.ShapeCache.ShapeStatus.ShapeDb

      pending_count = ShapeDb.pending_buffer_size(stack_id)

      Electric.Telemetry.OpenTelemetry.execute(
        [:electric, :shape_db, :write_buffer, :pending_writes],
        %{count: pending_count},
        %{stack_id: stack_id}
      )
    rescue
      ArgumentError -> :ok
    end

    @min_signed_int8 -2 ** 63
    @retained_wal_size_query """
    SELECT
      (pg_current_wal_lsn() - '0/0' + #{@min_signed_int8})::int8 AS pg_wal_offset,
      pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)::int8 AS retained_wal_size,
      pg_wal_lsn_diff(pg_current_wal_lsn(), confirmed_flush_lsn)::int8 AS confirmed_flush_lsn_lag
    FROM
      pg_replication_slots
    WHERE
      slot_name = $1
    """

    @doc false
    @spec report_retained_wal_size(Electric.stack_id(), binary(), map()) :: :ok
    def report_retained_wal_size(stack_id, slot_name, _telemetry_opts) do
      try do
        %Postgrex.Result{rows: [[pg_wal_offset, retained_wal_size, confirmed_flush_lsn_lag]]} =
          Postgrex.query!(
            Electric.Connection.Manager.admin_pool(stack_id),
            @retained_wal_size_query,
            [slot_name],
            timeout: 3_000,
            deadline: 3_000
          )

        # The query above can return `-1` for `confirmed_flush_lsn_lag` which means that Electric
        # is caught up with Postgres' replication stream.
        # This is a confusing stat if we're measuring in bytes, so use 0 as the bottom limit.

        Electric.Telemetry.OpenTelemetry.execute(
          [:electric, :postgres, :replication],
          %{
            # The absolute value of pg_current_wal_lsn() doesn't convey any useful info but by
            # plotting its rate of change we can see how fast the WAL is growing.
            #
            # We shift the absolute value of pg_current_wal_lsn() by -2**63 in the query above
            # to make sure it fits inside the signed 64-bit integer type expected by the
            # OpenTelemetry Protocol,
            pg_wal_offset: pg_wal_offset,
            slot_retained_wal_size: retained_wal_size,
            slot_confirmed_flush_lsn_lag: max(0, confirmed_flush_lsn_lag)
          },
          %{stack_id: stack_id}
        )
      catch
        :exit, {:noproc, _} ->
          :ok

        # catch all errors to not log them as errors, those are reporing issues at best
        type, reason ->
          Logger.warning(
            "Failed to query retained WAL size\nError: #{Exception.format(type, reason)}",
            stack_id: stack_id,
            slot_name: slot_name
          )
      end
    end

    def report_disk_usage(stack_id, _telemetry_opts) do
      case ElectricTelemetry.DiskUsage.current(stack_id) do
        {:ok, usage_bytes, measurement_duration} ->
          Electric.Telemetry.OpenTelemetry.execute(
            [:electric, :storage, :used],
            %{bytes: usage_bytes, measurement_duration: measurement_duration},
            %{stack_id: stack_id}
          )

        :pending ->
          :ok
      end
    end

    def report_shape_db_stats(stack_id, _telemetry_opts) do
      case Electric.ShapeCache.ShapeStatus.ShapeDb.statistics(stack_id) do
        {:ok, stats} ->
          Electric.Telemetry.OpenTelemetry.execute(
            [:electric, :shape_db, :sqlite],
            stats,
            %{stack_id: stack_id}
          )

        _ ->
          :ok
      end
    end
  else
    def child_spec(_), do: nil
  end
end
