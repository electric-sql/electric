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
           reservations: %{binary() => {Api.wal_pos(), integer() | nil}},
           table: :ets.table(),
           first_wal_pos: Api.wal_pos(),
           last_seen_wal_pos: Api.wal_pos(),
           current_tx_count: non_neg_integer(),
           wal_window_size: non_neg_integer()
         }

  @reservation_expiration_s 30

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
  def reserve_wal_position(origin, client_id, wal_pos) do
    with last_position when is_integer(last_position) <- :ets.last(ets_table_name(origin)),
         # Sanity check to make sure client is not "in the future" relative to the cached WAL.
         true <- wal_pos <= last_position do
      GenStage.call(name(origin), {:reserve_wal_position, client_id, wal_pos})
    else
      _ -> :error
    end
  end

  @impl Api
  def cancel_reservation(origin, client_id) do
    GenStage.cast(name(origin), {:cancel_reservation, client_id})
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
      reservations: %{},
      table: table,
      first_wal_pos: nil,
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

<<<<<<< HEAD
  def handle_call({:reserve_wal_position, client_id, wal_pos}, _from, state) do
    if wal_pos >= state.first_wal_pos do
=======
  def handle_call({:reserve_wal_position, client_id, client_wal_pos}, _from, state) do
    if wal_pos = wal_pos_to_reserve(client_wal_pos, state.first_wal_pos) do
>>>>>>> e6f66bb2 (Stream WAL records from the replication slot)
      state = Map.update!(state, :reservations, &Map.put(&1, client_id, {wal_pos, nil}))
      {:reply, :ok, [], state}
    else
      {:reply, :error, [], state}
    end
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
  def handle_cast({:cancel_reservation, client_id}, %{reservations: reservations} = state) do
    # Retain client's reservation long enough for the client to consume cached
    # transactions before they are removed during a cache cleanup pass.
    reservations =
      if Map.has_key?(reservations, client_id) do
        Map.update!(reservations, client_id, fn {wal_pos, ts} ->
          {wal_pos, ts || System.monotonic_time()}
        end)
      else
        reservations
      end

    {:noreply, [], %{state | reservations: reservations}}
  end

  def handle_cast(:clear_cache, state) do
    :ets.delete_all_objects(state.table)

    # This doesn't do anything with notification requests, but this function is not meant to be used in production
    {:noreply, [], %{state | current_tx_count: 0, last_seen_wal_pos: 0}}
  end

  @impl GenStage
  @spec handle_events([Transaction.t()], term(), state()) :: {:noreply, [], any}
  def handle_events(events, _, state) do
    # TODO: Make sure that when this process crashes, LogicalReplicationProducer is restarted as well
    # in order to fill up the in-memory cache.
    events
    # TODO: We're currently storing & streaming empty transactions to Satellite, which is not ideal, but we need
    #       to be aware of all transaction IDs and LSNs that happen, otherwise flakiness begins. I don't like that,
    #       so we probably want to be able to store a shallower pair than a full transaction object and handle that
    #       appropriately in the consumers. Or something else.
    #
    #
    # 9 Apr 2024. ALCO's UPDATE TO THE ABOVE NOTE FROM ILIA:
    #
    # Versions of Postgres before 15 include all transactions in the logical replication
    # stream, even those that touched tables not included in electric_publication. That is the
    # source of empty transactions Electric sees on the replication stream. I'm not aware of
    # other sources of such transactions that have an empty list of changes.
    #
    # Since version 15.0, Postgres no longer sends such empty transactions. It stands to reason
    # that this whole comment blob can be removed for good.
    #
    # Here's the relevant change in Postgres' source tree -
    # https://www.postgresql.org/message-id/E1nZNz3-001zFN-UA%40gemulon.postgresql.org
    |> Stream.each(
      &Logger.debug(
        "Saving transaction #{&1.xid} at #{&1.lsn} with changes #{inspect(&1.changes)}"
      )
    )
    |> Stream.map(fn %Transaction{} = tx -> {lsn_to_position(tx.lsn), tx} end)
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
          |> Map.update!(:first_wal_pos, &min(&1, position))
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
  def position_to_lsn(wal_pos), do: Lsn.from_integer(wal_pos)

  # Drop all transactions from the cache whose position falls out of the cached window. The
  # cached window's low bound is calculated by subtracting the configured in-memory WAL window
  # size from the most recent cached transaction's position.
  #
  # NOTE(optimization): clean the cache up after every N new transactions.
  @spec trim_cache(state()) :: state()
  defp trim_cache(state) do
    first_in_window_pos = state.last_seen_wal_pos - state.wal_window_size
    {min_reserved_pos, reservations} = prune_reservations(state.reservations)

    # Note that `min_pos_to_keep` may be less than the calculated low bound of the cached
    # window. That's exactly the point of reservations: letting clients hold on to a
    # transaction that would have been removed from the cache otherwise.
    min_pos_to_keep = min(first_in_window_pos, min_reserved_pos)

    state =
      if min_pos_to_keep > state.first_wal_pos do
        :ets.select_delete(state.table, [
          {{:"$1", :_}, [{:<, :"$1", min_pos_to_keep}], [true]}
        ])

        %{state | current_tx_count: :ets.info(state.table, :size), first_wal_pos: min_pos_to_keep}
      else
        state
      end

    %{state | reservations: reservations}
  end

  # Remove reservations who 1) already have a timestamp and 2) whose timestamp is old enough to
  # be expired.
  defp prune_reservations(reservations) do
    current_time = System.monotonic_time()

    Enum.reduce(reservations, {nil, reservations}, fn
      {_client_id, {wal_pos, nil}}, {min_wal_pos, reservations} ->
        {min(wal_pos, min_wal_pos), reservations}

      {client_id, {wal_pos, ts}}, {min_wal_pos, reservations} ->
        if diff_seconds(current_time, ts) < @reservation_expiration_s do
          {min(wal_pos, min_wal_pos), reservations}
        else
          {min_wal_pos, Map.delete(reservations, client_id)}
        end
    end)
  end

  defp diff_seconds(ts1, ts2), do: System.convert_time_unit(abs(ts1 - ts2), :native, :second)

  defp wal_pos_to_reserve(:oldest, first_wal_pos), do: first_wal_pos

  defp wal_pos_to_reserve(wal_pos, first_wal_pos) do
    if wal_pos >= first_wal_pos, do: wal_pos
  end

  defp lookup_oldest_transaction(ets_table) do
    case :ets.match(ets_table, {:_, :"$1"}, 1) do
      {[[%Transaction{} = tx]], _cont} -> tx
      :"$end_of_table" -> nil
    end
  end
end
