defmodule Electric.Config.Defaults do
  @moduledoc false

  # we want the default storage and kv implementations to honour the
  # `:storage_dir` configuration setting so we need to use runtime-evaluated
  # functions to get them. Since you can't embed anoymous functions these
  # functions are used instead.

  @doc false
  def storage(opts \\ []) do
    storage_dir = Keyword.get_lazy(opts, :storage_dir, fn -> storage_dir("shapes") end)
    {Electric.ShapeCache.PureFileStorage, storage_dir: storage_dir}
  end

  @doc false
  def persistent_kv(opts \\ []) do
    storage_dir = Keyword.get_lazy(opts, :storage_dir, fn -> storage_dir("state") end)
    {Electric.PersistentKV.Filesystem, :new!, root: storage_dir}
  end

  defp storage_dir(sub_dir) do
    Path.join(storage_dir(), sub_dir)
  end

  defp storage_dir do
    Electric.Config.get_env(:storage_dir)
  end

  def process_registry_partitions do
    System.schedulers_online()
  end
end

defmodule Electric.Config do
  require Logger

  @type instance_id :: String.t()

  @build_env Mix.env()

  @known_feature_flags ~w[allow_subqueries tagged_subqueries]
  @default_storage_dir "./persistent"

  @defaults [
    ## Database
    provided_database_id: "single_stack",
    db_pool_size: 20,
    replication_stream_id: "default",
    replication_slot_temporary?: false,
    replication_slot_temporary_random_name?: false,
    max_txn_size: 250 * 1024 * 1024,
    max_batch_size: 100,
    # Scaling down on idle is disabled by default
    replication_idle_timeout: 0,
    manual_table_publishing?: false,
    ## HTTP API
    # set enable_http_api: false to turn off the HTTP server totally
    enable_http_api: true,
    long_poll_timeout: 20_000,
    http_api_num_acceptors: nil,
    tcp_send_timeout: :timer.seconds(30),
    cache_max_age: 60,
    cache_stale_age: 60 * 5,
    chunk_bytes_threshold: Electric.ShapeCache.LogChunker.default_chunk_size_threshold(),
    allow_shape_deletion?: false,
    service_port: 3000,
    listen_on_ipv6?: false,
    stack_ready_timeout: 5_000,
    send_cache_headers?: true,
    max_shapes: nil,
    # This value should be tuned for the hardware it's running on.
    max_concurrent_requests: %{initial: 300, existing: 10_000},
    ## Storage
    storage_dir: @default_storage_dir,
    storage: &Electric.Config.Defaults.storage/0,
    persistent_kv: &Electric.Config.Defaults.persistent_kv/0,
    cleanup_interval_ms: 10_000,
    ## Telemetry
    instance_id: nil,
    prometheus_port: nil,
    call_home_telemetry?: @build_env == :prod,
    telemetry_statsd_host: nil,
    telemetry_url: URI.new!("https://checkpoint.electric-sql.com"),
    otel_sampling_ratio: 0.01,
    metrics_sampling_ratio: 1,
    ## Memory
    shape_hibernate_after: :timer.seconds(30),
    # Should we terminate consumer processes after `shape_hibernate_after` ms
    # or just hibernate them?
    shape_enable_suspend?: false,
    # Sets max_requests for Bandit handler processes:
    # https://hexdocs.pm/bandit/Bandit.html#t:http_1_options/0
    # "The maximum number of requests to serve in a single HTTP/{1,2}
    # connection before closing the connection"
    conn_max_requests: 50,
    ## Performance tweaks
    publication_alter_debounce_ms: 0,
    # allow for configuring per-process `Process.spawn_opt()`. In the form
    # %{process_id :: atom() => [Process.spawn_opt()]}
    # See `Process.flag/2`
    #
    # e.g. %{shape_log_collector: [min_heap_size: 1024 * 1024, min_bin_vheap_size: 1024 * 1024]}
    process_spawn_opts: %{},
    ## Misc
    process_registry_partitions: &Electric.Config.Defaults.process_registry_partitions/0,
    feature_flags: if(Mix.env() == :test, do: @known_feature_flags, else: []),
    publication_refresh_period: 60_000,
    schema_reconciler_period: 60_000,
    snapshot_timeout_to_first_data: :timer.seconds(30),
    shape_db_exclusive_mode: false,
    shape_db_storage_dir: @default_storage_dir,
    # TODO: fix defaults to synchronous=NORMAL and shape_db_cache_size=2048
    shape_db_synchronous:
      Electric.ShapeCache.ShapeStatus.ShapeDb.Connection.default!(:synchronous),
    shape_db_cache_size: Electric.ShapeCache.ShapeStatus.ShapeDb.Connection.default!(:cache_size),
    shape_db_enable_memory_stats: false
  ]

  @installation_id_key "electric_installation_id"

  def default(key) do
    case Keyword.fetch!(@defaults, key) do
      fun when is_function(fun, 0) -> fun.()
      value -> value
    end
  end

  @doc false
  @spec ensure_instance_id() :: instance_id()
  # the instance id needs to be consistent across calls, so we do need to have
  # a value in the config, even if it's not configured by the user.
  def ensure_instance_id do
    case Application.get_env(:electric, :instance_id) do
      nil ->
        instance_id = generate_instance_id()

        Logger.notice("Setting electric instance_id: #{instance_id}")
        Application.put_env(:electric, :instance_id, instance_id)

        instance_id

      id when is_binary(id) ->
        id
    end
  end

  defp generate_instance_id do
    Electric.Utils.uuid4()
  end

  # the installation id is persisted to disk to remain the same between restarts of the sync service
  @spec persist_installation_id(term, binary) :: instance_id()
  def persist_installation_id(persistent_kv, instance_id) when is_binary(instance_id) do
    case Electric.PersistentKV.get(persistent_kv, @installation_id_key) do
      {:ok, id} when is_binary(id) ->
        id

      {:error, :not_found} ->
        :ok = Electric.PersistentKV.set(persistent_kv, @installation_id_key, instance_id)
        instance_id
    end
  end

  @spec installation_id!(term) :: binary | no_return
  def installation_id!(kv) do
    case Electric.PersistentKV.get(kv, @installation_id_key) do
      {:ok, id} when is_binary(id) -> id
      {:error, :not_found} -> raise "Electric's installation_id not set"
    end
  end

  @doc """
  The minimum allowed time before Electric can close database connections due to the
  replication stream inactivity.

  This is to prevent churn where connection and replication supervisors would restart too frequently.

  The scale-to-zero feature of managed providers like Neon takes on the order of minutes before
  deciding that an idle database can be scaled down.
  """
  @spec min_replication_idle_timeout() :: pos_integer
  def min_replication_idle_timeout, do: 30_000

  def min_replication_idle_timeout_in_seconds, do: div(min_replication_idle_timeout(), 1000)

  @spec get_env(Application.key()) :: Application.value()
  def get_env(key) do
    # handle the case where the config value was set in runtime.exs but to
    # `nil` because of a missing env var. This allows us to just use `nil`
    # as the default config values in runtime.exs so avoiding hard-coding
    # defaults all over the place.
    case Application.get_env(:electric, key) do
      nil -> default(key)
      value -> value
    end
  end

  def get_env_lazy(key, fun) when is_function(fun, 0) do
    case Application.fetch_env(:electric, key) do
      {:ok, nil} -> fun.()
      {:ok, value} -> value
      :error -> fun.()
    end
  end

  @spec fetch_env!(Application.key()) :: Application.value()
  def fetch_env!(key) do
    Application.fetch_env!(:electric, key)
  end

  def persistent_kv do
    with {m, f, a} <- get_env(:persistent_kv) do
      apply(m, f, [a])
    end
  end

  @doc ~S"""
  Parse a PostgreSQL URI into a keyword list.

  ## Examples

      iex> parse_postgresql_uri("postgresql://postgres:password@example.com/app-db") |> deobfuscate()
      {:ok, [
        hostname: "example.com",
        port: 5432,
        database: "app-db",
        username: "postgres",
        password: "password",
      ]}

      iex> parse_postgresql_uri("postgresql://electric@192.168.111.33:81/__shadow")
      {:ok, [
        hostname: "192.168.111.33",
        port: 81,
        database: "__shadow",
        username: "electric"
      ]}

      iex> parse_postgresql_uri("postgresql://pg@[2001:db8::1234]:4321")
      {:ok, [
        hostname: "2001:db8::1234",
        port: 4321,
        database: "pg",
        username: "pg"
      ]}

      iex> parse_postgresql_uri("postgresql://user@localhost:5433/")
      {:ok, [
        hostname: "localhost",
        port: 5433,
        database: "user",
        username: "user"
      ]}

      iex> parse_postgresql_uri("postgresql://user%2Btesting%40gmail.com:weird%2Fpassword@localhost:5433/my%2Bdb%2Bname") |> deobfuscate()
      {:ok, [
        hostname: "localhost",
        port: 5433,
        database: "my+db+name",
        username: "user+testing@gmail.com",
        password: "weird/password"
      ]}

      iex> parse_postgresql_uri("postgres://super_user@localhost:7801/postgres?sslmode=disable")
      {:ok, [
        hostname: "localhost",
        port: 7801,
        database: "postgres",
        username: "super_user",
        sslmode: :disable
      ]}

      iex> parse_postgresql_uri("postgres://super_user@localhost:7801/postgres?sslmode=require")
      {:ok, [
        hostname: "localhost",
        port: 7801,
        database: "postgres",
        username: "super_user",
        sslmode: :require
      ]}

      iex> parse_postgresql_uri("postgres://super_user@localhost:7801/postgres?sslmode=yesplease")
      {:error, "invalid \"sslmode\" value: \"yesplease\""}

      iex> parse_postgresql_uri("postgrex://localhost")
      {:error, "invalid URL scheme: \"postgrex\""}

      iex> parse_postgresql_uri("postgresql://localhost")
      {:error, "invalid or missing username"}

      iex> parse_postgresql_uri("postgresql://:@localhost")
      {:error, "invalid or missing username"}

      iex> parse_postgresql_uri("postgresql://:password@localhost")
      {:error, "invalid or missing username"}

      iex> parse_postgresql_uri("postgresql://user:password")
      {:error, "invalid or missing username"}

      iex> parse_postgresql_uri("postgresql://user:password@")
      {:error, "missing host"}

      iex> parse_postgresql_uri("postgresql://user@localhost:5433/mydb?opts=-c%20synchronous_commit%3Doff&foo=bar")
      {:error, "unsupported query options: \"foo\", \"opts\""}

      iex> parse_postgresql_uri("postgresql://electric@localhost/db?replication=database")
      {:error, "unsupported \"replication\" query option. Electric opens both a replication connection and regular connections to Postgres as needed"}

      iex> parse_postgresql_uri("postgresql://electric@localhost/db?replication=off")
      {:error, "unsupported \"replication\" query option. Electric opens both a replication connection and regular connections to Postgres as needed"}
  """
  @spec parse_postgresql_uri(binary) :: {:ok, keyword} | {:error, binary}
  def parse_postgresql_uri(uri_str) do
    %URI{scheme: scheme, host: host, port: port, path: path, userinfo: userinfo, query: query} =
      URI.parse(uri_str)

    with :ok <- validate_url_scheme(scheme),
         :ok <- validate_url_host(host),
         {:ok, {username, password}} <- parse_url_userinfo(userinfo),
         {:ok, options} <- parse_url_query(query) do
      conn_params =
        Enum.reject(
          [
            hostname: host,
            port: port || 5432,
            database: parse_database(path, username) |> URI.decode(),
            username: URI.decode(username),
            password: if(password, do: password |> URI.decode() |> Electric.Utils.wrap_in_fun())
          ] ++ options,
          fn {_key, val} -> is_nil(val) end
        )

      {:ok, conn_params}
    end
  end

  def parse_postgresql_uri!(uri_str) do
    case parse_postgresql_uri(uri_str) do
      {:ok, results} -> results
      {:error, message} -> raise Dotenvy.Error, message: message
    end
  end

  defp validate_url_scheme(scheme) when scheme in ["postgres", "postgresql"], do: :ok
  defp validate_url_scheme(scheme), do: {:error, "invalid URL scheme: #{inspect(scheme)}"}

  defp validate_url_host(str) do
    if is_binary(str) and String.trim(str) != "" do
      :ok
    else
      {:error, "missing host"}
    end
  end

  defp parse_url_userinfo(str) do
    with false <- is_nil(str),
         {:ok, {username, password}} <- split_userinfo(str),
         false <- String.trim(username) == "" do
      {:ok, {username, password}}
    else
      _ -> {:error, "invalid or missing username"}
    end
  end

  defp split_userinfo(str) do
    case String.split(str, ":") do
      [username] -> {:ok, {username, nil}}
      [username, password] -> {:ok, {username, password}}
      _ -> :error
    end
  end

  defp parse_url_query(nil), do: {:ok, []}

  defp parse_url_query(query_str) do
    case URI.decode_query(query_str) do
      empty when map_size(empty) == 0 ->
        {:ok, []}

      %{"sslmode" => sslmode} when sslmode in ~w[disable allow prefer require] ->
        {:ok, sslmode: String.to_existing_atom(sslmode)}

      %{"sslmode" => sslmode} when sslmode in ~w[verify-ca verify-full] ->
        {:error,
         "unsupported \"sslmode\" value #{inspect(sslmode)}. Use sslmode=require and set the ELECTRIC_DATABASE_CA_CERTIFICATE_FILE config to ensure Electric verifies database server identity"}

      %{"sslmode" => sslmode} ->
        {:error, "invalid \"sslmode\" value: #{inspect(sslmode)}"}

      %{"replication" => _} ->
        {:error,
         "unsupported \"replication\" query option. Electric opens both a replication connection and regular connections to Postgres as needed"}

      map ->
        {:error,
         "unsupported query options: " <>
           (map |> Map.keys() |> Enum.sort() |> Enum.map_join(", ", &inspect/1))}
    end
  end

  defp parse_database(nil, username), do: username
  defp parse_database("/", username), do: username
  defp parse_database("/" <> dbname, _username), do: dbname

  @log_levels ~w[emergency alert critical error warning warn notice info debug]
  @public_log_levels ~w[error warning info debug]

  @spec parse_log_level(binary) :: {:ok, Logger.level()} | {:error, binary}
  def parse_log_level(str) when str in @log_levels do
    {:ok, String.to_existing_atom(str)}
  end

  def parse_log_level(str) do
    {:error, "invalid log level: #{inspect(str)}. Must be one of #{inspect(@public_log_levels)}"}
  end

  def parse_log_level!(str) when str in @log_levels, do: String.to_existing_atom(str)

  def parse_log_level!(_str) do
    raise Dotenvy.Error, message: "Must be one of #{inspect(@public_log_levels)}"
  end

  @spec parse_telemetry_url(binary) :: {:ok, binary} | {:error, binary}
  def parse_telemetry_url(str) do
    case URI.new(str) do
      {:ok, %URI{scheme: scheme}} when scheme in ["http", "https"] -> {:ok, str}
      _ -> {:error, "invalid URL format: \"#{str}\""}
    end
  end

  def parse_telemetry_url!(str) do
    case parse_telemetry_url(str) do
      {:ok, url} -> url
      {:error, message} -> raise Dotenvy.Error, message: message
    end
  end

  @time_units ~w[ms msec s sec m min]

  @spec parse_human_readable_time(binary | nil) :: {:ok, pos_integer} | {:error, binary}

  def parse_human_readable_time(str) do
    with {num, suffix} <- Float.parse(str),
         true <- num > 0,
         suffix = String.trim(suffix),
         true <- suffix == "" or suffix in @time_units do
      {:ok, trunc(num * time_multiplier(suffix))}
    else
      _ -> {:error, "invalid time unit: #{inspect(str)}. Must be one of #{inspect(@time_units)}"}
    end
  end

  defp time_multiplier(""), do: 1
  defp time_multiplier(millisecond) when millisecond in ["ms", "msec"], do: 1
  defp time_multiplier(second) when second in ["s", "sec"], do: 1000
  defp time_multiplier(minute) when minute in ["m", "min"], do: 1000 * 60

  def parse_human_readable_time!(str) do
    case parse_human_readable_time(str) do
      {:ok, result} -> result
      {:error, message} -> raise Dotenvy.Error, message: message
    end
  end

  @doc """
  Parse human-readable memory/storage size string into bytes.

  ## Examples

    iex> parse_human_readable_size("1GiB")
    {:ok, #{1024 * 1024 * 1024}}

    iex> parse_human_readable_size("2.23GB")
    {:ok, 2_230_000_000}

    iex> parse_human_readable_size("256MiB")
    {:ok, #{256 * 1024 * 1024}}

    iex> parse_human_readable_size("377MB")
    {:ok, 377_000_000}

    iex> parse_human_readable_size("430KiB")
    {:ok, #{430 * 1024}}

    iex> parse_human_readable_size("142888KB")
    {:ok, 142_888_000}

    iex> parse_human_readable_size("123456789")
    {:ok, 123_456_789}

    iex> parse_human_readable_size("")
    {:error, ~S'invalid size unit: "". Must be one of ["KB", "KiB", "MB", "MiB", "GB", "GiB"]'}

    iex> parse_human_readable_size("foo")
    {:error, ~S'invalid size unit: "foo". Must be one of ["KB", "KiB", "MB", "MiB", "GB", "GiB"]'}
  """
  @spec parse_human_readable_size(binary) :: {:ok, pos_integer} | {:error, binary}

  @size_units ~w[KB KiB MB MiB GB GiB]

  def parse_human_readable_size(str) do
    with {num, suffix} <- Float.parse(str),
         true <- num > 0,
         suffix = String.trim(suffix),
         true <- suffix == "" or suffix in @size_units do
      {:ok, trunc(num * size_multiplier(suffix))}
    else
      _ -> {:error, "invalid size unit: #{inspect(str)}. Must be one of #{inspect(@size_units)}"}
    end
  end

  defp size_multiplier(""), do: 1
  defp size_multiplier("KB"), do: 1_000
  defp size_multiplier("KiB"), do: 1024
  defp size_multiplier("MB"), do: 1_000_000
  defp size_multiplier("MiB"), do: 1024 * 1024
  defp size_multiplier("GB"), do: 1_000_000_000
  defp size_multiplier("GiB"), do: 1024 * 1024 * 1024

  def parse_human_readable_size!(str) do
    case parse_human_readable_size(str) do
      {:ok, result} -> result
      {:error, message} -> raise Dotenvy.Error, message: message
    end
  end

  def validate_security_config!(secret, insecure) do
    cond do
      insecure && secret != nil ->
        raise "You cannot set both ELECTRIC_SECRET and ELECTRIC_INSECURE=true"

      !insecure && secret == nil ->
        raise "You must set ELECTRIC_SECRET unless ELECTRIC_INSECURE=true. Setting ELECTRIC_INSECURE=true risks exposing your database, only use insecure mode in development or you've otherwise secured the Electric API"

      true ->
        if insecure do
          Logger.warning(
            "Electric is running in insecure mode - this risks exposing your database - only use insecure mode in development or if you've otherwise secured the Electric API."
          )
        end

        :ok
    end
  end

  @valid_spawn_opts ~w[min_bin_vheap_size min_heap_size priority fullsweep_after message_queue_data]

  @doc """
  Parse `spawn_opts` from environment variable to keyword list suitable for passing to `GenServer.start_link/2`

  ## Examples

      iex> parse_spawn_opts!(~S({"shape_log_collector":{"min_heap_size":234,"min_bin_vheap_size":123,"message_queue_data":"on_heap","priority":"high","fullsweep_after":104}}))
      %{shape_log_collector: [fullsweep_after: 104, message_queue_data: :on_heap, min_bin_vheap_size: 123, min_heap_size: 234, priority: :high]}

      iex> parse_spawn_opts!(~S({"shape_log_collector":{"monkey":123,"message_queue_data":"on_fire","min_bin_vheap_size":-1,"priority":"high"}}))
      %{shape_log_collector: [priority: :high]}

      iex> parse_spawn_opts!("")
      %{}

      iex> parse_spawn_opts!("{}")
      %{}
  """
  def parse_spawn_opts!("") do
    %{}
  end

  def parse_spawn_opts!(str) do
    str
    |> Jason.decode!()
    |> then(fn
      opts when is_map(opts) ->
        for {process_name, process_opts} <- opts, is_map(process_opts), into: %{} do
          opts =
            for {opt_key, opt_val} <- process_opts,
                opt_key in @valid_spawn_opts,
                key = String.to_atom(opt_key),
                val = validate_spawn_opt(key, opt_val) do
              {key, val}
            end

          {String.to_atom(process_name), opts}
        end

      _invalid ->
        raise ArgumentError, message: "Invalid spawn opts: #{inspect(str)}"
    end)
    |> tap(fn process_spawn_opts ->
      if map_size(process_spawn_opts) > 0 do
        Logger.notice("Process spawn opts: #{inspect(process_spawn_opts)}")
      end
    end)
  end

  defp validate_spawn_opt(:min_bin_vheap_size, val) when is_integer(val) and val >= 0, do: val
  defp validate_spawn_opt(:min_heap_size, val) when is_integer(val) and val >= 0, do: val

  defp validate_spawn_opt(:priority, val) when val in ["low", "normal", "high"],
    do: String.to_atom(val)

  defp validate_spawn_opt(:fullsweep_after, val) when is_integer(val) and val >= 0, do: val

  defp validate_spawn_opt(:message_queue_data, val) when val in ["off_heap", "on_heap"],
    do: String.to_atom(val)

  defp validate_spawn_opt(_, _), do: nil

  @doc false
  # helper function for use in doc tests
  def deobfuscate({:ok, connection_opts}),
    do: {:ok, Electric.Utils.deobfuscate_password(connection_opts)}

  def deobfuscate(other), do: other

  def parse_feature_flags(str) do
    str
    |> String.split(",")
    |> Enum.map(&String.trim/1)
    |> Enum.reject(&(&1 == ""))
    |> Enum.split_with(&(&1 in @known_feature_flags))
    |> case do
      {known, []} ->
        known

      {known, unknown} ->
        # Log an error but don't raise so that deployments can proceeed without
        # removal of old flags and new flags can be added before deployment
        Logger.error(
          "Unknown feature flags specified: #{inspect(unknown)}. Known feature flags: #{inspect(@known_feature_flags)}"
        )

        known
    end
  end
end
