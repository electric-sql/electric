defmodule Electric.ShapeCache.PureFileStorage.OperationCache do
  @moduledoc """
  In-memory cache for recent operations to serve catchup requests without disk I/O.

  Most catchup calls are to recent offsets. This cache keeps the N most recent operations
  in memory to immediately serve those requests vs. going to disk.

  Configuration:
  - :max_operations - Maximum number of operations to cache (default: 1000)
  - :ttl_ms - Time to live for cached operations in milliseconds (default: 60000 = 1 minute)

  Telemetry:
  - [:electric, :operation_cache, :hit] - Cache hit with depth measurement
  - [:electric, :operation_cache, :miss] - Cache miss
  - [:electric, :operation_cache, :evict] - Operations evicted from cache
  """

  use GenServer
  require Logger

  alias Electric.Replication.LogOffset
  alias Electric.Telemetry

  @type operation :: %{
          offset: LogOffset.t(),
          json: binary(),
          timestamp: integer()
        }

  @type cache_opts :: [
          max_operations: pos_integer(),
          ttl_ms: pos_integer(),
          shape_handle: binary()
        ]

  @default_max_operations 1000
  @default_ttl_ms 60_000

  # Client API

  @doc """
  Starts a new operation cache.
  """
  @spec start_link(cache_opts()) :: GenServer.on_start()
  def start_link(opts) do
    GenServer.start_link(__MODULE__, opts)
  end

  @doc """
  Adds operations to the cache.

  Operations are added in bulk to minimize GenServer calls.
  """
  @spec put_operations(pid(), [operation()]) :: :ok
  def put_operations(cache_pid, operations) when is_list(operations) do
    GenServer.cast(cache_pid, {:put_operations, operations})
  end

  @doc """
  Gets operations from the cache starting at the given offset.

  Returns:
  - {:ok, operations, depth} - Cache hit with operations and depth (how far back in cache)
  - {:error, :cache_miss} - Requested offset not in cache
  """
  @spec get_operations(pid(), LogOffset.t(), LogOffset.t() | nil) ::
          {:ok, [operation()], non_neg_integer()} | {:error, :cache_miss}
  def get_operations(cache_pid, start_offset, end_offset \\ nil) do
    GenServer.call(cache_pid, {:get_operations, start_offset, end_offset})
  end

  @doc """
  Gets cache statistics for monitoring.
  """
  @spec get_stats(pid()) :: %{
          size: non_neg_integer(),
          oldest_offset: LogOffset.t() | nil,
          newest_offset: LogOffset.t() | nil,
          hit_count: non_neg_integer(),
          miss_count: non_neg_integer()
        }
  def get_stats(cache_pid) do
    GenServer.call(cache_pid, :get_stats)
  end

  @doc """
  Clears the cache.
  """
  @spec clear(pid()) :: :ok
  def clear(cache_pid) do
    GenServer.cast(cache_pid, :clear)
  end

  # Server Callbacks

  @impl true
  def init(opts) do
    max_operations = Keyword.get(opts, :max_operations, @default_max_operations)
    ttl_ms = Keyword.get(opts, :ttl_ms, @default_ttl_ms)
    shape_handle = Keyword.fetch!(opts, :shape_handle)

    # Schedule periodic cleanup
    schedule_cleanup(ttl_ms)

    state = %{
      operations: :queue.new(),
      max_operations: max_operations,
      ttl_ms: ttl_ms,
      shape_handle: shape_handle,
      size: 0,
      hit_count: 0,
      miss_count: 0,
      # Index for fast offset lookup: offset -> position in queue
      offset_index: %{}
    }

    {:ok, state}
  end

  @impl true
  def handle_cast({:put_operations, new_operations}, state) do
    now = System.monotonic_time(:millisecond)

    # Add timestamp to operations
    timestamped_ops =
      Enum.map(new_operations, fn op ->
        Map.put(op, :timestamp, now)
      end)

    # Add to queue and update index
    {updated_queue, updated_index, new_size} =
      Enum.reduce(timestamped_ops, {state.operations, state.offset_index, state.size}, fn op,
                                                                                           {queue,
                                                                                            index,
                                                                                            size} ->
        new_queue = :queue.in(op, queue)
        new_index = Map.put(index, op.offset, size)
        {new_queue, new_index, size + 1}
      end)

    # Evict old operations if we exceed max
    {final_queue, final_index, final_size, evicted_count} =
      evict_excess(updated_queue, updated_index, new_size, state.max_operations)

    if evicted_count > 0 do
      emit_telemetry(:evict, %{count: evicted_count}, state)
    end

    new_state = %{
      state
      | operations: final_queue,
        offset_index: final_index,
        size: final_size
    }

    {:noreply, new_state}
  end

  @impl true
  def handle_cast(:clear, state) do
    new_state = %{
      state
      | operations: :queue.new(),
        offset_index: %{},
        size: 0
    }

    {:noreply, new_state}
  end

  @impl true
  def handle_call({:get_operations, start_offset, end_offset}, _from, state) do
    case find_operations(state.operations, state.offset_index, start_offset, end_offset) do
      {:ok, operations, depth} ->
        emit_telemetry(:hit, %{depth: depth, count: length(operations)}, state)

        new_state = %{state | hit_count: state.hit_count + 1}
        {:reply, {:ok, operations, depth}, new_state}

      {:error, :cache_miss} ->
        emit_telemetry(:miss, %{}, state)

        new_state = %{state | miss_count: state.miss_count + 1}
        {:reply, {:error, :cache_miss}, new_state}
    end
  end

  @impl true
  def handle_call(:get_stats, _from, state) do
    {oldest, newest} = get_offset_range(state.operations)

    stats = %{
      size: state.size,
      oldest_offset: oldest,
      newest_offset: newest,
      hit_count: state.hit_count,
      miss_count: state.miss_count,
      hit_rate:
        if state.hit_count + state.miss_count > 0 do
          state.hit_count / (state.hit_count + state.miss_count)
        else
          0.0
        end
    }

    {:reply, stats, state}
  end

  @impl true
  def handle_info(:cleanup, state) do
    now = System.monotonic_time(:millisecond)
    cutoff = now - state.ttl_ms

    {new_queue, new_index, new_size, evicted} =
      evict_expired(state.operations, state.offset_index, cutoff)

    if evicted > 0 do
      Logger.debug("Evicted #{evicted} expired operations from cache")
      emit_telemetry(:evict, %{count: evicted, reason: :expired}, state)
    end

    # Schedule next cleanup
    schedule_cleanup(state.ttl_ms)

    new_state = %{state | operations: new_queue, offset_index: new_index, size: new_size}
    {:noreply, new_state}
  end

  # Private Functions

  defp find_operations(queue, index, start_offset, end_offset) do
    # Check if start_offset is in the index
    case Map.get(index, start_offset) do
      nil ->
        {:error, :cache_miss}

      start_position ->
        # Get operations from start_offset onwards
        operations = :queue.to_list(queue)

        matching_ops =
          operations
          |> Enum.drop(start_position)
          |> Enum.take_while(fn op ->
            case end_offset do
              nil -> true
              end_off -> LogOffset.compare(op.offset, end_off) <= 0
            end
          end)

        if length(matching_ops) > 0 do
          depth = start_position
          {:ok, matching_ops, depth}
        else
          {:error, :cache_miss}
        end
    end
  end

  defp evict_excess(queue, index, size, max_size) when size > max_size do
    to_evict = size - max_size

    {evicted_ops, new_queue} =
      Enum.reduce(1..to_evict, {[], queue}, fn _, {evicted, q} ->
        case :queue.out(q) do
          {{:value, op}, new_q} -> {[op | evicted], new_q}
          {:empty, q} -> {evicted, q}
        end
      end)

    # Rebuild index (subtract evicted count from all positions)
    new_index =
      index
      |> Enum.reject(fn {offset, _pos} ->
        Enum.any?(evicted_ops, fn op -> op.offset == offset end)
      end)
      |> Enum.map(fn {offset, pos} -> {offset, pos - to_evict} end)
      |> Map.new()

    {new_queue, new_index, max_size, to_evict}
  end

  defp evict_excess(queue, index, size, _max_size), do: {queue, index, size, 0}

  defp evict_expired(queue, index, cutoff) do
    {evicted_ops, remaining_queue} =
      :queue.to_list(queue)
      |> Enum.split_while(fn op -> op.timestamp < cutoff end)

    new_queue = :queue.from_list(remaining_queue)
    evicted_count = length(evicted_ops)

    # Rebuild index
    new_index =
      index
      |> Enum.reject(fn {offset, _pos} ->
        Enum.any?(evicted_ops, fn op -> op.offset == offset end)
      end)
      |> Enum.map(fn {offset, pos} -> {offset, pos - evicted_count} end)
      |> Map.new()

    new_size = :queue.len(new_queue)

    {new_queue, new_index, new_size, evicted_count}
  end

  defp get_offset_range(queue) do
    case {:queue.peek(queue), :queue.peek_r(queue)} do
      {empty, _} when empty == :empty -> {nil, nil}
      {{:value, oldest}, {:value, newest}} -> {oldest.offset, newest.offset}
    end
  end

  defp schedule_cleanup(ttl_ms) do
    # Clean up every TTL/2 to keep cache fresh
    Process.send_after(self(), :cleanup, div(ttl_ms, 2))
  end

  defp emit_telemetry(event, measurements, state) do
    Telemetry.execute(
      [:electric, :operation_cache, event],
      measurements,
      %{shape_handle: state.shape_handle}
    )
  end
end
