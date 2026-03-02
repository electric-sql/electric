defmodule Electric.Shapes.Consumer do
  use GenServer, restart: :temporary

  alias Electric.Shapes.Consumer.ChangeHandling
  alias Electric.Shapes.Consumer.InitialSnapshot
  alias Electric.Shapes.Consumer.MoveHandling
  alias Electric.Shapes.Consumer.MoveIns
  alias Electric.Shapes.Consumer.PendingTxn
  alias Electric.Shapes.Consumer.State

  import Electric.Shapes.Consumer.State, only: :macros
  require Electric.Replication.LogOffset
  require Electric.Shapes.Shape

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
  require TransactionFragment

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

  @spec subscribe_materializer(Electric.stack_id(), Electric.shape_handle(), pid()) ::
          {:ok, LogOffset.t()}
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

    %{stack_id: stack_id, shape_handle: shape_handle} = config

    Process.set_label({:consumer, shape_handle})
    Process.flag(:trap_exit, true)

    metadata = [shape_handle: shape_handle, stack_id: stack_id]
    Logger.metadata(metadata)
    Electric.Telemetry.Sentry.set_tags_context(metadata)

    {:ok, State.new(stack_id, shape_handle), {:continue, {:init_consumer, config}}}
  end

  @impl GenServer
  def handle_continue({:init_consumer, config}, state) do
    %{
      stack_id: stack_id,
      shape_handle: shape_handle
    } = state

    {:ok, shape} = ShapeCache.ShapeStatus.fetch_shape_by_handle(stack_id, shape_handle)

    state = State.initialize_shape(state, shape, config)

    stack_storage = ShapeCache.Storage.for_stack(stack_id)
    storage = ShapeCache.Storage.for_shape(shape_handle, stack_storage)

    # TODO: Remove. Only needed for InMemoryStorage
    case ShapeCache.Storage.start_link(storage) do
      {:ok, _pid} -> :ok
      :ignore -> :ok
    end

    writer = ShapeCache.Storage.init_writer!(storage, shape)

    state = State.initialize(state, storage, writer)

    if all_materializers_alive?(state) && subscribe(state, config.action) do
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
            otel_ctx: config.otel_ctx
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

  def handle_continue(:consume_buffer, state) do
    state = process_buffered_txn_fragments(state)

    if state.terminating? do
      {:noreply, state, {:continue, :stop_and_clean}}
    else
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

    {:reply, {:ok, state.latest_offset}, %{state | materializer_subscribed?: true},
     state.hibernate_after}
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
    {:noreply, State.mark_snapshot_started(state), state.hibernate_after}
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
    {:noreply, State.mark_snapshot_started(state), state.hibernate_after}
  end

  @impl GenServer
  def handle_info({ShapeCache.Storage, :flushed, offset_in}, state) do
    {state, offset_txn} = State.align_offset_to_txn_boundary(state, offset_in)

    ShapeLogCollector.notify_flushed(state.stack_id, state.shape_handle, offset_txn)
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

    feature_flags = Electric.StackConfig.lookup(state.stack_id, :feature_flags, [])
    tagged_subqueries_enabled? = "tagged_subqueries" in feature_flags

    # We need to invalidate the consumer in the following cases:
    # - tagged subqueries are disabled since we cannot support causally correct event processing of 3+ level dependency trees
    #   so we just invalidating this middle shape instead
    # - the where clause has an OR combined with the subquery so we can't tell if the move ins/outs actually affect the shape or not
    # - the where clause has a NOT combined with the subquery (e.g. NOT IN) since move-in to the subquery
    #   should cause move-out from the outer shape, which isn't implemented
    # - the shape has multiple subqueries at the same level since we can't correctly determine
    #   which dependency caused the move-in/out
    should_invalidate? =
      not tagged_subqueries_enabled? or state.or_with_subquery? or state.not_with_subquery? or
        length(state.shape.shape_dependencies) > 1

    if should_invalidate? do
      stop_and_clean(state)
    else
      {state, notification} =
        state
        |> MoveHandling.process_move_ins(dep_handle, move_in)
        |> MoveHandling.process_move_outs(dep_handle, move_out)

      :ok = notify_new_changes(state, notification)

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
    :ok = notify_new_changes(state, notification)

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

  # Set a new value for hibernate after and set a timeout between
  # hibernate_after and max_timeout in order to spread
  # consumer suspend events.
  def handle_info({:configure_suspend, hibernate_after, jitter_period}, state) do
    {:noreply, %{state | hibernate_after: hibernate_after},
     Enum.random(hibernate_after..jitter_period)}
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
    Electric.StackConfig.lookup(stack_id, :shape_enable_suspend?, true)
  end

  defp consumer_can_suspend?(state) do
    is_snapshot_started(state) and not Shape.has_dependencies(state.shape) and
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

    # always need to terminate writer to remove the writer ets (which belongs
    # to this process). leads to unecessary writes in the case of a deleted
    # shape but the alternative is leaking ets tables.
    state = terminate_writer(state)

    ShapeCleaner.handle_writer_termination(state.stack_id, state.shape_handle, reason)

    State.reply_to_snapshot_waiters(state, {:error, "Shape terminated before snapshot was ready"})
  end

  # Any relation that gets let through by the `ShapeLogCollector` (as coupled with `Shapes.Dispatcher`)
  # is a signal that we need to terminate the shape.
  defp handle_event(%Changes.Relation{}, state) do
    %{shape: %Shape{root_table_id: root_table_id, root_table: root_table}} = state

    Logger.notice(
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
    Logger.debug(fn -> "Txn fragment received in Shapes.Consumer: #{inspect(txn_fragment)}" end)
    handle_txn_fragment(txn_fragment, state)
  end

  # A consumer process starts with buffering?=true before it has PG snapshot info (xmin, xmax, xip_list).
  # In this phase we have to buffer incoming txn fragments because we can't yet decide what to
  # do with the transaction: skip it or write it to the shape log.
  #
  # When snapshot info arrives, `process_buffered_txn_fragments/1` will be called to process
  # buffered fragments in order.
  defp handle_txn_fragment(
         %TransactionFragment{} = txn_fragment,
         %State{buffering?: true} = state
       ) do
    State.add_to_buffer(state, txn_fragment)
  end

  # Short-circuit clauses for the most common case of a single-fragment transaction
  defp handle_txn_fragment(%TransactionFragment{} = txn_fragment, state)
       when TransactionFragment.complete_transaction?(txn_fragment) and
              needs_initial_filtering(state) do
    case InitialSnapshot.filter(state.initial_snapshot_state, state.storage, txn_fragment.xid) do
      {:consider_flushed, initial_snapshot_state} ->
        # This transaction is already included in the snapshot, flush it immediately and skip
        # writing it to the shape log.
        state = %{state | initial_snapshot_state: initial_snapshot_state}
        consider_flushed(state, txn_fragment.last_log_offset)

      {:continue, initial_snapshot_state} ->
        # The transaction is not part of the initial snapshot.
        state = %{state | initial_snapshot_state: initial_snapshot_state}
        build_and_handle_txn(txn_fragment, state)
    end
  end

  defp handle_txn_fragment(%TransactionFragment{} = txn_fragment, state)
       when TransactionFragment.complete_transaction?(txn_fragment) do
    build_and_handle_txn(txn_fragment, state)
  end

  # pending_txn struct is initialized to keep track of all fragments comprising this txn and
  # store the "consider_flushed" state on it.
  defp handle_txn_fragment(
         %TransactionFragment{has_begin?: true, xid: xid} = txn_fragment,
         %State{pending_txn: nil} = state
       ) do
    txn = PendingTxn.new(xid)
    state = %{state | pending_txn: txn}
    handle_txn_fragment(txn_fragment, state)
  end

  # Upon seeing the first fragment of a new transaction, check if its xid is already included in the
  # initial snapshot. If it is, all subsequent fragments of this transaction will be ignored.
  #
  # Initial filtering is giving us the advantage of not accumulating fragments for a
  # transaction that is going to be skipped anyway. This works for any value of state.write_unit.
  defp handle_txn_fragment(
         %TransactionFragment{has_begin?: true, xid: xid} = txn_fragment,
         %State{} = state
       )
       when needs_initial_filtering(state) do
    state =
      case InitialSnapshot.filter(state.initial_snapshot_state, state.storage, xid) do
        {:consider_flushed, initial_snapshot_state} ->
          # This transaction is already included in the snapshot, so mark it as flushed to
          # ignore any of its follow-up fragments.
          %{
            state
            | pending_txn: PendingTxn.consider_flushed(state.pending_txn),
              initial_snapshot_state: initial_snapshot_state
          }

        {:continue, initial_snapshot_state} ->
          # The transaction is not part of the initial snapshot.
          %{state | initial_snapshot_state: initial_snapshot_state}
      end

    process_txn_fragment(txn_fragment, state)
  end

  defp handle_txn_fragment(txn_fragment, state), do: process_txn_fragment(txn_fragment, state)

  defp process_txn_fragment(
         %TransactionFragment{} = txn_fragment,
         %State{pending_txn: txn} = state
       ) do
    cond do
      # Fragments belonging to the same transaction can all be skipped either via xid-filtering or log offset filtering.
      txn.consider_flushed? or fragment_already_processed?(txn_fragment, state) ->
        skip_txn_fragment(state, txn_fragment)

      # With write_unit=txn all fragments are buffered until the Commit change is seen. At that
      # point, a transaction struct is produced from the buffered fragments and is written to
      # storage.
      state.write_unit == State.write_unit_txn() ->
        {txns, transaction_builder} =
          TransactionBuilder.build(txn_fragment, state.transaction_builder)

        state = %{state | transaction_builder: transaction_builder}

        case txns do
          [] ->
            state

          [txn] ->
            Logger.debug(fn -> "Txn assembled in Shapes.Consumer: #{inspect(txn)}" end)
            handle_txn(txn, %{state | pending_txn: nil})
        end

      true ->
        # If we've ended up in this branch, we know for sure that the current fragment is only
        # one of two or more for the current transaction.
        state
        |> write_txn_fragment_to_storage(txn_fragment)
        |> maybe_complete_pending_txn(txn_fragment)
    end
  end

  defp skip_txn_fragment(state, %TransactionFragment{commit: nil}), do: state

  # The last fragment of the currently pending transaction.
  defp skip_txn_fragment(state, %TransactionFragment{} = txn_fragment) do
    %{state | pending_txn: nil}
    |> consider_flushed(txn_fragment.last_log_offset)
  end

  # This function does similar things to do_handle_txn/2 but with the following simplifications:
  #   - it doesn't account for move-ins or move-outs or converting update operations into insert/delete
  #   - the fragment is written directly to storage if it has changes matching this shape
  #   - if the fragment has a commit message, the ShapeLogCollector is informed about the new flush boundary
  defp write_txn_fragment_to_storage(state, %TransactionFragment{changes: []}), do: state

  defp write_txn_fragment_to_storage(
         state,
         %TransactionFragment{changes: changes, xid: xid} = fragment
       ) do
    %{
      shape: shape,
      writer: writer,
      pending_txn: txn,
      stack_id: stack_id,
      shape_handle: shape_handle
    } = state

    case convert_fragment_changes(changes, stack_id, shape_handle, shape) do
      :includes_truncate ->
        handle_txn_with_truncate(xid, state)

      {[], 0} ->
        Logger.debug(fn ->
          "No relevant changes found for #{inspect(shape)} in txn fragment of txn #{xid}"
        end)

        state

      {reversed_changes, num_changes, last_log_offset} ->
        converted_changes =
          reversed_changes
          |> maybe_mark_last_change(fragment.commit)
          |> Enum.reverse()

        timestamp = System.monotonic_time()

        {lines, total_size} = prepare_log_entries(converted_changes, xid, shape)
        writer = ShapeCache.Storage.append_fragment_to_log!(lines, writer)

        # The Materializer must see all txn changes for correct tracking of move-ins and
        # move-outs for the outer shape. The commit=false flag ensure it doesn't yet notify
        # outer consumers about those changes.
        :ok = notify_materializer_of_new_changes(state, converted_changes, commit: false)

        txn =
          PendingTxn.update_with_changes(
            txn,
            System.monotonic_time() - timestamp,
            num_changes,
            total_size
          )

        %{state | writer: writer, latest_offset: last_log_offset, pending_txn: txn}
    end
  end

  defp convert_fragment_changes(changes, stack_id, shape_handle, shape) do
    Enum.reduce_while(changes, {[], 0}, fn
      %Changes.TruncatedRelation{}, _acc ->
        {:halt, :includes_truncate}

      change, {changes, count} = acc ->
        # Apply Shape.convert_change to each change to:
        # 1. Filter out changes not matching the shape's table
        # 2. Apply WHERE clause filtering
        case Shape.convert_change(shape, change, stack_id: stack_id, shape_handle: shape_handle) do
          [] ->
            {:cont, acc}

          [change] ->
            {:cont, {[change | changes], count + 1}}
        end
    end)
    |> case do
      {[change | _] = changes, num_changes} ->
        {changes, num_changes, LogItems.expected_offset_after_split(change)}

      acc ->
        acc
    end
  end

  # Mark the last change in the list as last? when this is a commit fragment
  # This is needed for clients to know when a transaction is complete
  # The changes passed to this function are in reversed order, i.e. the last change is the head of the list.
  defp maybe_mark_last_change([], _commit), do: []
  defp maybe_mark_last_change(changes, nil), do: changes

  defp maybe_mark_last_change(changes, _commit) do
    [head | tail] = changes
    [%{head | last?: true} | tail]
  end

  defp maybe_complete_pending_txn(%State{} = state, %TransactionFragment{commit: nil}),
    do: state

  defp maybe_complete_pending_txn(%State{terminating?: true} = state, _fragment) do
    # If we're terminating (e.g., due to truncate), don't complete the transaction
    state
  end

  defp maybe_complete_pending_txn(%State{} = state, txn_fragment) do
    %{pending_txn: txn, writer: writer} = state

    # Only notify if we actually wrote changes
    if txn.num_changes > 0 do
      # Signal commit to storage to allow it to advance its internal txn offset
      writer = ShapeCache.Storage.signal_txn_commit!(txn.xid, writer)

      :ok = notify_new_changes(state, [], state.latest_offset)

      lag = calculate_replication_lag(txn_fragment.commit.commit_timestamp)

      OpenTelemetry.add_span_attributes(
        num_bytes: txn.total_bytes,
        actual_num_changes: txn.num_changes,
        replication_lag: lag
      )

      Electric.Telemetry.OpenTelemetry.execute(
        [:electric, :storage, :transaction_stored],
        %{
          duration: txn.storage_duration,
          bytes: txn.total_bytes,
          count: 1,
          operations: txn.num_changes,
          replication_lag: lag
        },
        Map.new(State.telemetry_attrs(state))
      )

      Logger.debug(fn ->
        "Processed the final fragment for transaction xid=#{txn.xid}, total_changes=#{txn.num_changes}"
      end)

      %{
        state
        | writer: writer,
          pending_txn: nil,
          txn_offset_mapping:
            state.txn_offset_mapping ++ [{state.latest_offset, txn_fragment.last_log_offset}]
      }
    else
      Logger.debug(fn ->
        "No relevant changes written in transaction xid=#{txn.xid}"
      end)

      state = %{state | pending_txn: nil}
      consider_flushed(state, txn_fragment.last_log_offset)
    end
  end

  def process_buffered_txn_fragments(%State{buffer: buffer} = state) do
    Logger.debug(fn -> "Consumer catching up on #{length(buffer)} transaction fragments" end)
    {txn_fragments, state} = State.pop_buffered(state)

    Enum.reduce_while(txn_fragments, state, fn txn_fragment, state ->
      state = handle_txn_fragment(txn_fragment, state)

      if state.terminating? do
        {:halt, state}
      else
        {:cont, state}
      end
    end)
  end

  defp build_and_handle_txn(%TransactionFragment{} = txn_fragment, %State{} = state) do
    {[txn], _} = TransactionBuilder.build(txn_fragment, TransactionBuilder.new())
    handle_txn(txn, state)
  end

  defp handle_txn(txn, %State{} = state) do
    ot_attrs =
      [xid: txn.xid, total_num_changes: txn.num_changes] ++ State.telemetry_attrs(state)

    OpenTelemetry.with_child_span(
      "shape_write.consumer.handle_txn",
      ot_attrs,
      state.stack_id,
      fn -> do_handle_txn(txn, state) end
    )
  end

  defp do_handle_txn(%Transaction{xid: xid, changes: changes} = txn, state) do
    %{shape: shape, writer: writer} = state

    state = State.remove_completed_move_ins(state, txn)

    extra_refs_full =
      Materializer.get_all_as_refs(shape, state.stack_id)

    extra_refs_before_move_ins =
      Enum.reduce(state.move_handling_state.in_flight_values, extra_refs_full, fn {key, value},
                                                                                  acc ->
        if is_map_key(acc, key),
          do: Map.update!(acc, key, &MapSet.difference(&1, value)),
          else: acc
      end)

    Logger.debug(fn -> "Extra refs: #{inspect(extra_refs_before_move_ins)}" end)

    case ChangeHandling.process_changes(
           changes,
           state,
           %{xid: xid, extra_refs: {extra_refs_before_move_ins, extra_refs_full}}
         ) do
      :includes_truncate ->
        handle_txn_with_truncate(txn.xid, state)

      {_, state, 0, _} ->
        Logger.debug(fn ->
          "No relevant changes found for #{inspect(shape)} in txn #{txn.xid}"
        end)

        consider_flushed(state, txn.last_log_offset)

      {changes, state, num_changes, last_log_offset} ->
        timestamp = System.monotonic_time()

        {lines, total_size} = prepare_log_entries(changes, xid, shape)
        writer = ShapeCache.Storage.append_to_log!(lines, writer)

        OpenTelemetry.add_span_attributes(%{
          num_bytes: total_size,
          actual_num_changes: num_changes
        })

        :ok = notify_new_changes(state, changes, last_log_offset)

        lag = calculate_replication_lag(txn.commit_timestamp)
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
          Map.new(State.telemetry_attrs(state))
        )

        %{
          state
          | writer: writer,
            latest_offset: last_log_offset,
            txn_offset_mapping:
              state.txn_offset_mapping ++ [{last_log_offset, txn.last_log_offset}]
        }
    end
  end

  defp handle_txn_with_truncate(xid, state) do
    # TODO: This is a very naive way to handle truncations: if ANY relevant truncates are
    #       present in the transaction, we're considering the whole transaction empty, and
    #       just rotate the shape handle. "Correct" way to handle truncates is to be designed.
    Logger.warning(
      "Truncate operation encountered while processing txn #{xid} for #{state.shape_handle}"
    )

    mark_for_removal(state)
  end

  defp notify_new_changes(_state, nil), do: :ok

  defp notify_new_changes(state, {changes, upper_bound}) do
    notify_new_changes(state, changes, upper_bound)
  end

  @spec notify_new_changes(
          state :: map(),
          changes_or_bounds :: list(Changes.change()) | {LogOffset.t(), LogOffset.t()},
          latest_log_offset :: LogOffset.t()
        ) :: :ok
  defp notify_new_changes(state, changes_or_bounds, latest_log_offset) do
    :ok = notify_materializer_of_new_changes(state, changes_or_bounds)
    :ok = notify_clients_of_new_changes(state, latest_log_offset)
  end

  @spec notify_clients_of_new_changes(
          state :: map(),
          latest_log_offset :: LogOffset.t()
        ) :: :ok
  defp notify_clients_of_new_changes(state, latest_log_offset) do
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
  end

  @spec notify_materializer_of_new_changes(
          state :: map(),
          changes_or_bounds :: list(Changes.change()) | {LogOffset.t(), LogOffset.t()},
          opts :: keyword()
        ) :: :ok
  defp notify_materializer_of_new_changes(state, changes_or_bounds, opts \\ [])

  defp notify_materializer_of_new_changes(
         %{materializer_subscribed?: true} = state,
         changes_or_bounds,
         opts
       ) do
    Materializer.new_changes(Map.take(state, [:stack_id, :shape_handle]), changes_or_bounds, opts)
  end

  defp notify_materializer_of_new_changes(_state, _changes_or_bounds, _opts), do: :ok

  # termination and cleanup is now done in stages.
  # 1. register that we want the shape data to be cleaned up.
  # 2. request a notification when all active shape data reads are complete
  # 3. exit the process when we receive that notification

  defp mark_for_removal(%{terminating?: true} = state) do
    state
  end

  defp mark_for_removal(state) do
    %{state | terminating?: true}
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

  defp calculate_replication_lag(nil), do: 0

  defp calculate_replication_lag(commit_timestamp) do
    # Compute time elapsed since commit
    # since we are comparing PG's clock with our own
    # there may be a slight skew so we make sure not to report negative lag.
    # Since the lag is only useful when it becomes significant, a slight skew doesn't matter.
    now = DateTime.utc_now()
    Kernel.max(0, DateTime.diff(now, commit_timestamp, :millisecond))
  end

  defp fragment_already_processed?(%TransactionFragment{last_log_offset: offset}, state) do
    LogOffset.is_log_offset_lte(offset, state.latest_offset)
  end

  defp consider_flushed(%State{} = state, log_offset) do
    if state.txn_offset_mapping == [] do
      # No relevant txns have been observed and unflushed, we can notify immediately
      ShapeLogCollector.notify_flushed(state.stack_id, state.shape_handle, log_offset)
      state
    else
      # We're looking to "relabel" the next flush to include this txn, so we're looking for the
      # boundary that has a highest boundary less than this offset
      new_boundary = log_offset

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

        Materializer.subscribe(pid)

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
