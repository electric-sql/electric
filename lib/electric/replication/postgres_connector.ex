defmodule Electric.Replication.PostgresConnector do
  use Supervisor

  require Logger

  alias Electric.Replication.PostgresConnectorMng
  alias Electric.Replication.PostgresConnectorSup

  @type args :: {:connection, keyword()} | {:replication, keyword()}
  @type init_arg :: [args, ...]
  @type origin :: String.t()

  @spec start_link(Keyword.t()) :: Supervisor.on_start()
  def start_link(init_arg) do
    Supervisor.start_link(__MODULE__, init_arg)
  end

  @impl Supervisor
  def init(init_arg) do
    origin = Keyword.fetch!(init_arg, :origin)
    Electric.reg(name(origin))

    children = [
      # %{id: :sup, start: {PostgresConnectorSup, :start_link, [origin]}, type: :supervisor},
      %{id: :mng, start: {PostgresConnectorMng, :start_link, [origin]}}
    ]

    Supervisor.init(children, strategy: :one_for_all)
  end

  @spec start_children(origin()) :: :ok | {:error, term}
  def start_children(origin, type \\ :init) do
    connector = name(origin)

    {:ok, _} =
      case type do
        :init ->
          Supervisor.start_child(
            connector,
            %{id: :sup, start: {PostgresConnectorSup, :start_link, [origin]}, type: :supervisor}
          )

        :reinit ->
          Supervisor.restart_child(connector, :sup)
      end

    :ok
  end

  @spec stop_children(origin()) :: :ok | {:error, :not_found}
  def stop_children(origin) do
    connector = name(origin)
    Supervisor.terminate_child(connector, :sup)
  end

  @doc """
  Returns list of all active PG connectors
  """
  @spec connectors() :: [String.t()]
  def connectors() do
    Electric.reg_names(__MODULE__)
  end

  @spec name(origin()) :: Electric.reg_name()
  def name(origin) when is_binary(origin) do
    Electric.name(__MODULE__, origin)
  end

  def get_producer_opts(origin) do
    producer = Keyword.fetch!(get_connector(origin), :producer)
    producer
  end

  @spec get_replication_opts(origin()) :: %{
          publication: String.t(),
          slot: String.t(),
          subscription: String.t(),
          publication_tables: :all | [binary] | binary,
          electric_connection: %{host: String.t(), port: pos_integer, dbname: String.t()}
        }
  def get_replication_opts(origin) do
    repl_config = Keyword.fetch!(get_connector(origin), :replication)

    repl_config
    |> Map.new()
    |> Map.put_new(:slot, "electric_replication")
    |> Map.put_new(:publication_tables, :all)
    |> Map.put_new(:subscription, to_string(origin))
  end

  @spec get_connection_opts(origin()) :: :epgsql.connect_opts()
  def get_connection_opts(origin) do
    conn_opts = Keyword.fetch!(get_connector(origin), :connection)
    new_map_with_charlists(conn_opts)
  end

  def get_downstream_opts(origin) do
    down_opts = Keyword.fetch!(get_connector(origin), :downstream)
    Map.new(down_opts)
  end

  defp get_connector(origin) do
    origin = :erlang.binary_to_existing_atom(origin)

    Keyword.fetch!(
      Application.get_env(:electric, Electric.Replication.Connectors),
      origin
    )
  end

  defp new_map_with_charlists(list) do
    Map.new(list, fn
      {k, v} when is_binary(v) -> {k, String.to_charlist(v)}
      {k, v} -> {k, v}
    end)
  end
end
