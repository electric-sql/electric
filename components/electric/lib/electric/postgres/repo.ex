defmodule Electric.Postgres.Repo do
  @moduledoc """
  Ecto repo for managing a pool of DB connections.

  This repo must be started as part of a `PostgresConnectorSup` supervision tree, configured
  with the same `connector_config` that its siblings use. Under the hood, it will start a
  dynamic Ecto repo that can be looked up by the name returned from `name/1`.

  Connections in the pool will use SSL if the Postgres connector is configured with
  `DATABASE_REQUIRE_SSL=true`. This is different from `epgsql`'s default behaviour where it
  tries to use SSL first and only falls back to using plain TCP if that fails.
  """

  use Ecto.Repo, otp_app: :electric, adapter: Ecto.Adapters.Postgres

  alias Electric.Replication.Connectors

  @default_pool_size 10

  def config(connector_config, opts) do
    origin = Connectors.origin(connector_config)
    conn_opts = Connectors.get_connection_opts(connector_config)

    [
      name: name(origin),
      hostname: conn_opts.host,
      port: conn_opts.port,
      username: conn_opts.username,
      password: conn_opts.password,
      database: conn_opts.database,
      ssl: conn_opts[:ssl_opts] || false,
      # Pass TCP options to the Postgrex adapter. This is used to let the adapter know to
      # connect to the DB using IPv6, for example.
      socket_options: Map.get(conn_opts, :tcp_opts, []),
      pool_size: Keyword.get(opts, :pool_size, @default_pool_size),
      log: false,
      after_connect: {__MODULE__, :set_display_settings, []},
      connection_listeners: Keyword.get(opts, :observer_pids, [])
    ]
  end

  def name(origin), do: :"#{inspect(__MODULE__)}:#{origin}"

  # Explicitly set those configuration parameters that affect formatting of values of certain
  # types.
  #
  # This function is automatically invoked for any new connection that gets added to the pool
  # managed by this repo.
  #
  # See `Electric.Postgres.display_settings/0` for more info.
  def set_display_settings(conn) do
    :ok = Enum.each(Electric.Postgres.display_settings(), &Postgrex.query!(conn, &1, []))
  end
end
