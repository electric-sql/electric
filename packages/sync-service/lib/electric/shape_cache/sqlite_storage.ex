defmodule Electric.ShapeCache.SQLiteStorage do
  @behaviour Electric.ShapeCache.Storage

  alias Exqlite.Sqlite3
  alias Electric.Telemetry.OpenTelemetry
  alias Electric.Replication.LogOffset
  alias __MODULE__, as: S

  @version "1"
  @version_table "main.version"
  @metadata_table_name "metadata"
  @metadata_table "main.#{@metadata_table_name}"
  @chunk_offset_table_name "chunks"
  @chunk_offset_table "main.#{@chunk_offset_table_name}"
  @log_table_name "log"
  @log_table "main.#{@log_table_name}"
  @snapshot_table_name "snapshot"
  @snapshot_table "main.#{@snapshot_table_name}"

  @append_to_log_query "INSERT OR IGNORE INTO #{@log_table} (offset_tx, offset_op, data) VALUES (?1, ?2, ?3)"
  @add_chunk_offset_query "INSERT INTO #{@chunk_offset_table} (offset_tx, offset_op) VALUES (?1, ?2)"

  defstruct [
    :base_path,
    :electric_instance_id,
    :shape_id,
    :conn,
    stmts: %{},
    version: @version
  ]

  @impl Electric.ShapeCache.Storage
  def shared_opts(opts) do
    storage_dir = Keyword.get(opts, :storage_dir, "./shapes")
    electric_instance_id = Keyword.fetch!(opts, :electric_instance_id)

    {:ok, %{base_path: storage_dir, electric_instance_id: electric_instance_id}}
  end

  @impl Electric.ShapeCache.Storage
  def for_shape(shape_id, storage, opts \\ [])

  def for_shape(shape_id, %S{shape_id: shape_id} = storage, _opts) do
    storage
  end

  def for_shape(shape_id, storage_opts, opts) do
    %{base_path: base_path, electric_instance_id: electric_instance_id} =
      storage_opts

    path = mkdir!([base_path, safe_instance_id(electric_instance_id), shape_id, "data.sqlite3"])

    mode =
      if Keyword.get(opts, :readonly, false) do
        :readonly
      else
        :readwrite
      end

    # the open/1 call is pretty quick if there's already an open connection to the same db file
    {:ok, conn} = Sqlite3.open(path, mode: mode)

    %S{
      base_path: base_path,
      electric_instance_id: electric_instance_id,
      shape_id: shape_id,
      conn: conn
    }
  end

  def child_spec(%S{} = opts) do
    %{
      id: __MODULE__,
      start: {__MODULE__, :start_link, [opts]},
      type: :worker,
      restart: :permanent
    }
  end

  @impl Electric.ShapeCache.Storage
  def start_link(%S{} = _opts) do
    :ignore
  end

  @impl Electric.ShapeCache.Storage
  def initialise(%S{conn: conn} = storage) do
    %{version: version} = storage

    :ok = migrate(storage, stored_version(storage), version)
    :ok = repair(storage)

    if snapshot_xmin(storage) == nil || not snapshot_complete?(storage) do
      cleanup!(storage)
    end

    {:ok, append_stmt} = Sqlite3.prepare(conn, @append_to_log_query)
    {:ok, chunk_stmt} = Sqlite3.prepare(conn, @add_chunk_offset_query)

    {:ok, %{storage | stmts: %{append_stmt: append_stmt, chunk_stmt: chunk_stmt}}}
  end

  defp repair(%S{}) do
    :ok
  end

  defp migrate(%S{conn: conn}, nil, @version) do
    :ok = Sqlite3.execute(conn, "PRAGMA journal_mode=WAL")

    # https://www.sqlite.org/pragma.html#pragma_synchronous
    #
    # > When synchronous is NORMAL (1), the SQLite database engine will still
    # > sync at the most critical moments, but less often than in FULL mode.
    # > WAL mode is safe from corruption with
    # > synchronous=NORMAL, ...
    #
    # > WAL mode is always consistent with synchronous=NORMAL, but WAL mode does
    # > lose durability. A transaction committed in WAL mode with
    # > synchronous=NORMAL might roll back following a power loss or system
    # > crash. Transactions are durable across application crashes regardless of
    # > the synchronous setting or journal mode.
    #
    # > The synchronous=NORMAL setting is a good choice for most applications
    # > running in WAL mode.
    #
    # And much faster...
    :ok = Sqlite3.execute(conn, "PRAGMA main.synchronous=NORMAL")

    :ok =
      Sqlite3.execute(conn, """
        CREATE TABLE #{@version_table} (
          version TEXT
        )
      """)

    :ok =
      Sqlite3.execute(conn, """
      INSERT INTO #{@version_table} (version) VALUES ('#{@version}');
      """)

    :ok =
      Sqlite3.execute(conn, """
        CREATE TABLE #{@metadata_table} (
          xmin INTEGER,
          snapshot_started INTEGER,
          snapshot_complete INTEGER,
          offset TEXT
        )
      """)

    :ok =
      Sqlite3.execute(conn, """
      INSERT INTO #{@metadata_table} (xmin, snapshot_started, snapshot_complete, offset) VALUES (NULL, 0, 0, NULL);
      """)

    :ok =
      Sqlite3.execute(conn, """
        CREATE TABLE #{@chunk_offset_table} (
          offset_tx INTEGER,
          offset_op INTEGER
        )
      """)

    :ok =
      Sqlite3.execute(conn, """
        CREATE INDEX #{@chunk_offset_table}_offset_idx ON #{@chunk_offset_table_name} (offset_tx, offset_op);
      """)

    :ok =
      Sqlite3.execute(conn, """
        CREATE TABLE #{@log_table} (
          offset_tx INTEGER,
          offset_op INTEGER,
          data TEXT
        )
      """)

    :ok =
      Sqlite3.execute(conn, """
        CREATE UNIQUE INDEX #{@log_table}_offset_idx ON #{@log_table_name} (offset_tx, offset_op);
      """)

    :ok =
      Sqlite3.execute(
        conn,
        """
          CREATE TABLE #{@snapshot_table} (
            last INTEGER,
            data TEXT
          )
        """
      )

    :ok
  end

  defp migrate(%S{}, @version, @version) do
    :ok
  end

  defp migrate(%S{} = opts, _old_version, _version) do
    # TODO: this is only to satisfy the version upgrade test
    # the actual behaviour here would have to be figured out
    cleanup!(opts)
    :ok
  end

  @version_query "SELECT version FROM #{@version_table} LIMIT 1"

  defp stored_version(%{} = storage) do
    case read_row(storage, @version_query) do
      {:ok, [version]} -> version
      :empty -> nil
      {:error, "no such table" <> _} -> nil
    end
  end

  @impl Electric.ShapeCache.Storage
  def get_current_position(%S{} = opts) do
    {:ok, latest_offset(opts), snapshot_xmin(opts)}
  end

  @latest_offset_query "SELECT offset_tx, offset_op FROM #{@log_table} ORDER BY offset_tx DESC, offset_op DESC LIMIT 1"

  defp latest_offset(%S{} = storage) do
    case read_row(storage, @latest_offset_query) do
      {:ok, [offset_tx, offset_op]} ->
        LogOffset.new(offset_tx, offset_op)

      :empty ->
        LogOffset.first()
    end
  end

  @snapshot_xmin_query "SELECT xmin FROM #{@metadata_table} LIMIT 1"

  defp snapshot_xmin(%S{} = storage) do
    case read_row(storage, @snapshot_xmin_query) do
      {:ok, [xmin]} -> xmin
    end
  end

  @set_snapshot_xmin_query "UPDATE #{@metadata_table} SET xmin = ?"

  @impl Electric.ShapeCache.Storage
  def set_snapshot_xmin(xmin, %S{} = storage) do
    :ok = update_row(storage, @set_snapshot_xmin_query, [xmin])
  end

  @snapshot_started_query "SELECT snapshot_started FROM #{@metadata_table} LIMIT 1"
  @snapshot_complete_query "SELECT snapshot_complete FROM #{@metadata_table} LIMIT 1"

  @impl Electric.ShapeCache.Storage
  def snapshot_started?(%S{} = storage) do
    case read_row(storage, @snapshot_started_query) do
      {:ok, [started]} -> started == 1
    end
  end

  defp snapshot_complete?(%S{} = storage) do
    case read_row(storage, @snapshot_complete_query) do
      {:ok, [complete]} -> complete == 1
    end
  end

  @mark_snapshot_as_started_query "UPDATE #{@metadata_table} SET snapshot_started = ?"
  @mark_snapshot_as_complete_query "UPDATE #{@metadata_table} SET snapshot_complete = ?"

  @impl Electric.ShapeCache.Storage
  def mark_snapshot_as_started(%S{} = storage) do
    :ok = update_row(storage, @mark_snapshot_as_started_query, [1])
  end

  # TODO: could insert multiple rows at once using (?1, ?2, ?3)
  @insert_snapshot_row_query "INSERT INTO #{@snapshot_table} (last, data) VALUES (?1, ?2)"

  @impl Electric.ShapeCache.Storage
  def make_new_snapshot!(data_stream, %S{conn: conn} = storage) do
    OpenTelemetry.with_span(
      "storage.make_new_snapshot",
      [storage_impl: "sqlite", "shape.id": storage.shape_id],
      fn ->
        data_stream
        |> Stream.transform(
          fn ->
            {:ok, statement} = Sqlite3.prepare(conn, @insert_snapshot_row_query)
            {conn, statement}
          end,
          fn row, {conn, statement} ->
            :ok = Sqlite3.bind(conn, statement, [0, row])
            :done = Sqlite3.step(conn, statement)

            {[], {conn, statement}}
          end,
          fn {conn, statement} ->
            # add the final `last` entry
            :ok = Sqlite3.bind(conn, statement, [1, ""])
            :done = Sqlite3.step(conn, statement)
            :ok = Sqlite3.release(conn, statement)

            :ok = update_row(storage, @mark_snapshot_as_complete_query, [1])
          end
        )
        |> Stream.run()
      end
    )
  end

  @snapshot_row_query "SELECT _rowid_, last, data FROM #{@snapshot_table} WHERE _rowid_ > ?1 ORDER BY _rowid_"

  @impl Electric.ShapeCache.Storage
  def get_snapshot(%S{conn: conn} = storage) do
    if snapshot_started?(storage) do
      {LogOffset.first(),
       Stream.resource(
         fn ->
           {:ok, statement} = Sqlite3.prepare(conn, @snapshot_row_query)
           :ok = Sqlite3.bind(conn, statement, [-1])
           {conn, statement, -1, nil}
         end,
         fn {conn, statement, offset, eos_seen} ->
           case Sqlite3.step(conn, statement) do
             {:row, [id, 0, data]} ->
               {[data], {conn, statement, id, eos_seen}}

             {:row, [id, 1, _]} ->
               {:halt, {conn, statement, id, eos_seen}}

             :done ->
               if is_integer(eos_seen) && System.monotonic_time(:millisecond) - eos_seen > 60_000 do
                 raise "Snapshot hasn't updated in 60s"
               else
                 Process.sleep(20)
                 :ok = Sqlite3.bind(conn, statement, [offset])
                 {[], {conn, statement, offset, eos_seen}}
               end
           end
         end,
         fn {conn, statement, _offset, _eos_seen} ->
           :ok = Sqlite3.release(conn, statement)
         end
       )}
    else
      raise "Snapshot no longer available"
    end
  end

  @impl Electric.ShapeCache.Storage
  def append_to_log!(log_items, %S{} = storage) do
    %{conn: conn, stmts: %{append_stmt: append_stmt, chunk_stmt: chunk_stmt}} = storage

    # Doing these writes in a tx seems to make the timings a fairly consistent ~0.2-1ms
    # even with large update sizes. Without the tx, larger updates can push the timing to
    # ~3ms.
    :ok = Sqlite3.execute(conn, "BEGIN")

    Enum.reduce(log_items, {append_stmt, chunk_stmt}, fn
      {:chunk_boundary, offset}, {append_stmt, chunk_stmt} ->
        %LogOffset{tx_offset: tx_offset, op_offset: op_offset} = offset

        :ok = Sqlite3.bind(conn, chunk_stmt, [tx_offset, op_offset])
        :done = Sqlite3.step(conn, chunk_stmt)
        {append_stmt, chunk_stmt}

      {offset, json_log_item}, {append_stmt, chunk_stmt} ->
        %LogOffset{tx_offset: tx_offset, op_offset: op_offset} = offset
        :ok = Sqlite3.bind(conn, append_stmt, [tx_offset, op_offset, json_log_item])
        :done = Sqlite3.step(conn, append_stmt)
        {append_stmt, chunk_stmt}
    end)

    :ok = Sqlite3.execute(conn, "COMMIT")

    :ok
  end

  log_stream_query = fn where ->
    """
    SELECT data
      FROM #{@log_table} #{where}
      ORDER BY offset_tx, offset_op
    """
  end

  @get_log_stream_unbounded_query log_stream_query.(
                                    "WHERE (offset_tx > ?1) OR (offset_tx = ?2 AND offset_op > ?3)"
                                  )
  @get_log_stream_range_query log_stream_query.("""
                              WHERE ((offset_tx > ?1) OR (offset_tx = ?2 AND offset_op > ?3))
                                AND ((offset_tx < ?4) OR (offset_tx = ?5 AND offset_op <= ?6))
                              """)

  @snapshot_read_row_count 100

  @impl Electric.ShapeCache.Storage
  def get_log_stream(offset, max_offset, %S{conn: conn}) do
    %LogOffset{tx_offset: tx_offset_min, op_offset: op_offset_min} = offset
    %LogOffset{tx_offset: tx_offset_max, op_offset: op_offset_max} = max_offset

    Stream.resource(
      fn ->
        {query, params} =
          if LogOffset.last?(max_offset) do
            {@get_log_stream_unbounded_query, [tx_offset_min, tx_offset_min, op_offset_min]}
          else
            {@get_log_stream_range_query,
             [
               tx_offset_min,
               tx_offset_min,
               op_offset_min,
               tx_offset_max,
               tx_offset_max,
               op_offset_max
             ]}
          end

        {:ok, stmt} = Sqlite3.prepare(conn, query)
        :ok = Sqlite3.bind(conn, stmt, params)

        {:stream, conn, stmt}
      end,
      fn
        {:stream, conn, stmt} ->
          case Sqlite3.multi_step(conn, stmt, @snapshot_read_row_count) do
            {:rows, rows} -> {List.flatten(rows), {:stream, conn, stmt}}
            {:done, rows} -> {List.flatten(rows), {:halt, conn, stmt}}
          end

        {:halt, conn, stmt} ->
          {:halt, {:halt, conn, stmt}}
      end,
      fn {:halt, conn, stmt} ->
        :ok = Sqlite3.release(conn, stmt)
      end
    )
  end

  @get_chunk_end_log_offset_query "SELECT offset_tx, offset_op FROM #{@chunk_offset_table} WHERE offset_tx > ?1 OR (offset_tx = ?2 AND offset_op > ?3) LIMIT 1"

  @impl Electric.ShapeCache.Storage
  def get_chunk_end_log_offset(%{tx_offset: tx_offset, op_offset: op_offset}, %S{} = storage) do
    case read_row(storage, @get_chunk_end_log_offset_query, [tx_offset, tx_offset, op_offset]) do
      {:ok, [off_tx, off_op]} ->
        LogOffset.new(off_tx, off_op)

      :empty ->
        nil
    end
  end

  @impl Electric.ShapeCache.Storage
  def cleanup!(%S{conn: conn}) do
    stmts = [
      "DELETE FROM #{@log_table}",
      "DELETE FROM #{@snapshot_table}",
      "DELETE FROM #{@chunk_offset_table}",
      "UPDATE #{@metadata_table} SET xmin = NULL, snapshot_started = 0, snapshot_complete = 0, offset = NULL"
    ]

    :ok = Sqlite3.execute(conn, "BEGIN")

    for stmt <- stmts do
      :ok = Sqlite3.execute(conn, stmt)
    end

    :ok = Sqlite3.execute(conn, "COMMIT")

    :ok
  end

  defp read_row(%S{conn: conn}, query) do
    with {:ok, stmt} <- Sqlite3.prepare(conn, query),
         {:read, {:row, row}} <- {:read, Sqlite3.step(conn, stmt)},
         :done <- Sqlite3.step(conn, stmt),
         :ok = Sqlite3.release(conn, stmt) do
      {:ok, row}
    else
      {:error, _reason} = error -> error
      {:read, :done} -> :empty
    end
  end

  defp read_row(%S{conn: conn}, query, params) do
    with {:ok, stmt} <- Sqlite3.prepare(conn, query),
         :ok = Sqlite3.bind(conn, stmt, params),
         {:read, {:row, row}} <- {:read, Sqlite3.step(conn, stmt)},
         :done <- Sqlite3.step(conn, stmt),
         :ok = Sqlite3.release(conn, stmt) do
      {:ok, row}
    else
      {:error, _reason} = error -> error
      {:read, :done} -> :empty
    end
  end

  defp update_row(%S{conn: conn}, query, params) do
    with {:ok, statement} <- Sqlite3.prepare(conn, query),
         :ok <- Sqlite3.bind(conn, statement, params),
         :done <- Sqlite3.step(conn, statement),
         :ok = Sqlite3.release(conn, statement) do
      :ok
    else
      {:error, message} -> raise message
    end
  end

  defp safe_instance_id(electric_instance_id) do
    String.replace(to_string(electric_instance_id), ~r/[^0-9A-Za-z_-]/, "_")
  end

  defp mkdir!(parts) when is_list(parts) do
    path = Path.join(parts)
    dir = Path.dirname(path)
    File.mkdir_p!(dir)
    path
  end

  # convenience function to pull all results for a query
  @doc false
  def select(%S{conn: conn}, query, params \\ []) do
    Stream.resource(
      fn ->
        {:ok, stmt} = Sqlite3.prepare(conn, query)
        :ok = Sqlite3.bind(conn, stmt, params)

        stmt
      end,
      fn stmt ->
        case Sqlite3.step(conn, stmt) do
          {:row, row} ->
            {[row], stmt}

          :done ->
            {:halt, stmt}
        end
      end,
      fn stmt -> Sqlite3.release(conn, stmt) end
    )
  end
end
