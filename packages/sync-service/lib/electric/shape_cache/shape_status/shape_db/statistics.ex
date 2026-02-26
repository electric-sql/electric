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

  alias Electric.ShapeCache.ShapeStatus.ShapeDb.Connection

  require Logger

  defstruct total_memory: 0,
            page_cache_overflow: 0,
            disk_size: 0,
            data_size: 0,
            updated_at: nil

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

  @doc """
  Returns a map describing which stat categories are currently operational.

      %{disk: true, memory: false}

  `disk` is `true` when the `dbstat` virtual table is available in the
  SQLite build (used to report `disk_size` / `data_size`).

  `memory` is `true` when the `memstat` loadable extension was successfully
  loaded (requires `ELECTRIC_SHAPE_DB_ENABLE_MEMORY_STATS=true` *and* the
  `ExSqlean` extension being present and loadable).
  """
  @spec stats_enabled(term()) :: %{disk: boolean(), memory: boolean()}
  def stats_enabled(stack_id) do
    GenServer.call(name(stack_id), :stats_enabled)
  end

  def initialize(stack_id) do
    GenServer.cast(name(stack_id), :initialize)
  end

  def worker_start(stack_id) do
    GenServer.cast(name(stack_id), {:worker_incr, 1})
  end

  def worker_stop(stack_id) do
    GenServer.cast(name(stack_id), {:worker_incr, -1})
  end

  @impl GenServer
  def init(args) do
    stack_id = Keyword.fetch!(args, :stack_id)

    Process.set_label({:shape_db_statistics, stack_id})
    Logger.metadata(stack_id: stack_id)
    Electric.Telemetry.Sentry.set_tags_context(stack_id: stack_id)

    measurement_period = Keyword.get(args, :statistics_collection_period, @measurement_period)
    enable_stats? = Keyword.get(args, :enable_stats?, false)
    # don't need to && with enable_stats because if enable_stats? is false,
    # we never test this secondary flag
    enable_memory_stats? = Keyword.get(args, :enable_memory_stats?, false)

    {:ok,
     %{
       stack_id: stack_id,
       page_size: 0,
       stats: %__MODULE__{},
       connections: 0,
       first_run?: true,
       exclusive_mode?: Keyword.get(args, :exclusive_mode, false),
       enable_stats?: enable_stats?,
       dbstat_available?: true,
       enable_memory_stats?: enable_memory_stats?,
       measurement_period: measurement_period,
       pool_opts: args
     }}
  end

  @impl GenServer
  def handle_info(:read_stats, state) do
    {:noreply, read_stats(state), :hibernate}
  end

  def handle_info(msg, state) do
    Logger.warning(["Received unexpected message: ", inspect(msg)])
    {:noreply, state}
  end

  @impl GenServer
  def handle_call(:statistics, _from, state) do
    {:reply, {:ok, Map.put(Map.from_struct(state.stats), :connections, state.connections)}, state}
  end

  def handle_call(:stats_enabled, _from, state) do
    {:reply, %{disk: state.dbstat_available?, memory: state.memstat_available?}, state}
  end

  @impl GenServer
  def handle_cast({:worker_incr, incr}, state) do
    state =
      state
      |> Map.update!(:connections, &(&1 + incr))
      |> tap(fn state ->
        Logger.debug([
          if(incr > 0, do: "Opening ", else: "Closing "),
          "ShapeDb connection: #{state.connections} active connections"
        ])
      end)

    {:noreply, state}
  end

  def handle_cast(:initialize, state) do
    {:noreply, read_stats(state, _force = true)}
  end

  defp read_stats(state, force? \\ false)

  # If the pools have no open connections, then don't read memory usage because
  # the report would only include memory used by the temporary statistics
  # connection. We're assuming that 0 open connections == 0 sqlite memory
  # usage, which seems reasonable
  defp read_stats(%{connections: 0} = state, false) do
    do_read_stats(state, false)
  end

  defp read_stats(%{enable_stats?: false} = state, _force?) do
    state
  end

  defp read_stats(state, _force?) do
    do_read_stats(state, true)
  end

  defp do_read_stats(state, include_memory?) do
    state
    |> open_connection(fn conn ->
      with {:ok, memstat_available?, dbstat_available?, page_size} <-
             initialize_connection(
               conn,
               state.first_run?,
               state.enable_memory_stats?,
               state.dbstat_available?
             ) do
        if dbstat_available? do
          with {:ok, stats} <-
                 Connection.fetch_all(
                   conn,
                   stats_query(memstat_available? && include_memory?),
                   []
                 ) do
            {:ok, analyze_stats(stats, page_size)}
          end
        else
          {:ok, %__MODULE__{updated_at: DateTime.utc_now()}}
        end
      end
    end)
    |> case do
      {:ok, stats} ->
        %{state | stats: stats}

      {:error, reason} ->
        Logger.warning(["Failed to read SQLite statistics: ", inspect(reason)])
        state

      :error ->
        Logger.warning("Failed to read SQLite statistics")
        state
    end
    |> then(fn
      %{first_run?: true} = state ->
        %{state | first_run?: false}

      state ->
        state
    end)
    |> tap(fn state ->
      Process.send_after(self(), :read_stats, state.measurement_period)
    end)
  end

  # In exclusive_mode we *must* use a pooled connection because the db maybe
  # in-memory. This is ok because in this mode we never close the single
  # connection instance so using it won't prevent closing idle connections.
  defp open_connection(%{exclusive_mode?: true} = state, fun) do
    Connection.checkout_write!(state.stack_id, :read_stats, fn %{conn: conn} ->
      fun.(conn)
    end)
  end

  # read the stats over a completely new connection to avoid waking a pool
  # worker and preventing it from reaching the idle timeout
  defp open_connection(%{exclusive_mode?: false, pool_opts: pool_opts} = _state, fun) do
    with {:ok, conn} <- Connection.open(pool_opts) do
      try do
        fun.(conn)
      after
        Connection.close(conn)
      end
    end
  end

  defp initialize_connection(conn, first_run?, enable_memory_stats?, dbstat_available?) do
    memstat_available? =
      if enable_memory_stats? do
        case Connection.enable_extension(conn, "memstat") do
          :ok ->
            if first_run?, do: Logger.info("SQLite memory statistics enabled")
            true

          {:error, reason} ->
            Logger.warning(
              "Failed to load memstat SQLite extension: #{inspect(reason)}. " <>
                "Memory statistics will not be available."
            )

            false
        end
      else
        false
      end

    dbstat_available? =
      if dbstat_available? do
        case Connection.fetch_one(
               conn,
               "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'dbstat'",
               []
             ) do
          {:ok, [1]} ->
            true

          :error ->
            Logger.warning("SQLite disk size statistics will not be available.")
            false
        end
      else
        false
      end

    with {:ok, [page_size]} <- Connection.fetch_one(conn, "PRAGMA page_size", []) do
      {:ok, memstat_available?, dbstat_available?, page_size}
    end
  end

  defp stats_query(true) do
    """
    SELECT '__dbstat__', sum(pgsize), sum(unused) FROM dbstat WHERE aggregate = TRUE
    UNION ALL
    SELECT name, hiwtr, value FROM sqlite_memstat
    """
  end

  defp stats_query(false) do
    "SELECT '__dbstat__', sum(pgsize), sum(unused) FROM dbstat WHERE aggregate = TRUE"
  end

  defp analyze_stats(stats, page_size) do
    stats
    |> Enum.reduce(%{}, &add_stat(&1, &2, page_size))
    |> then(fn stats ->
      memory_used = Map.get(stats, :memory_used, 0)
      pagecache_used = Map.get(stats, :pagecache_used, 0)
      pagecache_overflow = Map.get(stats, :pagecache_overflow, 0)
      disk_size = Map.get(stats, :disk_size, 0)
      data_size = Map.get(stats, :data_size, 0)

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
      %__MODULE__{
        total_memory: memory_used + pagecache_used + pagecache_overflow,
        page_cache_overflow: pagecache_overflow,
        disk_size: disk_size,
        data_size: data_size,
        updated_at: DateTime.utc_now()
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
