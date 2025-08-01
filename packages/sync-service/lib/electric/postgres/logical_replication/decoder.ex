defmodule Electric.Postgres.LogicalReplication.Decoder do
  @moduledoc false
  alias Electric.Postgres.LogicalReplication.Messages.{
    Begin,
    Message,
    Commit,
    Origin,
    Relation,
    Relation.Column,
    Insert,
    Update,
    Delete,
    Truncate,
    Type,
    Unsupported
  }

  alias Electric.Postgres.Lsn

  @doc """
  Parses logical replication messages from Postgres pgoutput plugin

  ## Examples

      iex> decode(<<66, 0, 0, 0, 2, 167, 244, 168, 128, 0, 2, 48, 246, 88, 88, 213, 242, 0, 0, 2, 107>>)
      %#{Begin}{commit_timestamp: ~U[2019-07-18 17:02:35.726322Z], final_lsn: %#{Lsn}{segment: 2, offset: 2817828992}, xid: 619}

      iex> decode(<<73, 0, 0, 64, 12, 78, 0, 2, 116, 0, 0, 0, 36, 48, 54, 97, 99, 57, 101, 57, 97, 45, 102, 51, 49, 99, 45, 52, 101, 102, 52, 45, 97, 53, 55, 102, 45, 99, 52, 55, 55, 54, 98, 49, 51, 57, 50, 48, 49, 116, 0, 0, 0, 2, 111, 107>>)
      %#{Insert}{relation_id: 16396, tuple_data: ["06ac9e9a-f31c-4ef4-a57f-c4776b139201", "ok"], bytes: 38}

      iex> decode(<<67, 0, 0, 0, 0, 0, 1, 115, 90, 104, 0, 0, 0, 0, 1, 115, 90, 152, 0, 2, 131, 255, 114, 87, 68, 106>>)
      %#{Commit}{commit_timestamp: ~U[2022-06-09 09:45:11.642218Z], end_lsn: %#{Lsn}{segment: 0, offset: 24337048}, flags: [], lsn: %#{Lsn}{segment: 0, offset: 24337000}}

      iex> decode(<<82, 0, 0, 64, 12, 112, 117, 98, 108, 105, 99, 0, 101, 110, 116, 114, 105, 101, 115, 0, 102, 0, 2, 1, 105, 100, 0, 0, 0, 11, 134, 255, 255, 255, 255, 1, 99, 111, 110, 116, 101, 110, 116, 0, 0, 0, 4, 19, 0, 0, 0, 68>>)
      %#{Relation}{
        columns: [
          %#{Column}{flags: [:key], name: "id", type_oid: 2950, type_modifier: -1},
          %#{Column}{flags: [:key], name: "content", type_oid: 1043, type_modifier: 68}
        ],
        id: 16396,
        name: "entries",
        namespace: "public",
        replica_identity: :all_columns
      }

      iex> decode(<<85, 0, 0, 64, 12, 79, 0, 2, 116, 0, 0, 0, 36, 99, 48, 100, 55, 51, 49, 99, 97, 45, 48, 101, 55, 50, 45, 52, 57, 53, 48, 45, 57, 52, 57, 57, 45, 56, 100, 98, 56, 51, 98, 97, 100, 98, 48, 53, 49, 116, 0, 0, 0, 2, 111, 107, 78, 0, 2, 116, 0, 0, 0, 36, 99, 48, 100, 55, 51, 49, 99, 97, 45, 48, 101, 55, 50, 45, 52, 57, 53, 48, 45, 57, 52, 57, 57, 45, 56, 100, 98, 56, 51, 98, 97, 100, 98, 48, 53, 49, 116, 0, 0, 0, 3, 121, 101, 115>>)
      %#{Update}{
        changed_key_tuple_data: nil,
        old_tuple_data: ["c0d731ca-0e72-4950-9499-8db83badb051", "ok"],
        relation_id: 16396,
        tuple_data: ["c0d731ca-0e72-4950-9499-8db83badb051", "yes"],
        bytes: 77
      }

      iex> decode(<<68, 0, 0, 64, 12, 79, 0, 2, 116, 0, 0, 0, 36, 99, 48, 100, 55, 51, 49, 99, 97, 45, 48, 101, 55, 50, 45, 52, 57, 53, 48, 45, 57, 52, 57, 57, 45, 56, 100, 98, 56, 51, 98, 97, 100, 98, 48, 53, 49, 116, 0, 0, 0, 3, 121, 101, 115>>)
      %#{Delete}{
        relation_id: 16396,
        changed_key_tuple_data: nil,
        old_tuple_data: ["c0d731ca-0e72-4950-9499-8db83badb051", "yes"],
        bytes: 39
      }
  """
  def decode(message) when is_binary(message) do
    decode_message_impl(message)
  end

  defp decode_message_impl(<<"B", lsn::binary-8, timestamp::integer-64, xid::integer-32>>) do
    %Begin{
      final_lsn: decode_lsn(lsn),
      commit_timestamp: pgtimestamp_to_timestamp(timestamp),
      xid: xid
    }
  end

  defp decode_message_impl(<<"M", flags::8, lsn::binary-8, rest::binary>>) do
    [prefix, <<_::32, content::binary>>] = String.split(rest, <<0>>, parts: 2)

    %Message{
      transactional?: flags == 1,
      lsn: decode_lsn(lsn),
      prefix: prefix,
      content: content
    }
  end

  defp decode_message_impl(
         <<"C", _flags::binary-1, lsn::binary-8, end_lsn::binary-8, timestamp::integer-64>>
       ) do
    %Commit{
      flags: [],
      lsn: decode_lsn(lsn),
      end_lsn: decode_lsn(end_lsn),
      commit_timestamp: pgtimestamp_to_timestamp(timestamp)
    }
  end

  defp decode_message_impl(<<"O", lsn::binary-8, name::binary>>) do
    %Origin{
      origin_commit_lsn: decode_lsn(lsn),
      name: String.trim_trailing(name, <<0>>)
    }
  end

  defp decode_message_impl(<<"R", id::integer-32, rest::binary>>) do
    [
      namespace
      | [name | [<<replica_identity::binary-1, _number_of_columns::integer-16, columns::binary>>]]
    ] = String.split(rest, <<0>>, parts: 3)

    # TODO: Handle case where pg_catalog is blank, we should still return the schema as pg_catalog
    friendly_replica_identity =
      case replica_identity do
        "d" -> :default
        "n" -> :nothing
        "f" -> :all_columns
        "i" -> :index
      end

    %Relation{
      id: id,
      namespace: namespace,
      name: name,
      replica_identity: friendly_replica_identity,
      columns: decode_columns(columns)
    }
  end

  defp decode_message_impl(
         <<"I", relation_id::integer-32, "N", number_of_columns::integer-16, tuple_data::binary>>
       ) do
    {<<>>, decoded_tuple_data, bytes} = decode_tuple_data(tuple_data, number_of_columns)

    %Insert{
      relation_id: relation_id,
      tuple_data: decoded_tuple_data,
      bytes: bytes
    }
  end

  defp decode_message_impl(
         <<"U", relation_id::integer-32, "N", number_of_columns::integer-16, tuple_data::binary>>
       ) do
    {<<>>, decoded_tuple_data, bytes} = decode_tuple_data(tuple_data, number_of_columns)

    %Update{
      relation_id: relation_id,
      tuple_data: decoded_tuple_data,
      bytes: bytes
    }
  end

  defp decode_message_impl(
         <<"U", relation_id::integer-32, key_or_old::binary-1, number_of_columns::integer-16,
           tuple_data::binary>>
       )
       when key_or_old == "O" or key_or_old == "K" do
    {<<"N", new_number_of_columns::integer-16, new_tuple_binary::binary>>, old_decoded_tuple_data,
     old_bytes} =
      decode_tuple_data(tuple_data, number_of_columns)

    {<<>>, decoded_tuple_data, new_bytes} =
      decode_tuple_data(new_tuple_binary, new_number_of_columns)

    base_update_msg = %Update{
      relation_id: relation_id,
      tuple_data: decoded_tuple_data,
      bytes: new_bytes + old_bytes
    }

    case key_or_old do
      "K" -> Map.put(base_update_msg, :changed_key_tuple_data, old_decoded_tuple_data)
      "O" -> Map.put(base_update_msg, :old_tuple_data, old_decoded_tuple_data)
    end
  end

  defp decode_message_impl(
         <<"D", relation_id::integer-32, key_or_old::binary-1, number_of_columns::integer-16,
           tuple_data::binary>>
       )
       when key_or_old == "K" or key_or_old == "O" do
    {<<>>, decoded_tuple_data, bytes} = decode_tuple_data(tuple_data, number_of_columns)

    base_delete_msg = %Delete{
      relation_id: relation_id,
      bytes: bytes
    }

    case key_or_old do
      "K" -> Map.put(base_delete_msg, :changed_key_tuple_data, decoded_tuple_data)
      "O" -> Map.put(base_delete_msg, :old_tuple_data, decoded_tuple_data)
    end
  end

  defp decode_message_impl(
         <<"T", number_of_relations::integer-32, options::bitstring-8, column_ids::binary>>
       ) do
    truncated_relations =
      for relation_id_bin <- column_ids |> :binary.bin_to_list() |> Enum.chunk_every(4),
          do: relation_id_bin |> :binary.list_to_bin() |> :binary.decode_unsigned()

    decoded_options = decode_truncate_options(options)

    %Truncate{
      number_of_relations: number_of_relations,
      options: decoded_options,
      truncated_relations: truncated_relations
    }
  end

  defp decode_message_impl(<<"Y", data_type_id::integer-32, namespace_and_name::binary>>) do
    [namespace, name_with_null] = :binary.split(namespace_and_name, <<0>>)
    # drop the last character
    name = String.slice(name_with_null, 0..-2//1)

    %Type{
      id: data_type_id,
      namespace: namespace,
      name: name
    }
  end

  defp decode_message_impl(binary), do: %Unsupported{data: binary}

  defp decode_tuple_data(binary, columns_remaining, accumulator \\ [], size \\ 0)

  defp decode_tuple_data(remaining_binary, 0, accumulator, size) when is_binary(remaining_binary),
    do: {remaining_binary, accumulator |> Enum.reverse(), size}

  defp decode_tuple_data(<<"n", rest::binary>>, columns_remaining, accumulator, size),
    do: decode_tuple_data(rest, columns_remaining - 1, [nil | accumulator], size)

  defp decode_tuple_data(<<"u", rest::binary>>, columns_remaining, accumulator, size),
    do: decode_tuple_data(rest, columns_remaining - 1, [:unchanged_toast | accumulator], size)

  defp decode_tuple_data(
         <<"t", column_length::integer-32, rest::binary>>,
         columns_remaining,
         accumulator,
         size
       ),
       do:
         decode_tuple_data(
           :erlang.binary_part(rest, {byte_size(rest), -(byte_size(rest) - column_length)}),
           columns_remaining - 1,
           [
             :erlang.binary_part(rest, {0, column_length}) | accumulator
           ],
           size + column_length
         )

  @spec decode_columns(binary, [Column.t()]) :: [Column.t()]
  defp decode_columns(binary, accumulator \\ [])
  defp decode_columns(<<>>, accumulator), do: Enum.reverse(accumulator)

  defp decode_columns(<<flags::integer-8, rest::binary>>, accumulator) do
    [name | [<<type_oid::integer-32, type_modifier::signed-integer-32, columns::binary>>]] =
      String.split(rest, <<0>>, parts: 2)

    decoded_flags =
      case flags do
        1 -> [:key]
        _ -> []
      end

    decode_columns(columns, [
      %Column{
        name: name,
        flags: decoded_flags,
        type_oid: type_oid,
        type_modifier: type_modifier
      }
      | accumulator
    ])
  end

  @pg_epoch DateTime.from_iso8601("2000-01-01T00:00:00.000000Z") |> elem(1)
  defp pgtimestamp_to_timestamp(microsecond_offset) when is_integer(microsecond_offset) do
    DateTime.add(@pg_epoch, microsecond_offset, :microsecond)
  end

  defp decode_lsn(bin), do: Lsn.decode_bin(bin)

  defp decode_truncate_options(<<_::6, restart_identity::1, cascade::1>>) do
    Enum.reject(
      [
        if(cascade == 1, do: :cascade),
        if(restart_identity == 1, do: :restart_identity)
      ],
      &is_nil/1
    )
  end
end
