defmodule Electric.Replication.PostgresConnectorMng do
  use GenServer

  alias Electric.Postgres.Extension
  alias Electric.Replication.Postgres.Client
  alias Electric.Replication.PostgresConnector
  alias Electric.Replication.Connectors
  alias Electric.Postgres.OidDatabase

  require Logger

  defmodule State do
    defstruct [
      :status,
      :conn_config,
      :repl_config,
      :backoff,
      :origin,
      :config,
      :pg_connector_sup_monitor
    ]

    @type status :: :initialization | :establishing_repl_conn | :subscribing | :ready

    @type t() :: %__MODULE__{
            config: Connectors.config(),
            backoff: term,
            conn_config: %{},
            origin: Connectors.origin(),
            repl_config: %{
              publication: String.t(),
              slot: String.t(),
              subscription: String.t(),
              electric_connection: %{
                host: String.t(),
                port: :inet.port_number(),
                dbname: String.t()
              }
            },
            status: status,
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

  @spec status(Connectors.origin()) :: State.status()
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
        status: :initialization,
        pg_connector_sup_monitor: nil
    }
  end

  @impl GenServer
  def handle_continue(:init, state) do
    case initialize_postgres(state) do
      :ok ->
        state = %State{state | status: :establishing_repl_conn}
        {:noreply, state, {:continue, :establish_repl_conn}}

      error ->
        Logger.error("Initialization of Postgres state failed with reason: #{inspect(error)}.")
        {:noreply, schedule_retry(:init, state)}
    end
  end

  def handle_continue(:establish_repl_conn, %State{origin: origin} = state) do
    case PostgresConnector.start_children(state.config) do
      {:ok, sup_pid} ->
        Logger.info("Successfully initialized Postgres connector #{inspect(origin)}.")

        ref = Process.monitor(sup_pid)
        state = %State{state | status: :subscribing, pg_connector_sup_monitor: ref}
        {:noreply, state, {:continue, :subscribe}}

      {:error,
       {{:shutdown,
         {:failed_to_start_child, :postgres_producer,
          {:bad_return_value,
           {:error,
            {:error, :error, "55006", :object_in_use, "replication slot" <> _ = msg,
             _c_stacktrace}}}}}, _supervisor_spec}} ->
        Logger.error(
          "Initialization of replication connection to Postgres failed with reason: #{msg}. Another instance of Electric appears to be connected to this database."
        )

        {:noreply, schedule_retry(:establish_repl_conn, state)}
    end
  end

  def handle_continue(:subscribe, %State{} = state) do
    case Connectors.write_to_pg_mode(state.config) do
      :logical_replication ->
        case start_subscription(state) do
          :ok ->
            {:noreply, %State{state | status: :ready}}

          {:error, _} ->
            {:noreply, schedule_retry(:subscribe, state)}
        end

      :direct_writes ->
        :ok = stop_subscription(state)
        {:noreply, %State{state | status: :ready}}
    end
  end

  @impl GenServer
  def handle_call(:status, _from, state) do
    {:reply, state.status, state}
  end

  @impl GenServer
  def handle_info({:timeout, tref, action}, %State{backoff: {_, tref}} = state) do
    handle_continue(action, state)
  end

  def handle_info(
        {:DOWN, ref, :process, pid, reason},
        %State{pg_connector_sup_monitor: ref} = state
      ) do
    if reason not in [:normal, :shutdown] do
      Logger.warning(
        "PostgresConnectorSup #{inspect(pid)} has exited with reason: #{inspect(reason)}"
      )
    end

    {:noreply, schedule_retry(:init, reset_state(state))}
  end

  def handle_info(msg, %State{} = state) do
    Logger.error("unhandled info msg: #{inspect(msg)}")
    {:noreply, state}
  end

  # -----------------------------------------------------------------------------

  if Mix.env() == :test do
    # When running unit tests, PostgresConnectorSup is started on demand and does not need to be monitored for restarts.
    defp schedule_retry(_, state), do: state
  else
    defp schedule_retry(msg, %State{backoff: {backoff, _}} = state) do
      {time, backoff} = :backoff.fail(backoff)
      tref = :erlang.start_timer(time, self(), msg)
      Logger.info("schedule retry: #{inspect(time)}")
      %State{state | backoff: {backoff, tref}}
    end
  end

  defp start_subscription(%State{conn_config: conn_config, repl_config: rep_conf} = state) do
    case Client.with_conn(
           conn_config,
           fn conn ->
             Client.start_subscription(conn, rep_conf.subscription)
           end
         ) do
      :ok ->
        Logger.notice("subscription started for #{state.origin}")
        :ok

      error ->
        Logger.error("error while starting postgres subscription: #{inspect(error)}")
        error
    end
  end

  defp stop_subscription(%State{conn_config: conn_config, repl_config: rep_conf} = state) do
    case Client.with_conn(conn_config, fn conn ->
           Client.stop_subscription(conn, rep_conf.subscription)
         end) do
      :ok ->
        Logger.notice("subscription stopped for #{state.origin}")
        :ok

      {:error, {:error, :error, code, _reason, description, _c_stacktrace}} ->
        Logger.warning("couldn't stop postgres subscription: #{description} (code: #{code})")
        :ok
    end
  end

  def initialize_postgres(%State{origin: origin, repl_config: repl_config, config: config}) do
    # get a config configuration without the replication parameter set
    # so that we can use extended query syntax
    conn_config = Connectors.get_connection_opts(config, replication: false)

    Logger.debug(
      "Attempting to initialize #{origin}: #{conn_config.username}@#{conn_config.host}:#{conn_config.port}"
    )

    Client.with_conn(conn_config, fn conn ->
      with {:ok, versions} <- Extension.migrate(conn),
           :ok <- maybe_create_subscription(conn, config, repl_config),
           {:ok, oids} <- Client.query_oids(conn),
           :ok <- OidDatabase.save_oids(oids) do
        Logger.info(
          "Successfully initialized origin #{origin} at extension version #{List.last(versions)}"
        )

        :ok
      end
    end)
  end

  defp maybe_create_subscription(conn, config, replication_config) do
    subscription = Map.fetch!(replication_config, :subscription)
    publication = Map.fetch!(replication_config, :publication)
    electric_connection = Map.fetch!(replication_config, :electric_connection)

    case Connectors.write_to_pg_mode(config) do
      :logical_replication ->
        result = Client.create_subscription(conn, subscription, publication, electric_connection)

        with {:ok, _name} <- result do
          :ok
        end

      :direct_writes ->
        :ok
    end
  end
end
