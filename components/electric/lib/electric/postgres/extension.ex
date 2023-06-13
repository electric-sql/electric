defmodule Electric.Postgres.Extension do
  @moduledoc """
  Manages our pseudo-extension code
  """

  alias Electric.Postgres.{Schema, Schema.Proto}

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

  electric = &to_string([?", @schema, ?", ?., ?", &1, ?"])

  @migration_table electric.("schema_migrations")
  @version_table electric.(@version_relation)
  @ddl_table electric.(@ddl_relation)
  @schema_table electric.("schema")
  @electrified_tracking_table electric.(@electrified_table_relation)
  @electrified_index_table electric.(@electrified_index_relation)

  @all_schema_query ~s(SELECT "schema", "version", "migration_ddl" FROM #{@schema_table} ORDER BY "version" ASC)
  @migration_history_query ~s(SELECT "version", "schema", "migration_ddl" FROM #{@schema_table} ORDER BY "version" ASC)
  @partial_migration_history_query ~s(SELECT "version", "schema", "migration_ddl" FROM #{@schema_table} WHERE "version" > $1 ORDER BY "version" ASC)
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

  def schema, do: @schema
  def ddl_table, do: @ddl_table
  def schema_table, do: @schema_table
  def version_table, do: @version_table
  def electrified_tracking_table, do: @electrified_tracking_table
  def electrified_index_table, do: @electrified_index_table

  def ddl_relation, do: {@schema, @ddl_relation}
  def version_relation, do: {@schema, @version_relation}
  def schema_relation, do: {@schema, @schema_relation}
  def event_triggers, do: @event_triggers
  def publication_name, do: @publication_name
  def slot_name, do: @slot_name
  def subscription_name, do: @subscription_name

  defguard is_migration_relation(relation)
           when elem(relation, 0) == @schema and
                  elem(relation, 1) in [@version_relation, @ddl_relation]

  defguard is_ddl_relation(relation)
           when elem(relation, 0) == @schema and elem(relation, 1) == @ddl_relation

  defguard is_extension_relation(relation) when elem(relation, 0) == @schema

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

  def migration_history(conn, after_version \\ nil)

  def migration_history(conn, nil) do
    with {:ok, [_, _, _], rows} <- :epgsql.equery(conn, @migration_history_query, []) do
      {:ok, load_migrations(rows)}
    end
  end

  def migration_history(conn, after_version) when is_binary(after_version) do
    with {:ok, [_, _, _], rows} <-
           :epgsql.equery(conn, @partial_migration_history_query, [after_version]) do
      {:ok, load_migrations(rows)}
    end
  end

  defp load_migrations(rows) do
    Enum.map(rows, fn {version, schema_json, stmts} ->
      {version, Proto.Schema.json_decode!(schema_json), stmts}
    end)
  end

  @electrifed_table_query "SELECT id, schema_name, table_name, oid FROM #{@electrified_tracking_table} ORDER BY id ASC"
  @electrifed_index_query "SELECT id, table_id  FROM #{@electrified_index_table} ORDER BY id ASC"

  def electrified_tables(conn) do
    with {:ok, _, rows} <- :epgsql.equery(conn, @electrifed_table_query, []) do
      {:ok, rows}
    end
  end

  @table_is_electrifed_query "SELECT count(id) AS count FROM #{@electrified_tracking_table} WHERE schema_name = $1 AND table_name = $2 LIMIT 1"

  @spec electrified?(conn(), String.t(), String.t()) :: boolean()
  def electrified?(conn, schema \\ "public", table) do
    {:ok, _, [{count}]} = :epgsql.equery(conn, @table_is_electrifed_query, [schema, table])
    count == 1
  end

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
      Migrations.Migration_20230605141256_ElectrifyFunction
    ]
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
end
