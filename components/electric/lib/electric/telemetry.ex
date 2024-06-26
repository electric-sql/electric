defmodule Electric.Telemetry do
  use Supervisor
  import Telemetry.Metrics

  def start_link(init_arg) do
    Supervisor.start_link(__MODULE__, init_arg, name: __MODULE__)
  end

  def init(_) do
    children = [
      {:telemetry_poller, measurements: periodic_measurements(), period: 2_000}
    ]

    children
    |> add_statsd_reporter(Application.fetch_env!(:electric, :telemetry_statsd_host))
    |> add_call_home_reporter(Application.fetch_env!(:electric, :telemetry))
    |> Supervisor.init(strategy: :one_for_one)
  end

  defp add_call_home_reporter(children, :enabled) do
    children ++
      [
        {Electric.Telemetry.CallHomeReporter,
         static_info: static_info(),
         metrics: call_home_metrics(),
         first_report_in: {5, :minute},
         reporting_period: {4 * 60, :minute},
         reporter_fn: &Electric.Telemetry.CallHomeReporter.report_home/1}
      ]
  end

  defp add_call_home_reporter(children, _), do: children

  defp add_statsd_reporter(children, nil), do: children

  defp add_statsd_reporter(children, host) do
    children ++
      [
        {TelemetryMetricsStatsd,
         host: host,
         formatter: :datadog,
         global_tags: [instance_id: Electric.instance_id()],
         metrics: statsd_metrics()}
      ]
  end

  def static_info() do
    {total_mem, _, _} = :memsup.get_memory_data()
    processors = :erlang.system_info(:logical_processors)
    {os_family, os_name} = :os.type()
    arch = :erlang.system_info(:system_architecture)

    %{
      electric_version: to_string(Electric.vsn()),
      environment: %{
        os: %{family: os_family, name: os_name},
        arch: to_string(arch),
        cores: processors,
        ram: total_mem,
        electric_instance_id: Electric.instance_id()
      }
    }
  end

  def hash(value), do: :crypto.hash(:sha, value) |> Base.encode16()

  def call_home_metrics() do
    [
      environment: [
        pg_version:
          last_value("electric.postgres.replication_from.start.from_metadata",
            measurement: fn _, x -> x.short_version end,
            reporter_options: [persist_between_sends: true]
          ),
        electric_cluster_uuid:
          last_value("electric.postgres.replication_from.start.from_metadata",
            measurement: fn _, x -> x.cluster end,
            reporter_options: [persist_between_sends: true]
          )
      ],
      resources: [
        uptime:
          last_value("vm.uptime.total",
            unit: :second,
            measurement: &:erlang.convert_time_unit(&1.total, :native, :second)
          ),
        used_memory: summary("vm.memory.total", unit: :byte),
        wal_cache_memory:
          last_value("electric.resources.wal_cache.cache_memory_total", unit: :byte),
        wal_transactions: last_value("electric.resources.wal_cache.transaction_count"),
        oldest_wal_time: last_value("electric.resources.wal_cache.oldest_transaction_timestamp"),
        wal_cache_size: last_value("electric.resources.wal_cache.max_cache_size", unit: :byte)
      ],
      usage: [
        concurrent_clients: summary("electric.resources.clients.connected"),
        electrified_tables: last_value("electric.postgres.migration.electrified_tables"),
        transactions_from_pg:
          counter("electric.postgres.replication_from.transaction.operations"),
        operations_from_pg: sum("electric.postgres.replication_from.transaction.operations"),
        distinct_clients:
          summary("electric.satellite.replication.start.monotonic_time",
            unit: :unique,
            reporter_options: [count_unique: :client_id]
          ),
        distinct_users:
          summary("electric.satellite.replication.start.monotonic_time",
            unit: :unique,
            reporter_options: [count_unique: :user_id]
          ),
        initial_syncs:
          counter("electric.satellite.replication.start.monotonic_time",
            keep: & &1[:initial_sync]
          ),
        transactions_sent_to_clients:
          counter("electric.satellite.replication.transaction_send.operations"),
        operations_sent_to_clients:
          sum("electric.satellite.replication.transaction_send.operations"),
        transactions_received_from_clients:
          counter("electric.satellite.replication.transaction_receive.operations"),
        operations_received_from_clients:
          counter("electric.satellite.replication.transaction_receive.operations"),
        subscriptions_continued:
          counter("electric.satellite.replication.start.continued_subscriptions",
            drop: & &1[:initial_sync]
          ),
        subscriptions_continued_per_client:
          summary("electric.satellite.replication.start.continued_subscriptions",
            drop: & &1[:initial_sync]
          ),
        subscriptions_established:
          counter("electric.satellite.replication.new_subscription.start.monotonic_time"),
        subscriptions_included_tables:
          summary("electric.satellite.replication.new_subscription.start.included_tables"),
        subscriptions_rows_per_shape:
          summary("electric.satellite.replication.new_subscription.shape_data.row_count")
      ]
    ]
  end

  defp statsd_metrics() do
    [
      last_value("vm.memory.total", unit: :byte),
      last_value("vm.memory.processes_used", unit: :byte),
      last_value("vm.memory.binary", unit: :byte),
      last_value("vm.memory.ets", unit: :byte),
      last_value("vm.total_run_queue_lengths.total"),
      last_value("vm.total_run_queue_lengths.cpu"),
      last_value("vm.total_run_queue_lengths.io"),
      last_value("electric.resources.wal_cache.cache_memory_total", unit: :byte),
      last_value("electric.postgres.migration.electrified_tables"),
      counter("electric.postgres.replication_from.start.monotonic_time",
        tags: [:short_version]
      ),
      last_value("electric.postgres.replication_from.start.electrified_tables"),
      sum("electric.postgres.replication_from.transaction.operations"),
      counter("electric.postgres.replication_to.start.monotonic_time"),
      sum("electric.postgres.replication_to.send.transactions"),
      counter("electric.satellite.replication.start.monotonic_time",
        keep: & &1[:initial_sync]
      ),
      counter("electric.satellite.replication.start.monotonic_time", tags: [:client_id]),
      counter("electric.satellite.replication.start.monotonic_time", tags: [:user_id]),
      sum("electric.satellite.replication.transaction_send.operations"),
      sum("electric.satellite.replication.transaction_receive.operations"),
      counter("electric.satellite.replication.bad_transaction.monotonic_time"),
      summary("electric.satellite.replication.new_subscription.start.monotonic_time"),
      summary("electric.satellite.replication.new_subscription.shape_data.duration",
        unit: {:native, :millisecond}
      ),
      summary("electric.satellite.replication.new_subscription.stop.duration",
        unit: {:native, :millisecond}
      ),
      summary("electric.satellite.replication.new_subscription.stop.send_lag",
        unit: {:native, :millisecond}
      )
    ]
    |> Enum.map(&%{&1 | tags: [:instance_id | &1.tags]})
  end

  defp periodic_measurements do
    [
      # A module, function and arguments to be invoked periodically.
      # This function must call :telemetry.execute/3 and a metric must be added above.
      {Electric.Postgres.CachedWal.Api, :emit_telemetry_stats, [[:resources, :wal_cache]]},
      {Electric.Satellite.ClientManager, :emit_telemetry_stats, [[:resources, :clients]]},
      {__MODULE__, :uptime_event, []}
    ]
  end

  def uptime_event do
    :telemetry.execute([:vm, :uptime], %{
      total: :erlang.monotonic_time() - :erlang.system_info(:start_time)
    })
  end
end
