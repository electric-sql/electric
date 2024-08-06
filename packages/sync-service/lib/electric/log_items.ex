defmodule Electric.LogItems do
  alias Electric.Replication.Changes
  alias Electric.Replication.LogOffset
  alias Electric.Shapes.Shape
  alias Electric.Utils

  @moduledoc """
  Defines the structure and how to create the items in the log that the electric client reads.

  The log_item() data structure is a map for ease of consumption in the Elixir code, 
  however when JSON encoded it's the format that the electric client accepts.  
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
        headers: %{action: :insert, txid: txid, relation: Tuple.to_list(change.relation)},
        offset: change.log_offset
      }
    ]
  end

  def from_change(%Changes.DeletedRecord{} = change, txid, pk_cols) do
    [
      %{
        key: change.key,
        value: take_pks_or_all(change.old_record, pk_cols),
        headers: %{action: :delete, txid: txid, relation: Tuple.to_list(change.relation)},
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
        headers: %{action: :update, txid: txid, relation: Tuple.to_list(change.relation)},
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
          action: :delete,
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
          action: :insert,
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

  @spec from_snapshot_row_stream(
          row_stream :: Stream.t(list()),
          offset :: LogOffset.t(),
          shape :: Shape.t(),
          query_info :: %Postgrex.Query{}
        ) :: log_item()
  def from_snapshot_row_stream(row_stream, offset, shape, query_info) do
    Stream.map(row_stream, &from_snapshot_row(&1, offset, shape, query_info))
  end

  defp from_snapshot_row(row, offset, shape, query_info) do
    value = value(row, query_info)

    key = Changes.build_key(shape.root_table, value, Shape.pk(shape))

    %{
      key: key,
      value: value,
      headers: %{action: :insert},
      offset: offset
    }
  end

  defp value(row, %Postgrex.Query{columns: columns, result_types: types}) do
    [columns, types, row]
    |> Enum.zip_with(fn
      [col, Postgrex.Extensions.UUID, val] -> {col, Utils.encode_uuid(val)}
      [col, _, val] -> {col, to_string(val)}
    end)
    |> Map.new()
  end
end
