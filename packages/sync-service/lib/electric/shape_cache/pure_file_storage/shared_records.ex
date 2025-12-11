defmodule Electric.ShapeCache.PureFileStorage.SharedRecords do
  import Record
  alias Electric.Replication.LogOffset

  # Record that's stored in the stack-wide ETS table for reader reference
  defrecord :storage_meta, [
    :shape_handle,
    :ets_table,
    :last_persisted_txn_offset,
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

  # Record that controls the writer's state including parts that shouldn't change in reduction
  defrecord :writer_state, [
    :writer_acc,
    :write_timer,
    :ets,
    :latest_name,
    :opts
  ]
end
