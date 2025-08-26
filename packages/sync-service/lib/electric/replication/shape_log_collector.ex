defmodule Electric.Replication.ShapeLogCollector do
  @moduledoc """
  When any txn comes from postgres, we need to store it into the
  log for this shape if and only if it has txid >= xmin of the snapshot.
  """
  use GenServer

  require Electric.Postgres.Lsn
  alias Electric.Postgres.ReplicationClient
  alias Electric.Replication.ShapeLogCollector.FlushTracker
  alias Electric.LsnTracker
  alias Electric.Replication.ShapeLogCollector.AffectedColumns
  alias Electric.Postgres.Lsn
  alias Electric.Replication.PersistentReplicationState
  alias Electric.Postgres.Inspector
  alias Electric.Publisher
  alias Electric.Replication.Changes
  alias Electric.Replication.Changes.{Relation, Transaction}
  alias Electric.Shapes.Consumer.Materializer
  alias Electric.Shapes.DependencyLayers
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
    timer =
      OpenTelemetry.extract_interval_timer()
      |> IntervalTimer.start_interval("shape_log_collector.transaction_message")

    trace_context = OpenTelemetry.get_current_context()

    timer = GenServer.call(server, {:new_txn, txn, trace_context, timer}, :infinity)

    OpenTelemetry.set_interval_timer(timer)

    :ok
  end

  def handle_relation_msg(%Changes.Relation{} = rel, server) do
    trace_context = OpenTelemetry.get_current_context()
    GenServer.call(server, {:relation_msg, rel, trace_context}, :infinity)
  end

  def subscribe(server, shape_handle, shape) do
    GenServer.call(server, {:subscribe, shape_handle, shape})
  end

  def notify_flushed(server, shape_handle, offset) do
    GenServer.cast(server, {:writer_flushed, shape_handle, offset})
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
        dependency_layers: DependencyLayers.new(),
        pids_by_shape_handle: %{},
        filter:
          opts
          |> Map.put(:refs_fun, &Materializer.get_all_as_refs(&1, opts.stack_id))
          |> Keyword.new()
          |> Filter.new(),
        flush_tracker:
          FlushTracker.new(
            notify_fn: fn lsn ->
              case GenServer.whereis(ReplicationClient.name(opts.stack_id)) do
                nil -> :ok
                pid -> send(pid, {:flush_boundary_updated, lsn})
              end
            end
          )
      })

    {:ok, state}
  end

  def handle_info({{:unsubscribe, shape_handle}, ref, :process, pid, _reason}, state) do
    OpenTelemetry.with_span("shape_log_collector.unsubscribe", [], state.stack_id, fn ->
      {:noreply,
       state
       |> remove_subscription({pid, ref}, shape_handle)
       |> Map.update!(:flush_tracker, &FlushTracker.handle_shape_removed(&1, pid))}
    end)
  end

  def handle_call({:subscribe, shape_handle, shape}, {pid, _ref}, state) do
    OpenTelemetry.with_span("shape_log_collector.subscribe", [], state.stack_id, fn ->
      ref = Process.monitor(pid, tag: {:unsubscribe, shape_handle})
      from = {pid, ref}

      state =
        %{
          state
          | partitions: Partitions.add_shape(state.partitions, shape_handle, shape),
            filter: Filter.add_shape(state.filter, shape_handle, shape),
            pids_by_shape_handle: Map.put(state.pids_by_shape_handle, shape_handle, pid),
            dependency_layers:
              DependencyLayers.add_dependency(state.dependency_layers, shape, shape_handle)
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
    OpenTelemetry.set_interval_timer(timer)

    OpenTelemetry.start_interval("shape_log_collector.set_current_context")
    OpenTelemetry.set_current_context(trace_context)

    OpenTelemetry.start_interval("shape_log_collector.logging")

    Logger.debug(
      fn ->
        "Received transaction #{xid} (#{txn.num_changes} changes) from Postgres at #{lsn}"
      end,
      received_transaction_xid: xid,
      received_transaction_num_changes: txn.num_changes,
      received_transaction_lsn: lsn
    )

    Logger.debug(fn -> "Txn received in ShapeLogCollector: #{inspect(txn)}" end)

    state = handle_transaction(state, txn)

    OpenTelemetry.start_interval("shape_log_collector.transaction_message_response")

    {:reply, OpenTelemetry.extract_interval_timer(), state}
  end

  def handle_call({:relation_msg, %Relation{} = rel, trace_context}, from, state) do
    OpenTelemetry.set_current_context(trace_context)
    Logger.info("Received relation #{inspect(rel.schema)}.#{inspect(rel.table)}")
    Logger.debug(fn -> "Relation received in ShapeLogCollector: #{inspect(rel)}" end)

    {:reply, :ok, handle_relation(rel, from, state)}
  end

  def handle_cast({:writer_flushed, shape_id, offset}, state) do
    {:noreply,
     state
     |> Map.update!(:flush_tracker, &FlushTracker.handle_flush_notification(&1, shape_id, offset))}
  end

  # If no-one is listening to the replication stream, then just return without
  # emitting the transaction.
  defp handle_transaction(%{subscriptions: {0, _}} = state, txn) do
    Logger.debug(fn -> "Dropping transaction #{txn.xid}: no active consumers" end)
    OpenTelemetry.add_span_attributes("txn.is_dropped": true)
    %{state | flush_tracker: FlushTracker.handle_transaction(state.flush_tracker, txn, [])}
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

    OpenTelemetry.start_interval("shape_log_collector.handle_transaction")

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
    OpenTelemetry.start_interval("partitions.handle_event")
    {partitions, event} = Partitions.handle_event(state.partitions, event)

    OpenTelemetry.start_interval("shape_log_collector.affected_shapes")

    affected_shapes = Filter.affected_shapes(state.filter, event)

    affected_shape_count = MapSet.size(affected_shapes)

    OpenTelemetry.add_span_attributes(
      "shape_log_collector.affected_shape_count": affected_shape_count
    )

    OpenTelemetry.start_interval("shape_log_collector.publish")
    context = OpenTelemetry.get_current_context()

    for layer <- DependencyLayers.get_for_handles(state.dependency_layers, affected_shapes) do
      # Each publish is synchronous, so layers will be processed in order
      layer
      |> Enum.map(&Map.fetch!(state.pids_by_shape_handle, &1))
      |> Publisher.publish({:handle_event, event, context})
    end

    OpenTelemetry.start_interval("shape_log_collector.set_last_processed_lsn")

    LsnTracker.set_last_processed_lsn(
      state.last_processed_lsn,
      state.stack_id
    )

    flush_tracker =
      if is_struct(event, Transaction) do
        FlushTracker.handle_transaction(state.flush_tracker, event, affected_shapes)
      else
        state.flush_tracker
      end

    %{
      state
      | partitions: partitions,
        flush_tracker: flush_tracker
    }
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

  defp remove_subscription(%{subscriptions: {count, set}} = state, from, shape_handle) do
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
        filter: Filter.remove_shape(state.filter, shape_handle),
        partitions: Partitions.remove_shape(state.partitions, shape_handle),
        pids_by_shape_handle: Map.delete(state.pids_by_shape_handle, shape_handle),
        dependency_layers:
          DependencyLayers.remove_dependency(state.dependency_layers, shape_handle)
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
