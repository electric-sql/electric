defmodule Electric.Postgres.Extension.SchemaLoader.Epgsql do
  @moduledoc """
  Implements the SchemaLoader behaviour backed by the connected
  postgres instance.

  Uses a connection pool to avoid deadlocks when e.g. refreshing a subscription
  then attempting to run a query against the db.
  """
  defmodule ConnectionPool do
    @moduledoc false

    alias Electric.Replication.Connectors

    require Logger

    @behaviour NimblePool

    @impl NimblePool
    def init_worker(conn_config) do
      Logger.debug("Starting SchemaLoader pg connection: #{inspect(conn_config)}")
      # NOTE: use `__connection__: conn` in tests to pass an existing connection
      {:ok, conn} =
        case Keyword.fetch(conn_config, :__connection__) do
          {:ok, conn} ->
            {:ok, conn}

          :error ->
            conn_config
            |> Connectors.get_connection_opts(replication: false)
            |> :epgsql.connect()
        end

      {:ok, conn, conn_config}
    end

    @impl NimblePool
    # Transfer the port to the caller
    def handle_checkout(:checkout, _from, conn, pool_state) do
      {:ok, conn, conn, pool_state}
    end

    @impl NimblePool
    def handle_checkin(:ok, _from, conn, pool_state) do
      {:ok, conn, pool_state}
    end

    @impl NimblePool
    def terminate_worker(_reason, conn, pool_state) do
      Logger.debug("Terminating idle db connection #{inspect(conn)}")
      :epgsql.close(conn)
      {:ok, pool_state}
    end

    @impl NimblePool
    def handle_ping(_conn, _pool_state) do
      {:remove, :idle}
    end
  end

  alias Electric.Postgres.{Extension, Extension.SchemaLoader, Schema}
  alias Electric.Replication.{Connectors, Postgres.Client}

  require Logger

  @behaviour SchemaLoader

  @pool_timeout 5_000

  @impl true
  def connect(conn_config, _opts) do
    {:ok, _pool} =
      NimblePool.start_link(
        worker: {ConnectionPool, conn_config},
        # only connect when required, not immediately
        lazy: true,
        pool_size: 4,
        worker_idle_timeout: 30_000
      )
  end

  defp checkout!(pool, fun) do
    NimblePool.checkout!(
      pool,
      :checkout,
      fn _pool, conn ->
        {fun.(conn), :ok}
      end,
      @pool_timeout
    )
  end

  @impl true
  def load(pool) do
    checkout!(pool, fn conn ->
      Extension.current_schema(conn)
    end)
  end

  @impl true
  def load(pool, version) do
    checkout!(pool, fn conn ->
      Extension.schema_version(conn, version)
    end)
  end

  @impl true
  def save(pool, version, schema, stmts) do
    checkout!(pool, fn conn ->
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
    checkout!(pool, fn conn ->
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
    checkout!(pool, fn conn ->
      {:ok, _, pks_data} = :epgsql.equery(conn, @primary_keys_query, [schema, name])

      {:ok, Enum.map(pks_data, &elem(&1, 0))}
    end)
  end

  @impl true
  def primary_keys(pool, {schema, name}) do
    checkout!(pool, fn conn ->
      primary_keys(conn, schema, name)
    end)
  end

  @impl true
  def refresh_subscription(pool, name) do
    checkout!(pool, fn conn ->
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
    checkout!(pool, fn conn ->
      Extension.migration_history(conn, version)
    end)
  end

  @impl true
  def known_migration_version?(pool, version) do
    checkout!(pool, fn conn ->
      Extension.known_migration_version?(conn, version)
    end)
  end

  @impl true
  def electrified_tables(pool) do
    checkout!(pool, fn conn ->
      Extension.electrified_tables(conn)
    end)
  end

  @impl true
  def internal_schema(pool) do
    checkout!(pool, fn conn ->
      oid_loader = &Client.relation_oid(conn, &1, &2, &3)

      Enum.reduce(Extension.create_table_ddls(), Schema.new(), fn ddl, schema ->
        Schema.update(schema, ddl, oid_loader: oid_loader)
      end)
    end)
  end
end
