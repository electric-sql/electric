defmodule Electric.ShapeCache.ShapeStatus.ShapeDb.Connection do
  @moduledoc false

  alias Exqlite.Sqlite3
  alias Electric.ShapeCache.ShapeStatus.ShapeDb.Query
  alias Electric.ShapeCache.ShapeStatus.ShapeDb.PoolRegistry
  alias Electric.Telemetry.OpenTelemetry

  require Logger

  @behaviour NimblePool

  @schema_version 4

  @migration_sqls [
    """
    CREATE TABLE shapes (
      handle BLOB NOT NULL,
      shape BLOB NOT NULL,
      comparable BLOB NOT NULL,
      hash INTEGER NOT NULL,
      snapshot_complete INTEGER NOT NULL DEFAULT 0
    ) STRICT
    """,
    """
    CREATE UNIQUE INDEX shapes_handle_idx ON shapes (handle)
    """,
    """
    CREATE UNIQUE INDEX shapes_comparable_idx ON shapes (comparable)
    """,
    """
    CREATE INDEX shapes_comparable_cover_idx ON shapes (comparable, handle)
    """,
    """
    CREATE INDEX shapes_handle_cover_idx ON shapes (handle, shape, hash, snapshot_complete)
    """,
    """
    CREATE INDEX shapes_snapshot_idx ON shapes (snapshot_complete, handle)
    """,
    """
    CREATE TABLE relations (
      handle BLOB NOT NULL,
      oid INTEGER NOT NULL,
      UNIQUE (handle, oid)
    ) STRICT
    """,
    """
    CREATE INDEX relation_oid_idx ON relations (oid, handle)
    """,
    """
    CREATE INDEX relation_handle_idx ON relations (handle)
    """,
    # keep a separate count of shapes to avoid some kind of o(log n) index scan
    """
    CREATE TABLE shape_count (
      id INTEGER NOT NULL,
      count INTEGER DEFAULT 0
    ) STRICT
    """,
    """
    INSERT INTO shape_count (id, count) VALUES (1, 0)
    """,
    "PRAGMA user_version=#{@schema_version}"
  ]

  defguardp is_raw_connection(conn) when is_reference(conn)

  defstruct [:conn, :stmts]

  def migrate(conn, opts) when is_raw_connection(conn) do
    # because we embed the storage version into the db path
    # we can only ever get 0 for un-migrated or the current storage
    # version.
    case db_version(conn) do
      # not been initialized
      {:ok, 0} ->
        Logger.notice("Migrating shape db to version #{@schema_version}")

        with :ok <- execute_all(conn, migration_sqls(opts)) do
          {:ok, @schema_version}
        end

      {:ok, @schema_version} ->
        {:ok, @schema_version}
    end
  end

  defp migration_sqls(opts) do
    # Recommended journal_mode for SQLite over an NFS share is 'rollback mode', enabled
    # using `PRAGMA journal_mode = DELETE`
    # https://sqlite.org/useovernet.html
    # https://sqlite.org/pragma.html#pragma_journal_mode
    #
    # > Use SQLite in rollback mode. This means you can have multiple
    # > simultaneous readers or one writer, but not simultaneous readers and
    # > writers.
    #
    # Between this behaviour and our use of a single connection for both reads
    # and writes, there is no need for better locking to prevent db corruption
    # via simultaneous access.
    journal_mode =
      if Keyword.get(opts, :exclusive_mode, false) do
        "DELETE"
      else
        "WAL"
      end

    @migration_sqls ++ ["PRAGMA journal_mode=#{journal_mode}"]
  end

  defp integrity_check(conn) when is_raw_connection(conn) do
    try do
      with {:ok, ["ok"]} <- fetch_one(conn, "PRAGMA quick_check", []) do
        :ok
      end
    rescue
      e -> {:error, Exception.format(:error, e, __STACKTRACE__)}
    end
  end

  def optimize(conn) when is_raw_connection(conn) do
    execute_all(conn, ["PRAGMA optimize=0x10002"])
  end

  def enable_extension(conn, extension) when is_raw_connection(conn) do
    with :ok <- Sqlite3.enable_load_extension(conn, true),
         {:ok, _} <- fetch_all(conn, "select load_extension(?)", [ExSqlean.path_for(extension)]) do
      :ok
    end
  end

  @impl NimblePool
  def init_worker(pool_state) do
    if Keyword.get(pool_state, :exclusive_mode, false) do
      init_worker_exclusive(pool_state)
    else
      init_worker_pooled(pool_state)
    end
  end

  defp init_worker_pooled(pool_state) do
    with {:ok, conn} <- open(pool_state),
         stmts <- Query.prepare!(conn, pool_state) do
      {:ok, %__MODULE__{conn: conn, stmts: stmts}, pool_state}
    end
  end

  # when opening in exclusive mode we support in-memory databases and so don't
  # perform any db initialisation in the Migration process, since it starts
  # before the pool and for an in-memory db *everything* has to be performed
  # over the same, single, connection since every connection is a separate db
  # in in-memory mode.
  defp init_worker_exclusive(pool_state) do
    with {:ok, conn} <- open(pool_state, integrity_check: true),
         {:ok, _version} <- migrate(conn, pool_state),
         stmts <- Query.prepare!(conn, Keyword.put(pool_state, :mode, :readwrite)) do
      {:ok, %__MODULE__{conn: conn, stmts: stmts}, pool_state}
    end
  end

  @impl NimblePool
  def handle_enqueue({:checkout, label}, pool_state) do
    {:ok, {:checkout, label, now()}, pool_state}
  end

  @impl NimblePool
  def handle_checkout({:checkout, label, enqueued_at}, _from, conn, pool_state) do
    enqueued_duration_us = System.convert_time_unit(now() - enqueued_at, :native, :microsecond)

    OpenTelemetry.execute(
      [:electric, :shape_db, :pool, :checkout],
      %{queue_time_μs: enqueued_duration_us},
      %{label: label, stack_id: Keyword.get(pool_state, :stack_id)}
    )

    {:ok, conn, conn, pool_state}
  end

  # handles checkouts that were not enqueued.
  def handle_checkout({:checkout, _label}, _from, conn, pool_state) do
    {:ok, conn, conn, pool_state}
  end

  @impl NimblePool
  def handle_checkin(client_state, _from, _worker_state, pool_state) do
    {:ok, client_state, pool_state}
  end

  @max_recovery_attempts 2

  def open(pool_state, opts \\ []) do
    with {:ok, db_path} <- db_path(pool_state),
         {:ok, conn} <- open_with_recovery(db_path, pool_state, opts, @max_recovery_attempts) do
      configure_db(conn, pool_state)
    end
  end

  defp open_with_recovery(db_path, _pool_state, _opts, 0) do
    Logger.error("Unable to create database at #{db_path}")
    {:error, "failed to open #{db_path}"}
  end

  defp open_with_recovery(db_path, pool_state, opts, attempts_remaining) do
    case Sqlite3.open(db_path, open_opts(pool_state)) do
      {:ok, conn} ->
        if Keyword.get(opts, :integrity_check, false) do
          case integrity_check(conn) do
            :ok ->
              {:ok, conn}

            {:error, reason} ->
              Logger.warning("Database file corrupt #{db_path}: #{inspect(reason)}")

              close(conn)

              with :ok <- delete_corrupt_db(db_path) do
                open_with_recovery(db_path, pool_state, opts, attempts_remaining - 1)
              end
          end
        else
          {:ok, conn}
        end

      {:error, reason} ->
        Logger.warning("Failed to open db #{db_path}: #{inspect(reason)}")

        with :ok <- delete_corrupt_db(db_path) do
          open_with_recovery(db_path, pool_state, opts, attempts_remaining - 1)
        end
    end
  end

  defp delete_corrupt_db(db_path) do
    with dir = Path.dirname(db_path),
         {:ok, _} <- File.rm_rf(dir),
         :ok <- File.mkdir_p(dir) do
      :ok
    end
  end

  defp open_opts(pool_state) do
    case Keyword.get(pool_state, :mode, :readwrite) do
      :read ->
        # nomutex is safe because we're enforcing use by a single "thread" via the pool
        #
        # see: https://sqlite.org/threadsafe.html
        #
        # > The SQLITE_OPEN_NOMUTEX flag causes the database connection to be in the multi-thread mode
        #
        # > Multi-thread. In this mode, SQLite can be safely used by multiple
        # > threads provided that no single database connection nor any object
        # > derived from database connection, such as a prepared statement, is
        # > used in two or more threads at the same time.
        [mode: [:readonly, :nomutex]]

      _ ->
        []
    end
  end

  def close(conn) when is_raw_connection(conn) do
    Sqlite3.close(conn)
  end

  def checkout!(stack_id, label, function, timeout \\ 10_000) do
    NimblePool.checkout!(
      PoolRegistry.pool_name(stack_id, :read),
      {:checkout, label},
      fn _from, conn -> {function.(conn), conn} end,
      timeout
    )
  end

  def checkout_write!(stack_id, label, function, timeout \\ 10_000) do
    NimblePool.checkout!(
      PoolRegistry.pool_name(stack_id, :write),
      {:checkout, label},
      fn _from, conn ->
        {
          transaction(conn, fn -> function.(conn) end),
          conn
        }
      end,
      timeout
    )
  end

  def fetch_one(conn, sql, binds) when is_raw_connection(conn) and is_binary(sql) do
    with {:ok, stmt} <- Sqlite3.prepare(conn, sql),
         {:ok, row} <- fetch_one(conn, stmt, binds),
         :ok <- Sqlite3.release(conn, stmt) do
      {:ok, row}
    end
  end

  def fetch_one(conn, stmt, binds) when is_raw_connection(conn) and is_reference(stmt) do
    with :ok <- Sqlite3.bind(stmt, binds) do
      case Sqlite3.step(conn, stmt) do
        {:row, row} ->
          with :done <- Sqlite3.step(conn, stmt),
               :ok <- Sqlite3.reset(stmt) do
            {:ok, row}
          end

        :done ->
          :ok = Sqlite3.reset(stmt)
          :error

        error ->
          :ok = Sqlite3.reset(stmt)
          error
      end
    end
  end

  def fetch_all(conn, sql, binds) when is_raw_connection(conn) and is_binary(sql) do
    with {:ok, stmt} <- Sqlite3.prepare(conn, sql),
         {:ok, rows} <- fetch_all(conn, stmt, binds),
         :ok <- Sqlite3.release(conn, stmt) do
      {:ok, rows}
    end
  end

  def fetch_all(conn, stmt, binds) when is_raw_connection(conn) and is_reference(stmt) do
    with :ok <- Sqlite3.bind(stmt, binds),
         {:ok, rows} <- Sqlite3.fetch_all(conn, stmt),
         :ok <- Sqlite3.reset(stmt) do
      {:ok, rows}
    end
  end

  def fetch_all(conn, sql, binds, mapper_fun) when is_raw_connection(conn) and is_binary(sql) do
    with {:ok, rows} <- fetch_all(conn, sql, binds) do
      {:ok, Enum.map(rows, mapper_fun)}
    end
  end

  def fetch_all(conn, stmt, binds, mapper_fun)
      when is_raw_connection(conn) and is_reference(stmt) do
    with {:ok, rows} <- fetch_all(conn, stmt, binds) do
      {:ok, Enum.map(rows, mapper_fun)}
    end
  end

  def modify(conn, stmt, binds) when is_raw_connection(conn) and is_reference(stmt) do
    with :ok <- Sqlite3.bind(stmt, binds),
         :done <- Sqlite3.step(conn, stmt),
         {:ok, changes} <- Sqlite3.changes(conn),
         :ok <- Sqlite3.reset(stmt) do
      {:ok, changes}
    end
  end

  defp db_version(conn) do
    with {:ok, [version]} <- fetch_one(conn, "PRAGMA user_version", []) do
      {:ok, version}
    end
  end

  defp configure_db(conn, pool_state) do
    with :ok <- execute_all(conn, pragmas(pool_state)) do
      {:ok, conn}
    end
  end

  @pragma_defaults [
    # for our current deployment mode synchronous = OFF is enough (hand
    # data to kernel, don't fsync) but for oss deploys we should keep it at a
    # higher durability setting
    synchronous: "OFF",
    # Default to a beefy page cache size because we want decent read performance
    # Multiplied by 1024, because SQLite works in KiB but we configure in bytes.
    cache_size: 4096 * 1024
  ]

  def default!(pragma) do
    Keyword.fetch!(@pragma_defaults, pragma)
  end

  def defaults do
    @pragma_defaults
  end

  defp pragmas(pool_state) do
    [
      "PRAGMA synchronous=#{pragma_value(pool_state, :synchronous)}",
      # Divide by 1024 because we configure in bytes but SQLite works in KiB
      "PRAGMA cache_size=-#{div(pragma_value(pool_state, :cache_size), 1024)}"
    ]
  end

  defp pragma_value(opts, pragma) do
    Keyword.get(opts, pragma, default!(pragma))
  end

  def execute(conn, sql) when is_raw_connection(conn) and is_binary(sql) do
    Sqlite3.execute(conn, sql)
  end

  def execute_all(conn, sqls) when is_raw_connection(conn) and is_list(sqls) do
    with {:ok, _conn} <-
           Electric.Utils.reduce_while_ok(sqls, conn, fn sql, conn ->
             with :ok <- Sqlite3.execute(conn, sql) do
               {:ok, conn}
             end
           end) do
      :ok
    end
  end

  defp transaction(%__MODULE__{conn: conn}, fun) when is_function(fun, 0) do
    try do
      :ok = execute(conn, "BEGIN IMMEDIATE TRANSACTION")

      {result, commit} =
        case fun.() do
          :ok -> {:ok, true}
          {:ok, _} = result -> {result, true}
          error -> {error, false}
        end

      if commit,
        do: :ok = execute(conn, "COMMIT"),
        else: :ok = execute(conn, "ROLLBACK")

      result
    rescue
      e ->
        :ok = execute(conn, "ROLLBACK")
        reraise e, __STACKTRACE__
    end
  end

  def stream_query(conn, stmt, row_mapper_fun)
      when is_raw_connection(conn) and is_reference(stmt) do
    Stream.resource(
      fn -> {:cont, conn, stmt} end,
      fn
        {:halt, conn, stmt} ->
          {:halt, {conn, stmt}}

        {:cont, conn, stmt} ->
          case Sqlite3.multi_step(conn, stmt) do
            {:rows, rows} ->
              {Stream.map(rows, row_mapper_fun), {:cont, conn, stmt}}

            {:done, []} ->
              {[], {:halt, conn, stmt}}

            {:done, rows} ->
              {Stream.map(rows, row_mapper_fun), {:halt, conn, stmt}}

            {:error, reason} ->
              raise RuntimeError, message: "reduce_shapes failed with error: #{inspect(reason)}"
          end
      end,
      fn {_conn, stmt} -> Sqlite3.reset(stmt) end
    )
  end

  def explain(stack_id) do
    checkout!(stack_id, :explain, fn %__MODULE__{} = conn ->
      Query.explain(conn, :read)
    end)

    checkout_write!(stack_id, :explain, fn %__MODULE__{} = conn ->
      Query.explain(conn, :write)
    end)
  end

  # used in testing
  def db_path(pool_state) do
    # Manage compatibility by embedding all versions into the db name rather
    # than embed the values in the db itself and then have to manage schema
    # resets or migrations.
    # `System.otp_release()` is included because `:erlang.term_to_binary/2` has
    # limited guarantees about compatibilities between major versions of the
    # BEAM and its safer to just ignore data from a different release than
    # handle that.
    # Not sure of the format of `System.otp_release/0` - it may only ever
    # return the major version, i.e. `"28"`, but just to be sure let's
    # ignore everything that may come after the first numbers.
    [otp_version | _] = String.split(System.otp_release(), ~r/[^0-9]/)

    version =
      "v#{Electric.ShapeCache.ShapeStatus.version()}_#{@schema_version}@otp-#{otp_version}"

    with {:ok, storage_dir} <- Keyword.fetch(pool_state, :storage_dir) do
      case storage_dir do
        ":memory:" ->
          if Keyword.get(pool_state, :exclusive_mode, false) do
            Logger.notice("ShapeDb using in-memory database")
            {:ok, ":memory:"}
          else
            Logger.error(
              "Enable exclusive_mode (ELECTRIC_SHAPE_DB_EXCLUSIVE_MODE=true) to use an in-memory database"
            )

            {:error, "Cannot use :memory: database without exclusive_mode"}
          end

        storage_dir ->
          path = Path.join(storage_dir, "meta/shape-db/#{version}.sqlite")

          with :ok <- File.mkdir_p(Path.dirname(path)) do
            if Keyword.get(pool_state, :mode) == :write do
              Logger.notice("Shape database file: #{inspect(path)}")
            end

            {:ok, path}
          end
      end
    end
  end

  defp now, do: System.monotonic_time()
end
