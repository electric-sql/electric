import Config
import Dotenvy

config :elixir, :time_zone_database, Tz.TimeZoneDatabase

if config_env() in [:dev, :test] do
  source!([".env.#{config_env()}", ".env.#{config_env()}.local", System.get_env()])
end

config :logger, level: env!("ELECTRIC_LOG_LEVEL", &Electric.Config.parse_log_level!/1, :info)

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
  config :electric, pg_version_for_tests: env!("POSTGRES_VERSION", :integer, 150_001)
  config :logger, backends: [:console]
  config :logger, :default_handler, level: :error
end

config :sentry,
  environment_name: config_env(),
  client: Electric.Telemetry.SentryReqHTTPClient

sentry_dsn = env!("SENTRY_DSN", :string, nil)

if !is_nil(sentry_dsn) do
  config :sentry,
    dsn: sentry_dsn
end

service_name = env!("ELECTRIC_SERVICE_NAME", :string, "electric")
instance_id = env!("ELECTRIC_INSTANCE_ID", :string, Electric.Utils.uuid4())
version = Electric.version()

config :opentelemetry,
  resource_detectors: [:otel_resource_env_var, :otel_resource_app_env],
  resource: %{service: %{name: service_name, version: version}, instance: %{id: instance_id}}

otlp_endpoint = env!("ELECTRIC_OTLP_ENDPOINT", :string, nil)
otel_debug = env!("ELECTRIC_OTEL_DEBUG", :boolean, false)

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
end

otel_batch_processor =
  if otlp_endpoint do
    {:otel_batch_processor, %{}}
  end

otel_simple_processor =
  if otel_debug do
    # In this mode, each span is printed to stdout as soon as it ends, without batching.
    {:otel_simple_processor, %{exporter: {:otel_exporter_stdout, []}}}
  end

otel_sampling_ratio = env!("ELECTRIC_OTEL_SAMPLING_RATIO", :float, 0.01)

config :opentelemetry,
  processors: [otel_batch_processor, otel_simple_processor] |> Enum.reject(&is_nil/1),
  # sampler: {Electric.Telemetry.Sampler, %{ratio: otel_sampling_ratio}}
  # Sample root spans based on our custom sampler
  # and inherit sampling decision from remote parents
  sampler:
    {:parent_based,
     %{
       root: {Electric.Telemetry.Sampler, %{ratio: otel_sampling_ratio}},
       remote_parent_sampled: :always_on,
       remote_parent_not_sampled: :always_off,
       local_parent_sampled: :always_on,
       local_parent_not_sampled: :always_off
     }}

database_url_config = env!("DATABASE_URL", &Electric.Config.parse_postgresql_uri!/1)

database_ipv6_config =
  env!("ELECTRIC_DATABASE_USE_IPV6", :boolean, false)

connection_opts = database_url_config ++ [ipv6: database_ipv6_config]

config :electric, connection_opts: Electric.Utils.obfuscate_password(connection_opts)

enable_integration_testing? = env!("ELECTRIC_ENABLE_INTEGRATION_TESTING", :boolean, nil)
cache_max_age = env!("ELECTRIC_CACHE_MAX_AGE", :integer, nil)
cache_stale_age = env!("ELECTRIC_CACHE_STALE_AGE", :integer, nil)
statsd_host = env!("ELECTRIC_STATSD_HOST", :string?, nil)

storage_dir = env!("ELECTRIC_STORAGE_DIR", :string, "./persistent")

shape_path = Path.join(storage_dir, "./shapes")
persistent_state_path = Path.join(storage_dir, "./state")

persistent_kv =
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

chunk_bytes_threshold = env!("ELECTRIC_SHAPE_CHUNK_BYTES_THRESHOLD", :integer, nil)

storage =
  env!(
    "ELECTRIC_STORAGE",
    fn storage ->
      case String.downcase(storage) do
        "memory" ->
          {Electric.ShapeCache.InMemoryStorage, []}

        "file" ->
          {Electric.ShapeCache.FileStorage, storage_dir: shape_path}

        "crashing_file" ->
          num_calls_until_crash =
            env!("CRASHING_FILE_ELECTRIC_STORAGE__NUM_CALLS_UNTIL_CRASH", :integer)

          {Electric.ShapeCache.CrashingFileStorage,
           storage_dir: shape_path, num_calls_until_crash: num_calls_until_crash}

        _ ->
          raise Dotenvy.Error, message: "storage must be one of: MEMORY, FILE"
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

# The provided database id is relevant if you had used v0.8 and want to keep the storage
# instead of having hanging files. We use a provided value as stack id, but nothing else.
provided_database_id = env!("ELECTRIC_DATABASE_ID", :string, nil)

config :electric,
  provided_database_id: provided_database_id,
  allow_shape_deletion?: enable_integration_testing?,
  cache_max_age: cache_max_age,
  cache_stale_age: cache_stale_age,
  chunk_bytes_threshold: chunk_bytes_threshold,
  # Used in telemetry
  instance_id: instance_id,
  call_home_telemetry?: env!("ELECTRIC_USAGE_REPORTING", :boolean, config_env() == :prod),
  telemetry_url: call_home_telemetry_url,
  system_metrics_poll_interval: system_metrics_poll_interval,
  telemetry_statsd_host: statsd_host,
  prometheus_port: prometheus_port,
  db_pool_size: env!("ELECTRIC_DB_POOL_SIZE", :integer, nil),
  replication_stream_id: replication_stream_id,
  replication_slot_temporary?: env!("CLEANUP_REPLICATION_SLOTS_ON_SHUTDOWN", :boolean, nil),
  service_port: env!("ELECTRIC_PORT", :integer, nil),
  shape_hibernate_after: shape_hibernate_after,
  storage: storage,
  persistent_kv: persistent_kv,
  listen_on_ipv6?: env!("ELECTRIC_LISTEN_ON_IPV6", :boolean, nil)
