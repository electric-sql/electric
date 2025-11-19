defmodule Electric.Shapes.Consumer.State do
  @moduledoc """
  State for the Consumer process.

  This module manages the consumer's state, including buffering coordination
  for initial snapshots and move-in operations.

  ## Flush notification

  When a transaction is flushed, we need to notify the shape log collector
  with latest written offset. Latest written offset however might not be
  last one in the transaction, so to correctly notify the collector, we need
  to align the offset to the transaction boundary.
  To do this, after processing the transaction we store the mapping from the
  last relevant one to last one generally in the transaction and use that
  to map back the flushed offset to the transaction boundary.

  ## Buffering

  Buffering logic is now centralized in the BufferingCoordinator, which handles:
  - Initial snapshot filtering
  - Move-in operation buffering and filtering
  - Transaction visibility decisions

  Buffer is stored in reverse order.
  """

  alias Electric.Shapes.Shape
  alias Electric.Replication.Changes.Transaction
  alias Electric.Replication.LogOffset
  alias Electric.ShapeCache.Storage
  alias Electric.Shapes.Consumer.BufferingCoordinator
  alias Electric.Shapes.Consumer.MoveInOperation

  require LogOffset

  defstruct [
    :stack_id,
    :shape_handle,
    :shape,
    :hibernate_after,
    :latest_offset,
    :storage,
    :writer,
    :coordinator,
    awaiting_snapshot_start: [],
    buffer: [],
    monitors: [],
    txn_offset_mapping: [],
    snapshot_started?: false,
    materializer_subscribed?: false,
    terminating?: false
  ]

  @type t() :: %__MODULE__{
          stack_id: Electric.stack_id(),
          shape_handle: Shape.handle(),
          shape: Shape.t(),
          hibernate_after: non_neg_integer(),
          latest_offset: LogOffset.t() | nil,
          storage: Storage.shape_storage() | nil,
          writer: Storage.writer_state() | nil,
          coordinator: BufferingCoordinator.t(),
          awaiting_snapshot_start: list(GenServer.from()),
          buffer: list(Transaction.t()),
          monitors: list({pid(), reference()}),
          txn_offset_mapping: list({LogOffset.t(), LogOffset.t()}),
          snapshot_started?: boolean(),
          materializer_subscribed?: boolean(),
          terminating?: boolean()
        }

  @spec new(Electric.stack_id(), Shape.handle(), Shape.t()) :: t()
  def new(stack_id, shape_handle, shape) do
    %__MODULE__{
      stack_id: stack_id,
      shape_handle: shape_handle,
      shape: shape,
      hibernate_after: Electric.StackConfig.lookup(stack_id, :shape_hibernate_after),
      coordinator: BufferingCoordinator.new()
    }
  end

  @doc """
  After the storage is ready, initialize the state with info from storage and writer state.
  """
  @spec initialize(t(), Storage.shape_storage(), Storage.writer_state()) :: t()
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

    coordinator = BufferingCoordinator.initialize(state.coordinator, pg_snapshot, filtering?)

    %__MODULE__{
      state
      | latest_offset: normalized_latest_offset,
        storage: storage,
        writer: writer,
        coordinator: coordinator
    }
  end

  @doc """
  Add information about a new move-in to the state.
  """
  @spec add_move_in_operation(t(), MoveInOperation.t()) :: t()
  def add_move_in_operation(%__MODULE__{coordinator: coord} = state, op) do
    %{state | coordinator: BufferingCoordinator.add_move_in(coord, op)}
  end

  @doc """
  Change a move-in from "waiting" to "filtering" and update the buffering boundary.
  """
  @spec complete_move_in(t(), MoveInOperation.name(), list(String.t())) :: t()
  def complete_move_in(%__MODULE__{coordinator: coord} = state, name, key_set) do
    %{state | coordinator: BufferingCoordinator.complete_move_in(coord, name, key_set)}
  end

  @doc """
  Remove completed move-ins from the state.
  """
  @spec cleanup_completed_move_ins(t(), Transaction.t()) :: t()
  def cleanup_completed_move_ins(%__MODULE__{coordinator: coord} = state, txn) do
    %{state | coordinator: BufferingCoordinator.cleanup_completed_ops(coord, txn)}
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

  @doc """
  Sets the initial snapshot and stops buffering.
  """
  @spec set_initial_snapshot(t(), BufferingCoordinator.pg_snapshot()) :: t()
  def set_initial_snapshot(%__MODULE__{coordinator: coord} = state, snapshot) do
    {xmin, xmax, xip_list} = snapshot

    # We're not changing snapshot storage format for backwards compatibility.
    Storage.set_pg_snapshot(
      %{xmin: xmin, xmax: xmax, xip_list: xip_list, filter_txns?: true},
      state.storage
    )

    %{state | coordinator: BufferingCoordinator.set_initial_snapshot(coord, snapshot)}
  end

  @doc """
  Adds a transaction to the buffer.
  """
  @spec add_to_buffer(t(), Transaction.t()) :: t()
  def add_to_buffer(%__MODULE__{buffer: buffer} = state, txn) do
    %{state | buffer: [txn | buffer]}
  end

  @doc """
  Stops buffering mode. Called when ready to process buffered transactions.
  """
  @spec stop_buffering(t()) :: t()
  def stop_buffering(%__MODULE__{coordinator: coord} = state) do
    %{state | coordinator: BufferingCoordinator.stop_buffering(coord)}
  end

  @doc """
  Starts buffering mode.
  """
  @spec start_buffering(t()) :: t()
  def start_buffering(%__MODULE__{coordinator: coord} = state) do
    %{state | coordinator: BufferingCoordinator.start_buffering(coord)}
  end

  @doc """
  Stops initial snapshot filtering for transactions beyond the snapshot.
  """
  @spec maybe_stop_initial_filtering(t(), Transaction.t()) :: t()
  def maybe_stop_initial_filtering(%__MODULE__{coordinator: coord} = state, txn) do
    new_coord = BufferingCoordinator.maybe_stop_initial_filtering(coord, txn)

    # Update storage if filtering was stopped
    if BufferingCoordinator.initial_filtering?(coord) and
         not BufferingCoordinator.initial_filtering?(new_coord) do
      case BufferingCoordinator.initial_snapshot_xmin(new_coord) do
        nil ->
          :ok

        xmin ->
          {^xmin, xmax, xip_list} = coord.initial_snapshot

          Storage.set_pg_snapshot(
            %{xmin: xmin, xmax: xmax, xip_list: xip_list, filter_txns?: false},
            state.storage
          )
      end
    end

    %{state | coordinator: new_coord}
  end

  @doc """
  Returns the buffering decision for a transaction.
  """
  @spec check_transaction(t(), Transaction.t()) ::
          :buffer | :process | :filter_initial
  def check_transaction(%__MODULE__{coordinator: coord}, txn) do
    BufferingCoordinator.check_transaction(coord, txn)
  end

  @doc """
  Returns true if a change should be filtered out.
  """
  @spec should_filter_change?(t(), Transaction.t(), String.t()) :: boolean()
  def should_filter_change?(%__MODULE__{coordinator: coord}, txn, key) do
    BufferingCoordinator.should_filter_change?(coord, txn, key)
  end

  @doc """
  Returns the initial snapshot's xmin, or nil if no snapshot set.
  """
  @spec initial_snapshot_xmin(t()) :: term() | nil
  def initial_snapshot_xmin(%__MODULE__{coordinator: coord}) do
    BufferingCoordinator.initial_snapshot_xmin(coord)
  end

  @doc """
  Marks the snapshot as started.
  """
  @spec set_snapshot_started(t()) :: t()
  def set_snapshot_started(%__MODULE__{snapshot_started?: true} = state), do: state

  def set_snapshot_started(%__MODULE__{} = state) do
    Storage.mark_snapshot_as_started(state.storage)
    %{state | snapshot_started?: true}
  end
end
