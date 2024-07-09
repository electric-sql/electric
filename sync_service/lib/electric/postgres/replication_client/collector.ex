defmodule Electric.Postgres.ReplicationClient.Collector do
  @moduledoc """
  Conversion of incoming Postgres logical replication messages
  to internal change representation.
  """

  require Logger
  alias Electric.Replication.Changes
  alias Electric.Postgres.LogicalReplication.Messages, as: LR

  alias Electric.Replication.Changes.{
    Transaction,
    NewRecord,
    UpdatedRecord,
    DeletedRecord,
    TruncatedRelation
  }

  defstruct transaction: nil, relations: %{}

  @type t() :: %__MODULE__{
          transaction: nil | Transaction.t(),
          relations: %{optional(LR.relation_id()) => LR.Relation.t()}
        }

  @doc """
  Handle incoming logical replication message by either building up a transaction or
  returning a complete built up transaction.
  """
  @spec handle_message(LR.message(), t()) :: t() | {Transaction.t(), t()}
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

    %{state | transaction: txn}
  end

  def handle_message(%LR.Origin{} = _msg, state), do: state
  def handle_message(%LR.Type{}, state), do: state

  def handle_message(%LR.Relation{id: id} = rel, %__MODULE__{} = state) do
    if Map.get(state.relations, id, rel) != rel do
      Logger.warning("Schema for the table #{rel.namespace}.#{rel.name} had changed")
    end

    Map.update!(state, :relations, &Map.put(&1, rel.id, rel))
  end

  def handle_message(%LR.Insert{} = msg, %__MODULE__{} = state) do
    relation = Map.fetch!(state.relations, msg.relation_id)

    data = data_tuple_to_map(relation.columns, msg.tuple_data)

    %NewRecord{relation: {relation.namespace, relation.name}, record: data}
    |> prepend_change(state)
  end

  def handle_message(%LR.Update{} = msg, %__MODULE__{} = state) do
    relation = Map.get(state.relations, msg.relation_id)

    if is_nil(msg.old_tuple_data),
      do:
        Logger.error("""
        Received an update from PG for #{relation.namespace}.#{relation.name} that did not have old data included in the message.
        This means the table #{relation.namespace}.#{relation.name} doesn't have the correct replica identity mode. Electric cannot
        function with replica identity mode set to something other than FULL.

        Try executing `ALTER TABLE #{relation.namespace}.#{relation.name} REPLICA IDENTITY FULL` on Postgres.
        """)

    old_data = data_tuple_to_map(relation.columns, msg.old_tuple_data)
    data = data_tuple_to_map(relation.columns, msg.tuple_data)

    UpdatedRecord.new(
      relation: {relation.namespace, relation.name},
      old_record: old_data,
      record: data
    )
    |> prepend_change(state)
  end

  def handle_message(%LR.Delete{} = msg, %__MODULE__{} = state) do
    relation = Map.get(state.relations, msg.relation_id)

    data =
      data_tuple_to_map(
        relation.columns,
        msg.old_tuple_data || msg.changed_key_tuple_data
      )

    %DeletedRecord{
      relation: {relation.namespace, relation.name},
      old_record: data
    }
    |> prepend_change(state)
  end

  def handle_message(%LR.Truncate{} = msg, state) do
    msg.truncated_relations
    |> Enum.map(&Map.get(state.relations, &1))
    |> Enum.map(&%TruncatedRelation{relation: {&1.namespace, &1.name}})
    |> Enum.reduce(state, &prepend_change/2)
  end

  def handle_message(
        %LR.Commit{lsn: commit_lsn, end_lsn: end_lsn},
        %__MODULE__{transaction: txn} = state
      )
      when not is_nil(txn) and commit_lsn == txn.lsn do
    {%Transaction{txn | lsn: end_lsn, changes: Enum.reverse(txn.changes)},
     %__MODULE__{state | transaction: nil}}
  end

  @spec data_tuple_to_map([LR.Relation.Column.t()], list(String.t())) :: %{
          String.t() => String.t()
        }
  defp data_tuple_to_map(_columns, nil), do: %{}

  defp data_tuple_to_map(columns, tuple_data) do
    columns
    |> Enum.zip(tuple_data)
    |> Map.new(fn {column, data} -> {column.name, data} end)
  end

  @spec prepend_change(Changes.change(), t()) :: t()
  defp prepend_change(change, %__MODULE__{transaction: txn} = state) do
    %{state | transaction: Transaction.prepend_change(txn, change)}
  end
end
