defmodule Electric.ShapeCache.Storage do
  import Electric.Replication.LogOffset, only: [is_log_offset_lt: 2]

  alias Electric.Shapes.Querying
  alias Electric.Replication.LogOffset

  @type shape_id :: Electric.ShapeCacheBehaviour.shape_id()
  @type xmin :: Electric.ShapeCacheBehaviour.xmin()
  @type offset :: LogOffset.t()

  @type compiled_opts :: term()
  @type shape_opts :: term()

  @type storage :: {module(), compiled_opts()}
  @type shape_storage :: {module(), shape_opts()}

  @type log_item :: {LogOffset.t(), Querying.json_iodata()} | {:chunk_boundary | LogOffset.t()}
  @type log_state :: %{current_chunk_byte_size: non_neg_integer()}
  @type log :: Enumerable.t(Querying.json_iodata())

  @type row :: list()

  @doc "Validate and initialise storage base configuration from application configuration"
  @callback shared_opts(Keyword.t()) :: {:ok, compiled_opts()} | {:error, term()}

  @doc "Initialise shape-specific opts from the shared, global, configuration"
  @callback for_shape(shape_id(), compiled_opts()) :: shape_opts()

  @doc "Start any processes required to run the storage backend"
  @callback start_link(shape_opts()) :: GenServer.on_start()

  @doc "Run any initial setup tasks"
  @callback initialise(shape_opts()) :: :ok

  @doc """
  Get the current xmin and offset for the shape storage.

  If the instance is new, then it MUST return `{LogOffset.first(), nil}`.
  """
  @callback get_current_position(shape_opts()) :: {:ok, offset(), xmin() | nil} | {:error, term()}

  @callback set_snapshot_xmin(xmin(), shape_opts()) :: :ok

  @doc "Check if snapshot for a given shape id already exists"
  @callback snapshot_started?(shape_opts()) :: boolean()

  @doc "Get the full snapshot for a given shape, also returning the offset this snapshot includes"
  @callback get_snapshot(shape_opts()) :: {offset :: LogOffset.t(), log()}

  @doc """
  Make a new snapshot for a shape ID based on the meta information about the table and a stream of plain string rows

  Should raise an error if making the snapshot had failed for any reason.
  """
  @callback make_new_snapshot!(
              Querying.json_result_stream(),
              shape_opts()
            ) :: :ok

  @callback mark_snapshot_as_started(shape_opts()) :: :ok

  @doc "Append log items from one transaction to the log"
  @callback append_to_log!(Enumerable.t(log_item()), shape_opts()) :: :ok

  @doc "Get stream of the log for a shape since a given offset"
  @callback get_log_stream(offset :: LogOffset.t(), max_offset :: LogOffset.t(), shape_opts()) ::
              log()

  @doc """
  Get the last exclusive offset of the chunk starting from the given offset.

  If chunk has not finished accumulating, `nil` is returned.

  If chunk has finished accumulating, the last offset of the chunk is returned.
  """
  @callback get_chunk_end_log_offset(LogOffset.t(), shape_opts()) :: LogOffset.t() | nil

  @doc "Clean up snapshots/logs for a shape id"
  @callback cleanup!(shape_opts()) :: :ok

  @behaviour __MODULE__

  @last_log_offset LogOffset.last()

  @spec child_spec(shape_storage()) :: Supervisor.child_spec()
  def child_spec({module, shape_opts}) do
    %{
      id: module,
      start: {module, :start_link, [shape_opts]},
      restart: :transient
    }
  end

  @impl __MODULE__
  def shared_opts({module, opts}) do
    with {:ok, compiled_opts} <- module.shared_opts(opts) do
      {:ok, {module, compiled_opts}}
    end
  end

  @impl __MODULE__
  def for_shape(shape_id, {mod, opts}) do
    {mod, mod.for_shape(shape_id, opts)}
  end

  @impl __MODULE__
  def start_link({mod, shape_opts}) do
    mod.start_link(shape_opts)
  end

  @impl __MODULE__
  def initialise({mod, shape_opts}) do
    mod.initialise(shape_opts)
  end

  @impl __MODULE__
  def get_current_position({mod, shape_opts}) do
    mod.get_current_position(shape_opts)
  end

  @impl __MODULE__
  def set_snapshot_xmin(xmin, {mod, shape_opts}) do
    mod.set_snapshot_xmin(xmin, shape_opts)
  end

  @impl __MODULE__
  def snapshot_started?({mod, shape_opts}) do
    mod.snapshot_started?(shape_opts)
  end

  @impl __MODULE__
  def get_snapshot({mod, shape_opts}) do
    mod.get_snapshot(shape_opts)
  end

  @impl __MODULE__
  def make_new_snapshot!(stream, {mod, shape_opts}) do
    mod.make_new_snapshot!(stream, shape_opts)
  end

  @impl __MODULE__
  def mark_snapshot_as_started({mod, shape_opts}) do
    mod.mark_snapshot_as_started(shape_opts)
  end

  @impl __MODULE__
  def append_to_log!(log_items, {mod, shape_opts}) do
    mod.append_to_log!(log_items, shape_opts)
  end

  @impl __MODULE__
  def get_log_stream(offset, max_offset \\ @last_log_offset, {mod, shape_opts})
      when max_offset == @last_log_offset or not is_log_offset_lt(max_offset, offset) do
    mod.get_log_stream(offset, max_offset, shape_opts)
  end

  @impl __MODULE__
  def get_chunk_end_log_offset(offset, {mod, shape_opts}) do
    mod.get_chunk_end_log_offset(offset, shape_opts)
  end

  @impl __MODULE__
  def cleanup!({mod, shape_opts}) do
    mod.cleanup!(shape_opts)
  end
end
