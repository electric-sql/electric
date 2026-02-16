defmodule Electric.ShapeCache.ShapeStatus.ShapeDb.Statistics do
  @moduledoc """
  Uses SQLite's built-in statistics to report memory usage.

  https://www.sqlite.org/draft/c3ref/c_status_malloc_count.html
  https://www.sqlite.org/draft/c3ref/c_dbstatus_options.html

  The `sqlite_memstat` table is part of the `memstat` loadable extension,
  provided by the `ExSqlean` package.

  Note that the reported values are per-db, not per-connection. There are
  per-connection stats included in the query result but they're not included in
  the export.
  """

  use GenServer

  alias Electric.ShapeCache.ShapeStatus.ShapeDb

  @measurement_period 60_000

  def name(stack_ref) do
    Electric.ProcessRegistry.name(stack_ref, __MODULE__)
  end

  def start_link(args) do
    GenServer.start_link(__MODULE__, args, name: name(args))
  end

  def current(stack_id) do
    GenServer.call(name(stack_id), :statistics)
  end

  @impl GenServer
  def init(args) do
    stack_id = Keyword.fetch!(args, :stack_id)

    Process.set_label({:shape_db_statistics, stack_id})
    Logger.metadata(stack_id: stack_id)
    Electric.Telemetry.Sentry.set_tags_context(stack_id: stack_id)

    {:ok, %{stack_id: stack_id, page_size: 0, stats: %{}}, {:continue, :initialize_stats}}
  end

  @impl GenServer
  def handle_continue(:initialize_stats, state) do
    %{stack_id: stack_id} = state

    {:ok, [page_size]} =
      ShapeDb.Connection.checkout_write!(stack_id, :read_stats, fn %{conn: conn} ->
        with :ok <- ShapeDb.Connection.enable_extension(conn, "memstat") do
          ShapeDb.Connection.fetch_one(conn, "PRAGMA page_size", [])
        end
      end)

    {:noreply, read_stats(%{state | page_size: page_size}), :hibernate}
  end

  @impl GenServer
  def handle_info(:read_stats, state) do
    {:noreply, read_stats(state), :hibernate}
  end

  @impl GenServer
  def handle_call(:statistics, _from, state) do
    {:reply, {:ok, state.stats}, state}
  end

  defp read_stats(%{stack_id: stack_id} = state) do
    {:ok, stats} =
      ShapeDb.Connection.checkout_write!(stack_id, :read_stats, fn %{conn: conn} ->
        ShapeDb.Connection.fetch_all(
          conn,
          """
          SELECT '__dbstat__', sum(pgsize), sum(unused) FROM dbstat WHERE aggregate = TRUE
          UNION ALL
          SELECT name, hiwtr, value FROM sqlite_memstat
          """,
          []
        )
      end)

    Process.send_after(self(), :read_stats, @measurement_period)

    %{state | stats: analyze_stats(stats, state.page_size)}
  end

  defp analyze_stats(stats, page_size) do
    stats
    |> Enum.reduce(%{}, &add_stat(&1, &2, page_size))
    |> then(fn stats ->
      %{
        memory_used: memory_used,
        pagecache_used: pagecache_used,
        pagecache_overflow: pagecache_overflow,
        disk_size: disk_size,
        data_size: data_size
      } = stats

      # 1. MEMORY_USED (primary metric): This is the main memory counter but
      #    excludes pre-configured page cache memory.
      #
      # 2. PAGECACHE_USED × page_size (if using SQLITE_CONFIG_PAGECACHE): If
      #    you configured a page cache via SQLITE_CONFIG_PAGECACHE, this tracks
      #    pages used from that pool. Multiply by PRAGMA page_size to get
      #    bytes.
      #
      # 3. PAGECACHE_OVERFLOW (heap fallback): When the pre-allocated page
      #    cache is full, overflow goes to heap. This is already in bytes.
      %{
        total_memory: memory_used + pagecache_used + pagecache_overflow,
        page_cache_overflow: pagecache_overflow,
        disk_size: disk_size,
        data_size: data_size
      }
    end)
  end

  # This parameter is the current amount of memory checked out using
  # sqlite3_malloc(), either directly or indirectly. The figure includes calls
  # made to sqlite3_malloc() by the application and internal memory usage by
  # the SQLite library. Auxiliary page-cache memory controlled by
  # SQLITE_CONFIG_PAGECACHE is not included in this parameter. The amount
  # returned is the sum of the allocation sizes as reported by the xSize method
  # in sqlite3_mem_methods.
  defp add_stat(["MEMORY_USED", _high, value], acc, _page_size) do
    Map.put(acc, :memory_used, value)
  end

  # This parameter returns the number of pages used out of the pagecache memory
  # allocator that was configured using SQLITE_CONFIG_PAGECACHE. The value
  # returned is in pages, not in bytes.
  defp add_stat(["PAGECACHE_USED", _high, value], acc, page_size) do
    Map.put(acc, :pagecache_used, value * page_size)
  end

  # This parameter returns the number of bytes of page cache allocation which
  # could not be satisfied by the SQLITE_CONFIG_PAGECACHE buffer and where
  # forced to overflow to sqlite3_malloc().
  defp add_stat(["PAGECACHE_OVERFLOW", _high, value], acc, _page_size) do
    Map.put(acc, :pagecache_overflow, value)
  end

  # The DBSTAT virtual table is a read-only eponymous virtual table that
  # returns information about the amount of disk space used to store the
  # content of an SQLite database
  # - `pgsize` - Total storage space used by the current page or btree
  # - `unused` - Unused bytes of on the current page or btree
  defp add_stat(["__dbstat__", pgsize, unused], acc, _page_size) do
    acc
    |> Map.put(:disk_size, pgsize)
    |> Map.put(:data_size, pgsize - unused)
  end

  defp add_stat(_, acc, _page_size) do
    acc
  end
end
