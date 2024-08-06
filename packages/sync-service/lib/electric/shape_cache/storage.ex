defmodule Electric.ShapeCache.Storage do
  alias Electric.Replication.Changes
  alias Electric.Shapes.Shape
  alias Electric.Replication.LogOffset

  @type shape_id :: String.t()
  @type compiled_opts :: term()

  @typedoc """
  Prepared change that will be passed to the storage layer from the replication log.
  """
  @type prepared_change ::
          {
            offset :: LogOffset.t(),
            key :: String.t(),
            operation :: :insert | :update | :delete,
            value :: %{String.t() => String.t()},
            header_data :: %{optional(atom()) => Jason.Encoder.t()}
          }

  @type log_header :: map()
  @type log_entry :: %{
          key: String.t(),
          value: map(),
          headers: log_header(),
          offset: LogOffset.t()
        }
  @type log :: Enumerable.t(log_entry())

  @type serialised_log_entry :: %{
          key: String.t(),
          value: map(),
          headers: log_header(),
          offset: String.t()
        }

  @type row :: list()

  @doc "Initialize shared options that will be passed to every other callback"
  @callback shared_opts(term()) :: {:ok, compiled_opts()} | {:error, term()}
  @doc "Start any processes required to run the storage backend"
  @callback start_link(compiled_opts()) :: GenServer.on_start()
  @callback cleanup_shapes_without_xmins(storage()) :: :ok
  @callback list_shapes(storage()) :: [
              shape_id: shape_id(),
              shape: Shape.t(),
              latest_offset: LogOffset.t(),
              snapshot_xmin: non_neg_integer()
            ]
  @callback add_shape(shape_id(), Shape.t(), storage()) :: :ok
  @callback set_snapshot_xmin(shape_id(), non_neg_integer(), storage()) :: :ok
  @doc "Check if snapshot for a given shape id already exists"
  @callback snapshot_exists?(shape_id(), compiled_opts()) :: boolean()
  @doc "Get the full snapshot for a given shape, also returning the offset this snapshot includes"
  @callback get_snapshot(shape_id(), compiled_opts()) :: {offset :: LogOffset.t(), log()}
  @doc """
  Make a new snapshot for a shape ID based on the meta information about the table and a stream of plain string rows

  Should raise an error if making the snapshot had failed for any reason.
  """
  @doc unstable: "The meta information about the single table is subject to change"
  @callback make_new_snapshot!(
              shape_id(),
              Electric.Shapes.Shape.t(),
              Postgrex.Query.t(),
              Enumerable.t(row()),
              compiled_opts()
            ) :: :ok
  @doc "Append changes from one transaction to the log"
  @callback append_to_log!(
              shape_id(),
              [prepared_change()],
              compiled_opts()
            ) :: :ok
  @doc "Get stream of the log for a shape since a given offset"
  @callback get_log_stream(shape_id(), LogOffset.t(), LogOffset.t(), compiled_opts()) ::
              Enumerable.t()
  @doc "Check if log entry for given shape ID and offset exists"
  @callback has_log_entry?(shape_id(), LogOffset.t(), compiled_opts()) :: boolean()
  @doc "Clean up snapshots/logs for a shape id"
  @callback cleanup!(shape_id(), compiled_opts()) :: :ok

  @type storage() :: {module(), compiled_opts()}

  @spec cleanup_shapes_without_xmins(storage()) :: :ok
  def cleanup_shapes_without_xmins({mod, opts}),
    do: apply(mod, :cleanup_shapes_without_xmins, [opts])

  @spec list_shapes(storage()) :: [
          shape_id: shape_id(),
          shape: Shape.t(),
          latest_offset: non_neg_integer(),
          snapshot_xmin: non_neg_integer()
        ]
  def list_shapes({mod, opts}), do: apply(mod, :list_shapes, [opts])

  @spec add_shape(shape_id(), Shape.t(), storage()) :: :ok
  def add_shape(shape_id, shape, {mod, opts}),
    do: apply(mod, :add_shape, [shape_id, shape, opts])

  @spec set_snapshot_xmin(shape_id(), non_neg_integer(), storage()) :: :ok
  def set_snapshot_xmin(shape_id, xmin, {mod, opts}),
    do: apply(mod, :set_snapshot_xmin, [shape_id, xmin, opts])

  @doc "Check if snapshot for a given shape id already exists"
  @spec snapshot_exists?(shape_id(), storage()) :: boolean()
  def snapshot_exists?(shape_id, {mod, opts}), do: mod.snapshot_exists?(shape_id, opts)
  @doc "Get the full snapshot for a given shape, also returning the offset this snapshot includes"
  @spec get_snapshot(shape_id(), storage()) :: {offset :: LogOffset.t(), log()}
  def get_snapshot(shape_id, {mod, opts}), do: mod.get_snapshot(shape_id, opts)

  @doc """
  Make a new snapshot for a shape ID based on the meta information about the table and a stream of plain string rows
  """
  @doc unstable: "The meta information about the single table is subject to change"
  @spec make_new_snapshot!(
          shape_id(),
          Electric.Shapes.Shape.t(),
          Postgrex.Query.t(),
          Enumerable.t(row()),
          storage()
        ) :: :ok
  def make_new_snapshot!(shape_id, shape, meta, stream, {mod, opts}),
    do: mod.make_new_snapshot!(shape_id, shape, meta, stream, opts)

  @doc """
  Append changes from one transaction to the log
  """
  @spec append_to_log!(shape_id(), [prepared_change()], storage()) :: :ok
  def append_to_log!(shape_id, changes, {mod, opts}),
    do: mod.append_to_log!(shape_id, changes, opts)

  import LogOffset, only: :macros
  @doc "Get stream of the log for a shape since a given offset"
  @spec get_log_stream(shape_id(), LogOffset.t(), LogOffset.t(), storage()) ::
          Enumerable.t()
  def get_log_stream(shape_id, offset, max_offset \\ LogOffset.last(), {mod, opts})
      when max_offset == :infinity or not is_log_offset_lt(max_offset, offset),
      do: mod.get_log_stream(shape_id, offset, max_offset, opts)

  @doc "Check if log entry for given shape ID and offset exists"
  @spec has_log_entry?(shape_id(), LogOffset.t(), storage()) :: boolean()
  def has_log_entry?(shape_id, offset, {mod, opts}),
    do: mod.has_log_entry?(shape_id, offset, opts)

  @doc "Clean up snapshots/logs for a shape id"
  @spec cleanup!(shape_id(), storage()) :: :ok
  def cleanup!(shape_id, {mod, opts}), do: mod.cleanup!(shape_id, opts)

  @doc """
  Prepare a given change for storage.

  Preparation involves repacking it in a more efficient and uniform manner and
  splitting up updates with a changed key into 2 operations.
  """
  @spec prepare_change_for_storage(
          Changes.data_change(),
          txid :: non_neg_integer() | nil,
          pk_cols :: [String.t()]
        ) :: [prepared_change(), ...]
  def prepare_change_for_storage(%Changes.NewRecord{} = change, txid, _),
    do: [
      {change.log_offset, change.key, :insert, change.record,
       %{txid: txid, relation: Tuple.to_list(change.relation)}}
    ]

  def prepare_change_for_storage(%Changes.DeletedRecord{} = change, txid, pk_cols),
    do: [
      {change.log_offset, change.key, :delete, take_pks_or_all(change.old_record, pk_cols),
       %{txid: txid, relation: Tuple.to_list(change.relation)}}
    ]

  # `old_key` is nil when it's unchanged. This is not possible when there is no PK defined.
  def prepare_change_for_storage(%Changes.UpdatedRecord{old_key: nil} = change, txid, pk_cols),
    do: [
      {change.log_offset, change.key, :update,
       Map.take(change.record, Enum.concat(pk_cols, change.changed_columns)),
       %{txid: txid, relation: Tuple.to_list(change.relation)}}
    ]

  def prepare_change_for_storage(%Changes.UpdatedRecord{} = change, txid, pk_cols),
    do: [
      {change.log_offset, change.old_key, :delete, take_pks_or_all(change.old_record, pk_cols),
       %{txid: txid, relation: Tuple.to_list(change.relation), key_change_to: change.key}},
      {LogOffset.increment(change.log_offset), change.key, :insert, change.record,
       %{txid: txid, relation: Tuple.to_list(change.relation), key_change_from: change.old_key}}
    ]

  defp take_pks_or_all(record, []), do: record
  defp take_pks_or_all(record, pks), do: Map.take(record, pks)
end
