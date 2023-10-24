# This file is executed after the code compilation on all environments
# (dev, test, and prod) - for both Mix and releases.
#
# We use it for runtime configuration of releases in production --
# because that allows us to read environment variables at runtime
# rather than compile time.

import Config

default_log_level = "info"
default_auth_mode = "secure"
default_http_server_port = "5133"
default_pg_server_port = "5433"
default_pg_proxy_port = "65432"
default_listen_on_ipv6 = "false"
default_database_require_ssl = "false"
default_database_use_ipv6 = "false"
default_write_mode = "streaming"

###

get_env_bool = fn name, default ->
  String.downcase(System.get_env(name, default)) in ["yes", "true"]
end

get_env_int = fn name, default ->
  System.get_env(name, default) |> String.to_integer()
end

###

log_level = System.get_env("LOG_LEVEL", default_log_level) |> String.to_existing_atom()

config :logger,
  handle_otp_reports: true,
  handle_sasl_reports: false,
  level: log_level

config :logger, :console,
  format: "$time $metadata[$level] $message\n",
  metadata: [
    # :pid is intentionally put as the first list item below. Logger prints metadata in the same order as it is configured
    # here, so having :pid sorted in the list alphabetically would make it get in the away of log output matching that we
    # do in many of our E2E tests.
    :pid,
    :client_id,
    :component,
    :connection,
    :instance_id,
    :origin,
    :pg_client,
    :pg_producer,
    :pg_slot,
    # :remote_ip is intentionally commented out below.
    #
    # IP addresses are user-identifiable information protected under GDPR. Our
    # customers might not like it when they use client IP addresses in the
    # logs of their on-premises installation of Electric.
    #
    # Although it appears the consensus is thta logging IP addresses is fine
    # (see https://law.stackexchange.com/a/28609), there are caveats.
    #
    # I think that adding IP addresses to logs should be made as part of the
    # same decision that determines the log retention policy. Since we're not
    # tying the logged IP addresses to users' personal information managed by
    # customer apps, we cannot clean them up as part of the "delete all user
    # data" procedure that app developers have in place to conform to GDPR
    # requirements. Therefore, logging IP addresses by default is better
    # avoided in production builds of Electric.
    #
    # We may introduce it as a configurable option for better DX at some point.
    # :remote_ip,
    :request_id,
    :sq_client,
    :user_id,
    :proxy_session_id
  ]

pg_server_port = get_env_int.("LOGICAL_PUBLISHER_PORT", default_pg_server_port)
listen_on_ipv6? = get_env_bool.("ELECTRIC_USE_IPV6", default_listen_on_ipv6)

write_mode =
  case System.get_env("ELECTRIC_WRITE_MODE", default_write_mode) do
    "streaming" -> :streaming
    "immediate" -> :immediate
  end

config :electric,
  # Used in telemetry, and to identify the server to the client
  instance_id: System.get_env("ELECTRIC_INSTANCE_ID", Electric.Utils.uuid4()),
  http_port: get_env_int.("HTTP_PORT", default_http_server_port),
  pg_server_port: pg_server_port,
  listen_on_ipv6?: listen_on_ipv6?,
  write_mode: write_mode

config :electric, Electric.Replication.Postgres,
  pg_client: Electric.Replication.Postgres.Client,
  producer: Electric.Replication.Postgres.LogicalReplicationProducer

config :electric, :telemetry_url, "https://checkpoint.electric-sql.com"

# disable all ddlx commands apart from `ENABLE`
# override these using the `ELECTRIC_FEATURES` environment variable, e.g.
# to add a flag enabling `ELECTRIC GRANT` use:
#
#     export ELECTRIC_FEATURES="proxy_ddlx_grant=true:${ELECTRIC_FEATURES:-}"
#
# or if you want to just set flags, ignoring any previous env settings
#
#     export ELECTRIC_FEATURES="proxy_ddlx_grant=true:proxy_ddlx_assign=true"
#
config :electric, Electric.Features,
  proxy_ddlx_grant: false,
  proxy_ddlx_revoke: false,
  proxy_ddlx_assign: false,
  proxy_ddlx_unassign: false

# The :prod environment is inlined here because by default Mix won't copy any config/runtime.*.exs files when assembling
# a release, and we want a single configuration file in our release.
if config_env() == :prod do
  auth_provider =
    System.get_env("AUTH_MODE", default_auth_mode) |> Electric.Satellite.Auth.build_provider!()

  config :electric, Electric.Satellite.Auth, provider: auth_provider

  require_ssl? = get_env_bool.("DATABASE_REQUIRE_SSL", default_database_require_ssl)
  use_ipv6? = get_env_bool.("DATABASE_USE_IPV6", default_database_use_ipv6)

  postgresql_connection =
    System.fetch_env!("DATABASE_URL")
    |> Electric.Utils.parse_postgresql_uri()
    |> Keyword.put_new(:ssl, require_ssl?)
    |> Keyword.put(:ipv6, use_ipv6?)
    |> Keyword.update(:timeout, 5_000, &String.to_integer/1)
    |> Keyword.put(:replication, "database")

  pg_server_host =
    if write_mode == :streaming do
      System.get_env("LOGICAL_PUBLISHER_HOST") ||
        raise("Required environment variable LOGICAL_PUBLISHER_HOST is not set")
    end

  proxy_port = get_env_int.("PG_PROXY_PORT", default_pg_proxy_port)

  proxy_password =
    System.get_env("PG_PROXY_PASSWORD") ||
      raise("Required environment variable PG_PROXY_PASSWORD is not set")

  proxy_listener_opts =
    if listen_on_ipv6? do
      [transport_options: [:inet6]]
    else
      []
    end

  connectors = [
    {"postgres_1",
     producer: Electric.Replication.Postgres.LogicalReplicationProducer,
     connection: postgresql_connection,
     replication: [
       electric_connection: [
         host: pg_server_host,
         port: pg_server_port,
         dbname: "electric",
         connect_timeout: postgresql_connection[:timeout]
       ]
     ],
     proxy: [
       # listen opts are ThousandIsland.options()
       # https://hexdocs.pm/thousand_island/ThousandIsland.html#t:options/0
       listen: [port: proxy_port] ++ proxy_listener_opts,
       password: proxy_password,
       log_level: log_level
     ]}
  ]

  config :electric, Electric.Replication.Connectors, connectors

  # This is intentionally an atom and not a boolean - we expect to add `:extended` state
  telemetry =
    case System.get_env("ELECTRIC_TELEMETRY") do
      nil -> :enabled
      x when x in ~w|0 f false disable disabled n no off| -> :disabled
      x when x in ~w|1 t true enable enabled y yes on| -> :enabled
      x -> raise "Invalid value for `ELECTRIC_TELEMETRY`: #{x}"
    end

  config :electric, :telemetry, telemetry

  enable_proxy_tracing? = System.get_env("PROXY_TRACING_ENABLE", "false") in ["yes", "true"]

  config :electric, Electric.Postgres.Proxy.Handler.Tracing,
    enable: enable_proxy_tracing?,
    colour: false
else
  config :electric, :telemetry, :disabled
  Code.require_file("runtime.#{config_env()}.exs", __DIR__)
end
