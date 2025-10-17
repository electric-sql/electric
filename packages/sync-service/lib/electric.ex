defmodule Electric do
  @connection_opts [
    hostname: [type: :string, required: true, doc: "Server hostname"],
    port: [type: :integer, required: true, doc: "Server port"],
    database: [type: :string, required: true, doc: "Database"],
    username: [type: :string, required: true, doc: "Username"],
    password: [type: {:or, [:string, {:fun, 0}]}, required: true, doc: "User password"],
    sslmode: [
      type: {:in, [:disable, :allow, :prefer, :require]},
      required: false,
      default: :prefer,
      doc:
        "Connection SSL configuration. See https://www.postgresql.org/docs/current/libpq-ssl.html#LIBPQ-SSL-SSLMODE-STATEMENTS",
      type_spec: quote(do: :disable | :allow | :prefer | :require)
    ],
    ipv6: [
      type: :boolean,
      required: false,
      default: false,
      doc: "Whether to use IPv6 for database connections"
    ],
    cacertfile: [
      type: :string,
      required: false,
      doc:
        "The path to a file containing trusted certificate(s) that will be used " <>
          "to verify the certificate obtained from the database server during the TLS handshake"
    ]
  ]
  opts_schema = NimbleOptions.new!(@connection_opts)

  @type pg_connection_opts :: [unquote(NimbleOptions.option_typespec(opts_schema))]
  @type stack_id :: binary()

  default = fn key -> inspect(Electric.Config.default(key)) end

  @moduledoc """

  ## Configuration options

  When embedding Electric, the following options are available:

      config :electric,
        connection_opts: nil
        # Database
        provided_database_id: #{default.(:provided_database_id)},
        db_pool_size: #{default.(:db_pool_size)},
        replication_stream_id: #{default.(:replication_stream_id)},
        replication_slot_temporary?: #{default.(:replication_slot_temporary?)},
        max_txn_size: #{default.(:max_txn_size)},
        # HTTP API
        service_port: #{default.(:service_port)},
        allow_shape_deletion?: #{default.(:allow_shape_deletion?)},
        cache_max_age: #{default.(:cache_max_age)},
        cache_stale_age: #{default.(:cache_stale_age)},
        chunk_bytes_threshold: #{default.(:chunk_bytes_threshold)},
        listen_on_ipv6?: #{default.(:listen_on_ipv6?)},
        # Storage
        storage_dir: #{default.(:storage_dir)},
        storage: #{default.(:storage)},
        persistent_kv: #{default.(:persistent_kv)},
        # Telemetry
        instance_id: #{default.(:instance_id)},
        telemetry_statsd_host: #{default.(:telemetry_statsd_host)},
        prometheus_port: #{default.(:prometheus_port)},
        call_home_telemetry?: #{default.(:call_home_telemetry?)},
        telemetry_url: #{default.(:telemetry_url)},

  Only the `connection_opts` are required.

  ### Database

  - `replication_connection_opts` - **Required**
     #{NimbleOptions.docs(opts_schema, nest_level: 1)}.
  - `query_connection_opts` - Optional separate connection string that can use a pooler for non-replication queries (default: nil)
     #{NimbleOptions.docs(opts_schema, nest_level: 1)}.
  - `db_pool_size` - How many connections Electric opens as a pool for handling shape queries (default: `#{default.(:db_pool_size)}`)
  - `replication_stream_id` - Suffix for the logical replication publication and slot name (default: `#{default.(:replication_stream_id)}`)

  ### HTTP API

  - `service_port` (`t:integer/0`) - Port that the [HTTP API](https://electric-sql.com/docs/api/http) is exposed on (default: `#{default.(:service_port)}`)
  - `allow_shape_deletion?` (`t:boolean/0`) - Whether to allow deletion of Shapes via the HTTP API (default: `#{default.(:allow_shape_deletion?)}`)
  - `cache_max_age` (`t:integer/0`) - Default `max-age` for the cache headers of the HTTP API in seconds (default: `#{default.(:cache_max_age)}`s)
  - `cache_stale_age` (`t:integer/0`) - Default `stale-age` for the cache headers of the HTTP API in seconds (default: `#{default.(:cache_stale_age)}`s)
  - `chunk_bytes_threshold` (`t:integer/0`) - Limit the maximum size in bytes of a shape log response,
    to ensure they are cached by upstream caches. (default: `#{default.(:chunk_bytes_threshold)}` (10MiB)).
  - `listen_on_ipv6?` (`t:boolean/0`) - Whether the HTTP API should listen on IPv6 as well as IPv4 (default: `#{default.(:listen_on_ipv6?)}`)

  ### Storage

  - `storage_dir` (`t:String.t/0`) - Path to root folder for storing data on the filesystem (default: `#{default.(:storage_dir)}`)
  - `storage` (`t:Electric.ShapeCache.Storage.storage/0`) - Where to store shape logs. Must be a 2-tuple of `{module(),
    term()}` where `module` points to an implementation of the
    `Electric.ShapeCache.Storage` behaviour. (default: `#{default.(:storage)}`)
  - `persistent_kv` (`t:Electric.PersistentKV.t/0`) - A mfa that when called constructs an implementation of
    the `Electric.PersistentKV` behaviour, used to store system state (default: `#{default.(:persistent_kv)}`)

  ### Telemetry

  - `instance_id` (`t:binary/0`) - A unique identifier for the Electric instance. Set this to
    enable tracking of instance usage metrics across restarts, otherwise will be
    randomly generated at boot (default: a randomly generated UUID).
  - `telemetry_statsd_host` (`t:String.t/0`) - If set, send telemetry data to the given StatsD reporting endpoint (default: `#{default.(:telemetry_statsd_host)}`)
  - `prometheus_port` (`t:integer/0`) - If set, expose a prometheus reporter for telemetry data on the specified port (default: `#{default.(:prometheus_port)}`)
  - `call_home_telemetry?` (`t:boolean/0`) - Allow [anonymous usage
    data](https://electric-sql.com/docs/reference/telemetry#anonymous-usage-data)
    about the instance being sent to a central checkpoint service (default: `true` for production)
  - `telemetry_url` (`t:URI.t/0`) - Where to send the usage data (default: `#{default.(:telemetry_url)}`)

  ### Deprecated

  - `provided_database_id` (`t:binary/0`) - The provided database id is relevant if you had
    used v0.8 and want to keep the storage instead of having hanging files. We
    use a provided value as stack id, but nothing else.
  """

  @doc false
  def connection_opts_schema do
    @connection_opts
  end

  @type relation :: {schema :: String.t(), table :: String.t()}
  @type relation_id :: non_neg_integer()
  @type oid_relation :: {oid :: relation_id(), relation :: relation()}

  @doc false
  defguard is_relation(relation)
           when is_tuple(relation) and tuple_size(relation) == 2 and
                  is_binary(elem(relation, 0)) and
                  is_binary(elem(relation, 1))

  @doc false
  defguard is_relation_id(oid) when is_integer(oid) and oid >= 0

  defguard is_oid_relation(oid_relation)
           when is_tuple(oid_relation) and tuple_size(oid_relation) == 2 and
                  is_relation_id(elem(oid_relation, 0)) and
                  is_relation(elem(oid_relation, 1))

  @current_vsn Mix.Project.config()[:version]
  def version do
    @current_vsn
  end

  @telemetry_enabled? Mix.target() == Electric.MixProject.telemetry_target()
  def telemetry_enabled? do
    @telemetry_enabled?
  end

  def stack_events_registry do
    Electric.StackEventsRegistry
  end
end
