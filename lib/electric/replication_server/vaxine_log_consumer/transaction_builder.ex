defmodule Electric.ReplicationServer.VaxineLogConsumer.TransactionBuilder do
  alias Electric.Replication.Changes
  alias Electric.Replication.Row
  alias Electric.Replication.Metadata
  alias Electric.ReplicationServer.VaxineLogProducer

  @spec build_transaction_for_origin(VaxineLogProducer.vx_wal_txn(), Metadata.t()) ::
          Changes.Transaction.t()
  def build_transaction_for_origin({:vx_wal_txn, _txid, vaxine_transaction_data}, metadata) do
    vaxine_transaction_data
    |> build_rows()
    |> build_transaction(metadata.commit_timestamp, :origin)
  end

  @spec build_transaction_for_peers(VaxineLogProducer.vx_wal_txn(), Metadata.t()) ::
          Changes.Transaction.t()
  def build_transaction_for_peers({:vx_wal_txn, _txid, vaxine_transaction_data}, metadata) do
    vaxine_transaction_data
    |> build_rows()
    |> build_transaction(metadata.commit_timestamp, :peers)
  end

  defp build_rows(vaxine_transaction_data) do
    vaxine_transaction_data
    |> Enum.filter(fn {{key, _}, _, _, _} -> String.starts_with?(key, "row") end)
    |> Enum.map(fn {key, type, value, log_ops} ->
      processed_log_ops =
        log_ops
        |> Enum.flat_map(fn {ops, []} -> ops end)
        |> Enum.map(fn {{key, type}, op_value} -> handle_log_op(key, type, op_value) end)

      {struct(Row, convert_value([key], type, value)), processed_log_ops}
    end)
  end

  @spec build_transaction(
          [{Row.t(), ops :: term()}],
          commit_timestamp :: DateTime.t(),
          target :: :origin | :peers
        ) :: Changes.Transaction.t()
  defp build_transaction(entries, commit_timestamp, target) do
    dml_changes = Enum.map(entries, fn {row, ops} -> to_dml(row, ops, target) end)
    %Changes.Transaction{changes: dml_changes, commit_timestamp: commit_timestamp}
  end

  @doc """
  Extracts metadata from a vx_client message
  """
  @spec extract_metadata(VaxineLogProducer.vx_wal_txn()) :: Metadata.t()
  def extract_metadata({:vx_wal_txn, _tx_id, vaxine_transaction_data}) do
    case Enum.find(vaxine_transaction_data, fn el -> match?({{"metadata:0", _}, _, _, _}, el) end) do
      nil ->
        raise "Transaction without metadata"

      {_key, _type, _value, ops} ->
        ops
        |> Enum.reduce(%Metadata{}, fn entry, acc ->
          # decomposing lww register update
          {[{{field, _type}, {:ok, {_timestamp, value}}}], []} = entry
          field_atom = String.to_existing_atom(field)
          Map.put(acc, field_atom, value)
        end)
        |> Map.update!(:commit_timestamp, &(DateTime.from_iso8601(&1) |> elem(1)))
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
         processed_log_ops,
         target
       ) do
    # if the final state is `deleted?` it means that the record was deleted;
    # if the entry was inserted within the transaction, it will have ops setting
    # the `table` field;
    # otherwise, its an update;
    cond do
      deleted? ->
        %Changes.DeletedRecord{old_record: to_string_keys(row), relation: {schema, table}}

      Enum.find(processed_log_ops, fn {key, _value} -> key == "table" end) && target != :origin ->
        %Changes.NewRecord{record: to_string_keys(row), relation: {schema, table}}

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
