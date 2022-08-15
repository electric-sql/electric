defmodule Electric.Replication.Postgres.LogicalReplicationProducer do
  use GenStage
  require Logger

  alias Electric.Postgres.LogicalReplication

  alias Electric.Postgres.LogicalReplication.Messages.{
    Begin,
    Origin,
    Commit,
    Relation,
    Insert,
    Update,
    Delete,
    Truncate,
    Type
  }

  alias Electric.Replication.Changes.{
    Transaction,
    NewRecord,
    UpdatedRecord,
    DeletedRecord,
    TruncatedRelation
  }

  defmodule State do
    defstruct conn: nil,
              demand: 0,
              queue: nil,
              relations: %{},
              transaction: nil,
              publication: nil,
              client: nil,
              origin: nil,
              drop_current_transaction?: false,
              types: %{}
  end

  def start_link(opts) do
    GenStage.start_link(__MODULE__, opts)
  end

  @impl true
  def init(opts) do
    publication = opts.replication.publication
    slot = opts.replication.slot

    with {:ok, conn} <- opts.client.connect(opts.connection),
         :ok <- opts.client.start_replication(conn, publication, slot, self()) do
      Logger.metadata(origin: opts.origin)
      Logger.info("Starting replication from #{opts.origin}")
      Logger.info("Connection settings: #{inspect(opts)}")

      {:producer,
       %State{
         conn: conn,
         queue: :queue.new(),
         publication: publication,
         client: opts.client,
         origin: opts.origin
       }}
    end
  end

  @impl true
  def handle_info({:epgsql, _pid, {:x_log_data, _start_lsn, _end_lsn, binary_msg}}, state) do
    binary_msg
    |> LogicalReplication.decode_message()
    |> process_message(state)
  end

  @impl true
  def handle_info(msg, state) do
    Logger.debug("Unexpected message #{inspect(msg)}")
    {:noreply, [], state}
  end

  defp process_message(%Begin{} = msg, state) do
    tx = %Transaction{changes: [], commit_timestamp: msg.commit_timestamp}

    {:noreply, [], %{state | transaction: {msg.final_lsn, tx}}}
  end

  defp process_message(%Origin{}, state) do
    # If we got the "origin" message, it means that the Postgres sending the data has got it from Electric already
    # so we just drop the transaction altogether
    {:noreply, [], %{state | drop_current_transaction?: true}}
  end

  defp process_message(%Type{}, state), do: {:noreply, [], state}

  defp process_message(%Relation{} = msg, state) do
    {:noreply, [], %{state | relations: Map.put(state.relations, msg.id, msg)}}
  end

  defp process_message(%Insert{} = msg, state) do
    relation = Map.get(state.relations, msg.relation_id)

    data = data_tuple_to_map(relation.columns, msg.tuple_data)

    new_record = %NewRecord{relation: {relation.namespace, relation.name}, record: data}

    {lsn, txn} = state.transaction
    txn = %{txn | changes: [new_record | txn.changes]}

    {:noreply, [], %{state | transaction: {lsn, txn}}}
  end

  defp process_message(%Update{} = msg, state) do
    relation = Map.get(state.relations, msg.relation_id)

    old_data = data_tuple_to_map(relation.columns, msg.old_tuple_data)
    data = data_tuple_to_map(relation.columns, msg.tuple_data)

    updated_record = %UpdatedRecord{
      relation: {relation.namespace, relation.name},
      old_record: old_data,
      record: data
    }

    {lsn, txn} = state.transaction
    txn = %{txn | changes: [updated_record | txn.changes]}

    {:noreply, [], %{state | transaction: {lsn, txn}}}
  end

  defp process_message(%Delete{} = msg, state) do
    relation = Map.get(state.relations, msg.relation_id)

    data =
      data_tuple_to_map(
        relation.columns,
        msg.old_tuple_data || msg.changed_key_tuple_data
      )

    deleted_record = %DeletedRecord{
      relation: {relation.namespace, relation.name},
      old_record: data
    }

    {lsn, txn} = state.transaction
    txn = %{txn | changes: [deleted_record | txn.changes]}

    {:noreply, [], %{state | transaction: {lsn, txn}}}
  end

  defp process_message(%Truncate{} = msg, state) do
    truncated_relations =
      for truncated_relation <- msg.truncated_relations do
        relation = Map.get(state.relations, truncated_relation)

        %TruncatedRelation{
          relation: {relation.namespace, relation.name}
        }
      end

    {lsn, txn} = state.transaction
    txn = %{txn | changes: Enum.reverse(truncated_relations) ++ txn.changes}

    {:noreply, [], %{state | transaction: {lsn, txn}}}
  end

  # When we have a new event, enqueue it and see if there's any
  # pending demand we can meet by dispatching events.

  defp process_message(
         %Commit{lsn: commit_lsn},
         %State{transaction: {current_txn_lsn, _}, drop_current_transaction?: true} = state
       )
       when commit_lsn == current_txn_lsn do
    {:noreply, [], %{state | transaction: nil, drop_current_transaction?: false}}
  end

  defp process_message(
         %Commit{lsn: commit_lsn, end_lsn: end_lsn},
         %State{transaction: {current_txn_lsn, txn}, queue: queue} = state
       )
       when commit_lsn == current_txn_lsn do
    event = build_message(Map.update!(txn, :changes, &Enum.reverse/1), end_lsn, state)

    queue = :queue.in(event, queue)
    state = %{state | queue: queue, transaction: nil, drop_current_transaction?: false}

    dispatch_events(state, [])
  end

  # When we have new demand, add it to any pending demand and see if we can
  # meet it by dispatching events.
  @impl true
  def handle_demand(incoming_demand, %{demand: pending_demand} = state) do
    state = %{state | demand: incoming_demand + pending_demand}

    dispatch_events(state, [])
  end

  # When we're done exhausting demand, emit events.
  defp dispatch_events(%{demand: 0} = state, events) do
    emit_events(state, events)
  end

  defp dispatch_events(%{demand: demand, queue: queue} = state, events) do
    case :queue.out(queue) do
      # If the queue has events, recurse to accumulate them
      # as long as there is demand.
      {{:value, event}, queue} ->
        state = %{state | demand: demand - 1, queue: queue}

        dispatch_events(state, [event | events])

      # When the queue is empty, emit any accumulated events.
      {:empty, queue} ->
        state = %{state | queue: queue}

        emit_events(state, events)
    end
  end

  defp emit_events(state, []) do
    {:noreply, [], state}
  end

  defp emit_events(state, events) do
    {:noreply, Enum.reverse(events), state}
  end

  # TODO: Typecast to meaningful Elixir types here later
  defp data_tuple_to_map(_columns, nil), do: %{}

  defp data_tuple_to_map(columns, tuple_data) do
    columns
    |> Enum.zip(Tuple.to_list(tuple_data))
    |> Map.new(fn {column, data} -> {column.name, data} end)
  end

  defp build_message(transaction, end_lsn, state) do
    %Broadway.Message{
      data: transaction,
      metadata: %{publication: state.publication, origin: state.origin},
      acknowledger: {__MODULE__, {state.conn, state.origin}, {state.client, end_lsn}}
    }
  end

  def ack(_, [], []), do: nil
  def ack(_, _, x) when length(x) > 0, do: throw("XXX ack failure handling not yet implemented")

  def ack({conn, origin}, successful, _) do
    {_, _, {client, end_lsn}} =
      successful
      |> List.last()
      |> Map.fetch!(:acknowledger)

    Logger.debug("Acknowledging #{end_lsn}", origin: origin)
    client.acknowledge_lsn(conn, end_lsn)
  end
end
