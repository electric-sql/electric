defmodule Electric.Shapes.Consumer do
  use GenStage,
    restart: :temporary,
    significant: true

  alias Electric.LogItems
  alias Electric.Postgres.Inspector
  alias Electric.Replication.Changes
  alias Electric.Replication.Changes.Transaction
  alias Electric.ShapeCache
  alias Electric.ShapeCache.LogChunker
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
    GenStage.start_link(__MODULE__, config, name: name(config))
  end

  def init(config) do
    Process.set_label({:consumer, config.shape_handle})

    %{log_producer: producer, storage: storage, shape_status: {shape_status, shape_status_state}} =
      config

    metadata = [shape_handle: config.shape_handle, stack_id: config.stack_id]
    Logger.metadata(metadata)
    Electric.Telemetry.Sentry.set_tags_context(metadata)

    :ok = ShapeCache.Storage.initialise(storage)

    # Store the shape definition to ensure we can restore it
    :ok = ShapeCache.Storage.set_shape_definition(config.shape, storage)

    {:ok, latest_offset, snapshot_xmin} = ShapeCache.Storage.get_current_position(storage)

    :ok =
      shape_status.initialise_shape(
        shape_status_state,
        config.shape_handle,
        snapshot_xmin,
        latest_offset
      )

    state =
      Map.merge(config, %{
        latest_offset: latest_offset,
        snapshot_xmin: snapshot_xmin,
        log_state: @initial_log_state,
        inspector: config.inspector,
        snapshot_started: false,
        awaiting_snapshot_start: [],
        buffer: [],
        monitors: []
      })

    {:consumer, state, subscribe_to: [{producer, [max_demand: 1, shape: config.shape]}]}
  end

  def handle_call(:initial_state, _from, %{snapshot_xmin: xmin, latest_offset: offset} = state) do
    {:reply, {:ok, xmin, offset}, [], state}
  end

  def handle_call({:monitor, pid}, _from, %{monitors: monitors} = state) do
    ref = make_ref()
    {:reply, ref, [], %{state | monitors: [{pid, ref} | monitors]}}
  end

  def handle_call(:clean_and_stop, _from, state) do
    state =
      reply_to_snapshot_waiters({:error, "Shape terminated before snapshot completed"}, state)

    # TODO: ensure cleanup occurs after snapshot is done/failed/interrupted to avoid
    # any race conditions and leftover data
    cleanup(state)
    {:stop, :normal, :ok, state}
  end

  def handle_call(:await_snapshot_start, _from, %{snapshot_started: true} = state) do
    {:reply, :started, [], state}
  end

  def handle_call(:await_snapshot_start, from, %{awaiting_snapshot_start: waiters} = state) do
    Logger.debug("Starting a wait on the snapshot #{state.shape_handle} for #{inspect(from)}}")

    {:noreply, [], %{state | awaiting_snapshot_start: [from | waiters]}}
  end

  def handle_cast(
        {:snapshot_xmin_known, shape_handle, xmin},
        %{shape_handle: shape_handle} = state
      ) do
    Logger.debug("Snapshot xmin known shape_handle: #{shape_handle} xmin: #{xmin}")
    state = set_snapshot_xmin(xmin, state)
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
    if match?(%DBConnection.ConnectionError{reason: :queue_timeout}, error),
      do:
        Logger.warning(
          "Snapshot creation failed for #{shape_handle} because of a connection pool queue timeout"
        ),
      else:
        Logger.error(
          "Snapshot creation failed for #{shape_handle} because of:\n#{Exception.format(:error, error, stacktrace)}"
        )

    state = reply_to_snapshot_waiters({:error, error}, state)
    cleanup(state)
    {:stop, :normal, state}
  end

  def handle_cast({:snapshot_exists, shape_handle}, %{shape_handle: shape_handle} = state) do
    state = set_snapshot_xmin(state.snapshot_xmin, state)
    state = set_snapshot_started(state)
    {:noreply, [], state}
  end

  def terminate(reason, state) do
    state =
      reply_to_snapshot_waiters({:error, "Shape terminated before snapshot was ready"}, state)

    if is_error?(reason) do
      cleanup(state)
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
  def handle_events([%Changes.Relation{} = relation], _from, state) do
    %{shape: %{root_table: root_table} = shape, inspector: inspector} = state

    # we now recelve relation messages from partitions, as well as ones
    # affecting our root table so we need to be clear what we're getting -- if
    # the relation message refers to our root table then we need to drop the
    # shape as something has changed. if the relation is a new partition, so
    # it's parent is our root table, then we need to just add that partition to
    # our shape so txns from the new partition are properly mapped to our root
    # table.
    if relation.id == shape.root_table_id do
      Logger.info(
        "Schema for the table #{Utils.inspect_relation(root_table)} changed - terminating shape #{state.shape_handle}"
      )

      # We clean up the relation info from ETS as it has changed and we want
      # to source the fresh info from postgres for the next shape creation
      Inspector.clean(root_table, inspector)

      state =
        reply_to_snapshot_waiters(
          {:error, "Shape relation changed before snapshot was ready"},
          state
        )

      cleanup(state)

      {:stop, :normal, state}
    else
      # if we're receiving this relation message but the relation doesn't refer
      # to the root table for the shape, then it **must** be because of the addition of a partition
      # to the root table

      {:ok, %{parent: ^root_table, relation: table}} =
        Inspector.load_relation({relation.schema, relation.table}, inspector)

      # a new partition has been added
      Logger.info(
        "New partition #{Utils.inspect_relation(table)} for table #{Utils.inspect_relation(root_table)}"
      )

      shape = Shape.add_partition(shape, root_table, table)

      {:noreply, [], %{state | shape: shape}}
    end
  end

  # Buffer incoming transactions until we know our xmin
  def handle_events([%Transaction{xid: xid}] = txns, _from, %{snapshot_xmin: nil} = state) do
    Logger.debug(fn ->
      "Consumer for #{state.shape_handle} buffering 1 transaction with xid #{xid}"
    end)

    {:noreply, [], %{state | buffer: state.buffer ++ txns}}
  end

  def handle_events([%Transaction{}] = txns, _from, state) do
    OpenTelemetry.with_span(
      "shape_write.consumer.handle_txns",
      [snapshot_xmin: state.snapshot_xmin],
      state.stack_id,
      fn -> handle_txns(txns, state) end
    )
  end

  defp handle_txns(txns, state) do
    case Enum.reduce_while(txns, state, &handle_txn/2) do
      {:truncate, state} ->
        {:stop, {:shutdown, :truncate}, state}

      state ->
        {:noreply, [], state}
    end
  end

  defp handle_txn(%Transaction{xid: xid}, %{snapshot_xmin: xmin} = state) when xid < xmin do
    {:cont, state}
  end

  defp handle_txn(%Transaction{} = txn, state) do
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
      shape_cache: {shape_cache, shape_cache_opts},
      registry: registry,
      storage: storage
    } = state

    Logger.debug(fn -> "Txn received in Shapes.Consumer: #{inspect(txn)}" end)

    %{xid: xid, changes: changes, lsn: _lsn, last_log_offset: last_log_offset} = txn

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

        cleanup(state)

        {:halt, {:truncate, notify(txn, %{state | log_state: @initial_log_state})}}

      num_changes > 0 ->
        {log_entries, new_log_state} =
          prepare_log_entries(relevant_changes, xid, shape, log_state, chunk_bytes_threshold)

        timestamp = System.monotonic_time()

        # TODO: what's a graceful way to handle failure to append to log?
        #       Right now we'll just fail everything
        :ok = ShapeCache.Storage.append_to_log!(log_entries, storage)

        OpenTelemetry.add_span_attributes(%{
          num_bytes: new_log_state.current_txn_bytes,
          actual_num_changes: num_changes
        })

        :telemetry.execute(
          [:electric, :storage, :transaction_stored],
          %{
            duration: System.monotonic_time() - timestamp,
            bytes: new_log_state.current_txn_bytes,
            count: 1,
            operations: num_changes
          },
          Map.new(shape_attrs(state.shape_handle, state.shape))
        )

        shape_cache.update_shape_latest_offset(shape_handle, last_log_offset, shape_cache_opts)

        notify_listeners(registry, :new_changes, shape_handle, last_log_offset)

        report_replication_lag(txn)

        {:cont, notify(txn, %{state | log_state: new_log_state})}

      true ->
        Logger.debug(fn ->
          "No relevant changes found for #{inspect(shape)} in txn #{txn.xid}"
        end)

        {:cont, state}
    end
  end

  defp notify_listeners(registry, :new_changes, shape_handle, latest_log_offset) do
    Registry.dispatch(registry, shape_handle, fn registered ->
      Logger.debug(fn ->
        "Notifying ~#{length(registered)} clients about new changes to #{shape_handle}"
      end)

      for {pid, ref} <- registered,
          do: send(pid, {ref, :new_changes, latest_log_offset})
    end)
  end

  defp set_snapshot_xmin(xmin, %{snapshot_xmin: nil} = state) do
    ShapeCache.Storage.set_snapshot_xmin(xmin, state.storage)
    set_snapshot_xmin(xmin, %{state | snapshot_xmin: xmin})
  end

  defp set_snapshot_xmin(xmin, %{snapshot_xmin: xmin, shape_handle: shape_handle} = state) do
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
    reply_to_snapshot_waiters(:started, state)
  end

  defp cleanup(state) do
    %{
      shape_status: {shape_status, shape_status_state},
      publication_manager: {publication_manager, publication_manager_opts}
    } = state

    shape_status.remove_shape(shape_status_state, state.shape_handle)
    publication_manager.remove_shape(state.shape, publication_manager_opts)
    ShapeCache.Storage.cleanup!(state.storage)
  end

  defp reply_to_snapshot_waiters(_reply, %{awaiting_snapshot_start: []} = state) do
    state
  end

  defp reply_to_snapshot_waiters(reply, %{awaiting_snapshot_start: waiters} = state) do
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
        ) :: {Enumerable.t(ShapeCache.Storage.log_item()), log_state()}
  defp prepare_log_entries(
         changes,
         xid,
         shape,
         log_state,
         chunk_bytes_threshold
       ) do
    log_state = %{
      current_chunk_byte_size: log_state.current_chunk_byte_size,
      current_txn_bytes: 0
    }

    {log_items, new_log_state} =
      changes
      |> Stream.flat_map(
        &LogItems.from_change(&1, xid, Shape.pk(shape, &1.relation), shape.replica)
      )
      |> Enum.flat_map_reduce(log_state, fn log_item,
                                            %{
                                              current_chunk_byte_size: chunk_size,
                                              current_txn_bytes: txn_bytes
                                            } = state ->
        json_log_item = Jason.encode!(log_item)
        item_byte_size = byte_size(json_log_item)

        state = %{state | current_txn_bytes: txn_bytes + item_byte_size}

        case LogChunker.fit_into_chunk(item_byte_size, chunk_size, chunk_bytes_threshold) do
          {:ok, new_chunk_size} ->
            {[{log_item.offset, json_log_item}],
             %{state | current_chunk_byte_size: new_chunk_size}}

          {:threshold_exceeded, new_chunk_size} ->
            {
              [{log_item.offset, json_log_item}, {:chunk_boundary, log_item.offset}],
              %{state | current_chunk_byte_size: new_chunk_size}
            }
        end
      end)

    {log_items, new_log_state}
  end

  defp shape_attrs(shape_handle, shape) do
    [
      "shape.handle": shape_handle,
      "shape.root_table": shape.root_table,
      "shape.where": shape.where
    ]
  end

  defp report_replication_lag(%Transaction{commit_timestamp: commit_timestamp}) do
    # Compute time elapsed since commit
    # since we are comparing PG's clock with our own
    # there may be a slight skew so we make sure not to report negative lag.
    # Since the lag is only useful when it becomes significant, a slight skew doesn't matter.
    now = DateTime.utc_now()
    lag = Kernel.max(0, DateTime.diff(now, commit_timestamp, :millisecond))

    OpenTelemetry.add_span_attributes(replication_lag: lag)
  end
end
