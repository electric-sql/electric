defmodule Electric.Replication.Postgres.Client do
  @moduledoc """
  Postgres database replication client.

  Uses `:epgsql` for it's `start_replication` function. Note that epgsql
  doesn't support connecting via a unix socket.
  """

  import Electric.Postgres.Dialect.Postgresql, only: [escape_quotes: 2, quote_ident: 1]

  alias Electric.Postgres.Extension
  alias Electric.Postgres.Lsn
  alias Electric.Replication.Connectors
  alias Electric.Telemetry.OpenTelemetry

  require Logger

  @type connection :: pid
  @type publication :: String.t()

  @spec connect(Connectors.connection_opts()) ::
          {:ok, connection :: pid()} | {:error, reason :: :epgsql.connect_error()}
  def connect(conn_opts) do
    Logger.debug("Postgres.Client.connect(#{inspect(sanitize_conn_opts(conn_opts))})")

    {%{ip_addr: ip_addr}, %{username: username, password: password} = epgsql_conn_opts} =
      Connectors.pop_extraneous_conn_opts(conn_opts)

    with {:ok, conn} <- :epgsql.connect(ip_addr, username, password, epgsql_conn_opts),
         :ok <- set_display_settings(conn) do
      {:ok, conn}
    end
  end

  @spec with_conn(Connectors.connection_opts(), fun()) :: term() | {:error, term()}
  def with_conn(conn_opts, fun) do
    # Best effort capture exit message, expect trap_exit to be set
    wait_exit = fn conn, res ->
      OpenTelemetry.with_span("epgsql.await_exit", [], fn ->
        receive do
          {:EXIT, ^conn, _} -> res
        after
          500 -> res
        end
      end)
    end

    Logger.info("Postgres.Client.with_conn(#{inspect(sanitize_conn_opts(conn_opts))})")

    {:ok, conn} = :epgsql_sock.start_link()

    {%{ip_addr: ip_addr}, %{username: username, password: password} = epgsql_conn_opts} =
      Connectors.pop_extraneous_conn_opts(conn_opts)

    with {:ok, ^conn} <- :epgsql.connect(conn, ip_addr, username, password, epgsql_conn_opts),
         :ok <- set_display_settings(conn) do
      try do
        OpenTelemetry.with_span("epgsql.with_conn", [], fn ->
          fun.(conn)
        end)
      rescue
        e ->
          Logger.error(Exception.format(:error, e, __STACKTRACE__))
          {:error, e}
      after
        close(conn)
        wait_exit.(conn, :ok)
      end
    else
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
  def with_transaction_mode(mode, conn, fun, in_opts \\ [])
      when is_binary(mode) and is_pid(conn) and is_list(in_opts) do
    opts = Keyword.merge([reraise: true, begin_opts: mode], in_opts)
    fun = fn -> :epgsql.with_transaction(conn, fun, opts) end

    if Keyword.get(in_opts, :telemetry, true) do
      OpenTelemetry.with_span("epgsql.with_transaction", %{"txn.mode" => mode}, fun)
    else
      fun.()
    end
  end

  def with_transaction(conn, fun, opts \\ []) when is_pid(conn) and is_list(opts) do
    with_transaction_mode("", conn, fun, opts)
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

  def squery(conn, query) do
    OpenTelemetry.with_span("epgsql.squery", %{"db.statement" => query}, fn ->
      :epgsql.squery(conn, query)
    end)
  end

  @spec get_system_id(connection()) :: {:ok, binary}
  def get_system_id(conn) do
    {:ok, _, [{system_id, _, _, _}]} = squery(conn, "IDENTIFY_SYSTEM")
    {:ok, system_id}
  end

  @doc """
  Create the main replication slot to maintain a resumable window of WAL records in Postgres.

  This slot should be used as a source for pg_copy_logical_replication() to create a new,
  temporary replication slot for the replication connection.

  Note that unless manually moved forward with pg_replication_slot_advance(), it will prevent
  Postgres from discarding old WAL records, leading to unbounded disk usage growth.
  """
  @spec create_main_slot(connection(), String.t()) :: {:ok, String.t()}
  def create_main_slot(conn, slot_name) do
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

  def create_publication(conn, name, []) do
    create_publication(conn, name, "")
  end

  def create_publication(conn, name, tables) when is_list(tables) do
    table_list =
      tables
      |> Enum.map(&quote_ident/1)
      |> Enum.join(", ")

    create_publication(conn, name, "FOR TABLE #{table_list}")
  end

  def create_publication(conn, name, table_spec) when is_binary(table_spec) do
    case squery(conn, ~s|CREATE PUBLICATION "#{name}" #{table_spec}|) do
      {:ok, _, _} -> {:ok, name}
      # TODO: Verify that the publication has the correct tables
      {:error, {_, _, _, :duplicate_object, _, _}} -> {:ok, name}
    end
  end

  @doc """
  Create a temporary slot as a copy of the main one.

  Its lsn matches that of the main slot at the time of the copy. This temporary slot should be
  used for starting a new replication connection, at which point a later lsn can be specified
  as a starting point for the replication stream.

  Postgres will automatically delete the temporary slot when the connection that created it closes.
  """
  @spec create_temporary_slot(connection(), String.t(), String.t()) ::
          {:ok, String.t(), Lsn.t()} | {:error, term}
  def create_temporary_slot(conn, source_slot_name, tmp_slot_name) do
    sql =
      "SELECT * FROM pg_copy_logical_replication_slot('#{source_slot_name}', '#{tmp_slot_name}', true)"

    with {:ok, _, [{^tmp_slot_name, lsn_str}]} <- squery(conn, sql) do
      {:ok, tmp_slot_name, Lsn.from_string(lsn_str)}
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
  Start consuming the logical replication stream using given `publication` and `slot`.

  The handler can be a pid or a module implementing epgsql's `handle_x_log_data` callback.
  """
  @spec start_replication(connection, String.t(), String.t(), Lsn.t(), module | pid) ::
          :ok | {:error, term}
  def start_replication(conn, publication, slot, lsn, handler) do
    Logger.debug(
      "#{__MODULE__} start_replication: slot: '#{slot}', publication: '#{publication}'"
    )

    slot = to_charlist(slot)
    lsn = to_charlist(lsn)
    opts = ~c"proto_version '1', publication_names '#{publication}', messages"
    :epgsql.start_replication(conn, slot, handler, [], lsn, opts)
  end

  # Explicitly set those configuration parameters that affect formatting of values of certain types.
  #
  # See `Electric.Postgres.display_settings/0` for details.
  defp set_display_settings(conn) do
    results = squery(conn, Electric.Postgres.display_settings() |> Enum.join(";"))
    Enum.find(results, :ok, &(not match?({:ok, [], []}, &1)))
  end

  @doc """
  Confirm successful processing of a WAL segment.

  Returns `:ok` on success.
  """
  def acknowledge_lsn(conn, lsn) do
    wal_offset = Lsn.to_integer(lsn)
    :epgsql.standby_status_update(conn, wal_offset, wal_offset)
  end

  @doc """
  Fetch the current lsn from Postgres.
  """
  @spec current_lsn(connection) :: {:ok, Lsn.t()} | {:error, term}
  def current_lsn(conn) do
    with {:ok, _, [{lsn_str}]} <- squery(conn, "SELECT pg_current_wal_lsn()") do
      {:ok, Lsn.from_string(lsn_str)}
    end
  end

  @doc """
  Advance the earliest accessible lsn of the given slot to `to_lsn`.

  After a slot is advanced there is no way for it to be rewound back to an earlier lsn.
  """
  @spec advance_replication_slot(connection, String.t(), Lsn.t()) :: :ok | {:error, term}
  def advance_replication_slot(conn, slot_name, to_lsn) do
    with {:ok, _, _} <-
           squery(conn, "SELECT pg_replication_slot_advance('#{slot_name}', '#{to_lsn}')") do
      :ok
    end
  end

  @type logical_message_option :: {:transactional?, boolean} | {:prefix, String.t()}
  @doc """
  Emit a logical message to be consumed by LogicalReplicationProducer.
  """
  @spec emit_logical_message(connection, String.t(), [logical_message_option()]) ::
          :ok | {:error, term}
  def emit_logical_message(conn, message, opts \\ []) do
    transactional? = Keyword.get(opts, :transactional?, false)
    prefix = Keyword.get(opts, :prefix, "") |> escape_quotes(?')
    message = escape_quotes(message, ?')

    with {:ok, _, _} <-
           squery(
             conn,
             "SELECT pg_logical_emit_message(#{transactional?}, '#{prefix}', '#{message}')"
           ) do
      :ok
    end
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
    with {:ok, _, [{short}]} <- squery(conn, "SHOW SERVER_VERSION"),
         {:ok, _, [{long}]} <- squery(conn, "SELECT VERSION()"),
         {:ok, _, _, [{cluster_id}]} <- Extension.save_and_get_cluster_id(conn) do
      {:ok, {short, long, cluster_id}}
    end
  end
end
