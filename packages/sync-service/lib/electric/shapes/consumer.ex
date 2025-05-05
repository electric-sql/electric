defmodule Electric.Shapes.Consumer do
  use GenStage,
    restart: :temporary,
    significant: true

  import Electric.Postgres.Xid, only: [compare: 2]
  import Electric.Replication.LogOffset, only: [is_virtual_offset: 1, last_before_real_offsets: 0]

  alias Electric.LogItems
  alias Electric.Postgres.Inspector
  alias Electric.Replication.Changes
  alias Electric.Replication.Changes.Transaction
  alias Electric.Replication.LogOffset
  alias Electric.ShapeCache
  alias Electric.ShapeCache.LogChunker
  alias Electric.Shapes.Api
  alias Electric.Shapes.ConsumerSupervisor
  alias Electric.Shapes.Shape
  alias Electric.Telemetry.OpenTelemetry
  alias Electric.Utils

  require Logger

  @initial_log_state %{current_chunk_byte_size: 0, current_txn_bytes: 0}
  @type log_state :: %{
          current_chunk_byte_size: non_neg_integer(),
          current_txn_bytes: non_neg_integer()
        }

  def name(%{
        stack_id: stack_id,
        shape_handle: shape_handle
      }) do
    name(stack_id, shape_handle)
  end

  def name(stack_id, shape_handle) when is_binary(shape_handle) do
    Electric.ProcessRegistry.name(stack_id, __MODULE__, shape_handle)
  end

  def initial_state(consumer) do
    GenStage.call(consumer, :initial_state, 30_000)
  end

  @doc false
  # use in tests to avoid race conditions. registers `pid` to be notified
  # when the `shape_handle` consumer has processed every transaction.
  # Transactions that we skip because of xmin logic do not generate
  # a notification
  @spec monitor(String.t(), ShapeCache.shape_handle(), pid()) :: reference()
  def monitor(stack_id, shape_handle, pid \\ self()) do
    GenStage.call(name(stack_id, shape_handle), {:monitor, pid})
  end

  @spec whereis(String.t(), ShapeCache.shape_handle()) :: pid() | nil
  def whereis(stack_id, shape_handle) do
    GenServer.whereis(name(stack_id, shape_handle))
  end

  def start_link(config) when is_map(config) do
    GenStage.start_link(__MODULE__, config,
      name: name(config),
      hibernate_after: Electric.Config.get_env(:shape_hibernate_after)
    )
  end

  @impl GenStage

  def init(config) do
    Process.set_label({:consumer, config.shape_handle})

    %{
      log_producer: producer,
      storage: storage,
      shape_status: {shape_status, shape_status_state}
    } = config

    metadata = [shape_handle: config.shape_handle, stack_id: config.stack_id]
    Logger.metadata(metadata)
    Electric.Telemetry.Sentry.set_tags_context(metadata)

    :ok = ShapeCache.Storage.initialise(storage)

    # Store the shape definition to ensure we can restore it
    :ok = ShapeCache.Storage.set_shape_definition(config.shape, storage)

    {:ok, latest_offset, pg_snapshot} = ShapeCache.Storage.get_current_position(storage)

    # When writing the snapshot initially, we don't know ahead of time the real last offset for the
    # shape, so we use `0_inf` essentially as a pointer to the end of all possible snapshot chunks,
    # however many there may be. That means the clients will be using that as the latest offset.
    # In order to avoid confusing the clients, we make sure that we preserve that functionality
    # across a restart by setting the latest offset to `0_inf` if there were no real offsets yet.
    normalized_latest_offset =
      if is_virtual_offset(latest_offset), do: last_before_real_offsets(), else: latest_offset

    :ok =
      shape_status.initialise_shape(
        shape_status_state,
        config.shape_handle,
        pg_snapshot[:xmin],
        normalized_latest_offset
      )

    state =
      Map.merge(config, %{
        latest_offset: normalized_latest_offset,
        pg_snapshot: pg_snapshot,
        log_state: @initial_log_state,
        inspector: config.inspector,
        snapshot_started: false,
        awaiting_snapshot_start: [],
        buffer: [],
        monitors: [],
        cleaned?: false
      })

    :ok = Electric.Shapes.Monitor.register_writer(config.stack_id, config.shape_handle)

    {:consumer, state, subscribe_to: [{producer, [max_demand: 1, shape: config.shape]}]}
  end

  @impl GenStage
  def handle_call(:initial_state, _from, %{latest_offset: offset} = state) do
    {:reply, {:ok, offset}, [], state}
  end

  def handle_call({:monitor, pid}, _from, %{monitors: monitors} = state) do
    ref = make_ref()
    {:reply, ref, [], %{state | monitors: [{pid, ref} | monitors]}}
  end

  def handle_call(:clean_and_stop, _from, state) do
    # Waiter will receive this response if the snapshot wasn't done yet, but
    # given that this is definitely a cleanup call, a 409 is appropriate
    # as old shape handle is no longer valid

    state =
      state
      |> reply_to_snapshot_waiters({:error, Api.Error.must_refetch()})
      |> cleanup()

    {:reply, :ok, [], state}
  end

  def handle_call(:await_snapshot_start, _from, %{snapshot_started: true} = state) do
    {:reply, :started, [], state}
  end

  def handle_call(:await_snapshot_start, from, %{awaiting_snapshot_start: waiters} = state) do
    Logger.debug("Starting a wait on the snapshot #{state.shape_handle} for #{inspect(from)}}")

    {:noreply, [], %{state | awaiting_snapshot_start: [from | waiters]}}
  end

  @impl GenStage
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

    handle_txns(state.buffer, %{state | buffer: []})
  end

  def handle_cast({:snapshot_started, shape_handle}, %{shape_handle: shape_handle} = state) do
    Logger.debug("Snapshot started shape_handle: #{shape_handle}")
    state = set_snapshot_started(state)
    {:noreply, [], state}
  end

  def handle_cast(
        {:snapshot_failed, shape_handle, error, stacktrace},
        %{shape_handle: shape_handle} = state
      ) do
    error =
      case error do
        %DBConnection.ConnectionError{reason: :queue_timeout} ->
          Logger.warning(
            "Snapshot creation failed for #{shape_handle} because of a connection pool queue timeout"
          )

          error

        %Postgrex.Error{postgres: %{code: code}}
        when code in ~w|undefined_function undefined_table undefined_column|a ->
          # Schema changed while we were creating stuff, which means shape is functionally invalid.
          # Return a 409 to trigger a fresh start with validation against the new schema.
          %{shape: %Shape{root_table_id: root_table_id}, inspector: inspector} = state
          Inspector.clean(root_table_id, inspector)
          Api.Error.must_refetch()

        error ->
          Logger.error(
            "Snapshot creation failed for #{shape_handle} because of:\n#{Exception.format(:error, error, stacktrace)}"
          )

          error
      end

    state =
      state
      |> reply_to_snapshot_waiters({:error, error})
      |> cleanup()

    {:noreply, [], state}
  end

  def handle_cast({:snapshot_exists, shape_handle}, %{shape_handle: shape_handle} = state) do
    state = set_pg_snapshot(state.pg_snapshot, state)
    state = set_snapshot_started(state)
    {:noreply, [], state}
  end

  @impl GenStage
  def handle_info(
        {Electric.Shapes.Monitor, :reader_termination, handle, reason},
        %{shape_handle: handle} = state
      ) do
    # Triggered as a result of `Electric.Shapes.Monitor.notify_reader_termination/3`
    # when all readers have terminated.
    # By the time we reach here, all the work cleaning the shape is either done
    # or will be done once this process (and its owning supervisor), have
    # terminated. This message just tells us that we're safe to shutdown
    # without crashing readers.
    {:stop, reason, state}
  end

  @impl GenStage
  def terminate(reason, state) do
    Logger.debug("Shapes.Consumer terminating with reason: #{inspect(reason)}")

    state =
      reply_to_snapshot_waiters(state, {:error, "Shape terminated before snapshot was ready"})

    if is_error?(reason) do
      remove_shape(state)
    end

    state
  end

  defp is_error?(:normal), do: false
  defp is_error?(:killed), do: false
  defp is_error?(:shutdown), do: false
  defp is_error?({:shutdown, _}), do: false
  defp is_error?(_), do: true

  # `Shapes.Dispatcher` only works with single-events, so we can safely assert
  # that here
  @impl GenStage
  def handle_events([{event, trace_context}], _from, state) do
    OpenTelemetry.set_current_context(trace_context)
    handle_event(event, state)
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

    state =
      state
      |> reply_to_snapshot_waiters({:error, "Shape relation changed before snapshot was ready"})
      |> cleanup()

    {:noreply, [], state}
  end

  # Buffer incoming transactions until we know our pg_snapshot
  defp handle_event(%Transaction{xid: xid} = txn, %{pg_snapshot: nil} = state) do
    Logger.debug(fn ->
      "Consumer for #{state.shape_handle} buffering 1 transaction with xid #{xid}"
    end)

    {:noreply, [], %{state | buffer: state.buffer ++ [txn]}}
  end

  defp handle_event(%Transaction{} = txn, %{pg_snapshot: %{xmin: xmin, xmax: xmax}} = state) do
    OpenTelemetry.with_span(
      "shape_write.consumer.handle_txns",
      [snapshot_xmin: xmin, snapshot_xmax: xmax],
      state.stack_id,
      fn -> handle_txns([txn], state) end
    )
  end

  defp handle_txns(txns, state) do
    state = Enum.reduce_while(txns, state, &handle_txn/2)
    {:noreply, [], state}
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
        {:cont, state}

      compare(xid, xmax) == :lt and xid not in xip_list ->
        # Transaction commited sometime between xmin and the start of the snapshot transaction.
        {:cont, state}

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

    OpenTelemetry.with_span("shape_write.consumer.handle_txn", ot_attrs, state.stack_id, fn ->
      do_handle_txn(txn, state)
    end)
  end

  defp do_handle_txn(%Transaction{} = txn, state) do
    %{
      shape: shape,
      shape_handle: shape_handle,
      log_state: log_state,
      chunk_bytes_threshold: chunk_bytes_threshold,
      shape_status: {shape_status, shape_status_state},
      storage: storage
    } = state

    Logger.debug(fn -> "Txn received in Shapes.Consumer: #{inspect(txn)}" end)

    %{xid: xid, changes: changes, lsn: _lsn} = txn

    {relevant_changes, {num_changes, has_truncate?}} =
      Enum.flat_map_reduce(changes, {0, false}, fn
        %Changes.TruncatedRelation{}, _ ->
          {:halt, {0, true}}

        change, {ops, false} ->
          case Shape.convert_change(shape, change) do
            [] -> {[], {ops, false}}
            [change] -> {[change], {ops + 1, false}}
          end
      end)

    cond do
      has_truncate? ->
        # TODO: This is a very naive way to handle truncations: if ANY relevant truncates are
        #       present in the transaction, we're considering the whole transaction empty, and
        #       just rotate the shape handle. "Correct" way to handle truncates is to be designed.
        Logger.warning(
          "Truncate operation encountered while processing txn #{txn.xid} for #{shape_handle}"
        )

        cleanup(state, {:shutdown, :truncate})

        {:halt, notify(txn, %{state | log_state: @initial_log_state})}

      num_changes > 0 ->
        {log_entries, new_log_state, last_log_offset} =
          prepare_log_entries(relevant_changes, xid, shape, log_state, chunk_bytes_threshold)

        timestamp = System.monotonic_time()

        # TODO: what's a graceful way to handle failure to append to log?
        #       Right now we'll just fail everything
        :ok = ShapeCache.Storage.append_to_log!(log_entries, storage)

        OpenTelemetry.add_span_attributes(%{
          num_bytes: new_log_state.current_txn_bytes,
          actual_num_changes: num_changes
        })

        shape_status.set_latest_offset(shape_status_state, shape_handle, last_log_offset)

        notify_new_changes(state, last_log_offset)

        lag = calculate_replication_lag(txn)
        OpenTelemetry.add_span_attributes(replication_lag: lag)

        :telemetry.execute(
          [:electric, :storage, :transaction_stored],
          %{
            duration: System.monotonic_time() - timestamp,
            bytes: new_log_state.current_txn_bytes,
            count: 1,
            operations: num_changes,
            replication_lag: lag
          },
          Map.new(shape_attrs(state.shape_handle, state.shape))
        )

        {:cont, notify(txn, %{state | log_state: new_log_state})}

      true ->
        Logger.debug(fn ->
          "No relevant changes found for #{inspect(shape)} in txn #{txn.xid}"
        end)

        {:cont, state}
    end
  end

  defp notify_new_changes(state, latest_log_offset) do
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

  defp set_pg_snapshot(pg_snapshot, %{pg_snapshot: nil} = state) do
    ShapeCache.Storage.set_pg_snapshot(pg_snapshot, state.storage)
    set_pg_snapshot(pg_snapshot, %{state | pg_snapshot: pg_snapshot})
  end

  defp set_pg_snapshot(
         %{xmin: xmin},
         %{pg_snapshot: %{xmin: xmin}, shape_handle: shape_handle} = state
       ) do
    %{shape_status: {shape_status, shape_status_state}} = state

    unless shape_status.set_snapshot_xmin(shape_status_state, shape_handle, xmin),
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

  defp set_snapshot_started(%{shape_handle: shape_handle} = state) do
    %{shape_status: {shape_status, shape_status_state}} = state
    :ok = shape_status.mark_snapshot_started(shape_status_state, shape_handle)
    reply_to_snapshot_waiters(state, :started)
  end

  defp stop_filtering_txns(state) do
    pg_snapshot = Map.put(state.pg_snapshot, :filter_txns?, false)
    ShapeCache.Storage.set_pg_snapshot(pg_snapshot, state.storage)
    %{state | pg_snapshot: pg_snapshot}
  end

  # cleanup is now done in stages.
  # 1. register that we want the shape data to be cleaned up.
  # 2. request a notification when all active shape data reads are complete
  # 3. exit the process when we receive that notification
  defp cleanup(state, reason \\ :normal) do
    %{
      stack_id: stack_id,
      shape_handle: shape_handle
    } = state

    state =
      state
      |> remove_shape()
      |> notify_shape_rotation()

    :ok = Electric.Shapes.Monitor.notify_reader_termination(stack_id, shape_handle, reason)

    state
  end

  defp remove_shape(%{cleaned?: true} = state) do
    state
  end

  defp remove_shape(state) do
    %{
      stack_id: stack_id,
      shape_handle: shape_handle,
      shape_status: {shape_status, shape_status_state},
      publication_manager: {publication_manager, publication_manager_opts}
    } = state

    # do this early to remove the shape from the api asap
    shape_status.remove_shape(shape_status_state, shape_handle)

    # Trigger shape data cleanup after the consumer processes have terminated
    # including the storage process
    :ok =
      Electric.Shapes.Monitor.cleanup_after_termination(
        stack_id,
        shape_handle,
        ConsumerSupervisor.whereis(stack_id, shape_handle)
      )

    publication_manager.remove_shape(state.shape, publication_manager_opts)

    %{state | cleaned?: true}
  end

  defp reply_to_snapshot_waiters(%{awaiting_snapshot_start: []} = state, _reply) do
    state
  end

  defp reply_to_snapshot_waiters(%{awaiting_snapshot_start: waiters} = state, reply) do
    for client <- List.wrap(waiters), not is_nil(client), do: GenStage.reply(client, reply)
    %{state | awaiting_snapshot_start: []}
  end

  defp notify(_txn, %{monitors: []} = state), do: state

  defp notify(%{xid: xid}, %{monitors: monitors} = state) do
    for {pid, ref} <- monitors, do: send(pid, {__MODULE__, ref, xid})

    state
  end

  @spec prepare_log_entries(
          Enumerable.t(Electric.Replication.Changes.data_change()),
          non_neg_integer() | nil,
          Shape.t(),
          log_state(),
          non_neg_integer()
        ) :: {Enumerable.t(ShapeCache.Storage.log_item()), log_state(), LogOffset.t()}
  defp prepare_log_entries(
         changes,
         xid,
         shape,
         log_state,
         chunk_bytes_threshold
       ) do
    log_state = %{
      current_chunk_byte_size: log_state.current_chunk_byte_size,
      current_txn_bytes: 0,
      last_log_offset: LogOffset.before_all()
    }

    {log_items, new_log_state} =
      changes
      |> Stream.flat_map(
        &LogItems.from_change(&1, xid, Shape.pk(shape, &1.relation), shape.replica)
      )
      |> Utils.flat_map_reduce_mark_last(log_state, fn {offset, log_item},
                                                       last?,
                                                       %{
                                                         current_chunk_byte_size: chunk_size,
                                                         current_txn_bytes: txn_bytes
                                                       } = state ->
        json_log_item =
          if(last?, do: put_in(log_item, [:headers, :last], true), else: log_item)
          |> Jason.encode!()

        item_byte_size = byte_size(json_log_item)

        state = %{state | current_txn_bytes: txn_bytes + item_byte_size, last_log_offset: offset}
        line_tuple = {offset, log_item.key, log_item.headers.operation, json_log_item}

        case LogChunker.fit_into_chunk(item_byte_size, chunk_size, chunk_bytes_threshold) do
          {:ok, new_chunk_size} ->
            {[line_tuple], %{state | current_chunk_byte_size: new_chunk_size}}

          {:threshold_exceeded, new_chunk_size} ->
            {
              [line_tuple, {:chunk_boundary, offset}],
              %{state | current_chunk_byte_size: new_chunk_size}
            }
        end
      end)

    {last_log_offset, new_log_state} = Map.pop!(new_log_state, :last_log_offset)

    {log_items, new_log_state, last_log_offset}
  end

  defp shape_attrs(shape_handle, shape) do
    [
      "shape.handle": shape_handle,
      "shape.root_table": shape.root_table,
      "shape.where": shape.where
    ]
  end

  defp calculate_replication_lag(%Transaction{commit_timestamp: commit_timestamp}) do
    # Compute time elapsed since commit
    # since we are comparing PG's clock with our own
    # there may be a slight skew so we make sure not to report negative lag.
    # Since the lag is only useful when it becomes significant, a slight skew doesn't matter.
    now = DateTime.utc_now()
    Kernel.max(0, DateTime.diff(now, commit_timestamp, :millisecond))
  end
end
