defmodule Electric.Shapes.Consumer.TransactionConverter do
  # Converts transactions into append-change effects using Shape.convert_change/3.

  alias Electric.Replication.Changes
  alias Electric.Replication.Changes.Transaction
  alias Electric.Shapes.Consumer.Effects
  alias Electric.Shapes.Shape

  @type convert_opts() :: keyword()

  @spec transaction_to_effects(Transaction.t(), Shape.t(), convert_opts()) ::
          {:ok, [Effects.t()]} | {:error, {:truncate, Changes.xid() | nil}}
  def transaction_to_effects(%Transaction{} = txn, %Shape{} = shape, opts \\ [])
      when is_list(opts) do
    with {:ok, changes} <- convert_changes(txn, shape, opts) do
      {:ok, append_effects(txn.xid, changes)}
    end
  end

  @spec transactions_to_effects([Transaction.t()], Shape.t(), convert_opts()) ::
          {:ok, [Effects.t()]} | {:error, {:truncate, Changes.xid() | nil}}
  def transactions_to_effects(txns, %Shape{} = shape, opts \\ [])
      when is_list(txns) and is_list(opts) do
    Enum.reduce_while(txns, {:ok, []}, fn txn, {:ok, acc} ->
      case transaction_to_effects(txn, shape, opts) do
        {:ok, []} ->
          {:cont, {:ok, acc}}

        {:ok, effects} ->
          {:cont, {:ok, [effects | acc]}}

        {:error, {:truncate, _xid}} = error ->
          {:halt, error}
      end
    end)
    |> case do
      {:ok, effects} -> {:ok, effects |> Enum.reverse() |> List.flatten()}
      {:error, {:truncate, _xid}} = error -> error
    end
  end

  defp convert_changes(%Transaction{} = txn, %Shape{} = shape, opts) when is_list(opts) do
    txn.changes
    |> Enum.reduce_while([], fn change, acc ->
      case change do
        %Changes.TruncatedRelation{} ->
          {:halt, {:error, {:truncate, txn.xid}}}

        _ ->
          # Accumulate in reverse, flattening each conversion as we go so the head
          # of the accumulator is always the last emitted change.
          converted = Shape.convert_change(shape, change, opts)
          {:cont, Enum.reduce(converted, acc, &[&1 | &2])}
      end
    end)
    |> case do
      {:error, {:truncate, _xid}} = error ->
        error

      # Mark the last change before reversing, avoiding a separate pass to find
      # and rebuild the tail.
      [] ->
        {:ok, []}

      [last | rest] ->
        {:ok, Enum.reverse([%{last | last?: true} | rest])}
    end
  end

  defp append_effects(_xid, []), do: []

  defp append_effects(xid, changes) do
    [%Effects.AppendChanges{changes: changes, xid: xid}]
  end
end
