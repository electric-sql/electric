defmodule Electric.ReplicationServer.VaxineLogConsumer do
  use Broadway

  alias Broadway.Message
  alias Electric.Replication.Changes
  alias Electric.Replication.Row
  alias Electric.Replication.Metadata

  require Logger

  def start_link(opts) do
    producer = Keyword.fetch!(opts, :producer)

    Broadway.start_link(
      __MODULE__,
      name: Keyword.get(opts, :name, __MODULE__),
      producer: [
        module: {producer, opts},
        concurrency: 1
      ],
      processors: [
        default: [concurrency: 1]
      ]
    )
  end

  @impl true
  def handle_message(_, message, _) do
    {transaction, metadata} = process_message(message)

    Registry.dispatch(
      Electric.PostgresDispatcher,
      {:publication, metadata.publication},
      fn entries ->
        Enum.each(entries, fn {pid, slot} ->
          if slot !== metadata.origin do
            Logger.debug("Sending transaction #{inspect(transaction)} to slot: #{inspect(slot)}")
            send(pid, {:replication_message, transaction})
          end
        end)
      end
    )

    %{message | data: transaction}
  end

  def process_message(%Message{data: {:vx_wal_txn, _txid, transaction_data}}) do
    metadata = extract_metadata(transaction_data)

    transaction =
      transaction_data
      |> Enum.filter(fn {{key, _}, _, _, _} -> String.starts_with?(key, "row") end)
      |> Enum.map(fn {key, type, value, log_ops} ->
        Row
        |> struct(convert_value([key], type, value))
        |> to_updates(log_ops)
      end)
      |> to_transaction(metadata.commit_timestamp)

    {transaction, metadata}
  end

  defp extract_metadata(transaction_data) do
    case Enum.find(transaction_data, fn el -> match?({{"metadata:0", _}, _, _, _}, el) end) do
      nil ->
        raise "Transaction without metadata"

      {_key, _type, _value, ops} ->
        ops
        |> Enum.reduce(%Metadata{}, fn {[{{field, _type}, {:ok, {_timestamp, value}}}], []},
                                       acc ->
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

  defp to_updates(%Row{table: table, deleted?: deleted?, schema: schema, row: row}, log_ops) do
    processed_log_ops =
      log_ops
      |> Enum.flat_map(fn {ops, []} -> ops end)
      |> Enum.map(fn {{key, type}, op_value} -> handle_log_op(key, type, op_value) end)

    # if the final state is `deleted?` it means that the record was deleted;
    # if the entry was inserted within the transaction, it will have ops setting
    # the `table` field;
    # otherwise, its an update;
    cond do
      deleted? ->
        %Changes.DeletedRecord{old_record: to_string_keys(row), relation: {schema, table}}

      Enum.find(processed_log_ops, fn {key, _value} -> key == "table" end) ->
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

  defp handle_log_op("row", :antidote_crdt_map_rr, {:ok, {[inner_op], []}}) do
    {{inner_key, inner_type}, inner_op_value} = inner_op
    handle_log_op(["row", inner_key], inner_type, inner_op_value)
  end

  defp to_transaction(updates, timestamp) do
    %Changes.Transaction{changes: updates, commit_timestamp: timestamp}
  end
end
