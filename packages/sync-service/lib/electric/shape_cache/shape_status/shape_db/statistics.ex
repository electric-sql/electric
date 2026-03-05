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

  ## Lifecycle

  On startup the GenServer only tracks `connections` (active pool workers).

  After `initialize/1` is cast (triggered by the supervisor once all children
  are up), the module probes the database once to determine which extensions
  are available:

  - If `enable_stats?` is `false` the probe is skipped entirely and the module
    only ever increments/decrements the connections counter.
  - If `dbstat` is not present, disk-size queries are permanently disabled.
  - If `enable_memory_stats?` is `true` and the `memstat` extension loads
    successfully, memory stats are included in every subsequent query.
  - If neither `dbstat` nor `memstat` is available the module stops scheduling
    further DB reads.
  - Otherwise a timer fires every `statistics_collection_period` milliseconds
    (default 60 s) and the results are stored in `stats`.
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
    # don't need to && with enable_stats? because if enable_stats? is false we
    # never test this secondary flag
    enable_memory_stats? = Keyword.get(args, :enable_memory_stats?, false)

    {:ok,
     %{
       stack_id: stack_id,
       page_size: 0,
       stats: %__MODULE__{},
       connections: 0,
       # User-configured flag – never mutated at runtime.
       enable_stats?: enable_stats?,
       enable_memory_stats?: enable_memory_stats?,
       # Whether each extension is actually available in this SQLite build /
       # runtime.  Both start as `nil` (unknown) and are set to true/false
       # during the first initialisation probe.
       dbstat_available?: nil,
       memstat_available?: nil,
       measurement_period: measurement_period,
       task: nil
     }}
  end

  @impl GenServer
  def handle_info(:read_stats, state) do
    {:noreply, schedule_read_stats(state), :hibernate}
  end

  def handle_info({ref, result}, %{task: %{ref: ref}} = state) do
    state =
      case result do
        {:ok, dbstat_available?, memstat_available?, page_size, stats} ->
          %{
            state
            | dbstat_available?: dbstat_available?,
              memstat_available?: memstat_available?,
              page_size: page_size,
              stats: stats
          }

        {:error, reason} ->
          Logger.warning(["Failed to read SQLite statistics: ", inspect(reason)])
          state

        :error ->
          Logger.warning("Failed to read SQLite statistics")
          state
      end

    {:noreply, state}
  end

  def handle_info({:DOWN, ref, :process, _pid, _reason}, %{task: %{ref: ref}} = state) do
    # The task finished (normal exit after returning its result).  The result
    # was already handled in the clause above; schedule the next measurement.
    state = %{state | task: nil}

    if keep_querying?(state) do
      Process.send_after(self(), :read_stats, state.measurement_period)
    end

    {:noreply, state}
  end

  def handle_info(msg, state) do
    Logger.warning(["#{__MODULE__} Received unexpected message: ", inspect(msg)])
    {:noreply, state}
  end

  @impl GenServer
  def handle_call(:statistics, _from, state) do
    {:reply, {:ok, Map.put(Map.from_struct(state.stats), :connections, state.connections)}, state}
  end

  def handle_call(:stats_enabled, _from, state) do
    {:reply, %{disk: state.dbstat_available? == true, memory: state.memstat_available? == true},
     state}
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

  # :initialize is cast once by the supervisor after all children are up.
  # It runs the capability probe unconditionally (force? = true) and, if
  # anything useful is available, schedules the recurring measurement.
  def handle_cast(:initialize, %{enable_stats?: false} = state) do
    # Stats are disabled by configuration – nothing to do.
    {:noreply, state}
  end

  def handle_cast(:initialize, state) do
    {:noreply, run_probe(state)}
  end

  # Decide whether continued DB querying makes sense given current state.
  defp keep_querying?(%{enable_stats?: false}), do: false
  defp keep_querying?(%{dbstat_available?: false, memstat_available?: false}), do: false
  defp keep_querying?(_state), do: true

  # Run the capability probe (first measurement + extension discovery).
  defp run_probe(state) do
    task =
      Task.async(fn ->
        try do
          Connection.checkout_write!(state.stack_id, :read_stats, fn %{conn: conn} ->
            with {:ok, memstat_available?, dbstat_available?, page_size} <-
                   probe_capabilities(conn, state.enable_memory_stats?) do
              stats =
                if dbstat_available? || memstat_available? do
                  query_stats(conn, dbstat_available?, memstat_available?, page_size)
                else
                  {:ok, %__MODULE__{updated_at: DateTime.utc_now()}}
                end

              with {:ok, s} <- stats do
                {:ok, dbstat_available?, memstat_available?, page_size, s}
              end
            end
          end)
        catch
          type, error -> {:error, Exception.format(type, error, __STACKTRACE__)}
        end
      end)

    %{state | task: task}
  end

  # Schedule a normal (non-probe) stats read, skipping if we should not query.
  defp schedule_read_stats(%{enable_stats?: false} = state), do: state

  defp schedule_read_stats(%{dbstat_available?: false, memstat_available?: false} = state),
    do: state

  defp schedule_read_stats(state) do
    # If connections == 0 skip memory stats (only the temporary stats
    # connection itself would be counted, giving a misleading result).
    include_memory? = state.connections > 0 && state.memstat_available? == true

    task =
      Task.async(fn ->
        try do
          Connection.checkout_write!(state.stack_id, :read_stats, fn %{conn: conn} ->
            case query_stats(
                   conn,
                   state.dbstat_available?,
                   include_memory?,
                   state.page_size
                 ) do
              {:ok, stats} ->
                {:ok, state.dbstat_available?, state.memstat_available?, state.page_size, stats}

              err ->
                err
            end
          end)
        catch
          type, error -> {:error, Exception.format(type, error, __STACKTRACE__)}
        end
      end)

    %{state | task: task}
  end

  defp probe_capabilities(conn, enable_memory_stats?) do
    memstat_available? =
      if enable_memory_stats? do
        case Connection.enable_extension(conn, "memstat") do
          {:error, reason} ->
            Logger.warning(
              "Failed to load memstat SQLite extension: #{inspect(reason)}. " <>
                "Memory statistics will not be available."
            )

            false

          _ok ->
            Logger.notice("SQLite memory statistics enabled")
            true
        end
      else
        false
      end

    dbstat_available? =
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

    if !memstat_available? && !dbstat_available? do
      Logger.warning(
        "Neither dbstat nor memstat is available – SQLite statistics collection disabled."
      )
    end

    with {:ok, [page_size]} <- Connection.fetch_one(conn, "PRAGMA page_size", []) do
      {:ok, memstat_available?, dbstat_available?, page_size}
    end
  end

  defp query_stats(conn, dbstat_available?, include_memory?, page_size) do
    with {:ok, rows} <-
           Connection.fetch_all(conn, stats_sql(dbstat_available?, include_memory?), []) do
      {:ok, analyze_stats(rows, page_size)}
    end
  end

  defp stats_sql(true, true) do
    """
    SELECT '__dbstat__', sum(pgsize), sum(unused) FROM dbstat WHERE aggregate = TRUE
    UNION ALL
    SELECT name, hiwtr, value FROM sqlite_memstat
    """
  end

  defp stats_sql(true, _include_memory?) do
    "SELECT '__dbstat__', sum(pgsize), sum(unused) FROM dbstat WHERE aggregate = TRUE"
  end

  defp stats_sql(false, true) do
    "SELECT name, hiwtr, value FROM sqlite_memstat"
  end

  # Should not normally be reached (we guard against this before calling), but
  # handle it gracefully rather than crash.
  defp stats_sql(false, false) do
    "SELECT 1 WHERE 0"
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
