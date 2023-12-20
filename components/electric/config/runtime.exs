import Config
import Dotenvy

### Static configuration

config :ssl, protocol_version: [:"tlsv1.3", :"tlsv1.2"]

config :electric, Electric.Postgres.CachedWal.Api, adapter: Electric.Postgres.CachedWal.EtsBacked

### User configuration

default_log_level = "info"
default_auth_mode = "secure"
default_http_server_port = 5133
default_pg_server_port = 5433
default_pg_proxy_port = "65432"
default_listen_on_ipv6 = true
default_database_require_ssl = true
default_database_use_ipv6 = true
default_write_to_pg_mode = "logical_replication"
default_proxy_tracing_enable = false

###
# Logger
###

log_level = env!("LOG_LEVEL", :string, default_log_level) |> String.to_existing_atom()

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

###
# Auth
###

auth_mode = env!("AUTH_MODE", :string, default_auth_mode)

auth_opts = [
  alg: env!("AUTH_JWT_ALG", :string, nil),
  key: env!("AUTH_JWT_KEY", :string, nil),
  namespace: env!("AUTH_JWT_NAMESPACE", :string, nil),
  iss: env!("AUTH_JWT_ISS", :string, nil),
  aud: env!("AUTH_JWT_AUD", :string, nil)
]

config :electric, Electric.Satellite.Auth,
  provider: Electric.Satellite.Auth.build_provider!(auth_mode, auth_opts)

###

pg_server_port = env!("LOGICAL_PUBLISHER_PORT", :integer, default_pg_server_port)
listen_on_ipv6? = env!("ELECTRIC_USE_IPV6", :boolean, default_listen_on_ipv6)

write_to_pg_mode =
  case env!("ELECTRIC_WRITE_TO_PG_MODE", :string, default_write_to_pg_mode) do
    "logical_replication" -> :logical_replication
    "direct_writes" -> :direct_writes
  end

config :electric,
  # Used in telemetry, and to identify the server to the client
  instance_id: env!("ELECTRIC_INSTANCE_ID", :string, Electric.Utils.uuid4()),
  http_port: env!("HTTP_PORT", :integer, default_http_server_port),
  pg_server_port: pg_server_port,
  listen_on_ipv6?: listen_on_ipv6?,
  write_to_pg_mode: write_to_pg_mode

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

require_ssl? = env!("DATABASE_REQUIRE_SSL", :boolean, default_database_require_ssl)

# Always try connecting with SSL first.
#
# When require_ssl?=true, :epgsql will try to connect using SSL and fail if the server does not accept encrypted
# connections.
#
# When require_ssl?=false, :epgsql will try to connect using SSL first, then fallback to an unencrypted connection
# if that fails.
use_ssl? =
  if require_ssl? do
    :required
  else
    true
  end

use_ipv6? = env!("DATABASE_USE_IPV6", :boolean, default_database_use_ipv6)

database_url = env!("DATABASE_URL", :string, nil)

postgresql_connection =
  if database_url do
    database_url
    |> Electric.Utils.parse_postgresql_uri()
    |> Keyword.put(:ssl, use_ssl?)
    |> Keyword.put(:ipv6, use_ipv6?)
    |> Keyword.put(:replication, "database")
    |> Keyword.update(:timeout, 5_000, &String.to_integer/1)
  end

pg_server_host = env!("LOGICAL_PUBLISHER_HOST", :string, nil)

{use_http_tunnel?, proxy_port_str} =
  case String.downcase(env!("PG_PROXY_PORT", :string, default_pg_proxy_port)) do
    "http" -> {true, default_pg_proxy_port}
    "http:" <> port_str -> {true, port_str}
    port_str -> {false, port_str}
  end

proxy_port = String.to_integer(proxy_port_str)

proxy_password = env!("PG_PROXY_PASSWORD", :string, nil)

proxy_listener_opts =
  if listen_on_ipv6? do
    [transport_options: [:inet6]]
  else
    []
  end

if postgresql_connection do
  config :electric, Electric.Replication.Connectors,
    postgres_1: [
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
        use_http_tunnel?: use_http_tunnel?,
        password: proxy_password,
        log_level: log_level
      ]
    ]
end

enable_proxy_tracing? = env!("PROXY_TRACING_ENABLE", :boolean, default_proxy_tracing_enable)

config :electric, Electric.Postgres.Proxy.Handler.Tracing,
  enable: enable_proxy_tracing?,
  colour: false

# This is intentionally an atom and not a boolean - we expect to add `:extended` state
telemetry =
  case env!("ELECTRIC_TELEMETRY", :string, nil) do
    nil -> :enabled
    x when x in ~w[0 f false disable disabled n no off] -> :disabled
    x when x in ~w[1 t true enable enabled y yes on] -> :enabled
    x -> raise "Invalid value for `ELECTRIC_TELEMETRY`: #{x}"
  end

config :electric, :telemetry, telemetry

if config_env() in [:dev, :test] do
  Code.require_file("runtime.#{config_env()}.exs", __DIR__)
end
