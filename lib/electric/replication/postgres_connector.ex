defmodule Electric.Replication.PostgresConnector do
  use Supervisor

  require Electric.Retry
  require Logger

  alias Electric.Replication.Postgres
  alias Electric.Postgres.SchemaRegistry

  @type args :: {:connection, keyword()} | {:replication, keyword()}
  @type init_arg :: [args, ...]

  @spec start_link(init_arg()) :: :ignore | {:error, any} | {:ok, pid}
  def start_link(init_arg) do
    Supervisor.start_link(__MODULE__, init_arg)
  end

  @impl true
  @spec init(init_arg()) :: {:ok, {:supervisor.sup_flags(), [:supervisor.child_spec()]}} | :ignore
  def init(init_arg) do
    args = normalize_args(init_arg)
    supervisor = self()

    Registry.register(Electric.StatusRegistry, {:connector, args.origin}, args.origin)

    children = [
      Supervisor.child_spec({Task, fn -> initialize_connector(supervisor, args) end},
        id: {Task, :initialize_connector}
      )
    ]

    Supervisor.init(children, strategy: :one_for_one)
  end

  def name(pid) do
    [name] =
      Registry.select(Electric.StatusRegistry, [{{{:connector, :_}, pid, :"$1"}, [], [:"$1"]}])

    name
  end

  def status(pid) do
    children = Supervisor.which_children(pid)

    cond do
      match?({{Task, :initialize_connector}, _, _, _}, List.first(children)) ->
        {:not_ready, :initialization}

      match?({{Task, :start_subscription}, _, _, _}, List.last(children)) ->
        {:not_ready, :initialization}

      not child_healthcheck(children, Postgres.SlotServer, :downstream_connected?) ->
        {:not_ready, {:disconnected, :downstream}}

      # TODO: Doesn't really make sense until we ensure `Postgres.LogicalReplicationProducer`
      #       reconnects properly on connection loss
      # not module_connected?(children, Postgres.UpstreamPipeline) ->
      #   {:not_ready, {:disconnected, :upstream}}

      true ->
        :ready
    end
  end

  defp child_healthcheck(children, module, function) do
    case List.keyfind(children, module, 0) do
      {_, pid, _, _} -> apply(module, function, [pid])
      nil -> false
    end
  end

  defp initialize_connector_with_retries(args) do
    Electric.Retry.retry_while total_timeout: 10000, max_single_backoff: 1000 do
      case initialize_postgres(args) do
        {:ok, _} -> {:halt, :ok}
        error -> {:cont, error}
      end
    end
  end

  defp initialize_connector(supervisor, args) when is_pid(supervisor) do
    with :ok <- initialize_connector_with_retries(args),
         :ok <- finish_initialization(supervisor, args) do
      SchemaRegistry.mark_origin_ready(args.origin)
    else
      error ->
        Logger.error(
          "Couldn't initialize Postgres #{inspect(args.origin)}. Error: #{inspect(error, pretty: true)}"
        )

        Process.exit(supervisor, {:error, :initialization_failed})
    end
  end

  defp finish_initialization(supervisor, args) do
    [
      {Electric.Replication.Postgres.SlotServer, put_name(args, Electric.SlotServer)},
      {Electric.Replication.Postgres.UpstreamPipeline,
       put_name(args, Electric.ReplicationSource)},
      Supervisor.child_spec({Task, fn -> start_subscription(args) end},
        id: {Task, :start_subscription}
      )
    ]
    |> Enum.map(&Supervisor.child_spec(&1, []))
    |> Enum.reduce_while(:ok, fn %{id: id} = child_spec, _ ->
      case Supervisor.start_child(supervisor, child_spec) do
        {:ok, _} ->
          {:cont, :ok}

        {:ok, _, _} ->
          {:cont, :ok}

        {:error, reason} ->
          Logger.error(
            "Couldn't finish initialization of the connector. Error while starting #{id}: #{inspect(reason)}"
          )

          {:halt, {:error, reason}}
      end
    end)
  end

  defp put_name(args, mod) do
    name = Module.concat([mod, String.to_atom(args.origin)])
    Map.put(args, :name, name)
  end

  defp normalize_args(args) when is_list(args), do: normalize_args(Map.new(args))

  defp normalize_args(args) when is_map(args) do
    args
    |> Map.update!(:connection, &new_map_with_charlists/1)
    |> Map.update!(:replication, &Map.new/1)
    |> Map.update!(:downstream, &Map.new/1)
    |> Map.put_new(:client, Electric.Replication.Postgres.Client)
    |> Map.update!(:replication, &Map.put_new(&1, :slot, "electric_replication"))
    |> Map.update!(:replication, &Map.put_new(&1, :publication_tables, :all))
    |> Map.update!(:replication, &Map.put_new(&1, :subscription, args.origin))
  end

  defp new_map_with_charlists(list),
    do:
      Map.new(list, fn
        {k, v} when is_binary(v) -> {k, String.to_charlist(v)}
        {k, v} -> {k, v}
      end)

  defp start_subscription(%{connection: conn_config, client: client} = conf) do
    with {:ok, conn} <- client.connect(conn_config),
         :ok <- client.start_subscription(conn, conf.replication.subscription) do
      :ok
    else
      error ->
        Logger.error("Error while starting subscription for #{conf.origin}: #{inspect(error)}")
        error
    end
  end

  def initialize_postgres(%{connection: conn_config, replication: repl_config} = conf) do
    client = Map.fetch!(conf, :client)
    publication_name = Map.fetch!(repl_config, :publication)
    slot_name = Map.fetch!(repl_config, :slot)
    subscription_name = Map.fetch!(repl_config, :subscription)
    publication_tables = Map.fetch!(repl_config, :publication_tables)
    reverse_connection = Map.fetch!(repl_config, :electric_connection)

    Logger.debug("Attempting to initialize #{conf.origin}")

    with {:ok, conn} <- client.connect(conn_config),
         {:ok, system_id} <- client.get_system_id(conn),
         {:ok, publication} <-
           client.create_publication(conn, publication_name, publication_tables),
         {:ok, _} <- client.create_slot(conn, slot_name),
         {:ok, _} <-
           client.create_subscription(
             conn,
             subscription_name,
             publication,
             reverse_connection
           ),
         tables = client.query_replicated_tables(conn, publication_name),
         :ok <- client.close(conn) do
      tables
      |> Enum.map(&Map.delete(&1, :columns))
      |> then(&SchemaRegistry.put_replicated_tables(publication_name, &1))

      Enum.each(tables, &SchemaRegistry.put_table_columns({&1.schema, &1.name}, &1.columns))

      Logger.debug("Successfully initialized origin #{conf.origin}")

      {:ok, system_id}
    end
  end
end
