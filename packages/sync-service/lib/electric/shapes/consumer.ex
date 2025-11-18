defmodule Electric.Shapes.Consumer do
  use GenServer, restart: :temporary

  alias Electric.Shapes.Consumer.MoveHandling
  alias Electric.Shapes.Consumer.State

  alias Electric.Replication.LogOffset
  alias Electric.Shapes.Consumer.Materializer
  alias Electric.Shapes.ConsumerRegistry
  alias Electric.LogItems
  alias Electric.Postgres.Inspector
  alias Electric.Replication.Changes
  alias Electric.Replication.Changes.Transaction
  alias Electric.Replication.ShapeLogCollector
  alias Electric.ShapeCache
  alias Electric.Shapes
  alias Electric.Shapes.Shape
  alias Electric.SnapshotError
  alias Electric.Telemetry.OpenTelemetry
  alias Electric.Utils

  require Logger

  @default_snapshot_timeout 45_000
  @stop_and_clean_timeout 30_000

  def name(stack_id, shape_handle) when is_binary(shape_handle) do
    ConsumerRegistry.name(stack_id, shape_handle)
  end

  def initial_state(consumer) do
    GenServer.call(consumer, :initial_state, 30_000)
  end

  @spec await_snapshot_start(Electric.stack_id(), ShapeCache.shape_handle(), timeout()) ::
          :started | {:error, any()}
  def await_snapshot_start(stack_id, shape_handle, timeout \\ @default_snapshot_timeout)
      when is_binary(stack_id) and is_binary(shape_handle) do
    stack_id
    |> consumer_pid(shape_handle)
    |> GenServer.call(:await_snapshot_start, timeout)
  end

  @spec subscribe_materializer(Electric.stack_id(), ShapeCache.shape_handle(), pid()) :: :ok
  def subscribe_materializer(stack_id, shape_handle, pid) do
    stack_id
    |> consumer_pid(shape_handle)
    |> GenServer.call({:subscribe_materializer, pid})
  end

  @doc false
  # use in tests to avoid race conditions. registers `pid` to be notified
  # when the `shape_handle` consumer has processed every transaction.
  # Transactions that we skip because of xmin logic do not generate
  # a notification
  @spec monitor(Electric.stack_id(), ShapeCache.shape_handle(), pid()) :: reference()
  def monitor(stack_id, shape_handle, pid \\ self()) do
    stack_id
    |> consumer_pid(shape_handle)
    |> GenServer.call({:monitor, pid})
  end

  @spec whereis(Electric.stack_id(), ShapeCache.shape_handle()) :: pid() | nil
  def whereis(stack_id, shape_handle) do
    consumer_pid(stack_id, shape_handle)
  end

  def stop_and_clean(stack_id, shape_handle) do
    # if consumer is present, terminate it gracefully
    stack_id
    |> consumer_pid(shape_handle)
    |> GenServer.call(:stop_and_clean, @stop_and_clean_timeout)
  catch
    :exit, {:noproc, _} -> :noproc
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
        State.initial_snapshot_xmin(state),
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
      {:noreply, terminate_safely(state)}
    end
  end

  def handle_continue(:consume_buffer, %State{buffer: buffer} = state) do
    Logger.debug(fn -> "Consumer catching up on #{length(buffer)} transactions" end)
    state = %{state | buffer: [], buffering?: false}
    {:noreply, handle_txns(Enum.reverse(buffer), state), state.hibernate_after}
  end

  @impl GenServer
  def handle_call(:initial_state, _from, %{latest_offset: offset} = state) do
    Logger.debug("Returning latest offset for #{state.shape_handle}: #{inspect(offset)}")

    {:reply, {:ok, offset}, state, state.hibernate_after}
  end

  def handle_call({:monitor, pid}, _from, %{monitors: monitors} = state) do
    ref = make_ref()
    {:reply, ref, %{state | monitors: [{pid, ref} | monitors]}, state.hibernate_after}
  end

  def handle_call(:stop_and_clean, _from, state) do
    {:reply, :ok, terminate_safely(state)}
  end

  def handle_call(:await_snapshot_start, _from, %{snapshot_started: true} = state) do
    {:reply, :started, state, state.hibernate_after}
  end

  def handle_call(:await_snapshot_start, from, %{awaiting_snapshot_start: waiters} = state) do
    Logger.debug("Starting a wait on the snapshot #{state.shape_handle} for #{inspect(from)}}")

    {:noreply, %{state | awaiting_snapshot_start: [from | waiters]}}
  end

  @impl GenServer
  def handle_call({:handle_event, event, trace_context}, _from, state) do
    OpenTelemetry.set_current_context(trace_context)
    {:reply, :ok, handle_event(event, state), state.hibernate_after}
  end

  @impl GenServer
  def handle_call({:subscribe_materializer, pid}, _from, state) do
    Logger.debug("Subscribing materializer for #{state.shape_handle}")
    Process.monitor(pid, tag: :materializer_down)
    {:reply, :ok, %{state | materializer_subscribed?: true}, state.hibernate_after}
  end

  @impl GenServer
  def handle_cast(
        {:pg_snapshot_known, shape_handle, {xmin, xmax, xip_list} = snapshot},
        %{shape_handle: shape_handle} = state
      ) do
    Logger.debug(
      "Snapshot known for shape_handle: #{shape_handle} xmin: #{xmin}, xmax: #{xmax}, xip_list: #{inspect(xip_list)}"
    )

    state = state |> State.set_initial_snapshot(snapshot) |> ensure_xmin_stored()

    {:noreply, state, {:continue, :consume_buffer}}
  end

  def handle_cast({:snapshot_started, shape_handle}, %{shape_handle: shape_handle} = state) do
    Logger.debug("Snapshot started shape_handle: #{shape_handle}")
    state = set_snapshot_started(state)
    {:noreply, state, state.hibernate_after}
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

    state =
      state
      |> reply_to_snapshot_waiters({:error, error})
      |> terminate_safely()

    {:noreply, state}
  end

  def handle_cast({:snapshot_exists, shape_handle}, %{shape_handle: shape_handle} = state) do
    state =
      state
      |> ensure_xmin_stored()
      |> set_snapshot_started()

    {:noreply, state, state.hibernate_after}
  end

  @impl GenServer
  def handle_info(
        {Electric.Shapes.Monitor, :reader_termination, handle, reason},
        %{shape_handle: handle} = state
      ) do
    # Triggered as a result of `Electric.Shapes.Monitor.notify_reader_termination/3`
    # when all readers have terminated.
    {:stop, reason, state}
  end

  def handle_info({ShapeCache.Storage, :flushed, offset}, state) do
    {state, offset} = State.align_offset_to_txn_boundary(state, offset)

    ShapeLogCollector.notify_flushed(state.stack_id, state.shape_handle, offset)
    {:noreply, state, state.hibernate_after}
  end

  def handle_info({ShapeCache.Storage, message}, state) do
    writer = ShapeCache.Storage.apply_message(state.writer, message)
    {:noreply, %{state | writer: writer}, state.hibernate_after}
  end

  def handle_info(
        {:materializer_changes, dep_handle, %{move_in: move_in, move_out: move_out}},
        state
      ) do
    Logger.debug(fn ->
      "Consumer reacting to #{length(move_in)} move ins and #{length(move_out)} move outs in it's #{dep_handle} dependency"
    end)

    {state, notification} =
      state
      |> MoveHandling.process_move_ins(dep_handle, move_in)
      |> MoveHandling.process_move_outs(dep_handle, move_out)

    notify_new_changes(state, notification)

    {:noreply, state}
  end

  def handle_info({:query_move_in_complete, name, key_set}, state) do
    Logger.debug(fn ->
      "Consumer query move in complete for #{name} with #{length(key_set)} keys"
    end)

    {state, notification} = MoveHandling.query_complete(state, name, key_set)
    state = notify_new_changes(state, notification)

    {:noreply, state, {:continue, :consume_buffer}}
  end

  def handle_info({:query_move_in_error, _, error, stacktrace}, state) do
    Logger.error(
      "Error querying move in for #{state.shape_handle}: #{Exception.format(:error, error, stacktrace)}"
    )

    reraise(error, stacktrace)

    # No-op as the raise will crash the process
    {:noreply, terminate_safely(state)}
  end

  def handle_info({:materializer_shape_invalidated, shape_handle}, state) do
    Logger.warning("Materializer shape invalidated for #{shape_handle}")
    {:noreply, terminate_safely(state)}
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
    state = %{state | writer: ShapeCache.Storage.hibernate(state.writer)}

    {:noreply, state, :hibernate}
  end

  @impl GenServer
  def terminate(reason, state) do
    :ok =
      Electric.Shapes.Monitor.handle_writer_termination(
        state.stack_id,
        state.shape_handle,
        reason
      )

    Logger.debug(fn ->
      case reason do
        {error, stacktrace} when is_tuple(error) and is_list(stacktrace) ->
          "Shapes.Consumer terminating with reason: #{Exception.format(:error, error, stacktrace)}"

        other ->
          "Shapes.Consumer terminating with reason: #{inspect(other)}"
      end
    end)

    if not is_nil(state.writer), do: ShapeCache.Storage.terminate(state.writer)

    reply_to_snapshot_waiters(state, {:error, "Shape terminated before snapshot was ready"})
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
    |> reply_to_snapshot_waiters({:error, "Shape relation changed before snapshot was ready"})
    |> terminate_safely()
  end

  defp handle_event(%Transaction{} = txn, state), do: handle_txns([txn], state)

  defp handle_txns(txns, %State{} = state), do: Enum.reduce_while(txns, state, &handle_txn/2)

  defp handle_txn(txn, %State{buffering?: true} = state),
    do: {:cont, State.add_to_buffer(state, txn)}

  defp handle_txn(txn, %State{initial_snapshot_filtering?: true} = state) do
    if Transaction.visible_in_snapshot?(txn, state.initial_pg_snapshot) do
      {:cont, consider_flushed(state, txn)}
    else
      # Stop initial snapshot filtering if we see anything over xmax.
      state = State.maybe_stop_initial_filtering(state, txn)
      handle_txn_or_buffer(txn, state)
    end
  end

  defp handle_txn(txn, state), do: handle_txn_or_buffer(txn, state)

  defp handle_txn_or_buffer(txn, %State{move_in_buffering_snapshot: snapshot} = state) do
    if is_nil(snapshot) or Transaction.visible_in_snapshot?(txn, snapshot) do
      state = State.remove_completed_move_ins(state, txn)
      handle_txn_in_span(txn, state)
    else
      # We can't reason about this change until we get the key set for the move-in,
      # so we start buffering.
      handle_txn(txn, %{state | buffering?: true})
    end
  end

  defp handle_txn_in_span(txn, state) do
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

  defp do_handle_txn(%Transaction{xid: xid, changes: changes} = txn, state) do
    %{
      shape: shape,
      shape_handle: shape_handle,
      writer: writer
    } = state

    Logger.debug(fn -> "Txn received in Shapes.Consumer: #{inspect(txn)}" end)

    extra_refs = Materializer.get_all_as_refs(shape, state.stack_id)

    case filter_changes(changes, shape, {xid, state.filtering_move_ins}, extra_refs) do
      :includes_truncate ->
        # TODO: This is a very naive way to handle truncations: if ANY relevant truncates are
        #       present in the transaction, we're considering the whole transaction empty, and
        #       just rotate the shape handle. "Correct" way to handle truncates is to be designed.
        Logger.warning(
          "Truncate operation encountered while processing txn #{txn.xid} for #{shape_handle}"
        )

        terminate_safely(state)

        {:halt, notify(txn, state)}

      {_, 0, _} ->
        Logger.debug(fn ->
          "No relevant changes found for #{inspect(shape)} in txn #{txn.xid}"
        end)

        {:cont, consider_flushed(state, txn)}

      {changes, num_changes, last_log_offset} ->
        timestamp = System.monotonic_time()

        {lines, total_size} = prepare_log_entries(changes, xid, shape)
        writer = ShapeCache.Storage.append_to_log!(lines, writer)

        OpenTelemetry.add_span_attributes(%{
          num_bytes: total_size,
          actual_num_changes: num_changes
        })

        ShapeCache.ShapeStatus.set_latest_offset(state.stack_id, shape_handle, last_log_offset)

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
         notify(txn, %{
           state
           | writer: writer,
             txn_offset_mapping:
               state.txn_offset_mapping ++ [{last_log_offset, txn.last_log_offset}]
         })}
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

  defp notify_shape_rotation(state) do
    Registry.dispatch(
      Electric.StackSupervisor.registry_name(state.stack_id),
      state.shape_handle,
      fn registered ->
        Logger.debug(fn ->
          "Notifying ~#{length(registered)} clients about removal of shape #{state.shape_handle}"
        end)

        for {pid, ref} <- registered, do: send(pid, {ref, :shape_rotation})
      end
    )

    state
  end

  defp ensure_xmin_stored(%{initial_pg_snapshot: {xmin, _, _}} = state) do
    ShapeCache.ShapeStatus.set_snapshot_xmin(state.stack_id, state.shape_handle, xmin)
    state
  end

  defp set_snapshot_started(%State{stack_id: stack_id, shape_handle: shape_handle} = state) do
    state = State.set_snapshot_started(state)
    :ok = ShapeCache.ShapeStatus.mark_snapshot_started(stack_id, shape_handle)
    reply_to_snapshot_waiters(state, :started)
  end

  # termination and cleanup is now done in stages.
  # 1. register that we want the shape data to be cleaned up.
  # 2. request a notification when all active shape data reads are complete
  # 3. exit the process when we receive that notification
  defp terminate_safely(state, reason \\ {:shutdown, :cleanup})

  defp terminate_safely(%{terminating?: true} = state, _reason) do
    state
  end

  defp terminate_safely(state, reason) do
    %{
      stack_id: stack_id,
      shape_handle: shape_handle
    } = state

    ShapeCache.ShapeStatus.remove_shape(stack_id, shape_handle)
    ShapeLogCollector.remove_shape(stack_id, shape_handle)

    :ok = Electric.Shapes.Monitor.notify_reader_termination(stack_id, shape_handle, reason)

    notify_shape_rotation(%{state | terminating?: true})
  end

  defp reply_to_snapshot_waiters(%{awaiting_snapshot_start: []} = state, _reply) do
    state
  end

  defp reply_to_snapshot_waiters(%{awaiting_snapshot_start: waiters} = state, reply) do
    for client <- List.wrap(waiters), not is_nil(client), do: GenServer.reply(client, reply)
    %{state | awaiting_snapshot_start: []}
  end

  defp notify(_txn, %{monitors: []} = state), do: state

  defp notify(%{xid: xid}, %{monitors: monitors} = state) do
    for {pid, ref} <- monitors, do: send(pid, {__MODULE__, ref, xid})

    state
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
         snapshot_filtering,
         extra_refs,
         change_acc,
         total_ops
       ) do
    if not change_already_visible?(change, snapshot_filtering) do
      # Change either not visible in any snapshot, or touches other keys - we need to add it to the log
      case Shape.convert_change(shape, change, extra_refs) do
        [] ->
          filter_changes(rest, shape, snapshot_filtering, extra_refs, change_acc, total_ops)

        [change] ->
          filter_changes(
            rest,
            shape,
            snapshot_filtering,
            extra_refs,
            [change | change_acc],
            total_ops + 1
          )
      end
    else
      # Already part of some snapshot, applying would duplicate data
      filter_changes(rest, shape, snapshot_filtering, extra_refs, change_acc, total_ops)
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
    case ShapeLogCollector.subscribe(state.stack_id, state.shape_handle, state.shape, action) do
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
    inspector = Electric.StackConfig.lookup(state.stack_id, :inspector)
    Inspector.clean(table_oid, inspector)
  end

  defp handle_materializer_down(reason, state) do
    case {reason, state.terminating?} do
      {_, true} -> {:noreply, state}
      {{:shutdown, _}, false} -> {:stop, reason, state}
      {:shutdown, false} -> {:stop, reason, state}
      _ -> {:noreply, terminate_safely(state)}
    end
  end

  # Deletes can't be visible in a snapshot
  defp change_already_visible?(%Changes.DeletedRecord{}, _), do: false

  defp change_already_visible?(%{key: key}, {xid, filters}) do
    Enum.any?(filters, fn {snapshot, key_set} ->
      Transaction.visible_in_snapshot?(xid, snapshot) and MapSet.member?(key_set, key)
    end)
  end

  if Mix.env() == :test do
    def activate_mocked_functions_from_test_process do
      Support.TestUtils.activate_mocked_functions_for_module(__MODULE__)
    end
  else
    def activate_mocked_functions_from_test_process, do: :noop
  end
end
