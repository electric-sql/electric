defmodule Electric.Replication.PostgresConnectorMng do
  @behaviour GenServer

  import Electric.Postgres.OidDatabase.PgType

  alias Electric.Postgres.Extension
  alias Electric.Replication.Postgres.Client
  alias Electric.Replication.PostgresConnector
  alias Electric.Replication.Connectors
  alias Electric.Postgres.OidDatabase

  require Logger

  defmodule State do
    defstruct [:state, :conn_config, :repl_config, :backoff, :origin, :config]

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
            state: :reinit | :init | :subscribe | :ready | :migration
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

  @spec status(Connectors.origin()) :: :init | :subscribe | :ready | :migration
  def status(origin) do
    GenServer.call(name(origin), {:status})
  end

  @impl GenServer
  def init(conn_config) do
    origin = Connectors.origin(conn_config)
    Electric.reg(name(origin))
    Logger.metadata(origin: origin)
    Process.flag(:trap_exit, true)

    {:ok,
     %State{
       config: conn_config,
       backoff: {:backoff.init(1000, 10_000), nil},
       conn_config: Connectors.get_connection_opts(conn_config),
       origin: origin,
       repl_config: Connectors.get_replication_opts(conn_config),
       state: :init
     }, {:continue, :init}}
  end

  @impl GenServer
  def handle_continue(init, %State{origin: origin} = state)
      when init == :init or init == :reinit do
    case initialize_postgres(state) do
      {:ok, state1} ->
        :ok = PostgresConnector.start_children(state.config)
        Logger.info("successfully initialized connector #{inspect(origin)}")

        {:noreply, %State{state1 | state: :subscribe}, {:continue, :subscribe}}

      error ->
        Logger.error("initialization for postgresql failed with reason: #{inspect(error)}")
        {:noreply, schedule_retry(init, state)}
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
  def handle_call({:status}, _from, state) do
    {:reply, state.state, state}
  end

  @impl GenServer
  def handle_cast(_, state) do
    {:noreply, state}
  end

  @impl GenServer
  def handle_info({:timeout, tref, :init}, %State{backoff: {_, tref}} = state) do
    handle_continue(:init, state)
  end

  def handle_info({:timeout, tref, :subscribe}, %State{backoff: {_, tref}} = state) do
    handle_continue(:subscribe, state)
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

  def initialize_postgres(%State{origin: origin, repl_config: repl_config} = state) do
    publication = Map.fetch!(repl_config, :publication)
    subscription = Map.fetch!(repl_config, :subscription)
    electric_connection = Map.fetch!(repl_config, :electric_connection)

    # get a config configuration without the replication parameter set
    # so that we can use extended query syntax
    conn_config = Connectors.get_connection_opts(state.config, replication: false)

    Logger.debug(
      "Attempting to initialize #{origin}: #{conn_config.username}@#{conn_config.host}:#{conn_config.port}"
    )

    Client.with_conn(conn_config, fn conn ->
      with {:ok, versions} <- Extension.migrate(conn),
           {:ok, _} <-
             Client.create_subscription(conn, subscription, publication, electric_connection),
           {:ok, oids} <- Client.query_oids(conn),
           oids =
             oids
             |> Enum.map(&pg_type_from_tuple/1)
             |> assoc_oids_with_postgrex_extensions(conn_config),
           :ok <- OidDatabase.save_oids(oids) do
        Logger.info(
          "Successfully initialized origin #{origin} at extension version #{List.last(versions)}"
        )

        {:ok, state}
      end
    end)
  end

  defp assoc_oids_with_postgrex_extensions(oids, conn_config) do
    # Here we're using Postgrex's private APIs to get hold of its typename-oid mapping table that includes
    # Postgrex.Extension.* module for each of the supported Postgres types.
    # We're associating the extension module with type oid in order to be able to validate values of the type on demand.
    type_server_key = {conn_config[:host], conn_config[:port], conn_config[:database]}
    type_server = Postgrex.TypeSupervisor.locate(Postgrex.DefaultTypes, type_server_key)
    {:lock, ref, type_server_state} = Postgrex.TypeServer.fetch(type_server)
    Postgrex.TypeServer.done(type_server, ref)

    for pg_type(oid: oid) = record <- oids do
      case Postgrex.Types.fetch(oid, type_server_state) do
        {:ok, {:binary, type_mod}} -> pg_type(record, postgrex_ext: type_mod)
        _ -> record
      end
    end
  end
end
