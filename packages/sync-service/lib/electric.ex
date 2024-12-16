defmodule Electric do
  @connection_opts [
    hostname: [type: :string, required: true, doc: "Server hostname"],
    port: [type: :integer, required: true, doc: "Server port"],
    database: [type: :string, required: true, doc: "Database"],
    username: [type: :string, required: true, doc: "Username"],
    password: [
      type: {:fun, 0},
      required: true,
      doc:
        "User password. To prevent leaking of the Pg password in logs and stack traces, you **must** wrap the password with a function." <>
          " We provide `Electric.Utils.obfuscate_password/1` which will return the `connection_opts` with a wrapped password value.\n\n" <>
          "    config :electric, connection_opts: Electric.Utils.obfuscate_password(connection_opts)"
    ],
    sslmode: [
      type: {:in, [:disable, :allow, :prefer, :require]},
      required: false,
      default: :disable,
      doc:
        "Connection SSL configuration. See https://www.postgresql.org/docs/current/libpq-ssl.html#LIBPQ-SSL-SSLMODE-STATEMENTS",
      type_spec: quote(do: :disable | :allow | :prefer | :require)
    ],
    ipv6: [
      type: :boolean,
      required: false,
      default: false,
      doc: "Whether to use IPv6 for database connections"
    ]
  ]
  opts_schema = NimbleOptions.new!(@connection_opts)

  @type pg_connection_opts :: [unquote(NimbleOptions.option_typespec(opts_schema))]

  @moduledoc """

  ## Configuration options

  When embedding Electric, the following options are available:

      config :electric,
        connection_opts: nil
        provided_database_id: nil,
        allow_shape_deletion: false,
        cache_max_age: 60,
        cache_stale_age: 300,
        chunk_bytes_threshold: 10 * 1024 * 1024,
        instance_id: nil,
        telemetry_statsd_host: nil,
        db_pool_size: 20
        replication_stream_id: "default",
        replication_slot_temporary?: false
        service_port: 3000,
        prometheus_port: nil,
        storage_dir: "./persistent",
        storage: {Electric.ShapeCache.FileStorage, storage_dir: "./persistent/shapes"},
        persistent_kv: {Electric.PersistentKV.Filesystem, :new!, root: "./persistent/state"},
        listen_on_ipv6?: false,
        call_home_telemetry: true,
        telemetry_url: "https://checkpoint.electric-sql.com"

  Only the `connection_opts` are required.

  ### Database

  - `connection_opts` - **Required**
     #{NimbleOptions.docs(opts_schema, nest_level: 1)}.
  - `db_pool_size` - How many connections Electric opens as a pool for handling shape queries (default: `20`)
  - `replication_stream_id` - Suffix for the logical replication publication and slot name (default: `"default"`)

  ### HTTP API

  - `service_port` - Port that the [HTTP API](https://electric-sql.com/docs/api/http) is exposed on (default: `3000`)
  - `allow_shape_deletion` - Whether to allow deletion of Shapes via the HTTP API (default: `false`)
  - `cache_max_age` - Default `max-age` for the cache headers of the HTTP API in seconds (default: `60`s)
  - `cache_stale_age` - Default `stale-age` for the cache headers of the HTTP API in seconds (default: `300`s)
  - `chunk_bytes_threshold` - Limit the maximum size in bytes of a shape log response,
    to ensure they are cached by upstream caches. (default: `10 * 1024 *
    1024` (10MiB)).
  - `listen_on_ipv6?` - Whether the HTTP API should listen on IPv6 as well as IPv4 (default: `false`)

  ### Storage

  - `storage_dir` - Path to root folder for storing data on the filesystem (default: `"./persistent"`)
  - `storage` - Where to store shape logs. Must be a 2-tuple of `{module(),
    term()}` where `module` points to an implementation of the
    `Electric.ShapeCache.Storage` behaviour. (default:
    `{Electric.ShapeCache.FileStorage, storage_dir: "./persistent/shapes"}`)
  - `persistent_kv` - A mfa that when called constructs an implementation of
    the `Electric.PersistentKV` behaviour, used to store system state (defau7lt:
    `{Electric.PersistentKV.Filesystem, :new!, root: "./persistent/state"}`)

  ### Telemetry

  - `instance_id` - A unique identifier for the Electric instance (default: a
    randomly generated UUID). Set this to enable tracking of instance usage
    metrics across restarts.
  - `telemetry_statsd_host` - If set, send telemetry data to the given StatsD reporting endpoint (default: `nil`)
  - `prometheus_port` -If set, expose a prometheus reporter for telemetry data on the specified port (default: `nil`)
  - `call_home_telemetry` - Allow [anonymous usage
    data](https://electric-sql.com/docs/reference/telemetry#anonymous-usage-data)
    about the instance being sent to a central checkpoint service (default: `true`)
  - `telemetry_url` - Where to send the usage data (default: `"https://checkpoint.electric-sql.com"`)

  ### Deprecated

  - `provided_database_id` - The provided database id is relevant if you had
    used v0.8 and want to keep the storage instead of having hanging files. We
    use a provided value as stack id, but nothing else.
  """

  require Logger

  @doc false
  def connection_opts_schema do
    @connection_opts
  end

  @doc false
  @spec ensure_instance_id() :: :ok
  # the instance id needs to be consistent across calls, so we do need to have
  # a value in the config, even if it's not configured by the user.
  def ensure_instance_id do
    case get_env(:instance_id, nil) do
      nil ->
        instance_id = generate_instance_id()

        Logger.info("Setting electric instance_id: #{instance_id}")
        Application.put_env(:electric, :instance_id, instance_id)

      id when is_binary(id) ->
        :ok
    end
  end

  defp generate_instance_id do
    Electric.Utils.uuid4()
  end

  @doc """
  `instance_id` is used to track a particular server's telemetry metrics.
  """
  @spec instance_id() :: binary | no_return
  def instance_id do
    fetch_env!(:instance_id)
  end

  @type relation :: {schema :: String.t(), table :: String.t()}
  @type relation_id :: non_neg_integer()

  @current_vsn Mix.Project.config()[:version]
  def version do
    @current_vsn
  end

  @spec get_env(atom(), term()) :: term()
  def get_env(key, default) do
    # use the `||` as well as the get_env default because it allows us to
    # remove the defaults from the runtime.exs file env var retrieval and only
    # hard-code the default values once where they're used.
    Application.get_env(:electric, key, default) || default
  end

  def fetch_env!(key) do
    Application.fetch_env!(:electric, key)
  end

  def default_storage do
    {Electric.ShapeCache.FileStorage, storage_dir: storage_dir("shapes")}
  end

  def default_persistent_kv do
    {Electric.PersistentKV.Filesystem, :new!, root: storage_dir("state")}
  end

  defp storage_dir(sub_dir) do
    Path.join(storage_dir(), sub_dir)
  end

  defp storage_dir do
    get_env(:storage_dir, "./persistent")
  end
end
