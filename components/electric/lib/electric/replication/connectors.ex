defmodule Electric.Replication.Connectors do
  use DynamicSupervisor

  @type origin() :: binary()

  @type connection_config() :: :epgsql.connect_opts()
  @type electric_connection_opt() ::
          {:host, binary()} | {:port, pos_integer()} | {:dbname, binary()}
  @type electric_connection_opts() :: [electric_connection_opt()]
  @type replication_config_opt() ::
          {:slot, binary()} | {:electric_connection, electric_connection_opts()}
  @type replication_config() :: [replication_config_opt(), ...]

  @type config_opt() ::
          {:connection, connection_config()}
          | {:replication, replication_config()}
          | {:origin, origin()}

  @type config() :: [config_opt(), ...]

  @type replication_opts() :: %{
          publication: String.t(),
          slot: String.t(),
          subscription: String.t(),
          electric_connection: %{host: String.t(), port: pos_integer, dbname: String.t()},
          opts: Keyword.t()
        }
  @type connection_opts() :: %{
          host: charlist(),
          port: :inet.port_number(),
          database: charlist(),
          username: charlist(),
          password: charlist(),
          replication: charlist(),
          ssl: boolean()
        }

  @type proxy_listen_opts() :: ThousandIsland.options()
  @type proxy_opts() :: %{
          listen: proxy_listen_opts(),
          password: String.t(),
          log_level: Logger.level()
        }

  alias Electric.Postgres.Extension

  def start_link(extra_args) do
    DynamicSupervisor.start_link(__MODULE__, extra_args, name: __MODULE__)
  end

  @impl DynamicSupervisor
  def init(_extra_args) do
    DynamicSupervisor.init(strategy: :one_for_one, max_restarts: 0)
  end

  @spec start_connector(module(), term()) :: Supervisor.on_start()
  def start_connector(module, args) do
    DynamicSupervisor.start_child(__MODULE__, {module, args})
  end

  @spec stop_connector(pid()) :: :ok | {:error, term()}
  def stop_connector(pid) do
    DynamicSupervisor.terminate_child(__MODULE__, pid)
  end

  def status(opt \\ :pretty) do
    map_fun =
      case opt do
        :pretty ->
          fn {_, pid, _, [module]} -> {module.name(pid), module.status(pid)} end

        :raw ->
          fn {_, pid, _, [module]} -> {module, pid} end
      end

    __MODULE__
    |> DynamicSupervisor.which_children()
    |> Enum.map(map_fun)
  end

  @spec origin(config()) :: origin()
  def origin(args) do
    Keyword.fetch!(args, :origin)
  end

  @spec get_replication_opts(config()) :: replication_opts()
  def get_replication_opts(config) do
    origin = origin(config)

    database_name =
      (get_in(config, [:connection, :database]) || "test")
      |> to_string()
      |> String.downcase()
      |> String.replace(~r/[^a-z0-9_]/, "_")
      |> String.trim("_")
      |> String.slice(0..(62 - String.length(Extension.slot_name()) - 1))

    config
    |> Keyword.fetch!(:replication)
    |> Map.new()
    |> Map.put(:slot, Extension.slot_name() <> "_#{database_name}")
    |> Map.put(:publication, Extension.publication_name())
    |> Map.put(:subscription, to_string(origin))
  end

  @spec get_connection_opts(config()) :: connection_opts()
  def get_connection_opts(config, opts \\ []) do
    replication? = Keyword.get(opts, :replication, true)

    config
    |> Keyword.fetch!(:connection)
    |> new_map_with_charlists()
    |> set_replication(replication?)
  end

  @spec get_proxy_opts(config()) :: proxy_opts()
  def get_proxy_opts(config) do
    config
    |> Keyword.fetch!(:proxy)
    |> Map.new()
  end

  defp new_map_with_charlists(list) do
    Map.new(list, fn
      {k, v} when is_binary(v) -> {k, String.to_charlist(v)}
      {k, v} -> {k, v}
    end)
  end

  defp set_replication(opts, false) do
    Map.delete(opts, :replication)
  end

  defp set_replication(opts, true) do
    opts
  end
end
