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
    # Allow 60s for this call as it may need to wait for thousands of restored shapes
    # to subscribe before it returns.
    GenServer.call(server, {:set_last_processed_lsn, last_processed_lsn}, 60_000)
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
    trace_context = OpenTelemetry.get_current_context()
    call_time = :erlang.monotonic_time(:microsecond)
    GenServer.call(server, {:new_txn, txn, trace_context, call_time}, :infinity)
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
        filter: Filter.new(Keyword.new(opts))
      })

    {:ok, state}
  end

  def handle_info({:unsubscribe, ref, :process, pid, _reason}, state) do
    {:noreply, remove_subscription({pid, ref}, state)}
  end

  def handle_call({:subscribe, shape}, {pid, _ref}, state) do
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
  end

  def handle_call({:set_last_processed_lsn, lsn}, _from, state) do
    LsnTracker.init(lsn, state.stack_id)
    Electric.StatusMonitor.mark_shape_log_collector_ready(state.stack_id, self())
    {:reply, :ok, Map.put(state, :last_processed_lsn, lsn)}
  end

  def handle_call(
        {:new_txn, %Transaction{xid: xid, lsn: lsn} = txn, trace_context, call_time},
        from,
        state
      ) do
    receive_time = :erlang.monotonic_time(:microsecond) - call_time

    OpenTelemetry.set_current_context(trace_context)

    OpenTelemetry.add_span_attributes(
      "shape_log_collector.transaction_message.duration_µs": receive_time
    )

    Logger.info(
      "Received transaction #{xid} (#{txn.num_changes} changes) from Postgres at #{lsn}",
      received_transaction_xid: xid,
      received_transaction_num_changes: txn.num_changes,
      received_transaction_lsn: lsn
    )

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

  defp handle_transaction(txn, _from, state) do
    OpenTelemetry.add_span_attributes("txn.is_dropped": false)

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

    state =
      state
      |> put_last_processed_lsn(txn.lsn)
      |> publish(txn)

    {:reply, :ok, state}
  end

  defp publish(state, event) do
    {partitions, event} =
      OpenTelemetry.timed_fun("partitions.handle_event.duration_µs", fn ->
        Partitions.handle_event(state.partitions, event)
      end)

    OpenTelemetry.timed_fun("dispatcher.dispatch.duration_µs", fn ->
      context = OpenTelemetry.get_current_context()

      state.filter
      |> Filter.affected_shapes(event)
      |> Publisher.publish({:handle_event, event, context})
    end)

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

        {:reply, :ok, %{state | tracked_relations: tracker_state}}

      _ ->
        {:reply, :ok, %{state | tracked_relations: tracker_state} |> publish(updated_rel)}
    end
  end

  defp drop_transaction(state) do
    OpenTelemetry.add_span_attributes("txn.is_dropped": true)
    {:reply, :ok, state}
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
end
