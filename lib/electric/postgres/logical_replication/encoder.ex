defmodule Electric.Postgres.LogicalReplication.Encoder do
  @moduledoc false

  alias Electric.Postgres.LogicalReplication.Messages.{
    Begin,
    Commit,
    Origin,
    Relation,
    Relation.Column,
    Insert,
    Update,
    Delete,
    Truncate,
    Type,
    Unsupported,
    Lsn
  }

  alias Electric.Postgres.LogicalReplication.OidDatabase

  @doc """
  Encode a message to Postgres binary logical replication format

  ## Examples

      iex> encode(%#{Begin}{commit_timestamp: ~U[2019-07-18 17:02:35.726322Z], final_lsn: %#{Lsn}{segment: 2, offset: 2817828992}, xid: 619})
      <<66, 0, 0, 0, 2, 167, 244, 168, 128, 0, 2, 48, 246, 88, 88, 213, 242, 0, 0, 2, 107>>

      iex> encode(%#{Insert}{relation_id: 16396, tuple_data: {"06ac9e9a-f31c-4ef4-a57f-c4776b139201", "ok"}})
      <<73, 0, 0, 64, 12, 78, 0, 2, 116, 0, 0, 0, 36, 48, 54, 97, 99, 57, 101, 57, 97, 45, 102, 51, 49, 99, 45, 52, 101, 102, 52, 45, 97, 53, 55, 102, 45, 99, 52, 55, 55, 54, 98, 49, 51, 57, 50, 48, 49, 116, 0, 0, 0, 2, 111, 107>>

      iex> encode(%#{Commit}{commit_timestamp: ~U[2022-06-09 09:45:11.642218Z], end_lsn: %#{Lsn}{segment: 0, offset: 24337048}, flags: [], lsn: %#{Lsn}{segment: 0, offset: 24337000}})
      <<67, 0, 0, 0, 0, 0, 1, 115, 90, 104, 0, 0, 0, 0, 1, 115, 90, 152, 0, 2, 131, 255, 114, 87, 68, 106>>

      iex> encode(%#{Relation}{
      ...>   columns: [
      ...>     %#{Column}{flags: [:key], name: "id", type: :uuid, type_modifier: 4294967295},
      ...>     %#{Column}{flags: [:key], name: "content", type: :varchar, type_modifier: 68}
      ...>   ],
      ...>   id: 16396,
      ...>   name: "entries",
      ...>   namespace: "public",
      ...>   replica_identity: :all_columns
      ...> })
      <<82, 0, 0, 64, 12, 112, 117, 98, 108, 105, 99, 0, 101, 110, 116, 114, 105, 101, 115, 0, 102, 0, 2, 1, 105, 100, 0, 0, 0, 11, 134, 255, 255, 255, 255, 1, 99, 111, 110, 116, 101, 110, 116, 0, 0, 0, 4, 19, 0, 0, 0, 68>>

      iex> encode(%#{Update}{
      ...>   changed_key_tuple_data: nil,
      ...>   old_tuple_data: {"c0d731ca-0e72-4950-9499-8db83badb051", "ok"},
      ...>   relation_id: 16396,
      ...>   tuple_data: {"c0d731ca-0e72-4950-9499-8db83badb051", "yes"}
      ...> })
      <<85, 0, 0, 64, 12, 79, 0, 2, 116, 0, 0, 0, 36, 99, 48, 100, 55, 51, 49, 99, 97, 45, 48, 101, 55, 50, 45, 52, 57, 53, 48, 45, 57, 52, 57, 57, 45, 56, 100, 98, 56, 51, 98, 97, 100, 98, 48, 53, 49, 116, 0, 0, 0, 2, 111, 107, 78, 0, 2, 116, 0, 0, 0, 36, 99, 48, 100, 55, 51, 49, 99, 97, 45, 48, 101, 55, 50, 45, 52, 57, 53, 48, 45, 57, 52, 57, 57, 45, 56, 100, 98, 56, 51, 98, 97, 100, 98, 48, 53, 49, 116, 0, 0, 0, 3, 121, 101, 115>>

      iex> encode(%#{Delete}{
      ...>   relation_id: 16396,
      ...>   changed_key_tuple_data: nil,
      ...>   old_tuple_data: {"c0d731ca-0e72-4950-9499-8db83badb051", "yes"}
      ...> })
      <<68, 0, 0, 64, 12, 79, 0, 2, 116, 0, 0, 0, 36, 99, 48, 100, 55, 51, 49, 99, 97, 45, 48, 101, 55, 50, 45, 52, 57, 53, 48, 45, 57, 52, 57, 57, 45, 56, 100, 98, 56, 51, 98, 97, 100, 98, 48, 53, 49, 116, 0, 0, 0, 3, 121, 101, 115>>
  """
  def encode(%Begin{} = data) do
    %Begin{commit_timestamp: commit_timestamp, final_lsn: final_lsn, xid: xid} = data

    lsn = encode_lsn(final_lsn)
    timestamp = timestamp_to_pgtimestamp(commit_timestamp)

    <<"B", lsn::binary-8, timestamp::integer-64, xid::integer-32>>
  end

  def encode(%Commit{} = data) do
    %Commit{commit_timestamp: commit_timestamp, lsn: lsn, end_lsn: end_lsn, flags: _flags} = data

    timestamp = timestamp_to_pgtimestamp(commit_timestamp)

    <<"C", 0::integer-8, encode_lsn(lsn)::binary-8, encode_lsn(end_lsn)::binary-8,
      timestamp::integer-64>>
  end

  def encode(%Origin{name: name, origin_commit_lsn: lsn}) do
    <<"O", encode_lsn(lsn)::binary, name::binary, 0>>
  end

  def encode(%Relation{
        columns: columns,
        id: id,
        name: name,
        namespace: ns,
        replica_identity: identity
      }) do
    namespace = ns <> <<0>>
    relation_name = name <> <<0>>

    replica_identity =
      case identity do
        :default -> "d"
        :nothing -> "n"
        :all_columns -> "f"
        :index -> "i"
      end

    meta = namespace <> relation_name <> replica_identity
    columns = <<length(columns)::integer-16>> <> Enum.map_join(columns, &encode_column/1)

    <<"R", id::integer-32, meta::binary, columns::binary>>
  end

  def encode(%Insert{relation_id: relation_id, tuple_data: tuple}) do
    tuple_data = encode_tuple_data(tuple)

    <<"I", relation_id::integer-32, "N", tuple_data::binary>>
  end

  def encode(%Update{changed_key_tuple_data: changed_data, relation_id: id, tuple_data: new_data})
      when is_tuple(changed_data) do
    <<"U", id::integer-32, "K", encode_tuple_data(changed_data)::binary, "N",
      encode_tuple_data(new_data)::binary>>
  end

  def encode(%Update{old_tuple_data: old_data, relation_id: id, tuple_data: new_data})
      when is_tuple(old_data) do
    <<"U", id::integer-32, "O", encode_tuple_data(old_data)::binary, "N",
      encode_tuple_data(new_data)::binary>>
  end

  def encode(%Update{relation_id: id, tuple_data: new_data}) do
    <<"U", id::integer-32, "N", encode_tuple_data(new_data)::binary>>
  end

  def encode(%Delete{relation_id: id, old_tuple_data: data}) when is_tuple(data) do
    <<"D", id::integer-32, "O", encode_tuple_data(data)::binary>>
  end

  def encode(%Delete{relation_id: id, changed_key_tuple_data: data}) when is_tuple(data) do
    <<"D", id::integer-32, "K", encode_tuple_data(data)::binary>>
  end

  def encode(%Truncate{
        number_of_relations: number_of_relations,
        options: opts,
        truncated_relations: truncated_relations
      }) do
    option =
      case opts do
        [] -> 0
        [:cascade] -> 1
        [:restart_identity] -> 2
      end

    relations = Enum.map_join(truncated_relations, &<<&1::integer-32>>)

    <<"T", number_of_relations::integer-32, option::integer-8, relations::binary>>
  end

  def encode(%Type{id: id, name: name, namespace: ns}) do
    <<"Y", id::integer-32, ns::binary, 0, name::binary, 0>>
  end

  def encode(%Unsupported{data: data}) do
    data
  end

  defp encode_lsn(%Lsn{segment: segment, offset: offset}) do
    <<segment::integer-32, offset::integer-32>>
  end

  @pg_epoch DateTime.from_iso8601("2000-01-01T00:00:00.000000Z") |> elem(1)
  defp timestamp_to_pgtimestamp(datetime) when is_struct(datetime, DateTime) do
    DateTime.diff(datetime, @pg_epoch, :microsecond)
  end

  defp encode_tuple_data(tuple) do
    tuple
    |> Tuple.to_list()
    |> Enum.map_join(&encode_tuple_element/1)
    |> then(&<<tuple_size(tuple)::integer-16, &1::binary>>)
  end

  defp encode_tuple_element(nil), do: "n"
  defp encode_tuple_element(:unchanged_toast), do: "u"

  defp encode_tuple_element(value) when is_binary(value),
    do: <<"t", byte_size(value)::integer-32>> <> value

  defp encode_column(%Column{flags: flags, name: name, type: type, type_modifier: modifier}) do
    flag =
      case flags do
        [:key] -> 1
        [] -> 0
      end

    <<flag::integer-8, name::binary, 0, OidDatabase.type_id_for_name(type)::integer-32,
      modifier::integer-32>>
  end
end
