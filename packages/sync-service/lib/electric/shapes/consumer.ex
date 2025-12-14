defmodule Electric.Shapes.Consumer do
  use GenServer, restart: :temporary

  alias Electric.Shapes.Consumer.MoveIns
  alias Electric.Shapes.Consumer.InitialSnapshot
  alias Electric.Shapes.Consumer.MoveHandling
  alias Electric.Shapes.Consumer.State

  import Electric.Shapes.Consumer.State, only: :macros
  require Electric.Replication.LogOffset

  alias Electric.Replication.LogOffset
  alias Electric.Shapes.Consumer.Materializer
  alias Electric.Shapes.ConsumerRegistry
  alias Electric.LogItems
  alias Electric.Postgres.Inspector
  alias Electric.Replication.Changes
  alias Electric.Replication.Changes.Transaction
  alias Electric.Replication.Changes.TransactionFragment
  alias Electric.Replication.ShapeLogCollector
  alias Electric.Replication.TransactionBuilder
  alias Electric.ShapeCache
  alias Electric.ShapeCache.ShapeCleaner
  alias Electric.Shapes
  alias Electric.Shapes.Shape
  alias Electric.SnapshotError
  alias Electric.Telemetry.OpenTelemetry
  alias Electric.Utils

  require Logger

  @default_snapshot_timeout 45_000
  @stop_and_clean_timeout 30_000
  @stop_and_clean_reason ShapeCleaner.consumer_cleanup_reason()

  def name(stack_id, shape_handle) when is_binary(shape_handle) do
    ConsumerRegistry.name(stack_id, shape_handle)
  end

  def register_for_changes(stack_id, shape_handle) do
    ref = make_ref()
    Registry.register(Electric.StackSupervisor.registry_name(stack_id), shape_handle, ref)
    ref
  end

  @spec await_snapshot_start(Electric.stack_id(), Electric.shape_handle(), timeout()) ::
          :started | {:error, any()}
  def await_snapshot_start(stack_id, shape_handle, timeout \\ @default_snapshot_timeout)
      when is_binary(stack_id) and is_binary(shape_handle) do
    stack_id
    |> consumer_pid(shape_handle)
    |> GenServer.call(:await_snapshot_start, timeout)
  end

  @spec subscribe_materializer(Electric.stack_id(), Electric.shape_handle(), pid()) :: :ok
  def subscribe_materializer(stack_id, shape_handle, pid) do
    stack_id
    |> consumer_pid(shape_handle)
    |> GenServer.call({:subscribe_materializer, pid})
  end

  @spec whereis(Electric.stack_id(), Electric.shape_handle()) :: pid() | nil
  def whereis(stack_id, shape_handle) do
    consumer_pid(stack_id, shape_handle)
  end

  def stop(nil, _reason) do
    :ok
  end

  def stop(pid, reason) when is_pid(pid) do
    if Process.alive?(pid) do
      GenServer.call(pid, {:stop, reason}, @stop_and_clean_timeout)
    else
      :ok
    end
  catch
    :exit, _reason -> :ok
  end

  def stop(stack_id, shape_handle, reason) do
    # if consumer is present, terminate it gracefully
    stack_id
    |> consumer_pid(shape_handle)
    |> stop(reason)
  end

  defp consumer_pid(stack_id, shape_handle) do
    ConsumerRegistry.whereis(stack_id, shape_handle)
  end

  def start_link(%{stack_id: stack_id, shape_handle: shape_handle} = config) do
    GenServer.start_link(__MODULE__, config, name: name(stack_id, shape_handle))
  end

  @impl GenServer
  def init(config) do
    activate_mocked_functions_from_test_process()

    %{stack_id: stack_id, shape_handle: shape_handle, otel_ctx: otel_ctx} = config

    Process.set_label({:consumer, shape_handle})
    Process.flag(:trap_exit, true)

    metadata = [shape_handle: shape_handle, stack_id: stack_id]
    Logger.metadata(metadata)
    Electric.Telemetry.Sentry.set_tags_context(metadata)

    {:ok, shape} = ShapeCache.ShapeStatus.fetch_shape_by_handle(stack_id, shape_handle)

    {:ok, State.new(stack_id, shape_handle, shape),
     {:continue, {:init_consumer, config.action, otel_ctx}}}
  end

  @impl GenServer
  def handle_continue({:init_consumer, action, otel_ctx}, state) do
    %{
      stack_id: stack_id,
      shape: shape,
      shape_handle: shape_handle
    } = state

    stack_storage = ShapeCache.Storage.for_stack(stack_id)
    storage = ShapeCache.Storage.for_shape(shape_handle, stack_storage)

    # TODO: Remove. Only needed for InMemoryStorage
    case ShapeCache.Storage.start_link(storage) do
      {:ok, _pid} -> :ok
      :ignore -> :ok
    end

    writer = ShapeCache.Storage.init_writer!(storage, shape)

    state = State.initialize(state, storage, writer)

    :ok =
      ShapeCache.ShapeStatus.initialise_shape(
        stack_id,
        shape_handle,
        state.latest_offset
      )

    if all_materializers_alive?(state) && subscribe(state, action) do
      Logger.debug("Writer for #{shape_handle} initialized")

      # We start the snapshotter even if there's a snapshot because it also performs the call
      # to PublicationManager.add_shape/3. We *could* do that call here and avoid spawning a
      # process if the shape already has a snapshot but the current semantics rely on being able
      # to wait for the snapshot asynchronously and if we called publication manager here it would
      # block and prevent await_snapshot_start calls from adding snapshot subscribers.

      {:ok, _pid} =
        Shapes.DynamicConsumerSupervisor.start_snapshotter(
          stack_id,
          %{
            stack_id: stack_id,
            shape: shape,
            shape_handle: shape_handle,
            storage: storage,
            otel_ctx: otel_ctx
          }
        )

      {:noreply, state}
    else
      stop_and_clean(state)
    end
  end

  def handle_continue(:stop_and_clean, state) do
    stop_and_clean(state)
  end

  def handle_continue(:consume_buffer, %State{buffer: buffer} = state) do
    Logger.debug(fn -> "Consumer catching up on #{length(buffer)} transactions" end)
    state = %{state | buffer: [], buffering?: false}

    case handle_txns(Enum.reverse(buffer), state) do
      %State{terminating?: true} = state ->
        {:noreply, state, {:continue, :stop_and_clean}}

      state ->
        {:noreply, state, state.hibernate_after}
    end
  end

  @impl GenServer
  def handle_call({:monitor, pid}, _from, %{monitors: monitors} = state) do
    ref = make_ref()
    {:reply, ref, %{state | monitors: [{pid, ref} | monitors]}, state.hibernate_after}
  end

  def handle_call(:await_snapshot_start, _from, state) when is_snapshot_started(state) do
    {:reply, :started, state, state.hibernate_after}
  end

  def handle_call(:await_snapshot_start, from, state) do
    Logger.debug("Starting a wait on the snapshot #{state.shape_handle} for #{inspect(from)}}")

    {:noreply, State.add_waiter(state, from), state.hibernate_after}
  end

  def handle_call({:handle_event, event, trace_context}, _from, state) do
    OpenTelemetry.set_current_context(trace_context)

    case handle_event(event, state) do
      %{terminating?: true} = state ->
        {:reply, :ok, state, {:continue, :stop_and_clean}}

      state ->
        {:reply, :ok, state, state.hibernate_after}
    end
  end

  def handle_call({:subscribe_materializer, pid}, _from, state) do
    Logger.debug("Subscribing materializer for #{state.shape_handle}")
    Process.monitor(pid, tag: :materializer_down)
    {:reply, :ok, %{state | materializer_subscribed?: true}, state.hibernate_after}
  end

  def handle_call({:stop, reason}, _from, state) do
    {reason, state} = stop_with_reason(reason, state)
    {:stop, reason, :ok, state}
  end

  @impl GenServer
  def handle_cast(
        {:pg_snapshot_known, shape_handle, {xmin, xmax, xip_list} = snapshot},
        %{shape_handle: shape_handle} = state
      ) do
    Logger.debug(
      "Snapshot known for shape_handle: #{shape_handle} xmin: #{xmin}, xmax: #{xmax}, xip_list: #{inspect(xip_list)}"
    )

    {:noreply, State.set_initial_snapshot(state, snapshot), {:continue, :consume_buffer}}
  end

  def handle_cast({:snapshot_started, shape_handle}, %{shape_handle: shape_handle} = state) do
    Logger.debug("Snapshot started shape_handle: #{shape_handle}")
    {:noreply, mark_snapshot_started(state), state.hibernate_after}
  end

  def handle_cast(
        {:snapshot_failed, shape_handle, %SnapshotError{} = error},
        %{shape_handle: shape_handle} = state
      ) do
    if error.type == :schema_changed do
      # Schema changed while we were creating stuff, which means shape is functionally invalid.
      # Return a 409 to trigger a fresh start with validation against the new schema.
      %{shape: %Shape{root_table_id: root_table_id}} = state
      clean_table(root_table_id, state)
    end

    state
    |> State.reply_to_snapshot_waiters({:error, error})
    |> stop_and_clean()
  end

  def handle_cast({:snapshot_exists, shape_handle}, %{shape_handle: shape_handle} = state) do
    state = mark_snapshot_started(state)

    {:noreply, state, state.hibernate_after}
  end

  @impl GenServer
  def handle_info({ShapeCache.Storage, :flushed, offset}, state) do
    {state, offset} = State.align_offset_to_txn_boundary(state, offset)

    ShapeLogCollector.notify_flushed(state.stack_id, state.shape_handle, offset)
    {:noreply, state, state.hibernate_after}
  end

  # This is part of the storage module contract - messages tagged storage should be applied to the writer state.
  def handle_info({ShapeCache.Storage, message}, state) do
    writer = ShapeCache.Storage.apply_message(state.writer, message)
    {:noreply, %{state | writer: writer}, state.hibernate_after}
  end

  def handle_info(
        {:materializer_changes, dep_handle, %{move_in: move_in, move_out: move_out}},
        state
      ) do
    Logger.debug(fn ->
      "Consumer reacting to #{length(move_in)} move ins and #{length(move_out)} move outs from its #{dep_handle} dependency"
    end)

    tagged_subqueries_enabled? =
      Electric.StackConfig.lookup!(state.stack_id, :tagged_subqueries_enabled?)

    should_invalidate? = not tagged_subqueries_enabled?

    if should_invalidate? do
      # We currently cannot support causally correct event processing of 3+ level dependency trees
      # so we're just invalidating this middle shape instead
      stop_and_clean(state)
    else
      {state, notification} =
        state
        |> MoveHandling.process_move_ins(dep_handle, move_in)
        |> MoveHandling.process_move_outs(dep_handle, move_out)

      notify_new_changes(state, notification)

      {:noreply, state}
    end
  end

  def handle_info({:pg_snapshot_known, name, snapshot}, state) do
    Logger.debug(fn -> "Snapshot known for move-in #{name}" end)

    # Update the snapshot in waiting_move_ins
    move_handling_state = MoveIns.set_snapshot(state.move_handling_state, name, snapshot)

    # Garbage collect touches visible in all known snapshots
    state = %{state | move_handling_state: move_handling_state}
    state = State.gc_touch_tracker(state)

    {:noreply, state, state.hibernate_after}
  end

  def handle_info({:query_move_in_complete, name, key_set, snapshot}, state) do
    Logger.debug(fn ->
      "Consumer query move in complete for #{name} with #{length(key_set)} keys"
    end)

    {state, notification} = MoveHandling.query_complete(state, name, key_set, snapshot)
    state = notify_new_changes(state, notification)

    # Garbage collect touches after query completes (no buffer consumption needed)
    state = State.gc_touch_tracker(state)

    {:noreply, state, state.hibernate_after}
  end

  def handle_info({:query_move_in_error, _, error, stacktrace}, state) do
    Logger.error(
      "Error querying move in for #{state.shape_handle}: #{Exception.format(:error, error, stacktrace)}"
    )

    reraise(error, stacktrace)

    # No-op as the raise will crash the process
    stop_and_clean(state)
  end

  def handle_info({:materializer_shape_invalidated, shape_handle}, state) do
    Logger.warning("Materializer shape invalidated for #{shape_handle}")
    stop_and_clean(state)
  end

  def handle_info({:materializer_down, _ref, :process, pid, reason}, state) do
    Logger.warning(
      "Materializer down for consumer: #{state.shape_handle} (#{inspect(pid)}) (#{inspect(reason)})"
    )

    handle_materializer_down(reason, state)
  end

  def handle_info({{:dependency_materializer_down, handle}, _ref, :process, pid, reason}, state) do
    Logger.warning(
      "Materializer down for a dependency: #{handle} (#{inspect(pid)}) (#{inspect(reason)})"
    )

    handle_materializer_down(reason, state)
  end

  # We're trapping exists so that `terminate` is called to clean up the writer,
  # otherwise we respect the OTP exit protocol. Since nothing is linked to the consumer
  # we shouldn't see this...
  def handle_info({:EXIT, _pid, reason}, state) do
    Logger.error("Caught EXIT: #{inspect(reason)}")
    {:stop, reason, state}
  end

  def handle_info(:timeout, state) do
    # we can only suspend (terminate) the consumer process if
    #
    # 1. Consumer suspend has been enabled in the stack config
    # 2. we're not waiting for snapshot information
    # 3. we are not part of a subquery dependency tree, that is either
    #   a. we have no dependent shapes
    #   b. we don't have a materializer subscribed

    if consumer_suspend_enabled?(state) and consumer_can_suspend?(state) do
      Logger.debug(fn -> ["Suspending consumer ", to_string(state.shape_handle)] end)
      {:stop, ShapeCleaner.consumer_suspend_reason(), state}
    else
      state = %{state | writer: ShapeCache.Storage.hibernate(state.writer)}

      {:noreply, state, :hibernate}
    end
  end

  defp consumer_suspend_enabled?(%{stack_id: stack_id}) do
    # Electric.StackConfig.lookup(stack_id, :shape_enable_suspend?, true)
    Electric.StackConfig.lookup!(stack_id, :shape_enable_suspend?)
  end

  defp consumer_can_suspend?(state) do
    is_snapshot_started(state) and not Shape.has_dependencies?(state.shape) and
      not state.materializer_subscribed?
  end

  @impl GenServer
  def terminate(reason, state) do
    Logger.debug(fn ->
      case reason do
        {error, stacktrace} when is_tuple(error) and is_list(stacktrace) ->
          "Shapes.Consumer terminating with reason: #{Exception.format(:error, error, stacktrace)}"

        other ->
          "Shapes.Consumer terminating with reason: #{inspect(other)}"
      end
    end)

    case ShapeCleaner.handle_writer_termination(state.stack_id, state.shape_handle, reason) do
      :ok -> terminate_writer(state)
      :removed -> :ok
    end

    State.reply_to_snapshot_waiters(state, {:error, "Shape terminated before snapshot was ready"})
  end

  # Any relation that gets let through by the `ShapeLogCollector` (as coupled with `Shapes.Dispatcher`)
  # is a signal that we need to terminate the shape.
  defp handle_event(%Changes.Relation{}, state) do
    %{shape: %Shape{root_table_id: root_table_id, root_table: root_table}} = state

    Logger.info(
      "Schema for the table #{Utils.inspect_relation(root_table)} changed - terminating shape #{state.shape_handle}"
    )

    # We clean up the relation info from ETS as it has changed and we want
    # to source the fresh info from postgres for the next shape creation
    clean_table(root_table_id, state)

    state
    |> State.reply_to_snapshot_waiters(
      {:error, "Shape relation changed before snapshot was ready"}
    )
    |> mark_for_removal()
  end

  defp handle_event(%TransactionFragment{} = txn_fragment, state) do
    {txns, transaction_builder} =
      TransactionBuilder.build(txn_fragment, state.transaction_builder)

    state = %{state | transaction_builder: transaction_builder}
    handle_txns(txns, state)
  end

  defp handle_txns(txns, %State{} = state), do: Enum.reduce_while(txns, state, &handle_txn/2)

  # Keep buffering for initial snapshot
  defp handle_txn(txn, %State{buffering?: true} = state),
    do: {:cont, State.add_to_buffer(state, txn)}

  defp handle_txn(txn, state) when needs_initial_filtering(state) do
    case InitialSnapshot.filter(state.initial_snapshot_state, state.storage, txn) do
      {:consider_flushed, initial_snapshot_state} ->
        {:cont, consider_flushed(%{state | initial_snapshot_state: initial_snapshot_state}, txn)}

      {:continue, new_initial_snapshot_state} ->
        handle_txn_in_span(txn, %{state | initial_snapshot_state: new_initial_snapshot_state})
    end
  end

  # Remove the move-in buffering check - just process immediately
  defp handle_txn(txn, state), do: handle_txn_in_span(txn, state)

  defp handle_txn_in_span(txn, %State{} = state) do
    ot_attrs =
      [xid: txn.xid, total_num_changes: txn.num_changes] ++
        shape_attrs(state.shape_handle, state.shape)

    OpenTelemetry.with_child_span(
      "shape_write.consumer.handle_txn",
      ot_attrs,
      state.stack_id,
      fn ->
        do_handle_txn(txn, state)
      end
    )
  end

  defp do_handle_txn(%Transaction{} = txn, state)
       when LogOffset.is_log_offset_lte(txn.last_log_offset, state.latest_offset) do
    Logger.debug(fn -> "Skipping already processed txn #{txn.xid}" end)

    {:cont, consider_flushed(state, txn)}
  end

  defp do_handle_txn(%Transaction{xid: xid, changes: changes} = txn, state) do
    %{
      shape: shape,
      shape_handle: shape_handle,
      writer: writer
    } = state

    Logger.debug(fn -> "Txn received in Shapes.Consumer: #{inspect(txn)}" end)

    extra_refs1 =
      Materializer.get_all_as_refs(shape, state.stack_id)

    extra_refs =
      Enum.reduce(state.move_handling_state.in_flight_values, extra_refs1, fn {key, value}, acc ->
        if is_map_key(acc, key),
          do: Map.update!(acc, key, &MapSet.difference(&1, value)),
          else: acc
      end)

    Logger.debug(fn -> "Extra refs: #{inspect(extra_refs)}" end)

    case filter_changes(
           changes,
           shape,
           {xid, state.move_handling_state, state.stack_id, state.shape_handle},
           extra_refs
         ) do
      :includes_truncate ->
        # TODO: This is a very naive way to handle truncations: if ANY relevant truncates are
        #       present in the transaction, we're considering the whole transaction empty, and
        #       just rotate the shape handle. "Correct" way to handle truncates is to be designed.
        Logger.warning(
          "Truncate operation encountered while processing txn #{txn.xid} for #{shape_handle}"
        )

        state = mark_for_removal(state)

        {:halt, state}

      {_, 0, _} ->
        Logger.debug(fn ->
          "No relevant changes found for #{inspect(shape)} in txn #{txn.xid}"
        end)

        {:cont, consider_flushed(state, txn)}

      {changes, num_changes, last_log_offset} ->
        timestamp = System.monotonic_time()

        # Track touches for all filtered changes
        state =
          Enum.reduce(changes, state, fn change, acc ->
            State.track_change(acc, xid, change)
          end)

        {lines, total_size} = prepare_log_entries(changes, xid, shape)
        writer = ShapeCache.Storage.append_to_log!(lines, writer)

        OpenTelemetry.add_span_attributes(%{
          num_bytes: total_size,
          actual_num_changes: num_changes
        })

        notify_new_changes(state, changes, last_log_offset)

        lag = calculate_replication_lag(txn)
        OpenTelemetry.add_span_attributes(replication_lag: lag)

        Electric.Telemetry.OpenTelemetry.execute(
          [:electric, :storage, :transaction_stored],
          %{
            duration: System.monotonic_time() - timestamp,
            bytes: total_size,
            count: 1,
            operations: num_changes,
            replication_lag: lag
          },
          Map.new(shape_attrs(state.shape_handle, state.shape))
        )

        {:cont,
         %{
           state
           | writer: writer,
             latest_offset: last_log_offset,
             txn_offset_mapping:
               state.txn_offset_mapping ++ [{last_log_offset, txn.last_log_offset}]
         }}
    end
  end

  defp notify_new_changes(state, nil), do: state

  defp notify_new_changes(state, {changes, upper_bound}) do
    notify_new_changes(state, changes, upper_bound)
  end

  @spec notify_new_changes(
          state :: map(),
          changes_or_bounds :: list(Changes.change()) | {LogOffset.t(), LogOffset.t()},
          latest_log_offset :: LogOffset.t()
        ) :: map()
  defp notify_new_changes(state, changes_or_bounds, latest_log_offset) do
    ShapeCache.ShapeStatus.set_latest_offset(
      state.stack_id,
      state.shape_handle,
      latest_log_offset
    )

    if state.materializer_subscribed? do
      Materializer.new_changes(Map.take(state, [:stack_id, :shape_handle]), changes_or_bounds)
    end

    Registry.dispatch(
      Electric.StackSupervisor.registry_name(state.stack_id),
      state.shape_handle,
      fn registered ->
        Logger.debug(fn ->
          "Notifying ~#{length(registered)} clients about new changes to #{state.shape_handle}"
        end)

        for {pid, ref} <- registered,
            do: send(pid, {ref, :new_changes, latest_log_offset})
      end
    )

    state
  end

  defp mark_snapshot_started(%State{stack_id: stack_id, shape_handle: shape_handle} = state) do
    :ok = ShapeCache.ShapeStatus.mark_snapshot_as_started(stack_id, shape_handle)
    State.mark_snapshot_started(state)
  end

  # termination and cleanup is now done in stages.
  # 1. register that we want the shape data to be cleaned up.
  # 2. request a notification when all active shape data reads are complete
  # 3. exit the process when we receive that notification

  defp mark_for_removal(%{terminating?: true} = state) do
    state
  end

  defp mark_for_removal(state) do
    # remove the writer state to save on a pointless Storage.terminate/1 call
    %{state | terminating?: true, writer: nil}
  end

  defp stop_with_reason(reason, state) do
    {reason, state} =
      case reason do
        # map reason to a clean shutdown to avoid exceptions/errors
        {:error, _} = error ->
          state = state |> State.reply_to_snapshot_waiters(error) |> mark_for_removal()
          {@stop_and_clean_reason, state}

        reason ->
          {reason, %{state | terminating?: true}}
      end

    {reason, state}
  end

  defp stop_and_clean(state) do
    {:stop, @stop_and_clean_reason, mark_for_removal(state)}
  end

  # Apply shape filter to keep only relevant changes, returning the list of changes.
  # Marks the last change, and infers the last offset after possible splits.
  defp filter_changes(
         changes,
         shape,
         snapshot_filtering,
         extra_refs,
         change_acc \\ [],
         total_ops_acc \\ 0
       )

  defp filter_changes([], _shape, _, _, [], 0), do: {[], 0, nil}

  defp filter_changes([], _shape, _, _, [change | rest], total_ops),
    do:
      {Enum.reverse([%{change | last?: true} | rest]), total_ops,
       LogItems.expected_offset_after_split(change)}

  defp filter_changes([%Changes.TruncatedRelation{} | _], _, _, _, _, _),
    do: :includes_truncate

  defp filter_changes(
         [change | rest],
         shape,
         {xid, filter_state, stack_id, shape_handle} = filtering,
         extra_refs,
         change_acc,
         total_ops
       ) do
    if not MoveIns.change_already_visible?(filter_state, xid, change) do
      case Shape.convert_change(shape, change,
             extra_refs: extra_refs,
             stack_id: stack_id,
             shape_handle: shape_handle
           ) do
        [] ->
          filter_changes(rest, shape, filtering, extra_refs, change_acc, total_ops)

        [change] ->
          filter_changes(rest, shape, filtering, extra_refs, [change | change_acc], total_ops + 1)
      end
    else
      filter_changes(rest, shape, filtering, extra_refs, change_acc, total_ops)
    end
  end

  defp prepare_log_entries(changes, xid, shape) do
    changes
    |> Stream.flat_map(
      &LogItems.from_change(&1, xid, Shape.pk(shape, &1.relation), shape.replica)
    )
    |> Enum.map_reduce(0, fn {offset, %{key: key, headers: %{operation: operation}} = log_item},
                             total_size ->
      json_line = Jason.encode!(log_item)
      line_tuple = {offset, key, operation, json_line}
      {line_tuple, total_size + byte_size(json_line)}
    end)
  end

  defp shape_attrs(shape_handle, shape) do
    [
      "shape.handle": shape_handle,
      "shape.root_table": shape.root_table,
      "shape.where": shape.where
    ]
  end

  defp calculate_replication_lag(%Transaction{commit_timestamp: nil}) do
    0
  end

  defp calculate_replication_lag(%Transaction{commit_timestamp: commit_timestamp}) do
    # Compute time elapsed since commit
    # since we are comparing PG's clock with our own
    # there may be a slight skew so we make sure not to report negative lag.
    # Since the lag is only useful when it becomes significant, a slight skew doesn't matter.
    now = DateTime.utc_now()
    Kernel.max(0, DateTime.diff(now, commit_timestamp, :millisecond))
  end

  defp consider_flushed(%State{} = state, %Transaction{last_log_offset: new_boundary}) do
    if state.txn_offset_mapping == [] do
      # No relevant txns have been observed and unflushed, we can notify immediately
      ShapeLogCollector.notify_flushed(state.stack_id, state.shape_handle, new_boundary)
      state
    else
      # We're looking to "relabel" the next flush to include this txn, so we're looking for the
      # boundary that has a highest boundary less than this offset

      {head, tail} =
        Enum.split_while(
          state.txn_offset_mapping,
          &(LogOffset.compare(elem(&1, 1), new_boundary) == :lt)
        )

      case Enum.reverse(head) do
        [] ->
          # Nothing lower than this, any flush will advance beyond this txn point
          state

        [{offset, _} | rest] ->
          # Found one to relabel the upper boundary to include this txn
          %{state | txn_offset_mapping: Enum.reverse([{offset, new_boundary} | rest], tail)}
      end
    end
  end

  defp subscribe(state, action) do
    case ShapeLogCollector.add_shape(state.stack_id, state.shape_handle, state.shape, action) do
      :ok ->
        true

      {:error, error} ->
        Logger.warning(
          "Shape #{state.shape_handle} cannot subscribe due to #{inspect(error)} - invalidating shape"
        )

        false
    end
  end

  defp all_materializers_alive?(state) do
    Enum.all?(state.shape.shape_dependencies_handles, fn shape_handle ->
      name = Materializer.name(state.stack_id, shape_handle)

      with pid when is_pid(pid) <- GenServer.whereis(name),
           true <- Process.alive?(pid) do
        Process.monitor(pid,
          tag: {:dependency_materializer_down, shape_handle}
        )

        Materializer.subscribe(state.stack_id, shape_handle)

        true
      else
        _ ->
          Logger.warning(
            "Materializer for #{shape_handle} is not alive, invalidating shape #{state.shape_handle}"
          )

          false
      end
    end)
  end

  defp clean_table(table_oid, state) do
    inspector = Electric.StackConfig.lookup!(state.stack_id, :inspector)
    Inspector.clean(table_oid, inspector)
  end

  defp handle_materializer_down(reason, state) do
    case {reason, state.terminating?} do
      {_, true} -> {:noreply, state}
      {{:shutdown, _}, false} -> {:stop, reason, state}
      {:shutdown, false} -> {:stop, reason, state}
      _ -> stop_and_clean(state)
    end
  end

  defp terminate_writer(state) do
    {writer, state} = Map.pop(state, :writer)

    try do
      if writer, do: ShapeCache.Storage.terminate(writer)
    rescue
      # In the case of shape removal, the deletion of the storage directory
      # may happen before we have a chance to terminate the storage
      File.Error -> :ok
    end

    state
  end

  if Mix.env() == :test do
    def activate_mocked_functions_from_test_process do
      Support.TestUtils.activate_mocked_functions_for_module(__MODULE__)
    end
  else
    def activate_mocked_functions_from_test_process, do: :noop
  end
end
