defmodule Electric.Shapes.Consumer.ConsumerContext do
  @moduledoc """
  Pure data structure for Consumer process state.

  Contains no business logic - just holds the consumer's data and configuration.
  All mutations return a new context.
  """

  alias Electric.Shapes.Shape
  alias Electric.Replication.Changes.Transaction
  alias Electric.Replication.LogOffset
  alias Electric.ShapeCache.Storage
  alias Electric.Shapes.Consumer.BufferingCoordinator

  defstruct [
    # Core identifiers
    :stack_id,
    :shape_handle,
    :shape,

    # Storage
    :storage,
    :writer,
    :latest_offset,

    # Coordination
    :coordinator,

    # Transaction buffering
    buffer: [],
    txn_offset_mapping: [],

    # Lifecycle flags
    snapshot_started?: false,
    materializer_subscribed?: false,
    terminating?: false,

    # Synchronization
    awaiting_snapshot_start: [],
    monitors: [],

    # Configuration
    :hibernate_after
  ]

  @type t() :: %__MODULE__{
          stack_id: Electric.stack_id(),
          shape_handle: Shape.handle(),
          shape: Shape.t(),
          storage: Storage.shape_storage() | nil,
          writer: Storage.writer_state() | nil,
          latest_offset: LogOffset.t() | nil,
          coordinator: BufferingCoordinator.t(),
          buffer: list(Transaction.t()),
          txn_offset_mapping: list({LogOffset.t(), LogOffset.t()}),
          snapshot_started?: boolean(),
          materializer_subscribed?: boolean(),
          terminating?: boolean(),
          awaiting_snapshot_start: list(GenServer.from()),
          monitors: list({pid(), reference()}),
          hibernate_after: non_neg_integer()
        }

  @doc """
  Creates a new consumer context with minimal initialization.
  """
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
  Adds a transaction to the buffer.
  """
  @spec buffer_transaction(t(), Transaction.t()) :: t()
  def buffer_transaction(%__MODULE__{buffer: buffer} = ctx, txn) do
    %{ctx | buffer: [txn | buffer]}
  end

  @doc """
  Clears the buffer and returns the buffered transactions (in reverse order).
  """
  @spec clear_buffer(t()) :: {t(), list(Transaction.t())}
  def clear_buffer(%__MODULE__{buffer: buffer} = ctx) do
    {%{ctx | buffer: []}, buffer}
  end

  @doc """
  Adds a monitor for transaction processing.
  """
  @spec add_monitor(t(), pid(), reference()) :: t()
  def add_monitor(%__MODULE__{monitors: monitors} = ctx, pid, ref) do
    %{ctx | monitors: [{pid, ref} | monitors]}
  end

  @doc """
  Records a transaction offset mapping for flush alignment.
  """
  @spec add_txn_offset_mapping(t(), LogOffset.t(), LogOffset.t()) :: t()
  def add_txn_offset_mapping(%__MODULE__{txn_offset_mapping: mapping} = ctx, shape_offset, txn_offset) do
    %{ctx | txn_offset_mapping: mapping ++ [{shape_offset, txn_offset}]}
  end

  @doc """
  Aligns an offset to a transaction boundary.
  """
  @spec align_offset_to_txn_boundary(t(), LogOffset.t()) :: {t(), LogOffset.t()}
  def align_offset_to_txn_boundary(%__MODULE__{txn_offset_mapping: mapping} = ctx, offset) do
    case Enum.drop_while(mapping, &(LogOffset.compare(elem(&1, 0), offset) == :lt)) do
      [{^offset, boundary} | rest] ->
        {%{ctx | txn_offset_mapping: rest}, boundary}

      rest ->
        {%{ctx | txn_offset_mapping: rest}, offset}
    end
  end
end
