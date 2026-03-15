defmodule Electric.Postgres.ReplicationClient.MessageConverter do
  @moduledoc """
  Conversion of incoming Postgres logical replication messages
  to internal event representation.

  It is stateful, consuming the replication messages in sequential order
  to keep track of the relation and transaction information needed
  to form the operations.

  It also enforces a maximum transaction size if configured to do so,
  and batches operations up to a maximum batch size before returning
  a TransactionFragment.
  """

  require Logger
  alias Electric.Replication.LogOffset
  alias Electric.Postgres.Lsn
  alias Electric.Postgres.LogicalReplication.Messages, as: LR

  alias Electric.Replication.Changes.{
    Commit,
    NewRecord,
    UpdatedRecord,
    DeletedRecord,
    TruncatedRelation,
    TransactionFragment,
    Relation,
    Column
  }

  defstruct relations: %{},
            tx_op_index: nil,
            tx_change_count: 0,
            tx_size: 0,
            max_tx_size: nil,
            max_batch_size: nil,
            txn_fragment: nil

  @type t() :: %__MODULE__{
          relations: %{optional(LR.relation_id()) => LR.Relation.t()},
          tx_op_index: non_neg_integer() | nil,
          tx_change_count: non_neg_integer(),
          tx_size: non_neg_integer(),
          max_tx_size: non_neg_integer() | nil,
          max_batch_size: non_neg_integer(),
          txn_fragment: TransactionFragment.t() | nil
        }

  def new(opts \\ []) do
    %__MODULE__{
      max_tx_size: Keyword.get(opts, :max_tx_size),
      max_batch_size: Keyword.fetch!(opts, :max_batch_size)
    }
  end

  @doc """
  Convert incoming logical replication messages to internal change representation.

  Returns:
  - `{:ok, %TransactionFragment{}, state}` when a batch is ready (on commit or max_batch_size reached)
  - `{:ok, %Relation{}, state}` when a Relation is encountered (returned immediately)
  - `{:buffering, state}` if no flush occurred
  - `{:error, reason}` on error
  """
  @spec convert(LR.message(), t()) ::
          {:ok, TransactionFragment.t() | Relation.t(), t()}
          | {:buffering, t()}
          | {:error, {:replica_not_full, String.t()}}
          | {:error, {:exceeded_max_tx_size, String.t()}}
  def convert(%LR.Message{} = msg, state) do
    Logger.notice("Got a message from PG via logical replication: #{inspect(msg)}")
    {:buffering, state}
  end

  def convert(%LR.Begin{} = msg, %__MODULE__{} = state) do
    {:buffering,
     %{
       state
       | tx_op_index: 0,
         tx_size: 0,
         tx_change_count: 0,
         txn_fragment: %TransactionFragment{
           xid: msg.xid,
           lsn: msg.final_lsn,
           has_begin?: true
         }
     }}
  end

  def convert(%LR.Origin{} = _msg, state), do: {:buffering, state}
  def convert(%LR.Type{}, state), do: {:buffering, state}

  def convert(%{bytes: bytes} = _msg, %__MODULE__{
        max_tx_size: max,
        tx_size: tx_size
      })
      when not is_nil(max) and tx_size + bytes > max do
    {:error, {:exceeded_max_tx_size, "Collected transaction exceeds limit of #{max} bytes."}}
  end

  def convert(
        %LR.Relation{id: id, namespace: ns, name: name, columns: cols} = rel,
        %__MODULE__{} = state
      ) do
    new_state = Map.update!(state, :relations, &Map.put(&1, rel.id, rel))

    {:ok,
     %Relation{
       id: id,
       schema: ns,
       table: name,
       columns: Enum.map(cols, fn col -> %Column{name: col.name, type_oid: col.type_oid} end)
     }, new_state}
  end

  def convert(%LR.Insert{} = msg, %__MODULE__{} = state) do
    relation = Map.fetch!(state.relations, msg.relation_id)
    data = data_tuple_to_map(relation.columns, msg.tuple_data)

    change = %NewRecord{
      relation: {relation.namespace, relation.name},
      record: data,
      log_offset: current_offset(state)
    }

    state
    |> change_received(msg.bytes)
    |> add_change(change)
    |> add_affected_relation({relation.namespace, relation.name})
    |> maybe_flush()
  end

  def convert(%LR.Update{old_tuple_data: nil} = msg, %__MODULE__{} = state) do
    relation = Map.get(state.relations, msg.relation_id)

    {:error,
     {:replica_not_full,
      """
      Received an update from PG for #{relation.namespace}.#{relation.name} that did not have old data included in the message.
      This means the table #{relation.namespace}.#{relation.name} doesn't have the correct replica identity mode. Electric cannot
      function with replica identity mode set to something other than FULL.

      Try executing `ALTER TABLE #{relation.namespace}.#{relation.name} REPLICA IDENTITY FULL` on Postgres.
      """}}
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

    change =
      UpdatedRecord.new(
        relation: {relation.namespace, relation.name},
        old_record: old_data,
        record: data,
        log_offset: current_offset(state)
      )

    state
    |> change_received(msg.bytes)
    |> add_change(change)
    |> add_affected_relation({relation.namespace, relation.name})
    |> maybe_flush()
  end

  def convert(%LR.Delete{} = msg, %__MODULE__{} = state) do
    relation = Map.get(state.relations, msg.relation_id)
    data = data_tuple_to_map(relation.columns, msg.old_tuple_data || msg.changed_key_tuple_data)

    change = %DeletedRecord{
      relation: {relation.namespace, relation.name},
      old_record: data,
      log_offset: current_offset(state)
    }

    state
    |> change_received(msg.bytes)
    |> add_change(change)
    |> add_affected_relation({relation.namespace, relation.name})
    |> maybe_flush()
  end

  def convert(%LR.Truncate{} = msg, state) do
    state =
      Enum.reduce(
        msg.truncated_relations,
        state,
        fn relation_id, state ->
          relation = state.relations[relation_id]

          change = %TruncatedRelation{
            relation: {relation.namespace, relation.name},
            log_offset: current_offset(state)
          }

          state
          |> change_received(_size = 0)
          |> add_change(change)
          |> add_affected_relation({relation.namespace, relation.name})
        end
      )

    maybe_flush(state)
  end

  def convert(%LR.Commit{} = msg, %__MODULE__{txn_fragment: fragment} = state) do
    now_mono = System.monotonic_time()
    initial_lag = Commit.calculate_initial_receive_lag(msg.commit_timestamp, DateTime.utc_now())

    commit = %Commit{
      commit_timestamp: msg.commit_timestamp,
      transaction_size: state.tx_size,
      txn_change_count: state.tx_change_count,
      received_at_mono: now_mono,
      initial_receive_lag: initial_lag
    }

    returned_txn_fragment =
      %{fragment | commit: commit}
      |> finalize_txn_fragment()

    {:ok, returned_txn_fragment,
     %{
       state
       | tx_op_index: nil,
         tx_size: 0,
         tx_change_count: 0,
         txn_fragment: nil
     }}
  end

  defguard in_transaction?(converter) when not is_nil(converter.txn_fragment)

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
    LogOffset.new(state.txn_fragment.lsn, state.tx_op_index)
  end

  defp change_received(%__MODULE__{} = state, bytes) do
    %{
      state
      | tx_size: state.tx_size + bytes,
        tx_change_count: state.tx_change_count + 1,
        # We're adding 2 to the op index because it's possible we're splitting some of the operations before storage.
        # This gives us headroom for splitting any operation into 2.
        tx_op_index: state.tx_op_index + 2
    }
  end

  defp add_change(%__MODULE__{txn_fragment: fragment} = state, change) do
    %{
      state
      | txn_fragment: %{
          fragment
          | changes: [change | fragment.changes],
            change_count: fragment.change_count + 1
        }
    }
  end

  defp add_affected_relation(%__MODULE__{txn_fragment: fragment} = state, relation) do
    %{
      state
      | txn_fragment: %{
          fragment
          | affected_relations: MapSet.put(fragment.affected_relations, relation)
        }
    }
  end

  defp maybe_flush(
         %__MODULE__{
           txn_fragment: %{change_count: change_count} = fragment,
           max_batch_size: max_batch_size
         } = state
       )
       when change_count >= max_batch_size do
    # Keep the most recent change in the state so that, if the next message is Commit, the last
    # txn fragment has at least one change.
    #
    # Before this safeguard got introduced, it was possible to observe a scenario where a txn
    # fragment was returned due to reaching the max_batch_size but the next message was Commit
    # and, as a result, a txn fragment with an empty list of changes and the same
    # last_log_offset as the preceding fragment would be returned. This last fragment would then get
    # skipped by ShapeLogCollector (due to the already seen offset) and the shape consumer
    # process would never see the Commit change for the transaction.

    [last_change | fragment_changes] = fragment.changes

    returned_txn_fragment =
      %{fragment | changes: fragment_changes, change_count: fragment.change_count - 1}
      |> finalize_txn_fragment()

    state =
      %{
        state
        | txn_fragment: %TransactionFragment{
            xid: fragment.xid,
            lsn: fragment.lsn
          }
      }
      |> add_change(last_change)
      |> add_affected_relation(last_change.relation)

    {:ok, returned_txn_fragment, state}
  end

  defp maybe_flush(state), do: {:buffering, state}

  # Empty transaction
  defp finalize_txn_fragment(%TransactionFragment{changes: []} = fragment) do
    %{fragment | last_log_offset: LogOffset.new(Lsn.to_integer(fragment.lsn), 0)}
  end

  # Changes are accumulated in reverse order, so hd(changes) is the most recent one.
  # We use its log_offset to populate the fragment's last_log_offset.
  defp finalize_txn_fragment(%TransactionFragment{changes: changes} = fragment) do
    [%{log_offset: last_log_offset} | _] = changes
    %{fragment | last_log_offset: last_log_offset, changes: Enum.reverse(changes)}
  end
end
