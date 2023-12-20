defmodule Electric.Config do
  @type maybe_string :: binary | nil

  @spec parse_database_url(maybe_string, :dev | :test | :prod) ::
          {:ok, keyword | nil} | {:error, binary}
  def parse_database_url(val, config_env) do
    if is_nil(val) or String.trim(val) == "" do
      if config_env == :test do
        {:ok, nil}
      else
        {:error, "not set"}
      end
    else
      parse_postgresql_uri(val)
    end
  end

  @spec parse_write_to_pg_mode(binary) :: {:ok, Electric.write_to_pg_mode()} | {:error, binary}
  def parse_write_to_pg_mode("logical_replication"), do: {:ok, :logical_replication}
  def parse_write_to_pg_mode("direct_writes"), do: {:ok, :direct_writes}

  def parse_write_to_pg_mode(str) do
    if String.trim(str) == "" do
      {:error, "erroneously set to an empty value"}
    else
      {:error, "has invalid value: #{inspect(str)}"}
    end
  end

  @spec parse_logical_publisher_host(
          maybe_string,
          {:ok, Electric.write_to_pg_mode()} | {:error, binary}
        ) :: {:ok, maybe_string} | {:error, binary}
  def parse_logical_publisher_host(val, {:ok, :direct_writes}), do: {:ok, val}

  def parse_logical_publisher_host(val, _) do
    if is_nil(val) or String.trim(val) == "" do
      {:error, "not set"}
    else
      {:ok, val}
    end
  end

  @spec parse_log_level(binary) :: {:ok, Logger.level()} | {:error, binary}

  def parse_log_level(str)
      when str in ~w[emergency alert critical error warning warn notice info debug],
      do: {:ok, String.to_existing_atom(str)}

  def parse_log_level(str) do
    {:error, "has invalid value: #{inspect(str)}"}
  end

  @spec parse_pg_proxy_password(maybe_string) :: {:ok, maybe_string} | {:error, binary}
  def parse_pg_proxy_password(val) do
    if is_nil(val) or String.trim(val) == "" do
      {:error, "not set"}
    else
      {:ok, val}
    end
  end

  @doc """
  Parse a PostgreSQL URI into a keyword list.

  ## Examples

      iex> parse_postgresql_uri("postgresql://postgres:password@example.com/app-db")
      [
        host: "example.com",
        port: 5432,
        database: "app-db",
        username: "postgres",
        password: "password",
      ]

      iex> parse_postgresql_uri("postgresql://electric@192.168.111.33:81/__shadow")
      [
        host: "192.168.111.33",
        port: 81,
        database: "__shadow",
        username: "electric"
      ]

      iex> parse_postgresql_uri("postgresql://pg@[2001:db8::1234]:4321")
      [
        host: "2001:db8::1234",
        port: 4321,
        database: "pg",
        username: "pg"
      ]

      iex> parse_postgresql_uri("postgresql://user@localhost:5433/")
      [
        host: "localhost",
        port: 5433,
        database: "user",
        username: "user"
      ]

      iex> parse_postgresql_uri("postgresql://localhost")
      ** (RuntimeError) Invalid or missing username in DATABASE_URL

      iex> parse_postgresql_uri("postgresql://:@localhost")
      ** (RuntimeError) Invalid or missing username in DATABASE_URL

      iex> parse_postgresql_uri("postgresql://:password@localhost")
      ** (RuntimeError) Invalid or missing username in DATABASE_URL

      iex> parse_postgresql_uri("postgresql://user:password")
      ** (RuntimeError) Invalid or missing username in DATABASE_URL

      iex> parse_postgresql_uri("postgresql://user:password@")
      ** (RuntimeError) Missing host in DATABASE_URL

      iex> parse_postgresql_uri("postgresql://user@localhost:5433/mydb?options=-c%20synchronous_commit%3Doff")
      ** (RuntimeError) Electric does not support any query options in DATABASE_URL.

      iex> parse_postgresql_uri("postgresql://electric@localhost/db?replication=database")
      ** (RuntimeError) Electric does not support the "replication" option. It opens both a replication connection and regular connections to Postgres as needed.

      iex> parse_postgresql_uri("postgresql://electric@localhost/db?replication=off")
      ** (RuntimeError) Electric does not support the "replication" option. It opens both a replication connection and regular connections to Postgres as needed.

      iex> parse_postgresql_uri("postgres://super_user@localhost:7801/postgres?sslmode=yesplease")
      ** (RuntimeError) Electric does not support the "sslmode" option. Use the DATABASE_REQUIRE_SSL configuration option instead.
  """
  @spec parse_postgresql_uri(binary) :: {:ok, keyword}
  def parse_postgresql_uri(uri_str) do
    %URI{scheme: scheme, host: host, port: port, path: path, userinfo: userinfo, query: query} =
      URI.parse(uri_str)

    :ok = assert_valid_scheme!(scheme)

    :ok = assert_valid_host!(host)
    port = port || 5432

    {username, password} = parse_userinfo!(userinfo)

    database = parse_database(path, username)

    query_params =
      if query do
        URI.decode_query(query)
      else
        %{}
      end

    :ok = assert_no_query_params(query_params)

    {:ok,
     [
       host: host,
       port: port,
       database: database,
       username: username,
       password: password
     ]
     |> Enum.reject(fn {_key, val} -> is_nil(val) end)}
  end

  defp assert_no_query_params(params) when map_size(params) == 0, do: :ok

  defp assert_no_query_params(%{"sslmode" => _}) do
    raise "Electric does not support the \"sslmode\" option. Use the DATABASE_REQUIRE_SSL configuration option instead."
  end

  defp assert_no_query_params(%{"replication" => _}) do
    raise "Electric does not support the \"replication\" option. It opens both a replication connection and regular connections to Postgres as needed."
  end

  defp assert_no_query_params(_) do
    raise "Electric does not support any query options in DATABASE_URL."
  end

  defp assert_valid_scheme!(scheme) when scheme in ["postgres", "postgresql"], do: :ok

  defp assert_valid_scheme!(scheme) do
    raise "Invalid scheme in DATABASE_URL: #{inspect(scheme)}"
  end

  defp assert_valid_host!(str) do
    if is_binary(str) and String.trim(str) != "" do
      :ok
    else
      raise "Missing host in DATABASE_URL"
    end
  end

  defp parse_userinfo!(str) do
    try do
      true = is_binary(str)

      {username, password} =
        case String.split(str, ":") do
          [username] -> {username, nil}
          [username, password] -> {username, password}
        end

      false = String.trim(username) == ""

      {username, password}
    rescue
      _ -> raise "Invalid or missing username in DATABASE_URL"
    end
  end

  defp parse_database(nil, username), do: username
  defp parse_database("/", username), do: username
  defp parse_database("/" <> dbname, _username), do: dbname
end
