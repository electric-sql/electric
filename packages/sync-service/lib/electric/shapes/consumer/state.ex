defmodule Electric.Shapes.Consumer.State do
  @moduledoc false
  alias Electric.Shapes.Consumer.MoveIns
  alias Electric.Shapes.Consumer.InitialSnapshot
  alias Electric.Shapes.Shape
  alias Electric.Replication.Eval.Parser
  alias Electric.Replication.Eval.Walker
  alias Electric.Replication.TransactionBuilder
  alias Electric.Postgres.SnapshotQuery
  alias Electric.Replication.LogOffset
  alias Electric.ShapeCache.Storage

  require Logger
  require LogOffset

  @write_unit_txn :txn
  @write_unit_txn_fragment :txn_fragment

  defstruct [
    :stack_id,
    :shape_handle,
    :shape,
    :hibernate_after,
    :latest_offset,
    :storage,
    :writer,
    initial_snapshot_state: InitialSnapshot.new(nil),
    move_handling_state: MoveIns.new(),
    transaction_builder: TransactionBuilder.new(),
    buffer: [],
    txn_offset_mapping: [],
    materializer_subscribed?: false,
    terminating?: false,
    buffering?: false,
    or_with_subquery?: false,
    not_with_subquery?: false,
    # Based on the write unit value, consumer will either buffer txn fragments in memory until
    # it sees a commit (write_unit=txn) or it will write each received txn fragment to storage
    # immediately (write_unit=txn_fragment).
    # When true, stream fragments directly to storage without buffering
    write_unit: @write_unit_txn,
    # Tracks in-progress transaction, initialized when a txn fragment with has_begin?=true is seen.
    # It is used to check whether the entire txn is visible in the snapshot and to mark it
    # as flushed in order to handle its remaining fragments appropriately.
    pending_txn: nil
  ]

  @type pg_snapshot() :: SnapshotQuery.pg_snapshot()
  @type move_in_name() :: String.t()

  @type uninitialized_t() :: term()
  # @type uninitialized_t() :: %__MODULE__{
  #         stack_id: Electric.stack_id(),
  #         shape_handle: Shape.handle(),
  #         shape: Shape.t(),
  #         awaiting_snapshot_start: list(GenServer.from()),
  #         buffer: list(Transaction.t()),
  #         monitors: list({pid(), reference()}),
  #         txn_offset_mapping: list({LogOffset.t(), LogOffset.t()}),
  #         snapshot_started?: boolean(),
  #         materializer_subscribed?: boolean(),
  #         terminating?: boolean(),
  #         buffering?: boolean(),
  #         initial_snapshot_filtering?: boolean(),
  #         waiting_move_ins: %{move_in_name() => pg_snapshot()},
  #         filtering_move_ins: list(Shape.handle()),
  #         move_in_buffering_snapshot: nil | pg_snapshot(),
  #         hibernate_after: non_neg_integer(),
  #         latest_offset: nil,
  #         initial_pg_snapshot: nil,
  #         storage: nil,
  #         writer: nil
  #       }

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
  @type t() :: term()
  # @type t() :: %__MODULE__{
  #         stack_id: Electric.stack_id(),
  #         shape_handle: Shape.handle(),
  #         shape: Shape.t(),
  #         awaiting_snapshot_start: list(GenServer.from()),
  #         buffer: list(Transaction.t()),
  #         monitors: list({pid(), reference()}),
  #         txn_offset_mapping: list({LogOffset.t(), LogOffset.t()}),
  #         snapshot_started?: boolean(),
  #         materializer_subscribed?: boolean(),
  #         terminating?: boolean(),
  #         buffering?: boolean(),
  #         initial_snapshot_filtering?: boolean(),
  #         waiting_move_ins: %{move_in_name() => pg_snapshot()},
  #         filtering_move_ins: list(Shape.handle()),
  #         move_in_buffering_snapshot: nil | pg_snapshot(),
  #         hibernate_after: non_neg_integer(),
  #         latest_offset: LogOffset.t(),
  #         initial_pg_snapshot: nil | pg_snapshot(),
  #         storage: Storage.shape_storage(),
  #         writer: Storage.writer_state()
  #       }

  defguard is_snapshot_started(state)
           when is_struct(state.initial_snapshot_state, InitialSnapshot) and
                  state.initial_snapshot_state.snapshot_started?

  defguard needs_initial_filtering(state)
           when is_struct(state.initial_snapshot_state, InitialSnapshot) and
                  state.initial_snapshot_state.filtering?

  @spec new(Electric.stack_id(), Shape.handle(), Shape.t()) :: uninitialized_t()
  def new(stack_id, shape_handle, shape) do
    stack_id
    |> new(shape_handle)
    |> initialize_shape(shape, %{})
  end

  @spec new(Electric.stack_id(), Shape.handle()) :: uninitialized_t()
  def new(stack_id, shape_handle) do
    %__MODULE__{
      stack_id: stack_id,
      shape_handle: shape_handle,
      hibernate_after:
        Electric.StackConfig.lookup(
          stack_id,
          :shape_hibernate_after,
          Electric.Config.default(:shape_hibernate_after)
        ),
      buffering?: true
    }
  end

  @spec initialize_shape(uninitialized_t(), Shape.t(), map()) :: uninitialized_t()
  def initialize_shape(%__MODULE__{} = state, shape, opts) do
    %{
      state
      | shape: shape,
        or_with_subquery?: has_or_with_subquery?(shape),
        not_with_subquery?: has_not_with_subquery?(shape),
        # Enable direct fragment-to-storage streaming for shapes without subquery dependencies
        # and if the current shape itself isn't an inner shape of a shape with subqueries.
        write_unit:
          if Map.get(opts, :subqueries_enabled_for_stack?, false) or
               shape.shape_dependencies != [] or Map.get(opts, :is_subquery_shape?, false) do
            @write_unit_txn
          else
            @write_unit_txn_fragment
          end
    }
  end

  defp has_or_with_subquery?(%Shape{shape_dependencies: []}), do: false
  defp has_or_with_subquery?(%Shape{where: nil}), do: false

  defp has_or_with_subquery?(%Shape{where: where}) do
    Walker.reduce!(
      where.eval,
      fn
        %Parser.Func{name: "or"} = or_node, acc, _ctx ->
          if subtree_has_sublink?(or_node) do
            {:ok, true}
          else
            {:ok, acc}
          end

        _node, acc, _ctx ->
          {:ok, acc}
      end,
      false
    )
  end

  defp subtree_has_sublink?(tree) do
    Walker.reduce!(
      tree,
      fn
        %Parser.Ref{path: ["$sublink", _]}, _acc, _ctx ->
          {:ok, true}

        _node, acc, _ctx ->
          {:ok, acc}
      end,
      false
    )
  end

  defp has_not_with_subquery?(%Shape{shape_dependencies: []}), do: false
  defp has_not_with_subquery?(%Shape{where: nil}), do: false

  defp has_not_with_subquery?(%Shape{where: where}) do
    Walker.reduce!(
      where.eval,
      fn
        %Parser.Func{name: "not"} = not_node, acc, _ctx ->
          if subtree_has_sublink?(not_node) do
            {:ok, true}
          else
            {:ok, acc}
          end

        _node, acc, _ctx ->
          {:ok, acc}
      end,
      false
    )
  end

  @doc """
  After the storage is ready, initialize the state with info from storage and writer state.
  """
  @spec initialize(uninitialized_t(), Storage.shape_storage(), Storage.writer_state()) :: t()
  def initialize(%__MODULE__{} = state, storage, writer) do
    %__MODULE__{} = state = validate_storage_capabilities(state, storage)

    {:ok, latest_offset} = Storage.fetch_latest_offset(storage)
    {:ok, pg_snapshot} = Storage.fetch_pg_snapshot(storage)

    initial_snapshot_state = InitialSnapshot.new(pg_snapshot)

    %__MODULE__{
      state
      | latest_offset: latest_offset,
        storage: storage,
        writer: writer,
        initial_snapshot_state: initial_snapshot_state,
        buffering?: InitialSnapshot.needs_buffering?(initial_snapshot_state)
    }
  end

  defp validate_storage_capabilities(
         %__MODULE__{write_unit: @write_unit_txn_fragment} = state,
         storage
       ) do
    if Storage.supports_txn_fragment_streaming?(storage) do
      state
    else
      {mod, _opts} = storage

      Logger.warning(
        "Storage backend #{inspect(mod)} does not support txn fragment streaming. " <>
          "Falling back to full-transaction buffering for shape #{state.shape_handle}. " <>
          "Use PureFileStorage for optimal performance with fragment streaming."
      )

      %{state | write_unit: @write_unit_txn}
    end
  end

  defp validate_storage_capabilities(state, _storage), do: state

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

  @spec add_to_buffer(t(), TransactionFragment.t()) :: t()
  def add_to_buffer(%__MODULE__{buffer: buffer} = state, txn) do
    %{state | buffer: [txn | buffer]}
  end

  @spec pop_buffered(t()) :: {[TransactionFragment.t()], t()}
  def pop_buffered(%__MODULE__{buffer: buffer} = state) do
    {Enum.reverse(buffer), %{state | buffer: [], buffering?: false}}
  end

  @spec add_waiter(t(), GenServer.from()) :: t()
  def add_waiter(%__MODULE__{initial_snapshot_state: initial_snapshot_state} = state, from) do
    %{
      state
      | initial_snapshot_state: InitialSnapshot.add_waiter(initial_snapshot_state, from)
    }
  end

  def set_initial_snapshot(
        %__MODULE__{initial_snapshot_state: initial_snapshot_state} = state,
        snapshot
      ) do
    initial_snapshot_state =
      InitialSnapshot.set_initial_snapshot(initial_snapshot_state, state.storage, snapshot)

    %{
      state
      | initial_snapshot_state: initial_snapshot_state,
        buffering?: InitialSnapshot.needs_buffering?(initial_snapshot_state)
    }
  end

  def mark_snapshot_started(%__MODULE__{initial_snapshot_state: initial_snapshot_state} = state) do
    initial_snapshot_state =
      InitialSnapshot.mark_snapshot_started(
        initial_snapshot_state,
        state.stack_id,
        state.shape_handle,
        state.storage
      )

    %{state | initial_snapshot_state: initial_snapshot_state}
  end

  def reply_to_snapshot_waiters(state, reason) do
    initial_snapshot_state =
      InitialSnapshot.reply_to_waiters(state.initial_snapshot_state, reason)

    %{state | initial_snapshot_state: initial_snapshot_state}
  end

  def initial_snapshot_xmin(%__MODULE__{initial_snapshot_state: %{pg_snapshot: {xmin, _, _}}}),
    do: xmin

  def initial_snapshot_xmin(%__MODULE__{}), do: nil

  @doc """
  Track a change in the touch tracker.
  """
  @spec track_change(t(), pos_integer(), Electric.Replication.Changes.change()) :: t()
  def track_change(%__MODULE__{move_handling_state: move_handling_state} = state, xid, change) do
    %{state | move_handling_state: MoveIns.track_touch(move_handling_state, xid, change)}
  end

  @doc """
  Garbage collect touches that are visible in all pending snapshots.
  """
  @spec gc_touch_tracker(t()) :: t()
  def gc_touch_tracker(%__MODULE__{move_handling_state: move_handling_state} = state) do
    %{
      state
      | move_handling_state: MoveIns.gc_touch_tracker(move_handling_state)
    }
  end

  def remove_completed_move_ins(
        %__MODULE__{move_handling_state: move_handling_state} = state,
        xid
      ) do
    %{state | move_handling_state: MoveIns.remove_completed(move_handling_state, xid)}
  end

  def telemetry_attrs(%__MODULE__{stack_id: stack_id, shape_handle: shape_handle, shape: shape}) do
    [
      "shape.handle": shape_handle,
      "shape.root_table": shape.root_table,
      "shape.where": if(not is_nil(shape.where), do: shape.where.query, else: nil),
      stack_id: stack_id
    ]
  end

  def write_unit_txn, do: @write_unit_txn
  def write_unit_txn_fragment, do: @write_unit_txn_fragment
end
