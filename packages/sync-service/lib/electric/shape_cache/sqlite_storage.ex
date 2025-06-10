defmodule Electric.ShapeCache.SqliteStorage do
  @moduledoc """
  SQLite-based storage implementation for Electric shape cache.

  This storage backend uses SQLite for persisting shape data, log entries,
  and metadata. It supports concurrent reads but assumes a single writer.

  Key design decisions:
  - NOT a GenServer - uses direct SQLite connections for fast writes
  - Uses prepared statements for bulk operations during snapshots
  - Stores LogOffset as separate tx_offset/op_offset columns for efficient indexing
  - Maintains chunk boundaries for efficient streaming
  """

  alias Electric.ShapeCache.Storage
  alias Electric.Shapes.Shape
  alias Electric.Replication.LogOffset
  alias Electric.Telemetry.OpenTelemetry

  require Logger
  import Electric.Replication.LogOffset, only: :macros

  @behaviour Electric.ShapeCache.Storage

  # Storage format version - increment when schema changes
  @version 1
  @version_key "version"
  @pg_snapshot_key "pg_snapshot"
  @snapshot_started_key "snapshot_started"
  @snapshot_meta_key "snapshot_meta"

  defstruct [
    :db_path,
    :db_conn,
    :data_dir,
    :shape_handle,
    :stack_id,
    version: @version
  ]

  @impl Electric.ShapeCache.Storage
  def shared_opts(opts) do
    stack_id = Keyword.fetch!(opts, :stack_id)
    storage_dir = Keyword.get(opts, :storage_dir, "./shapes")

    %{
      base_path: Path.join(storage_dir, stack_id),
      stack_id: stack_id
    }
  end

  @impl Electric.ShapeCache.Storage
  def for_shape(shape_handle, %__MODULE__{shape_handle: shape_handle} = opts) do
    opts
  end

  def for_shape(shape_handle, %{base_path: base_path, stack_id: stack_id}) do
    shape_dir = Path.join([base_path, shape_handle])
    db_path = Path.join([shape_dir, "shape.sqlite"])

    # Ensure directory exists
    File.mkdir_p!(shape_dir)

    # Open database connection
    {:ok, conn} = Exqlite.Sqlite3.open(db_path)

    opts = %__MODULE__{
      db_path: db_path,
      db_conn: conn,
      shape_handle: shape_handle,
      stack_id: stack_id,
      data_dir: shape_dir
    }

    # Create tables immediately when connection is established
    create_tables(opts)

    opts
  end

  @impl Electric.ShapeCache.Storage
  def start_link(_opts) do
    # This storage is NOT a GenServer, but the test framework expects a pid
    # So we spawn a dummy process that does nothing but can be killed in tests
    pid = spawn(fn -> Process.sleep(:infinity) end)
    {:ok, pid}
  end

  @impl Electric.ShapeCache.Storage
  def initialise(%__MODULE__{} = opts) do
    stored_version = get_metadata(opts, @version_key)

    if stored_version != opts.version or
         is_nil(get_metadata(opts, @pg_snapshot_key)) or
         not shape_definition_exists?(opts) or
         is_nil(get_metadata(opts, @snapshot_meta_key)) do
      cleanup_internals!(opts)
    end

    set_metadata(opts, @version_key, opts.version)
    :ok
  end

  @impl Electric.ShapeCache.Storage
  def set_shape_definition(%Shape{} = shape, %__MODULE__{} = opts) do
    shape_json = Jason.encode!(shape)

    sql = "INSERT OR REPLACE INTO shape_definition (definition_json) VALUES (?1)"
    {:ok, statement} = Exqlite.Sqlite3.prepare(opts.db_conn, sql)
    :ok = Exqlite.Sqlite3.bind(statement, [shape_json])
    :done = Exqlite.Sqlite3.step(opts.db_conn, statement)
    :ok = Exqlite.Sqlite3.release(opts.db_conn, statement)

    :ok
  end

  @impl Electric.ShapeCache.Storage
  def get_all_stored_shapes(%{base_path: base_path} = _opts) do
    case File.ls(base_path) do
      {:ok, shape_handles} ->
        shapes =
          Enum.reduce(shape_handles, %{}, fn shape_handle, acc ->
            shape_dir = Path.join([base_path, shape_handle])
            db_path = Path.join([shape_dir, "shape.sqlite"])

            if File.exists?(db_path) do
              case get_shape_definition_from_file(db_path) do
                {:ok, shape} -> Map.put(acc, shape_handle, shape)
                _ -> acc
              end
            else
              acc
            end
          end)

        {:ok, shapes}

      {:error, :enoent} ->
        {:ok, %{}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  @impl Electric.ShapeCache.Storage
  def get_total_disk_usage(%{base_path: base_path} = _opts) do
    case File.ls(base_path) do
      {:ok, shape_handles} ->
        shape_handles
        |> Enum.map(fn shape_handle ->
          shape_dir = Path.join([base_path, shape_handle])
          get_directory_size(shape_dir)
        end)
        |> Enum.sum()

      _ ->
        0
    end
  end

  @impl Electric.ShapeCache.Storage
  def get_current_position(%__MODULE__{} = opts) do
    latest_offset = get_latest_offset(opts)
    pg_snapshot = get_metadata(opts, @pg_snapshot_key)
    {:ok, latest_offset, pg_snapshot}
  end

  @impl Electric.ShapeCache.Storage
  def set_pg_snapshot(pg_snapshot, %__MODULE__{} = opts) do
    set_metadata(opts, @pg_snapshot_key, pg_snapshot)
  end

  @impl Electric.ShapeCache.Storage
  def snapshot_started?(%__MODULE__{} = opts) do
    case get_metadata(opts, @snapshot_started_key) do
      nil -> false
      _ -> true
    end
  end

  @impl Electric.ShapeCache.Storage
  def mark_snapshot_as_started(%__MODULE__{} = opts) do
    set_metadata(opts, @snapshot_started_key, true)
  end

  @impl Electric.ShapeCache.Storage
  def make_new_snapshot!(data_stream, %__MODULE__{stack_id: stack_id} = opts) do
    OpenTelemetry.with_span(
      "storage.make_new_snapshot",
      [storage_impl: "sqlite", "shape.handle": opts.shape_handle],
      stack_id,
      fn ->
        last_chunk_num = write_snapshot_stream(data_stream, opts)
        set_metadata(opts, @snapshot_meta_key, LogOffset.new(0, last_chunk_num))
      end
    )
  end

  @impl Electric.ShapeCache.Storage
  def append_to_log!(log_items, %__MODULE__{} = opts) do
    insert_log_items_sql = """
    INSERT OR IGNORE INTO log_entries
    (tx_offset, op_offset, row_key, operation_type, json_data)
    VALUES (?1, ?2, ?3, ?4, ?5)
    """

    insert_chunk_boundary_sql = """
    INSERT OR IGNORE INTO chunk_boundaries (tx_offset, op_offset)
    VALUES (?1, ?2)
    """

    {:ok, log_stmt} = Exqlite.Sqlite3.prepare(opts.db_conn, insert_log_items_sql)
    {:ok, chunk_stmt} = Exqlite.Sqlite3.prepare(opts.db_conn, insert_chunk_boundary_sql)

    try do
      :ok = Exqlite.Sqlite3.execute(opts.db_conn, "BEGIN TRANSACTION")

      Enum.each(log_items, fn
        {:chunk_boundary, %LogOffset{tx_offset: tx, op_offset: op}} ->
          :ok = Exqlite.Sqlite3.bind(chunk_stmt, [tx, op])
          :done = Exqlite.Sqlite3.step(opts.db_conn, chunk_stmt)

        {%LogOffset{tx_offset: tx, op_offset: op}, key, op_type, json_log_item} ->
          :ok =
            Exqlite.Sqlite3.bind(log_stmt, [
              tx,
              op,
              key,
              Atom.to_string(op_type),
              {:blob, json_log_item}
            ])

          :done = Exqlite.Sqlite3.step(opts.db_conn, log_stmt)
      end)

      :ok = Exqlite.Sqlite3.execute(opts.db_conn, "COMMIT")
    rescue
      error ->
        :ok = Exqlite.Sqlite3.execute(opts.db_conn, "ROLLBACK")
        raise error
    after
      :ok = Exqlite.Sqlite3.release(opts.db_conn, log_stmt)
      :ok = Exqlite.Sqlite3.release(opts.db_conn, chunk_stmt)
    end

    :ok
  end

  @impl Electric.ShapeCache.Storage
  def get_log_stream(
        %LogOffset{tx_offset: tx_offset, op_offset: op_offset} = offset,
        max_offset,
        %__MODULE__{} = opts
      )
      when tx_offset <= 0 do
    if not snapshot_started?(opts), do: raise(Storage.Error, message: "Snapshot not started")

    case {get_metadata(opts, @snapshot_meta_key), offset} do
      # Snapshot is complete, stream from beginning
      {%LogOffset{}, offset} when is_min_offset(offset) ->
        stream_snapshot_chunk(opts, 0)

      # Snapshot is complete, stream next chunk
      {%LogOffset{} = latest, offset} when is_log_offset_lt(offset, latest) ->
        stream_snapshot_chunk(opts, op_offset + 1)

      # Snapshot is complete, stream from transaction log
      {%LogOffset{}, offset} ->
        stream_log_chunk(offset, max_offset, opts)

      # Snapshot incomplete, stream current chunk
      {nil, offset} when is_min_offset(offset) ->
        stream_snapshot_chunk(opts, 0)

      # Snapshot incomplete, try next chunk or wait
      {nil, _offset} ->
        # Wait for more data to be written to the snapshot
        wait_for_snapshot_data(opts, op_offset + 1)
    end
  end

  # Any offsets with tx_offset > 0 are transaction log entries
  def get_log_stream(%LogOffset{} = offset, max_offset, %__MODULE__{} = opts) do
    stream_log_chunk(offset, max_offset, opts)
  end

  @impl Electric.ShapeCache.Storage
  def get_chunk_end_log_offset(offset, _) when is_min_offset(offset) do
    LogOffset.new(0, 0)
  end

  def get_chunk_end_log_offset(
        %LogOffset{tx_offset: 0, op_offset: _op_offset} = offset,
        %__MODULE__{} = opts
      ) do
    case get_metadata(opts, @snapshot_meta_key) do
      nil ->
        LogOffset.increment(offset)

      last when is_log_offset_lt(offset, last) ->
        LogOffset.increment(offset)

      _ ->
        get_chunk_end_for_log(offset, opts)
    end
  end

  def get_chunk_end_log_offset(offset, %__MODULE__{} = opts) do
    get_chunk_end_for_log(offset, opts)
  end

  @impl Electric.ShapeCache.Storage
  def cleanup!(%__MODULE__{} = opts) do
    cleanup_internals!(opts)
  end

  @impl Electric.ShapeCache.Storage
  def unsafe_cleanup!(%__MODULE__{} = opts) do
    # Close the connection first
    if opts.db_conn do
      Exqlite.Sqlite3.close(opts.db_conn)
    end

    # Remove the entire shape directory
    shape_dir = Path.dirname(opts.db_path)

    case File.rm_rf(shape_dir) do
      {:ok, _} ->
        :ok

      {:error, reason, path} ->
        raise File.Error,
          reason: reason,
          path: path,
          action: "remove files and directories recursively from"
    end
  end

  # Compact functions - not implemented yet
  def compact(%__MODULE__{} = _opts) do
    raise "Compaction not yet implemented for SQLite storage"
  end

  def compact(%__MODULE__{} = _opts, _offset) do
    raise "Compaction not yet implemented for SQLite storage"
  end

  # Private helper functions

  defp create_tables(%__MODULE__{} = opts) do
    tables = [
      """
      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value BLOB
      ) STRICT
      """,
      """
      CREATE TABLE IF NOT EXISTS log_entries (
        tx_offset INTEGER,
        op_offset INTEGER,
        row_key TEXT,
        operation_type TEXT,
        json_data BLOB,
        PRIMARY KEY (tx_offset, op_offset)
      ) STRICT
      """,
      """
      CREATE INDEX IF NOT EXISTS idx_log_entries_row_key
      ON log_entries(row_key)
      """,
      """
      CREATE TABLE IF NOT EXISTS chunk_boundaries (
        tx_offset INTEGER,
        op_offset INTEGER,
        PRIMARY KEY (tx_offset, op_offset)
      ) STRICT
      """,
      """
      CREATE TABLE IF NOT EXISTS shape_definition (
        definition_json TEXT
      ) STRICT
      """
    ]

    Enum.each(tables, fn sql ->
      :ok = Exqlite.Sqlite3.execute(opts.db_conn, sql)
    end)
  end

  defp get_metadata(%__MODULE__{} = opts, key) do
    sql = "SELECT value FROM metadata WHERE key = ?1"
    {:ok, statement} = Exqlite.Sqlite3.prepare(opts.db_conn, sql)
    :ok = Exqlite.Sqlite3.bind(statement, [key])

    result =
      case Exqlite.Sqlite3.step(opts.db_conn, statement) do
        {:row, [value]} -> :erlang.binary_to_term(value)
        :done -> nil
      end

    :ok = Exqlite.Sqlite3.release(opts.db_conn, statement)
    result
  end

  defp set_metadata(%__MODULE__{} = opts, key, value) do
    encoded_value = :erlang.term_to_binary(value)

    sql = "INSERT OR REPLACE INTO metadata (key, value) VALUES (?1, ?2)"
    {:ok, statement} = Exqlite.Sqlite3.prepare(opts.db_conn, sql)
    :ok = Exqlite.Sqlite3.bind(statement, [key, {:blob, encoded_value}])
    :done = Exqlite.Sqlite3.step(opts.db_conn, statement)
    :ok = Exqlite.Sqlite3.release(opts.db_conn, statement)

    :ok
  end

  defp shape_definition_exists?(%__MODULE__{} = opts) do
    sql = "SELECT COUNT(*) FROM shape_definition"
    {:ok, statement} = Exqlite.Sqlite3.prepare(opts.db_conn, sql)

    result =
      case Exqlite.Sqlite3.step(opts.db_conn, statement) do
        {:row, [count]} -> count > 0
        :done -> false
      end

    :ok = Exqlite.Sqlite3.release(opts.db_conn, statement)
    result
  end

  defp get_shape_definition_from_file(db_path) do
    case Exqlite.Sqlite3.open(db_path) do
      {:ok, conn} ->
        sql = "SELECT definition_json FROM shape_definition LIMIT 1"

        result =
          case Exqlite.Sqlite3.prepare(conn, sql) do
            {:ok, statement} ->
              case Exqlite.Sqlite3.step(conn, statement) do
                {:row, [json]} ->
                  case Jason.decode(json) do
                    {:ok, shape_data} -> Electric.Shapes.Shape.from_json_safe(shape_data)
                    error -> error
                  end

                :done ->
                  {:error, :not_found}
              end
              |> tap(fn _ -> Exqlite.Sqlite3.release(conn, statement) end)

            error ->
              error
          end

        Exqlite.Sqlite3.close(conn)
        result

      error ->
        error
    end
  end

  defp get_latest_offset(%__MODULE__{} = opts) do
    # First try to get latest from transaction log
    case get_latest_txn_log_offset(opts) do
      nil ->
        # Then try snapshot
        case get_metadata(opts, @snapshot_meta_key) do
          nil -> LogOffset.last_before_real_offsets()
          offset -> offset
        end

      offset ->
        offset
    end
  end

  defp get_latest_txn_log_offset(%__MODULE__{} = opts) do
    sql = """
    SELECT tx_offset, op_offset FROM log_entries
    WHERE tx_offset > 0
    ORDER BY tx_offset DESC, op_offset DESC
    LIMIT 1
    """

    {:ok, statement} = Exqlite.Sqlite3.prepare(opts.db_conn, sql)

    result =
      case Exqlite.Sqlite3.step(opts.db_conn, statement) do
        {:row, [tx_offset, op_offset]} -> LogOffset.new(tx_offset, op_offset)
        :done -> nil
      end

    :ok = Exqlite.Sqlite3.release(opts.db_conn, statement)
    result
  end

  defp write_snapshot_stream(data_stream, %__MODULE__{} = opts) do
    sql_insert_log_entry = """
    INSERT INTO log_entries
    (tx_offset, op_offset, row_key, operation_type, json_data)
    VALUES (0, ?1, ?2, ?3, ?4)
    """

    sql_insert_chunk_boundary = """
    INSERT INTO chunk_boundaries
    (tx_offset, op_offset)
    VALUES (0, ?1)
    """

    {:ok, log_entry_stmt} = Exqlite.Sqlite3.prepare(opts.db_conn, sql_insert_log_entry)
    {:ok, chunk_stmt} = Exqlite.Sqlite3.prepare(opts.db_conn, sql_insert_chunk_boundary)

    try do
      :ok = Exqlite.Sqlite3.execute(opts.db_conn, "BEGIN IMMEDIATE")

      {last_chunk_num, _} =
        Enum.reduce(data_stream, {0, 0}, fn
          :chunk_boundary, {chunk_num, op_offset} ->
            # Record chunk boundary at current op_offset
            :ok = Exqlite.Sqlite3.bind(chunk_stmt, [op_offset])
            :done = Exqlite.Sqlite3.step(opts.db_conn, chunk_stmt)
            {chunk_num + 1, op_offset}

          json_line, {chunk_num, op_offset} ->
            :ok =
              Exqlite.Sqlite3.bind(log_entry_stmt, [
                op_offset,
                "__snapshot",
                "insert",
                {:blob, json_line}
              ])

            :done = Exqlite.Sqlite3.step(opts.db_conn, log_entry_stmt)
            {chunk_num, op_offset + 1}
        end)

      :ok = Exqlite.Sqlite3.execute(opts.db_conn, "COMMIT")
      last_chunk_num
    rescue
      error ->
        :ok = Exqlite.Sqlite3.execute(opts.db_conn, "ROLLBACK")
        raise error
    after
      :ok = Exqlite.Sqlite3.release(opts.db_conn, chunk_stmt)
      :ok = Exqlite.Sqlite3.release(opts.db_conn, log_entry_stmt)
    end
  end

  defp stream_snapshot_chunk(%__MODULE__{} = opts, chunk_num) do
    # Get the start and end offsets for this chunk
    {start_offset, end_offset} = get_chunk_boundaries(opts, chunk_num)

    sql = """
    SELECT json_data FROM log_entries
    WHERE tx_offset = 0 AND op_offset >= ?1 AND op_offset < ?2
    ORDER BY op_offset
    """

    {:ok, statement} = Exqlite.Sqlite3.prepare(opts.db_conn, sql)
    :ok = Exqlite.Sqlite3.bind(statement, [start_offset, end_offset])

    Stream.resource(
      fn -> statement end,
      fn statement ->
        case Exqlite.Sqlite3.step(opts.db_conn, statement) do
          {:row, [json_data]} -> {[json_data], statement}
          :done -> {:halt, statement}
        end
      end,
      fn statement -> Exqlite.Sqlite3.release(opts.db_conn, statement) end
    )
  end

  defp get_chunk_boundaries(%__MODULE__{} = opts, chunk_num) do
    # For chunk 0, start at 0
    start_offset = if chunk_num == 0, do: 0, else: get_chunk_boundary_offset(opts, chunk_num - 1)

    # End at next chunk boundary or max offset
    end_offset =
      case get_chunk_boundary_offset(opts, chunk_num) do
        nil ->
          # No boundary found, get max op_offset for snapshot + 1
          get_max_snapshot_offset(opts) + 1

        offset ->
          offset
      end

    {start_offset, end_offset}
  end

  defp get_chunk_boundary_offset(%__MODULE__{} = opts, chunk_index) do
    sql = """
    SELECT op_offset FROM chunk_boundaries
    WHERE tx_offset = 0
    ORDER BY op_offset
    LIMIT 1 OFFSET ?1
    """

    {:ok, statement} = Exqlite.Sqlite3.prepare(opts.db_conn, sql)
    :ok = Exqlite.Sqlite3.bind(statement, [chunk_index])

    result =
      case Exqlite.Sqlite3.step(opts.db_conn, statement) do
        {:row, [op_offset]} -> op_offset
        :done -> nil
      end

    :ok = Exqlite.Sqlite3.release(opts.db_conn, statement)
    result
  end

  defp get_max_snapshot_offset(%__MODULE__{} = opts) do
    sql = """
    SELECT MAX(op_offset) FROM log_entries
    WHERE tx_offset = 0
    """

    {:ok, statement} = Exqlite.Sqlite3.prepare(opts.db_conn, sql)

    result =
      case Exqlite.Sqlite3.step(opts.db_conn, statement) do
        {:row, [max_offset]} when not is_nil(max_offset) -> max_offset
        _ -> 0
      end

    :ok = Exqlite.Sqlite3.release(opts.db_conn, statement)
    result
  end

  defp stream_log_chunk(
         %LogOffset{tx_offset: tx, op_offset: op} = _offset,
         max_offset,
         %__MODULE__{} = opts
       ) do
    # Handle the special case of LogOffset.last() which has very large/infinity values
    statement =
      if max_offset == LogOffset.last() do
        sql = """
        SELECT json_data FROM log_entries
        WHERE (tx_offset > ?1) OR (tx_offset = ?1 AND op_offset > ?2)
        ORDER BY tx_offset, op_offset
        """

        {:ok, statement} = Exqlite.Sqlite3.prepare(opts.db_conn, sql)
        :ok = Exqlite.Sqlite3.bind(statement, [tx, op])
        statement
      else
        %LogOffset{tx_offset: max_tx, op_offset: max_op} = max_offset

        sql = """
        SELECT json_data FROM log_entries
        WHERE ((tx_offset > ?1) OR (tx_offset = ?1 AND op_offset > ?2))
          AND ((tx_offset < ?3) OR (tx_offset = ?3 AND op_offset <= ?4))
        ORDER BY tx_offset, op_offset
        """

        {:ok, statement} = Exqlite.Sqlite3.prepare(opts.db_conn, sql)
        :ok = Exqlite.Sqlite3.bind(statement, [tx, op, max_tx, max_op])
        statement
      end

    Stream.resource(
      fn -> statement end,
      fn statement ->
        case Exqlite.Sqlite3.step(opts.db_conn, statement) do
          {:row, [json_data]} -> {[json_data], statement}
          :done -> {:halt, statement}
        end
      end,
      fn statement -> Exqlite.Sqlite3.release(opts.db_conn, statement) end
    )
  end

  defp get_chunk_end_for_log(%LogOffset{tx_offset: tx, op_offset: op}, %__MODULE__{} = opts) do
    sql = """
    SELECT tx_offset, op_offset FROM chunk_boundaries
    WHERE (tx_offset > ?1) OR (tx_offset = ?1 AND op_offset > ?2)
    ORDER BY tx_offset, op_offset
    LIMIT 1
    """

    {:ok, statement} = Exqlite.Sqlite3.prepare(opts.db_conn, sql)
    :ok = Exqlite.Sqlite3.bind(statement, [tx, op])

    result =
      case Exqlite.Sqlite3.step(opts.db_conn, statement) do
        {:row, [next_tx, next_op]} -> LogOffset.new(next_tx, next_op)
        :done -> nil
      end

    :ok = Exqlite.Sqlite3.release(opts.db_conn, statement)
    result
  end

  defp cleanup_internals!(%__MODULE__{} = opts) do
    tables = ["metadata", "log_entries", "chunk_boundaries", "shape_definition"]

    :ok = Exqlite.Sqlite3.execute(opts.db_conn, "BEGIN IMMEDIATE")

    :ok =
      Exqlite.Sqlite3.execute(
        opts.db_conn,
        for(x <- tables, into: "", do: "DELETE FROM #{x}; ")
      )

    :ok = Exqlite.Sqlite3.execute(opts.db_conn, "COMMIT")

    :ok
  end

  defp get_directory_size(path) do
    case File.stat(path) do
      {:ok, %File.Stat{type: :regular, size: size}} ->
        size

      {:ok, %File.Stat{type: :directory}} ->
        case File.ls(path) do
          {:ok, files} ->
            files
            |> Enum.map(&get_directory_size(Path.join(path, &1)))
            |> Enum.sum()

          {:error, _} ->
            0
        end

      _ ->
        0
    end
  end

  defp wait_for_snapshot_data(
         %__MODULE__{} = opts,
         target_chunk,
         max_wait_time \\ 60_000,
         total_wait_time \\ 0
       ) do
    do_wait_for_snapshot_data(opts, target_chunk, max_wait_time, total_wait_time)
  end

  defp do_wait_for_snapshot_data(_, _, max, total) when total >= max do
    raise Storage.Error, message: "Snapshot hasn't updated in #{max}ms"
  end

  defp do_wait_for_snapshot_data(
         %__MODULE__{} = opts,
         target_chunk,
         max_wait_time,
         total_wait_time
       ) do
    # Check if snapshot is now complete
    case get_metadata(opts, @snapshot_meta_key) do
      %LogOffset{} ->
        # Snapshot completed while we were waiting
        stream_snapshot_chunk(opts, target_chunk)

      nil ->
        # Check if we have data for the target chunk
        if has_snapshot_data_for_chunk?(opts, target_chunk) do
          stream_snapshot_chunk(opts, target_chunk)
        else
          # Wait and try again
          Process.sleep(50)
          do_wait_for_snapshot_data(opts, target_chunk, max_wait_time, total_wait_time + 50)
        end
    end
  end

  defp has_snapshot_data_for_chunk?(%__MODULE__{} = opts, chunk_num) do
    {start_offset, end_offset} = get_chunk_boundaries(opts, chunk_num)

    sql = """
    SELECT COUNT(*) FROM log_entries
    WHERE tx_offset = 0 AND op_offset >= ?1 AND op_offset < ?2
    """

    {:ok, statement} = Exqlite.Sqlite3.prepare(opts.db_conn, sql)
    :ok = Exqlite.Sqlite3.bind(statement, [start_offset, end_offset])

    result =
      case Exqlite.Sqlite3.step(opts.db_conn, statement) do
        {:row, [count]} -> count > 0
        :done -> false
      end

    :ok = Exqlite.Sqlite3.release(opts.db_conn, statement)
    result
  end
end
