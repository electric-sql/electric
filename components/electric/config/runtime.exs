# This file is executed after the code compilation on all environments
# (dev, test, and prod) - for both Mix and releases.
#
# We use it for runtime configuration of releases in production --
# because that allows us to read environment variables at runtime
# rather than compile time.

import Config

default_log_level = "info"
default_instance_id = "electric"
default_auth_mode = "secure"
default_http_server_port = "5133"
default_pg_server_port = "5433"
default_offset_storage_path = "./offset_storage_data.dat"

###

config :logger,
  handle_otp_reports: true,
  handle_sasl_reports: false,
  level: System.get_env("LOG_LEVEL", default_log_level) |> String.to_existing_atom()

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
    :user_id
  ]

pg_server_port =
  System.get_env("LOGICAL_PUBLISHER_PORT", default_pg_server_port) |> String.to_integer()

config :electric,
  # Used only to send server identification upon connection,
  # can stay default while we're not working on multi-instance setups
  instance_id: System.get_env("ELECTRIC_INSTANCE_ID", default_instance_id),
  http_port: System.get_env("HTTP_PORT", default_http_server_port) |> String.to_integer(),
  pg_server_port: pg_server_port

config :electric, Electric.Replication.Postgres,
  pg_client: Electric.Replication.Postgres.Client,
  producer: Electric.Replication.Postgres.LogicalReplicationProducer

# The :prod environment is inlined here because by default Mix won't copy any config/runtime.*.exs files when assembling
# a release, and we want a single configuration file in our release.
if config_env() == :prod do
  auth_provider =
    System.get_env("AUTH_MODE", default_auth_mode) |> Electric.Satellite.Auth.build_provider!()

  config :electric, Electric.Satellite.Auth, provider: auth_provider

  require_ssl? =
    String.downcase(System.get_env("DATABASE_REQUIRE_SSL", "false")) in ["yes", "true"]

  postgresql_connection =
    System.fetch_env!("DATABASE_URL")
    |> PostgresqlUri.parse()
    |> then(&Keyword.put(&1, :host, &1[:hostname]))
    |> Keyword.delete(:hostname)
    |> Keyword.put_new(:ssl, require_ssl?)
    |> Keyword.update(:timeout, 5_000, &String.to_integer/1)
    |> Keyword.put(:replication, "database")

  pg_server_host =
    System.get_env("LOGICAL_PUBLISHER_HOST") ||
      raise("Env variable LOGICAL_PUBLISHER_HOST is not set")

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
     ]}
  ]

  config :electric, Electric.Replication.Connectors, connectors

  config :electric, Electric.Replication.OffsetStorage,
    file: System.get_env("OFFSET_STORAGE_FILE", default_offset_storage_path)
else
  Code.require_file("runtime.#{config_env()}.exs", __DIR__)
end
