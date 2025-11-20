defmodule ElectricTelemetry.Reporters.CallHomeReporter do
  import Telemetry.Metrics

  def child_spec(telemetry_opts, reporter_opts) do
    if call_home_url = get_in(telemetry_opts, [:reporters, :call_home_url]) do
      start_opts =
        Keyword.merge(
          [
            static_info: static_info(telemetry_opts),
            call_home_url: call_home_url,
            first_report_in: {2, :minute},
            reporting_period: {30, :minute}
          ],
          reporter_opts
        )

      {ElectricTelemetry.CallHomeReporter, start_opts}
    end
  end

  # IMPORTANT: these metrics are validated on the receiver side, so if you change them,
  #            make sure you also change the receiver
  def application_metrics do
    [
      resources: [
        uptime:
          last_value("vm.uptime.total",
            unit: :second,
            measurement: &:erlang.convert_time_unit(&1.total, :native, :second)
          ),
        used_memory: summary("vm.memory.total", unit: :byte),
        run_queue_total: summary("vm.total_run_queue_lengths.total"),
        run_queue_cpu: summary("vm.total_run_queue_lengths.cpu"),
        run_queue_io: summary("vm.total_run_queue_lengths.io")
      ],
      system: [
        load_avg1: last_value("system.load_percent.avg1"),
        load_avg5: last_value("system.load_percent.avg5"),
        load_avg15: last_value("system.load_percent.avg15"),
        memory_free: last_value("system.memory.free_memory"),
        memory_used: last_value("system.memory.used_memory"),
        memory_free_percent: last_value("system.memory_percent.free_memory"),
        memory_used_percent: last_value("system.memory_percent.used_memory"),
        swap_free: last_value("system.swap.free"),
        swap_used: last_value("system.swap.used"),
        swap_free_percent: last_value("system.swap_percent.free"),
        swap_used_percent: last_value("system.swap_percent.used")
      ]
    ]
  end

  # IMPORTANT: these metrics are validated on the receiver side, so if you change them,
  #            make sure you also change the receiver
  def stack_metrics(stack_id) do
    [
      environment:
        [
          pg_version:
            last_value("electric.postgres.info_looked_up.pg_version",
              reporter_options: [persist_between_sends: true]
            )
        ]
        |> ElectricTelemetry.keep_for_stack(stack_id),
      usage:
        [
          inbound_bytes:
            sum("electric.postgres.replication.transaction_received.bytes", unit: :byte),
          inbound_transactions: sum("electric.postgres.replication.transaction_received.count"),
          inbound_operations:
            sum("electric.postgres.replication.transaction_received.operations"),
          stored_bytes: sum("electric.storage.transaction_stored.bytes", unit: :byte),
          stored_transactions: sum("electric.storage.transaction_stored.count"),
          stored_operations: sum("electric.storage.transaction_stored.operations"),
          total_used_storage_kb: last_value("electric.storage.used", unit: {:byte, :kilobyte}),
          total_shapes: last_value("electric.shapes.total_shapes.count"),
          active_shapes:
            summary("electric.plug.serve_shape.monotonic_time",
              unit: :unique,
              reporter_options: [count_unique: :shape_handle],
              keep: &(&1.status < 300)
            ),
          unique_clients:
            summary("electric.plug.serve_shape.monotonic_time",
              unit: :unique,
              reporter_options: [count_unique: :client_ip],
              keep: &(&1.status < 300)
            ),
          sync_requests:
            counter("electric.plug.serve_shape.monotonic_time", keep: &(&1[:live] != true)),
          live_requests: counter("electric.plug.serve_shape.monotonic_time", keep: & &1[:live]),
          served_bytes: sum("electric.plug.serve_shape.bytes", unit: :byte),
          wal_size: summary("electric.postgres.replication.wal_size", unit: :byte)
        ]
        |> ElectricTelemetry.keep_for_stack(stack_id)
    ]
  end

  def static_info(telemetry_opts) do
    {total_mem, _, _} = :memsup.get_memory_data()
    processors = :erlang.system_info(:logical_processors)
    {os_family, os_name} = :os.type()
    arch = :erlang.system_info(:system_architecture)

    %{
      electric_version: telemetry_opts.version,
      environment: %{
        os: %{family: os_family, name: os_name},
        arch: to_string(arch),
        cores: processors,
        ram: total_mem,
        electric_instance_id: Map.fetch!(telemetry_opts, :instance_id),
        electric_installation_id: Map.get(telemetry_opts, :installation_id, "electric_default")
      }
    }
  end
end
