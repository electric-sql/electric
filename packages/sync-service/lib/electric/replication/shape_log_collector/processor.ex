defmodule Electric.Replication.ShapeLogCollector.Processor do
  @moduledoc """
  Module responsible for processing shape log operations.

  When any txn comes from postgres, we need to store it into the
  log for this shape if and only if it has txid >= xmin of the snapshot.
  """
  use GenServer

  alias Electric.Replication.ShapeLogCollector
  alias Electric.Postgres.ReplicationClient
  alias Electric.Replication.ShapeLogCollector.FlushTracker
  alias Electric.LsnTracker
  alias Electric.Replication.ShapeLogCollector.AffectedColumns
  alias Electric.Postgres.Lsn
  alias Electric.Replication.PersistentReplicationState
  alias Electric.Postgres.Inspector
  alias Electric.Replication.Changes
  alias Electric.Replication.Changes.{Relation, Transaction}
  alias Electric.Replication.TransactionBuilder
  alias Electric.Shapes.Consumer.Materializer
  alias Electric.Shapes.DependencyLayers
  alias Electric.Shapes.Filter
  alias Electric.Shapes.Partitions
  alias Electric.Telemetry.OpenTelemetry
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
    with {:ok, opts} <- NimbleOptions.validate(Map.new(opts), @schema) do
      stack_id = opts[:stack_id]

      GenServer.start_link(__MODULE__, opts,
        name: name(stack_id),
        spawn_opt: Electric.StackConfig.spawn_opts(stack_id, :shape_log_collector_processor)
      )
    end
  end

  def name(stack_id) do
    Electric.ProcessRegistry.name(stack_id, __MODULE__)
  end

  @spec mark_as_ready(Electric.stack_id()) :: any()
  def mark_as_ready(stack_id) do
    GenServer.call(name(stack_id), :mark_as_ready)
  end

  # use `GenServer.call/2` here to make the event processing synchronous.
  #
  # This `call/3` has a timeout of `:infinity` because timeouts are
  # handled at the storage layer, that is this function doesn't
  # assume any aggregate max time for the shape consumers to actually commit
  # the new txn to disk, instead the storage backend is responsible for
  # determining how long a write should reasonably take and if that fails
  # it should raise.

  def handle_operations(operations, stack_id) when is_list(operations) do
    trace_context = OpenTelemetry.get_current_context()
    GenServer.call(name(stack_id), {:handle_operations, operations, trace_context}, :infinity)
  end

  def handle_shape_registration_updates(stack_id, shapes_to_add, shapes_to_remove) do
    pid = name(stack_id) |> GenServer.whereis()
    call_ref = make_ref()

    GenServer.cast(
      pid,
      {:handle_shape_registration_updates, call_ref, shapes_to_add, shapes_to_remove}
    )

    call_ref
  end

  @spec notify_flushed(Electric.stack_id(), Electric.shape_handle(), LogOffset.t()) :: :ok
  def notify_flushed(stack_id, shape_handle, offset) do
    GenServer.cast(name(stack_id), {:writer_flushed, shape_handle, offset})
  end

  @spec active_shapes(Electric.stack_id()) :: MapSet.t(Electric.shape_handle())
  def active_shapes(stack_id) do
    GenServer.call(name(stack_id), :active_shapes)
  end

  @doc """
  Set process flags on the given ShapeLogCollector process.

  Accepts a list of flags to set, see `Process.flag/2` for valid settings.

  Doesn't crash if given an invalid flag or value - instead returns the list of
  invalid flags.

      iex> ShapeLogCollector.set_process_flags("my-stack-id", min_heap_size: 1024 * 1024, min_bin_vheap_size: 1024 * 1024)
      {:ok, settings: [min_heap_size: 1024 * 1024, min_bin_vheap_size: 1024 * 1024], invalid: []}
  """
  def set_process_flags(stack_id, flags) do
    GenServer.call(name(stack_id), {:set_process_flags, flags}, :infinity)
  end

  def get_process_flags(stack_id) do
    if pid = name(stack_id) |> GenServer.whereis() do
      {:garbage_collection, gc_flags} = :erlang.process_info(pid, :garbage_collection)
      {:priority, priority} = :erlang.process_info(pid, :priority)

      {:ok,
       [priority: priority] ++
         Keyword.take(gc_flags, [:min_bin_vheap_size, :min_heap_size, :fullsweep_after])}
    else
      :error
    end
  end

  def init(opts) do
    activate_mocked_functions_from_test_process()

    stack_id = opts.stack_id

    Process.set_label({:shape_log_collector_processor, stack_id})
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
        registry_state: registry_state,
        transaction_builder: TransactionBuilder.new()
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

  def handle_call(:mark_as_ready, _from, state) do
    lsn = LsnTracker.get_last_processed_lsn(state.stack_id)
    Electric.StatusMonitor.mark_shape_log_collector_ready(state.stack_id, self())
    {:reply, :ok, Map.put(state, :last_processed_lsn, lsn)}
  end

  def handle_call({:handle_operations, _, _}, _from, state)
      when not is_ready_to_process(state) do
    {:reply, {:error, :not_ready}, state}
  end

  def handle_call({:handle_operations, operations, trace_context}, _from, state) do
    OpenTelemetry.set_current_context(trace_context)

    {actions, state} = build_db_actions(operations, state)

    {response, state} = handle_actions(actions, state)

    {:reply, response, state}
  end

  def handle_call(:active_shapes, _from, state) do
    {:reply, Filter.active_shapes(state.filter), state}
  end

  def handle_call({:set_process_flags, flags}, _from, state) do
    {settings, invalid} =
      Enum.flat_map_reduce(flags, [], fn {flag, value}, invalid ->
        try do
          {[{flag, Process.flag(flag, value)}], invalid}
        rescue
          ArgumentError ->
            {[], [flag | invalid]}
        end
      end)

    {:reply, {:ok, [settings: settings, invalid: invalid]}, state}
  end

  def handle_cast(
        {:handle_shape_registration_updates, call_ref, shapes_to_add, shapes_to_remove},
        state
      ) do
    OpenTelemetry.with_span(
      "shape_log_collector.handle_shape_registration_updates",
      [],
      state.stack_id,
      fn ->
        {state, results} =
          shapes_to_remove
          |> Enum.reduce({state, %{}}, fn shape_handle, {state, results} ->
            OpenTelemetry.with_span(
              "shape_log_collector.unsubscribe",
              [shape_handle: shape_handle],
              state.stack_id,
              fn ->
                case remove_subscription(state, shape_handle) do
                  {:ok, state} -> {state, Map.put(results, shape_handle, :ok)}
                  {:error, reason} -> {state, Map.put(results, shape_handle, {:error, reason})}
                end
              end
            )
          end)

        {state, results} =
          shapes_to_add
          |> Enum.reduce({state, results}, fn {shape_handle, shape}, {state, results} ->
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
                            DependencyLayers.add_dependency(
                              state.dependency_layers,
                              shape,
                              shape_handle
                            )
                      }
                      |> Map.update!(:subscriptions, &(&1 + 1))
                      |> log_subscription_status()

                    {state, Map.put(results, shape_handle, :ok)}

                  {:error, :connection_not_available} ->
                    {state, Map.put(results, shape_handle, {:error, :connection_not_available})}
                end
              end
            )
          end)

        ShapeLogCollector.Registrator.handle_processor_update_response(
          state.stack_id,
          call_ref,
          results
        )

        {:noreply, state}
      end
    )
  end

  def handle_cast({:writer_flushed, shape_id, offset}, state) do
    {:noreply,
     state
     |> Map.update!(:flush_tracker, &FlushTracker.handle_flush_notification(&1, shape_id, offset))}
  end

  defp handle_actions([], state), do: {:ok, state}

  defp handle_actions([action | rest], state) do
    case handle_action(action, state) do
      {:ok, state} -> handle_actions(rest, state)
      {{:error, error}, state} -> {{:error, error}, state}
    end
  end

  defp handle_action(%Relation{} = rel, state) do
    OpenTelemetry.with_span(
      "pg_txn.replication_client.relation_received",
      ["rel.id": rel.id, "rel.schema": rel.schema, "rel.table": rel.table],
      state.stack_id,
      fn ->
        Logger.info("Received relation #{inspect(rel.schema)}.#{inspect(rel.table)}")
        Logger.debug(fn -> "Relation received in ShapeLogCollector: #{inspect(rel)}" end)

        result = handle_relation(state, rel)

        OpenTelemetry.wipe_interval_timer()

        result
      end
    )
  end

  defp handle_action(%Transaction{} = txn, state) do
    OpenTelemetry.with_span(
      "pg_txn.replication_client.transaction_received",
      [
        num_changes: txn.num_changes,
        num_relations: MapSet.size(txn.affected_relations),
        xid: txn.xid
      ],
      state.stack_id,
      fn ->
        OpenTelemetry.start_interval("shape_log_collector.logging")

        Logger.debug(
          fn ->
            "Received transaction #{txn.xid} (#{txn.num_changes} changes) from Postgres at #{txn.lsn}"
          end,
          received_transaction_xid: txn.xid,
          received_transaction_num_changes: txn.num_changes,
          received_transaction_lsn: txn.lsn
        )

        Logger.debug(fn -> "Txn received in ShapeLogCollector: #{inspect(txn)}" end)

        result = handle_transaction(state, txn)

        OpenTelemetry.stop_and_save_intervals(
          total_attribute: :"shape_log_collector.transaction.total_duration_µs"
        )

        result
      end
    )
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

    LsnTracker.set_last_processed_lsn(state.stack_id, state.last_processed_lsn)

    flush_tracker =
      if is_struct(event, Transaction) do
        FlushTracker.handle_transaction(state.flush_tracker, event, affected_shapes)
      else
        state.flush_tracker
      end

    %{state | flush_tracker: flush_tracker}
  end

  defp handle_relation(state, rel) do
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

  defp build_db_actions(operations, state) do
    {actions, builder} = TransactionBuilder.build(operations, state.transaction_builder)

    {actions, %{state | transaction_builder: builder}}
  end
end
