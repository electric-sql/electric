defmodule Electric.ShapeCache.PureFileStorage.SharedRecords do
  import Record
  alias Electric.Replication.LogOffset

  # Record that's stored in the stack-wide ETS table for reader reference
  defrecord :storage_meta, [
    :shape_handle,
    :ets_table,
    :persisted_full_txn_offset,
    :last_persisted_offset,
    :last_seen_txn_offset,
    :compaction_boundary,
    :latest_name,
    :pg_snapshot,
    snapshot_started?: false,
    compaction_started?: false,
    last_snapshot_chunk: nil,
    cached_chunk_boundaries: {LogOffset.last_before_real_offsets(), []}
  ]

  # Including `compaction_started?` would require bumping the version of the storage,
  # as there are cases where we would have a file with "false" stored in it.
  # For `snapshot_started?` we only have the metadata file if it has been set.
  def metadata_boolean_fields, do: [:snapshot_started?]

  # Record that controls the writer's state including parts that shouldn't change in reduction
  defrecord :writer_state, [
    :writer_acc,
    :write_timer,
    :ets,
    :latest_name,
    :opts
  ]
end
