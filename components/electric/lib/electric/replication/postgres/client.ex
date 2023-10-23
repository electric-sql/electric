defmodule Electric.Replication.Postgres.Client do
  @moduledoc """
  Postgres database replication client.

  Uses `:epgsql` for it's `start_replication` function. Note that epgsql
  doesn't support connecting via a unix socket.
  """
  alias Electric.Postgres.Extension
  require Logger

  @type connection :: pid
  @type publication :: String.t()

  @spec connect(:epgsql.connect_opts()) ::
          {:ok, connection :: pid()} | {:error, reason :: :epgsql.connect_error()}
  def connect(%{} = config) do
    config
    |> Electric.Utils.epgsql_config()
    |> :epgsql.connect()
  end

  @spec with_conn(:epgsql.connect_opts(), fun()) :: term() | {:error, term()}
  def with_conn(%{host: host, username: username, password: password} = config, fun) do
    # Best effort capture exit message, expect trap_exit to be set
    wait_exit = fn conn, res ->
      receive do
        {:EXIT, ^conn, _} -> res
      after
        500 -> res
      end
    end

    Logger.info("connect: #{inspect(Map.drop(config, [:password]))}")

    {:ok, conn} = :epgsql_sock.start_link()

    case :epgsql.connect(conn, host, username, password, Electric.Utils.epgsql_config(config)) do
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
  SELECT nspname, typname, pg_type.oid, typarray, typelem, typlen, typtype, typbasetype, typrelid, EXISTS(SELECT 1 FROM pg_type as t WHERE pg_type.oid = t.typarray) as is_array
  FROM pg_type
  JOIN pg_namespace ON typnamespace = pg_namespace.oid
  WHERE typtype != 'c'
  ORDER BY oid
  """

  def query_oids(conn) do
    {:ok, _, type_data} = squery(conn, @types_query)
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
    with {:ok, _, _} <- squery(conn, ~s|ALTER SUBSCRIPTION "#{name}"
            DISABLE|) do
      :ok
    end
  end

  @spec create_publication(connection(), publication(), :all | binary | [binary]) ::
          {:ok, String.t()}
  def create_publication(conn, name, :all) do
    # squery(conn, "CREATE PUBLICATION #{name} FOR ALL TABLES")
    create_publication(conn, name, "ALL TABLES")
  end

  def create_publication(conn, name, tables) when is_list(tables) do
    # squery(conn, "CREATE PUBLICATION #{name} FOR TABLE t1, t2")
    table_list =
      tables
      |> Enum.map(&~s|"#{&1}"|)
      |> Enum.join(", ")

    create_publication(conn, name, "TABLE #{table_list}")
  end

  def create_publication(conn, name, table_spec) when is_binary(table_spec) do
    case squery(conn, ~s|CREATE PUBLICATION "#{name}" FOR #{table_spec}|) do
      {:ok, _, _} -> {:ok, name}
      # TODO: Verify that the publication has the correct tables
      {:error, {_, _, _, :duplicate_object, _, _}} -> {:ok, name}
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
      {:ok, _, _} -> {:ok, slot_name}
      # TODO: Verify that the subscription references the correct publication
      {:error, {_, _, _, :duplicate_object, _, _}} -> {:ok, slot_name}
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

    opts = ~c"proto_version '1', publication_names '#{publication}', messages"

    conn
    |> :epgsql.start_replication(:erlang.binary_to_list(slot), handler, [], ~c"0/0", opts)
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
