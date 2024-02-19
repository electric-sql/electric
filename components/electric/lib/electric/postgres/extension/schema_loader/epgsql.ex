defmodule Electric.Postgres.Extension.SchemaLoader.Epgsql do
  @moduledoc """
  Implements the SchemaLoader behaviour backed by the connected
  postgres instance.

  Uses a connection pool to avoid deadlocks when e.g. refreshing a subscription
  then attempting to run a query against the db.
  """
  defmodule ConnectionPool do
    @moduledoc false

    alias Electric.Replication.{Connectors, Postgres.Client}

    require Logger

    @behaviour NimblePool

    @impl NimblePool
    def init_worker(conn_config) do
      # NOTE: use `__connection__: conn` in tests to pass an existing connection
      {:ok, conn} =
        case Keyword.fetch(conn_config, :__connection__) do
          {:ok, conn} ->
            {:ok, conn}

          :error ->
            conn_config
            |> Connectors.get_connection_opts()
            |> Client.connect()
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
      Client.close(conn)
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

  @impl SchemaLoader
  def connect(_opts, conn_config) do
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

  @impl SchemaLoader
  def load(pool) do
    checkout!(pool, fn conn ->
      with {:ok, version, schema} <- Extension.current_schema(conn) do
        {:ok, SchemaLoader.Version.new(version, schema)}
      end
    end)
  end

  @impl SchemaLoader
  def load(pool, version) do
    checkout!(pool, fn conn ->
      with {:ok, version, schema} <- Extension.schema_version(conn, version) do
        {:ok, SchemaLoader.Version.new(version, schema)}
      end
    end)
  end

  @impl SchemaLoader
  def save(pool, version, schema, stmts) do
    checkout!(pool, fn conn ->
      with :ok <- Extension.save_schema(conn, version, schema, stmts) do
        {:ok, pool, SchemaLoader.Version.new(version, schema)}
      end
    end)
  end

  @impl SchemaLoader
  def relation_oid(_conn, :trigger, _schema, _table) do
    raise RuntimeError, message: "oid lookup for triggers no implemented"
  end

  def relation_oid(pool, rel_type, schema, table) do
    checkout!(pool, fn conn ->
      Client.relation_oid(conn, rel_type, schema, table)
    end)
  end

  @impl SchemaLoader
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

  @impl SchemaLoader
  def migration_history(pool, version) do
    checkout!(pool, fn conn ->
      Extension.migration_history(conn, version)
    end)
  end

  @impl SchemaLoader
  def known_migration_version?(pool, version) do
    checkout!(pool, fn conn ->
      Extension.known_migration_version?(conn, version)
    end)
  end

  @impl SchemaLoader
  def internal_schema(pool) do
    checkout!(pool, fn conn ->
      oid_loader = &Client.relation_oid(conn, &1, &2, &3)

      Enum.reduce(Extension.replicated_table_ddls(), Schema.new(), fn ddl, schema ->
        Schema.update(schema, ddl, oid_loader: oid_loader)
      end)
    end)
  end

  @impl SchemaLoader
  def table_electrified?(pool, {schema, name}) do
    checkout!(pool, fn conn ->
      Extension.electrified?(conn, schema, name)
    end)
  end

  @impl SchemaLoader
  def index_electrified?(pool, {schema, name}) do
    checkout!(pool, fn conn ->
      Extension.index_electrified?(conn, schema, name)
    end)
  end

  @impl SchemaLoader
  def tx_version(pool, row) do
    checkout!(pool, fn conn ->
      Extension.tx_version(conn, row)
    end)
  end

  @impl SchemaLoader
  def global_permissions(pool) do
    checkout!(pool, fn conn ->
      Extension.Permissions.global(conn)
    end)
  end

  @impl SchemaLoader
  def global_permissions(pool, id) do
    checkout!(pool, fn conn ->
      Extension.Permissions.global(conn, id)
    end)
  end

  @impl SchemaLoader
  def save_global_permissions(pool, permissions) do
    checkout!(pool, fn conn ->
      with :ok <- Extension.Permissions.save_global(conn, permissions) do
        {:ok, pool}
      end
    end)
  end

  @impl SchemaLoader
  def user_permissions(pool, user_id) do
    checkout!(pool, fn conn ->
      with {:ok, perms} <- Extension.Permissions.user(conn, user_id) do
        {:ok, pool, perms}
      end
    end)
  end

  @impl SchemaLoader
  def user_permissions(pool, user_id, perms_id) do
    checkout!(pool, fn conn ->
      with {:ok, perms} <- Extension.Permissions.user(conn, user_id, perms_id) do
        {:ok, perms}
      end
    end)
  end

  @impl SchemaLoader
  def save_user_permissions(pool, user_id, roles) do
    checkout!(pool, fn conn ->
      with {:ok, perms} <- Extension.Permissions.save_user(conn, user_id, roles) do
        {:ok, pool, perms}
      end
    end)
  end
end
