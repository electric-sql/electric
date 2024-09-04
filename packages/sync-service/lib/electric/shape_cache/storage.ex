defmodule Electric.ShapeCache.Storage do
  import Electric.Replication.LogOffset, only: [is_log_offset_lt: 2]

  alias Electric.Shapes.Querying
  alias Electric.Shapes.Shape
  alias Electric.Replication.LogOffset

  @type shape_id :: String.t()
  @type compiled_opts :: term()
  @type storage :: {module(), compiled_opts()}

  @type log_item :: {LogOffset.t(), Querying.json_iodata()} | {:chunk_boundary | LogOffset.t()}
  @type log_state :: %{
          current_chunk_byte_size: non_neg_integer()
        }
  @type log :: Enumerable.t(Querying.json_iodata())

  @type row :: list()

  @doc "Initialise shape-specific opts from the shared, global, configuration"
  @callback for_shape(shape_id(), compiled_opts()) :: compiled_opts()

  @doc "Start any processes required to run the storage backend"
  @callback start_link(compiled_opts()) :: GenServer.on_start()
  @callback initialise(compiled_opts()) :: :ok
  @callback list_shapes(compiled_opts()) :: [
              shape_id: shape_id(),
              shape: Shape.t(),
              latest_offset: LogOffset.t(),
              snapshot_xmin: non_neg_integer()
            ]
  @callback add_shape(shape_id(), Shape.t(), compiled_opts()) :: :ok
  @callback set_snapshot_xmin(shape_id(), non_neg_integer(), compiled_opts()) :: :ok

  @doc "Check if snapshot for a given shape id already exists"
  @callback snapshot_started?(shape_id(), compiled_opts()) :: boolean()

  @doc "Get the full snapshot for a given shape, also returning the offset this snapshot includes"
  @callback get_snapshot(shape_id(), compiled_opts()) :: {offset :: LogOffset.t(), log()}

  @doc """
  Make a new snapshot for a shape ID based on the meta information about the table and a stream of plain string rows

  Should raise an error if making the snapshot had failed for any reason.
  """
  @callback make_new_snapshot!(
              shape_id(),
              Querying.json_result_stream(),
              compiled_opts()
            ) :: :ok

  @callback mark_snapshot_as_started(shape_id, compiled_opts()) :: :ok

  @doc "Append log items from one transaction to the log"
  @callback append_to_log!(shape_id(), Enumerable.t(log_item()), storage()) :: :ok

  @doc "Get stream of the log for a shape since a given offset"
  @callback get_log_stream(shape_id(), LogOffset.t(), LogOffset.t(), compiled_opts()) ::
              log()

  @doc """
  Get the last exclusive offset of the chunk starting from the given offset.

  If chunk has not finished accumulating, `nil` is returned.

  If chunk has finished accumulating, the last offset of the chunk is returned.
  """
  @callback get_chunk_end_log_offset(shape_id(), LogOffset.t(), compiled_opts()) ::
              LogOffset.t() | nil

  @doc "Clean up snapshots/logs for a shape id"
  @callback cleanup!(shape_id(), compiled_opts()) :: :ok

  @spec child_spec(storage()) :: Supervisor.child_spec()
  def child_spec({module, opts}) do
    %{
      id: module,
      start: {module, :start_link, [opts]},
      restart: :transient
    }
  end

  def for_shape(shape_id, {mod, opts}) do
    {mod, apply(mod, :for_shape, [shape_id, opts])}
  end

  def start_link({mod, opts}) do
    apply(mod, :start_link, [opts])
  end

  @last_log_offset LogOffset.last()

  @spec initialise(storage()) :: :ok
  def initialise({mod, opts}),
    do: apply(mod, :initialise, [opts])

  @spec list_shapes(storage()) :: [
          shape_id: shape_id(),
          shape: Shape.t(),
          latest_offset: non_neg_integer(),
          snapshot_xmin: non_neg_integer()
        ]
  # TODO: remove this
  def list_shapes({mod, shape_opts}) do
    apply(mod, :list_shapes, [shape_opts])
  end

  @spec add_shape(shape_id(), Shape.t(), storage()) :: :ok
  def add_shape(shape_id, shape, {mod, opts}) do
    shape_opts = mod.for_shape(shape_id, opts)
    apply(mod, :add_shape, [shape_id, shape, shape_opts])
  end

  @spec set_snapshot_xmin(shape_id(), non_neg_integer(), storage()) :: :ok
  def set_snapshot_xmin(shape_id, xmin, {mod, opts}) do
    shape_opts = mod.for_shape(shape_id, opts)
    apply(mod, :set_snapshot_xmin, [shape_id, xmin, shape_opts])
  end

  @doc "Check if snapshot for a given shape id already exists"
  @spec snapshot_started?(shape_id(), storage()) :: boolean()
  def snapshot_started?(shape_id, {mod, opts}) do
    shape_opts = mod.for_shape(shape_id, opts)
    mod.snapshot_started?(shape_id, shape_opts)
  end

  @doc "Get the full snapshot for a given shape, also returning the offset this snapshot includes"
  @spec get_snapshot(shape_id(), storage()) :: {offset :: LogOffset.t(), log()}
  def get_snapshot(shape_id, {mod, opts}) do
    shape_opts = mod.for_shape(shape_id, opts)
    mod.get_snapshot(shape_id, shape_opts)
  end

  @doc """
  Make a new snapshot for a shape ID based on the meta information about the table and a stream of plain string rows
  """
  @spec make_new_snapshot!(shape_id(), Querying.json_result_stream(), storage()) :: :ok
  def make_new_snapshot!(shape_id, stream, {mod, opts}) do
    shape_opts = mod.for_shape(shape_id, opts)
    mod.make_new_snapshot!(shape_id, stream, shape_opts)
  end

  @spec mark_snapshot_as_started(shape_id, compiled_opts()) :: :ok
  def mark_snapshot_as_started(shape_id, {mod, opts}) do
    shape_opts = mod.for_shape(shape_id, opts)
    mod.mark_snapshot_as_started(shape_id, shape_opts)
  end

  @doc """
  Append log items from one transaction to the log
  """
  @spec append_to_log!(shape_id(), Enumerable.t(log_item()), storage()) :: :ok
  def append_to_log!(shape_id, log_items, {mod, opts}) do
    shape_opts = mod.for_shape(shape_id, opts)
    mod.append_to_log!(shape_id, log_items, shape_opts)
  end

  @doc "Get stream of the log for a shape since a given offset"
  @spec get_log_stream(shape_id(), LogOffset.t(), LogOffset.t(), storage()) :: log()
  def get_log_stream(shape_id, offset, max_offset \\ @last_log_offset, {mod, opts})
      when max_offset == @last_log_offset or not is_log_offset_lt(max_offset, offset) do
    shape_opts = mod.for_shape(shape_id, opts)

    mod.get_log_stream(shape_id, offset, max_offset, shape_opts)
  end

  @doc """
  Get the last exclusive offset of the chunk starting from the given offset.

  If chunk has not finished accumulating, `nil` is returned.

  If chunk has finished accumulating, the last offset of the chunk is returned.
  """
  @spec get_chunk_end_log_offset(shape_id(), LogOffset.t(), storage()) :: LogOffset.t() | nil
  def get_chunk_end_log_offset(shape_id, offset, {mod, opts}) do
    shape_opts = mod.for_shape(shape_id, opts)
    mod.get_chunk_end_log_offset(shape_id, offset, shape_opts)
  end

  @doc "Check if log entry for given shape ID and offset exists"
  @spec has_log_entry?(shape_id(), LogOffset.t(), storage()) :: boolean()
  def has_log_entry?(shape_id, offset, {mod, opts}) do
    shape_opts = mod.for_shape(shape_id, opts)
    mod.has_log_entry?(shape_id, offset, shape_opts)
  end

  @doc "Clean up snapshots/logs for a shape id"
  @spec cleanup!(shape_id(), storage()) :: :ok
  def cleanup!(shape_id, {mod, opts}) do
    shape_opts = mod.for_shape(shape_id, opts)
    mod.cleanup!(shape_id, shape_opts)
  end
end
