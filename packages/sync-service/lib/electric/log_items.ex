defmodule Electric.LogItems do
  alias Electric.Replication.Changes
  alias Electric.Replication.LogOffset
  alias Electric.Shapes.Shape

  @moduledoc """
  Defines the structure and how to create the items in the log that the electric client reads.

  The log_item() data structure is a map for ease of consumption in the Elixir code,
  however when JSON encoded (not done in this module) it's the format that the electric
  client accepts.
  """

  @type log_item ::
          {LogOffset.t(),
           %{
             key: String.t(),
             value: map(),
             headers: map()
           }}

  @spec from_change(
          Changes.data_change(),
          txids :: nil | non_neg_integer() | [non_neg_integer(), ...],
          pk_cols :: [String.t()],
          replica :: Shape.replica()
        ) :: [log_item(), ...]
  def from_change(%Changes.NewRecord{} = change, txids, _, _replica) do
    [
      {change.log_offset,
       %{
         key: change.key,
         value: change.record,
         headers: %{
           operation: :insert,
           txids: List.wrap(txids),
           relation: Tuple.to_list(change.relation),
           lsn: change.log_offset.tx_offset,
           op_position: change.log_offset.op_offset
         }
       }}
    ]
  end

  def from_change(%Changes.DeletedRecord{} = change, txids, pk_cols, replica) do
    [
      {change.log_offset,
       %{
         key: change.key,
         value: take_pks_or_all(change.old_record, pk_cols, replica),
         headers: %{
           operation: :delete,
           txids: List.wrap(txids),
           relation: Tuple.to_list(change.relation),
           lsn: change.log_offset.tx_offset,
           op_position: change.log_offset.op_offset
         }
       }}
    ]
  end

  # `old_key` is nil when it's unchanged. This is not possible when there is no PK defined.
  def from_change(%Changes.UpdatedRecord{old_key: nil} = change, txids, pk_cols, replica) do
    [
      {change.log_offset,
       %{
         key: change.key,
         value: update_values(change, pk_cols, replica),
         headers: %{
           operation: :update,
           txids: List.wrap(txids),
           relation: Tuple.to_list(change.relation),
           lsn: change.log_offset.tx_offset,
           op_position: change.log_offset.op_offset
         }
       }}
    ]
  end

  def from_change(%Changes.UpdatedRecord{} = change, txids, pk_cols, replica) do
    new_offset = LogOffset.increment(change.log_offset)

    [
      {change.log_offset,
       %{
         key: change.old_key,
         value: take_pks_or_all(change.old_record, pk_cols, replica),
         headers: %{
           operation: :delete,
           txids: List.wrap(txids),
           relation: Tuple.to_list(change.relation),
           key_change_to: change.key,
           lsn: change.log_offset.tx_offset,
           op_position: change.log_offset.op_offset
         }
       }},
      {new_offset,
       %{
         key: change.key,
         value: change.record,
         headers: %{
           operation: :insert,
           txids: List.wrap(txids),
           relation: Tuple.to_list(change.relation),
           key_change_from: change.old_key,
           lsn: new_offset.tx_offset,
           op_position: new_offset.op_offset
         }
       }}
    ]
  end

  defp take_pks_or_all(record, _pks, :full), do: record
  defp take_pks_or_all(record, [], :default), do: record
  defp take_pks_or_all(record, pks, :default), do: Map.take(record, pks)

  defp update_values(%{record: record, changed_columns: changed_columns}, pk_cols, :default) do
    Map.take(record, Enum.concat(pk_cols, changed_columns))
  end

  defp update_values(%{record: record}, _pk_cols, :full) do
    record
  end

  def merge_updates(u1, u2) do
    %{
      "key" => u1["key"],
      "headers" => Map.take(u1["headers"], ["operation", "relation"]),
      "value" => Map.merge(u1["value"], u2["value"])
    }
  end

  def keep_generic_headers(item) do
    Map.update!(item, "headers", &Map.take(&1, ["operation", "relation"]))
  end
end
