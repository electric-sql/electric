defmodule Electric.Replication.ShapeLogCollector do
  @moduledoc """
  When any txn comes from postgres, we need to store it into the
  log for this shape if and only if it has txid >= xmin of the snapshot.
  """
  use GenServer

  require Electric.Postgres.Lsn
  alias Electric.LsnTracker
  alias Electric.Replication.ShapeLogCollector.AffectedColumns
  alias Electric.Postgres.Lsn
  alias Electric.Replication.PersistentReplicationState
  alias Electric.Postgres.Inspector
  alias Electric.Publisher
  alias Electric.Replication.Changes
  alias Electric.Replication.Changes.{Relation, Transaction}
  alias Electric.Shapes.Filter
  alias Electric.Shapes.Partitions
  alias Electric.Telemetry.OpenTelemetry
  alias Electric.Telemetry.IntervalTimer

  require Logger

  @schema NimbleOptions.new!(
            stack_id: [type: :string, required: true],
            inspector: [type: :mod_arg, required: true],
            persistent_kv: [type: :any, required: true]
          )

  def start_link(opts) do
    with {:ok, opts} <- NimbleOptions.validate(opts, @schema) do
      GenServer.start_link(__MODULE__, Map.new(opts), name: name(opts[:stack_id]))
    end
  end

  def name(stack_id) do
    Electric.ProcessRegistry.name(stack_id, __MODULE__)
  end

  def set_last_processed_lsn(server, last_processed_lsn) do
    GenServer.call(server, {:set_last_processed_lsn, last_processed_lsn})
  end

  # use `GenServer.call/2` here to make the event processing synchronous.
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
    timer = IntervalTimer.start_interval("shape_log_collector.transaction_message")

    trace_context = OpenTelemetry.get_current_context()

    timer = GenServer.call(server, {:new_txn, txn, trace_context, timer}, :infinity)

    durations = IntervalTimer.durations(timer)

    OpenTelemetry.add_span_attributes([
      {:"shape_log_collector.transaction.total_duration_µs", IntervalTimer.total_time(durations)}
      | for {interval_name, duration} <- durations do
          {:"#{interval_name}.duration_µs", duration}
        end
    ])

    :ok
  end

  def handle_relation_msg(%Changes.Relation{} = rel, server) do
    trace_context = OpenTelemetry.get_current_context()
    GenServer.call(server, {:relation_msg, rel, trace_context}, :infinity)
  end

  def subscribe(server, shape) do
    GenServer.call(server, {:subscribe, shape})
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
        subscriptions: {0, MapSet.new()},
        persistent_replication_data_opts: persistent_replication_data_opts,
        tracked_relations: tracker_state,
        partitions: Partitions.new(Keyword.new(opts)),
        filter: Filter.new(Keyword.new(opts)),
        timer: nil
      })

    {:ok, state}
  end

  def handle_info({:unsubscribe, ref, :process, pid, _reason}, state) do
    OpenTelemetry.with_span("shape_log_collector.unsubscribe", [], state.stack_id, fn ->
      {:noreply, remove_subscription({pid, ref}, state)}
    end)
  end

  def handle_call({:subscribe, shape}, {pid, _ref}, state) do
    OpenTelemetry.with_span("shape_log_collector.subscribe", [], state.stack_id, fn ->
      ref = Process.monitor(pid, tag: :unsubscribe)
      from = {pid, ref}

      state =
        %{
          state
          | partitions: Partitions.add_shape(state.partitions, from, shape),
            filter: Filter.add_shape(state.filter, pid, shape)
        }
        |> Map.update!(:subscriptions, fn {count, set} ->
          {count + 1, MapSet.put(set, from)}
        end)
        |> log_subscription_status()

      {:reply, :ok, state}
    end)
  end

  def handle_call({:set_last_processed_lsn, lsn}, _from, state) do
    LsnTracker.init(lsn, state.stack_id)
    Electric.StatusMonitor.mark_shape_log_collector_ready(state.stack_id, self())
    {:reply, :ok, Map.put(state, :last_processed_lsn, lsn)}
  end

  def handle_call(
        {:new_txn, %Transaction{xid: xid, lsn: lsn} = txn, trace_context, timer},
        _from,
        state
      ) do
    state = record_interval_start(%{state | timer: timer}, "shape_log_collector.logging")

    OpenTelemetry.set_current_context(trace_context)

    Logger.info(
      "Received transaction #{xid} (#{txn.num_changes} changes) from Postgres at #{lsn}",
      received_transaction_xid: xid,
      received_transaction_num_changes: txn.num_changes,
      received_transaction_lsn: lsn
    )

    Logger.debug(fn -> "Txn received in ShapeLogCollector: #{inspect(txn)}" end)

    state =
      state
      |> handle_transaction(txn)
      |> record_interval_start("shape_log_collector.transaction_message_response")

    {:reply, state.timer, %{state | timer: nil}}
  end

  def handle_call({:relation_msg, %Relation{} = rel, trace_context}, from, state) do
    OpenTelemetry.set_current_context(trace_context)
    Logger.info("Received relation #{inspect(rel.schema)}.#{inspect(rel.table)}")
    Logger.debug(fn -> "Relation received in ShapeLogCollector: #{inspect(rel)}" end)

    {:reply, :ok, handle_relation(rel, from, state)}
  end

  # If no-one is listening to the replication stream, then just return without
  # emitting the transaction.
  defp handle_transaction(%{subscriptions: {0, _}} = state, txn) do
    Logger.debug(fn -> "Dropping transaction #{txn.xid}: no active consumers" end)
    OpenTelemetry.add_span_attributes("txn.is_dropped": true)
    state
  end

  # If we've already processed a transaction, then drop it without processing
  defp handle_transaction(%{last_processed_lsn: last_processed_lsn} = state, txn)
       when not Lsn.is_larger(txn.lsn, last_processed_lsn) do
    Logger.debug(fn ->
      "Dropping transaction #{txn.xid}: transaction LSN #{txn.lsn} smaller than last processed #{last_processed_lsn}"
    end)

    OpenTelemetry.add_span_attributes("txn.is_dropped": true)
    state
  end

  defp handle_transaction(state, txn) do
    OpenTelemetry.add_span_attributes("txn.is_dropped": false)

    state = record_interval_start(state, "shape_log_collector.handle_transaction")

    pk_cols_of_relations =
      for relation <- txn.affected_relations, into: %{} do
        {:ok, {oid, _}} = Inspector.load_relation_oid(relation, state.inspector)
        {:ok, info} = Inspector.load_column_info(oid, state.inspector)
        pk_cols = Inspector.get_pk_cols(info)
        {relation, pk_cols}
      end

    txn =
      Map.update!(txn, :changes, fn changes ->
        Enum.map(changes, &Changes.fill_key(&1, pk_cols_of_relations[&1.relation]))
      end)

    state
    |> put_last_processed_lsn(txn.lsn)
    |> publish(txn)
  end

  defp publish(state, event) do
    state = record_interval_start(state, "partitions.handle_event")
    {partitions, event} = Partitions.handle_event(state.partitions, event)

    state = record_interval_start(state, "shape_log_collector.affected_shapes")
    affected_shapes = Filter.affected_shapes(state.filter, event)
    affected_shape_count = MapSet.size(affected_shapes)

    OpenTelemetry.add_span_attributes(
      "shape_log_collector.affected_shape_count": affected_shape_count
    )

    state = record_interval_start(state, "shape_log_collector.publish")
    context = OpenTelemetry.get_current_context()
    Publisher.publish(affected_shapes, {:handle_event, event, context})

    state = record_interval_start(state, "shape_log_collector.set_last_processed_lsn")

    LsnTracker.set_last_processed_lsn(
      state.last_processed_lsn,
      state.stack_id
    )

    %{state | partitions: partitions}
  end

  defp handle_relation(rel, _from, state) do
    OpenTelemetry.add_span_attributes("rel.is_dropped": false)

    {updated_rel, tracker_state} =
      AffectedColumns.transform_relation(rel, state.tracked_relations)

    # PG doesn't send all the details in the relation message (in particular, nullability), but
    # it will send a message even if the relation is unchanged. So if we see a relation message that's not
    # changed, it might be after a reconnection, or it might be because something actually changed.
    # In either case, we need to clean the inspector cache so we get the latest info.
    if rel == updated_rel do
      Inspector.clean(updated_rel.id, state.inspector)
    end

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

        %{state | tracked_relations: tracker_state}

      _ ->
        publish(%{state | tracked_relations: tracker_state}, updated_rel)
    end
  end

  defp remove_subscription({pid, _} = from, %{subscriptions: {count, set}} = state) do
    subscriptions =
      if MapSet.member?(set, from) do
        {count - 1, MapSet.delete(set, from)}
      else
        Logger.error(
          "Received unsubscribe from unknown consumer: #{inspect(from)}; known: #{inspect(set)}"
        )

        {count, set}
      end

    %{
      state
      | subscriptions: subscriptions,
        filter: Filter.remove_shape(state.filter, pid),
        partitions: Partitions.remove_shape(state.partitions, from)
    }
    |> log_subscription_status()
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

  # Don't record the interval if the timer has not been setup
  defp record_interval_start(%{timer: nil} = state, _interval_name), do: state

  defp record_interval_start(state, interval_name) do
    timer = IntervalTimer.start_interval(state.timer, interval_name)
    %{state | timer: timer}
  end
end
