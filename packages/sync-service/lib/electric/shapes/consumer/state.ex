defmodule Electric.Shapes.Consumer.State do
  @moduledoc false
  alias Electric.Shapes.Consumer.InitialSnapshot
  alias Electric.Shapes.Shape
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
    event_handler: nil,
    transaction_builder: TransactionBuilder.new(),
    buffer: [],
    txn_offset_mapping: [],
    materializer_subscribed?: false,
    terminating?: false,
    buffering?: false,
    # Based on the write unit value, consumer will either buffer txn fragments in memory until
    # it sees a commit (write_unit=txn) or it will write each received txn fragment to storage
    # immediately (write_unit=txn_fragment).
    # When true, stream fragments directly to storage without buffering
    write_unit: @write_unit_txn,
    # Tracks in-progress transaction, initialized when a txn fragment with has_begin?=true is seen.
    # It is used to check whether the entire txn is visible in the snapshot and to mark it
    # as flushed in order to handle its remaining fragments appropriately.
    pending_txn: nil,
    # When a {Storage, :flushed, offset} message arrives during a pending
    # transaction, we defer the notification and store the max flushed offset
    # here. Multiple deferred notifications are collapsed into a single most recent offset.
    pending_flush_offset: nil,
    # Generation counter for suspend timers - incremented each time we schedule
    # a new suspend timer. When a timer fires, it checks if its generation matches
    # the current one; if not, activity occurred and the timer is stale (ignored).
    suspend_generation: 0,
    # How long after hibernation to suspend (in ms)
    suspend_after: nil
  ]

  @type pg_snapshot() :: SnapshotQuery.pg_snapshot()
  @type uninitialized_t() :: term()

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

  ## Buffering

  Consumer will be buffering transactions in 2 cases: when we're waiting for initial
  snapshot information, or when an active subquery move-in is being spliced into the log.

  Buffer is stored in reverse order.
  """
  @type t() :: term()

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
      suspend_after:
        Electric.StackConfig.lookup(
          stack_id,
          :shape_suspend_after,
          Electric.Config.default(:shape_suspend_after)
        ),
      buffering?: true
    }
  end

  @spec initialize_shape(uninitialized_t(), Shape.t(), map()) :: uninitialized_t()
  def initialize_shape(%__MODULE__{} = state, shape, opts) do
    feature_flags = Map.get(opts, :feature_flags, [])
    is_subquery_shape? = Map.get(opts, :is_subquery_shape?, false)

    %{
      state
      | shape: shape,
        # Enable direct fragment-to-storage streaming for shapes without subquery dependencies
        # and if the current shape itself isn't an inner shape of a shape with subqueries.
        write_unit:
          if "allow_subqueries" in feature_flags or shape.shape_dependencies != [] or
               is_subquery_shape? do
            @write_unit_txn
          else
            @write_unit_txn_fragment
          end
    }
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

  def telemetry_attrs(%__MODULE__{stack_id: stack_id, shape_handle: shape_handle, shape: shape}) do
    [
      "shape.handle": shape_handle,
      "shape.root_table": shape.root_table,
      "shape.where": if(not is_nil(shape.where), do: shape.where.query, else: nil),
      stack_id: stack_id
    ]
  end

  defguard is_write_unit_txn(write_unit) when write_unit == @write_unit_txn
  defguard is_write_unit_txn_fragment(write_unit) when write_unit == @write_unit_txn_fragment
end
