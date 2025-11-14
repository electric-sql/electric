defmodule Electric.Replication.TransactionBuilder do
  @moduledoc """
  Builds complete transactions from a stream of operations.

  Takes Begin, Commit, data changes, and Relation messages and builds up
  Transaction structs. Returns complete transactions when Commit is seen,
  and passes through Relation messages immediately.
  """

  alias Electric.Replication.Changes

  alias Electric.Replication.Changes.{
    Begin,
    Commit,
    Transaction,
    Relation,
    NewRecord,
    UpdatedRecord,
    DeletedRecord,
    TruncatedRelation
  }

  defstruct transaction: nil

  @type t() :: %__MODULE__{
          transaction: nil | Transaction.t()
        }

  @type result() :: Transaction.t() | Relation.t()

  def new, do: %__MODULE__{}

  @doc """
  Build transactions from a list of operations.

  Returns a tuple of {results, state} where results is a list of
  complete transactions and/or relations, and state is the updated
  builder state containing any partial transaction.
  """
  @spec build([Changes.operation()], t()) :: {[Changes.action()], t()}
  def build(operations, state) do
    build(operations, state, [])
  end

  defp build([], state, acc) do
    {Enum.reverse(acc), state}
  end

  defp build([change | rest], state, acc) do
    case build_from_change(change, state) do
      {nil, state} -> build(rest, state, acc)
      {txn_or_relation, state} -> build(rest, state, [txn_or_relation | acc])
    end
  end

  defp build_from_change(%Begin{xid: xid}, %__MODULE__{} = state) do
    txn = %Transaction{
      xid: xid,
      changes: [],
      commit_timestamp: nil,
      lsn: nil,
      last_log_offset: nil
    }

    {nil, %{state | transaction: txn}}
  end

  defp build_from_change(%Relation{} = relation, state) do
    {relation, state}
  end

  defp build_from_change(
         %change_type{} = change,
         %__MODULE__{transaction: txn} = state
       )
       when change_type in [NewRecord, UpdatedRecord, DeletedRecord, TruncatedRelation] and
              not is_nil(txn) do
    txn = Transaction.prepend_change(txn, change)
    {nil, %{state | transaction: txn}}
  end

  defp build_from_change(%Commit{lsn: lsn, commit_timestamp: commit_timestamp}, %__MODULE__{
         transaction: txn
       })
       when not is_nil(txn) do
    completed_txn =
      txn
      |> Map.put(:lsn, lsn)
      |> Map.put(:commit_timestamp, commit_timestamp)
      |> Transaction.finalize()

    {completed_txn, %__MODULE__{transaction: nil}}
  end
end
