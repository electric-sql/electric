defmodule Electric.Postgres.CachedWal.WalMng do
  @moduledoc """
  This module provides functionality for managing a cached write-ahead log
  (WAL). The WAL manager supports a single writer and multiple concurrent
  readers. The WAL is stored in ETS tables called segments, which are units of
  garbage collection. The WAL manager may implement different strategies for
  garbage collection based on the progress of the clients.
  """

  @behaviour GenServer
  require Logger

  @type lsn :: Electric.Postgres.Lsn.int64()
  @type segment_ets :: :ets.tid()

  # initial value of lsn for the subscribed client
  @initial_lsn_value 0
  # max number of segments at a time
  @segments_max_limit 10
  # max number of transactions in a segment
  @segment_single_limit 1000

  # Atomic variable that keeps left quotas for the current segment
  @quota_idx 1
  # Atomic variable that keeps current lsn value (for monotonicity invariant)
  @lsn_idx 2
  # Atomic variable that is used to indicate WAL writer that clients await
  # notifications
  @notify_idx 3
  @total_idx_num 3

  defmodule Segment do
    defstruct [:segment, :atomics_ref, :name]

    @type t() :: %__MODULE__{
            segment: Electric.Postgres.CachedWal.WalMng.segment_ets(),
            atomics_ref: :atomics.atomics_ref(),
            name: atom()
          }
  end

  defmodule State do
    defstruct [
      :atomics,
      :await_clients,
      :clients_pos,
      :default_quota,
      :default_seg_limit,
      :name,
      :segments,
      :segments_idx,
      :wal_writer
    ]

    @type t() :: %__MODULE__{
            atomics: :atomics.atomics_ref(),
            await_clients: :orddict.orddict(),
            # Pid -> {MonRef, lsn}
            clients_pos: :ets.tid(),
            default_quota: non_neg_integer(),
            default_seg_limit: non_neg_integer(),
            name: atom(),
            # Lsn -> ets:tid()
            # there could not be less then 1 segment at any time
            segments_idx: Electric.Postgres.CachedWal.WalMng.segment_ets(),
            wal_writer: {pid(), reference()} | nil
          }
  end

  @spec start_link([
          {:name, name()}
          | {:quota, pos_integer()}
          | {:seg_limit, pos_integer()}
        ]) :: {:ok, pid()} | {:error, term()}
  def start_link(opts \\ []) do
    name = Keyword.get(opts, :name, __MODULE__)
    GenServer.start_link(__MODULE__, opts, name: name)
  end

  @spec subscribe_client(name()) :: :ok | {:error, term()}
  def subscribe_client(name \\ __MODULE__) do
    GenServer.call(name, {:sub_client}, :infinity)
  end

  @spec unsubscribe_client(pid() | atom()) :: :ok | {:error, term()}
  def unsubscribe_client(name \\ __MODULE__) do
    GenServer.cast(name, {:unsub_client, self()})
  end

  @type name() :: atom()
  @type iter() :: {:begin, lsn(), atom(), atom()} | next_iter()
  @type next_iter() :: {:next, segment_ets(), lsn(), atom(), atom()}

  @spec get_iter(name(), lsn()) ::
          {:ok, term(), next_iter()} | {:await, next_iter()} | {:error, term()}
  def get_iter(name \\ __MODULE__, lsn) when is_integer(lsn) do
    get_next({:begin, lsn, build_seg_idx_name(name), build_cli_idx_name(name)})
  end

  @doc """
  Should be only called by the registered client
  """
  @spec get_next(iter()) ::
          {:ok, term(), next_iter()} | {:await, next_iter()} | {:error, term()}
  def get_next({:begin, lsn, segments_idx, clients_idx}) do
    case find_segment(segments_idx, lsn) do
      {:ok, segment_ets} ->
        get_next({:next, segment_ets, lsn, segments_idx, clients_idx})

      {:error, _} = error ->
        error
    end
  end

  def get_next({:next, segment_ets, lsn, segments_idx, clients_idx} = iter) do
    try do
      fetch_tx_at_position(segment_ets, lsn)
    rescue
      ArgumentError ->
        get_next({:begin, lsn, segments_idx, clients_idx})
    else
      {:ok, data, next_lsn} ->
        # Update client position here, so that the WAL manager may make
        # decisions wherever or not to do GC of the old segments or not
        # based on the decided strategy
        true = record_client_position(clients_idx, self(), next_lsn)
        {:ok, data, {:next, segment_ets, next_lsn, segments_idx, clients_idx}}

      ## We reached the end of the segment, but didn't reach info about
      ## next segment, so we just wait for new tx to appear in the segment
      {:ok, :no_new_data} ->
        {:await, iter}

      {:next_segment, segment_ets} ->
        get_next({:next, segment_ets, lsn, segments_idx, clients_idx})
    end
  end

  # The goal of this function is to find the segments, which beginning lsn is <
  # and closest to the lsn provided.
  @spec find_segment(atom(), lsn()) :: {:ok, segment_ets()} | {:error, term()}
  defp find_segment(segments_idx, lsn) do
    case :ets.prev(segments_idx, lsn) do
      :"$end_of_table" ->
        size = :ets.info(segments_idx, :size)
        # either no segments, or segment that matches lsn
        case :ets.lookup(segments_idx, lsn) do
          [] ->
            case size == 0 do
              true ->
                # No segments created yet
                {:error, :no_available_segment}

              false ->
                # Lsn is too old, and segment that it refereced
                # is no longer valid
                {:error, :stale_lsn}
            end

          [{^lsn, ets}] ->
            {:ok, ets}
        end

      lsn ->
        [{^lsn, ets}] = :ets.lookup(segments_idx, lsn)
        {:ok, ets}
    end
  end

  # This function can raise ArgumentError at any time, due to Segment garbage
  # collection. The calling code needs to make sure, it's gonna retry
  @spec fetch_tx_at_position(segment_ets(), lsn()) ::
          {:ok, :no_new_data} | {:next_segment, segment_ets()} | {:ok, term(), lsn()}
  defp fetch_tx_at_position(segment, lsn) do
    case :ets.next(segment, lsn) do
      :"$end_of_table" ->
        # It might be also that LSN requested is greater then the next_segment
        # record
        case :ets.prev(segment, lsn) do
          :"$end_of_table" ->
            {:ok, :no_new_data}

          new_lsn ->
            case :ets.lookup(segment, new_lsn) do
              [{^new_lsn, {:next_segment, segment_ets}}] ->
                # Next segment lsn is smaller then LSN requested, but it's
                # still larger then the one that is being requested
                {:next_segment, segment_ets}

              [{^new_lsn, _}] ->
                {:ok, :no_new_data}
            end
        end

      next_lsn ->
        case :ets.lookup(segment, next_lsn) do
          [{^next_lsn, {:next_segment, segment_ets}}] ->
            {:next_segment, segment_ets}

          [{^next_lsn, data}] ->
            {:ok, data, next_lsn}
        end
    end
  end

  defp build_seg_idx_name(name), do: build_name(name, :segments_idx)
  defp build_cli_idx_name(name), do: build_name(name, :clients_idx)

  defp build_name(name, role) when is_atom(name) do
    String.to_atom(to_string(name) <> "_" <> to_string(role))
  end

  @spec get_await(name(), next_iter()) :: {:ok, reference()} | {:error, term()}
  def get_await(name \\ __MODULE__, {:next, _, lsn, _, clients_idx}) do
    record_client_position(clients_idx, self(), lsn)
    GenServer.call(name, {:await_lsn, lsn}, :infinity)
  end

  @spec cancel_await(name(), reference()) :: :ok
  def cancel_await(name \\ __MODULE__, reference) do
    GenServer.cast(name, {:await_cancel, reference})
  end

  @spec allocate_new_segment(name(), lsn()) :: {:ok, Segment.t()} | {:error, term()}
  @doc """
  Allocates a new segment for writing data. This function may trigger garbage
  collection in order to free up space for the new segment.

  ## Returns

  - `{:ok, segment}`: If the new segment is successfully allocated,
  where `segment` is a `%Segment{}` struct representing the newly allocated segment.
  - `{:error, reason}`: If the allocation fails for some reason,
  where `reason` is a term describing the error.
  """
  def allocate_new_segment(name \\ __MODULE__, lsn) do
    GenServer.call(name, {:allocate, lsn}, :infinity)
  end

  @doc """
  Retrieves current active `segment` and sets the current process as a
  writer, if an old WAL writer is gone
  """
  @spec get_current_segment(name()) :: {:ok, Segment.t()} | {:error, term()}
  def get_current_segment(name \\ __MODULE__) do
    GenServer.call(name, {:get_current_segment})
  end

  @spec get_last_written_lsn(segment :: Segment.t()) :: lsn()
  @doc """
  Retrieves the LSN of the last written data in the specified `segment`.
  """
  def get_last_written_lsn(%Segment{atomics_ref: atomics}) do
    :atomics.get(atomics, @lsn_idx)
  end

  @spec write_to_segment(segment :: Segment.t(), lsn :: lsn(), data :: term()) ::
          :ok | {:error, :quota_limit}
  @doc """
  Writes the given data to the specified `segment`.

  ## Returns

  - `:ok`: If the write is successful
  - `{:error, :quota_limit}`: If the segment's quota limit has been reached
  and the write cannot be performed. (new segment should be allocated)
  """
  def write_to_segment(
        %Segment{segment: segment_ets, atomics_ref: atomics, name: name},
        lsn,
        data
      ) do
    case :atomics.get(atomics, @quota_idx) do
      n when n > 0 ->
        # Invariant for monotonically increasing LSN.
        case :atomics.exchange(atomics, @lsn_idx, lsn) do
          old_lsn when old_lsn >= lsn ->
            :atomics.put(atomics, @lsn_idx, old_lsn)

            raise RuntimeError,
              message: "Violation of LSN invariant, should be monotonically increasing"

          _ ->
            :ok = :atomics.sub(atomics, @quota_idx, 1)
            true = :ets.insert_new(segment_ets, {lsn, data})

            case check_notification(atomics, lsn) do
              true ->
                GenServer.cast(name, {:await_unblock, lsn})

              false ->
                :ok
            end
        end

      _ ->
        {:error, :quota_limit}
    end
  end

  @spec push_to_segment(name(), Segment.t(), lsn(), term()) :: {:ok, Segment.t()}
  @doc """
  Writes the given data to the specified `segment`. If the segment's quota limit
  has been reached, allocates a new segment and writes to that instead. Allocation
  of a new segment may trigger garbage collection of the old segment if the max
  limit of segments have been reached
  """
  def push_to_segment(name \\ __MODULE__, segment, lsn, data) do
    case write_to_segment(segment, lsn, data) do
      {:error, :quota_limit} ->
        {:ok, new_segment} = allocate_new_segment(name, lsn)
        push_to_segment(name, new_segment, lsn, data)

      :ok ->
        {:ok, segment}
    end
  end

  @doc """
  Returns the number of WAL segments for the given WAL manager
  """
  @spec get_segments_count(name()) :: non_neg_integer()
  def get_segments_count(name \\ __MODULE__) do
    :ets.info(build_seg_idx_name(name), :size)
  end

  # ------------

  @impl GenServer
  def init(opts) do
    name = Keyword.get(opts, :name, __MODULE__)
    segments_ets_name = build_seg_idx_name(name)

    :ets.new(
      segments_ets_name,
      [:ordered_set, :protected, :named_table, {:read_concurrency, true}]
    )

    atomics = :atomics.new(@total_idx_num, [{:signed, false}])

    clients_ets_name = build_cli_idx_name(name)

    :ets.new(
      clients_ets_name,
      [:public, :named_table, {:read_concurrency, true}, {:write_concurrency, true}]
    )

    {:ok,
     %State{
       atomics: atomics,
       await_clients: [],
       clients_pos: clients_ets_name,
       default_quota: Keyword.get(opts, :quota, @segment_single_limit),
       default_seg_limit: Keyword.get(opts, :seg_limit, @segments_max_limit),
       name: name,
       segments_idx: segments_ets_name
     }}
  end

  @impl GenServer
  def handle_call({:sub_client}, {pid, _}, state) do
    case add_client(pid, state) do
      :ok ->
        {:reply, :ok, state}

      {:error, error} ->
        {:reply, {:error, error}, state}
    end
  end

  def handle_call({:allocate, lsn}, _, state) do
    {:ok, segment_ets, state} = allocate_segment(lsn, state)

    {:reply, {:ok, %Segment{segment: segment_ets, atomics_ref: state.atomics, name: state.name}},
     state}
  end

  def handle_call(
        msg = {:get_current_segment},
        {pid, _} = sender,
        state = %State{wal_writer: nil}
      ) do
    mon_ref = Process.monitor(pid)
    handle_call(msg, sender, %State{state | wal_writer: {pid, mon_ref}})
  end

  def handle_call({:get_current_segment}, {pid, _}, %State{wal_writer: {pid, _}} = state) do
    case get_current_segment_internal(state) do
      {:error, _} = error ->
        {:reply, error, state}

      {:ok, {_lsn, segment_ets}} ->
        {:reply,
         {:ok,
          %Segment{
            segment: segment_ets,
            atomics_ref: state.atomics,
            name: state.name
          }}, state}
    end
  end

  def handle_call(
        msg = {:get_current_segment},
        sender,
        state = %State{wal_writer: {pid2, _monref}}
      ) do
    case Process.alive?(pid2) do
      true ->
        {:error, :forbid_multiple_wal_writers}

      false ->
        # Scenario where WAL writer have terminated and restarted, but
        # cached_wal process haven't received DOWN message yet
        handle_call(msg, sender, %State{state | wal_writer: nil})
    end
  end

  def handle_call({:await_lsn, lsn}, {client_pid, _}, %State{await_clients: clients} = state) do
    # Message send by the client

    ref = make_ref()
    clients = [{smallest_lsn, _} | _] = :orddict.append(lsn, {client_pid, ref}, clients)
    set_notification(state.atomics, smallest_lsn)
    {:reply, {:ok, ref}, %State{state | await_clients: clients}}
  end

  def hanle_call(msg, _, state) do
    Logger.error("Unhandled cast message: #{inspect(msg)}")
    {:reply, {:error, :not_implemented}, state}
  end

  @impl GenServer
  def handle_cast({:unsub_client, pid}, state) do
    state = remove_client(pid, state)
    {:noreply, state}
  end

  def handle_cast({:await_unblock, lsn}, %State{await_clients: clients} = state) do
    # Message send by the WAL writer
    remaining =
      Enum.drop_while(clients, fn {await_lsn, l} ->
        case await_lsn <= lsn do
          true ->
            Enum.each(l, fn {pid, ref} -> Process.send(pid, {:wal_ready, ref}, []) end)
            true

          false ->
            false
        end
      end)

    # Commonly at this level `remaning` should be equal to empty list, buf if any
    # clients remain, we need to ask WAL writer to notify again
    case remaining do
      [] ->
        %State{state | await_clients: []}

      [{smallest_lsn, _} | _] ->
        set_notification(state.atomics, smallest_lsn)
        %State{state | await_clients: remaining}
    end
  end

  def handle_cast(msg, _state) do
    Logger.error("Unhandled cast message: #{inspect(msg)}")
  end

  @impl GenServer
  def handle_info({:DOWN, mon_ref, :process, pid, _}, %State{wal_writer: {pid, mon_ref}} = state) do
    {:noreply, %State{state | wal_writer: nil}}
  end

  def handle_info({:DOWN, _mon_ref, :process, pid, _reason}, state) do
    state = remove_client(pid, false, state)
    {:noreply, state}
  end

  def handle_info(msg, _state) do
    Logger.warn("Unhandled info message: #{inspect(msg)}")
  end

  @impl GenServer
  def terminate(_, _) do
    :ok
  end

  # ---------------------

  defp get_current_segment_internal(%State{segments_idx: idx}) do
    case :ets.last(idx) do
      :"$end_of_table" ->
        {:error, :no_active_segment}

      {lsn, segment_ets} ->
        {:ok, {lsn, segment_ets}}
    end
  end

  defp allocate_segment(lsn, %State{segments_idx: segments_idx} = state) do
    segment = :ets.new(:segment, [:ordered_set, :public, {:read_concurrency, true}])

    len = :ets.info(segments_idx, :size)
    :ok = :atomics.put(state.atomics, @quota_idx, state.default_quota)

    cond do
      len == 0 ->
        true = :ets.insert_new(segments_idx, {lsn, segment})

        {:ok, segment, state}

      len == state.default_seg_limit ->
        {last_lsn, last_ets} = get_last(segments_idx)
        true = last_lsn < lsn
        true = :ets.insert_new(last_ets, {lsn, {:next_segment, segment}})
        true = :ets.insert_new(segments_idx, {lsn, segment})
        # Garbage collect is brutal here, we may end in situation when clients
        # are often behind the current uptodate lsn, so we need to decide
        # wherever we want to go with the speed of the PG replication stream, or
        # maybe wait for clients to catch up. Current strategy is to go as fast
        # as replication allows
        {first_lsn, first_ets} = get_first(segments_idx)
        :ets.delete(segments_idx, first_lsn)
        :ets.delete(first_ets)
        {:ok, segment, state}

      true ->
        {last_lsn, last_ets} = get_last(segments_idx)
        true = last_lsn < lsn
        true = :ets.insert_new(last_ets, {lsn, {:next_segment, segment}})
        true = :ets.insert_new(segments_idx, {lsn, segment})
        {:ok, segment, state}
    end
  end

  defp get_last(ets) do
    case :ets.last(ets) do
      :"$end_of_table" ->
        :none

      key ->
        {key, :ets.lookup_element(ets, key, 2)}
    end
  end

  defp get_first(ets) do
    case :ets.first(ets) do
      :"$end_of_table" ->
        :none

      key ->
        {key, :ets.lookup_element(ets, key, 2)}
    end
  end

  defp add_client(pid, %State{clients_pos: ets}) do
    case :ets.insert_new(ets, {pid, nil, @initial_lsn_value}) do
      true ->
        true = :ets.update_element(ets, pid, {2, Process.monitor(pid)})
        :ok

      false ->
        {:error, :already_subscribed}
    end
  end

  defp remove_client(
         pid,
         demonitor \\ true,
         %State{clients_pos: ets, await_clients: clients} = state
       ) do
    clients =
      case demonitor(pid, ets, demonitor) do
        nil ->
          clients

        pos ->
          case :orddict.take(pos, clients) do
            :error ->
              clients

            {[_], clients} ->
              clients

            {list, clients} ->
              :orddict.store(pos, :lists.keydelete(pid, 1, list), clients)
          end
      end

    try do
      :ets.delete(ets, pid)
      %State{state | await_clients: clients}
    rescue
      _ -> %State{state | await_clients: clients}
    end
  end

  @spec demonitor(pid(), atom(), boolean()) :: nil | lsn()
  defp demonitor(pid, ets, demonitor) do
    case :ets.lookup(ets, pid) do
      [{^pid, monref, pos}] ->
        if demonitor do
          Process.demonitor(monref)
        end

        pos

      [] ->
        nil
    end
  end

  defp record_client_position(clients_idx, pid, lsn) do
    true = :ets.update_element(clients_idx, pid, {3, lsn})
  end

  defp set_notification(atomics, lsn) do
    case :atomics.get(atomics, @notify_idx) do
      0 ->
        # no notification requested
        :atomics.exchange(atomics, @notify_idx, lsn)
        true

      old_lsn when old_lsn > lsn ->
        :atomics.exchange(atomics, @notify_idx, lsn)
        true

      old_lsn ->
        false
    end
  end

  defp check_notification(atomics, lsn) do
    case :atomics.get(atomics, @notify_idx) do
      0 ->
        false

      # Server set notification marker, we need to notify
      req_lsn when req_lsn <= lsn ->
        # In case WalMng is setting different value at the moment
        # it will survive this notification
        :atomics.compare_exchange(atomics, @notify_idx, req_lsn, 0)
        true

      # Server set notification marker, but it's far in the future
      _ ->
        false
    end
  end
end
