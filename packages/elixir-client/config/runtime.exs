import Config

config :logger, level: :warning

if config_env() == :test do
  port = 3333
  default_database_url = "postgresql://postgres:password@localhost:54321/electric?sslmode=disable"
  database_url = System.get_env("DATABASE_URL", default_database_url)

  connection_opts = Electric.Config.parse_postgresql_uri!(database_url)

  default_electric_url = "http://localhost:#{port}"
  electric_url = System.get_env("ELECTRIC_URL", default_electric_url)

  config :electric_client,
    database_config: connection_opts,
    electric_url: electric_url

  config :electric_client, Support.Repo, url: database_url

  config :electric,
    start_in_library_mode: false,
    replication_connection_opts: connection_opts,
    # enable the http api so that the client tests against a real endpoint can
    # run against our embedded electric instance.
    enable_http_api: true,
    service_port: port,
    allow_shape_deletion?: false,
    # use a non-default replication stream id so we can run the client
    # tests at the same time as an active electric instance
    replication_stream_id: "client_tests",
    storage_dir: Path.join(System.tmp_dir!(), "electric/client-tests#{System.monotonic_time()}"),
    # Enable subqueries for move support testing
    feature_flags: ["allow_subqueries", "tagged_subqueries"]
end
