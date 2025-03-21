defmodule Electric.Replication.ShapeLogCollector do
  @moduledoc """
  When any txn comes from postgres, we need to store it into the
  log for this shape if and only if it has txid >= xmin of the snapshot.
  """
  use GenStage

  require Electric.Postgres.Lsn
  alias Electric.LsnTracker
  alias Electric.Replication.ShapeLogCollector.AffectedColumns
  alias Electric.Postgres.Lsn
  alias Electric.Replication.PersistentReplicationState
  alias Electric.Postgres.Inspector
  alias Electric.Replication.Changes
  alias Electric.Replication.Changes.{Relation, Transaction}
  alias Electric.Telemetry.OpenTelemetry

  require Logger

  @schema NimbleOptions.new!(
            stack_id: [type: :string, required: true],
            inspector: [type: :mod_arg, required: true],
            persistent_kv: [type: :any, required: true]
          )

  def start_link(opts) do
    with {:ok, opts} <- NimbleOptions.validate(opts, @schema) do
      GenStage.start_link(__MODULE__, Map.new(opts), name: name(opts[:stack_id]))
    end
  end

  def name(stack_id) do
    Electric.ProcessRegistry.name(stack_id, __MODULE__)
  end

  def start_processing(server, last_processed_lsn) do
    GenStage.call(server, {:start_processing, last_processed_lsn})
  end

  # use `GenStage.call/2` here to make the event processing synchronous.
  #
  # Because `Electric.Shapes.Dispatcher` only sends demand to this producer
  # when all consumers have processed the last event, we can save the `from`
  # clause in the matching `handle_call/3` function and then use
  # `GenServer.reply/2` in the `demand/2` callback to inform the replication
  # client that the replication message has been processed.
  #
  # This `call/3` has a timeout of `:infinity` because timeouts are
  # handled at the storage layer, that is this function doesn't
  # assume any aggregate max time for the shape consumers to actually commit
  # the new tx to disk, instead the storage backend is responsible for
  # determining how long a write should reasonably take and if that fails
  # it should raise.
  def store_transaction(%Transaction{} = txn, server) do
    trace_context = OpenTelemetry.get_current_context()
    GenStage.call(server, {:new_txn, txn, trace_context}, :infinity)
  end

  def handle_relation_msg(%Changes.Relation{} = rel, server) do
    trace_context = OpenTelemetry.get_current_context()
    GenServer.call(server, {:relation_msg, rel, trace_context}, :infinity)
  end

  def init(opts) do
    Process.set_label({:shape_log_collector, opts.stack_id})
    Logger.metadata(stack_id: opts.stack_id)
    Electric.Telemetry.Sentry.set_tags_context(stack_id: opts.stack_id)

    persistent_replication_data_opts = [
      stack_id: opts.stack_id,
      persistent_kv: opts.persistent_kv
    ]

    {:ok, tracker_state} =
      persistent_replication_data_opts
      |> PersistentReplicationState.get_tracked_relations()
      |> AffectedColumns.init()

    state =
      Map.merge(opts, %{
        producer: nil,
        subscriptions: {0, MapSet.new()},
        persistent_replication_data_opts: persistent_replication_data_opts,
        tracked_relations: tracker_state
      })

    # start in demand: :accumulate mode so that the ShapeCache is able to start
    # all active consumers before we start sending transactions
    {:producer, state,
     dispatcher: {Electric.Shapes.Dispatcher, inspector: state.inspector}, demand: :accumulate}
  end

  def handle_subscribe(:consumer, _opts, from, state) do
    {
      :automatic,
      Map.update!(state, :subscriptions, fn {count, set} ->
        {count + 1, MapSet.put(set, from)}
      end)
      |> log_subscription_status()
    }
  end

  # initial subscription before any transactions have been sent
  def handle_demand(_demand, %{producer: nil} = state) do
    {:noreply, [], state}
  end

  # The BroadcastDispatcher only sends demand when all the consumers have
  # demand, so if we are receiving demand then all consumers have processed the
  # last transaction and we can reply to the call and unblock the replication
  # client.
  def handle_demand(_demand, %{producer: producer} = state) do
    LsnTracker.set_last_processed_lsn(
      state.last_processed_lsn,
      state.stack_id
    )

    GenServer.reply(producer, :ok)

    {:noreply, [], %{state | producer: nil}}
  end

  def handle_cancel({:cancel, _}, from, state) do
    {:noreply, [], remove_subscription(from, state)}
  end

  def handle_cancel({:down, _reason}, from, state) do
    {:noreply, [], remove_subscription(from, state)}
  end

  def handle_call({:start_processing, lsn}, _from, state) do
    LsnTracker.init(lsn, state.stack_id)
    GenStage.demand(self(), :forward)
    {:reply, :ok, [], Map.put(state, :last_processed_lsn, lsn)}
  end

  def handle_call({:new_txn, %Transaction{xid: xid, lsn: lsn} = txn, trace_context}, from, state) do
    OpenTelemetry.set_current_context(trace_context)

    Logger.info("Received transaction #{xid} from Postgres at #{lsn}")
    Logger.debug(fn -> "Txn received in ShapeLogCollector: #{inspect(txn)}" end)

    OpenTelemetry.timed_fun("shape_log_collector.handle_transaction.duration_µs", fn ->
      handle_transaction(txn, from, state)
    end)
  end

  def handle_call({:relation_msg, %Relation{} = rel, trace_context}, from, state) do
    OpenTelemetry.set_current_context(trace_context)
    Logger.info("Received relation #{inspect(rel.schema)}.#{inspect(rel.table)}")
    Logger.debug(fn -> "Relation received in ShapeLogCollector: #{inspect(rel)}" end)

    handle_relation(rel, from, state)
  end

  # If no-one is listening to the replication stream, then just return without
  # emitting the transaction.
  # We could emit the transaction and let GenStage buffer it, but I don't think
  # this is necessary. We do definitely need to reply though, because without
  # any consumers we'll never get the demand message from the dispatcher that
  # will prompt the `GenServer.reply/2` call.
  defp handle_transaction(txn, _from, %{subscriptions: {0, _}} = state) do
    Logger.debug(fn -> "Dropping transaction #{txn.xid}: no active consumers" end)
    drop_transaction(state)
  end

  # If we've already processed a transaction, then drop it without processing
  defp handle_transaction(txn, _from, %{last_processed_lsn: last_processed_lsn} = state)
       when not Lsn.is_larger(txn.lsn, last_processed_lsn) do
    Logger.debug(fn ->
      "Dropping transaction #{txn.xid}: transaction LSN #{txn.lsn} smaller than last processed #{last_processed_lsn}"
    end)

    drop_transaction(state)
  end

  defp handle_transaction(txn, from, state) do
    OpenTelemetry.add_span_attributes("txn.is_dropped": false)

    pk_cols_of_relations =
      for relation <- txn.affected_relations, into: %{} do
        {:ok, info} = Inspector.load_column_info(relation, state.inspector)
        pk_cols = Inspector.get_pk_cols(info)
        {relation, pk_cols}
      end

    txn =
      Map.update!(txn, :changes, fn changes ->
        Enum.map(changes, &Changes.fill_key(&1, pk_cols_of_relations[&1.relation]))
      end)

    # we don't reply to this call. we only reply when we receive demand from
    # the consumers, signifying that every one has processed this txn
    {:noreply, [txn], %{state | producer: from} |> put_last_processed_lsn(txn.lsn)}
  end

  defp handle_relation(rel, from, state) do
    OpenTelemetry.add_span_attributes("rel.is_dropped": false)

    {updated_rel, tracker_state} =
      AffectedColumns.transform_relation(rel, state.tracked_relations)

    :ok =
      PersistentReplicationState.set_tracked_relations(
        tracker_state,
        state.persistent_replication_data_opts
      )

    case state do
      %{subscriptions: {0, _}} ->
        Logger.debug(fn ->
          "Dropping relation message for #{inspect(rel.schema)}.#{inspect(rel.table)}: no active consumers"
        end)

        {:reply, :ok, [], %{state | tracked_relations: tracker_state}}

      _ ->
        {:noreply, [updated_rel], %{state | producer: from, tracked_relations: tracker_state}}
    end
  end

  defp drop_transaction(state) do
    OpenTelemetry.add_span_attributes("txn.is_dropped": true)
    {:reply, :ok, [], state}
  end

  defp remove_subscription(from, %{subscriptions: {count, set}} = state) do
    subscriptions =
      if MapSet.member?(set, from) do
        {count - 1, MapSet.delete(set, from)}
      else
        Logger.error(
          "Received unsubscribe from unknown consumer: #{inspect(from)}; known: #{inspect(set)}"
        )

        {count, set}
      end

    log_subscription_status(%{state | subscriptions: subscriptions})
  end

  defp log_subscription_status(%{subscriptions: {active, _set}} = state) do
    Logger.debug(fn ->
      "#{active} consumers of replication stream"
    end)

    state
  end

  defp put_last_processed_lsn(%{last_processed_lsn: last_processed_lsn} = state, lsn)
       when Lsn.is_larger(lsn, last_processed_lsn),
       do: %{state | last_processed_lsn: lsn}

  defp put_last_processed_lsn(state, _lsn), do: state
end
