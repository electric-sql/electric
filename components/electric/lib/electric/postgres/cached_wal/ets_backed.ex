defmodule Electric.Postgres.CachedWal.EtsBacked do
  @moduledoc """
  ETS-backed WAL cache.

  This cache is implemented as a GenStage consumer, so it should be subscribed to a producer that sends
  `t:Transaction.t()` structs as events. This consumer will then fill and update the cache from the stream.

  ## `start_link/1` options

  - `name`: GenServer process name
  - `max_cache_count`: maximum count of WAL entries to store in cache. When maximum is reached, a cleanup will be performed,
    removing oldest entries (FIFO)
  """

  alias Electric.Replication.Changes.Transaction
  alias Electric.Postgres.Lsn
  alias Electric.Postgres.CachedWal.Api

  use GenStage
  @behaviour Electric.Postgres.CachedWal.Api

  @ets_table_name :ets_backed_cached_wal

  @typep state :: %{
           notification_requests: %{optional(reference()) => {Api.wal_pos(), pid()}},
           table: ETS.Set.t(),
           last_seen_wal_pos: Api.wal_pos(),
           current_cache_count: non_neg_integer(),
           max_cache_count: non_neg_integer()
         }

  # Public API


  @doc """
  Start the cache. See module docs for options
  """
  def start_link(opts) do
    # We're globally registering this process since ets table name is hardcoded anyway, so no two instances can be started.
    GenStage.start_link(__MODULE__, opts, name: __MODULE__)
  end

  def clear_cache(stage) do
    GenStage.cast(stage, :clear_cache)
  end

  @impl Api
  def get_wal_position_from_lsn(lsn) do
    if :ets.member(@ets_table_name, lsn) do
      {:ok, lsn_to_position(lsn)}
    else
      {:error, :lsn_too_old}
    end
  end

  @impl Api
  def next_segment(wal_pos) do
    case :ets.next(@ets_table_name, wal_pos) do
      :"$end_of_table" -> :latest
      key -> {:ok, :ets.lookup_element(@ets_table_name, key, 2), key}
    end
  end

  @impl Api
  def request_notification(wal_pos) do
    GenStage.call(__MODULE__, {:request_notification, wal_pos})
  end

  @impl Api
  def cancel_notification_request(ref) do
    GenStage.call(__MODULE__, {:cancel_notification, ref})
  end

  @impl Api
  def serialize_wal_position(wal_pos), do: Integer.to_string(wal_pos)

  @impl Api
  def parse_wal_position(binary) do
    case Integer.parse(binary) do
      {num, ""} -> {:ok, num}
      _ -> :error
    end
  end

  # Internal API

  @impl GenStage
  def init(opts) do
    set = ETS.Set.new!(name: @ets_table_name, ordered: true)

    state = %{
      notification_requests: %{},
      table: set,
      last_seen_wal_pos: 0,
      current_cache_count: 0,
      max_cache_count: Keyword.get(opts, :max_cache_count, 10000)
    }

    case Keyword.get(opts, :subscribe_to) do
      nil -> {:consumer, state}
      subscription -> {:consumer, state, subscribe_to: subscription}
    end
  end

  @impl GenStage
  def handle_call({:request_notification, wal_pos}, {from, _}, state) do
    ref = make_ref()
    state = Map.update!(state, :notification_requests, &Map.put(&1, ref, {wal_pos, from}))

    if wal_pos < state.last_seen_wal_pos do
      send(self(), :fulfill_notifications)
    end

    {:reply, {:ok, ref}, [], state}
  end

  @impl GenStage
  def handle_call({:cancel_notification, ref}, _, state) do
    state = Map.update!(state, :notification_requests, &Map.delete(&1, ref))

    {:reply, :ok, [], state}
  end

  @impl GenStage
  def handle_cast(:clear_cache, state) do
    ETS.Set.delete_all!(state.table)

    # This doesn't do anything with notification requests, but this function is not meant to be used in production
    {:noreply, [], %{state | current_cache_count: 0, last_seen_wal_pos: 0}}
  end

  @impl GenStage
  @spec handle_events([Transaction.t()], term(), state()) :: {:noreply, [], any}
  def handle_events(events, _, state) do
    events
    |> Stream.each(& &1.ack_fn.())
    # Rejection of empty transactions is useful to not store data & not send empty txs to consumers,
    # however that may lead to this cache thinking that the "latest" seen LSN is less than PG had actually sent.
    # If/when we depend on seeing some LSN to perform some effect, we may want to update a value of some kind
    # with last seen LSN/txid regardless of whether the tx contained any changes.
    |> Stream.reject(&Enum.empty?(&1.changes))
    |> Stream.map(fn %Transaction{lsn: lsn} = tx ->
      {lsn_to_position(lsn), %{tx | ack_fn: nil}}
    end)
    |> Enum.to_list()
    |> tap(&ETS.Set.put(state.table, &1))
    |> Electric.Utils.list_last_and_length()
    |> case do
      {_, 0} ->
        # All transactions were empty
        {:noreply, [], state}

      {{position, _}, total} ->
        state =
          state
          |> Map.put(:last_seen_wal_pos, position)
          |> fulfill_notification_requests()
          |> Map.update!(:current_cache_count, &(&1 + total))
          |> trim_cache()

        {:noreply, [], state}
    end
  end

  @impl GenStage
  def handle_info(:fulfill_notifications, state) do
    {:noreply, [], fulfill_notification_requests(state)}
  end

  @spec fulfill_notification_requests(state()) :: state()
  defp fulfill_notification_requests(%{last_seen_wal_pos: new_max_lsn} = state) do
    fulfilled_refs =
      state.notification_requests
      |> Stream.filter(fn {_, {target, _}} -> target <= new_max_lsn end)
      |> Stream.each(fn {ref, {_, pid}} ->
        send(pid, {:cached_wal_notification, ref, :new_segments_available})
      end)
      |> Enum.map(&elem(&1, 0))

    Map.update!(state, :notification_requests, &Map.drop(&1, fulfilled_refs))
  end

  defp lsn_to_position(lsn), do: Lsn.to_integer(lsn)

  @spec trim_cache(state()) :: state()
  defp trim_cache(%{current_cache_count: current, max_cache_count: max} = state)
       when current <= max,
       do: state

  defp trim_cache(state) do
    to_trim = state.current_cache_count - state.max_cache_count

    state.table
    # `match/3` works here because it's an ordered set, which guarantees traversal from the beginning
    |> ETS.Set.match({:"$1", :_}, to_trim)
    |> Enum.each(fn [key] -> ETS.Set.delete!(state.table, key) end)

    Map.update!(state, :current_cache_count, &(&1 - to_trim))
  end
end
