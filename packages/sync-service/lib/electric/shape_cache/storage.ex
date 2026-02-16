defmodule Electric.ShapeCache.Storage do
  @moduledoc false
  import Electric.Replication.LogOffset, only: [is_log_offset_lt: 2]

  alias Electric.Shapes.Shape
  alias Electric.Shapes.Querying
  alias Electric.Replication.LogOffset

  defmodule Error do
    defexception [:message]
  end

  @type shape_handle :: Electric.shape_handle()
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
  @callback init_writer!(shape_opts(), shape_definition :: Shape.t()) :: writer_state()

  @doc "Retrieve all stored shape handles"
  @callback get_all_stored_shape_handles(compiled_opts()) ::
              {:ok, MapSet.t(shape_handle())} | {:error, term()}

  @doc "Get the total disk usage for all shapes"
  @callback get_total_disk_usage(compiled_opts()) :: non_neg_integer()

  @doc """
  Get the latest offset for the shape storage.

  If the instance is new, then it MUST return `{:ok, LogOffset.last_before_real_offsets()}`.
  """
  @callback fetch_latest_offset(shape_opts()) :: {:ok, offset()} | {:error, term()}

  @doc """
  Get the current pg_snapshot for the shape storage.
  """
  @callback fetch_pg_snapshot(shape_opts()) :: {:ok, pg_snapshot() | nil} | {:error, term()}

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
  Write a move in snapshot to the storage. Should write it alongside the main log,
  with stiching being done via a separate call `append_move_in_snapshot_to_log!`.
  """
  @callback write_move_in_snapshot!(
              Enumerable.t({key :: String.t(), value :: Querying.json_iodata()}),
              name :: String.t(),
              shape_opts()
            ) :: :ok

  @doc """
  Splice a move in snapshot into the main log.

  Since snapshot doesn't have an offset associated, the offsets are inferred at splice time, and the range is returned.
  Range is a tuple of {starting_offset, ending_offset}, with starting offset being right before the first item in
  the snapshot to match usage of `get_log_stream/3`
  """
  @callback append_move_in_snapshot_to_log!(name :: String.t(), writer_state()) ::
              {inserted_range :: {LogOffset.t(), LogOffset.t()}, writer_state()} | no_return()

  @doc """
  Splice a move in snapshot into the main log with filtering.

  Rows are filtered using the touch_tracker: if a row's key has been touched by a transaction
  that is NOT visible in the snapshot, skip that row (stream has fresher data).

  Returns the inserted range (excluding skipped rows) and updated writer state.
  """
  @callback append_move_in_snapshot_to_log_filtered!(
              name :: String.t(),
              writer_state(),
              touch_tracker :: %{String.t() => pos_integer()},
              snapshot :: {pos_integer(), pos_integer(), [pos_integer()]},
              tags_to_skip :: MapSet.t(String.t())
            ) ::
              {inserted_range :: {LogOffset.t(), LogOffset.t()}, writer_state()} | no_return()

  @doc """
  Append a control message to the log that doesn't have an offset associated with it.

  Since control message doesn't have an offset associated, the offsets are inferred at append time,
  and the range is returned. Range is a tuple of {starting_offset, ending_offset}, with starting offset
  being right before the control message to match usage of `get_log_stream/3`
  """
  @callback append_control_message!(control_message :: map() | binary(), writer_state()) ::
              {inserted_range :: {LogOffset.t(), LogOffset.t()}, writer_state()} | no_return()

  @doc """
  Append log items from one transaction to the log.

  Each storage implementation is responsible for handling transient errors
  using some retry strategy.

  If the backend fails to write within the expected time, or some other error
  occurs, then this should raise.
  """
  @callback append_to_log!(Enumerable.t(log_item()), writer_state()) ::
              writer_state() | no_return()

  @doc """
  Append log items from a transaction fragment.

  Called potentially multiple times per transaction for shapes that stream
  fragments directly to storage without waiting for the complete transaction.
  Unlike `append_to_log!/2`, this does not assume transaction completion.

  Transaction commits should be signaled separately via `signal_txn_commit!/2`
  to allow storage to calculate chunk boundaries at transaction boundaries.
  """
  @callback append_fragment_to_log!(Enumerable.t(log_item()), writer_state()) ::
              writer_state() | no_return()

  @doc """
  Signal that a transaction has committed.

  Used by storage to calculate chunk boundaries at transaction boundaries.
  Called after all fragments for a transaction have been written via
  `append_fragment_to_log!/2`.
  """
  @callback signal_txn_commit!(xid :: pos_integer(), writer_state()) ::
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
  @callback terminate(writer_state()) :: any()

  @doc """
  Commit any pending writes to disk and close open resources that can be safely reopened later.
  """
  @callback hibernate(writer_state()) :: writer_state()

  @doc """
  Clean up snapshots/logs for a shape handle by deleting whole directory.

  Is expected to be only called once the storage has been stopped.
  """
  @callback cleanup!(shape_opts()) :: any()
  @callback cleanup!(compiled_opts(), shape_handle()) :: any()

  @doc """
  Cleanup all shape data and metadata from storage.
  """
  @callback cleanup_all!(shape_opts()) :: any()

  @doc """
  Whether this storage backend supports streaming transaction fragments
  directly to storage via `append_fragment_to_log!/2` and `signal_txn_commit!/2`.

  Storage backends that return `false` will only receive complete transactions
  via `append_to_log!/2`.
  """
  @callback supports_txn_fragment_streaming?() :: boolean()

  @doc """
  Compact operations in the log keeping the last N complete chunks intact
  """
  @callback compact(shape_opts(), keep_complete_chunks :: pos_integer()) :: :ok

  @behaviour __MODULE__

  @last_log_offset LogOffset.last()

  @doc """
  Apply a message to the writer state.

  In-process writer may send messages to self, in the form of
  `{#{inspect(__MODULE__)}, message}`, which must be handled using this function
  and the return of the function must be used as the new writer state.
  """
  def apply_message({mod, writer_state}, {m, f, a}) do
    {mod, apply(m, f, [writer_state | a])}
  end

  def for_stack(stack_id) do
    Electric.StackConfig.lookup!(stack_id, Electric.ShapeCache.Storage)
  end

  def opts_for_stack(stack_id) do
    {_module, opts} = Electric.StackConfig.lookup!(stack_id, Electric.ShapeCache.Storage)
    opts
  end

  def opt_for_stack(stack_id, opt_name) do
    opts = opts_for_stack(stack_id)
    Map.fetch!(opts, opt_name)
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
  def init_writer!({mod, shape_opts}, shape_definition) do
    {mod, mod.init_writer!(shape_opts, shape_definition)}
  end

  @impl __MODULE__
  def get_all_stored_shape_handles({mod, opts}) do
    mod.get_all_stored_shape_handles(opts)
  end

  @impl __MODULE__
  def get_total_disk_usage({mod, opts}) do
    mod.get_total_disk_usage(opts)
  end

  @impl __MODULE__
  def fetch_latest_offset({mod, shape_opts}) do
    mod.fetch_latest_offset(shape_opts)
  end

  @impl __MODULE__
  def fetch_pg_snapshot({mod, shape_opts}) do
    mod.fetch_pg_snapshot(shape_opts)
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
  def write_move_in_snapshot!(stream, name, {mod, shape_opts}) do
    mod.write_move_in_snapshot!(stream, name, shape_opts)
  end

  @impl __MODULE__
  def append_move_in_snapshot_to_log!(name, {mod, writer_state}) do
    {inserted_range, new_writer_state} = mod.append_move_in_snapshot_to_log!(name, writer_state)
    {inserted_range, {mod, new_writer_state}}
  end

  @impl __MODULE__
  def append_move_in_snapshot_to_log_filtered!(
        name,
        {mod, writer_state},
        touch_tracker,
        snapshot,
        tags_to_skip
      ) do
    {inserted_range, new_writer_state} =
      mod.append_move_in_snapshot_to_log_filtered!(
        name,
        writer_state,
        touch_tracker,
        snapshot,
        tags_to_skip
      )

    {inserted_range, {mod, new_writer_state}}
  end

  @impl __MODULE__
  def append_control_message!(control_message, state)
      when is_map(control_message) do
    append_control_message!(Jason.encode!(control_message), state)
  end

  def append_control_message!(control_message, {mod, writer_state})
      when is_binary(control_message) do
    {inserted_range, new_writer_state} =
      mod.append_control_message!(control_message, writer_state)

    {inserted_range, {mod, new_writer_state}}
  end

  @impl __MODULE__
  def append_to_log!(log_items, {mod, shape_opts}) do
    {mod, mod.append_to_log!(log_items, shape_opts)}
  end

  @impl __MODULE__
  def supports_txn_fragment_streaming? do
    raise "supports_txn_fragment_streaming?/0 should be called on a specific storage module, " <>
            "or use supports_txn_fragment_streaming?/1 with a storage tuple"
  end

  @doc """
  Check if a storage backend supports txn fragment streaming.

  Takes a storage tuple `{module, opts}` and delegates to the module's
  `supports_txn_fragment_streaming?/0` callback.
  """
  def supports_txn_fragment_streaming?({mod, _opts}) do
    mod.supports_txn_fragment_streaming?()
  end

  @impl __MODULE__
  def append_fragment_to_log!(log_items, {mod, shape_opts}) do
    {mod, mod.append_fragment_to_log!(log_items, shape_opts)}
  end

  @impl __MODULE__
  def signal_txn_commit!(xid, {mod, shape_opts}) do
    {mod, mod.signal_txn_commit!(xid, shape_opts)}
  end

  @impl __MODULE__
  def get_log_stream(offset, max_offset \\ @last_log_offset, storage)

  def get_log_stream(offset, max_offset, {mod, shape_opts})
      when max_offset == @last_log_offset or not is_log_offset_lt(max_offset, offset) do
    mod.get_log_stream(offset, max_offset, shape_opts)
  end

  def get_log_stream(offset, max_offset, _storage) when is_log_offset_lt(max_offset, offset) do
    []
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
