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

  @migration_table ~s("#{@schema}"."schema_migrations")
  @version_table ~s("#{@schema}"."#{@version_relation}")
  @ddl_table ~s("#{@schema}"."#{@ddl_relation}")
  @schema_table ~s("#{@schema}"."schema")

  @all_schema_query ~s(SELECT "schema", "version" FROM #{@schema_table} ORDER BY "version" ASC)
  @current_schema_query ~s(SELECT "schema", "version" FROM #{@schema_table} ORDER BY "id" DESC LIMIT 1)
  @schema_version_query ~s(SELECT "schema", "version" FROM #{@schema_table} WHERE "version" = $1 LIMIT 1)
  # FIXME: VAX-600 insert into schema ignoring conflicts (which I think arise from inter-pg replication, a problem 
  # that will go away once we stop replicating all tables by default)
  @save_schema_query ~s[INSERT INTO #{@schema_table} ("version", "schema") VALUES ($1, $2) ON CONFLICT ("id") DO NOTHING]
  @ddl_history_query "SELECT id, txid, txts, query FROM #{@ddl_table} ORDER BY id ASC;"

  def schema, do: @schema
  def ddl_table, do: @ddl_table
  def schema_table, do: @schema_table
  def version_table, do: @version_table

  def ddl_relation, do: {@schema, @ddl_relation}
  def version_relation, do: {@schema, @version_relation}
  def schema_relation, do: {@schema, @schema_relation}

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

  def save_schema(conn, version, %Proto.Schema{} = schema) do
    with {:ok, iodata} <- Proto.Schema.json_encode(schema),
         json = IO.iodata_to_binary(iodata),
         {:ok, n} when n in [0, 1] <- :epgsql.equery(conn, @save_schema_query, [version, json]) do
      Logger.info("Saved schema version #{version}")
      :ok
    end
  end

  def list_schema_versions(conn) do
    with {:ok, [_, _], rows} <- :epgsql.equery(conn, @all_schema_query, []) do
      {:ok, rows}
    end
  end

  @spec migrations() :: [module(), ...]
  def migrations do
    alias Electric.Postgres.Extension.Migrations

    [
      Migrations.Migration_20230328113927
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

            for sql <- module.up(@schema) do
              {:ok, _cols, _rows} = :epgsql.squery(txconn, sql)
            end

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
    ddl(conn, "CREATE SCHEMA IF NOT EXISTS #{@schema}")
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
end
