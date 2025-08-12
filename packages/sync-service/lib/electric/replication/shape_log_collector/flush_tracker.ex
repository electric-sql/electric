defmodule Electric.Replication.ShapeLogCollector.FlushTracker do
  alias Electric.Replication.LogOffset
  alias Electric.Replication.Changes.Transaction

  @type shape_id() :: term()

  defstruct [
    :last_global_flushed_offset,
    :last_seen_offset,
    :last_flushed,
    :min_incomlete_flush_tree,
    :notify_fn
  ]

  @type t() :: %__MODULE__{
          last_global_flushed_offset: LogOffset.t(),
          last_seen_offset: LogOffset.t(),
          last_flushed: %{
            optional(shape_id()) => {last_sent :: LogOffset.t(), last_flushed :: LogOffset.t()}
          },
          min_incomlete_flush_tree: :gb_trees.tree(LogOffset.t_tuple(), MapSet.t(shape_id())),
          notify_fn: (non_neg_integer() -> any())
        }

  @doc """
  Create a new flush tracker to figure out when flush boundary moves up across all writers

  When doing a flush across N shapes, it might be delayed on different cadences depending on the amount of data we’re writing.
  It also might be worth it eventually to break lock-step writes. We need to tell Postgres accurately (enough) when we’ve actually flushed the data it sent us.

  Main problem is that we’re not only flushing on different cadences, but also each shape might not see every operation, so our flush acknowledgement
  should take a complicated minimum across all shapes depending on what they are seeing. What’s more is that we want to normalize the acknowledged WALs
  to transaction boundaries, because that’s how PG is sending the data.

  It’s important to note that because shapes are not seeing all operations, they don’t necessarily see the last-in-transaction operation, while the
  sender doesn’t know how many operations will be sent upfront. Because of that it’s up to the writer to acknowledge the intermediate flushes but also
  to normalize the last-seen operation to the transaction offset so that the sender can be sure the writer has caught up.

  ### Tracked state:
  - `last_global_flushed_offset`
  - `last_seen_offset`
  - Pending writes Mapping:
    ```
    Shape => {last_sent, last_flushed}
    ```
    - Shapes where `last_sent == last_flushed` can be considered caught-up, and can be discarded from the mapping

  ### Algorithm:

  On incoming transaction: expressed via `handle_transaction/3`
  1. Update `last_seen_offset` to the max offset of the transaction/block we received
  2. Determine affected shapes
  3. For each shape,
    1. If Mapping already has the shape, update `last_sent` to the max offset of the transaction
    2. If Mapping doesn’t have the shape, add it with `{last_sent, last_global_flushed_offset}`
  4. If Mapping is empty after this update, then we’re up-to-date and should consider this transaction immediately flushed. Update `last_global_flushed_offset` and `maxFlushedOffset` to be the max offset of the transaction
  5. Wait for the writers to send the flushed offset

  On writer flush (i.e. when writer notifies the central process of a flushed write) notifying with `newlast_flushed` expressed via `handle_flush_notification/3`
  1. Update the mapping for the shape:
    1. If `last_sent` equals to the new flush position, then we’re caught up. Delete this shape from the mapping
    2. Otherwise, replace `last_flushed` with this new value
  2. If Mapping is empty after the update, we’re globally caught up - set `last_global_flushed_offset` to equal `last_seen_offset`
  3. Otherwise:
    1. Determine the new global flushed offset:
       `last_global_flushed_offset = max(last_global_flushed_offset, min(for {_, {_, last_flushed}} <- Mapping, do: last_flushed))`
       We take the maximum between the already last flushed offset, and the lowest flushed offset across shapes that
       had not caught up. Because this `min` is expected to be called very often, there should exist a lookup structure to get this `min` in a fast manner
  4. On last_global_flushed_offset update - notify the replication client with actual transaction LSN:
    1. If flushes are caught up (i.e. Mapping is empty), then notify with LSN = tx_offset of the last flushed offset
    2. Otherwise, it’s complicated to determine which transactions have been flushed completely without keeping track of
       all intermediate points, so notify with LSN = tx_offset - 1, essentially lagging the flush by one transaction just in case.

  Normalization of the txn flush on a writer:
  1. On incoming transaction, store a mapping of last offset that’s meant to be written by this writer to the whole txn offset
  2. On a flush, the writer should remove from the mapping all elements that are less-then-or-equal to last flushed offset, and then
    1. If last removed element from the mapping is equal to the flushed, then use the whole txn offset instead to notify the sender
    2. Otherwise, use actual last flushed offset to notify the sender.
  """
  def new(opts \\ []) do
    %__MODULE__{
      last_global_flushed_offset: LogOffset.before_all(),
      last_seen_offset: LogOffset.before_all(),
      last_flushed: %{},
      min_incomlete_flush_tree: :gb_trees.empty(),
      notify_fn: opts[:notify_fn]
    }
  end

  @spec handle_transaction(t(), Transaction.t(), Enumerable.t(shape_id())) :: t()
  def handle_transaction(
        %__MODULE__{
          last_global_flushed_offset: last_global_flushed_offset,
          last_flushed: last_flushed
        } = state,
        %Transaction{lsn: _lsn, last_log_offset: last_log_offset},
        affected_shapes
      ) do
    mapset = tree_get_shape_set(state, last_global_flushed_offset)

    {last_flushed, mapset} =
      Enum.reduce(affected_shapes, {last_flushed, mapset}, fn shape, {acc, mapset} ->
        case Map.fetch(acc, shape) do
          {:ok, {_, last_flushed}} ->
            {Map.put(acc, shape, {last_log_offset, last_flushed}), mapset}

          :error ->
            {Map.put(acc, shape, {last_log_offset, last_global_flushed_offset}),
             MapSet.put(mapset, shape)}
        end
      end)

    state =
      %__MODULE__{state | last_flushed: last_flushed, last_seen_offset: last_log_offset}
      |> tree_enter_shape_set(last_global_flushed_offset, mapset)

    if last_flushed == %{} do
      # We're caught up
      %__MODULE__{state | last_global_flushed_offset: last_log_offset}
      |> notify_global_offset_updated()
    else
      state
    end
  end

  @spec handle_flush_notification(t(), shape_id(), LogOffset.t()) :: t()
  def handle_flush_notification(
        %__MODULE__{
          last_flushed: last_flushed,
          min_incomlete_flush_tree: min_incomlete_flush_tree
        } = state,
        shape_id,
        last_flushed_offset
      )
      when is_map_key(last_flushed, shape_id) do
    {last_flushed, min_incomlete_flush_tree} =
      case Map.fetch!(last_flushed, shape_id) do
        {^last_flushed_offset, prev_flushed_offset} ->
          {Map.delete(last_flushed, shape_id),
           delete_from_tree(min_incomlete_flush_tree, prev_flushed_offset, shape_id)}

        {last_sent, prev_flushed_offset} ->
          {Map.put(last_flushed, shape_id, {last_sent, last_flushed_offset}),
           min_incomlete_flush_tree
           |> delete_from_tree(prev_flushed_offset, shape_id)
           |> add_to_tree(last_flushed_offset, shape_id)}
      end

    %__MODULE__{
      state
      | last_flushed: last_flushed,
        min_incomlete_flush_tree: min_incomlete_flush_tree
    }
    |> update_global_offset()
  end

  # If the shape is not in the mapping, then we're processing a flush notification for a shape that was removed
  def handle_flush_notification(state, _, _last_flushed_offset) do
    state
  end

  def handle_shape_removed(%__MODULE__{last_flushed: last_flushed} = state, shape_id) do
    case Map.fetch(last_flushed, shape_id) do
      {:ok, {_, last_flushed_offset}} ->
        %__MODULE__{
          state
          | last_flushed: Map.delete(last_flushed, shape_id),
            min_incomlete_flush_tree:
              delete_from_tree(state.min_incomlete_flush_tree, last_flushed_offset, shape_id)
        }
        |> update_global_offset()

      :error ->
        state
    end
  end

  defp update_global_offset(
         %__MODULE__{last_flushed: last_flushed, last_seen_offset: last_seen} = state
       )
       when last_flushed == %{} do
    %__MODULE__{state | last_global_flushed_offset: last_seen}
    |> notify_global_offset_updated()
  end

  defp update_global_offset(
         %__MODULE__{
           min_incomlete_flush_tree: min_incomlete_flush_tree,
           last_global_flushed_offset: prev_last_global_flushed_offset
         } = state
       ) do
    {offset, _} = :gb_trees.smallest(min_incomlete_flush_tree)

    last_global_flushed_offset =
      LogOffset.max(prev_last_global_flushed_offset, LogOffset.new(offset))

    if prev_last_global_flushed_offset != last_global_flushed_offset do
      %__MODULE__{state | last_global_flushed_offset: last_global_flushed_offset}
      |> notify_global_offset_updated()
    else
      state
    end
  end

  defp notify_global_offset_updated(state) do
    if state.last_flushed == %{} do
      # We're caught up
      state.notify_fn.(state.last_global_flushed_offset.tx_offset)
    else
      # We're not caught up
      state.notify_fn.(state.last_global_flushed_offset.tx_offset - 1)
    end

    state
  end

  defp delete_from_tree(tree, offset, shape_id) do
    offset_tuple = LogOffset.to_tuple(offset)

    new_mapset = MapSet.delete(:gb_trees.get(offset_tuple, tree), shape_id)

    if MapSet.equal?(new_mapset, MapSet.new()) do
      :gb_trees.delete(offset_tuple, tree)
    else
      :gb_trees.update(offset_tuple, new_mapset, tree)
    end
  end

  defp add_to_tree(tree, offset, shape_id) do
    offset_tuple = LogOffset.to_tuple(offset)

    case :gb_trees.lookup(offset_tuple, tree) do
      :none ->
        :gb_trees.insert(offset_tuple, MapSet.new([shape_id]), tree)

      {:value, mapset} ->
        :gb_trees.update(offset_tuple, MapSet.put(mapset, shape_id), tree)
    end
  end

  defp tree_get_shape_set(%__MODULE__{min_incomlete_flush_tree: tree}, offset) do
    case :gb_trees.lookup(LogOffset.to_tuple(offset), tree) do
      :none -> MapSet.new()
      {:value, mapset} -> mapset
    end
  end

  defp tree_enter_shape_set(
         %__MODULE__{min_incomlete_flush_tree: tree} = state,
         offset,
         %MapSet{} = mapset
       ) do
    %__MODULE__{
      state
      | min_incomlete_flush_tree: :gb_trees.enter(LogOffset.to_tuple(offset), mapset, tree)
    }
  end
end
