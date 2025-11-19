defmodule Electric.Shapes.Consumer.BufferingCoordinator do
  @moduledoc """
  Coordinates transaction buffering and filtering decisions across multiple concerns:
  - Initial snapshot filtering (transactions visible in initial pg_snapshot)
  - Move-in operation buffering (waiting for query completion)
  - Move-in filtering (excluding changes already in move-in snapshots)

  This module centralizes the complex logic of deciding when to buffer or filter
  transactions based on multiple overlapping pg_snapshots.
  """

  alias Electric.Postgres.Xid
  alias Electric.Replication.Changes.Transaction
  alias Electric.Shapes.Consumer.MoveInOperation

  @type pg_snapshot :: {Xid.anyxid(), Xid.anyxid(), list(Xid.anyxid())}

  @type t :: %__MODULE__{
          initial_snapshot: pg_snapshot() | nil,
          initial_filtering?: boolean(),
          move_in_ops: %{MoveInOperation.name() => MoveInOperation.t()},
          buffering?: boolean()
        }

  defstruct [
    :initial_snapshot,
    :initial_filtering?,
    :move_in_ops,
    :buffering?
  ]

  @doc """
  Creates a new buffering coordinator.
  Initially set to buffering mode (waiting for initial snapshot).
  """
  @spec new() :: t()
  def new do
    %__MODULE__{
      initial_snapshot: nil,
      initial_filtering?: true,
      move_in_ops: %{},
      buffering?: true
    }
  end

  @doc """
  Initializes the coordinator with an existing initial snapshot and filtering state.
  """
  @spec initialize(t(), pg_snapshot() | nil, boolean()) :: t()
  def initialize(%__MODULE__{} = coord, initial_snapshot, initial_filtering?) do
    %{coord |
      initial_snapshot: initial_snapshot,
      initial_filtering?: initial_filtering?,
      buffering?: is_nil(initial_snapshot)
    }
  end

  @doc """
  Sets the initial snapshot and stops buffering.
  """
  @spec set_initial_snapshot(t(), pg_snapshot()) :: t()
  def set_initial_snapshot(%__MODULE__{} = coord, snapshot) do
    %{coord | initial_snapshot: snapshot, initial_filtering?: true, buffering?: false}
  end

  @doc """
  Adds a new move-in operation to track.
  May cause buffering to start if the operation requires it.
  """
  @spec add_move_in(t(), MoveInOperation.t()) :: t()
  def add_move_in(%__MODULE__{move_in_ops: ops} = coord, %MoveInOperation{} = op) do
    new_ops = Map.put(ops, op.name, op)
    %{coord | move_in_ops: new_ops}
  end

  @doc """
  Completes a move-in operation with its key set.
  Transitions the operation from querying to filtering.
  """
  @spec complete_move_in(t(), MoveInOperation.name(), list(String.t())) :: t()
  def complete_move_in(%__MODULE__{move_in_ops: ops} = coord, name, key_list) do
    case Map.fetch(ops, name) do
      {:ok, op} ->
        completed_op = MoveInOperation.complete(op, key_list)
        %{coord | move_in_ops: Map.put(ops, name, completed_op)}

      :error ->
        coord
    end
  end

  @doc """
  Removes completed move-in operations based on the given transaction.
  An operation is considered complete if the transaction is after its snapshot.
  """
  @spec cleanup_completed_ops(t(), Transaction.t()) :: t()
  def cleanup_completed_ops(%__MODULE__{move_in_ops: ops} = coord, txn) do
    remaining_ops =
      ops
      |> Enum.reject(fn {_name, op} -> MoveInOperation.is_completed_by?(op, txn) end)
      |> Map.new()

    %{coord | move_in_ops: remaining_ops}
  end

  @doc """
  Stops initial snapshot filtering for transactions beyond the snapshot.
  """
  @spec maybe_stop_initial_filtering(t(), Transaction.t()) :: t()
  def maybe_stop_initial_filtering(%__MODULE__{initial_snapshot: snapshot} = coord, txn)
      when not is_nil(snapshot) do
    if Xid.after_snapshot?(txn.xid, snapshot) do
      %{coord | initial_filtering?: false}
    else
      coord
    end
  end

  def maybe_stop_initial_filtering(coord, _txn), do: coord

  @doc """
  Returns the buffering decision for a transaction.

  Returns:
  - `:buffer` - Transaction should be buffered
  - `:process` - Transaction should be processed normally
  - `:filter_initial` - Transaction visible in initial snapshot (should be skipped)
  """
  @spec check_transaction(t(), Transaction.t()) :: :buffer | :process | :filter_initial
  def check_transaction(%__MODULE__{buffering?: true}, _txn), do: :buffer

  def check_transaction(%__MODULE__{initial_filtering?: true, initial_snapshot: snapshot}, txn)
      when not is_nil(snapshot) do
    if Transaction.visible_in_snapshot?(txn, snapshot) do
      :filter_initial
    else
      :process
    end
  end

  def check_transaction(%__MODULE__{move_in_ops: ops}, txn) when map_size(ops) > 0 do
    # Check if any move-in operation requires buffering
    should_buffer? =
      ops
      |> Map.values()
      |> Enum.any?(&MoveInOperation.should_buffer?(&1, txn))

    if should_buffer?, do: :buffer, else: :process
  end

  def check_transaction(%__MODULE__{}, _txn), do: :process

  @doc """
  Returns true if a change should be filtered out because it's already
  in a move-in snapshot.

  Deletes can never be filtered (they're not in snapshots).
  """
  @spec should_filter_change?(t(), Transaction.t(), String.t()) :: boolean()
  def should_filter_change?(%__MODULE__{move_in_ops: ops}, txn, key) do
    ops
    |> Map.values()
    |> Enum.any?(&MoveInOperation.should_filter?(&1, txn, key))
  end

  @doc """
  Returns true if coordinator is currently in buffering mode.
  """
  @spec buffering?(t()) :: boolean()
  def buffering?(%__MODULE__{buffering?: buffering?}), do: buffering?

  @doc """
  Stops buffering mode. Called when ready to process buffered transactions.
  """
  @spec stop_buffering(t()) :: t()
  def stop_buffering(%__MODULE__{} = coord) do
    %{coord | buffering?: false}
  end

  @doc """
  Starts buffering mode. Called when a new move-in operation starts.
  """
  @spec start_buffering(t()) :: t()
  def start_buffering(%__MODULE__{} = coord) do
    %{coord | buffering?: true}
  end

  @doc """
  Returns the initial snapshot's xmin, or nil if no snapshot set.
  """
  @spec initial_snapshot_xmin(t()) :: Xid.anyxid() | nil
  def initial_snapshot_xmin(%__MODULE__{initial_snapshot: {xmin, _, _}}), do: xmin
  def initial_snapshot_xmin(%__MODULE__{initial_snapshot: nil}), do: nil

  @doc """
  Returns true if the coordinator is performing initial snapshot filtering.
  """
  @spec initial_filtering?(t()) :: boolean()
  def initial_filtering?(%__MODULE__{initial_filtering?: filtering?}), do: filtering?
end
