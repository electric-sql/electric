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

  @spec pop_incomplete_transaction_as_fragment(t()) :: {TransactionFragment.t() | nil, t()}
  def pop_incomplete_transaction_as_fragment(%__MODULE__{transaction: nil}) do
    {nil, new()}
  end

  def pop_incomplete_transaction_as_fragment(%__MODULE__{transaction: txn}) do
    txn = finalize_txn_changes(txn)

    fragment =
      %TransactionFragment{
        has_begin?: true,
        xid: txn.xid,
        lsn: txn.lsn,
        last_log_offset: txn.last_log_offset,
        changes: txn.changes,
        change_count: txn.num_changes
      }

    {fragment, new()}
  end

  defp maybe_start_transaction(state, %TransactionFragment{has_begin?: false}), do: state

  defp maybe_start_transaction(
         %__MODULE__{} = state,
         %TransactionFragment{has_begin?: true} = fragment
       ) do
    txn = %Transaction{
      xid: fragment.xid,
      changes: [],
      commit_timestamp: nil,
      lsn: fragment.lsn,
      last_log_offset: fragment.last_log_offset
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
          # The transaction may have had some changes filtered
          # out, so we need to set the last_log_offset from the fragment
          last_log_offset: last_log_offset
      }
      |> finalize_txn_changes()

    {[completed_txn], new()}
  end

  defp finalize_txn_changes(txn) do
    %{txn | changes: Enum.reverse(txn.changes)}
  end
end
