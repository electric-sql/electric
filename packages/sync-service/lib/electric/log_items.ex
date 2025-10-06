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

  defp put_if_true(map, key, value) do
    if value, do: Map.put(map, key, value), else: map
  end

  defp put_if_true(map, key, condition, value) do
    if condition, do: Map.put(map, key, value), else: map
  end

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
         headers:
           %{
             operation: :insert,
             txids: List.wrap(txids),
             relation: Tuple.to_list(change.relation),
             lsn: to_string(change.log_offset.tx_offset),
             op_position: change.log_offset.op_offset
           }
           |> put_if_true(:last, change.last?)
           |> put_if_true(:tags, change.move_tags != [], change.move_tags)
       }}
    ]
  end

  def from_change(%Changes.DeletedRecord{} = change, txids, pk_cols, replica) do
    [
      {change.log_offset,
       %{
         key: change.key,
         value: take_pks_or_all(change.old_record, pk_cols, replica),
         headers:
           %{
             operation: :delete,
             txids: List.wrap(txids),
             relation: Tuple.to_list(change.relation),
             lsn: to_string(change.log_offset.tx_offset),
             op_position: change.log_offset.op_offset
           }
           |> put_if_true(:last, change.last?)
           |> put_if_true(:tags, change.move_tags != [], change.move_tags)
       }}
    ]
  end

  # `old_key` is nil when it's unchanged. This is not possible when there is no PK defined.
  def from_change(%Changes.UpdatedRecord{old_key: nil} = change, txids, pk_cols, replica) do
    [
      {change.log_offset,
       %{
         key: change.key,
         headers:
           %{
             operation: :update,
             txids: List.wrap(txids),
             relation: Tuple.to_list(change.relation),
             lsn: to_string(change.log_offset.tx_offset),
             op_position: change.log_offset.op_offset
           }
           |> put_if_true(:last, change.last?)
           |> put_if_true(:tags, change.move_tags != [], change.move_tags)
           |> put_if_true(:removed_tags, change.move_tags != [], change.removed_move_tags)
       }
       |> Map.merge(put_update_values(change, pk_cols, replica))}
    ]
  end

  def from_change(%Changes.UpdatedRecord{} = change, txids, pk_cols, replica) do
    new_offset = LogOffset.increment(change.log_offset)

    [
      {change.log_offset,
       %{
         key: change.old_key,
         value: take_pks_or_all(change.old_record, pk_cols, replica),
         headers:
           %{
             operation: :delete,
             txids: List.wrap(txids),
             relation: Tuple.to_list(change.relation),
             key_change_to: change.key,
             lsn: to_string(change.log_offset.tx_offset),
             op_position: change.log_offset.op_offset
           }
           |> put_if_true(
             :tags,
             change.move_tags != [],
             change.move_tags ++ change.removed_move_tags
           )
       }},
      {new_offset,
       %{
         key: change.key,
         value: change.record,
         headers:
           %{
             operation: :insert,
             txids: List.wrap(txids),
             relation: Tuple.to_list(change.relation),
             key_change_from: change.old_key,
             lsn: to_string(new_offset.tx_offset),
             op_position: new_offset.op_offset
           }
           |> put_if_true(:last, change.last?)
           |> put_if_true(:tags, change.move_tags != [], change.move_tags)
       }}
    ]
  end

  def expected_offset_after_split(%Changes.UpdatedRecord{old_key: x, log_offset: offset})
      when not is_nil(x),
      do: LogOffset.increment(offset)

  def expected_offset_after_split(%{log_offset: offset}), do: offset

  defp take_pks_or_all(record, _pks, :full), do: record
  defp take_pks_or_all(record, [], :default), do: record
  defp take_pks_or_all(record, pks, :default), do: Map.take(record, pks)

  defp put_update_values(%{record: record, changed_columns: changed_columns}, pk_cols, :default) do
    %{value: Map.take(record, Enum.concat(pk_cols, changed_columns))}
  end

  defp put_update_values(
         %{record: record, old_record: old_record, changed_columns: changed_columns},
         _pk_cols,
         :full
       ) do
    %{value: record, old_value: Map.take(old_record, MapSet.to_list(changed_columns))}
  end

  def merge_updates(u1, u2) when is_map_key(u1, "old_value") or is_map_key(u2, "old_value") do
    %{
      "key" => u1["key"],
      "headers" => Map.take(u1["headers"], ["operation", "relation"]),
      "value" => Map.merge(u1["value"], u2["value"]),
      # When merging old values, we give preference to the older u1
      "old_value" => Map.merge(u2["old_value"] || %{}, u1["old_value"] || %{})
    }
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
