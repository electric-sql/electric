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
      :origin,
      :connector_config,
      :conn_opts,
      :repl_opts,
      :write_to_pg_mode,
      :status,
      :backoff,
      :pg_connector_sup_monitor
    ]

    @type status :: :initialization | :establishing_repl_conn | :subscribing | :ready

    @type t() :: %__MODULE__{
            origin: Connectors.origin(),
            connector_config: Connectors.config(),
            conn_opts: :epgsql.connect_opts_map(),
            repl_opts: %{
              publication: String.t(),
              slot: String.t(),
              subscription: String.t(),
              electric_connection: %{
                host: String.t(),
                port: :inet.port_number(),
                dbname: String.t()
              }
            },
            write_to_pg_mode: Electric.write_to_pg_mode(),
            status: status,
            backoff: term,
            pg_connector_sup_monitor: reference | nil
          }
  end

  @spec start_link(Connectors.config()) :: {:ok, pid} | :ignore | {:error, term}
  def start_link(connector_config) do
    GenServer.start_link(__MODULE__, connector_config, [])
  end

  @spec name(Connectors.config()) :: Electric.reg_name()
  def name(connector_config) when is_list(connector_config) do
    connector_config
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
  def init(connector_config) do
    origin = Connectors.origin(connector_config)
    name = name(origin)
    Electric.reg(name)

    Logger.metadata(origin: origin)
    Process.flag(:trap_exit, true)

    state =
      reset_state(%State{
        origin: origin,
        connector_config: connector_config,
        conn_opts: Connectors.get_connection_opts(connector_config),
        repl_opts: Connectors.get_replication_opts(connector_config),
        write_to_pg_mode: Connectors.write_to_pg_mode(connector_config)
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

  def handle_continue(:establish_repl_conn, %State{} = state) do
    case PostgresConnector.start_children(state.connector_config) do
      {:ok, sup_pid} ->
        Logger.info("Successfully initialized Postgres connector #{inspect(state.origin)}.")

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

  def handle_continue(:subscribe, %State{write_to_pg_mode: :logical_replication} = state) do
    case start_subscription(state) do
      :ok -> {:noreply, %State{state | status: :ready}}
      {:error, _} -> {:noreply, schedule_retry(:subscribe, state)}
    end
  end

  def handle_continue(:subscribe, %State{write_to_pg_mode: :direct_writes} = state) do
    :ok = stop_subscription(state)
    {:noreply, %State{state | status: :ready}}
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

  defp start_subscription(%State{origin: origin, conn_opts: conn_opts, repl_opts: repl_opts}) do
    Client.with_conn(conn_opts, fn conn ->
      Client.start_subscription(conn, repl_opts.subscription)
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

  defp stop_subscription(%State{origin: origin, conn_opts: conn_opts, repl_opts: repl_opts}) do
    Client.with_conn(conn_opts, fn conn ->
      Client.stop_subscription(conn, repl_opts.subscription)
    end)
    |> case do
      :ok ->
        Logger.notice("subscription stopped for #{origin}")
        :ok

      {:error, {:error, :error, code, _reason, description, _c_stacktrace}} ->
        Logger.warning("couldn't stop postgres subscription: #{description} (code: #{code})")
        :ok
    end
  end

  def initialize_postgres(%State{origin: origin, conn_opts: conn_opts} = state) do
    Logger.debug(
      "Attempting to initialize #{origin}: #{conn_opts.username}@#{conn_opts.host}:#{conn_opts.port}"
    )

    Client.with_conn(conn_opts, fn conn ->
      with {:ok, versions} <- Extension.migrate(conn),
           :ok <- maybe_create_subscription(conn, state.write_to_pg_mode, state.repl_opts),
           {:ok, oids} <- Client.query_oids(conn),
           :ok <- OidDatabase.save_oids(oids) do
        Logger.info(
          "Successfully initialized origin #{origin} at extension version #{List.last(versions)}"
        )

        :ok
      end
    end)
  end

  defp maybe_create_subscription(conn, :logical_replication, repl_opts) do
    %{
      subscription: subscription,
      publication: publication,
      electric_connection: electric_connection
    } = repl_opts

    with {:ok, _name} <-
           Client.create_subscription(conn, subscription, publication, electric_connection) do
      :ok
    end
  end

  defp maybe_create_subscription(_conn, :direct_writes, _repl_opts), do: :ok
end
