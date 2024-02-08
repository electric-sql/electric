defmodule Electric.Replication.Postgres.Client do
  @moduledoc """
  Postgres database replication client.

  Uses `:epgsql` for it's `start_replication` function. Note that epgsql
  doesn't support connecting via a unix socket.
  """
  alias Electric.Postgres.Extension
  alias Electric.Replication.Connectors

  require Logger

  @type connection :: pid
  @type publication :: String.t()

  @spec connect(Connectors.connection_opts()) ::
          {:ok, connection :: pid()} | {:error, reason :: :epgsql.connect_error()}
  def connect(conn_opts) do
    {%{ip_addr: ip_addr}, %{username: username, password: password} = epgsql_conn_opts} =
      Connectors.pop_extraneous_conn_opts(conn_opts)

    :epgsql.connect(ip_addr, username, password, epgsql_conn_opts)
  end

  @spec with_conn(Connectors.connection_opts(), fun()) :: term() | {:error, term()}
  def with_conn(conn_opts, fun) do
    # Best effort capture exit message, expect trap_exit to be set
    wait_exit = fn conn, res ->
      receive do
        {:EXIT, ^conn, _} -> res
      after
        500 -> res
      end
    end

    Logger.info("#{inspect(__MODULE__)}.with_conn(#{inspect(sanitize_conn_opts(conn_opts))})")

    {:ok, conn} = :epgsql_sock.start_link()

    {%{ip_addr: ip_addr}, %{username: username, password: password} = epgsql_conn_opts} =
      Connectors.pop_extraneous_conn_opts(conn_opts)

    case :epgsql.connect(conn, ip_addr, username, password, epgsql_conn_opts) do
      {:ok, ^conn} ->
        try do
          fun.(conn)
        rescue
          e ->
            Logger.error(Exception.format(:error, e, __STACKTRACE__))
            {:error, e}
        after
          close(conn)
          wait_exit.(conn, :ok)
        end

      error ->
        close(conn)
        wait_exit.(conn, error)
    end
  end

  @doc """
  Format the connection opts for output, hiding the password, etc.
  """
  def sanitize_conn_opts(conn_opts) do
    conn_opts
    |> Map.put(:password, ~c"******")
    |> Map.update!(:ip_addr, &:inet.ntoa/1)
    |> truncate_cacerts()
  end

  defp truncate_cacerts(%{ssl_opts: ssl_opts} = conn_opts) do
    ssl_opts =
      case ssl_opts[:cacerts] do
        nil -> ssl_opts
        list -> Keyword.put(ssl_opts, :cacerts, "[...](#{length(list)})")
      end

    %{conn_opts | ssl_opts: ssl_opts}
  end

  defp truncate_cacerts(conn_opts), do: conn_opts

  @doc """
  Wrapper for :epgsql.with_transaction/3 that always sets `reraise` to `true` by default and makes `begin_opts` a
  standalone function argument for easier code reading.
  """
  def with_transaction(mode \\ "", conn, fun, in_opts \\ [])
      when is_binary(mode) and is_list(in_opts) do
    opts = Keyword.merge([reraise: true, begin_opts: mode], in_opts)
    :epgsql.with_transaction(conn, fun, opts)
  end

  def close(conn) do
    :epgsql.close(conn)
  end

  @types_query """
    SELECT
      nspname,
      typname,
      t.oid,
      typarray,
      typelem,
      typlen,
      typtype::text
    FROM
      pg_type t
    JOIN
      pg_namespace ON pg_namespace.oid = typnamespace
    WHERE
      typtype = ANY($1::char[])
      AND nspname IN ('pg_catalog', 'electric', 'public')
    ORDER BY
      t.oid
  """

  def query_oids(conn, kinds \\ [:BASE, :DOMAIN, :ENUM]) do
    typtypes = Enum.map(kinds, &Electric.Postgres.OidDatabase.PgType.encode_kind/1)
    {:ok, _, type_data} = :epgsql.equery(conn, @types_query, [typtypes])
    {:ok, type_data}
  end

  def start_subscription(conn, name) do
    with {:ok, _, _} <- squery(conn, ~s|ALTER SUBSCRIPTION "#{name}" ENABLE|),
         {:ok, _, _} <-
           squery(
             conn,
             ~s|ALTER SUBSCRIPTION "#{name}" REFRESH PUBLICATION WITH (copy_data = false)|
           ) do
      :ok
    end
  end

  @spec stop_subscription(connection, String.t()) :: :ok
  def stop_subscription(conn, name) do
    with {:ok, _, _} <- squery(conn, ~s|ALTER SUBSCRIPTION "#{name}" DISABLE|) do
      :ok
    end
  end

  defp squery(conn, query) do
    Logger.debug("#{__MODULE__}: #{query}")
    :epgsql.squery(conn, query)
  end

  @spec get_system_id(connection()) :: {:ok, binary}
  def get_system_id(conn) do
    {:ok, _, [{system_id, _, _, _}]} = squery(conn, "IDENTIFY_SYSTEM")
    {:ok, system_id}
  end

  @spec create_slot(connection(), String.t()) :: {:ok, String.t()}
  def create_slot(conn, slot_name) do
    case squery(
           conn,
           ~s|CREATE_REPLICATION_SLOT "#{slot_name}" LOGICAL pgoutput NOEXPORT_SNAPSHOT|
         ) do
      {:ok, _, _} ->
        {:ok, slot_name}

      # TODO: Verify that the subscription references the correct publication
      {:error, {:error, :error, _pg_error_code, :duplicate_object, _, _}} ->
        {:ok, slot_name}

      {:error,
       {:error, :error, "55000", :object_not_in_prerequisite_state,
        "logical decoding requires wal_level >= logical", _c_stacktrace}} ->
        {:error, :wal_level_not_logical}

      {:error,
       {:error, :error, "42601", :syntax_error,
        "syntax error at or near \"CREATE_REPLICATION_SLOT\"" = msg, _c_stacktrace}} ->
        {:error, {:create_replication_slot_syntax_error, msg}}
    end
  end

  def create_subscription(conn, name, publication_name, connection_params) do
    connection_string = Enum.map_join(connection_params, " ", fn {k, v} -> "#{k}=#{v}" end)

    case squery(
           conn,
           ~s|CREATE SUBSCRIPTION "#{name}" CONNECTION '#{connection_string}' PUBLICATION "#{publication_name}" WITH (connect = false)|
         ) do
      {:ok, _, _} -> {:ok, name}
      # TODO: Verify that the subscription references the correct publication
      {:error, {_, _, _, :duplicate_object, _, _}} -> {:ok, name}
    end
  end

  @doc """
  Start consuming logical replication feed using a given `publication` and `slot`.

  The handler can be a pid or a module implementing the `handle_x_log_data` callback.

  Returns `:ok` on success.
  """
  def start_replication(conn, publication, slot, handler) do
    Logger.debug(
      "#{__MODULE__} start_replication: slot: '#{slot}', publication: '#{publication}'"
    )

    slot = String.to_charlist(slot)
    opts = ~c"proto_version '1', publication_names '#{publication}', messages"
    :epgsql.start_replication(conn, slot, handler, [], ~c"0/0", opts)
  end

  @doc """
  Explicitly set those configuration parameters that affect formatting of values of certain types.

  By setting those parameters for the current session we're safe-guarding against non-standard configuration being used
  in the Postgres database cluster or even the specific database Electric is configured to replicate from.

  The parameters we're interested in are:

    * `bytea_output` - determines how Postgres encodes bytea values. It can use either Hex- or Escape-based encoding.
    * `DateStyle` - determines how Postgres interprets date values.
    * `TimeZone` - affects the time zone offset Postgres uses for timestamptz and timetz values.
    * `extra_float_digits` - determines whether floating-point values are rounded or are encoded precisely.
  """
  def set_display_settings_for_replication(conn) do
    results =
      :epgsql.squery(
        conn,
        """
        SET bytea_output = 'hex';
        SET DateStyle = 'ISO, DMY';
        SET TimeZone = 'UTC';
        SET extra_float_digits = 1;
        """
      )

    :ok = Enum.each(results, &({:ok, [], []} = &1))
  end

  @doc """
  Confirm successful processing of a WAL segment.

  Returns `:ok` on success.
  """
  def acknowledge_lsn(conn, %{segment: segment, offset: offset}) do
    <<decimal_lsn::integer-64>> = <<segment::integer-32, offset::integer-32>>

    :epgsql.standby_status_update(conn, decimal_lsn, decimal_lsn)
  end

  @relkind %{table: ["r"], index: ["i"], view: ["v", "m"]}

  @pg_class_query """
  SELECT c.oid
  FROM pg_class c
    INNER JOIN pg_namespace n ON c.relnamespace = n.oid
  WHERE
      n.nspname = $1
      AND c.relname = $2
      AND c.relkind = ANY($3::char[])
  LIMIT 1;
  """

  @doc """
  Retrieve the db assigned oid of the given table, index, view or trigger.
  """
  @spec relation_oid(connection(), :table | :index | :view | :trigger, String.t(), String.t()) ::
          {:ok, integer()} | {:error, term()}
  def relation_oid(conn, rel_type, schema, table) do
    with {:ok, relkind} <- Map.fetch(@relkind, rel_type),
         {:ok, _, [{oid}]} <- :epgsql.equery(conn, @pg_class_query, [schema, table, relkind]) do
      {:ok, String.to_integer(oid)}
    else
      error ->
        Logger.warning(
          "Unable to retrieve oid for #{inspect([rel_type, schema, table])}: #{inspect(error)}"
        )

        {:error, {:relation_missing, rel_type, schema, table}}
    end
  end

  @doc """
  Retrieve PostgreSQL server version, long and short form
  """
  @spec get_server_versions(connection()) ::
          {:ok, {short :: String.t(), long :: String.t(), cluster_id :: String.t()}}
          | {:error, term()}
  def get_server_versions(conn) do
    with {:ok, _, [{short}]} <- :epgsql.squery(conn, "SHOW SERVER_VERSION"),
         {:ok, _, [{long}]} <- :epgsql.squery(conn, "SELECT VERSION()"),
         {:ok, _, _, [{cluster_id}]} <- Extension.save_and_get_cluster_id(conn) do
      {:ok, {short, long, cluster_id}}
    end
  end
end
