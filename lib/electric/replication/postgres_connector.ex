defmodule Electric.Replication.PostgresConnector do
  use Supervisor
  require Logger
  alias Electric.Postgres.SchemaRegistry

  defmacrop retry_while(opts, do_block \\ nil) do
    code = Keyword.get(opts, :do, Keyword.fetch!(do_block, :do))
    start_backoff = Keyword.get(opts, :start_backoff, 10)
    max_single_backoff = Keyword.get(opts, :max_single_backoff, 1000)
    total_timeout = Keyword.get(opts, :total_timeout, 10000)

    quote do
      Stream.unfold(
        unquote(start_backoff),
        &{&1, :backoff.rand_increment(&1, unquote(max_single_backoff))}
      )
      |> Stream.transform(0, fn
        elem, acc when acc > unquote(total_timeout) -> {:halt, acc}
        elem, acc -> {[elem], acc + elem}
      end)
      |> Enum.reduce_while(nil, fn timeout, _ ->
        result = unquote(code)

        case result do
          {:cont, value} ->
            Process.sleep(timeout)
            {:cont, value}

          {:halt, value} ->
            {:halt, value}
        end
      end)
    end
  end

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

    children = [
      Supervisor.child_spec({Task, fn -> initialize_connector(supervisor, args) end},
        id: {Task, :initialize_connector}
      )
    ]

    Supervisor.init(children, strategy: :one_for_one)
  end

  defp initialize_connector(supervisor, args) when is_pid(supervisor) do
    retry_while total_timeout: 10000, max_single_backoff: 1000 do
      case initialize_postgres(args) do
        {:ok, _} -> {:halt, :ok}
        error -> {:cont, error}
      end
    end
    |> case do
      :ok ->
        :ok = finish_initialization(supervisor, args)
        SchemaRegistry.mark_origin_ready(args.origin)

      error ->
        Logger.error(
          "Couldn't initialize Postgres #{inspect(args.origin)}. Error: #{inspect(error, pretty: true)}"
        )

        Process.exit(supervisor, {:error, :initialization_failed})
    end
  end

  defp finish_initialization(supervisor, args) do
    [
      {Electric.Replication.Postgres.SlotServer, slot: args.replication.subscription},
      {Electric.Replication.Postgres.UpstreamPipeline,
       Map.put(args, :name, :"Elixir.Electric.ReplicationSource.#{args.origin}")},
      Supervisor.child_spec({Task, fn -> start_subscription(args) end},
        id: {Task, :start_subscription}
      )
    ]
    |> Enum.map(&Supervisor.start_child(supervisor, &1))
    |> Enum.group_by(&elem(&1, 0), &elem(&1, 1))
    |> case do
      %{error: [error | _]} ->
        Process.exit(supervisor, error)
        error

      _ ->
        :ok
    end
  end

  defp normalize_args(args) when is_list(args), do: normalize_args(Map.new(args))

  defp normalize_args(args) when is_map(args) do
    args
    |> Map.update!(:connection, &Map.new/1)
    |> Map.update!(:replication, &Map.new/1)
    |> Map.put_new(:client, Electric.Replication.Postgres.Client)
    |> Map.update!(:replication, &Map.put_new(&1, :slot, "electric_replication"))
    |> Map.update!(:replication, &Map.put_new(&1, :publication_tables, :all))
    |> Map.update!(:replication, &Map.put_new(&1, :subscription, args.origin))
  end

  defp start_subscription(%{connection: conn_config, client: client} = conf) do
    with {:ok, conn} <- client.connect(conn_config),
         :ok <- client.start_subscription(conn, conf.replication.subscription) do
      :ok
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
