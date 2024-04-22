defmodule Electric.Replication.Connectors do
  use DynamicSupervisor

  @type origin() :: binary()

  @type connection_config_opt() :: :epgsql.connect_option() | {:ipv6, boolean()}
  @type connection_config() :: [connection_config_opt(), ...]

  @type electric_connection_opt() ::
          {:host, binary()}
          | {:port, pos_integer()}
          | {:dbname, binary()}
          | {:connect_timeout, non_neg_integer()}
  @type replication_config() :: [{:electric_connection, [electric_connection_opt(), ...]}]

  @type proxy_listen_opts() :: ThousandIsland.options()
  @type proxy_config_opt() ::
          {:listen, proxy_listen_opts()}
          | {:use_http_tunnel?, boolean()}
          | {:password, binary()}
          | {:log_level, Logger.level()}
  @type proxy_config() :: [proxy_config_opt(), ...]

  @type wal_window_config_opt() ::
          {:resumable_size, pos_integer()}
          | {:in_memory_size, pos_integer()}
  @type wal_window_config() :: [wal_window_config_opt(), ...]

  @type config_opt() ::
          {:origin, origin()}
          | {:connection, connection_config()}
          | {:replication, replication_config()}
          | {:proxy, proxy_config()}
          | {:wal_window, wal_window_config()}

  @type config() :: [config_opt(), ...]

  @type replication_opts() :: %{
          slot: String.t(),
          publication: String.t(),
          subscription: String.t(),
          electric_connection: %{
            host: String.t(),
            port: pos_integer(),
            dbname: String.t(),
            connect_timeout: non_neg_integer()
          }
        }

  @type connection_opts() :: %{
          host: charlist(),
          port: :inet.port_number(),
          database: charlist(),
          username: charlist(),
          password: charlist(),
          replication: charlist(),
          ssl: :required | boolean(),
          ipv6: boolean(),
          timeout: non_neg_integer(),
          ip_addr: :inet.ip_address(),
          tcp_opts: [:gen_tcp.connect_option(), ...]
        }

  @type proxy_opts() :: %{
          listen: proxy_listen_opts(),
          use_http_tunnel?: boolean,
          password: binary(),
          log_level: Logger.level()
        }

  @type wal_window_opts() :: %{
          resumable_size: pos_integer(),
          in_memory_size: pos_integer()
        }

  alias Electric.Postgres.Extension

  def static_name do
    Electric.static_name(__MODULE__)
  end

  def start_link(extra_args) do
    DynamicSupervisor.start_link(__MODULE__, extra_args, name: static_name())
  end

  @impl DynamicSupervisor
  def init(_extra_args) do
    DynamicSupervisor.init(strategy: :one_for_one, max_restarts: 0)
  end

  @spec start_connector(module(), term()) :: Supervisor.on_start()
  def start_connector(module, args) do
    DynamicSupervisor.start_child(static_name(), {module, args})
  end

  @spec stop_connector(pid()) :: :ok | {:error, term()}
  def stop_connector(pid) do
    DynamicSupervisor.terminate_child(static_name(), pid)
  end

  def status(opt \\ :pretty) do
    map_fun =
      case opt do
        :pretty ->
          fn {_, pid, _, [module]} -> {module.name(pid), module.status(pid)} end

        :raw ->
          fn {_, pid, _, [module]} -> {module, pid} end
      end

    static_name()
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
    replication? = Keyword.get(opts, :replication, false)

    config
    |> Keyword.fetch!(:connection)
    |> new_map_with_charlists()
    |> maybe_keep_replication(replication?)
  end

  defp new_map_with_charlists(list) do
    Map.new(list, fn
      {k, v} when is_binary(v) -> {k, String.to_charlist(v)}
      {k, v} -> {k, v}
    end)
  end

  defp maybe_keep_replication(opts, false) do
    Map.delete(opts, :replication)
  end

  defp maybe_keep_replication(opts, true) do
    opts
  end

  @spec get_proxy_opts(config()) :: proxy_opts()
  def get_proxy_opts(config) do
    config
    |> Keyword.fetch!(:proxy)
    |> Map.new()
  end

  @spec get_wal_window_opts(config()) :: wal_window_opts()
  def get_wal_window_opts(config) do
    config
    |> Keyword.fetch!(:wal_window)
    |> Map.new()
  end

  @spec write_to_pg_mode(config()) :: Electric.write_to_pg_mode()
  def write_to_pg_mode(config) do
    Keyword.get(config, :write_to_pg_mode, Electric.write_to_pg_mode())
  end

  # This is needed to please Dialyzer.
  @spec pop_extraneous_conn_opts(connection_opts()) :: {map, :epgsql.connect_opts_map()}
  def pop_extraneous_conn_opts(conn_opts) do
    Map.split(conn_opts, [:ipv6, :ip_addr])
  end
end
