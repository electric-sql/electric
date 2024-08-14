defmodule Electric.LogItems do
  alias Electric.Replication.Changes
  alias Electric.Replication.LogOffset

  @moduledoc """
  Defines the structure and how to create the items in the log that the electric client reads.

  The log_item() data structure is a map for ease of consumption in the Elixir code,
  however when JSON encoded (not done in this module) it's the format that the electric
  client accepts.
  """

  @type log_item :: %{
          key: String.t(),
          value: map(),
          headers: map(),
          offset: LogOffset.t()
        }

  @spec from_change(
          Changes.data_change(),
          txid :: non_neg_integer() | nil,
          pk_cols :: [String.t()]
        ) :: [log_item(), ...]
  def from_change(%Changes.NewRecord{} = change, txid, _) do
    [
      %{
        key: change.key,
        value: change.record,
        headers: %{operation: :insert, txid: txid, relation: Tuple.to_list(change.relation)},
        offset: change.log_offset
      }
    ]
  end

  def from_change(%Changes.DeletedRecord{} = change, txid, pk_cols) do
    [
      %{
        key: change.key,
        value: take_pks_or_all(change.old_record, pk_cols),
        headers: %{operation: :delete, txid: txid, relation: Tuple.to_list(change.relation)},
        offset: change.log_offset
      }
    ]
  end

  # `old_key` is nil when it's unchanged. This is not possible when there is no PK defined.
  def from_change(%Changes.UpdatedRecord{old_key: nil} = change, txid, pk_cols) do
    [
      %{
        key: change.key,
        value: Map.take(change.record, Enum.concat(pk_cols, change.changed_columns)),
        headers: %{operation: :update, txid: txid, relation: Tuple.to_list(change.relation)},
        offset: change.log_offset
      }
    ]
  end

  def from_change(%Changes.UpdatedRecord{} = change, txid, pk_cols) do
    [
      %{
        key: change.old_key,
        value: take_pks_or_all(change.old_record, pk_cols),
        headers: %{
          operation: :delete,
          txid: txid,
          relation: Tuple.to_list(change.relation),
          key_change_to: change.key
        },
        offset: change.log_offset
      },
      %{
        key: change.key,
        value: change.record,
        headers: %{
          operation: :insert,
          txid: txid,
          relation: Tuple.to_list(change.relation),
          key_change_from: change.old_key
        },
        offset: LogOffset.increment(change.log_offset)
      }
    ]
  end

  defp take_pks_or_all(record, []), do: record
  defp take_pks_or_all(record, pks), do: Map.take(record, pks)
end
