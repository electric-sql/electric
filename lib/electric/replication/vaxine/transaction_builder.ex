defmodule Electric.Replication.Vaxine.TransactionBuilder do
  alias Electric.Replication.Changes
  alias Electric.Replication.Row
  alias Electric.Replication.Metadata
  alias Electric.ReplicationServer.VaxineLogProducer

  @spec build_transaction(VaxineLogProducer.vx_wal_txn(), Metadata.t()) ::
          {:ok, Changes.Transaction.t()} | {:error, :invalid_materialized_row}
  def build_transaction({:vx_wal_txn, _txid, vaxine_transaction_data}, metadata) do
    vaxine_transaction_data
    |> build_rows()
    |> build_transaction(metadata.commit_timestamp, :origin)
  end

  defp build_rows(vaxine_transaction_data) do
    vaxine_transaction_data
    |> Enum.filter(fn {{key, _}, _, _, _} -> String.starts_with?(key, "row") end)
    |> Enum.map(fn {key, type, value, log_ops} ->
      processed_log_ops =
        log_ops
        |> Enum.flat_map(fn {ops, []} -> ops end)
        |> Enum.map(fn {{key, type}, op_value} -> handle_log_op(key, type, op_value) end)

      {to_row(convert_value([key], type, value)), processed_log_ops}
    end)
  end

  defp to_row(map) when map_size(map) == 0, do: nil
  defp to_row(map), do: struct(Row, map)

  @spec build_transaction(
          [{Row.t() | nil, ops :: term()}],
          commit_timestamp :: DateTime.t(),
          target :: :origin | :peers
        ) :: {:ok, Changes.Transaction.t()} | {:error, :invalid_materialized_row}
  defp build_transaction(entries, commit_timestamp, target) do
    entries
    |> Enum.reduce_while([], fn
      {nil, _ops}, _acc -> {:halt, {:error, :invalid_materialized_row}}
      {row, ops}, acc -> {:cont, [to_dml(row, ops, target) | acc]}
    end)
    |> case do
      dml_changes when is_list(dml_changes) ->
        {:ok,
         %Changes.Transaction{
           changes: Enum.reverse(dml_changes),
           commit_timestamp: commit_timestamp
         }}

      {:halt, error} ->
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
  @spec extract_metadata(VaxineLogProducer.vx_wal_txn()) ::
          {:ok, Metadata.t()} | {:error, :metadata_not_available}
  def extract_metadata({:vx_wal_txn, _tx_id, vaxine_transaction_data}) do
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

  defp to_dml(
         %Row{table: table, deleted?: deleted?, schema: schema, row: row},
         _processed_log_ops,
         _target
       ) do
    # if the final state is `deleted?` it means that the record was deleted;
    # if the entry was inserted within the transaction, it will have ops setting
    # the `table` field;
    # otherwise, its an update;
    cond do
      deleted? ->
        %Changes.DeletedRecord{old_record: to_string_keys(row), relation: {schema, table}}

      true ->
        %Changes.UpdatedRecord{
          record: to_string_keys(row),
          relation: {schema, table}
        }
    end
  end

  defp to_string_keys(map) do
    Map.new(map, fn {key, value} -> {Atom.to_string(key), value} end)
  end

  defp handle_log_op(key, :antidote_crdt_register_lww, {:ok, {_ts, value}}) do
    if is_list(key) do
      {key, :erlang.binary_to_term(value)}
    else
      {key, value}
    end
  end

  defp handle_log_op(key, :antidote_crdt_flag_dw, {:ok, {_, _, _}}) do
    {key, :touched}
  end

  defp handle_log_op(key, :antidote_crdt_counter_pn, {:ok, _}) do
    {key, :touched}
  end

  defp handle_log_op("row", :antidote_crdt_map_rr, {:ok, {[inner_op], []}}) do
    {{inner_key, inner_type}, inner_op_value} = inner_op
    handle_log_op(["row", inner_key], inner_type, inner_op_value)
  end
end
