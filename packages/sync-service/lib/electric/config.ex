defmodule Electric.Config.Defaults do
  @moduledoc false

  # we want the default storage and kv implementations to honour the
  # `:storage_dir` configuration setting so we need to use runtime-evaluated
  # functions to get them. Since you can't embed anoymous functions these
  # functions are used instead.

  @doc false
  def storage(opts \\ []) do
    storage_dir = Keyword.get_lazy(opts, :storage_dir, fn -> storage_dir("shapes") end)
    {Electric.ShapeCache.FileStorage, storage_dir: storage_dir}
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
end

defmodule Electric.Config do
  require Logger

  @build_env Mix.env()

  @defaults [
    ## Database
    provided_database_id: "single_stack",
    db_pool_size: 20,
    replication_stream_id: "default",
    replication_slot_temporary?: false,
    ## HTTP API
    # set enable_http_api: false to turn off the HTTP server totally
    enable_http_api: true,
    long_poll_timeout: 20_000,
    cache_max_age: 60,
    cache_stale_age: 60 * 5,
    chunk_bytes_threshold: Electric.ShapeCache.LogChunker.default_chunk_size_threshold(),
    allow_shape_deletion?: false,
    service_port: 3000,
    listen_on_ipv6?: false,
    stack_ready_timeout: 5_000,
    send_cache_headers?: true,
    ## Storage
    storage_dir: "./persistent",
    storage: &Electric.Config.Defaults.storage/0,
    persistent_kv: &Electric.Config.Defaults.persistent_kv/0,
    ## Telemetry
    instance_id: nil,
    prometheus_port: nil,
    call_home_telemetry?: @build_env == :prod,
    telemetry_statsd_host: nil,
    telemetry_url: URI.new!("https://checkpoint.electric-sql.com"),
    system_metrics_poll_interval: :timer.seconds(5),
    otel_export_period: :timer.seconds(30),
    otel_per_process_metrics?: false,
    telemetry_top_process_count: 5,
    ## Memory
    shape_hibernate_after: :timer.seconds(30)
  ]

  @installation_id_key "electric_installation_id"

  def default(key) do
    case Keyword.fetch!(@defaults, key) do
      fun when is_function(fun, 0) -> fun.()
      value -> value
    end
  end

  @doc false
  @spec ensure_instance_id() :: :ok
  # the instance id needs to be consistent across calls, so we do need to have
  # a value in the config, even if it's not configured by the user.
  def ensure_instance_id do
    case Application.get_env(:electric, :instance_id) do
      nil ->
        instance_id = generate_instance_id()

        Logger.info("Setting electric instance_id: #{instance_id}")
        Application.put_env(:electric, :instance_id, instance_id)

        instance_id

      id when is_binary(id) ->
        id
    end
  end

  defp generate_instance_id do
    Electric.Utils.uuid4()
  end

  @spec ensure_installation_id(keyword, binary) :: :ok
  # the installation id is persisted to disk to remain the same between restarts of the sync service
  def ensure_installation_id(config, instance_id)
      when is_list(config) and is_binary(instance_id) do
    kv = Keyword.fetch!(config, :persistent_kv)

    case Electric.PersistentKV.get(kv, @installation_id_key) do
      {:ok, id} when is_binary(id) ->
        id

      {:error, :not_found} ->
        :ok = Electric.PersistentKV.set(kv, @installation_id_key, instance_id)
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

      iex> parse_postgresql_uri("postgresql://postgres:password@example.com/app-db")
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

      iex> parse_postgresql_uri("postgresql://user%2Btesting%40gmail.com:weird%2Fpassword@localhost:5433/my%2Bdb%2Bname")
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
            password: if(password, do: URI.decode(password))
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
         "unsupported \"sslmode\" value #{inspect(sslmode)}. Consider using the DATABASE_REQUIRE_SSL configuration option"}

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
end
