defmodule Electric.Postgres.ReplicationClient do
  require Logger
  alias Electric.Postgres.LogicalReplication.Messages, as: LR
  alias Electric.Postgres.LogicalReplication.Decoder

  alias Electric.Replication.Changes.{
    Transaction,
    NewRecord,
    UpdatedRecord,
    DeletedRecord,
    TruncatedRelation
  }

  use Postgrex.ReplicationConnection

  defmodule State do
    alias Electric.Replication.Changes
    @enforce_keys [:transaction_received, :publication_name]
    defstruct [
      :transaction_received,
      :publication_name,
      relations: %{},
      origin: "postgres",
      txn: nil,
      step: :disconnected
    ]

    @type t() :: %__MODULE__{
            transaction_received: {module(), atom(), [term()]},
            txn: nil | Transaction.t(),
            origin: String.t(),
            relations: %{LR.relation_id() => LR.Relation.t()},
            step: :disconnected | :create_slot | :streaming
          }

    @opts_schema NimbleOptions.new!(
                   transaction_received: [required: true, type: :mfa],
                   publication_name: [required: true, type: :string]
                 )

    @spec new(Access.t()) :: t()
    def new(opts) do
      opts = NimbleOptions.validate!(opts, @opts_schema)
      struct!(__MODULE__, opts)
    end

    @spec add_txn_change(t(), Changes.change()) :: t()
    def add_txn_change(%__MODULE__{txn: %Transaction{} = txn} = state, change),
      do: %{state | txn: Transaction.prepend_change(txn, change)}
  end

  def start_link(opts) do
    # Automatically reconnect if we lose connection.
    extra_opts = [
      auto_reconnect: true
    ]

    init_opts = State.new(Keyword.get(opts, :init_opts, []))

    Postgrex.ReplicationConnection.start_link(__MODULE__, init_opts, extra_opts ++ opts)
  end

  @impl true
  def init(%State{} = state) do
    {:ok, state}
  end

  @impl true
  def handle_connect(state) do
    query = "CREATE_REPLICATION_SLOT electric TEMPORARY LOGICAL pgoutput NOEXPORT_SNAPSHOT"
    {:query, query, %{state | step: :create_slot}}
  end

  @impl true
  def handle_result(results, %State{step: :create_slot} = state) when is_list(results) do
    query =
      "START_REPLICATION SLOT electric LOGICAL 0/0 (proto_version '1', publication_names '#{state.publication_name}')"

    Logger.info("Started replication from postgres")

    {:stream, query, [], %{state | step: :streaming}}
  end

  @impl true
  @spec handle_data(binary(), State.t()) ::
          {:noreply, State.t()} | {:noreply, list(binary()), State.t()}
  def handle_data(<<?w, _wal_start::64, _wal_end::64, _clock::64, rest::binary>>, state) do
    rest
    |> Decoder.decode()
    |> handle_message(state)
    |> case do
      %State{} = state ->
        {:noreply, state}

      {%Transaction{} = txn, %State{} = state} ->
        {m, f, args} = state.transaction_received
        apply(m, f, [txn | args])
        {:noreply, state}
    end
  end

  def handle_data(<<?k, wal_end::64, _clock::64, reply>>, state) do
    messages =
      case reply do
        1 -> [<<?r, wal_end + 1::64, wal_end + 1::64, wal_end + 1::64, current_time()::64, 0>>]
        0 -> []
      end

    {:noreply, messages, state}
  end

  @epoch DateTime.to_unix(~U[2000-01-01 00:00:00Z], :microsecond)
  defp current_time(), do: System.os_time(:microsecond) - @epoch

  defp handle_message(%LR.Message{} = msg, state) do
    Logger.info("Got a message from PG via logical replication: #{inspect(msg)}")

    state
  end

  defp handle_message(%LR.Begin{} = msg, %State{} = state) do
    txn = %Transaction{
      xid: msg.xid,
      lsn: msg.final_lsn,
      changes: [],
      commit_timestamp: msg.commit_timestamp
    }

    %{state | txn: txn}
  end

  defp handle_message(%LR.Origin{} = msg, state) do
    Logger.debug("origin: #{inspect(msg.name)}")
    state
  end

  defp handle_message(%LR.Type{}, state), do: state

  defp handle_message(%LR.Relation{} = rel, state) do
    if is_map_key(state.relations, rel.id) do
      Logger.warning("Schema had changed")
    end

    Map.update!(state, :relations, &Map.put(&1, rel.id, rel))
  end

  defp handle_message(%LR.Insert{} = msg, %State{} = state) do
    relation = Map.fetch!(state.relations, msg.relation_id)

    data = data_tuple_to_map(relation.columns, msg.tuple_data)

    new_record = %NewRecord{relation: {relation.namespace, relation.name}, record: data}

    State.add_txn_change(state, new_record)
  end

  defp handle_message(%LR.Update{} = msg, %State{} = state) do
    relation = Map.get(state.relations, msg.relation_id)

    old_data = data_tuple_to_map(relation.columns, msg.old_tuple_data)
    data = data_tuple_to_map(relation.columns, msg.tuple_data)

    updated_record =
      UpdatedRecord.new(
        relation: {relation.namespace, relation.name},
        old_record: old_data,
        record: data
      )

    State.add_txn_change(state, updated_record)
  end

  defp handle_message(%LR.Delete{} = msg, %State{} = state) do
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

    State.add_txn_change(state, deleted_record)
  end

  defp handle_message(%LR.Truncate{} = msg, state) do
    msg.truncated_relations
    |> Enum.map(&Map.get(state.relations, &1))
    |> Enum.map(&%TruncatedRelation{relation: {&1.namespace, &1.name}})
    |> Enum.reduce(state, &State.add_txn_change(&2, &1))
  end

  # When we have a new event, enqueue it and see if there's any
  # pending demand we can meet by dispatching events.

  defp handle_message(%LR.Commit{lsn: commit_lsn, end_lsn: end_lsn}, %State{txn: txn} = state)
       when not is_nil(txn) and commit_lsn == txn.lsn do
    # Metrics.span_event(state.span, :transaction, Transaction.count_operations(txn))

    {%Transaction{txn | lsn: end_lsn}, %State{state | txn: nil}}
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
end
