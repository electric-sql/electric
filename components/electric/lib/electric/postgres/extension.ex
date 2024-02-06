defmodule Electric.Postgres.Extension do
  @moduledoc """
  Manages our pseudo-extension code
  """

  alias Electric.Postgres.{Schema, Schema.Proto, Extension.Functions, Extension.Migration, Types}
  alias Electric.Replication.Postgres.Client
  alias Electric.Utils

  require Logger

  @type conn() :: :epgsql.connection()
  @type version() :: pos_integer()
  @type versions() :: [version()]

  defmodule Error do
    defexception [:message]
  end

  @schema "electric"

  @version_relation "migration_versions"
  @ddl_relation "ddl_commands"
  @schema_relation "schema"
  @electrified_table_relation "electrified"
  @acked_client_lsn_relation "acknowledged_client_lsns"

  @grants_relation "grants"
  @roles_relation "roles"
  @assignments_relation "assignments"

  electric = &to_string([?", @schema, ?", ?., ?", &1, ?"])

  @migration_table electric.("schema_migrations")
  @version_table electric.(@version_relation)
  @ddl_table electric.(@ddl_relation)
  @schema_table electric.("schema")
  @electrified_tracking_table electric.(@electrified_table_relation)
  @transaction_marker_table electric.("transaction_marker")
  @acked_client_lsn_table electric.(@acked_client_lsn_relation)

  @grants_table electric.(@grants_relation)
  @roles_table electric.(@roles_relation)
  @assignments_table electric.(@assignments_relation)

  @all_schema_query ~s(SELECT "schema", "version", "migration_ddl" FROM #{@schema_table} ORDER BY "version" ASC)
  @current_schema_query ~s(SELECT "schema", "version" FROM #{@schema_table} ORDER BY "id" DESC LIMIT 1)
  @schema_version_query ~s(SELECT "schema", "version" FROM #{@schema_table} WHERE "version" = $1 LIMIT 1)
  # FIXME: VAX-600 insert into schema ignoring conflicts (which I think arise from inter-pg replication, a problem
  # that will go away once we stop replicating all tables by default)
  @save_schema_query ~s[INSERT INTO #{@schema_table} ("version", "schema", "migration_ddl") VALUES ($1, $2, $3) ON CONFLICT ("id") DO NOTHING]
  @ddl_history_query "SELECT id, txid, txts, query FROM #{@ddl_table} ORDER BY id ASC;"

  @publication_name "electric_publication"
  @slot_name "electric_replication_out"
  @subscription_name "electric_replication_in"

  # https://www.postgresql.org/docs/current/functions-info.html#FUNCTIONS-PG-SNAPSHOT
  # pg_current_xact_id() -> xid8
  # The internal transaction ID type .. xid8 ... [id] a 64-bit type xid8 that
  # does not wrap around during the life of an installation
  @txid_type "xid8"
  # use an int8 for the txts timestamp column because epgsql has very poor
  # support for timestamp columns :(
  @txts_type "int8"

  defp migration_history_query(after_version) do
    where_clause =
      if after_version do
        "WHERE v.txid > (SELECT txid FROM #{@version_table} WHERE version = $1)"
      else
        # Dummy condition just to keep the $1 parameter in the query.
        "WHERE $1::text IS NULL"
      end

    """
    SELECT
      v.txid::xid8,
      v.txts::int8,
      v.version::text,
      v.inserted_at::timestamptz,
      s.schema::text,
      s.migration_ddl::text[]
    FROM
      #{@version_table} v
    JOIN
      #{@schema_table} s USING (version)
    #{where_clause}
    ORDER BY
      v.txid ASC
    """
  end

  def transaction_marker_update_equery do
    """
    UPDATE #{transaction_marker_table()}
    SET content = jsonb_build_object('xid', pg_current_xact_id(), 'caused_by', $1::text)
    WHERE id = 'magic write'
    """
  end

  def schema, do: @schema
  def ddl_table, do: @ddl_table
  def schema_table, do: @schema_table
  def version_table, do: @version_table
  def electrified_tracking_relation, do: @electrified_table_relation
  def electrified_tracking_table, do: @electrified_tracking_table
  def transaction_marker_table, do: @transaction_marker_table
  def acked_client_lsn_table, do: @acked_client_lsn_table

  def grants_table, do: @grants_table
  def roles_table, do: @roles_table
  def assignments_table, do: @assignments_table

  def ddl_relation, do: {@schema, @ddl_relation}
  def version_relation, do: {@schema, @version_relation}
  def schema_relation, do: {@schema, @schema_relation}
  def acked_client_lsn_relation, do: {@schema, @acked_client_lsn_relation}
  def publication_name, do: @publication_name
  def slot_name, do: @slot_name
  def subscription_name, do: @subscription_name

  defguard is_extension_relation(relation) when elem(relation, 0) == @schema

  defguard is_migration_relation(relation)
           when relation in [{@schema, @version_relation}, {@schema, @ddl_relation}]

  defguard is_ddl_relation(relation) when relation == {@schema, @ddl_relation}

  defguard is_acked_client_lsn_relation(relation)
           when relation == {@schema, @acked_client_lsn_relation}

  def extract_ddl_sql(%{"txid" => _, "txts" => _, "query" => query}) do
    {:ok, query}
  end

  def schema_version(conn, version) do
    with {:ok, [_, _], rows} <- :epgsql.equery(conn, @schema_version_query, [version]) do
      case rows do
        [] ->
          {:error, "no schema with version #{inspect(version)}"}

        [{schema, version}] ->
          with {:ok, schema} <- Proto.Schema.json_decode(schema) do
            {:ok, version, schema}
          end
      end
    end
  end

  def current_schema(conn) do
    with {:ok, [_, _], rows} <- :epgsql.equery(conn, @current_schema_query, []) do
      case rows do
        [] ->
          {:ok, nil, Schema.new()}

        [{schema, version}] ->
          with {:ok, schema} <- Proto.Schema.json_decode(schema) do
            {:ok, version, schema}
          end
      end
    end
  end

  def save_schema(conn, version, %Proto.Schema{} = schema, stmts) do
    with {:ok, iodata} <- Proto.Schema.json_encode(schema),
         json = IO.iodata_to_binary(iodata),
         {:ok, n} when n in [0, 1] <-
           :epgsql.equery(conn, @save_schema_query, [version, json, stmts]) do
      Logger.info("Saved schema version #{version}")
      :ok
    end
  end

  def list_schema_versions(conn) do
    with {:ok, [_, _, _], rows} <- :epgsql.equery(conn, @all_schema_query, []) do
      {:ok, rows}
    end
  end

  @tx_version_query "SELECT version FROM #{@version_table} WHERE txid = $1::#{@txid_type} and txts = $2::#{@txts_type} LIMIT 1"

  @doc """
  Given a db row which points to a compound transaction id, returns the version
  for that transaction.
  """
  @spec tx_version(conn(), %{binary() => integer() | binary()}) ::
          {:ok, String.t()} | {:error, term()}
  def tx_version(conn, %{"txid" => txid, "txts" => txts}) do
    with {:ok, _cols, rows} <-
           :epgsql.equery(conn, @tx_version_query, [to_integer(txid), to_integer(txts)]) do
      case rows do
        [] ->
          {:error, "No version found for tx txid: #{txid}, txts: #{txts}"}

        [{version}] ->
          {:ok, version}
      end
    end
  end

  def tx_version(_conn, row) do
    raise ArgumentError,
      message: "invalid tx fk row #{inspect(row)}, expecting %{\"txid\" => _, \"txts\" => _}"
  end

  @spec migration_history(conn(), binary() | nil) :: {:ok, [Migration.t()]} | {:error, term()}
  def migration_history(conn, after_version \\ nil)

  def migration_history(conn, after_version) do
    query = migration_history_query(after_version)

    with {:ok, [_, _, _, _, _, _], rows} <- :epgsql.equery(conn, query, [after_version]) do
      {:ok, load_migrations(rows)}
    end
  end

  def known_migration_version?(conn, version) when is_binary(version) do
    case :epgsql.equery(conn, "SELECT 1 FROM #{@version_table} WHERE version = $1", [version]) do
      {:ok, [_], [{1}]} -> true
      _ -> false
    end
  end

  defp load_migrations(rows) do
    Enum.map(rows, fn {txid_str, txts, version, timestamp, schema_json, stmts} ->
      %Migration{
        version: version,
        txid: String.to_integer(txid_str),
        txts: txts,
        timestamp: Types.DateTime.from_epgsql(timestamp),
        schema: Proto.Schema.json_decode!(schema_json),
        stmts: stmts
      }
    end)
  end

  @table_is_electrifed_query "SELECT count(id) AS count FROM #{@electrified_tracking_table} WHERE schema_name = $1 AND table_name = $2 LIMIT 1"

  @spec electrified?(conn(), String.t(), String.t()) :: {:ok, boolean()} | {:error, term()}
  def electrified?(conn, schema \\ "public", table) do
    with {:ok, _, [{count}]} <- :epgsql.equery(conn, @table_is_electrifed_query, [schema, table]) do
      {:ok, count == 1}
    end
  end

  @index_electrified_query """
  SELECT COUNT(pci.oid)
    FROM pg_class pc
    INNER JOIN #{@electrified_tracking_table} et ON et.oid = pc.oid
    INNER JOIN pg_index pi ON pi.indrelid = pc.oid
    INNER JOIN pg_class pci ON pci.oid = pi.indexrelid
  WHERE et.schema_name = $1
    AND pi.indisprimary = false
    AND pci.relname = $2
  """

  @spec index_electrified?(conn(), String.t(), String.t()) :: {:ok, boolean()} | {:error, term()}
  def index_electrified?(conn, schema, name) do
    with {:ok, _, [{n}]} <- :epgsql.equery(conn, @index_electrified_query, [schema, name]) do
      {:ok, n == 1}
    end
  end

  def create_table_ddl(conn, %Proto.RangeVar{} = table_name) do
    name = to_string(table_name)

    ddlgen_create(conn, name, "ddlgen_create")
  end

  def create_index_ddl(conn, %Proto.RangeVar{} = table_name, index_name) do
    name = to_string(%{table_name | name: index_name})

    ddlgen_create(conn, name, "ddlgen_create")
  end

  defp ddlgen_create(conn, name, function) do
    query = "SELECT #{@schema}.#{function}($1::regclass)"

    with {:ok, _cols, [{ddl}]} <- :epgsql.equery(conn, query, [name]) do
      {:ok, ddl}
    end
  end

  def txid_type, do: @txid_type
  def txts_type, do: @txts_type

  @spec define_functions(conn) :: :ok
  def define_functions(conn) do
    Enum.each(Functions.list(), fn {path, sql} ->
      conn
      |> :epgsql.squery(sql)
      |> List.wrap()
      |> Enum.find(&(not match?({:ok, [], []}, &1)))
      |> case do
        nil -> Logger.debug("Successfully (re)defined SQL routine from '#{path}'")
        error -> raise "Failed to define SQL routine from '#{path}' with error: #{inspect(error)}"
      end
    end)
  end

  @spec migrations() :: [module(), ...]
  def migrations do
    alias Electric.Postgres.Extension.Migrations

    [
      Migrations.Migration_20230328113927,
      Migrations.Migration_20230424154425_DDLX,
      Migrations.Migration_20230512000000_conflict_resolution_triggers,
      Migrations.Migration_20230605141256_ElectrifyFunction,
      Migrations.Migration_20230715000000_UtilitiesTable,
      Migrations.Migration_20230814170123_RenameDDLX,
      Migrations.Migration_20230814170745_ElectricDDL,
      Migrations.Migration_20230829000000_AcknowledgedClientLsnsTable,
      Migrations.Migration_20230918115714_DDLCommandUniqueConstraint,
      Migrations.Migration_20230921161045_DropEventTriggers,
      Migrations.Migration_20230921161418_ProxyCompatibility,
      Migrations.Migration_20231009121515_AllowLargeMigrations,
      Migrations.Migration_20231010123118_AddPriorityToVersion,
      Migrations.Migration_20231016141000_ConvertFunctionToProcedure,
      Migrations.Migration_20231206130400_ConvertReplicaTriggersToAlways,
      Migrations.Migration_20240110110200_DropUnusedFunctions,
      Migrations.Migration_20240205141200_ReinstallTriggerFunctionWriteCorrectMaxTag
    ]
  end

  def replicated_table_ddls do
    for migration_module <- migrations(),
        function_exported?(migration_module, :replicated_table_ddls, 0),
        ddl <- migration_module.replicated_table_ddls() do
      ddl
    end
  end

  @spec migrate(conn()) :: {:ok, versions()} | {:error, term()}
  def migrate(conn) do
    migrate(conn, __MODULE__)
  end

  @spec migrate(conn(), module()) :: {:ok, versions()} | {:error, term()}
  def migrate(conn, module) do
    migrations = migration_versions(module)

    if Enum.empty?(migrations), do: raise(Error, message: "no migrations defined in #{module}")

    ensure_transaction(conn, fn txconn ->
      create_schema(txconn)
      create_migration_table(txconn)

      newly_applied_versions =
        with_migration_lock(txconn, fn ->
          existing_versions = txconn |> existing_migration_versions() |> MapSet.new()

          migrations
          |> Enum.reject(fn {version, _module} -> version in existing_versions end)
          |> Enum.map(fn {version, module} ->
            :ok = apply_migration(txconn, version, module)
            version
          end)
        end)

      if module == __MODULE__ do
        :ok = define_functions(txconn)
      end

      {:ok, newly_applied_versions}
    end)
  end

  defp apply_migration(txconn, version, module) do
    Logger.info("Running extension migration: #{version}")

    for sql <- module.up(@schema) do
      results = :epgsql.squery(txconn, sql) |> List.wrap()
      errors = Enum.filter(results, &(elem(&1, 0) == :error))

      if errors == [] do
        :ok
      else
        raise RuntimeError,
          message:
            "Migration #{version}/#{inspect(module)} returned errors:\n#{inspect(errors, pretty: true)}"
      end
    end

    {:ok, 1} =
      :epgsql.squery(
        txconn,
        "INSERT INTO #{@migration_table} (version) VALUES ('#{version}')"
      )

    :ok
  end

  # https://dba.stackexchange.com/a/311714
  @is_transaction_sql "SELECT transaction_timestamp() != statement_timestamp() AS is_transaction"

  defp ensure_transaction(conn, fun) when is_function(fun, 1) do
    case :epgsql.squery(conn, @is_transaction_sql) do
      {:ok, _cols, [{"t"}]} -> fun.(conn)
      {:ok, _cols, [{"f"}]} -> Client.with_transaction(conn, fun)
    end
  end

  def create_schema(conn) do
    {:ok, [], []} = :epgsql.squery(conn, ~s|CREATE SCHEMA IF NOT EXISTS "#{@schema}"|)
  end

  @create_migration_table_sql """
  CREATE TABLE IF NOT EXISTS #{@migration_table} (
    version int8 NOT NULL PRIMARY KEY,
    inserted_at timestamp without time zone NOT NULL DEFAULT LOCALTIMESTAMP
  );
  """

  def create_migration_table(conn) do
    {:ok, [], []} = :epgsql.squery(conn, @create_migration_table_sql)
  end

  defp with_migration_lock(conn, fun) do
    {:ok, [], []} =
      :epgsql.squery(conn, "LOCK TABLE #{@migration_table} IN SHARE UPDATE EXCLUSIVE MODE")

    fun.()
  end

  defp existing_migration_versions(conn) do
    {:ok, _cols, rows} =
      :epgsql.squery(conn, "SELECT version FROM #{@migration_table} ORDER BY version ASC")

    Enum.map(rows, fn {version} -> String.to_integer(version) end)
  end

  def migration_versions(module) when is_atom(module) do
    unless function_exported?(module, :migrations, 0),
      do: raise(ArgumentError, message: "Module #{module} does not have a migrations/0 function")

    module
    |> apply(:migrations, [])
    |> Enum.map(&{&1.version(), &1})
  end

  def ddl_history(conn) do
    with {:ok, _cols, rows} <- :epgsql.equery(conn, @ddl_history_query, []) do
      {:ok,
       for(
         {id, txid, txts, query} <- rows,
         do: %{"id" => id, "txid" => to_integer(txid), "txts" => txts, "query" => query}
       )}
    end
  end

  def add_table_to_publication_sql(table, columns \\ nil) do
    column_list =
      case columns do
        nil -> ""
        [] -> ""
        [_ | _] = c -> IO.iodata_to_binary([" (", Enum.intersperse(c, ", "), ")"])
      end

    ~s|ALTER PUBLICATION "#{@publication_name}" ADD TABLE #{table}#{column_list}|
  end

  @doc """
  Returns a relation that is the shadow table of the passed-in relation.
  """
  def shadow_of({schema, table}), do: {@schema, "shadow__#{schema}__#{table}"}

  @doc """
  Returns true if a given relation is a shadow table under current naming convention.
  """
  defguard is_shadow_relation(relation)
           when elem(relation, 0) == @schema and is_binary(elem(relation, 1)) and
                  byte_size(elem(relation, 1)) >= 8 and
                  binary_part(elem(relation, 1), 0, 8) == "shadow__"

  @doc """
  Returns true if a given relation is a tombstone table under current naming convention.
  """
  defguard is_tombstone_relation(relation)
           when elem(relation, 0) == @schema and is_binary(elem(relation, 1)) and
                  byte_size(elem(relation, 1)) >= 11 and
                  binary_part(elem(relation, 1), 0, 11) == "tombstone__"

  @doc """
  Returns primary keys list for a given shadow record.

  Utilizes implicit knowledge of the shadow table structure: its "implementation
  detail" keys start with an underscore, and all its non-pk columns are "duplicated",
  with one column having same name as the main table, and the other having the name
  `__reordered_<original_column_name>`. We can thus remove all non-pk columns if
  they have a paired reordered column.

  The reason to use this function as opposed to querying `SchemaCache` is when we need
  this information before the transaction got propagated to `MigrationsConsumer`. This
  function's main place of use is in `PostgresReplicationProducer`, which will always
  be ahead of `MigrationsConsumer`, and thus may need to access that information
  before it's written to cache.
  """
  def infer_shadow_primary_keys(record) when is_map(record) do
    infer_shadow_primary_keys(Map.keys(record))
  end

  @known_shadow_columns ~w|_tags _last_modified _is_a_delete_operation _tag _observed_tags _modified_columns_bit_mask _resolved _currently_reordering|
  def infer_shadow_primary_keys(all_keys) when is_list(all_keys),
    do: Enum.reject(all_keys, &known_shadow_column?/1)

  defp known_shadow_column?("_tag_" <> _), do: true
  defp known_shadow_column?("__reordered_" <> _), do: true

  for known_key <- @known_shadow_columns do
    defp known_shadow_column?(unquote(known_key)), do: true
  end

  defp known_shadow_column?(_), do: false

  @doc """
  Perform a mostly no-op update to a transaction marker query to make sure
  there is at least one write to Postgres after this point.

  Second argument, `caused_by`, is any string which will be written in this
  write, which may be useful for debugging.

  This uses an extended query syntax, and thus cannot be used in a `replication: true`
  connection.
  """
  def update_transaction_marker(conn, caused_by) when is_binary(caused_by) do
    {:ok, 1} =
      :epgsql.equery(
        conn,
        transaction_marker_update_equery(),
        [caused_by]
      )
  end

  @last_acked_client_lsn_equery "SELECT lsn FROM #{@acked_client_lsn_table} WHERE client_id = $1"
  def fetch_last_acked_client_lsn(conn, client_id) do
    case :epgsql.equery(conn, @last_acked_client_lsn_equery, [client_id]) do
      {:ok, _, [{lsn}]} ->
        # No need for a decoding step here because :epgsql.equery() uses Postgres' binary protocol, so a BYTEA value
        # is returned as a raw binary.
        lsn

      {:ok, _, []} ->
        nil
    end
  end

  @doc """
  Try inserting a new cluster id into PostgreSQL to persist, but return
  the already-existing value on conflict.
  """
  def save_and_get_cluster_id(conn) do
    :epgsql.squery(conn, """
    INSERT INTO #{transaction_marker_table()} as o (id, content)
      VALUES ('cluster_id', '"#{Utils.uuid4()}"')
    ON CONFLICT (id) DO UPDATE SET content = o.content
    RETURNING content->>0;
    """)
  end

  defp to_integer(i) when is_integer(i), do: i
  defp to_integer(s) when is_binary(s), do: String.to_integer(s)
end
