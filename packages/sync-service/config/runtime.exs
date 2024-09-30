import Config
import Dotenvy

config :elixir, :time_zone_database, Tz.TimeZoneDatabase
config :logger, level: :debug

# uncomment if you need to track process creation and destruction
# config :logger,
#   handle_otp_reports: true,
#   handle_sasl_reports: true

if config_env() == :test do
  config(:logger, level: :info)
  config(:electric, pg_version_for_tests: env!("POSTGRES_VERSION", :integer, 150_001))
end

if config_env() in [:dev, :test] do
  source!([".env.#{config_env()}", ".env.#{config_env()}.local", System.get_env()])
end

electric_instance_id = :default
service_name = env!("ELECTRIC_SERVICE_NAME", :string, "electric")
instance_id = env!("ELECTRIC_INSTANCE_ID", :string, Electric.Utils.uuid4())
version = Electric.version()

config :telemetry_poller, :default, period: 500

config :opentelemetry,
  resource_detectors: [:otel_resource_env_var, :otel_resource_app_env],
  resource: %{service: %{name: service_name, version: version}, instance: %{id: instance_id}}

otlp_endpoint = env!("OTLP_ENDPOINT", :string, nil)
otel_debug = env!("OTEL_DEBUG", :boolean, false)

if otlp_endpoint do
  # Shortcut config for Honeycomb.io:
  # users may set the optional HNY_API_KEY and HNY_DATASET environment variables
  # and specify the Honeycomb URL in OTLP_ENDPOINT to export traces directly to
  # Honeycomb, without the need to run an OpenTelemetry Collector.
  honeycomb_api_key = env!("HNY_API_KEY", :string, nil)
  honeycomb_dataset = env!("HNY_DATASET", :string, nil)

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

if Config.config_env() == :test do
  config :electric,
    connection_opts: [
      hostname: "localhost",
      port: 54321,
      username: "postgres",
      password: "password",
      database: "postgres",
      sslmode: :disable
    ]
else
  {:ok, database_url_config} =
    env!("DATABASE_URL", :string)
    |> Electric.Config.parse_postgresql_uri()

  database_ipv6_config =
    env!("DATABASE_USE_IPV6", :boolean, false)

  connection_opts = [ipv6: database_ipv6_config] ++ database_url_config

  config :electric, connection_opts: connection_opts, electric_instance_id: electric_instance_id
end

config :electric, listen_on_ipv6?: env!("LISTEN_ON_IPV6", :boolean, false)

enable_integration_testing = env!("ENABLE_INTEGRATION_TESTING", :boolean, false)
cache_max_age = env!("CACHE_MAX_AGE", :integer, 60)
cache_stale_age = env!("CACHE_STALE_AGE", :integer, 60 * 5)
statsd_host = env!("STATSD_HOST", :string?, nil)

storage_dir = env!("STORAGE_DIR", :string, "./persistent")

shape_path = Path.join(storage_dir, "./shapes")
persistent_state_path = Path.join(storage_dir, "./state")

persistent_kv =
  env!(
    "PERSISTENT_STATE",
    fn storage ->
      case String.downcase(storage) do
        "memory" ->
          {Electric.PersistentKV.Memory, :new!, []}

        "file" ->
          {Electric.PersistentKV.Filesystem, :new!, root: persistent_state_path}

        _ ->
          raise Dotenvy.Error, message: "PERSISTENT_STATE must be one of: MEMORY, FILE"
      end
    end,
    {Electric.PersistentKV.Filesystem, :new!, root: persistent_state_path}
  )

chunk_bytes_threshold =
  env!(
    "LOG_CHUNK_BYTES_THRESHOLD",
    :integer,
    Electric.ShapeCache.LogChunker.default_chunk_size_threshold()
  )

{storage_mod, storage_opts} =
  env!(
    "STORAGE",
    fn storage ->
      case String.downcase(storage) do
        "memory" ->
          {Electric.ShapeCache.InMemoryStorage, electric_instance_id: electric_instance_id}

        "file" ->
          {Electric.ShapeCache.FileStorage,
           storage_dir: shape_path, electric_instance_id: electric_instance_id}

        _ ->
          raise Dotenvy.Error, message: "storage must be one of: MEMORY, FILE"
      end
    end,
    {Electric.ShapeCache.FileStorage,
     storage_dir: shape_path, electric_instance_id: electric_instance_id}
  )

storage = {storage_mod, storage_opts}

prometheus_port = env!("PROMETHEUS_PORT", :integer, nil)

config :electric,
  allow_shape_deletion: enable_integration_testing,
  cache_max_age: cache_max_age,
  cache_stale_age: cache_stale_age,
  chunk_bytes_threshold: chunk_bytes_threshold,
  # Used in telemetry
  environment: config_env(),
  instance_id: instance_id,
  telemetry_statsd_host: statsd_host,
  db_pool_size: env!("DB_POOL_SIZE", :integer, 50),
  prometheus_port: prometheus_port,
  storage: storage,
  persistent_kv: persistent_kv
