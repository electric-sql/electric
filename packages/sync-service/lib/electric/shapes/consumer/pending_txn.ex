defmodule Electric.Shapes.Consumer.PendingTxn do
  @moduledoc """
  Tracks metadata for an in-progress transaction during fragment-direct streaming.

  When a consumer streams transaction fragments directly to storage (for shapes
  without subquery dependencies), this struct tracks the transaction metadata
  until commit is received.
  """

  alias Electric.Replication.LogOffset

  defstruct [
    :xid,
    :last_log_offset,
    num_changes: 0,
    total_bytes: 0
  ]

  @type t :: %__MODULE__{
          xid: pos_integer(),
          last_log_offset: LogOffset.t() | nil,
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
  @spec add_changes(t(), LogOffset.t(), non_neg_integer(), non_neg_integer()) :: t()
  def add_changes(%__MODULE__{} = pending, log_offset, count, bytes) do
    %{
      pending
      | last_log_offset: log_offset,
        num_changes: pending.num_changes + count,
        total_bytes: pending.total_bytes + bytes
    }
  end
end
