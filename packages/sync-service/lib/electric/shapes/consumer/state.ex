defmodule Electric.Shapes.Consumer.State do
  @moduledoc false
  alias Electric.Postgres.Xid
  alias Electric.Shapes.Shape
  alias Electric.Replication.Changes.Transaction
  alias Electric.Postgres.SnapshotQuery
  alias Electric.Replication.LogOffset
  alias Electric.ShapeCache.Storage

  require LogOffset

  defstruct [
    :stack_id,
    :shape_handle,
    :shape,
    :hibernate_after,
    :latest_offset,
    :initial_pg_snapshot,
    :storage,
    :writer,
    awaiting_snapshot_start: [],
    buffer: [],
    monitors: [],
    txn_offset_mapping: [],
    snapshot_started?: false,
    materializer_subscribed?: false,
    terminating?: false,
    buffering?: false,
    initial_snapshot_filtering?: true,
    waiting_move_ins: %{},
    filtering_move_ins: [],
    move_in_buffering_snapshot: nil
  ]

  @type pg_snapshot() :: SnapshotQuery.pg_snapshot()
  @type move_in_name() :: String.t()

  @type uninitialized_t() :: %__MODULE__{
          stack_id: Electric.stack_id(),
          shape_handle: Shape.handle(),
          shape: Shape.t(),
          awaiting_snapshot_start: list(GenServer.from()),
          buffer: list(Transaction.t()),
          monitors: list({pid(), reference()}),
          txn_offset_mapping: list({LogOffset.t(), LogOffset.t()}),
          snapshot_started?: boolean(),
          materializer_subscribed?: boolean(),
          terminating?: boolean(),
          buffering?: boolean(),
          initial_snapshot_filtering?: boolean(),
          waiting_move_ins: %{move_in_name() => pg_snapshot()},
          filtering_move_ins: list(Shape.handle()),
          move_in_buffering_snapshot: nil | pg_snapshot(),
          hibernate_after: non_neg_integer(),
          latest_offset: nil,
          initial_pg_snapshot: nil,
          storage: nil,
          writer: nil
        }

  @typedoc """
  State of the consumer process.

  ## Flush notification

  When a transaction is flushed, we need to notify the shape log collector
  with latest written offset. Latest written offset however might not be
  last one in the transaction, so to correctly notify the collector, we need
  to align the offset to the transaction boundary.
  To do this, after processing the transaction we store the mapping from the
  last relevant one to last one generally in the transaction and use that
  to map back the flushed offset to the transaction boundary.

  ## Move-in handling

  There are 3 fields in the state relating to the move-in handling:
  `waiting_move_ins`, `filtering_move_ins`, and `move_in_buffering_snapshot`.

  Once a move-in is necessary, we immeidately query the DB for the snapshot,
  and store it in `waiting_move_ins` until we know the affected key set for this
  move-in (possible only when entire query resolves). If a transaction is not a
  part of any of these "waiting" move-in snapshots, we cannot apply it yet
  and so we start buffering. In order to avoid walking the `waiting_move_ins`
  map every time, we instead construct a "buffering snapshot" which is a union
  of all the "waiting" move-in snapshots. This is stored in `move_in_buffering_snapshot`
  and is updated when anything is added to or removed from `waiting_move_ins`.

  Once we have the affected key set, we can move the move-in to `filtering_move_ins`.
  Filtering logic is described elsewhere.

  ## Buffering

  Consumer will be buffering transactions in 2 cases: when we're waiting for initial
  snapshot information, or when we can't reason about the change in context of a move-in.

  Buffer is stored in reverse order.
  """
  @type t() :: %__MODULE__{
          stack_id: Electric.stack_id(),
          shape_handle: Shape.handle(),
          shape: Shape.t(),
          awaiting_snapshot_start: list(GenServer.from()),
          buffer: list(Transaction.t()),
          monitors: list({pid(), reference()}),
          txn_offset_mapping: list({LogOffset.t(), LogOffset.t()}),
          snapshot_started?: boolean(),
          materializer_subscribed?: boolean(),
          terminating?: boolean(),
          buffering?: boolean(),
          initial_snapshot_filtering?: boolean(),
          waiting_move_ins: %{move_in_name() => pg_snapshot()},
          filtering_move_ins: list(Shape.handle()),
          move_in_buffering_snapshot: nil | pg_snapshot(),
          hibernate_after: non_neg_integer(),
          latest_offset: LogOffset.t(),
          initial_pg_snapshot: nil | pg_snapshot(),
          storage: Storage.shape_storage(),
          writer: Storage.writer_state()
        }

  @spec new(Electric.stack_id(), Shape.handle(), Shape.t()) :: uninitialized_t()
  def new(stack_id, shape_handle, shape) do
    %__MODULE__{
      stack_id: stack_id,
      shape_handle: shape_handle,
      shape: shape,
      hibernate_after: Electric.StackConfig.lookup(stack_id, :shape_hibernate_after),
      buffering?: true
    }
  end

  @doc """
  After the storage is ready, initialize the state with info from storage and writer state.
  """
  @spec initialize(uninitialized_t(), Storage.shape_storage(), Storage.writer_state()) :: t()
  def initialize(%__MODULE__{} = state, storage, writer) do
    {:ok, latest_offset, pg_snapshot} = Storage.get_current_position(storage)

    # When writing the snapshot initially, we don't know ahead of time the real last offset for the
    # shape, so we use `0_inf` essentially as a pointer to the end of all possible snapshot chunks,
    # however many there may be. That means the clients will be using that as the latest offset.
    # In order to avoid confusing the clients, we make sure that we preserve that functionality
    # across a restart by setting the latest offset to `0_inf` if there were no real offsets yet.
    normalized_latest_offset =
      if LogOffset.is_virtual_offset(latest_offset),
        do: LogOffset.last_before_real_offsets(),
        else: latest_offset

    {pg_snapshot, filtering?} =
      case pg_snapshot do
        nil ->
          {nil, true}

        %{xmin: xmin, xmax: xmax, xip_list: xip_list} ->
          {{xmin, xmax, xip_list}, Map.get(pg_snapshot, :filter_txns?, true)}
      end

    %__MODULE__{
      state
      | latest_offset: normalized_latest_offset,
        initial_pg_snapshot: pg_snapshot,
        storage: storage,
        writer: writer,
        buffering?: is_nil(pg_snapshot),
        initial_snapshot_filtering?: filtering?
    }
  end

  @doc """
  Add information about a new move-in to the state for which we're waiting
  and update the buffering boundary.
  """
  @spec add_waiting_move_in(t(), move_in_name(), pg_snapshot()) :: t()
  def add_waiting_move_in(%__MODULE__{waiting_move_ins: waiting_move_ins} = state, name, snapshot) do
    new_waiting_move_ins = Map.put(waiting_move_ins, name, snapshot)
    new_buffering_snapshot = make_move_in_buffering_snapshot(new_waiting_move_ins)

    %{
      state
      | waiting_move_ins: new_waiting_move_ins,
        move_in_buffering_snapshot: new_buffering_snapshot
    }
  end

  @spec make_move_in_buffering_snapshot(%{move_in_name() => pg_snapshot()}) :: nil | pg_snapshot()
  # The fake global snapshot allows us to check if a transaction is not visible in any of the pending snapshots
  # instead of checking each snapshot individually.
  defp make_move_in_buffering_snapshot(waiting_move_ins) when waiting_move_ins == %{}, do: nil

  defp make_move_in_buffering_snapshot(waiting_move_ins) do
    waiting_move_ins
    |> Map.values()
    |> Enum.reduce({:infinity, -1, []}, fn {xmin, xmax, xip_list},
                                           {global_xmin, global_xmax, global_xip_list} ->
      {Kernel.min(global_xmin, xmin), Kernel.max(global_xmax, xmax), global_xip_list ++ xip_list}
    end)
  end

  @doc """
  Change a move-in from "waiting" to "filtering" and update the buffering boundary.
  """
  @spec change_move_in_to_filtering(t(), move_in_name(), list(String.t())) :: t()
  def change_move_in_to_filtering(%__MODULE__{} = state, name, key_set) do
    {snapshot, waiting_move_ins} = Map.pop!(state.waiting_move_ins, name)
    filtering_move_ins = [{snapshot, key_set} | state.filtering_move_ins]
    buffering_snapshot = make_move_in_buffering_snapshot(waiting_move_ins)

    %{
      state
      | waiting_move_ins: waiting_move_ins,
        filtering_move_ins: filtering_move_ins,
        move_in_buffering_snapshot: buffering_snapshot
    }
  end

  @doc """
  Remove completed move-ins from the state.

  Move-in is considered "completed" (i.e. not included in the filtering logic)
  once we see any transaction that is after the end of the move-in snapshot.

  Filtering generally is applied only to transactions that are already visible
  in the snapshot, and those can only be with `xid < xmax`.
  """
  @spec remove_completed_move_ins(t(), Transaction.t()) :: t()
  def remove_completed_move_ins(%__MODULE__{} = state, %Transaction{xid: xid}) do
    state.filtering_move_ins
    |> Enum.reject(fn {snapshot, _} -> Xid.after_snapshot?(xid, snapshot) end)
    |> then(&%{state | filtering_move_ins: &1})
  end

  @doc """
  For the given offset, find the appropriate transaction boundary and
  remove all transactions that are less than or equal to the boundary.
  """
  @spec align_offset_to_txn_boundary(t(), LogOffset.t()) :: {t(), LogOffset.t()}
  def align_offset_to_txn_boundary(
        %__MODULE__{txn_offset_mapping: txn_offset_mapping} = state,
        offset
      ) do
    case Enum.drop_while(txn_offset_mapping, &(LogOffset.compare(elem(&1, 0), offset) == :lt)) do
      [{^offset, boundary} | rest] ->
        {%{state | txn_offset_mapping: rest}, boundary}

      rest ->
        {%{state | txn_offset_mapping: rest}, offset}
    end
  end

  @doc """
  Add a process to be notified of any changes to the shape.
  """
  @spec add_monitor(t(), pid(), reference()) :: t()
  def add_monitor(%__MODULE__{monitors: monitors} = state, pid, ref) do
    %{state | monitors: [{pid, ref} | monitors]}
  end

  @spec set_initial_snapshot(t(), pg_snapshot()) :: t()
  def set_initial_snapshot(
        %__MODULE__{initial_pg_snapshot: nil} = state,
        {xmin, xmax, xip_list} = snapshot
      ) do
    # We're not changing snapshot storage format for backwards compatibility.
    Storage.set_pg_snapshot(
      %{xmin: xmin, xmax: xmax, xip_list: xip_list, filter_txns?: true},
      state.storage
    )

    %{state | initial_pg_snapshot: snapshot, initial_snapshot_filtering?: true, buffering?: false}
  end

  @spec add_to_buffer(t(), Transaction.t()) :: t()
  def add_to_buffer(%__MODULE__{buffer: buffer} = state, txn) do
    %{state | buffer: [txn | buffer]}
  end

  @spec maybe_stop_initial_filtering(t(), Transaction.t()) :: t()
  def maybe_stop_initial_filtering(
        %__MODULE__{initial_pg_snapshot: {xmin, xmax, xip_list} = snapshot} = state,
        %Transaction{xid: xid}
      ) do
    if Xid.after_snapshot?(xid, snapshot) do
      Storage.set_pg_snapshot(
        %{xmin: xmin, xmax: xmax, xip_list: xip_list, filter_txns?: false},
        state.storage
      )

      %{state | initial_snapshot_filtering?: false}
    else
      state
    end
  end

  @spec initial_snapshot_xmin(t()) :: nil | Xid.anyxid()
  def initial_snapshot_xmin(%__MODULE__{initial_pg_snapshot: {xmin, _, _}}), do: xmin
  def initial_snapshot_xmin(%__MODULE__{initial_pg_snapshot: nil}), do: nil

  def set_snapshot_started(%__MODULE__{snapshot_started?: true} = state), do: state

  def set_snapshot_started(%__MODULE__{} = state) do
    Storage.mark_snapshot_as_started(state.storage)
    %{state | snapshot_started?: true}
  end
end
