defmodule Electric.Shapes.Consumer do
  use GenStage,
    restart: :transient,
    significant: true

  alias Electric.ShapeCache.LogChunker
  alias Electric.LogItems
  alias Electric.Replication.Changes
  alias Electric.Replication.Changes.Transaction
  alias Electric.ShapeCache
  alias Electric.Shapes.Shape
  alias Electric.Telemetry.OpenTelemetry

  require Logger

  @initial_log_state %{current_chunk_byte_size: 0}

  def name(%{electric_instance_id: electric_instance_id, shape_id: shape_id} = _config) do
    name(electric_instance_id, shape_id)
  end

  def name(electric_instance_id, shape_id) when is_binary(shape_id) do
    Electric.Application.process_name(electric_instance_id, __MODULE__, shape_id)
  end

  def initial_state(consumer) do
    GenStage.call(consumer, :initial_state, 30_000)
  end

  @doc false
  # use in tests to avoid race conditions. registers `pid` to be notified
  # when the `shape_id` consumer has processed every transaction.
  # Transactions that we skip because of xmin logic do not generate
  # a notification
  @spec monitor(atom(), ShapeCache.shape_id(), pid()) :: reference()
  def monitor(electric_instance_id, shape_id, pid \\ self()) do
    GenStage.call(name(electric_instance_id, shape_id), {:monitor, pid})
  end

  @spec whereis(atom(), ShapeCache.shape_id()) :: pid() | nil
  def whereis(electric_instance_id, shape_id) do
    electric_instance_id
    |> name(shape_id)
    |> GenServer.whereis()
  end

  def start_link(config) when is_map(config) do
    GenStage.start_link(__MODULE__, config, name: name(config))
  end

  def init(config) do
    %{log_producer: producer, storage: storage} = config

    Logger.metadata(shape_id: config.shape_id)

    :ok = ShapeCache.Storage.initialise(storage)

    {:ok, latest_offset, snapshot_xmin} = ShapeCache.Storage.get_current_position(storage)

    state =
      Map.merge(config, %{
        latest_offset: latest_offset,
        snapshot_xmin: snapshot_xmin,
        log_state: @initial_log_state,
        buffer: [],
        monitors: []
      })

    {:consumer, state, subscribe_to: [{producer, [max_demand: 1, selector: nil]}]}
  end

  def handle_call(:initial_state, _from, %{snapshot_xmin: xmin, latest_offset: offset} = state) do
    {:reply, {:ok, xmin, offset}, [], state}
  end

  def handle_call({:monitor, pid}, _from, %{monitors: monitors} = state) do
    ref = make_ref()
    {:reply, ref, [], %{state | monitors: [{pid, ref} | monitors]}}
  end

  def handle_cast({:snapshot_xmin_known, shape_id, xmin}, %{shape_id: shape_id} = state) do
    ShapeCache.Storage.set_snapshot_xmin(xmin, state.storage)

    cast_shape_cache({:snapshot_xmin_known, shape_id, xmin}, state)

    handle_txns(state.buffer, %{state | snapshot_xmin: xmin, buffer: []})
  end

  def handle_cast({:snapshot_started, shape_id}, %{shape_id: shape_id} = state) do
    ShapeCache.Storage.mark_snapshot_as_started(state.storage)
    cast_shape_cache({:snapshot_started, shape_id}, state)

    {:noreply, [], state}
  end

  def handle_cast({:snapshot_failed, shape_id, error, stacktrace}, state) do
    Logger.error(
      "Snapshot creation failed for #{shape_id} because of:\n#{Exception.format(:error, error, stacktrace)}"
    )

    cast_shape_cache({:snapshot_failed, shape_id, error, stacktrace}, state)

    {:noreply, [], state}
  end

  def handle_cast({:snapshot_exists, shape_id}, %{shape_id: shape_id} = state) do
    %{snapshot_xmin: xmin} = state

    cast_shape_cache({:snapshot_xmin_known, shape_id, xmin}, state)
    cast_shape_cache({:snapshot_started, shape_id}, state)

    {:noreply, [], state}
  end

  # `Shapes.Dispatcher` only works with single-events, so we can safely assert
  # that here
  def handle_events([%Changes.Relation{}], _from, state) do
    {:noreply, [], state}
  end

  # Buffer incoming transactions until we know our xmin
  def handle_events([%Transaction{xid: xid}] = txns, _from, %{snapshot_xmin: nil} = state) do
    Logger.debug(fn ->
      "Consumer for #{state.shape_id} buffering 1 transaction with xid #{xid}"
    end)

    {:noreply, [], %{state | buffer: state.buffer ++ txns}}
  end

  def handle_events([%Transaction{}] = txns, _from, state) do
    handle_txns(txns, state)
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
    OpenTelemetry.with_span(
      "shapes_consumer.handle_txn",
      shape_attrs(state.shape_id, state.shape),
      fn -> do_handle_txn(txn, state) end
    )
  end

  defp do_handle_txn(%Transaction{} = txn, state) do
    %{
      shape: shape,
      shape_id: shape_id,
      log_state: log_state,
      chunk_bytes_threshold: chunk_bytes_threshold,
      shape_cache: {shape_cache, shape_cache_opts},
      registry: registry,
      storage: storage
    } = state

    Logger.debug(fn -> "Txn received: #{inspect(txn)}" end)

    %{xid: xid, changes: changes, lsn: _lsn, last_log_offset: last_log_offset} = txn

    relevant_changes = Enum.flat_map(changes, &Shape.convert_change(shape, &1))

    cond do
      Enum.any?(relevant_changes, &is_struct(&1, Changes.TruncatedRelation)) ->
        # TODO: This is a very naive way to handle truncations: if ANY relevant truncates are
        #       present in the transaction, we're considering the whole transaction empty, and
        #       just rotate the shape id. "Correct" way to handle truncates is to be designed.
        Logger.warning(
          "Truncate operation encountered while processing txn #{txn.xid} for #{shape_id}"
        )

        :ok = shape_cache.handle_truncate(shape_id, shape_cache_opts)

        :ok = ShapeCache.Storage.cleanup!(storage)

        {:halt, {:truncate, notify(txn, %{state | log_state: @initial_log_state})}}

      relevant_changes != [] ->
        {log_entries, new_log_state} =
          prepare_log_entries(relevant_changes, xid, shape, log_state, chunk_bytes_threshold)

        # TODO: what's a graceful way to handle failure to append to log?
        #       Right now we'll just fail everything
        :ok = ShapeCache.Storage.append_to_log!(log_entries, storage)

        shape_cache.update_shape_latest_offset(shape_id, last_log_offset, shape_cache_opts)

        notify_listeners(registry, :new_changes, shape_id, last_log_offset)

        {:cont, notify(txn, %{state | log_state: new_log_state})}

      true ->
        Logger.debug(fn ->
          "No relevant changes found for #{inspect(shape)} in txn #{txn.xid}"
        end)

        {:cont, state}
    end
  end

  defp notify_listeners(registry, :new_changes, shape_id, latest_log_offset) do
    Registry.dispatch(registry, shape_id, fn registered ->
      Logger.debug(fn ->
        "Notifying ~#{length(registered)} clients about new changes to #{shape_id}"
      end)

      for {pid, ref} <- registered,
          do: send(pid, {ref, :new_changes, latest_log_offset})
    end)
  end

  defp cast_shape_cache(message, state) do
    %{shape_cache: {shape_cache, shape_cache_opts}} = state
    shape_cache.cast(message, shape_cache_opts)
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
          ShapeCache.Storage.log_state(),
          non_neg_integer()
        ) :: {Enumerable.t(ShapeCache.Storage.log_item()), ShapeCache.Storage.log_state()}
  defp prepare_log_entries(
         changes,
         xid,
         shape,
         log_state,
         chunk_bytes_threshold
       ) do
    {log_items, new_log_state} =
      changes
      |> Stream.flat_map(&LogItems.from_change(&1, xid, Shape.pk(shape, &1.relation)))
      |> Enum.flat_map_reduce(log_state, fn log_item,
                                            %{current_chunk_byte_size: chunk_size} = state ->
        json_log_item = Jason.encode!(log_item)

        case LogChunker.add_to_chunk(json_log_item, chunk_size, chunk_bytes_threshold) do
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

  defp shape_attrs(shape_id, shape) do
    ["shape.id": shape_id, "shape.root_table": shape.root_table, "shape.where": shape.where]
  end
end
