defmodule Electric.ShapeCache.ShapeStatus.ShapeDb.Connection do
  @moduledoc false

  alias Exqlite.Sqlite3

  require Logger

  @behaviour NimblePool

  @schema_version 2

  @migration_sqls [
    """
    CREATE TABLE shapes (
      handle BLOB NOT NULL,
      shape BLOB NOT NULL,
      comparable BLOB NOT NULL,
      hash INTEGER NOT NULL,
      snapshot_state INTEGER NOT NULL DEFAULT 0
    ) STRICT
    """,
    """
    CREATE UNIQUE INDEX shapes_comparable_idx ON shapes (comparable, handle)
    """,
    """
    CREATE UNIQUE INDEX shapes_handle_idx ON shapes (handle, shape, hash, snapshot_state)
    """,
    """
    CREATE INDEX shapes_snapshot_idx ON shapes (snapshot_state, handle)
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
    CREATE INDEX shape_count_idx ON shape_count (id, count)
    """,
    """
    INSERT INTO shape_count (id, count) VALUES (1, 0)
    """,
    "PRAGMA journal_mode=WAL",
    "PRAGMA user_version=#{@schema_version}"
  ]

  @stmt_sqls [
    list_shapes: """
    SELECT handle, shape FROM shapes ORDER BY handle
    """,
    list_handles: """
    SELECT handle FROM shapes ORDER BY handle
    """,
    handle_exists: """
    SELECT 1 FROM shapes WHERE handle = ?1
    """,
    handle_lookup: """
    SELECT handle FROM shapes WHERE comparable = ?1 LIMIT 1
    """,
    shape_lookup: """
    SELECT shape FROM shapes WHERE handle = ?1 LIMIT 1
    """,
    hash_lookup: """
    SELECT hash FROM shapes WHERE handle = ?1 LIMIT 1
    """,
    relation_handle_lookup: """
    SELECT handle FROM relations WHERE oid = ?1 LIMIT 1
    """,
    insert_shape: """
    INSERT INTO shapes (handle, shape, comparable, hash) VALUES (?1, ?2, ?3, ?4)
    """,
    insert_relation: """
    INSERT INTO relations (handle, oid) VALUES (?1, ?2)
    """,
    increment_counter: """
    UPDATE shape_count SET count = count + ?1 WHERE id = 1
    """,
    delete_shape: """
    DELETE FROM shapes WHERE handle = ?1
    """,
    delete_relation: """
    DELETE FROM relations WHERE handle = ?1
    """,
    shape_count: """
    SELECT count FROM shape_count WHERE id = 1 LIMIT 1
    """,
    mark_snapshot_started: """
    UPDATE shapes SET snapshot_state = snapshot_state | 1 WHERE handle = ?1
    """,
    mark_snapshot_complete: """
    UPDATE shapes SET snapshot_state = 3 WHERE handle = ?1
    """,
    snapshot_state: """
    SELECT snapshot_state FROM shapes WHERE handle = ?1 LIMIT 1
    """,
    # snapshot state is a bitmask to handle the snapshot completion message arriving before the
    # snapshot start event for small snapshots (since the snapshot start message goes through
    # more indirection via the consumer process)
    # snapshot_state &&& 1: snapshot started
    # snapshot_state &&& 2: snapshot completed
    select_invalid: """
    SELECT handle FROM shapes WHERE snapshot_state IN (0, 1) ORDER BY handle
    """
  ]

  @stmts Keyword.keys(@stmt_sqls)

  defguardp is_raw_connection(conn) when is_reference(conn)

  defstruct [:conn | @stmts]

  def pool_name(stack_id, role) when role in [:read, :write] do
    Electric.ProcessRegistry.name(stack_id, __MODULE__, role)
  end

  def migrate(conn) when is_raw_connection(conn) do
    # because we embed the storage version into the db path
    # we can only ever get 0 for un-migrated or the current storage
    # version.
    case db_version(conn) do
      # not been initialized
      {:ok, 0} ->
        Logger.info("Migrating shape db to version #{@schema_version}")

        with :ok <- execute_all(conn, @migration_sqls) do
          {:ok, @schema_version}
        end

      {:ok, @schema_version} ->
        Logger.info("Found existing valid shape db")
        {:ok, @schema_version}
    end
  end

  def optimize(conn) when is_raw_connection(conn) do
    execute_all(conn, ["PRAGMA optimize=0x10002"])
  end

  @impl NimblePool
  def init_worker(pool_state) do
    with {:ok, conn} <- open(pool_state),
         {:ok, state} <- prepare_stmts(conn) do
      {:ok, state, pool_state}
    end
  end

  @impl NimblePool
  def handle_enqueue(:checkout, pool_state) do
    {:ok, {:checkout, now()}, pool_state}
  end

  @impl NimblePool
  def handle_checkout(cmd, _from, conn, pool_state) do
    case cmd do
      {:checkout, enqueued_at} ->
        # TODO: drop this enqueued_duration into the metrics
        _enqueued_duration_ms =
          System.convert_time_unit(now() - enqueued_at, :native, :millisecond)

        :ok

      :checkout ->
        :ok
    end

    {:ok, conn, conn, pool_state}
  end

  @impl NimblePool
  def handle_checkin(client_state, _from, _worker_state, pool_state) do
    {:ok, client_state, pool_state}
  end

  defp prepare_stmts(conn) do
    Enum.reduce_while(@stmt_sqls, {:ok, %__MODULE__{conn: conn}}, fn {name, sql}, {:ok, stmts} ->
      case Sqlite3.prepare(conn, sql) do
        {:ok, stmt} ->
          {:cont, {:ok, Map.put(stmts, name, stmt)}}

        {:error, _reason} = error ->
          {:halt, error}
      end
    end)
  end

  @pragmas [
    # for our current deployment mode synchronous = OFF would be enough (hand
    # data to kernel, don't fsync) but for oss deploys we should keep it at a
    # higher durability setting
    "PRAGMA synchronous=NORMAL"
    # "PRAGMA optimize=0x10002"
  ]

  def open(pool_state) do
    with {:ok, db_path} <- db_path(pool_state),
         {:ok, conn} <- Sqlite3.open(db_path, open_opts(pool_state)) do
      configure_db(conn)
    end
  end

  defp open_opts(pool_state) do
    if Keyword.get(pool_state, :readonly, false) do
      [mode: [:readonly, :nomutex]]
    else
      []
    end
  end

  def checkout!(stack_id, function, timeout \\ 5000) do
    NimblePool.checkout!(
      pool_name(stack_id, :read),
      :checkout,
      fn _from, conn -> {function.(conn), conn} end,
      timeout
    )
  end

  def checkout_write!(stack_id, function, timeout \\ 5000) do
    NimblePool.checkout!(
      pool_name(stack_id, :write),
      :checkout,
      fn _from, conn -> {function.(conn), conn} end,
      timeout
    )
  end

  def fetch_one(%__MODULE__{conn: conn}, sql_or_stmt, binds) do
    fetch_one(conn, sql_or_stmt, binds)
  end

  def fetch_one(conn, sql, binds) when is_binary(sql) do
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
          :done = Sqlite3.step(conn, stmt)
          :ok = Sqlite3.reset(stmt)

          {:ok, row}

        :done ->
          :ok = Sqlite3.reset(stmt)
          :error

        error ->
          :ok = Sqlite3.reset(stmt)
          error
      end
    end
  end

  def fetch_all(%__MODULE__{conn: conn}, sql_or_stmt, binds) do
    fetch_all(conn, sql_or_stmt, binds)
  end

  def fetch_all(conn, sql, binds) when is_raw_connection(conn) and is_binary(sql) do
    with {:ok, stmt} <- Sqlite3.prepare(conn, sql),
         {:ok, rows} <- fetch_all(conn, stmt, binds),
         :ok <- Sqlite3.release(conn, stmt) do
      {:ok, rows}
    end
  end

  def fetch_all(conn, stmt, binds) when is_reference(stmt) do
    with :ok <- Sqlite3.bind(stmt, binds),
         {:ok, rows} <- Sqlite3.fetch_all(conn, stmt),
         :ok <- Sqlite3.reset(stmt) do
      {:ok, rows}
    end
  end

  def fetch_all(%__MODULE__{conn: conn}, sql_or_stmt, binds, mapper_fun) do
    fetch_all(conn, sql_or_stmt, binds, mapper_fun)
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

  def modify(%__MODULE__{conn: conn}, stmt, binds) when is_reference(stmt) do
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

  defp configure_db(conn) do
    with :ok <- execute_all(conn, @pragmas) do
      {:ok, conn}
    end
  end

  def execute(%__MODULE__{conn: conn}, sql) do
    execute(conn, sql)
  end

  def execute(conn, sql) when is_raw_connection(conn) and is_binary(sql) do
    Sqlite3.execute(conn, sql)
  end

  def execute_all(%__MODULE__{conn: conn}, sqls) do
    execute_all(conn, sqls)
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

  def transaction(%__MODULE__{conn: conn}, fun) when is_function(fun, 0) do
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

  def stream_query(%__MODULE__{conn: conn}, stmt, row_mapper_fun) do
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
    checkout!(stack_id, fn %__MODULE__{} = conn ->
      for {name, sql} <- @stmt_sqls, String.starts_with?(sql, "SELECT") do
        binds =
          Stream.repeatedly(fn -> "" end)
          |> Enum.take(Sqlite3.bind_parameter_count(Map.fetch!(conn, name)))

        with {:ok, rows} <- fetch_all(conn, "EXPLAIN QUERY PLAN " <> sql, binds) do
          plan =
            rows
            |> Enum.map(fn [_, _, _, s] -> s end)
            |> Enum.map(fn plan ->
              colour =
                cond do
                  String.contains?(plan, "USING COVERING INDEX") -> :green
                  String.contains?(plan, "USING INDEX") -> :cyan
                  true -> :red
                end

              [:bright, colour, plan, :reset]
            end)

          IO.puts(
            IO.ANSI.format([
              [:bright, "#{name}", :reset],
              ": [#{String.trim_trailing(sql)}] ",
              plan |> Enum.intersperse(",")
            ])
          )
        end
      end
    end)
  end

  defp db_path(pool_state) do
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

    with {:ok, storage_dir} <- Keyword.fetch(pool_state, :storage_dir),
         path = Path.join(storage_dir, "meta/shape-db/#{version}.sqlite"),
         :ok <- File.mkdir_p(Path.dirname(path)) do
      {:ok, path}
    end
  end

  defp now, do: System.monotonic_time()
end
