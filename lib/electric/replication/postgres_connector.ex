defmodule Electric.Replication.PostgresConnector do
  use Supervisor
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
    {:ok, _} = initialize_postgres(args)

    children = [
      {Electric.ReplicationServer.Postgres.SlotServer, slot: args.replication.subscription},
      {Electric.Replication,
       Map.put(args, :name, :"Elixir.Electric.ReplicationSource.#{args.origin}")},
      {Task, fn -> start_subscription(args) end}
    ]

    Supervisor.init(children, strategy: :one_for_one)
  end

  defp normalize_args(args) when is_list(args), do: normalize_args(Map.new(args))

  defp normalize_args(args) when is_map(args) do
    args
    |> Map.update!(:connection, &Map.new/1)
    |> Map.update!(:replication, &Map.new/1)
    |> Map.put_new(:client, Electric.Replication.PostgresClient)
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
         tables <- client.query_replicated_tables(conn, publication_name),
         :ok <- client.close(conn) do
      tables
      |> Enum.map(&Map.delete(&1, :columns))
      |> then(&SchemaRegistry.put_replicated_tables(publication_name, &1))

      Enum.each(tables, &SchemaRegistry.put_table_columns({&1.schema, &1.name}, &1.columns))

      {:ok, system_id}
    end
  end
end
