defmodule Electric.Replication.Postgres.Client do
  @moduledoc """
  Postgres database replication client.

  Uses `:epgsql` for it's `start_replication` function. Note that epgsql
  doesn't support connecting via a unix socket.
  """
  require Logger

  alias Electric.Postgres.OidDatabase

  @type column :: %{
          name: String.t(),
          type: atom(),
          type_modifier: integer(),
          part_of_identity?: boolean() | nil
        }
  @type replicated_table :: %{
          schema: String.t(),
          name: String.t(),
          oid: integer(),
          replica_identity: :all_columns | :default | :nothing | :index,
          columns: [column()]
        }
  @type replicated_tables :: [replicated_table()]
  @type replication_info :: %{
          tables: replicated_tables(),
          database: String.t(),
          publication: String.t(),
          connection: term()
        }

  @type connection :: pid
  @type publication :: String.t()

  @doc """
  Connect to a postgres instance
  """
  @callback connect(connection_config :: :epgsql.connect_opts()) ::
              {:ok, term()} | {:error, term()}

  @doc """
  Start replication and send logical replication messages back to pid
  """
  @callback start_replication(
              conn :: term(),
              publication :: String.t(),
              slot :: String.t(),
              handler :: pid()
            ) :: :ok | {:error, term()}
  @doc """
  Query the Postgres instance for table names which fall under the replication

  Returns a list of tuples with schema and table name
  """
  @callback query_replicated_tables(connection :: term(), publication :: nil | String.t()) ::
              replicated_tables()

  @doc """
  Acknowledge that the LSN has been processed
  """
  @callback acknowledge_lsn(connection :: term(), lsn :: %{segment: integer(), offset: integer()}) ::
              :ok

  @spec connect(:epgsql.connect_opts()) ::
          {:ok, connection :: pid()} | {:error, reason :: :epgsql.connect_error()}
  def connect(%{} = config) do
    :epgsql.connect(config)
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

    case :epgsql.connect(conn, host, username, password, config) do
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

  def close(conn) do
    :epgsql.close(conn)
  end

  @tables_query """
  SELECT DISTINCT ON (t.schemaname, t.tablename)
    t.schemaname, t.tablename, c.oid, c.relreplident
  FROM pg_catalog.pg_publication_tables t
    JOIN pg_catalog.pg_namespace ns on t.schemaname = ns.nspname
    JOIN pg_catalog.pg_class c on (c.relname = t.tablename and c.relnamespace = ns.oid)
  WHERE t.pubname IN ('$1')
  """

  @columns_query """
  SELECT a.attrelid, a.attname, a.atttypid, a.atttypmod, a.attnum = ANY(i.indkey)
  FROM pg_catalog.pg_attribute a
    LEFT JOIN pg_catalog.pg_index i ON (i.indexrelid = pg_get_replica_identity_index(a.attrelid))
  WHERE
    a.attnum > 0::pg_catalog.int2
    AND NOT a.attisdropped
    AND a.attgenerated = ''
    AND a.attrelid = ANY('{$1}')
    ORDER BY attrelid, a.attnum;
  """

  @primary_keys_query """
  SELECT i.indrelid, a.attname
  FROM   pg_index i
  JOIN   pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
  WHERE  i.indrelid = ANY('{$1}')
  AND    i.indisprimary
  """

  @migrations_query """
  SELECT version, hash, applied_at FROM electric.migrations ORDER BY applied_at DESC;
  """

  @spec query_replicated_tables(connection, publication | nil) ::
          [Electric.Postgres.SchemaRegistry.replicated_table()]
  def query_replicated_tables(conn, publication \\ nil)

  def query_replicated_tables(conn, nil) do
    Application.fetch_env!(:electric, __MODULE__)
    |> Keyword.fetch!(:replication)
    |> Keyword.fetch!(:publication)
    |> then(&query_replicated_tables(conn, &1))
  end

  def query_replicated_tables(conn, publication) when is_binary(publication) do
    {:ok, _, table_data} =
      @tables_query
      |> String.replace("$1", publication)
      |> then(&:epgsql.squery(conn, &1))

    tables =
      table_data
      |> Enum.map(&build_table_representation/1)
      |> Map.new(&{&1.oid, &1})

    {:ok, _, columns_data} =
      @columns_query
      |> String.replace("$1", Enum.map_join(Map.keys(tables), ",", &to_string/1))
      |> then(&:epgsql.squery(conn, &1))

    {:ok, _, pks_data} =
      @primary_keys_query
      |> String.replace("$1", Enum.map_join(Map.keys(tables), ",", &to_string/1))
      |> then(&:epgsql.squery(conn, &1))

    pks = Enum.group_by(pks_data, &String.to_integer(elem(&1, 0)), &elem(&1, 1))

    columns_data
    |> Enum.group_by(&String.to_integer(elem(&1, 0)), &build_column_representation/1)
    # We start our fake OIDs from 20000 to avoid any conflicts with reserved type oids (although unlikely anyhow)
    |> Enum.with_index(20000)
    |> Enum.map(fn {{table_oid, columns}, incremental_oid} ->
      table_pks = Map.fetch!(pks, table_oid)

      tables
      |> Map.fetch!(table_oid)
      |> Map.put(:columns, columns)
      |> Map.put(:primary_keys, table_pks)
      # We replace original OIDs with the fake ones since this schema is essentially shared between all PGs
      # all of which have their own OIDs for the same tables. To avoid any unintentional usage, we replace
      # them with new "generic" ones.
      |> Map.put(:oid, incremental_oid)
    end)
  end

  @spec query_migration_table(connection) :: [Electric.Postgres.SchemaRegistry.migration_table()]
  def query_migration_table(conn) do
    {:ok, _, table_data} = :epgsql.squery(conn, @migrations_query)

    Enum.map(table_data, fn {vsn, hash, applied_at} ->
      {:ok, datetime, _} = DateTime.from_iso8601(applied_at)
      %{vsn: vsn, hash: hash, applied_at: datetime}
    end)
  end

  def start_subscription(conn, name) do
    with {:ok, _, _} <- :epgsql.squery(conn, ~s|ALTER SUBSCRIPTION "#{name}" ENABLE|),
         {:ok, _, _} <-
           :epgsql.squery(
             conn,
             ~s|ALTER SUBSCRIPTION "#{name}" REFRESH PUBLICATION WITH (copy_data = false)|
           ) do
      :ok
    end
  end

  @spec stop_subscription(connection, String.t()) :: :ok
  def stop_subscription(conn, name) do
    with {:ok, _, _} <- :epgsql.squery(conn, ~s|ALTER SUBSCRIPTION "#{name}"
            DISABLE|) do
      :ok
    end
  end

  @spec create_publication(connection(), publication(), :all | binary | [binary]) ::
          {:ok, String.t()}
  def create_publication(conn, name, :all) do
    # :epgsql.squery(conn, "CREATE PUBLICATION #{name} FOR ALL TABLES")
    create_publication(conn, name, "ALL TABLES")
  end

  def create_publication(conn, name, tables) when is_list(tables) do
    # :epgsql.squery(conn, "CREATE PUBLICATION #{name} FOR TABLE t1, t2")
    table_list =
      tables
      |> Enum.map(&~s|"#{&1}"|)
      |> Enum.join(", ")

    create_publication(conn, name, "TABLE #{table_list}")
  end

  def create_publication(conn, name, table_spec) when is_binary(table_spec) do
    case :epgsql.squery(conn, ~s|CREATE PUBLICATION "#{name}" FOR #{table_spec}|) do
      {:ok, _, _} -> {:ok, name}
      # TODO: Verify that the publication has the correct tables
      {:error, {_, _, _, :duplicate_object, _, _}} -> {:ok, name}
    end
  end

  @spec get_system_id(connection()) :: {:ok, binary}
  def get_system_id(conn) do
    {:ok, _, [{system_id, _, _, _}]} = :epgsql.squery(conn, "IDENTIFY_SYSTEM")
    {:ok, system_id}
  end

  @spec create_slot(connection(), String.t()) :: {:ok, String.t()}
  def create_slot(conn, slot_name) do
    case :epgsql.squery(
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

    case :epgsql.squery(
           conn,
           ~s|CREATE SUBSCRIPTION "#{name}" CONNECTION '#{connection_string}' PUBLICATION "#{publication_name}" WITH (connect = false)|
         ) do
      {:ok, _, _} -> {:ok, name}
      # TODO: Verify that the subscription references the correct publication
      {:error, {_, _, _, :duplicate_object, _, _}} -> {:ok, name}
    end
  end

  defp build_table_representation({schema, table, oid, identity}) do
    %{
      schema: schema,
      name: table,
      oid: String.to_integer(oid),
      replica_identity: identity_to_atom(identity),
      columns: []
    }
  end

  defp build_column_representation({_, name, oid, modifier, part_of_identity}) do
    part_of_identity? =
      case part_of_identity do
        "t" -> true
        "f" -> false
        :null -> nil
      end

    %{
      name: name,
      type: OidDatabase.name_for_oid(String.to_integer(oid)),
      type_modifier: String.to_integer(modifier),
      part_of_identity?: part_of_identity?
    }
  end

  defp identity_to_atom("f"), do: :all_columns
  defp identity_to_atom("d"), do: :default
  defp identity_to_atom("n"), do: :nothing
  defp identity_to_atom("i"), do: :index

  @doc """
  Start consuming logical replication feed using a given `publication` and `slot`.

  The handler can be a pid or a module implementing the `handle_x_log_data` callback.

  Returns `:ok` on success.
  """
  def start_replication(conn, publication, slot, handler) do
    opts = 'proto_version \'1\', publication_names \'#{publication}\''

    conn
    |> :epgsql.start_replication(:erlang.binary_to_list(slot), handler, [], '0/0', opts)
  end

  @doc """
  Confirm successful processing of a WAL segment.

  Returns `:ok` on success.
  """
  def acknowledge_lsn(conn, %{segment: segment, offset: offset}) do
    <<decimal_lsn::integer-64>> = <<segment::integer-32, offset::integer-32>>

    :epgsql.standby_status_update(conn, decimal_lsn, decimal_lsn)
  end
end
