defmodule Electric.Postgres.ReplicationClient.Collector do
  @moduledoc """
  Conversion of incoming Postgres logical replication messages
  to internal change representation.
  """

  require Logger
  alias Electric.Replication.LogOffset
  alias Electric.Replication.Changes
  alias Electric.Postgres.LogicalReplication.Messages, as: LR

  alias Electric.Replication.Changes.{
    Transaction,
    NewRecord,
    UpdatedRecord,
    DeletedRecord,
    TruncatedRelation,
    Relation,
    Column
  }

  defstruct transaction: nil, tx_op_index: nil, tx_size: 0, max_tx_size: nil, relations: %{}

  @type t() :: %__MODULE__{
          transaction: nil | Transaction.t(),
          tx_op_index: nil | non_neg_integer(),
          tx_size: non_neg_integer(),
          relations: %{optional(LR.relation_id()) => LR.Relation.t()},
          max_tx_size: nil | non_neg_integer()
        }

  @type txn_meta() :: %{byte_size: non_neg_integer()}

  @doc """
  Handle incoming logical replication message by either building up a transaction or
  returning a complete built up transaction.
  """
  @spec handle_message(LR.message(), t()) ::
          t()
          | {Transaction.t(), txn_meta(), t()}
          | {Relation.t(), t()}
          | {:error, {:replica_not_full | :exceeded_max_tx_size, String.t()}, t()}
  def handle_message(%LR.Message{} = msg, state) do
    Logger.info("Got a message from PG via logical replication: #{inspect(msg)}")

    state
  end

  def handle_message(%LR.Begin{} = msg, %__MODULE__{} = state) do
    txn = %Transaction{
      xid: msg.xid,
      lsn: msg.final_lsn,
      changes: [],
      commit_timestamp: msg.commit_timestamp
    }

    %{state | transaction: txn, tx_op_index: 0}
  end

  def handle_message(%LR.Origin{} = _msg, state), do: state
  def handle_message(%LR.Type{}, state), do: state

  def handle_message(
        %LR.Relation{id: id, namespace: ns, name: name, columns: cols} = rel,
        %__MODULE__{} = state
      ) do
    new_state = Map.update!(state, :relations, &Map.put(&1, rel.id, rel))

    {
      %Relation{
        id: id,
        schema: ns,
        table: name,
        columns: Enum.map(cols, fn col -> %Column{name: col.name, type_oid: col.type_oid} end)
      },
      new_state
    }
  end

  def handle_message(%LR.Insert{} = msg, %__MODULE__{} = state) do
    relation = Map.fetch!(state.relations, msg.relation_id)

    data = data_tuple_to_map(relation.columns, msg.tuple_data)
    offset = LogOffset.new(state.transaction.lsn, state.tx_op_index)

    %NewRecord{relation: {relation.namespace, relation.name}, record: data, log_offset: offset}
    |> prepend_change(msg.bytes, state)
  end

  def handle_message(%LR.Update{old_tuple_data: nil} = msg, %__MODULE__{} = state) do
    relation = Map.get(state.relations, msg.relation_id)

    {
      :error,
      {:replica_not_full,
       """
       Received an update from PG for #{relation.namespace}.#{relation.name} that did not have old data included in the message.
       This means the table #{relation.namespace}.#{relation.name} doesn't have the correct replica identity mode. Electric cannot
       function with replica identity mode set to something other than FULL.

       Try executing `ALTER TABLE #{relation.namespace}.#{relation.name} REPLICA IDENTITY FULL` on Postgres.
       """},
      state
    }
  end

  def handle_message(%LR.Update{} = msg, %__MODULE__{} = state) do
    relation = Map.get(state.relations, msg.relation_id)

    old_data = data_tuple_to_map(relation.columns, msg.old_tuple_data)

    data =
      data_tuple_to_map(relation.columns, msg.tuple_data, fn
        # Postgres always de-toasts and writes values in old tuple data to WAL for tables that have
        # `REPLICA IDENTITY FULL`. Thanks to that we can replace the `:unchanged_toast`
        # placeholder with actual values before returning the decoded record update.
        #
        # For more info, see https://github.com/electric-sql/electric/issues/171.
        column_name, :unchanged_toast -> Map.fetch!(old_data, column_name)
        _, value -> value
      end)

    offset = LogOffset.new(state.transaction.lsn, state.tx_op_index)

    UpdatedRecord.new(
      relation: {relation.namespace, relation.name},
      old_record: old_data,
      record: data,
      log_offset: offset
    )
    |> prepend_change(msg.bytes, state)
  end

  def handle_message(%LR.Delete{} = msg, %__MODULE__{} = state) do
    relation = Map.get(state.relations, msg.relation_id)

    data = data_tuple_to_map(relation.columns, msg.old_tuple_data || msg.changed_key_tuple_data)

    offset = LogOffset.new(state.transaction.lsn, state.tx_op_index)

    %DeletedRecord{
      relation: {relation.namespace, relation.name},
      old_record: data,
      log_offset: offset
    }
    |> prepend_change(msg.bytes, state)
  end

  def handle_message(%LR.Truncate{} = msg, state) do
    offset = LogOffset.new(state.transaction.lsn, state.tx_op_index)

    msg.truncated_relations
    |> Enum.map(&Map.get(state.relations, &1))
    |> Enum.map(&%TruncatedRelation{relation: {&1.namespace, &1.name}, log_offset: offset})
    |> Enum.reduce(state, &prepend_change(&1, 0, &2))
  end

  def handle_message(%LR.Commit{lsn: commit_lsn}, %__MODULE__{transaction: txn} = state)
      when not is_nil(txn) and commit_lsn == txn.lsn do
    {
      Transaction.finalize(txn),
      txn_meta(state),
      %{state | transaction: nil, tx_op_index: nil, tx_size: 0}
    }
  end

  @spec data_tuple_to_map([LR.Relation.Column.t()], list(String.t())) :: %{
          String.t() => String.t()
        }
  defp data_tuple_to_map(_columns, nil), do: %{}

  defp data_tuple_to_map(columns, tuple_data),
    do: data_tuple_to_map(columns, tuple_data, &column_value/2)

  defp data_tuple_to_map(columns, tuple_data, value_fun) do
    columns
    |> Enum.zip(tuple_data)
    |> Map.new(fn {%{name: column_name}, value} ->
      {column_name, value_fun.(column_name, value)}
    end)
  end

  defp column_value(_column_name, value), do: value

  @spec prepend_change(Changes.change(), non_neg_integer(), t()) ::
          t() | {:error, {:exceeded_max_tx_size, String.t()}, t()}
  defp prepend_change(_, bytes, %__MODULE__{max_tx_size: max_tx_size, tx_size: tx_size} = state)
       when is_number(max_tx_size) and tx_size + bytes > max_tx_size do
    {
      :error,
      {:exceeded_max_tx_size, "Collected transaction exceeds limit of #{max_tx_size} bytes."},
      state
    }
  end

  defp prepend_change(
         change,
         bytes,
         %__MODULE__{transaction: txn, tx_op_index: tx_op_index, tx_size: tx_size} = state
       ) do
    %{
      state
      | transaction: Transaction.prepend_change(txn, change),
        # We're adding 2 to the op index because it's possible we're splitting some of the operations before storage.
        # This gives us headroom for splitting any operation into 2.
        tx_op_index: tx_op_index + 2,
        tx_size: tx_size + bytes
    }
  end

  defp txn_meta(state) do
    %{byte_size: state.tx_size}
  end

  defguard is_collecting(collector) when not is_nil(collector.transaction)
end
