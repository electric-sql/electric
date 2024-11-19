import Config
import Dotenvy

config :elixir, :time_zone_database, Tz.TimeZoneDatabase

if config_env() in [:dev, :test] do
  source!([".env.#{config_env()}", ".env.#{config_env()}.local", System.get_env()])
end

log_level_config =
  env!("LOG_LEVEL", :string, "info")
  |> Electric.ConfigParser.parse_log_level()

case log_level_config do
  {:ok, log_level} ->
    config :logger, level: log_level

  {:error, message} ->
    raise message
end

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

service_name = env!("ELECTRIC_SERVICE_NAME", :string, "electric")
instance_id = env!("ELECTRIC_INSTANCE_ID", :string, Electric.Utils.uuid4())
version = Electric.version()

config :telemetry_poller, :default, period: 500

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

config :opentelemetry,
  processors: [otel_batch_processor, otel_simple_processor] |> Enum.reject(&is_nil/1)

database_url = env!("DATABASE_URL", :string!)

database_ipv6_config =
  env!("ELECTRIC_DATABASE_USE_IPV6", :boolean, false)

{:ok, database_url_config} = Electric.ConfigParser.parse_postgresql_uri(database_url)

connection_opts = database_url_config ++ [ipv6: database_ipv6_config]

config :electric, connection_opts: Electric.Utils.obfuscate_password(connection_opts)

enable_integration_testing = env!("ELECTRIC_ENABLE_INTEGRATION_TESTING", :boolean, false)
cache_max_age = env!("ELECTRIC_CACHE_MAX_AGE", :integer, 60)
cache_stale_age = env!("ELECTRIC_CACHE_STALE_AGE", :integer, 60 * 5)
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
    {Electric.PersistentKV.Filesystem, :new!, root: persistent_state_path}
  )

chunk_bytes_threshold =
  env!(
    "ELECTRIC_LOG_CHUNK_BYTES_THRESHOLD",
    :integer,
    Electric.ShapeCache.LogChunker.default_chunk_size_threshold()
  )

{storage_mod, storage_opts} =
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
    {Electric.ShapeCache.FileStorage, storage_dir: shape_path}
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
    "default"
  )

storage = {storage_mod, storage_opts}

prometheus_port = env!("ELECTRIC_PROMETHEUS_PORT", :integer, nil)

config :electric,
  allow_shape_deletion: enable_integration_testing,
  cache_max_age: cache_max_age,
  cache_stale_age: cache_stale_age,
  chunk_bytes_threshold: chunk_bytes_threshold,
  # Used in telemetry
  instance_id: instance_id,
  telemetry_statsd_host: statsd_host,
  db_pool_size: env!("ELECTRIC_DB_POOL_SIZE", :integer, 20),
  replication_stream_id: replication_stream_id,
  replication_slot_temporary?: env!("CLEANUP_REPLICATION_SLOTS_ON_SHUTDOWN", :boolean, false),
  service_port: env!("ELECTRIC_PORT", :integer, 3000),
  prometheus_port: prometheus_port,
  storage: storage,
  persistent_kv: persistent_kv,
  listen_on_ipv6?: env!("ELECTRIC_LISTEN_ON_IPV6", :boolean, false)
