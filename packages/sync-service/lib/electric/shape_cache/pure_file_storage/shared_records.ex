defmodule Electric.ShapeCache.PureFileStorage.SharedRecords do
  import Record
  alias Electric.Replication.LogOffset

  @value_defaults %{
    snapshot_started?: false,
    compaction_started?: false,
    cached_chunk_boundaries: {LogOffset.last_before_real_offsets(), []}
  }

  @value_keys [
    :ets_table,
    :last_persisted_txn_offset,
    :last_persisted_offset,
    :last_seen_txn_offset,
    :compaction_boundary,
    :latest_name,
    :pg_snapshot,
    :snapshot_started?,
    :compaction_started?,
    :last_snapshot_chunk,
    :cached_chunk_boundaries
  ]

  # Record that's stored in the stack-wide ETS table for reader reference
  defrecord :storage_meta, [
    :shape_handle | for(k <- @value_keys, do: {k, Map.get(@value_defaults, k, nil)})
  ]

  # Record that controls the writer's state including parts that shouldn't change in reduction
  defrecord :writer_state, [
    :writer_acc,
    :write_timer,
    :ets,
    :latest_name,
    :opts
  ]

  @type storage_meta() :: term()

  def storage_meta_keys, do: @value_keys
  def storage_meta_unset(key), do: Map.get(@value_defaults, key, nil)

  @spec expand_storage_meta(storage_meta(), [atom(), ...]) :: keyword()
  def expand_storage_meta(storage_meta() = meta, keys) when is_list(keys) do
    Enum.map(keys, &get_storage_meta_value(&1, meta))
  end

  @spec create_storage_meta(keyword()) :: storage_meta()
  def create_storage_meta(key_values) when is_list(key_values) do
    Enum.reduce(key_values, storage_meta(), &set_storage_meta_value/2)
  end

  def set_storage_meta(meta, key_values) when is_list(key_values) do
    Enum.reduce(key_values, meta, &set_storage_meta_value/2)
  end

  defp set_storage_meta_value({:shape_handle, handle}, meta) do
    storage_meta(meta, shape_handle: handle)
  end

  defp set_storage_meta_value({:handle, handle}, meta) do
    storage_meta(meta, shape_handle: handle)
  end

  for key <- @value_keys do
    defp set_storage_meta_value({unquote(key), value}, meta) do
      storage_meta(meta, [{unquote(key), value}])
    end
  end

  for key <- @value_keys do
    defp get_storage_meta_value(unquote(key), meta) do
      {unquote(key), storage_meta(meta, unquote(key))}
    end
  end

  for key <- @value_keys do
    def storage_meta_key_pos(unquote(key)), do: storage_meta(unquote(key)) + 1
  end
end
