defmodule Electric.Replication.PostgresConnectorMng do
  alias Electric.Migration.Utils
  alias Electric.Postgres.SchemaRegistry
  alias Electric.Replication.Postgres.Client
  alias Electric.Replication.PostgresConnector

  @behaviour GenServer
  require Logger

  @type origin :: PostgresConnector.origin()

  @update_migration "INSERT INTO electric.migrations (version, hash) VALUES ($1, $2);"
  @select_migration "SELECT (version, hash) FROM electric.migrations WHERE version = $1;"

  defmodule State do
    defstruct [:state, :conn_config, :repl_config, :backoff, :origin]

    @type t() :: %__MODULE__{
            backoff: term,
            conn_config: %{},
            origin: PostgresConnector.origin(),
            repl_config: %{
              publication: String.t(),
              slot: String.t(),
              subscription: String.t(),
              publication_tables: :all | [binary] | binary,
              electric_connection: %{host: String.t(), port: pos_integer, dbname: String.t()}
            },
            state: :reinit | :init | :subscription | :ready | :migration
          }
  end

  @spec start_link(origin()) :: {:ok, pid} | :ignore | {:error, term}
  def start_link(origin) do
    GenServer.start_link(__MODULE__, origin, [])
  end

  @spec name(origin()) :: Electric.reg_name()
  def name(origin) do
    Electric.name(__MODULE__, origin)
  end

  @doc """
  Initiate migration of Postgresql instance to version vsn

  Take into consideration that vsn validation is outside of the scope
  of this function
  """
  @spec migrate(origin(), String.t()) :: :ok | {:error, term}
  def migrate(origin, vsn) do
    GenServer.call(name(origin), {:migrate, vsn}, :infinity)
  end

  @spec status(origin()) :: :init | :subscription | :ready | :migration
  def status(origin) do
    GenServer.call(name(origin), {:status})
  end

  @impl GenServer
  def init(origin) do
    Electric.reg(name(origin))
    Logger.metadata(origin: origin)
    Process.flag(:trap_exit, true)

    {:ok,
     %State{
       backoff: {:backoff.init(1000, 10_000), nil},
       conn_config: PostgresConnector.get_connection_opts(origin),
       origin: origin,
       repl_config: PostgresConnector.get_replication_opts(origin),
       state: :init
     }, {:continue, :init}}
  end

  @impl GenServer
  def handle_continue(init, %State{origin: origin} = state)
      when init == :init or init == :reinit do
    case initialize_postgres(state) do
      {:ok, state1} ->
        :ok = PostgresConnector.start_children(state.origin, init)
        Logger.info("successfully initialized connector #{inspect(origin)}")
        SchemaRegistry.mark_origin_ready(origin)

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

  def handle_call({:status}, _from, state) do
    {:reply, state.state, state}
  end

  @impl GenServer
  def handle_call({:migrate, vsn}, _from, state) do
    case state.state do
      :ready ->
        # FIXME: How to recover after unsuccesfull migration ?
        :ok = stop_subscription(state)
        :ok = PostgresConnector.stop_children(state.origin)

        case migrate_internal(vsn, state) do
          {:ok, state1} ->
            {:reply, :ok, %State{state1 | state: :reinit}, {:continue, :reinit}}

          {:error, error} ->
            {:reply, {:error, error}, state}
        end

      _ ->
        {:reply, {:error, {:invalid_state, state.state}}, state}
    end
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

  # FIXME: Before initiating migration we need to check current migration version
  defp migrate_internal(vsn, %State{conn_config: conn_config} = state) do
    with {:ok, migration_file} <- Utils.read_migration_file(vsn),
         md5_hash <- Base.encode16(:erlang.md5(migration_file)) do
      Logger.notice("ready to migrate to version: #{vsn}")

      case Client.with_conn(
             Map.delete(conn_config, :replication),
             fn conn ->
               :epgsql.with_transaction(
                 conn,
                 fn conn ->
                   case :epgsql.equery(conn, @select_migration, [vsn]) do
                     {:ok, _, [{{^vsn, ^md5_hash}}]} ->
                       {:rollback, {:error, :already_migrated}}

                     {:ok, _, [{{^vsn, _}}]} ->
                       {:rollback, {:error, :already_migrated_bad_md5}}

                     {:ok, _, [{_}]} ->
                       {:rollback, {:error, :downgrade_not_supported}}

                     {:ok, _, []} ->
                       res = :epgsql.squery(conn, migration_file)

                       case check_response(res) do
                         :ok ->
                           {:ok, _} = :epgsql.equery(conn, @update_migration, [vsn, md5_hash])
                           :ok

                         error ->
                           error
                       end
                   end
                 end
               )
             end
           ) do
        :ok ->
          Logger.notice("successfull migration to version: #{vsn} md5: #{md5_hash}")
          {:ok, state}

        {:rollback, error} ->
          Logger.error("failed to migrate to version: #{vsn}, reason #{inspect(error)}")
          error
      end
    else
      error ->
        Logger.error("failed to migrate to version: #{vsn}, reason: #{inspect(error)}")
        {:error, error}
    end
  end

  defp check_response({:ok, _, _, _}), do: :ok
  defp check_response({:ok, _}), do: :ok
  defp check_response({:ok, _, _}), do: :ok
  defp check_response({:error, _} = error), do: error

  defp check_response([h | t]) do
    case check_response(h) do
      :ok -> check_response(t)
      {:error, _} = error -> error
    end
  end

  defp check_response([]), do: :ok

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
    case Client.with_conn(
           conn_config,
           fn conn ->
             Client.stop_subscription(conn, rep_conf.subscription)
           end
         ) do
      :ok ->
        Logger.notice("subscription stopped for #{state.origin}")
        :ok

      error ->
        Logger.error("error while stopping subscription for #{state.origin}: #{inspect(error)}")
    end
  end

  def initialize_postgres(
        %State{conn_config: conn_config, origin: origin, repl_config: repl_config} = state
      ) do
    publication_name = Map.fetch!(repl_config, :publication)
    slot_name = Map.fetch!(repl_config, :slot)
    subscription_name = Map.fetch!(repl_config, :subscription)
    publication_tables = Map.fetch!(repl_config, :publication_tables)
    reverse_connection = Map.fetch!(repl_config, :electric_connection)

    Logger.debug("attempting to initialize #{origin}")

    Client.with_conn(conn_config, fn conn ->
      with {:ok, _system_id} <- Client.get_system_id(conn),
           {:ok, publication} <-
             Client.create_publication(conn, publication_name, publication_tables),
           {:ok, _} <- Client.create_slot(conn, slot_name),
           {:ok, _} <-
             Client.create_subscription(
               conn,
               subscription_name,
               publication,
               reverse_connection
             ),
           tables <- Client.query_replicated_tables(conn, publication_name),
           migrations <- Client.query_migration_table(conn),
           :ok <- Client.close(conn) do
        tables
        |> Enum.map(&Map.delete(&1, :columns))
        |> then(&SchemaRegistry.put_replicated_tables(publication_name, &1))

        Enum.each(tables, &SchemaRegistry.put_table_columns({&1.schema, &1.name}, &1.columns))
        SchemaRegistry.put_migration_tables(origin, migrations)

        Logger.info("Successfully initialized origin #{origin}")

        {:ok, state}
      end
    end)
  end
end
