import Config
import Dotenvy

config :elixir, :time_zone_database, Tz.TimeZoneDatabase
config :logger, level: :debug

if config_env() == :test, do: config(:logger, level: :info)

if config_env() in [:dev, :test] do
  source!([".env.#{config_env()}", ".env.#{config_env()}.local", System.get_env()])
end

instance_id = env!("ELECTRIC_INSTANCE_ID", :string, Electric.Utils.uuid4())

config :telemetry_poller, :default, period: 500

config :opentelemetry,
  resource_detectors: [:otel_resource_env_var, :otel_resource_app_env],
  resource: %{service: %{name: "electric", version: Mix.Project.config()[:version]}}

otel_export = env!("OTEL_EXPORT", :string, nil)

case otel_export do
  "otlp" ->
    if endpoint = env!("OTLP_ENDPOINT", :string, nil) do
      config :opentelemetry_exporter,
        otlp_protocol: :http_protobuf,
        otlp_endpoint: endpoint,
        otlp_compression: :gzip
    end

  "debug" ->
    # In this mode, each span is printed to stdout as soon as it ends, without batching.
    config :opentelemetry, :processors,
      otel_simple_processor: %{exporter: {:otel_exporter_stdout, []}}

  _ ->
    config :opentelemetry,
      processors: [],
      traces_exporter: :none
end

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

  config :electric, connection_opts: connection_opts
end

enable_integration_testing = env!("ENABLE_INTEGRATION_TESTING", :boolean, false)
cache_max_age = env!("CACHE_MAX_AGE", :integer, 60)
cache_stale_age = env!("CACHE_STALE_AGE", :integer, 60 * 5)
statsd_host = env!("STATSD_HOST", :string?, nil)

cubdb_file_path = env!("CUBDB_FILE_PATH", :string, "./shapes")

storage =
  env!(
    "STORAGE",
    fn storage ->
      case String.downcase(storage) do
        "memory" ->
          {Electric.ShapeCache.InMemoryStorage, []}

        "cubdb" ->
          {Electric.ShapeCache.CubDbStorage, file_path: cubdb_file_path}

        _ ->
          raise Dotenvy.Error, message: "storage must be one of: MEMORY, CUBDB"
      end
    end,
    {Electric.ShapeCache.CubDbStorage, file_path: cubdb_file_path}
  )

config :electric,
  allow_shape_deletion: enable_integration_testing,
  cache_max_age: cache_max_age,
  cache_stale_age: cache_stale_age,
  # Used in telemetry
  environment: config_env(),
  instance_id: instance_id,
  telemetry_statsd_host: statsd_host,
  storage: storage
