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

  use GenStage

  alias Electric.Replication.Changes.Transaction
  alias Electric.Replication.Connectors
  alias Electric.Postgres.Lsn
  alias Electric.Postgres.CachedWal.Api

  require Logger

  @behaviour Electric.Postgres.CachedWal.Api

  @typep state :: %{
           origin: Connectors.origin(),
           notification_requests: %{optional(reference()) => {Api.wal_pos(), pid()}},
           table: :ets.table(),
           last_seen_wal_pos: Api.wal_pos(),
           current_tx_count: non_neg_integer(),
           wal_window_size: non_neg_integer()
         }

  # Public API

  @spec name(Connectors.origin()) :: Electric.reg_name()
  def name(origin) do
    Electric.name(__MODULE__, origin)
  end

  @doc """
  Start the cache. See module docs for options
  """
  def start_link(opts) do
    origin = Keyword.fetch!(opts, :origin)
    GenStage.start_link(__MODULE__, opts, name: name(origin))
  end

  def clear_cache(stage) do
    GenStage.cast(stage, :clear_cache)
  end

  @impl Api
  def lsn_in_cached_window?(origin, client_wal_pos) do
    table = ets_table_name(origin)

    case :ets.first(table) do
      :"$end_of_table" ->
        false

      first_position ->
        case :ets.last(table) do
          :"$end_of_table" ->
            false

          last_position ->
            first_position <= client_wal_pos and client_wal_pos <= last_position
        end
    end
  end

  @impl Api
  def get_current_position(origin) do
    with :"$end_of_table" <- :ets.last(ets_table_name(origin)) do
      nil
    end
  end

  @impl Api
  def next_segment(origin, wal_pos) do
    case :ets.next(ets_table_name(origin), wal_pos) do
      :"$end_of_table" -> :latest
      key -> {:ok, :ets.lookup_element(ets_table_name(origin), key, 2), key}
    end
  end

  @impl Api
  def request_notification(origin, wal_pos) do
    GenStage.call(name(origin), {:request_notification, wal_pos})
  end

  @impl Api
  def cancel_notification_request(origin, ref) do
    GenStage.call(name(origin), {:cancel_notification, ref})
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

  @impl Api
  def telemetry_stats(origin) do
    GenStage.call(name(origin), :telemetry_stats)
  catch
    :exit, _ -> nil
  end

  @impl Api
  def compare_positions(p, p), do: :eq
  def compare_positions(p1, p2) when p1 < p2, do: :lt
  def compare_positions(p1, p2) when p1 > p2, do: :gt

  # Internal API

  @impl GenStage
  def init(opts) do
    origin = Keyword.fetch!(opts, :origin)

    table = :ets.new(ets_table_name(origin), [:named_table, :ordered_set])
    Logger.metadata(origin: origin, component: "CachedWal.EtsBacked")

    state = %{
      origin: origin,
      notification_requests: %{},
      table: table,
      last_seen_wal_pos: 0,
      current_tx_count: 0,
      wal_window_size: Keyword.fetch!(opts, :wal_window_size)
    }

    case Keyword.get(opts, :subscribe_to) do
      nil -> {:consumer, state}
      subscription -> {:consumer, state, subscribe_to: subscription}
    end
  end

  defp ets_table_name(origin) do
    String.to_atom(inspect(__MODULE__) <> ":" <> origin)
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

  def handle_call({:cancel_notification, ref}, _, state) do
    state = Map.update!(state, :notification_requests, &Map.delete(&1, ref))

    {:reply, :ok, [], state}
  end

  def handle_call(:telemetry_stats, _from, state) do
    oldest_timestamp =
      if tx = lookup_oldest_transaction(state.table) do
        tx.commit_timestamp
      end

    stats = %{
      transaction_count: state.current_tx_count,
      oldest_transaction_timestamp: oldest_timestamp,
      max_cache_size: state.wal_window_size,
      cache_memory_total: :ets.info(state.table, :memory) * :erlang.system_info(:wordsize)
    }

    {:reply, stats, [], state}
  end

  @impl GenStage
  def handle_cast(:clear_cache, state) do
    :ets.delete_all_objects(state.table)

    # This doesn't do anything with notification requests, but this function is not meant to be used in production
    {:noreply, [], %{state | current_tx_count: 0, last_seen_wal_pos: 0}}
  end

  @impl GenStage
  @spec handle_events([Transaction.t()], term(), state()) :: {:noreply, [], any}
  def handle_events(events, _, state) do
    events
    # TODO: Make sure that when this process crashes, LogicalReplicationProducer is restarted as well
    # in order to fill up the in-memory cache.
    |> Stream.each(& &1.ack_fn.())
    # TODO: We're currently storing & streaming empty transactions to Satellite, which is not ideal, but we need
    #       to be aware of all transaction IDs and LSNs that happen, otherwise flakiness begins. I don't like that,
    #       so we probably want to be able to store a shallower pair than a full transaction object and handle that
    #       appropriately in the consumers. Or something else.
    |> Stream.each(
      &Logger.debug(
        "Saving transaction #{&1.xid} at #{&1.lsn} with changes #{inspect(&1.changes)}"
      )
    )
    |> Stream.map(fn %Transaction{lsn: lsn} = tx ->
      {lsn_to_position(lsn), %{tx | ack_fn: nil}}
    end)
    |> Enum.to_list()
    |> tap(&:ets.insert(state.table, &1))
    |> List.last()
    |> case do
      nil ->
        # All transactions were empty
        {:noreply, [], state}

      {position, _} ->
        state =
          state
          |> Map.put(:last_seen_wal_pos, position)
          |> fulfill_notification_requests()
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

  def lsn_to_position(lsn), do: Lsn.to_integer(lsn)

  # Drop all transactions from the cache whose position is less than the last transaction's
  # position minus in-memory WAL window size.
  #
  # TODO: make sure we're not removing transactions that are about to be requested by a newly
  # connected client.
  #
  # NOTE(optimization): clean the cache up after every N new transactions.
  @spec trim_cache(state()) :: state()
  defp trim_cache(state) do
    first_in_window_pos = state.last_seen_wal_pos - state.wal_window_size

    :ets.select_delete(state.table, [
      {{:"$1", :_}, [{:<, :"$1", first_in_window_pos}], [true]}
    ])

    %{state | current_tx_count: :ets.info(state.table, :size)}
  end

  defp lookup_oldest_transaction(ets_table) do
    case :ets.match(ets_table, {:_, :"$1"}, 1) do
      {[[%Transaction{} = tx]], _cont} -> tx
      :"$end_of_table" -> nil
    end
  end
end
