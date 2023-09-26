defmodule Electric.Replication.PostgresConnectorMng do
  @moduledoc """
  This module defines a permanent gen server under `Electric.Replication.PostgresConnector`'s supervision.

  Its job is to initiate a replication connection to Postgres, monitor it, and establish a new connection whenever the
  current one shuts down. Initiating a new connection results in starting a sub-supervision tree under
  `PostgresConnector` rooted at `PostgresConnectorSup`.
  """

  use GenServer

  alias Electric.Postgres.{ConnectionPool, Extension, OidDatabase}
  alias Electric.Replication.{Connectors, PostgresConnector}
  alias Electric.Replication.Postgres.Client

  require Logger

  defmodule State do
    defstruct [
      :state,
      :conn_config,
      :repl_config,
      :backoff,
      :origin,
      :config,
      :pg_connector_sup_monitor
    ]

    @type t() :: %__MODULE__{
            config: Connectors.config(),
            backoff: term,
            conn_config: %{},
            origin: Connectors.origin(),
            repl_config: %{
              publication: String.t(),
              slot: String.t(),
              subscription: String.t(),
              electric_connection: %{host: String.t(), port: pos_integer, dbname: String.t()}
            },
            state: :init | :subscribe | :ready,
            pg_connector_sup_monitor: reference | nil
          }
  end

  @spec start_link(Connectors.config()) :: {:ok, pid} | :ignore | {:error, term}
  def start_link(conn_config) do
    GenServer.start_link(__MODULE__, conn_config, [])
  end

  @spec name(Connectors.config()) :: Electric.reg_name()
  def name(config) when is_list(config) do
    config
    |> Connectors.origin()
    |> name()
  end

  @spec name(Connectors.origin()) :: Electric.reg_name()
  def name(origin) do
    Electric.name(__MODULE__, origin)
  end

  @spec status(Connectors.origin()) :: :init | :subscribe | :ready
  def status(origin) do
    GenServer.call(name(origin), :status)
  end

  @impl GenServer
  def init(conn_config) do
    origin = Connectors.origin(conn_config)
    Electric.reg(name(origin))
    Logger.metadata(origin: origin)
    Process.flag(:trap_exit, true)

    state =
      reset_state(%State{
        config: conn_config,
        conn_config: Connectors.get_connection_opts(conn_config),
        origin: origin,
        repl_config: Connectors.get_replication_opts(conn_config)
      })

    {:ok, state, {:continue, :init}}
  end

  defp reset_state(%State{} = state) do
    %State{
      state
      | backoff: {:backoff.init(1000, 10_000), nil},
        state: :init,
        pg_connector_sup_monitor: nil
    }
  end

  @impl GenServer
  def handle_continue(:init, %State{origin: origin} = state) do
    case initialize_postgres(state) do
      :ok ->
        {:ok, sup_pid} = PostgresConnector.start_main_supervisor(state.config)
        Logger.info("successfully initialized connector #{inspect(origin)}")

        ref = Process.monitor(sup_pid)
        state = %State{state | state: :subscribe, pg_connector_sup_monitor: ref}
        {:noreply, state, {:continue, :subscribe}}

      error ->
        Logger.error("initialization for postgresql failed with reason: #{inspect(error)}")
        {:noreply, schedule_retry(:init, state)}
    end
  end

  def handle_continue(:subscribe, %State{} = state) do
    case start_subscription(state) do
      :ok ->
        {:noreply, %State{state | state: :ready}}

      {:error, _} ->
        {:noreply, schedule_retry(:subscribe, state)}
    end
  end

  @impl GenServer
  def handle_call(:status, _from, state) do
    {:reply, state.state, state}
  end

  @impl GenServer
  def handle_info({:timeout, tref, :init}, %State{backoff: {_, tref}} = state) do
    handle_continue(:init, state)
  end

  def handle_info({:timeout, tref, :subscribe}, %State{backoff: {_, tref}} = state) do
    handle_continue(:subscribe, state)
  end

  def handle_info(
        {:DOWN, ref, :process, pid, reason},
        %State{pg_connector_sup_monitor: ref} = state
      ) do
    Logger.warning(
      "PostgresConnectorSup #{inspect(pid)} has exited with reason: #{inspect(reason)}"
    )

    {:noreply, schedule_retry(:init, reset_state(state))}
  end

  def handle_info(msg, %State{} = state) do
    Logger.error("unhandled info msg: #{inspect(msg)}")
    {:noreply, state}
  end

  # -----------------------------------------------------------------------------

  defp schedule_retry(msg, %State{backoff: {backoff, _}} = state) do
    {time, backoff} = :backoff.fail(backoff)
    tref = :erlang.start_timer(time, self(), msg)
    Logger.info("schedule retry: #{inspect(time)}")
    %State{state | backoff: {backoff, tref}}
  end

  defp start_subscription(%State{origin: origin, repl_config: rep_conf}) do
    ConnectionPool.checkout!(origin, fn conn ->
      Client.start_subscription(conn, rep_conf.subscription)
    end)
    |> case do
      :ok ->
        Logger.notice("subscription started for #{origin}")
        :ok

      error ->
        Logger.error("error while starting postgres subscription: #{inspect(error)}")
        error
    end
  end

  def initialize_postgres(%State{origin: origin, repl_config: repl_config, config: config}) do
    publication = Map.fetch!(repl_config, :publication)
    subscription = Map.fetch!(repl_config, :subscription)
    electric_connection = Map.fetch!(repl_config, :electric_connection)

    # get a config configuration without the replication parameter set
    # so that we can use extended query syntax
    conn_config = Connectors.get_connection_opts(config, replication: false)

    Logger.debug(
      "Attempting to initialize #{origin}: #{conn_config.username}@#{conn_config.host}:#{conn_config.port}"
    )

    ConnectionPool.checkout!(origin, fn conn ->
      with {:ok, versions} <- Extension.migrate(conn),
           {:ok, _} <-
             Client.create_subscription(conn, subscription, publication, electric_connection),
           {:ok, oids} <- Client.query_oids(conn),
           :ok <- OidDatabase.save_oids(oids) do
        Logger.info(
          "Successfully initialized origin #{origin} at extension version #{List.last(versions) || "<latest>"}"
        )

        :ok
      end
    end)
  end
end
