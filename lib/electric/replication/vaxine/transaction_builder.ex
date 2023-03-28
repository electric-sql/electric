defmodule Electric.Replication.Vaxine.TransactionBuilder do
  alias Electric.Replication.Changes
  alias Electric.Replication.Row
  alias Electric.Replication.Metadata
  alias Electric.Replication.Vaxine.LogProducer

  require Logger

  @spec build_transaction(LogProducer.vx_wal_txn(), Metadata.t()) ::
          {:ok, Changes.Transaction.t()} | {:error, :invalid_materialized_row}
  def build_transaction(
        {:vx_wal_txn, _txid, _dc_id, _wal_position, vaxine_transaction_data},
        metadata
      ) do
    vaxine_transaction_data
    |> build_rows()
    |> do_build_transaction(metadata)
  end

  defp build_rows(vaxine_transaction_data) do
    vaxine_transaction_data
    |> Enum.filter(fn {{key, _}, _, _, _} -> String.starts_with?(key, "row") end)
    |> Enum.map(fn {key, type, value, _log_ops} ->
      to_row(convert_value([key], type, value))
    end)
  end

  defp to_row(map) when map_size(map) == 0, do: nil
  defp to_row(map), do: struct(Row, map)

  @spec do_build_transaction(
          [Row.t() | nil],
          Metadata.t()
        ) :: {:ok, Changes.Transaction.t()} | {:error, :invalid_materialized_row}
  defp do_build_transaction(entries, metadata) do
    entries
    |> Enum.reduce_while([], fn
      nil, _acc ->
        Logger.error("empty row (nil)")
        {:halt, {:error, :invalid_materialized_row}}

      %{id: nil} = row, _acc ->
        Logger.error("empty id for row: #{inspect(row)}")
        {:halt, {:error, :invalid_materialized_row}}

      row, acc ->
        {:cont, [to_dml(row) | acc]}
    end)
    |> case do
      dml_changes when is_list(dml_changes) ->
        {:ok,
         %Changes.Transaction{
           changes: Enum.reverse(dml_changes),
           commit_timestamp: metadata.commit_timestamp,
           origin: metadata.origin
         }}

      error ->
        error
    end
  end

  @doc """
  Extracts metadata from a vx_client message

  The metadata is extracted from the operations performed in the transaction,
  and not from the materialized value. By using this approach, we can use
  a single key on Vaxine to store metadata for all transactions, without
  worrying with conflict resolution.

  Should futurely be superseded by transaction metadata at Vaxine's side.
  """
  @spec extract_metadata(LogProducer.vx_wal_txn()) ::
          {:ok, Metadata.t()} | {:error, :metadata_not_available}
  def extract_metadata({:vx_wal_txn, _tx_id, _dc_id, _wal_position, vaxine_transaction_data}) do
    case Enum.find(vaxine_transaction_data, fn el -> match?({{"metadata:0", _}, _, _, _}, el) end) do
      nil ->
        {:error, :metadata_not_available}

      {_key, _type, _value, ops} ->
        metadata =
          ops
          |> Enum.reduce(%Metadata{}, fn entry, acc ->
            # decomposing lww register update
            {[{{field, _type}, {:ok, {_timestamp, value}}}], []} = entry
            field_atom = String.to_existing_atom(field)
            Map.put(acc, field_atom, value)
          end)
          |> Map.update!(:commit_timestamp, &(DateTime.from_iso8601(&1) |> elem(1)))

        {:ok, metadata}
    end
  end

  # FIXME: I do not follow why do we return internal representation of the types here
  # we should be providing just anitodote_crdt:value() here instead
  defp convert_value(keys, :antidote_crdt_map_rr, value) do
    value
    |> :dict.to_list()
    |> Map.new(fn {{sub_key, type}, value} ->
      {String.to_atom(sub_key), convert_value([sub_key | keys], type, value)}
    end)
  end

  defp convert_value([_, _], :antidote_crdt_register_lww, {_token, value}) do
    value
  end

  defp convert_value(_keys, :antidote_crdt_register_lww, {_token, value}) when is_binary(value) do
    :erlang.binary_to_term(value)
  end

  defp convert_value(_keys, :antidote_crdt_flag_dw, {enable_tokens, disable_tokens}) do
    length(disable_tokens -- enable_tokens) == 0
  end

  defp convert_value(_key, :antidote_crdt_set_aw, internal_value) do
    :orddict.fetch_keys(internal_value)
  end

  defp to_dml(%Row{table: table, deleted?: deleted, schema: schema, row: row}) do
    # "Deteled" is implemented as an OR-set, however setting field to a bottom value
    # in crdt map with "observed_remove" strategy will remove this field from the map.
    # So we only expect nil when the value was deleted, and `[]` is mostly likely
    # and indication that a row was created.

    case deleted == [] or deleted == nil do
      true ->
        %Changes.DeletedRecord{old_record: to_string_keys(row), relation: {schema, table}}

      false ->
        %Changes.UpdatedRecord{
          record: to_string_keys(row),
          relation: {schema, table},
          tags: deleted
        }
    end
  end

  defp to_string_keys(map) do
    Map.new(map, fn {key, value} -> {Atom.to_string(key), value} end)
  end
end
