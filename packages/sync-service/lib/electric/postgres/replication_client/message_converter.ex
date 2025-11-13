defmodule Electric.Postgres.ReplicationClient.MessageConverter do
  @moduledoc """
  Conversion of incoming Postgres logical replication messages
  to internal change representation.
  """

  require Logger
  alias Electric.Replication.LogOffset
  alias Electric.Replication.Changes
  alias Electric.Postgres.LogicalReplication.Messages, as: LR

  alias Electric.Replication.Changes.{
    Begin,
    Commit,
    NewRecord,
    UpdatedRecord,
    DeletedRecord,
    TruncatedRelation,
    Relation,
    Column
  }

  defstruct relations: %{}, current_lsn: nil, tx_op_index: nil, tx_size: 0, max_tx_size: nil

  @type t() :: %__MODULE__{
          relations: %{optional(LR.relation_id()) => LR.Relation.t()},
          current_lsn: Electric.Postgres.Lsn.t() | nil,
          tx_op_index: non_neg_integer() | nil,
          tx_size: non_neg_integer(),
          max_tx_size: non_neg_integer() | nil
        }

  @doc """
  Convert incoming logical replication messages to internal change representation.
  Returns a list of changes and updated state.
  """
  @spec convert(LR.message(), t()) ::
          {[Changes.change() | Begin.t() | Commit.t() | Relation.t()], t()}
          | {:error, {:replica_not_full, String.t()}, t()}
          | {:error, {:exceeded_max_tx_size, String.t()}, t()}
  def convert(%LR.Message{} = msg, state) do
    Logger.info("Got a message from PG via logical replication: #{inspect(msg)}")
    {[], state}
  end

  def convert(%LR.Begin{} = msg, %__MODULE__{} = state) do
    {[%Begin{xid: msg.xid}], %{state | current_lsn: msg.final_lsn, tx_op_index: 0, tx_size: 0}}
  end

  def convert(%LR.Origin{} = _msg, state), do: {[], state}
  def convert(%LR.Type{}, state), do: {[], state}

  def convert(%{bytes: bytes} = _msg, %__MODULE__{max_tx_size: max, tx_size: tx_size} = state)
      when not is_nil(max) and tx_size + bytes > max do
    {:error, {:exceeded_max_tx_size, "Collected transaction exceeds limit of #{max} bytes."},
     state}
  end

  def convert(
        %LR.Relation{id: id, namespace: ns, name: name, columns: cols} = rel,
        %__MODULE__{} = state
      ) do
    new_state = Map.update!(state, :relations, &Map.put(&1, rel.id, rel))

    {
      [
        %Relation{
          id: id,
          schema: ns,
          table: name,
          columns: Enum.map(cols, fn col -> %Column{name: col.name, type_oid: col.type_oid} end)
        }
      ],
      new_state
    }
  end

  def convert(%LR.Insert{} = msg, %__MODULE__{} = state) do
    relation = Map.fetch!(state.relations, msg.relation_id)
    data = data_tuple_to_map(relation.columns, msg.tuple_data)

    {
      [
        %NewRecord{
          relation: {relation.namespace, relation.name},
          record: data,
          log_offset: current_offset(state)
        }
      ],
      state |> increment_op_index() |> increment_tx_size(msg.bytes)
    }
  end

  def convert(%LR.Update{old_tuple_data: nil} = msg, %__MODULE__{} = state) do
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

  def convert(%LR.Update{} = msg, %__MODULE__{} = state) do
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

    {
      [
        UpdatedRecord.new(
          relation: {relation.namespace, relation.name},
          old_record: old_data,
          record: data,
          log_offset: current_offset(state)
        )
      ],
      state |> increment_op_index() |> increment_tx_size(msg.bytes)
    }
  end

  def convert(%LR.Delete{} = msg, %__MODULE__{} = state) do
    relation = Map.get(state.relations, msg.relation_id)
    data = data_tuple_to_map(relation.columns, msg.old_tuple_data || msg.changed_key_tuple_data)

    {
      [
        %DeletedRecord{
          relation: {relation.namespace, relation.name},
          old_record: data,
          log_offset: current_offset(state)
        }
      ],
      state |> increment_op_index() |> increment_tx_size(msg.bytes)
    }
  end

  def convert(%LR.Truncate{} = msg, state) do
    truncated =
      msg.truncated_relations
      |> Enum.map(&Map.get(state.relations, &1))
      |> Enum.map(
        &%TruncatedRelation{relation: {&1.namespace, &1.name}, log_offset: current_offset(state)}
      )

    {truncated, increment_op_index(state)}
  end

  def convert(%LR.Commit{} = msg, %__MODULE__{} = state) do
    {
      [
        %Commit{
          lsn: msg.lsn,
          commit_timestamp: msg.commit_timestamp,
          transaction_size: state.tx_size
        }
      ],
      %{state | current_lsn: nil, tx_op_index: nil, tx_size: 0}
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

  defp current_offset(state) do
    LogOffset.new(state.current_lsn, state.tx_op_index)
  end

  defp increment_op_index(%__MODULE__{tx_op_index: tx_op_index} = state) do
    # We're adding 2 to the op index because it's possible we're splitting some of the operations before storage.
    # This gives us headroom for splitting any operation into 2.
    %{state | tx_op_index: tx_op_index + 2}
  end

  defp increment_tx_size(%__MODULE__{tx_size: tx_size} = state, bytes) do
    %{state | tx_size: tx_size + bytes}
  end

  defguard in_transaction?(converter) when not is_nil(converter.current_lsn)
end
