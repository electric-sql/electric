defmodule Electric.Shapes.Consumer do
  use GenServer,
    restart: :temporary,
    significant: true

  import Electric.Postgres.Xid, only: [compare: 2]
  import Electric.Replication.LogOffset, only: [is_virtual_offset: 1, last_before_real_offsets: 0]

  alias Electric.Replication.LogOffset
  alias Electric.Shapes.Consumer.Materializer
  alias Electric.LogItems
  alias Electric.Postgres.Inspector
  alias Electric.Replication.Changes
  alias Electric.Replication.Changes.Transaction
  alias Electric.Replication.ShapeLogCollector
  alias Electric.ShapeCache
  alias Electric.Shapes.Consumer.Snapshotter
  alias Electric.Shapes.Shape
  alias Electric.SnapshotError
  alias Electric.Telemetry.OpenTelemetry
  alias Electric.Utils

  require Logger

  def name(%{stack_id: stack_id, shape_handle: shape_handle}) do
    name(stack_id, shape_handle)
  end

  def name(stack_id, shape_handle) when is_binary(shape_handle) do
    Electric.ProcessRegistry.name(stack_id, __MODULE__, shape_handle)
  end

  def initial_state(consumer) do
    GenServer.call(consumer, :initial_state, 30_000)
  end

  def await_snapshot_start(consumer) when is_pid(consumer) do
    GenServer.call(consumer, :await_snapshot_start, 30_000)
  end

  def await_snapshot_start(consumer) do
    GenServer.call(name(consumer), :await_snapshot_start, 30_000)
  end

  def subscribe_materializer(consumer) do
    GenServer.call(name(consumer), :subscribe_materializer)
  end

  @doc false
  # use in tests to avoid race conditions. registers `pid` to be notified
  # when the `shape_handle` consumer has processed every transaction.
  # Transactions that we skip because of xmin logic do not generate
  # a notification
  @spec monitor(String.t(), ShapeCache.shape_handle(), pid()) :: reference()
  def monitor(stack_id, shape_handle, pid \\ self()) do
    GenServer.call(name(stack_id, shape_handle), {:monitor, pid})
  end

  @spec whereis(String.t(), ShapeCache.shape_handle()) :: pid() | nil
  def whereis(stack_id, shape_handle) do
    GenServer.whereis(name(stack_id, shape_handle))
  end

  def start_link(config) when is_map(config) do
    GenServer.start_link(__MODULE__, config, name: name(config))
  end

  @impl GenServer
  def init(config) do
    activate_mocked_functions_from_test_process()

    Process.set_label({:consumer, config.shape_handle})
    Process.flag(:trap_exit, true)

    metadata = [shape_handle: config.shape_handle, stack_id: config.stack_id]
    Logger.metadata(metadata)
    Electric.Telemetry.Sentry.set_tags_context(metadata)

    state =
      Map.merge(config, %{
        snapshot_started: false,
        awaiting_snapshot_start: [],
        buffer: [],
        monitors: [],
        cleaned?: false,
        txn_offset_mapping: [],
        materializer_subscribed?: false,
        # The existing body of consumer tests made it impossible to replace this dynamic
        # setting with a static module alias. But do note that this is only set to anything
        # other than Electric.ShapeCache.ShapeStatus in the test environment.
        shape_status_mod: Map.get(config, :shape_status_mod) || Electric.ShapeCache.ShapeStatus
      })

    {:ok, state, {:continue, :init_storage}}
  end

  @impl GenServer
  def handle_continue(:init_storage, state) do
    %{
      storage: storage,
      shape_status_mod: shape_status_mod
    } = state

    writer =
      ShapeCache.Storage.init_writer!(
        storage,
        state.shape,
        shape_status_mod.consume_shape_storage_state(state.stack_id, state.shape_handle)
      )

    {:ok, latest_offset, pg_snapshot} = ShapeCache.Storage.get_current_position(storage)

    # When writing the snapshot initially, we don't know ahead of time the real last offset for the
    # shape, so we use `0_inf` essentially as a pointer to the end of all possible snapshot chunks,
    # however many there may be. That means the clients will be using that as the latest offset.
    # In order to avoid confusing the clients, we make sure that we preserve that functionality
    # across a restart by setting the latest offset to `0_inf` if there were no real offsets yet.
    normalized_latest_offset =
      if is_virtual_offset(latest_offset), do: last_before_real_offsets(), else: latest_offset

    :ok =
      shape_status_mod.initialise_shape(
        state.stack_id,
        state.shape_handle,
        pg_snapshot[:xmin],
        normalized_latest_offset
      )

    for shape_handle <- state.shape.shape_dependencies_handles do
      # TODO: handle a case when materializer is down
      Process.monitor(Materializer.whereis(state.stack_id, shape_handle),
        tag: {:dependency_materializer_down, shape_handle}
      )

      Materializer.subscribe(state.stack_id, shape_handle)
    end

    ShapeLogCollector.subscribe(state.stack_id, state.shape_handle, state.shape, state.phase)

    Logger.debug("Writer for #{state.shape_handle} initialized")

    Snapshotter.start_snapshot(state.stack_id, state.shape_handle)

    {:noreply,
     Map.merge(state, %{
       latest_offset: normalized_latest_offset,
       writer: writer,
       pg_snapshot: pg_snapshot
     }), state.hibernate_after}
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
  def handle_call(:subscribe_materializer, _from, state) do
    Logger.debug("Subscribing materializer for #{state.shape_handle}")
    {:reply, :ok, %{state | materializer_subscribed?: true}, state.hibernate_after}
  end

  @impl GenServer
  def handle_cast(
        {:pg_snapshot_known, shape_handle, {xmin, xmax, xip_list}},
        %{shape_handle: shape_handle} = state
      ) do
    Logger.debug(
      "Snapshot known for shape_handle: #{shape_handle} xmin: #{xmin}, xmax: #{xmax}, xip_list: #{Enum.join(xip_list, ",")}"
    )

    state =
      %{
        xmin: xmin,
        xmax: xmax,
        xip_list: xip_list,
        filter_txns?: true
      }
      |> set_pg_snapshot(state)

    {:noreply, handle_txns(state.buffer, %{state | buffer: []}), state.hibernate_after}
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
      %{shape: %Shape{root_table_id: root_table_id}, inspector: inspector} = state
      Inspector.clean(root_table_id, inspector)
    end

    state =
      state
      |> reply_to_snapshot_waiters({:error, error})
      |> terminate_safely()

    {:noreply, state}
  end

  def handle_cast({:snapshot_exists, shape_handle}, %{shape_handle: shape_handle} = state) do
    state = set_pg_snapshot(state.pg_snapshot, state)
    state = set_snapshot_started(state)
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
    {state, offset} = align_to_txn_boundary(state, offset)

    ShapeLogCollector.notify_flushed(state.stack_id, state.shape_handle, offset)
    {:noreply, state, state.hibernate_after}
  end

  def handle_info({ShapeCache.Storage, message}, state) do
    writer = ShapeCache.Storage.apply_message(state.writer, message)
    {:noreply, %{state | writer: writer}, state.hibernate_after}
  end

  def handle_info({:materializer_changes, shape_handle, events}, state) do
    Logger.debug("Materializer changes for #{shape_handle}: #{inspect(events)}")
    {:noreply, terminate_safely(state)}
  end

  def handle_info({{:dependency_materializer_down, handle}, _ref, :process, pid, reason}, state) do
    Logger.warning(
      "Materializer down for a dependency: #{handle} (#{inspect(pid)}) (#{inspect(reason)})"
    )

    {:noreply, terminate_safely(state)}
  end

  # We're trapping exists so that `terminate` is called to clean up the writer,
  # otherwise we respect the OTP exit protocol.
  def handle_info({:EXIT, _from, reason}, state) do
    Logger.debug("Caught EXIT: #{inspect(reason)}")
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

    if is_map_key(state, :writer) do
      storage_recovery_state = ShapeCache.Storage.terminate(state.writer)

      if not is_nil(state.shape_status_mod.get_existing_shape(state.stack_id, state.shape_handle)) do
        state.shape_status_mod.set_shape_storage_state(
          state.stack_id,
          state.shape_handle,
          storage_recovery_state
        )
      end
    end

    reply_to_snapshot_waiters(state, {:error, "Shape terminated before snapshot was ready"})
  end

  # Any relation that gets let through by the `ShapeLogCollector` (as coupled with `Shapes.Dispatcher`)
  # is a signal that we need to terminate the shape.
  defp handle_event(%Changes.Relation{}, state) do
    %{shape: %Shape{root_table_id: root_table_id, root_table: root_table}, inspector: inspector} =
      state

    Logger.info(
      "Schema for the table #{Utils.inspect_relation(root_table)} changed - terminating shape #{state.shape_handle}"
    )

    # We clean up the relation info from ETS as it has changed and we want
    # to source the fresh info from postgres for the next shape creation
    Inspector.clean(root_table_id, inspector)

    state
    |> reply_to_snapshot_waiters({:error, "Shape relation changed before snapshot was ready"})
    |> terminate_safely()
  end

  # Buffer incoming transactions until we know our pg_snapshot
  defp handle_event(%Transaction{xid: xid} = txn, %{pg_snapshot: nil} = state) do
    Logger.debug(fn ->
      "Consumer for #{state.shape_handle} buffering 1 transaction with xid #{xid}"
    end)

    %{state | buffer: state.buffer ++ [txn]}
  end

  defp handle_event(%Transaction{} = txn, %{pg_snapshot: %{xmin: xmin, xmax: xmax}} = state) do
    OpenTelemetry.with_child_span(
      "shape_write.consumer.handle_txns",
      [snapshot_xmin: xmin, snapshot_xmax: xmax],
      state.stack_id,
      fn -> handle_txns([txn], state) end
    )
  end

  defp handle_txns(txns, state) do
    Enum.reduce_while(txns, state, &handle_txn/2)
  end

  defp handle_txn(txn, %{pg_snapshot: %{filter_txns?: false}} = state) do
    handle_txn_in_span(txn, state)
  end

  defp handle_txn(
         %Transaction{xid: xid} = txn,
         %{pg_snapshot: %{xmin: xmin, xmax: xmax, xip_list: xip_list}} = state
       ) do
    # xmin is the lowest active transaction ID, there can be txids > xmin that have
    # committed and so would already be included in the shape's data snapshot.
    # For this reason we store the full pg_snapshot and compare the incoming xid not only
    # against xmin but also against xip_list, the list of transactions active at the time of
    # taking the original data snapshot.
    #
    # See Postgres docs for details on the pg_snapshot fields:
    # https://www.postgresql.org/docs/current/functions-info.html#FUNCTIONS-PG-SNAPSHOT-PARTS
    cond do
      compare(xid, xmin) == :lt ->
        # Transaction already included in the shape snapshot because it had committed before
        # the snapshot transaction started.
        {:cont, consider_flushed(state, txn)}

      compare(xid, xmax) == :lt and xid not in xip_list ->
        # Transaction commited sometime between xmin and the start of the snapshot transaction.
        {:cont, consider_flushed(state, txn)}

      compare(xid, xmin) == :eq or xid in xip_list ->
        # Transaction was active at the time of taking the snapshot so its effects weren't
        # visible to the snapshot transaction.
        handle_txn_in_span(txn, state)

      compare(xid, xmax) != :lt ->
        # The first transaction received from the replication stream whose xid >= xmax.
        #
        # From now on the only kinds of transactions coming in from the replication stream will
        # be either those active at the time of taking the snapshot or those commited after the
        # snapshot transaction had started. Both kinds need to be appended to the shape log.
        #
        # At this point we can disable transaction filtering on the snapshot to avoid further
        # xid comparisons.
        state = stop_filtering_txns(state)
        handle_txn_in_span(txn, state)
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

    case filter_changes(changes, shape, extra_refs) do
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

        state.shape_status_mod.set_latest_offset(state.stack_id, shape_handle, last_log_offset)

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

  defp notify_new_changes(state, changes, latest_log_offset) do
    if state.materializer_subscribed? do
      Materializer.new_changes(Map.take(state, [:stack_id, :shape_handle]), changes)
    end

    Registry.dispatch(state.registry, state.shape_handle, fn registered ->
      Logger.debug(fn ->
        "Notifying ~#{length(registered)} clients about new changes to #{state.shape_handle}"
      end)

      for {pid, ref} <- registered,
          do: send(pid, {ref, :new_changes, latest_log_offset})
    end)

    state
  end

  defp notify_shape_rotation(state) do
    Registry.dispatch(state.registry, state.shape_handle, fn registered ->
      Logger.debug(fn ->
        "Notifying ~#{length(registered)} clients about removal of shape #{state.shape_handle}"
      end)

      for {pid, ref} <- registered, do: send(pid, {ref, :shape_rotation})
    end)

    state
  end

  defp set_pg_snapshot(pg_snapshot, %{pg_snapshot: nil} = state) when not is_nil(pg_snapshot) do
    ShapeCache.Storage.set_pg_snapshot(pg_snapshot, state.storage)
    set_pg_snapshot(pg_snapshot, %{state | pg_snapshot: pg_snapshot})
  end

  defp set_pg_snapshot(
         %{xmin: xmin},
         %{
           pg_snapshot: %{xmin: xmin},
           shape_handle: shape_handle,
           shape_status_mod: shape_status_mod
         } = state
       ) do
    unless shape_status_mod.set_snapshot_xmin(state.stack_id, shape_handle, xmin),
      do:
        Logger.warning(
          "Got snapshot information for a #{shape_handle}, that shape id is no longer valid. Ignoring."
        )

    state
  end

  defp set_snapshot_started(%{snapshot_started: false} = state) do
    ShapeCache.Storage.mark_snapshot_as_started(state.storage)
    set_snapshot_started(%{state | snapshot_started: true})
  end

  defp set_snapshot_started(
         %{shape_handle: shape_handle, shape_status_mod: shape_status_mod} = state
       ) do
    :ok = shape_status_mod.mark_snapshot_started(state.stack_id, shape_handle)
    reply_to_snapshot_waiters(state, :started)
  end

  defp stop_filtering_txns(state) do
    pg_snapshot = Map.put(state.pg_snapshot, :filter_txns?, false)
    ShapeCache.Storage.set_pg_snapshot(pg_snapshot, state.storage)
    %{state | pg_snapshot: pg_snapshot}
  end

  # termination and cleanup is now done in stages.
  # 1. register that we want the shape data to be cleaned up.
  # 2. request a notification when all active shape data reads are complete
  # 3. exit the process when we receive that notification
  defp terminate_safely(state, reason \\ {:shutdown, :cleanup}) do
    %{
      stack_id: stack_id,
      shape_handle: shape_handle,
      shape_status_mod: shape_status_mod
    } = state

    shape_status_mod.remove_shape(stack_id, shape_handle)

    :ok = Electric.Shapes.Monitor.notify_reader_termination(stack_id, shape_handle, reason)

    notify_shape_rotation(state)
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
  defp filter_changes(changes, shape, extra_refs, change_acc \\ [], total_ops_acc \\ 0)
  defp filter_changes([], _shape, _, [], 0), do: {[], 0, nil}

  defp filter_changes([], _shape, _, [change | rest], total_ops),
    do:
      {Enum.reverse([%{change | last?: true} | rest]), total_ops,
       LogItems.expected_offset_after_split(change)}

  defp filter_changes([%Changes.TruncatedRelation{} | _], _, _, _, _),
    do: :includes_truncate

  defp filter_changes([change | rest], shape, extra_refs, change_acc, total_ops) do
    case Shape.convert_change(shape, change, extra_refs) do
      [] -> filter_changes(rest, shape, extra_refs, change_acc, total_ops)
      [change] -> filter_changes(rest, shape, extra_refs, [change | change_acc], total_ops + 1)
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

  defp align_to_txn_boundary(%{txn_offset_mapping: txn_offset_mapping} = state, offset) do
    case Enum.drop_while(txn_offset_mapping, &(LogOffset.compare(elem(&1, 0), offset) == :lt)) do
      [{^offset, boundary} | rest] ->
        {%{state | txn_offset_mapping: rest}, boundary}

      rest ->
        {%{state | txn_offset_mapping: rest}, offset}
    end
  end

  defp consider_flushed(state, %Transaction{last_log_offset: new_boundary}) do
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

  if Mix.env() == :test do
    def activate_mocked_functions_from_test_process do
      Support.TestUtils.activate_mocked_functions_for_module(__MODULE__)
    end
  else
    def activate_mocked_functions_from_test_process, do: :noop
  end
end
