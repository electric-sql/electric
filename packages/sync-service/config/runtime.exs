import Config
import Dotenvy

config :elixir, :time_zone_database, Tz.TimeZoneDatabase

if config_env() in [:dev, :test] do
  source!([".env.#{config_env()}", ".env.#{config_env()}.local", System.get_env()])
else
  source!([System.get_env()])
end

test_log_level =
  if config_env() == :test,
    do: env!("ELECTRIC_TEST_LOG_LEVEL", &Electric.Config.parse_log_level!/1, :error)

log_level =
  env!("ELECTRIC_LOG_LEVEL", &Electric.Config.parse_log_level!/1, test_log_level) || :info

config :logger, level: log_level

config :logger, :default_formatter,
  # Doubled line breaks serve as long message boundaries
  format: "\n$time $metadata[$level] $message\n",
  metadata: [:pid, :shape_handle, :request_id],
  colors: [enabled: env!("ELECTRIC_LOG_COLORS", :boolean!, true)]

# Enable this to get **very noisy** but useful messages from BEAM about
# processes being started, stopped and crashes.
# https://www.erlang.org/doc/apps/sasl/error_logging#sasl-reports
sasl? = env!("ELECTRIC_LOG_OTP_REPORTS", :boolean, false)

config :logger,
  handle_otp_reports: false,
  handle_sasl_reports: sasl?

if config_env() == :test do
  config :logger, :default_handler, level: test_log_level
end

# Disable the default telemetry_poller process since we start our own in
# `Electric.Telemetry.{ApplicationTelemetry, StackTelemetry}`.
config :telemetry_poller, default: false

service_name = env!("ELECTRIC_SERVICE_NAME", :string, "electric")
instance_id = env!("ELECTRIC_INSTANCE_ID", :string, Electric.Utils.uuid4())

replication_database_url_config = env!("DATABASE_URL", &Electric.Config.parse_postgresql_uri!/1)

# TODO: Remove this in a minor version bump
old_pooled_database_url_config =
  env!(
    "ELECTRIC_QUERY_DATABASE_URL",
    &Electric.Config.parse_postgresql_uri!/1,
    replication_database_url_config
  )

pooled_database_url_config =
  env!(
    "ELECTRIC_POOLED_DATABASE_URL",
    &Electric.Config.parse_postgresql_uri!/1,
    old_pooled_database_url_config
  )

database_ipv6_config = env!("ELECTRIC_DATABASE_USE_IPV6", :boolean, false)
database_cacertfile = env!("ELECTRIC_DATABASE_CA_CERTIFICATE_FILE", :string, nil)

if replication_database_url_config[:sslmode] == :disable and not is_nil(database_cacertfile) do
  raise Dotenvy.Error,
    message:
      "When ELECTRIC_DATABASE_CA_CERTIFICATE_FILE is set, " <>
        "sslmode must be omitted or set to a value other than 'disable'"
end

extra_conn_opts =
  Enum.reject(
    [ipv6: database_ipv6_config, cacertfile: database_cacertfile],
    fn {_, val} -> is_nil(val) end
  )

config :electric,
  replication_connection_opts: replication_database_url_config ++ extra_conn_opts,
  query_connection_opts: pooled_database_url_config ++ extra_conn_opts

enable_integration_testing? = env!("ELECTRIC_ENABLE_INTEGRATION_TESTING", :boolean, nil)
cache_max_age = env!("ELECTRIC_CACHE_MAX_AGE", :integer, nil)
cache_stale_age = env!("ELECTRIC_CACHE_STALE_AGE", :integer, nil)
statsd_host = env!("ELECTRIC_STATSD_HOST", :string?, nil)

chunk_bytes_threshold = env!("ELECTRIC_SHAPE_CHUNK_BYTES_THRESHOLD", :integer, nil)

storage_dir = env!("ELECTRIC_STORAGE_DIR", :string, "./persistent")

shape_path = Path.join(storage_dir, "./shapes")
persistent_state_path = Path.join(storage_dir, "./state")

persistent_kv_spec =
  env!(
    "ELECTRIC_PERSISTENT_STATE",
    fn storage ->
      case String.downcase(storage) do
        "memory" ->
          {Electric.PersistentKV.Memory, :new!, []}

        "file" ->
          {Electric.PersistentKV.Filesystem, :new!, root: persistent_state_path}

        _ ->
          raise Dotenvy.Error, message: "ELECTRIC_PERSISTENT_STATE must be one of: MEMORY, FILE"
      end
    end,
    nil
  )

if persistent_kv_spec do
  {m, f, a} = persistent_kv_spec
  persistent_kv = apply(m, f, [a])
  Electric.Config.persist_installation_id(persistent_kv, instance_id)
end

storage_spec =
  env!(
    "ELECTRIC_STORAGE",
    fn storage ->
      case String.downcase(storage) do
        "memory" ->
          {Electric.ShapeCache.InMemoryStorage, []}

        legacy_file when legacy_file in ["file", "legacy_file"] ->
          raise RuntimeError,
            message:
              "#{inspect(legacy_file)} storage is deprecated. Please change to \"fast_file\""

        "fast_file" ->
          {Electric.ShapeCache.PureFileStorage, storage_dir: shape_path}

        "crashing_file" ->
          num_calls_until_crash =
            env!("CRASHING_FILE_ELECTRIC_STORAGE__NUM_CALLS_UNTIL_CRASH", :integer)

          {Electric.ShapeCache.CrashingFileStorage,
           storage_dir: shape_path, num_calls_until_crash: num_calls_until_crash}

        _ ->
          raise Dotenvy.Error, message: "storage must be one of: MEMORY, FAST_FILE, LEGACY_FILE"
      end
    end,
    nil
  )

replication_stream_id =
  env!(
    "ELECTRIC_REPLICATION_STREAM_ID",
    fn replication_stream_id ->
      {:ok, parsed_id} =
        replication_stream_id
        |> Electric.Postgres.Identifiers.parse_unquoted_identifier()

      parsed_id
    end,
    nil
  )

prometheus_port = env!("ELECTRIC_PROMETHEUS_PORT", :integer, nil)

call_home_telemetry_url =
  env!(
    "ELECTRIC_TELEMETRY_URL",
    &Electric.Config.parse_telemetry_url!/1,
    nil
  )

shape_hibernate_after =
  env!("ELECTRIC_SHAPE_HIBERNATE_AFTER", &Electric.Config.parse_human_readable_time!/1, nil)

system_metrics_poll_interval =
  env!(
    "ELECTRIC_SYSTEM_METRICS_POLL_INTERVAL",
    &Electric.Config.parse_human_readable_time!/1,
    nil
  )

otel_export_period =
  env!(
    "ELECTRIC_OTEL_EXPORT_PERIOD",
    &Electric.Config.parse_human_readable_time!/1,
    nil
  )

# The provided database id is relevant if you had used v0.8 and want to keep the storage
# instead of having hanging files. We use a provided value as stack id, but nothing else.
provided_database_id = env!("ELECTRIC_DATABASE_ID", :string, nil)

# Handle authentication configuration
insecure = env!("ELECTRIC_INSECURE", :boolean, false)
secret = env!("ELECTRIC_SECRET", :string, nil)

if config_env() != :test do
  Electric.Config.validate_security_config!(secret, insecure)
end

config :electric,
  provided_database_id: provided_database_id,
  allow_shape_deletion?: enable_integration_testing?,
  cache_max_age: cache_max_age,
  cache_stale_age: cache_stale_age,
  chunk_bytes_threshold: chunk_bytes_threshold,
  # The ELECTRIC_EXPERIMENTAL_MAX_SHAPES is undocumented and will be removed in future versions.
  max_shapes: env!("ELECTRIC_EXPERIMENTAL_MAX_SHAPES", :integer, nil),
  expiry_batch_size: env!("ELECTRIC_EXPERIMENTAL_EXPIRY_BATCH_SIZE", :integer, nil),
  # Used in telemetry
  instance_id: instance_id,
  call_home_telemetry?: env!("ELECTRIC_USAGE_REPORTING", :boolean, config_env() == :prod),
  telemetry_url: call_home_telemetry_url,
  system_metrics_poll_interval: system_metrics_poll_interval,
  otel_export_period: otel_export_period,
  otel_per_process_metrics?: env!("ELECTRIC_OTEL_PER_PROCESS_METRICS", :boolean, nil),
  otel_sampling_ratio: env!("ELECTRIC_OTEL_SAMPLING_RATIO", :float, nil),
  metrics_sampling_ratio: env!("ELECTRIC_METRICS_SAMPLING_RATIO", :float, nil),
  telemetry_top_process_count: env!("ELECTRIC_TELEMETRY_TOP_PROCESS_COUNT", :integer, nil),
  telemetry_long_gc_threshold: env!("ELECTRIC_TELEMETRY_LONG_GC_THRESHOLD", :integer, nil),
  telemetry_long_schedule_threshold:
    env!("ELECTRIC_TELEMETRY_LONG_SCHEDULE_THRESHOLD", :integer, nil),
  telemetry_long_message_queue_enable_threshold:
    env!("ELECTRIC_TELEMETRY_LONG_MESSAGE_QUEUE_ENABLE_THRESHOLD", :integer, nil),
  telemetry_long_message_queue_disable_threshold:
    env!("ELECTRIC_TELEMETRY_LONG_MESSAGE_QUEUE_DISABLE_THRESHOLD", :integer, nil),
  telemetry_statsd_host: statsd_host,
  prometheus_port: prometheus_port,
  db_pool_size: env!("ELECTRIC_DB_POOL_SIZE", :integer, nil),
  replication_stream_id: replication_stream_id,
  replication_slot_temporary?: env!("CLEANUP_REPLICATION_SLOTS_ON_SHUTDOWN", :boolean, nil),
  replication_slot_temporary_random_name?:
    env!("ELECTRIC_TEMPORARY_REPLICATION_SLOT_USE_RANDOM_NAME", :boolean, nil),
  # The ELECTRIC_EXPERIMENTAL_MAX_TXN_SIZE is undocumented and will be removed in future versions.
  max_txn_size: env!("ELECTRIC_EXPERIMENTAL_MAX_TXN_SIZE", :integer, nil),
  service_port: env!("ELECTRIC_PORT", :integer, nil),
  shape_hibernate_after: shape_hibernate_after,
  storage_dir: storage_dir,
  storage: storage_spec,
  cleanup_interval_ms:
    env!("ELECTRIC_CLEANUP_INTERVAL_MS", &Electric.Config.parse_human_readable_time!/1, nil),
  profile_where_clauses?: env!("ELECTRIC_PROFILE_WHERE_CLAUSES", :boolean, false),
  persistent_kv: persistent_kv_spec,
  listen_on_ipv6?: env!("ELECTRIC_LISTEN_ON_IPV6", :boolean, nil),
  secret: secret,
  publication_alter_debounce_ms:
    env!(
      "ELECTRIC_PUBLICATION_ALTER_DEBOUNCE_TIME",
      &Electric.Config.parse_human_readable_time!/1,
      nil
    ),
  process_registry_partitions: env!("ELECTRIC_TWEAKS_PROCESS_REGISTRY_PARTITIONS", :integer, nil),
  http_api_num_acceptors: env!("ELECTRIC_TWEAKS_HTTP_API_NUM_ACCEPTORS", :integer, 100),
  tcp_send_timeout:
    env!("ELECTRIC_TCP_SEND_TIMEOUT", &Electric.Config.parse_human_readable_time!/1, nil),
  feature_flags: env!("ELECTRIC_FEATURE_FLAGS", &Electric.Config.parse_feature_flags/1, nil),
  manual_table_publishing?: env!("ELECTRIC_MANUAL_TABLE_PUBLISHING", :boolean, nil),
  publication_refresh_period:
    env!(
      "ELECTRIC_TWEAKS_PUBLICATION_REFRESH_PERIOD",
      &Electric.Config.parse_human_readable_time!/1,
      nil
    ),
  schema_reconciler_period:
    env!(
      "ELECTRIC_TWEAKS_SCHEMA_RECONCILER_PERIOD",
      &Electric.Config.parse_human_readable_time!/1,
      nil
    ),
  replication_idle_timeout:
    env!(
      "ELECTRIC_REPLICATION_IDLE_TIMEOUT",
      &Electric.Config.parse_human_readable_time!/1,
      nil
    ),
  idle_wal_size_check_period:
    env!(
      "ELECTRIC_IDLE_WAL_SIZE_CHECK_PERIOD",
      &Electric.Config.parse_human_readable_time!/1,
      nil
    ),
  idle_wal_size_threshold: env!("ELECTRIC_IDLE_WAL_SIZE_THRESHOLD", :integer, nil)

if Electric.telemetry_enabled?() do
  config :sentry,
    environment_name: config_env(),
    client: Electric.Telemetry.SentryReqHTTPClient

  sentry_dsn = env!("SENTRY_DSN", :string, nil)

  if !is_nil(sentry_dsn) do
    config :sentry,
      dsn: sentry_dsn
  end

  otlp_endpoint = env!("ELECTRIC_OTLP_ENDPOINT", :string, nil)
  otel_debug = env!("ELECTRIC_OTEL_DEBUG", :boolean, false)

  otel_batch_processor =
    if otlp_endpoint do
      {:otel_batch_processor, %{}}
    end

  otel_simple_processor =
    if otel_debug do
      # In this mode, each span is printed to stdout as soon as it ends, without batching.
      {:otel_simple_processor, %{exporter: {:otel_exporter_stdout, []}}}
    end

  config :opentelemetry,
    resource_detectors: [
      :otel_resource_env_var,
      :otel_resource_app_env,
      Electric.Telemetry.OpenTelemetry.ResourceDetector
    ],
    resource: %{
      service: %{name: service_name, version: Electric.version()},
      instance: %{id: instance_id}
    },
    processors: [otel_batch_processor, otel_simple_processor] |> Enum.reject(&is_nil/1)

  if otlp_endpoint do
    # Shortcut config for Honeycomb.io:
    # users may set the optional ELECTRIC_HNY_API_KEY and ELECTRIC_HNY_DATASET environment variables
    # and specify the Honeycomb URL in ELECTRIC_OTLP_ENDPOINT to export traces directly to
    # Honeycomb, without the need to run an OpenTelemetry Collector.
    honeycomb_api_key = env!("ELECTRIC_HNY_API_KEY", :string, nil)
    honeycomb_dataset = env!("ELECTRIC_HNY_DATASET", :string, nil)

    headers =
      Enum.reject(
        [
          {"x-honeycomb-team", honeycomb_api_key},
          {"x-honeycomb-dataset", honeycomb_dataset}
        ],
        fn {_, val} -> is_nil(val) end
      )

    config :opentelemetry_exporter,
      otlp_protocol: :http_protobuf,
      otlp_endpoint: otlp_endpoint,
      otlp_headers: headers,
      otlp_compression: :gzip

    config :otel_metric_exporter,
      otlp_protocol: :http_protobuf,
      otlp_endpoint: otlp_endpoint,
      otlp_headers: Map.new(headers),
      otlp_compression: :gzip,
      resource: %{
        name: "metrics",
        service: %{name: service_name, version: Electric.version()},
        instance: %{id: instance_id}
      }

    config :electric, :logger, [
      {:handler, :otel_log_handler, OtelMetricExporter.LogHandler,
       %{
         config: %{
           resource: %{name: "logs"},
           metadata_map: %{
             request_id: "http.request_id",
             stack_id: "source_id",
             shape_handle: "shape.handle",
             received_transaction_xid: "received.transaction.xid",
             received_transaction_num_changes: "received.transaction.num_changes",
             received_transaction_lsn: "received.transaction.lsn",
             publication_alter_drop_tables: "publication.alter.drop_tables",
             publication_alter_add_tables: "publication.alter.add_tables",
             publication_alter_set_tables: "publication.alter.set_tables"
           }
         }
       }}
    ]
  end
end
