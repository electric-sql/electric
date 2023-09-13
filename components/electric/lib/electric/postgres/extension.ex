defmodule Electric.Postgres.Extension do
  @moduledoc """
  Manages our pseudo-extension code
  """

  alias Electric.Postgres.{Extension.Migration, Schema, Schema.Proto}
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
  @electrified_index_relation "electrified_idx"
  @acked_client_lsn_relation "acknowledged_client_lsns"

  electric = &to_string([?", @schema, ?", ?., ?", &1, ?"])

  @migration_table electric.("schema_migrations")
  @version_table electric.(@version_relation)
  @ddl_table electric.(@ddl_relation)
  @schema_table electric.("schema")
  @electrified_tracking_table electric.(@electrified_table_relation)
  @electrified_index_table electric.(@electrified_index_relation)
  @transaction_marker_table electric.("transaction_marker")
  @acked_client_lsn_table electric.(@acked_client_lsn_relation)

  @all_schema_query ~s(SELECT "schema", "version", "migration_ddl" FROM #{@schema_table} ORDER BY "version" ASC)
  @current_schema_query ~s(SELECT "schema", "version" FROM #{@schema_table} ORDER BY "id" DESC LIMIT 1)
  @schema_version_query ~s(SELECT "schema", "version" FROM #{@schema_table} WHERE "version" = $1 LIMIT 1)
  # FIXME: VAX-600 insert into schema ignoring conflicts (which I think arise from inter-pg replication, a problem
  # that will go away once we stop replicating all tables by default)
  @save_schema_query ~s[INSERT INTO #{@schema_table} ("version", "schema", "migration_ddl") VALUES ($1, $2, $3) ON CONFLICT ("id") DO NOTHING]
  @ddl_history_query "SELECT id, txid, txts, query FROM #{@ddl_table} ORDER BY id ASC;"
  @event_triggers %{
    ddl_command_end: "#{@schema}_event_trigger_ddl_end",
    sql_drop: "#{@schema}_event_trigger_sql_drop"
  }

  @publication_name "electric_publication"
  @slot_name "electric_replication_out"
  @subscription_name "electric_replication_in"

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
      v.txid,
      v.txts,
      v.version,
      s.schema,
      s.migration_ddl
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
  def electrified_tracking_table, do: @electrified_tracking_table
  def electrified_index_table, do: @electrified_index_table
  def transaction_marker_table, do: @transaction_marker_table
  def acked_client_lsn_table, do: @acked_client_lsn_table

  def ddl_relation, do: {@schema, @ddl_relation}
  def version_relation, do: {@schema, @version_relation}
  def schema_relation, do: {@schema, @schema_relation}
  def acked_client_lsn_relation, do: {@schema, @acked_client_lsn_relation}
  def event_triggers, do: @event_triggers
  def publication_name, do: @publication_name
  def slot_name, do: @slot_name
  def subscription_name, do: @subscription_name

  defguard is_extension_relation(relation) when elem(relation, 0) == @schema

  defguard is_migration_relation(relation)
           when relation in [{@schema, @version_relation}, {@schema, @ddl_relation}]

  defguard is_ddl_relation(relation) when relation == {@schema, @ddl_relation}

  defguard is_acked_client_lsn_relation(relation)
           when relation == {@schema, @acked_client_lsn_relation}

  def extract_ddl_version(%{"txid" => _, "txts" => _, "version" => version, "query" => query}) do
    {:ok, version, query}
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

  @spec migration_history(conn(), binary() | nil) :: {:ok, [Migration.t()]} | {:error, term()}
  def migration_history(conn, after_version \\ nil)

  def migration_history(conn, after_version) do
    query = migration_history_query(after_version)
    param = after_version || :null

    with {:ok, [_, _, _, _, _], rows} <- :epgsql.equery(conn, query, [param]) do
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
    Enum.map(rows, fn {txid_str, txts_tuple, version, schema_json, stmts} ->
      %Migration{
        version: version,
        txid: String.to_integer(txid_str),
        txts: decode_epgsql_timestamp(txts_tuple),
        schema: Proto.Schema.json_decode!(schema_json),
        stmts: stmts
      }
    end)
  end

  @table_is_electrifed_query "SELECT count(id) AS count FROM #{@electrified_tracking_table} WHERE schema_name = $1 AND table_name = $2 LIMIT 1"
  @spec electrified?(conn(), String.t(), String.t()) :: boolean()
  def electrified?(conn, schema \\ "public", table) do
    {:ok, _, [{count}]} = :epgsql.equery(conn, @table_is_electrifed_query, [schema, table])
    count == 1
  end

  @electrifed_index_query "SELECT id, table_id  FROM #{@electrified_index_table} ORDER BY id ASC"
  def electrified_indexes(conn) do
    with {:ok, _, rows} <- :epgsql.equery(conn, @electrifed_index_query, []) do
      {:ok, rows}
    end
  end

  def create_table_ddl(conn, %Proto.RangeVar{} = table_name) do
    name = to_string(table_name)

    ddlx_create(conn, name, "ddlx_create")
  end

  def create_index_ddl(conn, %Proto.RangeVar{} = table_name, index_name) do
    name = to_string(%{table_name | name: index_name})

    ddlx_create(conn, name, "ddlx_create")
  end

  defp ddlx_create(conn, name, function) do
    query = "SELECT #{@schema}.#{function}($1::regclass)"

    with {:ok, _cols, [{ddl}]} <- :epgsql.equery(conn, query, [name]) do
      {:ok, ddl}
    end
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
      Migrations.Migration_20230829000000_AcknowledgedClientLsnsTable,
      Migrations.Migration_20230918115714_DDLCommandUniqueConstraint
    ]
  end

  def create_table_ddls do
    for migration_module <- migrations(),
        function_exported?(migration_module, :create_table_ddl, 0) do
      migration_module.create_table_ddl()
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

      with_migration_lock(txconn, fn ->
        existing_migrations = existing_migrations(txconn)

        versions =
          migrations
          |> Enum.reject(fn {version, _module} -> version in existing_migrations end)
          |> Enum.reduce([], fn {version, module}, v ->
            Logger.info("Running extension migration: #{version}")

            disabling_event_triggers(txconn, module, fn ->
              for sql <- module.up(@schema) do
                case :epgsql.squery(txconn, sql) do
                  results when is_list(results) ->
                    errors = Enum.filter(results, &(elem(&1, 0) == :error))

                    unless(Enum.empty?(errors)) do
                      raise RuntimeError,
                        message:
                          "Migration #{version}/#{module} returned errors: #{inspect(errors)}"
                    end

                    :ok

                  {:ok, _} ->
                    :ok

                  {:ok, _cols, _rows} ->
                    :ok
                end
              end
            end)

            {:ok, _count} =
              :epgsql.squery(
                txconn,
                "INSERT INTO #{@migration_table} (version) VALUES ('#{version}')"
              )

            [version | v]
          end)
          |> Enum.reverse()

        {:ok, versions}
      end)
    end)
  end

  # https://dba.stackexchange.com/a/311714
  @is_transaction_sql "SELECT transaction_timestamp() != statement_timestamp() AS is_transaction"

  defp ensure_transaction(conn, fun) when is_function(fun, 1) do
    case :epgsql.squery(conn, @is_transaction_sql) do
      {:ok, _cols, [{"t"}]} ->
        fun.(conn)

      {:ok, _cols, [{"f"}]} ->
        :epgsql.with_transaction(conn, fun)
    end
  end

  def create_schema(conn) do
    ddl(conn, ~s|CREATE SCHEMA IF NOT EXISTS "#{@schema}"|)
  end

  @create_migration_table_sql """
  CREATE TABLE IF NOT EXISTS #{@migration_table} (
    version int8 NOT NULL PRIMARY KEY,
    inserted_at timestamp without time zone NOT NULL DEFAULT LOCALTIMESTAMP
  );
  """

  def create_migration_table(conn) do
    ddl(conn, @create_migration_table_sql)
  end

  defp with_migration_lock(conn, fun) do
    ddl(conn, "LOCK TABLE #{@migration_table} IN SHARE UPDATE EXCLUSIVE MODE")
    fun.()
  end

  defp disabling_event_triggers(conn, _module, fun) do
    disable =
      Enum.flat_map(@event_triggers, fn {_type, name} ->
        case :epgsql.squery(conn, "SELECT * FROM pg_event_trigger WHERE evtname = '#{name}'") do
          {:ok, _, [_]} ->
            [name]

          _ ->
            []
        end
      end)

    Enum.each(disable, &alter_event_trigger(conn, &1, "DISABLE"))

    result = fun.()

    # if there's a problem the tx will be aborted and the event triggers
    # left in an enabled state, so no need for a try..after..end block
    Enum.each(disable, &alter_event_trigger(conn, &1, "ENABLE"))

    result
  end

  defp alter_event_trigger(conn, name, state) do
    query = ~s|ALTER EVENT TRIGGER "#{name}" #{state}|
    Logger.debug(query)
    {:ok, [], []} = :epgsql.squery(conn, query)
  end

  defp existing_migrations(conn) do
    {:ok, _cols, rows} =
      :epgsql.squery(conn, "SELECT version FROM #{@migration_table} ORDER BY version ASC")

    Enum.map(rows, fn {version} -> String.to_integer(version) end)
  end

  defp ddl(conn, sql, _bind \\ []) do
    case :epgsql.squery(conn, sql) do
      {:ok, _count} -> conn
      {:ok, _count, _cols, _rows} -> conn
      {:ok, _cols, _rows} -> conn
    end
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
      {:ok, rows}
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

  defp decode_epgsql_timestamp({date, {h, m, frac_sec}}) do
    sec = trunc(frac_sec)
    microsec = trunc((frac_sec - sec) * 1_000_000)
    DateTime.from_naive!(NaiveDateTime.from_erl!({date, {h, m, sec}}, {microsec, 6}), "Etc/UTC")
  end

  def encode_epgsql_timestamp(%DateTime{} = dt) do
    dt |> DateTime.to_naive() |> NaiveDateTime.to_erl()
  end

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
end
