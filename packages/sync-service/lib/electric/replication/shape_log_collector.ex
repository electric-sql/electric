defmodule Electric.Replication.ShapeLogCollector do
  @moduledoc """
  When any txn comes from postgres, we need to store it into the
  log for this shape if and only if it has txid >= xmin of the snapshot.
  """
  use GenServer

  alias Electric.Postgres.ReplicationClient
  alias Electric.Replication.ShapeLogCollector.FlushTracker
  alias Electric.LsnTracker
  alias Electric.Replication.ShapeLogCollector.AffectedColumns
  alias Electric.Postgres.Lsn
  alias Electric.Replication.PersistentReplicationState
  alias Electric.Postgres.Inspector
  alias Electric.Replication.Changes
  alias Electric.Replication.Changes.{Relation, Transaction}
  alias Electric.Shapes.Consumer.Materializer
  alias Electric.Shapes.DependencyLayers
  alias Electric.Shapes.Filter
  alias Electric.Shapes.Partitions
  alias Electric.Telemetry.OpenTelemetry
  alias Electric.Telemetry.IntervalTimer
  alias Electric.Shapes.ConsumerRegistry

  import Electric.Utils, only: [map_while_ok: 2, map_if_ok: 2]

  require Electric.Postgres.Lsn
  require Logger

  @schema NimbleOptions.new!(
            stack_id: [type: :string, required: true],
            inspector: [type: :mod_arg, required: true],
            persistent_kv: [type: :any, required: true],
            consumer_registry_opts: [type: :any]
          )

  defguardp is_ready_to_process(state)
            when is_map_key(state, :last_processed_lsn) and not is_nil(state.last_processed_lsn)

  def start_link(opts) do
    with {:ok, opts} <- NimbleOptions.validate(opts, @schema) do
      GenServer.start_link(__MODULE__, Map.new(opts), name: name(opts[:stack_id]))
    end
  end

  def name(stack_id) do
    Electric.ProcessRegistry.name(stack_id, __MODULE__)
  end

  def set_last_processed_lsn(server_ref, last_processed_lsn) do
    GenServer.call(server(server_ref), {:set_last_processed_lsn, last_processed_lsn})
  end

  # use `GenServer.call/2` here to make the event processing synchronous.
  #
  # This `call/3` has a timeout of `:infinity` because timeouts are
  # handled at the storage layer, that is this function doesn't
  # assume any aggregate max time for the shape consumers to actually commit
  # the new txn to disk, instead the storage backend is responsible for
  # determining how long a write should reasonably take and if that fails
  # it should raise.
  def store_transaction(%Transaction{} = txn, server) do
    timer =
      OpenTelemetry.extract_interval_timer()
      |> IntervalTimer.start_interval("shape_log_collector.transaction_message")

    trace_context = OpenTelemetry.get_current_context()

    {response, timer} = GenServer.call(server, {:new_txn, txn, trace_context, timer}, :infinity)

    OpenTelemetry.set_interval_timer(timer)

    response
  end

  def handle_relation_msg(%Changes.Relation{} = rel, server) do
    trace_context = OpenTelemetry.get_current_context()
    :ok = GenServer.call(server, {:relation_msg, rel, trace_context}, :infinity)
  end

  # shapes that are being restored are already in the filters
  # because they were restored from the ets at startup
  def subscribe(_server_ref, _shape_handle, _shape, :restore) do
    :ok
  end

  # new shapes -- created after boot -- do need to be added
  def subscribe(server_ref, shape_handle, shape, :create) do
    GenServer.call(server(server_ref), {:subscribe, shape_handle, shape})
  end

  def remove_shape(server_ref, shape_handle) do
    # This has to be async otherwise the system will deadlock -
    # - a consumer being cleanly shutdown may be waiting for a response from ShapeLogCollector
    #   while ShapeLogCollector is waiting for an ack from a transaction event, or
    # - a consumer that has crashed will be waiting in a terminate callback
    #   for a reply from the unsubscribe while the ShapeLogCollector is again
    #   waiting for a txn ack.
    GenServer.cast(server(server_ref), {:remove_shape, shape_handle})
  end

  def notify_flushed(server_ref, shape_handle, offset) do
    GenServer.cast(server(server_ref), {:writer_flushed, shape_handle, offset})
  end

  def active_shapes(server_ref) do
    GenServer.call(server(server_ref), :active_shapes)
  end

  def init(opts) do
    activate_mocked_functions_from_test_process()

    stack_id = opts.stack_id

    Process.set_label({:shape_log_collector, stack_id})
    Logger.metadata(stack_id: stack_id)
    Electric.Telemetry.Sentry.set_tags_context(stack_id: stack_id)

    persistent_replication_data_opts = [
      stack_id: stack_id,
      persistent_kv: opts.persistent_kv
    ]

    {:ok, tracker_state} =
      persistent_replication_data_opts
      |> PersistentReplicationState.get_tracked_relations()
      |> AffectedColumns.init()

    {:ok, registry_state} =
      ConsumerRegistry.new(stack_id, Map.get(opts, :consumer_registry_opts, []))

    state =
      Map.merge(opts, %{
        subscriptions: 0,
        persistent_replication_data_opts: persistent_replication_data_opts,
        tracked_relations: tracker_state,
        partitions: Partitions.new(Keyword.new(opts)),
        dependency_layers: DependencyLayers.new(),
        pids_by_shape_handle: %{},
        filter:
          opts
          |> Map.put(:refs_fun, &Materializer.get_all_as_refs(&1, stack_id))
          |> Keyword.new()
          |> Filter.new(),
        flush_tracker:
          FlushTracker.new(
            notify_fn: fn lsn ->
              case GenServer.whereis(ReplicationClient.name(stack_id)) do
                nil -> :ok
                pid -> send(pid, {:flush_boundary_updated, lsn})
              end
            end
          ),
        registry_state: registry_state
      })

    {:ok, state, {:continue, :restore_shapes}}
  end

  def handle_continue(:restore_shapes, state) do
    OpenTelemetry.with_span(
      "shape_log_collector.restore_shapes",
      [],
      state.stack_id,
      fn ->
        {partitions, filter, layers, count} =
          state.stack_id
          |> Electric.ShapeCache.ShapeStatus.list_shapes()
          |> Enum.reduce(
            {state.partitions, state.filter, state.dependency_layers, 0},
            fn {shape_handle, shape}, {partitions, filter, layers, count} ->
              {:ok, partitions} = Partitions.add_shape(partitions, shape_handle, shape)

              {
                partitions,
                Filter.add_shape(filter, shape_handle, shape),
                DependencyLayers.add_dependency(layers, shape, shape_handle),
                count + 1
              }
            end
          )

        Logger.info("Restored filters for #{count} shapes")

        {:noreply,
         %{
           state
           | partitions: partitions,
             filter: filter,
             dependency_layers: layers,
             subscriptions: count
         }}
      end
    )
  end

  def handle_call({:subscribe, shape_handle, shape}, _from, state) do
    OpenTelemetry.with_span(
      "shape_log_collector.subscribe",
      [shape_handle: shape_handle],
      state.stack_id,
      fn ->
        case Partitions.add_shape(state.partitions, shape_handle, shape) do
          {:ok, partitions} ->
            state =
              %{
                state
                | partitions: partitions,
                  filter: Filter.add_shape(state.filter, shape_handle, shape),
                  dependency_layers:
                    DependencyLayers.add_dependency(state.dependency_layers, shape, shape_handle)
              }
              |> Map.update!(:subscriptions, &(&1 + 1))
              |> log_subscription_status()

            {:reply, :ok, state}

          {:error, :connection_not_available} ->
            {:reply, {:error, :connection_not_available}, state}
        end
      end
    )
  end

  def handle_call({:set_last_processed_lsn, lsn}, _from, state) do
    LsnTracker.set_last_processed_lsn(lsn, state.stack_id)
    Electric.StatusMonitor.mark_shape_log_collector_ready(state.stack_id, self())
    {:reply, :ok, Map.put(state, :last_processed_lsn, lsn)}
  end

  def handle_call({:new_txn, _, _, timer}, _from, state) when not is_ready_to_process(state) do
    {:reply, {{:error, :not_ready}, timer}, state}
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

    {response, state} = handle_transaction(state, txn)

    OpenTelemetry.start_interval("shape_log_collector.transaction_message_response")

    {:reply, {response, OpenTelemetry.extract_interval_timer()}, state}
  end

  def handle_call({:relation_msg, _, _}, _from, state) when not is_ready_to_process(state) do
    {:reply, {:error, :not_ready}, state}
  end

  def handle_call({:relation_msg, %Relation{} = rel, trace_context}, from, state) do
    OpenTelemetry.set_current_context(trace_context)
    Logger.info("Received relation #{inspect(rel.schema)}.#{inspect(rel.table)}")
    Logger.debug(fn -> "Relation received in ShapeLogCollector: #{inspect(rel)}" end)

    {response, state} = handle_relation(rel, from, state)
    {:reply, response, state}
  end

  def handle_call(:active_shapes, _from, state) do
    {:reply, Filter.active_shapes(state.filter), state}
  end

  def handle_cast({:writer_flushed, shape_id, offset}, state) do
    {:noreply,
     state
     |> Map.update!(:flush_tracker, &FlushTracker.handle_flush_notification(&1, shape_id, offset))}
  end

  def handle_cast({:remove_shape, shape_handle}, state) do
    state =
      case remove_subscription(state, shape_handle) do
        {:ok, state} -> state
        {:error, _} -> state
      end

    {:noreply, state}
  end

  # If no-one is listening to the replication stream, then just return without
  # emitting the transaction.
  defp handle_transaction(%{subscriptions: 0} = state, txn) do
    Logger.debug(fn -> "Dropping transaction #{txn.xid}: no active consumers" end)
    OpenTelemetry.add_span_attributes("txn.is_dropped": true)
    {:ok, %{state | flush_tracker: FlushTracker.handle_transaction(state.flush_tracker, txn, [])}}
  end

  # If we've already processed a transaction, then drop it without processing
  defp handle_transaction(%{last_processed_lsn: last_processed_lsn} = state, txn)
       when not Lsn.is_larger(txn.lsn, last_processed_lsn) do
    Logger.debug(fn ->
      "Dropping transaction #{txn.xid}: transaction LSN #{txn.lsn} smaller than last processed #{last_processed_lsn}"
    end)

    OpenTelemetry.add_span_attributes("txn.is_dropped": true)
    {:ok, %{state | flush_tracker: FlushTracker.handle_transaction(state.flush_tracker, txn, [])}}
  end

  defp handle_transaction(state, txn) do
    OpenTelemetry.add_span_attributes("txn.is_dropped": false)

    OpenTelemetry.start_interval("shape_log_collector.fill_keys_in_txn")

    case fill_keys_in_txn(txn, state) do
      {:ok, txn} ->
        OpenTelemetry.start_interval("partitions.handle_transaction")
        {partitions, txn} = Partitions.handle_transaction(state.partitions, txn)

        state =
          state
          |> Map.put(:partitions, partitions)
          |> put_last_processed_lsn(txn.lsn)
          |> publish(txn)

        {:ok, state}

      {:error, :connection_not_available} ->
        {{:error, :connection_not_available}, state}
    end
  end

  defp publish(state, event) do
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
      ConsumerRegistry.publish(layer, {:handle_event, event, context}, state.registry_state)
    end

    OpenTelemetry.start_interval("shape_log_collector.set_last_processed_lsn")

    LsnTracker.set_last_processed_lsn(state.last_processed_lsn, state.stack_id)

    flush_tracker =
      if is_struct(event, Transaction) do
        FlushTracker.handle_transaction(state.flush_tracker, event, affected_shapes)
      else
        state.flush_tracker
      end

    %{state | flush_tracker: flush_tracker}
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
      %{subscriptions: 0} ->
        Logger.debug(fn ->
          "Dropping relation message for #{inspect(rel.schema)}.#{inspect(rel.table)}: no active consumers"
        end)

        {:ok, %{state | tracked_relations: tracker_state}}

      _ ->
        case Partitions.handle_relation(state.partitions, updated_rel) do
          {:ok, partitions} ->
            # relation changes will also start consumers if they're not running
            state =
              publish(
                %{state | tracked_relations: tracker_state, partitions: partitions},
                updated_rel
              )

            {:ok, state}

          {:error, :connection_not_available} ->
            {{:error, :connection_not_available}, state}
        end
    end
  end

  defp remove_subscription(%{subscriptions: count} = state, shape_handle) do
    OpenTelemetry.with_span(
      "shape_log_collector.remove_shape",
      [shape_handle: shape_handle],
      state.stack_id,
      fn ->
        if Filter.has_shape?(state.filter, shape_handle) do
          Logger.debug("Deleting shape #{shape_handle}")

          OpenTelemetry.start_interval("unsubscribe_shape.remove_subscription")

          OpenTelemetry.start_interval("unsubscribe_shape.remove_from_filter")
          filter = Filter.remove_shape(state.filter, shape_handle)

          OpenTelemetry.start_interval("unsubscribe_shape.remove_from_partitions")
          partitions = Partitions.remove_shape(state.partitions, shape_handle)

          OpenTelemetry.start_interval("unsubscribe_shape.remove_pids_by_shape_handle")
          pids_by_shape_handle = Map.delete(state.pids_by_shape_handle, shape_handle)

          OpenTelemetry.start_interval("unsubscribe_shape.remove_from_flush_tracker")
          flush_tracker = FlushTracker.handle_shape_removed(state.flush_tracker, shape_handle)

          OpenTelemetry.start_interval("unsubscribe_shape.remove_from_dependency_layers")

          dependency_layers =
            DependencyLayers.remove_dependency(state.dependency_layers, shape_handle)

          Electric.Shapes.ConsumerRegistry.remove_consumer(shape_handle, state.registry_state)

          OpenTelemetry.stop_and_save_intervals(
            total_attribute: "unsubscribe_shape.total_duration_µs"
          )

          {:ok,
           %{
             state
             | subscriptions: count - 1,
               filter: filter,
               partitions: partitions,
               pids_by_shape_handle: pids_by_shape_handle,
               dependency_layers: dependency_layers,
               flush_tracker: flush_tracker
           }
           |> log_subscription_status()}
        else
          # This may happen as we attempt to remove a shape multiple times
          # depending on the source of the delete, on the understanding that
          # removal is idempotent.
          {:error, "shape #{shape_handle} not registered"}
        end
      end
    )
  end

  defp log_subscription_status(%{subscriptions: active} = state) do
    Logger.debug(fn ->
      "#{active} consumers of replication stream"
    end)

    state
  end

  defp put_last_processed_lsn(%{last_processed_lsn: last_processed_lsn} = state, lsn)
       when Lsn.is_larger(lsn, last_processed_lsn),
       do: %{state | last_processed_lsn: lsn}

  defp put_last_processed_lsn(state, _lsn), do: state

  defp server(stack_id) when is_binary(stack_id), do: name(stack_id)
  defp server({:via, _, _} = name), do: name
  defp server(pid) when is_pid(pid), do: pid

  if Mix.env() == :test do
    def activate_mocked_functions_from_test_process do
      Support.TestUtils.activate_mocked_functions_for_module(__MODULE__)
    end
  else
    def activate_mocked_functions_from_test_process, do: :noop
  end

  defp fill_keys_in_txn(txn, state) do
    with {:ok, pk_cols_of_relations} <- pk_cols_of_relations(txn, state) do
      txn =
        Map.update!(txn, :changes, fn changes ->
          Enum.map(changes, &Changes.fill_key(&1, pk_cols_of_relations[&1.relation]))
        end)

      {:ok, txn}
    end
  end

  defp pk_cols_of_relations(txn, state) do
    txn.affected_relations
    |> map_while_ok(fn relation ->
      with {:ok, pk_cols} <- pk_cols_of_relation(relation, state) do
        {:ok, {relation, pk_cols}}
      end
    end)
    |> map_if_ok(&Map.new/1)
  end

  defp pk_cols_of_relation(relation, state) do
    with {:ok, {oid, _}} <- Inspector.load_relation_oid(relation, state.inspector),
         {:ok, info} <- Inspector.load_column_info(oid, state.inspector) do
      {:ok, Inspector.get_pk_cols(info)}
    end
  end
end
