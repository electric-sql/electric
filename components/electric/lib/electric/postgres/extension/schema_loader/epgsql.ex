defmodule Electric.Postgres.Extension.SchemaLoader.Epgsql do
  @moduledoc """
  Implements the SchemaLoader behaviour backed by the connected
  postgres instance.

  Uses a connection pool to avoid deadlocks when e.g. refreshing a subscription
  then attempting to run a query against the db.
  """

  alias Electric.Postgres.{Extension, Extension.SchemaLoader, Schema}
  alias Electric.Replication.{Connectors, Postgres.Client}
  alias Electric.Postgres.ConnectionPool

  require Logger

  @behaviour SchemaLoader

  @impl true
  def connect(conn_config, _opts) do
    {:ok, ConnectionPool.name(Connectors.origin(conn_config))}
  end

  @impl true
  def load(pool) do
    ConnectionPool.checkout!(pool, fn conn ->
      Extension.current_schema(conn)
    end)
  end

  @impl true
  def load(pool, version) do
    ConnectionPool.checkout!(pool, fn conn ->
      Extension.schema_version(conn, version)
    end)
  end

  @impl true
  def save(pool, version, schema, stmts) do
    ConnectionPool.checkout!(pool, fn conn ->
      with :ok <- Extension.save_schema(conn, version, schema, stmts) do
        {:ok, pool}
      end
    end)
  end

  @impl true
  def relation_oid(_conn, :trigger, _schema, _table) do
    raise RuntimeError, message: "oid lookup for triggers no implemented"
  end

  def relation_oid(pool, rel_type, schema, table) do
    ConnectionPool.checkout!(pool, fn conn ->
      Client.relation_oid(conn, rel_type, schema, table)
    end)
  end

  @primary_keys_query """
  SELECT a.attname
  FROM pg_class c
    INNER JOIN pg_namespace n ON c.relnamespace = n.oid
    INNER JOIN pg_index i ON i.indrelid = c.oid
    INNER JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
  WHERE
      n.nspname = $1
      AND c.relname = $2
      AND c.relkind = 'r'
      AND i.indisprimary
  """

  @impl true
  def primary_keys(pool, schema, name) do
    ConnectionPool.checkout!(pool, fn conn ->
      {:ok, _, pks_data} = :epgsql.equery(conn, @primary_keys_query, [schema, name])

      {:ok, Enum.map(pks_data, &elem(&1, 0))}
    end)
  end

  @impl true
  def primary_keys(pool, {schema, name}) do
    primary_keys(pool, schema, name)
  end

  @impl true
  def refresh_subscription(pool, name) do
    ConnectionPool.checkout!(pool, fn conn ->
      query = ~s|ALTER SUBSCRIPTION "#{name}" REFRESH PUBLICATION WITH (copy_data = false)|

      case :epgsql.squery(conn, query) do
        {:ok, [], []} ->
          :ok

        # "ALTER SUBSCRIPTION ... REFRESH is not allowed for disabled subscriptions"
        # ignore this as it's due to race conditions with the rest of the system
        {:error, {:error, :error, "55000", :object_not_in_prerequisite_state, _, _}} ->
          Logger.warning("Unable to refresh DISABLED subscription #{name}")
          :ok

        error ->
          error
      end
    end)
  end

  @impl true
  def migration_history(pool, version) do
    ConnectionPool.checkout!(pool, fn conn ->
      Extension.migration_history(conn, version)
    end)
  end

  @impl true
  def known_migration_version?(pool, version) do
    ConnectionPool.checkout!(pool, fn conn ->
      Extension.known_migration_version?(conn, version)
    end)
  end

  @impl true
  def internal_schema(pool) do
    ConnectionPool.checkout!(pool, fn conn ->
      oid_loader = &Client.relation_oid(conn, &1, &2, &3)

      Enum.reduce(Extension.replicated_table_ddls(), Schema.new(), fn ddl, schema ->
        Schema.update(schema, ddl, oid_loader: oid_loader)
      end)
    end)
  end
end
