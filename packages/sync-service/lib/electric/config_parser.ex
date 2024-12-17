defmodule Electric.ConfigParser do
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
