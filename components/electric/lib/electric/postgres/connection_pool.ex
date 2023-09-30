defmodule Electric.Postgres.ConnectionPool do
  @moduledoc false

  @behaviour NimblePool

  alias Electric.Replication.Connectors

  require Logger

  @pool_timeout 5_000

  def child_spec(conn_config) do
    %{id: __MODULE__, start: {__MODULE__, :start_link, [conn_config]}}
  end

  def start_link(conn_config) do
    NimblePool.start_link(
      worker: {__MODULE__, conn_config},
      # only connect when required, not immediately
      lazy: true,
      pool_size: 20,
      worker_idle_timeout: 30_000,
      name: name(Connectors.origin(conn_config))
    )
  end

  def checkout!(origin, fun) when is_binary(origin) do
    checkout!(name(origin), fun)
  end

  def checkout!(pool, fun) do
    NimblePool.checkout!(
      pool,
      :checkout,
      fn _pool, conn ->
        {fun.(conn), :ok}
      end,
      @pool_timeout
    )
  end

  @spec name(Connectors.origin()) :: Electric.reg_name()
  def name(origin) when is_binary(origin) do
    Electric.name(__MODULE__, origin)
  end

  ###

  @impl NimblePool
  def init_worker(conn_config) do
    Logger.debug("Starting SchemaLoader pg connection: #{inspect(conn_config)}")
    # NOTE: use `__connection__: conn` in tests to pass an existing connection
    {:ok, conn} =
      case Keyword.fetch(conn_config, :__connection__) do
        {:ok, conn} ->
          {:ok, conn}

        :error ->
          conn_config
          |> Connectors.get_connection_opts(replication: false)
          |> :epgsql.connect()
      end

    {:ok, conn, conn_config}
  end

  @impl NimblePool
  # Transfer the port to the caller
  def handle_checkout(:checkout, _from, conn, pool_state) do
    {:ok, conn, conn, pool_state}
  end

  @impl NimblePool
  def handle_checkin(:ok, _from, conn, pool_state) do
    {:ok, conn, pool_state}
  end

  @impl NimblePool
  def terminate_worker(_reason, conn, pool_state) do
    Logger.debug("Terminating idle db connection #{inspect(conn)}")
    :epgsql.close(conn)
    {:ok, pool_state}
  end

  @impl NimblePool
  def handle_ping(_conn, _pool_state) do
    {:remove, :idle}
  end
end
