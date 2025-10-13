defmodule Electric.ShapeCache.Storage do
  @moduledoc false
  import Electric.Replication.LogOffset, only: [is_log_offset_lt: 2]

  alias Electric.Shapes.Shape
  alias Electric.Shapes.Querying
  alias Electric.Replication.LogOffset

  defmodule Error do
    defexception [:message]
  end

  @type shape_handle :: Electric.ShapeCacheBehaviour.shape_handle()
  @type pg_snapshot :: %{
          xmin: pos_integer(),
          xmax: pos_integer(),
          xip_list: [pos_integer()],
          filter_txns?: boolean()
        }
  @type offset :: LogOffset.t()

  @type compiled_opts :: term()
  @type shape_opts :: term()
  @type writer_state :: term()

  @type storage :: {module(), compiled_opts()}
  @type shape_storage :: {module(), shape_opts()}

  @type operation_type :: :insert | :update | :delete
  @type log_item ::
          {LogOffset.t(), key :: String.t(), operation_type :: operation_type(),
           Querying.json_iodata()}
  @type log :: Enumerable.t(Querying.json_iodata())

  @type row :: list()

  @doc "Validate and initialise storage base configuration from application configuration"
  @callback shared_opts(term()) :: compiled_opts()

  @doc "Initialise shape-specific opts from the shared, global, configuration"
  @callback for_shape(shape_handle(), compiled_opts()) :: shape_opts()

  @doc "Start any stack-wide processes required for storage to operate"
  @callback stack_start_link(compiled_opts()) :: GenServer.on_start()

  @doc "Start any shape-specific processes required to run the storage backend"
  @callback start_link(shape_opts()) :: GenServer.on_start()

  @doc "Prepare the in-process writer state, returning an accumulator."
  @callback init_writer!(shape_opts(), shape_definition :: Shape.t(), term()) :: writer_state()

  @doc "Retrieve all stored shape handles"
  @callback get_all_stored_shape_handles(compiled_opts()) ::
              {:ok, MapSet.t(shape_handle())} | {:error, term()}

  @doc "Retrieve all stored shapes"
  @callback get_all_stored_shapes(compiled_opts()) ::
              {:ok, %{shape_handle() => Shape.t()}} | {:error, term()}

  @doc "Get the directory where metadata backups are stored."
  @callback metadata_backup_dir(compiled_opts()) :: String.t() | nil

  @doc "Get the total disk usage for all shapes"
  @callback get_total_disk_usage(compiled_opts()) :: non_neg_integer()

  @doc """
  Get the current pg_snapshot and offset for the shape storage.

  If the instance is new, then it MUST return `{LogOffset.first(), nil}`.
  """
  @callback get_current_position(shape_opts()) ::
              {:ok, offset(), pg_snapshot() | nil} | {:error, term()}

  @callback set_pg_snapshot(pg_snapshot(), shape_opts()) :: :ok

  @doc "Check if snapshot for a given shape handle already exists"
  @callback snapshot_started?(shape_opts()) :: boolean()

  @doc """
  Make a new snapshot for a shape handle based on the meta information about the table and a stream of plain string rows

  Should raise an error if making the snapshot had failed for any reason.
  """
  @callback make_new_snapshot!(
              Querying.json_result_stream(),
              shape_opts()
            ) :: :ok

  @callback mark_snapshot_as_started(shape_opts()) :: :ok

  @doc """
  Append log items from one transaction to the log.

  Each storage implementation is responsible for handling transient errors
  using some retry strategy.

  If the backend fails to write within the expected time, or some other error
  occurs, then this should raise.
  """
  @callback append_to_log!(Enumerable.t(log_item()), writer_state()) ::
              writer_state() | no_return()

  @doc "Get stream of the log for a shape since a given offset"
  @callback get_log_stream(offset :: LogOffset.t(), max_offset :: LogOffset.t(), shape_opts()) ::
              log()

  @doc """
  Get the last exclusive offset of the chunk starting from the given offset.

  If chunk has not finished accumulating, `nil` is returned.

  If chunk has finished accumulating, the last offset of the chunk is returned.
  """
  @callback get_chunk_end_log_offset(LogOffset.t(), shape_opts()) :: LogOffset.t() | nil

  @doc """
  Close all active resources and persist any pending writes on system/process shutdown
  """
  @callback terminate(writer_state()) :: term()

  @doc """
  Commit any pending writes to disk and close open resources that can be safely reopened later.
  """
  @callback hibernate(writer_state()) :: writer_state()

  @doc """
  Clean up snapshots/logs for a shape handle by deleting whole directory.

  Is expected to be only called once the storage has been stopped.
  """
  @callback cleanup!(shape_opts()) :: any()
  @callback cleanup!(map(), binary()) :: any()

  @doc """
  Cleanup all shape data and metadata from storage.
  """
  @callback cleanup_all!(shape_opts()) :: any()

  @doc """
  Compact operations in the log keeping the last N complete chunks intact
  """
  @callback compact(shape_opts(), keep_complete_chunks :: pos_integer()) :: :ok

  @behaviour __MODULE__

  @last_log_offset LogOffset.last()

  @doc """
  Apply a message to the writer state.

  In-process writer may send messages to self, in the form of
  `{#{__MODULE__}, message}`, which must be handled using this function
  and the return of the function must be used as the new writer state.
  """
  def apply_message({mod, writer_state}, {m, f, a}) do
    {mod, apply(m, f, [writer_state | a])}
  end

  def for_stack(stack_id) do
    Electric.StackConfig.fetch!(stack_id, Electric.ShapeCache.Storage)
  end

  @spec child_spec(shape_storage()) :: Supervisor.child_spec()
  def child_spec({module, shape_opts}) do
    %{
      id: {module, :per_consumer},
      start: {module, :start_link, [shape_opts]},
      restart: :transient
    }
  end

  @spec stack_child_spec(storage()) :: Supervisor.child_spec()
  def stack_child_spec({module, stack_opts}) do
    %{
      id: module,
      start: {__MODULE__, :stack_start_link, [{module, stack_opts}]},
      restart: :permanent
    }
  end

  @impl __MODULE__
  def shared_opts({module, opts}) do
    {module, module.shared_opts(opts)}
  end

  @impl __MODULE__
  def for_shape(shape_handle, {mod, opts}) do
    {mod, mod.for_shape(shape_handle, opts)}
  end

  @impl __MODULE__
  def stack_start_link({mod, opts} = storage) do
    Electric.StackConfig.put(opts.stack_id, __MODULE__, storage)
    mod.stack_start_link(opts)
  end

  @impl __MODULE__
  def start_link({mod, shape_opts}) do
    mod.start_link(shape_opts)
  end

  @impl __MODULE__
  def init_writer!({mod, shape_opts}, shape_definition, storage_recovery_state \\ nil) do
    {mod, mod.init_writer!(shape_opts, shape_definition, storage_recovery_state)}
  end

  @impl __MODULE__
  def get_all_stored_shape_handles({mod, opts}) do
    mod.get_all_stored_shape_handles(opts)
  end

  @impl __MODULE__
  def get_all_stored_shapes({mod, opts}) do
    mod.get_all_stored_shapes(opts)
  end

  @impl __MODULE__
  def metadata_backup_dir({mod, opts}) do
    mod.metadata_backup_dir(opts)
  end

  @impl __MODULE__
  def get_total_disk_usage({mod, opts}) do
    mod.get_total_disk_usage(opts)
  end

  @impl __MODULE__
  def get_current_position({mod, shape_opts}) do
    mod.get_current_position(shape_opts)
  end

  @impl __MODULE__
  def set_pg_snapshot(pg_snapshot, {mod, shape_opts}) do
    mod.set_pg_snapshot(pg_snapshot, shape_opts)
  end

  @impl __MODULE__
  def snapshot_started?({mod, shape_opts}) do
    mod.snapshot_started?(shape_opts)
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
    {mod, mod.append_to_log!(log_items, shape_opts)}
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
  def terminate({mod, writer_state}) do
    mod.terminate(writer_state)
  end

  @impl __MODULE__
  def hibernate({mod, writer_state}) do
    {mod, mod.hibernate(writer_state)}
  end

  @impl __MODULE__
  def cleanup!({mod, shape_opts}) do
    mod.cleanup!(shape_opts)
  end

  @impl __MODULE__
  def cleanup!({mod, stack_opts}, shape_handle) do
    mod.cleanup!(stack_opts, shape_handle)
  end

  @impl __MODULE__
  def cleanup_all!({mod, opts}) do
    mod.cleanup_all!(opts)
  end

  @impl __MODULE__
  def compact({mod, shape_opts}, keep_complete_chunks \\ 2)
      when is_integer(keep_complete_chunks) and keep_complete_chunks >= 0 do
    mod.compact(shape_opts, keep_complete_chunks)
  end

  def trigger_compaction(server, {module, _opts}, keep_complete_chunks \\ 2)
      when is_integer(keep_complete_chunks) and keep_complete_chunks >= 0 do
    send(server, {__MODULE__, {module, :compact, [keep_complete_chunks]}})
  end
end
