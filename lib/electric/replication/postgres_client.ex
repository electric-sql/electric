defmodule Electric.Replication.PostgresClient do
  @moduledoc """
  Postgres database replication client.

  Uses `:epgsql` for it's `start_replication` function. Note that epgsql
  doesn't support connecting via a unix socket.
  """

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

  @doc """
  Invoke to connect to a Postgres instance and start logical replication

  On success returns the established connection, so that it can be used to acknowledge LSNs
  """
  @callback connect_and_start_replication(handler_process :: pid()) ::
              {:ok, replication_info()}
              | {:error, :epgsql.connect_error() | :epgsql.query_error()}
  @callback connect_and_start_replication(handler_process :: pid(), config_overrides :: map()) ::
              {:ok, replication_info()}
              | {:error, :epgsql.connect_error() | :epgsql.query_error()}

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

  @spec connect_and_start_replication(pid(), keyword) ::
          {:ok, replication_info()} | {:error, :epgsql.connect_error() | :epgsql.query_error()}
  def connect_and_start_replication(handler, config_overrides \\ []) do
    config = Application.fetch_env!(:electric, __MODULE__)

    connection_config =
      config
      |> Keyword.get(:connection, [])
      |> Map.new()
      |> Map.merge(Map.new(Keyword.get(config_overrides, :connection, [])))

    %{slot: slot, publication: publication} =
      config
      |> Keyword.get(:replication, [])
      |> Map.new()
      |> Map.merge(Map.new(Keyword.get(config_overrides, :replication, [])))

    opts = 'proto_version \'1\', publication_names \'#{publication}\''

    with {:ok, conn} <- :epgsql.connect(connection_config),
         replicated_tables = query_replicated_tables(conn, publication),
         :ok <- :epgsql.start_replication(conn, slot, handler, [], '0/0', opts) do
      {:ok,
       %{
         tables: replicated_tables,
         database: connection_config.database,
         connection: conn,
         publication: publication
       }}
    end
  end

  def connect(%{} = config) do
    :epgsql.connect(config)
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

    columns_data
    |> Enum.group_by(&String.to_integer(elem(&1, 0)), &build_column_representation/1)
    # We start our fake OIDs from 20000 to avoid any conflicts with reserved type oids (although unlikely anyhow)
    |> Enum.with_index(20000)
    |> Enum.map(fn {{table_oid, columns}, incremental_oid} ->
      tables
      |> Map.fetch!(table_oid)
      |> Map.put(:columns, columns)
      # We replace original OIDs with the fake ones since this schema is essentially shared between all PGs
      # all of which have their own OIDs for the same tables. To avoid any unintentional usage, we replace
      # them with new "generic" ones.
      |> Map.put(:oid, incremental_oid)
    end)
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
    |> :epgsql.start_replication(slot, handler, [], '0/0', opts)
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
