defmodule Electric.Client.ExpiredShapesCache do
  @moduledoc """
  LRU cache for tracking expired shape handles.

  This cache stores shape handles that have been marked as expired (typically after
  receiving a 409 response). When making subsequent requests for the same shape,
  the client includes the expired handle as a query parameter to help bypass
  stale CDN/proxy caches.

  The cache uses ETS for fast concurrent reads and a GenServer to manage
  LRU eviction when the cache exceeds the maximum number of entries.
  """

  use GenServer

  @table_name :electric_expired_shapes
  @max_entries 250

  # Public API

  @doc """
  Get the expired handle for a shape key, if one exists.

  Updates the last_used timestamp to maintain LRU ordering.
  """
  @spec get_expired_handle(String.t()) :: String.t() | nil
  def get_expired_handle(shape_key) do
    case :ets.lookup(@table_name, shape_key) do
      [{^shape_key, %{expired_handle: handle}}] ->
        # Update last_used timestamp asynchronously
        GenServer.cast(__MODULE__, {:touch, shape_key})
        handle

      [] ->
        nil
    end
  end

  @doc """
  Mark a shape handle as expired for the given shape key.

  If the cache exceeds the maximum number of entries, the least recently
  used entry will be evicted.
  """
  @spec mark_expired(String.t(), String.t()) :: :ok
  def mark_expired(shape_key, handle) do
    GenServer.call(__MODULE__, {:mark_expired, shape_key, handle})
  end

  @doc """
  Clear all entries from the cache.
  """
  @spec clear() :: :ok
  def clear do
    GenServer.call(__MODULE__, :clear)
  end

  @doc """
  Get the current number of entries in the cache.

  Primarily for testing purposes.
  """
  @spec size() :: non_neg_integer()
  def size do
    :ets.info(@table_name, :size)
  end

  # GenServer implementation

  def start_link(opts \\ []) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  @impl true
  def init(_opts) do
    table =
      :ets.new(@table_name, [
        :set,
        :public,
        :named_table,
        read_concurrency: true
      ])

    {:ok, %{table: table}}
  end

  @impl true
  def handle_call({:mark_expired, shape_key, handle}, _from, state) do
    timestamp = System.monotonic_time()

    :ets.insert(@table_name, {shape_key, %{expired_handle: handle, last_used: timestamp}})

    # Evict oldest entries if we exceed the limit
    evict_if_needed()

    {:reply, :ok, state}
  end

  @impl true
  def handle_call(:clear, _from, state) do
    :ets.delete_all_objects(@table_name)
    {:reply, :ok, state}
  end

  @impl true
  def handle_cast({:touch, shape_key}, state) do
    timestamp = System.monotonic_time()

    case :ets.lookup(@table_name, shape_key) do
      [{^shape_key, entry}] ->
        :ets.insert(@table_name, {shape_key, %{entry | last_used: timestamp}})

      [] ->
        :ok
    end

    {:noreply, state}
  end

  defp evict_if_needed do
    size = :ets.info(@table_name, :size)

    if size > @max_entries do
      # Find and evict the oldest entry
      oldest =
        :ets.foldl(
          fn {key, %{last_used: ts}}, acc ->
            case acc do
              nil -> {key, ts}
              {_oldest_key, oldest_ts} when ts < oldest_ts -> {key, ts}
              _ -> acc
            end
          end,
          nil,
          @table_name
        )

      case oldest do
        {oldest_key, _ts} ->
          :ets.delete(@table_name, oldest_key)

        nil ->
          :ok
      end
    end
  end
end
