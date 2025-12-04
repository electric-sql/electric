defmodule Electric.Replication.TransactionBuilder do
  @moduledoc """
  Builds complete transactions from a stream of TransactionFragments.

  Takes TransactionFragments containing begin, commit, and changes,
  and builds up Transaction structs. Returns complete transactions
  when a fragment with a commit is seen.
  """

  alias Electric.Replication.Changes.{
    Transaction,
    TransactionFragment
  }

  defstruct transaction: nil

  @type t() :: %__MODULE__{
          transaction: nil | Transaction.t()
        }

  def new, do: %__MODULE__{}

  @doc """
  Build transactions from a TransactionFragment.

  Returns a tuple of {results, state} where results is a list of
  complete transactions, and state is the updated builder state
  containing any partial transaction.
  """
  @spec build(TransactionFragment.t(), t()) :: {[Transaction.t()], t()}
  def build(%TransactionFragment{} = fragment, state) do
    state
    |> maybe_start_transaction(fragment)
    |> add_changes(fragment)
    |> maybe_complete_transaction(fragment)
  end

  defp maybe_start_transaction(state, %TransactionFragment{has_begin?: false}), do: state

  defp maybe_start_transaction(
         %__MODULE__{} = state,
         %TransactionFragment{xid: xid, has_begin?: true}
       ) do
    txn = %Transaction{
      xid: xid,
      changes: [],
      commit_timestamp: nil,
      lsn: nil,
      last_log_offset: nil
    }

    %{state | transaction: txn}
  end

  defp add_changes(%{transaction: txn} = state, %TransactionFragment{} = fragment) do
    txn = %{
      txn
      | changes: Enum.reverse(fragment.changes) ++ txn.changes,
        num_changes: txn.num_changes + fragment.change_count
    }

    %{state | transaction: txn}
  end

  defp maybe_complete_transaction(state, %TransactionFragment{commit: nil}) do
    {[], state}
  end

  defp maybe_complete_transaction(
         %__MODULE__{transaction: txn},
         %TransactionFragment{
           lsn: lsn,
           commit: commit,
           last_log_offset: last_log_offset
         }
       ) do
    completed_txn =
      %{
        txn
        | lsn: lsn,
          commit_timestamp: commit.commit_timestamp,
          changes: Enum.reverse(txn.changes),
          # The transaction may have had some changes filtered
          # out, so we need to set the last_log_offset from the fragment
          last_log_offset: last_log_offset
      }

    {[completed_txn], %__MODULE__{transaction: nil}}
  end
end
