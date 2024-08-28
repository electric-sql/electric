defmodule Electric.Shapes.Consumer do
  use GenStage,
    restart: :transient,
    significant: true

  alias Electric.LogItems
  alias Electric.Replication.Changes
  alias Electric.Replication.Changes.Transaction
  alias Electric.Replication.LogOffset
  alias Electric.ShapeCache
  alias Electric.Shapes.Shape

  require Logger

  def name(%{shape_id: shape_id} = _config) do
    name(shape_id)
  end

  def name(shape_id) when is_binary(shape_id) do
    Electric.Application.process_name(__MODULE__, shape_id)
  end

  def initial_state(consumer) do
    GenStage.call(consumer, :initial_state, 30_000)
  end

  @doc false
  # use in tests to avoid race conditions. registers `pid` to be notified
  # when the `shape_id` consumer has processed every transaction.
  # Transactions that we skip because of xmin logic do not generate
  # a notification
  @spec monitor(ShapeCache.shape_id(), pid()) :: reference()
  def monitor(shape_id, pid \\ self()) do
    GenStage.call(name(shape_id), {:monitor, pid})
  end

  def start_link(config) when is_map(config) do
    GenStage.start_link(__MODULE__, config, name: name(config))
  end

  def init(config) do
    %{log_producer: producer, storage: storage} = config

    Logger.metadata(shape_id: config.shape_id)

    :ok = ShapeCache.Storage.initialise(storage)

    # TODO: replace with a more specific call to get the current position
    :ok = ShapeCache.Storage.add_shape(config.shape_id, config.shape, storage)

    {latest_offset, snapshot_xmin} =
      case ShapeCache.Storage.list_shapes(storage) do
        [%{latest_offset: latest_offset, snapshot_xmin: snapshot_xmin}] ->
          {latest_offset, snapshot_xmin}

        [] ->
          {LogOffset.first(), nil}
      end

    state =
      Map.merge(config, %{
        latest_offset: latest_offset,
        snapshot_xmin: snapshot_xmin,
        buffer: [],
        monitors: []
      })

    {:consumer, state, subscribe_to: [{producer, selector: &is_struct(&1, Changes.Transaction)}]}
  end

  def handle_call(:initial_state, _from, %{snapshot_xmin: xmin, latest_offset: offset} = state) do
    {:reply, {:ok, xmin, offset}, [], state}
  end

  def handle_call({:monitor, pid}, _from, %{monitors: monitors} = state) do
    ref = make_ref()
    {:reply, ref, [], %{state | monitors: [{pid, ref} | monitors]}}
  end

  def handle_cast({:snapshot_xmin_known, shape_id, xmin}, %{shape_id: shape_id} = state) do
    ShapeCache.Storage.set_snapshot_xmin(shape_id, xmin, state.storage)

    cast_shape_cache({:snapshot_xmin_known, shape_id, xmin}, state)

    handle_txns(state.buffer, %{state | snapshot_xmin: xmin, buffer: []})
  end

  def handle_cast({:snapshot_started, shape_id}, %{shape_id: shape_id} = state) do
    ShapeCache.Storage.mark_snapshot_as_started(shape_id, state.storage)
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

  # Buffer incoming transactions until we know our xmin
  def handle_events(txns, _from, %{snapshot_xmin: nil, buffer: buffer} = state) do
    Logger.debug(fn -> "Consumer for #{state.shape_id} buffering #{length(txns)} transactions" end)

    {:noreply, [], %{state | buffer: buffer ++ txns}}
  end

  def handle_events(txns, _from, state) do
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
    %{
      shape: shape,
      shape_id: shape_id,
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

        ShapeCache.Storage.cleanup!(shape_id, storage)

        {:halt, {:truncate, notify(txn, state)}}

      relevant_changes != [] ->
        relevant_changes
        |> Enum.flat_map(&LogItems.from_change(&1, xid, Shape.pk(shape, &1.relation)))
        # TODO: what's a graceful way to handle failure to append to log?
        #       Right now we'll just fail everything
        |> then(&ShapeCache.Storage.append_to_log!(shape_id, &1, storage))

        shape_cache.update_shape_latest_offset(shape_id, last_log_offset, shape_cache_opts)

        notify_listeners(registry, :new_changes, shape_id, last_log_offset)

        {:cont, notify(txn, state)}

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
end
