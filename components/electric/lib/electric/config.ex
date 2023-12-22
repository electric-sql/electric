defmodule Electric.Config do
  @type maybe_string :: binary | nil

  @spec format_required_config_error(list) :: maybe_string
  def format_required_config_error(potential_errors) when is_list(potential_errors) do
    errors =
      for {varname, {:error, str}} <- potential_errors do
        "  * #{varname} " <> str
      end

    if errors != [] do
      Electric.Errors.format_error(
        :conf,
        """
        The following required configuration options have invalid or missing values:

        #{Enum.join(errors, "\n\n")}
        """,
        """
        Please review the official configuration reference at
        https://electric-sql.com/docs/api/service#configuration-options
        and double-check your values.
        """
      )
    end
  end

  @spec validate_auth_config(binary, keyword) ::
          {Electric.Satellite.Auth.provider() | nil, [{binary, {:error, binary}}]}
  def validate_auth_config(auth_mode, auth_opts) do
    auth_mode_opts = for {key, {_, val}} <- auth_opts, do: {key, val}

    case Electric.Satellite.Auth.build_provider(auth_mode, auth_mode_opts) do
      {:ok, provider} ->
        {provider, []}

      {:error, :invalid_auth_mode} ->
        error_str =
          "has invalid value: #{inspect(auth_mode)}. Must be one of [\"secure\", \"insecure\"]"

        {nil, [{"AUTH_MODE", {:error, error_str}}]}

      {:error, key, reason} ->
        {varname, _} = Keyword.fetch!(auth_opts, key)
        {nil, [{varname, {:error, reason}}]}
    end
  end

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
      {:error,
       "has invalid value: #{inspect(str)}. Must be one of #{inspect(~w[direct_writes logical_replication])}"}
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

  @log_levels ~w[emergency alert critical error warning warn notice info debug]
  @public_log_levels ~w[error warning info debug]

  @spec parse_log_level(binary) :: {:ok, Logger.level()} | {:error, binary}
  def parse_log_level(str) when str in @log_levels do
    {:ok, String.to_existing_atom(str)}
  end

  def parse_log_level(str) do
    {:error, "has invalid value: #{inspect(str)}. Must be one of #{inspect(@public_log_levels)}"}
  end

  @spec parse_pg_proxy_password(maybe_string) :: {:ok, maybe_string} | {:error, binary}
  def parse_pg_proxy_password(val) do
    if is_nil(val) or String.trim(val) == "" do
      {:error, "not set"}
    else
      {:ok, val}
    end
  end

  @spec parse_pg_proxy_port(maybe_string, pos_integer) ::
          {boolean, {:ok, pos_integer} | {:error, binary}}
  def parse_pg_proxy_port(nil, default_port), do: {false, {:ok, default_port}}

  def parse_pg_proxy_port(str, default_port) do
    case String.downcase(str) do
      "http" -> {true, {:ok, default_port}}
      "http:" <> port_str -> {true, parse_integer(port_str)}
      port_str -> {false, parse_integer(port_str)}
    end
  end

  defp parse_integer(str) do
    case Integer.parse(str) do
      {int, ""} when int > 0 -> {:ok, int}
      _ -> {:error, "has invalid value: #{inspect(str)}"}
    end
  end

  @doc """
  Parse a PostgreSQL URI into a keyword list.

  ## Examples

      iex> parse_postgresql_uri("postgresql://postgres:password@example.com/app-db")
      {:ok, [
        host: "example.com",
        port: 5432,
        database: "app-db",
        username: "postgres",
        password: "password",
      ]}

      iex> parse_postgresql_uri("postgresql://electric@192.168.111.33:81/__shadow")
      {:ok, [
        host: "192.168.111.33",
        port: 81,
        database: "__shadow",
        username: "electric"
      ]}

      iex> parse_postgresql_uri("postgresql://pg@[2001:db8::1234]:4321")
      {:ok, [
        host: "2001:db8::1234",
        port: 4321,
        database: "pg",
        username: "pg"
      ]}

      iex> parse_postgresql_uri("postgresql://user@localhost:5433/")
      {:ok, [
        host: "localhost",
        port: 5433,
        database: "user",
        username: "user"
      ]}

      iex> parse_postgresql_uri("postgresql://user%2Btesting%40gmail.com:weird%2Fpassword@localhost:5433/my%2Bdb%2Bname")
      {:ok, [
        host: "localhost",
        port: 5433,
        database: "my+db+name",
        username: "user+testing@gmail.com",
        password: "weird/password"
      ]}

      iex> parse_postgresql_uri("postgrex://localhost")
      {:error, "has invalid URL scheme: \\"postgrex\\""}

      iex> parse_postgresql_uri("postgresql://localhost")
      {:error, "has invalid or missing username"}

      iex> parse_postgresql_uri("postgresql://:@localhost")
      {:error, "has invalid or missing username"}

      iex> parse_postgresql_uri("postgresql://:password@localhost")
      {:error, "has invalid or missing username"}

      iex> parse_postgresql_uri("postgresql://user:password")
      {:error, "has invalid or missing username"}

      iex> parse_postgresql_uri("postgresql://user:password@")
      {:error, "missing host"}

      iex> parse_postgresql_uri("postgresql://user@localhost:5433/mydb?options=-c%20synchronous_commit%3Doff")
      {:error, "has unsupported query string. Please remove all URL query options"}

      iex> parse_postgresql_uri("postgresql://electric@localhost/db?replication=database")
      {:error, "has unsupported \\"replication\\" query option. Electric opens both a replication connection and regular connections to Postgres as needed"}

      iex> parse_postgresql_uri("postgresql://electric@localhost/db?replication=off")
      {:error, "has unsupported \\"replication\\" query option. Electric opens both a replication connection and regular connections to Postgres as needed"}

      iex> parse_postgresql_uri("postgres://super_user@localhost:7801/postgres?sslmode=yesplease")
      {:error, "has unsupported \\"sslmode\\" query option. Use the DATABASE_REQUIRE_SSL configuration option instead"}
  """
  @spec parse_postgresql_uri(binary) :: {:ok, keyword} | {:error, binary}
  def parse_postgresql_uri(uri_str) do
    %URI{scheme: scheme, host: host, port: port, path: path, userinfo: userinfo, query: query} =
      URI.parse(uri_str)

    with :ok <- validate_url_scheme(scheme),
         :ok <- validate_url_host(host),
         {:ok, {username, password}} <- parse_url_userinfo(userinfo),
         :ok <- validate_url_query(query) do
      conn_params =
        [
          host: host,
          port: port || 5432,
          database: parse_database(path, username) |> URI.decode(),
          username: URI.decode(username),
          password: if(password, do: URI.decode(password))
        ]
        |> Enum.reject(fn {_key, val} -> is_nil(val) end)

      {:ok, conn_params}
    end
  end

  defp validate_url_scheme(scheme) when scheme in ["postgres", "postgresql"], do: :ok
  defp validate_url_scheme(scheme), do: {:error, "has invalid URL scheme: #{inspect(scheme)}"}

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
      _ -> {:error, "has invalid or missing username"}
    end
  end

  defp split_userinfo(str) do
    case String.split(str, ":") do
      [username] -> {:ok, {username, nil}}
      [username, password] -> {:ok, {username, password}}
      _ -> :error
    end
  end

  defp validate_url_query(nil), do: :ok

  defp validate_url_query(query_str) do
    case URI.decode_query(query_str) do
      empty when map_size(empty) == 0 ->
        :ok

      %{"sslmode" => _} ->
        {:error,
         "has unsupported \"sslmode\" query option. Use the DATABASE_REQUIRE_SSL configuration option instead"}

      %{"replication" => _} ->
        {:error,
         "has unsupported \"replication\" query option. Electric opens both a replication connection and regular connections to Postgres as needed"}

      _ ->
        {:error, "has unsupported query string. Please remove all URL query options"}
    end
  end

  defp parse_database(nil, username), do: username
  defp parse_database("/", username), do: username
  defp parse_database("/" <> dbname, _username), do: dbname
end
