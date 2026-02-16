defmodule Electric.Shapes.Consumer.PendingTxn do
  @moduledoc """
  Tracks metadata for an in-progress transaction during direct fragment-to-storage streaming of
  changes.

  When a consumer streams transaction fragments directly to storage (for shapes
  without subquery dependencies), this struct tracks the transaction metadata
  until commit is received.

  This is an antipod module to Electric.Replication.TransactionBuilder. This module only tracks
  metadata related to the current transaction for which txn fragments are processed as the
  fragments themselves are written to strorage and are discarded from memory immediately, while
  the TransactionBuilder module accumulates all changes in memory and returns a complete
  transaction after seeing a Commit.
  """

  defstruct [
    :xid,
    consider_flushed?: false,
    storage_duration: 0,
    num_changes: 0,
    total_bytes: 0
  ]

  @type t :: %__MODULE__{
          xid: pos_integer(),
          consider_flushed?: boolean(),
          num_changes: non_neg_integer(),
          total_bytes: non_neg_integer()
        }

  @doc """
  Create a new pending transaction tracker.
  """
  @spec new(pos_integer()) :: t()
  def new(xid) do
    %__MODULE__{xid: xid}
  end

  @doc """
  Update the pending transaction with changes that were written to storage.
  """
  @spec update_with_changes(t(), non_neg_integer(), non_neg_integer(), non_neg_integer()) :: t()
  def update_with_changes(%__MODULE__{} = pending_txn, storage_duration, count, bytes) do
    %{
      pending_txn
      | storage_duration: pending_txn.storage_duration + storage_duration,
        num_changes: pending_txn.num_changes + count,
        total_bytes: pending_txn.total_bytes + bytes
    }
  end

  def consider_flushed(%__MODULE__{} = pending_txn) do
    %{pending_txn | consider_flushed?: true}
  end
end
