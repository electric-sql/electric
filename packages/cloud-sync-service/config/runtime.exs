import Config
import Dotenvy

source!([".env.#{config_env()}", ".env.#{config_env()}.local", System.get_env()])

### LOGGING

config :logger, level: env!("LOG_LEVEL", &Electric.ConfigParser.parse_log_level!/1, :info)

# Enable this to get **very noisy** but useful messages from BEAM about
# processes being started, stopped and crashes.
# https://www.erlang.org/doc/apps/sasl/error_logging#sasl-reports
sasl? = env!("ELECTRIC_LOG_OTP_REPORTS", :boolean, false)

config :logger,
  handle_otp_reports: sasl?,
  handle_sasl_reports: sasl?

### TELEMETRY
prometheus_port = env!("ELECTRIC_PROMETHEUS_PORT", :integer, nil)
instance_id = env!("ELECTRIC_INSTANCE_ID", :string, Electric.Utils.uuid4())
service_name = env!("ELECTRIC_SERVICE_NAME", :string, "electric-cloud")

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

### STORAGE

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
    {Electric.ShapeCache.FileStorage, storage_dir: shape_path}
  )

config :cloud_electric,
  persistent_kv: persistent_kv,
  long_poll_timeout: env!("ELECTRIC_LONG_POLL_TIMEOUT", :integer, 20_000),
  cache_max_age: env!("ELECTRIC_CACHE_MAX_AGE", :integer, 60),
  cache_stale_age: env!("ELECTRIC_CACHE_STALE_AGE", :integer, 60 * 5),
  allow_shape_deletion: true,
  storage: storage,
  pool_opts: [
    pool_size: env!("ELECTRIC_DB_POOL_SIZE", :integer, 50)
  ],
  service_port: env!("ELECTRIC_PORT", :integer, 3000),
  listen_on_ipv6?: env!("ELECTRIC_LISTEN_ON_IPV6", :boolean, false),
  control_plane: env!("ELECTRIC_CONTROL_PLANE", &CloudElectric.ControlPlane.parse_config/1, nil),
  prometheus_port: prometheus_port,
  instance_id: instance_id

if config_env() == :test do
  config :cloud_electric,
    test_db_connection: env!("DATABASE_URL", &Electric.ConfigParser.parse_postgresql_uri!/1)

  config :logger, backends: [:console]
  config :logger, :default_handler, level: :emergency
end
