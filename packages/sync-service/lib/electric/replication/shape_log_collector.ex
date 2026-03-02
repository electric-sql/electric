defmodule Electric.Replication.ShapeLogCollector do
  @moduledoc """
  The ShapeLogCollector is responsible for collecting and processing
  shape log operations and managing shape registrations.

  It consists of two main components: the processor and the RequestBatcher.

  The processor handles the processing of shape log operations
  and manages the shape matching index updates. When any txn comes from postgres,
  we need to store it into the log for this shape if and only if it has
  txid >= xmin of the snapshot.

  The RequestBatcher batches the registration and deregistration of shapes
  to avoid overwhelming the processor with frequent updates.
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
  alias Electric.Replication.Changes.Relation
  alias Electric.Replication.Changes.TransactionFragment
  alias Electric.Replication.LogOffset
  alias Electric.Shapes.Consumer.Materializer
  alias Electric.Shapes.DependencyLayers
  alias Electric.Shapes.EventRouter
  alias Electric.Shapes.Partitions
  alias Electric.Telemetry.OpenTelemetry
  alias Electric.Shapes.ConsumerRegistry

  import Electric.Utils, only: [map_while_ok: 2, map_if_ok: 2]

  require Electric.Postgres.Lsn
  require Electric.Replication.LogOffset
  require Logger
  require TransactionFragment

  @schema NimbleOptions.new!(
            stack_id: [type: :string, required: true],
            inspector: [type: :mod_arg, required: true],
            persistent_kv: [type: :any, required: true],
            consumer_registry_opts: [type: :any]
          )

  defguardp is_ready_to_process(state)
            when is_map_key(state, :last_processed_offset) and
                   not is_nil(state.last_processed_offset)

  def start_link(opts) do
    with {:ok, opts} <- NimbleOptions.validate(Map.new(opts), @schema) do
      stack_id = opts[:stack_id]

      GenServer.start_link(__MODULE__, opts,
        name: name(stack_id),
        spawn_opt: Electric.StackConfig.spawn_opts(stack_id, :shape_log_collector)
      )
    end
  end

  def name(stack_id) do
    Electric.ProcessRegistry.name(stack_id, __MODULE__)
  end

  @doc """
  Marks the collector as ready to process operations from
  the replication stream.

  This is typically called after the initial shape registrations
  have been processed.
  """
  @spec mark_as_ready(Electric.stack_id()) :: :ok
  def mark_as_ready(stack_id) do
    # use an infinite timeout because the call can come in while the filters are building
    # the time taken to build the filters depends on the number of shapes so there is no
    # known upper bound for this after which we can say "this is taking too long"
    GenServer.call(name(stack_id), :mark_as_ready, :infinity)
  end

  @doc """
  Handles a replication log events.

  Should be called with operations received from the replication stream.

  Uuse `GenServer.call/2` here to make the event processing synchronous.

  This `call/3` has a timeout of `:infinity` because timeouts are
  handled at the storage layer, that is this function doesn't
  assume any aggregate max time for the shape consumers to actually commit
  the new txn to disk, instead the storage backend is responsible for
  determining how long a write should reasonably take and if that fails
  it should raise.
  """
  def handle_event(event, stack_id) do
    trace_context = OpenTelemetry.get_current_context()
    GenServer.call(name(stack_id), {:handle_event, event, trace_context}, :infinity)
  end

  @doc """
  Adds a shape to the shape matching index in the ShapeLogCollector
  used for matching and sending replication stream operations.
  """
  defdelegate add_shape(stack_id, shape_handle, shape, operation), to: __MODULE__.RequestBatcher

  @doc """
  Removes a shape from the shape matching index in the ShapeLogCollector.
  This call succeeds before the shape is actually removed from the index.
  """
  defdelegate remove_shape(stack_id, shape_handle), to: __MODULE__.RequestBatcher

  @doc """
  Handles batched shape registration updates from the RequestBatcher.
  """
  def handle_shape_registration_updates(stack_id, shapes_to_add, shapes_to_remove) do
    pid = name(stack_id) |> GenServer.whereis()
    call_ref = make_ref()

    GenServer.cast(
      pid,
      {:handle_shape_registration_updates, call_ref, shapes_to_add, shapes_to_remove}
    )

    call_ref
  end

  @doc """
  Notifies the ShapeLogCollector that a shape's data has been flushed
  up to a certain offset, used to mark the overall flush progress.

  Should be called by consumer processes after they flush data.
  """
  @spec notify_flushed(Electric.stack_id(), Electric.shape_handle(), LogOffset.t()) :: :ok
  def notify_flushed(stack_id, shape_handle, offset) do
    GenServer.cast(name(stack_id), {:writer_flushed, shape_handle, offset})
  end

  @doc """
  Returns the list of currently active shapes being tracked
  in the shape matching filters.
  """
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

  @doc """
  Utility for tests, monitors the SLC process.
  """
  def monitor(stack_id) do
    stack_id
    |> name()
    |> GenServer.whereis()
    |> Process.monitor()
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

    replication_client_name = ReplicationClient.name(stack_id)

    state =
      Map.merge(opts, %{
        subscriptions: 0,
        persistent_replication_data_opts: persistent_replication_data_opts,
        tracked_relations: tracker_state,
        partitions: Partitions.new(Keyword.new(opts)),
        dependency_layers: DependencyLayers.new(),
        pids_by_shape_handle: %{},
        event_router:
          opts
          |> Map.put(:refs_fun, &Materializer.get_all_as_refs(&1, stack_id))
          |> Keyword.new()
          |> EventRouter.new(),
        flush_tracker:
          FlushTracker.new(
            notify_fn: fn lsn ->
              case GenServer.whereis(replication_client_name) do
                nil -> :ok
                pid -> send(pid, {:flush_boundary_updated, lsn})
              end
            end
          ),
        lsn_tracker_ref: LsnTracker.stack_ref(stack_id),
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
        start = System.monotonic_time()

        {partitions, event_router, layers, count} =
          state.stack_id
          |> Electric.ShapeCache.ShapeStatus.list_shapes()
          |> Enum.reduce(
            {state.partitions, state.event_router, state.dependency_layers, 0},
            fn {shape_handle, shape}, {partitions, event_router, layers, count} ->
              # Check dependencies first - if a parent shape failed to restore,
              # we should skip this shape (and its children will also be skipped)
              case DependencyLayers.add_dependency(layers, shape, shape_handle) do
                {:ok, layers} ->
                  {:ok, partitions} = Partitions.add_shape(partitions, shape_handle, shape)

                  {
                    partitions,
                    EventRouter.add_shape(event_router, shape_handle, shape),
                    layers,
                    count + 1
                  }

                {:error, {:missing_dependencies, missing_deps}} ->
                  Logger.warning(
                    "Skipping shape #{shape_handle} during restore: missing dependencies #{inspect(MapSet.to_list(missing_deps))}"
                  )

                  {partitions, event_router, layers, count}
              end
            end
          )

        Logger.notice(
          "Restored filters for #{count} shapes in #{System.convert_time_unit(System.monotonic_time() - start, :native, :millisecond)}ms"
        )

        {:noreply,
         %{
           state
           | partitions: partitions,
             event_router: event_router,
             dependency_layers: layers,
             subscriptions: count
         }}
      end
    )
  end

  def handle_call(:mark_as_ready, _from, state) do
    lsn = LsnTracker.get_last_processed_lsn(state.lsn_tracker_ref)
    offset = LogOffset.new(Lsn.to_integer(lsn), :infinity)
    Electric.StatusMonitor.mark_shape_log_collector_ready(state.stack_id, self())
    {:reply, :ok, Map.put(state, :last_processed_offset, offset)}
  end

  def handle_call({:handle_event, _, _}, _from, state)
      when not is_ready_to_process(state) do
    {:reply, {:error, :not_ready}, state}
  end

  def handle_call({:handle_event, event, trace_context}, _from, state) do
    OpenTelemetry.set_current_context(trace_context)

    {response, state} = do_handle_event(event, state)

    {:reply, response, state}
  end

  def handle_call(:active_shapes, _from, state) do
    {:reply, EventRouter.active_shapes(state.event_router), state}
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

  def handle_cast({:writer_flushed, shape_id, offset}, state) do
    {:noreply,
     state
     |> Map.update!(:flush_tracker, &FlushTracker.handle_flush_notification(&1, shape_id, offset))}
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
                    case DependencyLayers.add_dependency(
                           state.dependency_layers,
                           shape,
                           shape_handle
                         ) do
                      {:ok, dependency_layers} ->
                        state =
                          %{
                            state
                            | partitions: partitions,
                              event_router:
                                EventRouter.add_shape(state.event_router, shape_handle, shape),
                              dependency_layers: dependency_layers
                          }
                          |> Map.update!(:subscriptions, &(&1 + 1))
                          |> log_subscription_status()

                        {state, Map.put(results, shape_handle, :ok)}

                      {:error, {:missing_dependencies, missing_deps}} ->
                        Logger.warning(
                          "Shape #{shape_handle} cannot be added: missing dependencies #{inspect(MapSet.to_list(missing_deps))}"
                        )

                        {state, Map.put(results, shape_handle, {:error, :missing_dependencies})}
                    end

                  {:error, :connection_not_available} ->
                    {state, Map.put(results, shape_handle, {:error, :connection_not_available})}
                end
              end
            )
          end)

        __MODULE__.RequestBatcher.handle_processor_update_response(
          state.stack_id,
          call_ref,
          results
        )

        {:noreply, state}
      end
    )
  end

  defp do_handle_event(%Relation{} = rel, state) do
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

  defp do_handle_event(%TransactionFragment{} = txn_fragment, state) do
    OpenTelemetry.with_span(
      "pg_txn.replication_client.transaction_received",
      [
        num_changes: txn_fragment.change_count,
        num_relations: MapSet.size(txn_fragment.affected_relations),
        xid: txn_fragment.xid,
        complete_transaction?: TransactionFragment.complete_transaction?(txn_fragment)
      ],
      state.stack_id,
      fn ->
        OpenTelemetry.start_interval(:"shape_log_collector.logging.duration_µs")

        Logger.debug(
          fn ->
            "Received transaction fragment #{txn_fragment.xid} (#{txn_fragment.change_count} changes) from Postgres at #{txn_fragment.lsn}"
          end,
          received_transaction_xid: txn_fragment.xid,
          received_transaction_num_changes: txn_fragment.change_count,
          received_transaction_lsn: to_string(txn_fragment.lsn)
        )

        Logger.debug(fn ->
          "Txn fragment received in ShapeLogCollector: #{inspect(txn_fragment)}"
        end)

        result = handle_txn_fragment(state, txn_fragment)

        OpenTelemetry.stop_and_save_intervals(
          total_attribute: :"shape_log_collector.transaction.total_duration_µs"
        )

        result
      end
    )
  end

  # If we've already processed a txn_fragment, then drop it without processing
  defp handle_txn_fragment(%{last_processed_offset: last_processed_offset} = state, txn_fragment)
       when LogOffset.is_log_offset_lte(txn_fragment.last_log_offset, last_processed_offset) do
    Logger.debug(fn ->
      "Dropping transaction fragment as last_log_offset #{txn_fragment.last_log_offset} not greater than last processed #{last_processed_offset}"
    end)

    OpenTelemetry.add_span_attributes("txn.is_dropped": true)

    {:ok,
     %{
       state
       | flush_tracker: FlushTracker.handle_txn_fragment(state.flush_tracker, txn_fragment, [])
     }}
  end

  defp handle_txn_fragment(
         %{last_processed_offset: last_processed_offset},
         %TransactionFragment{
           changes: [%{log_offset: first_log_offset} | _],
           last_log_offset: last_log_offset
         }
       )
       when LogOffset.is_log_offset_lte(first_log_offset, last_processed_offset) and
              LogOffset.is_log_offset_lt(last_processed_offset, last_log_offset) do
    raise """
    Received TransactionFragment that has already been partially processed.

    This scenario is not currently supported. It could occur if the
    batch size was changed while restarting the replication client.

    First log offset: #{inspect(first_log_offset)}
    last processed offset: #{inspect(last_processed_offset)}
    last log offset: #{inspect(last_log_offset)}
    """
  end

  defp handle_txn_fragment(state, txn_fragment) do
    OpenTelemetry.add_span_attributes("txn.is_dropped": false)

    OpenTelemetry.start_interval(:"shape_log_collector.fill_keys_in_txn.duration_µs")

    case fill_keys(txn_fragment, state) do
      {:ok, txn_fragment} ->
        OpenTelemetry.start_interval(:"partitions.handle_transaction.duration_µs")

        {partitions, txn_fragment} =
          Partitions.handle_txn_fragment(state.partitions, txn_fragment)

        state =
          state
          |> Map.put(:partitions, partitions)
          |> put_last_processed_offset(txn_fragment)
          |> publish(txn_fragment)

        {:ok, state}

      {:error, :connection_not_available} ->
        {{:error, :connection_not_available}, state}
    end
  end

  defp publish(state, event) do
    OpenTelemetry.start_interval(:"shape_log_collector.event_routing.duration_µs")

    {events_by_handle, event_router} =
      EventRouter.event_by_shape_handle(state.event_router, event)

    state = %{state | event_router: event_router}

    affected_shapes = Map.keys(events_by_handle) |> MapSet.new()
    affected_shape_count = MapSet.size(affected_shapes)

    OpenTelemetry.add_span_attributes(
      "shape_log_collector.affected_shape_count": affected_shape_count
    )

    OpenTelemetry.start_interval(:"shape_log_collector.publish.duration_µs")
    context = OpenTelemetry.get_current_context()

    for layer <- DependencyLayers.get_for_handles(state.dependency_layers, affected_shapes) do
      # Each publish is synchronous, so layers will be processed in order
      layer_events =
        Map.new(layer, fn handle ->
          {handle, {:handle_event, Map.fetch!(events_by_handle, handle), context}}
        end)

      ConsumerRegistry.publish(layer_events, state.registry_state)
    end

    OpenTelemetry.start_interval(:"shape_log_collector.set_last_processed_lsn.duration_µs")

    lsn = Lsn.from_integer(state.last_processed_offset.tx_offset)
    LsnTracker.set_last_processed_lsn(state.lsn_tracker_ref, lsn)

    flush_tracker =
      case event do
        %TransactionFragment{commit: commit} when not is_nil(commit) ->
          FlushTracker.handle_txn_fragment(state.flush_tracker, event, affected_shapes)

        _ ->
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
        if EventRouter.has_shape?(state.event_router, shape_handle) do
          Logger.debug("Deleting shape #{shape_handle}")

          OpenTelemetry.start_interval(:"unsubscribe_shape.remove_subscription.duration_µs")

          OpenTelemetry.start_interval(:"unsubscribe_shape.remove_from_event_router.duration_µs")
          event_router = EventRouter.remove_shape(state.event_router, shape_handle)

          OpenTelemetry.start_interval(:"unsubscribe_shape.remove_from_partitions.duration_µs")
          partitions = Partitions.remove_shape(state.partitions, shape_handle)

          OpenTelemetry.start_interval(
            :"unsubscribe_shape.remove_pids_by_shape_handle.duration_µs"
          )

          pids_by_shape_handle = Map.delete(state.pids_by_shape_handle, shape_handle)

          OpenTelemetry.start_interval(:"unsubscribe_shape.remove_from_flush_tracker.duration_µs")
          flush_tracker = FlushTracker.handle_shape_removed(state.flush_tracker, shape_handle)

          OpenTelemetry.start_interval(
            :"unsubscribe_shape.remove_from_dependency_layers.duration_µs"
          )

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
               event_router: event_router,
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

  defp put_last_processed_offset(state, %TransactionFragment{last_log_offset: last_log_offset}),
    do: %{state | last_processed_offset: last_log_offset}

  if Mix.env() == :test do
    def activate_mocked_functions_from_test_process do
      Support.TestUtils.activate_mocked_functions_for_module(__MODULE__)
    end
  else
    def activate_mocked_functions_from_test_process, do: :noop
  end

  defp fill_keys(batch, state) do
    with {:ok, pk_cols_of_relations} <- pk_cols_of_relations(batch, state) do
      batch =
        Map.update!(batch, :changes, fn changes ->
          Enum.map(
            changes,
            &Changes.fill_key(&1, pk_cols_of_relations[Map.get(&1, :relation)])
          )
        end)

      {:ok, batch}
    end
  end

  defp pk_cols_of_relations(batch, state) do
    batch.affected_relations
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
