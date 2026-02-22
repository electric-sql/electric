defmodule Support.TestStorage do
  @moduledoc """
  Wraps a "real" storage backend with a notification system so that tests can
  assert calls to the storage backend.

  This is useful when mocking the storage doesn't work for some reason.

  You can initialise the backing storage for a given shape handle by passing a list
  of `{function_name :: atom(), args :: []}` calls to make against it after the
  `initialise/1` call.

  e.g.

      backing_storage = {Electric.ShapeCache.InMemoryStorage, []}
      # setup "shape-1" with a snapshot
      init = %{
        "shape-1" => [
          {:set_pg_snapshot, [%{xmin: 123, xmax: 124, xip_list: [123]}]},
          {:mark_snapshot_as_started, []},
          {:make_new_snapshot!, [
            # snapshot entries
          ]}
        ]
      }
      storage = Support.TestStorage.wrap(backing_storage, init)
  """
  alias Electric.ShapeCache.Storage

  @behaviour Electric.ShapeCache.Storage

  def wrap(storage, init, parent \\ self()) do
    {__MODULE__, {parent, init, storage}}
  end

  def backing_storage({__MODULE__, {_parent, _init, storage}}), do: storage

  @impl Electric.ShapeCache.Storage
  def shared_opts(_opts) do
    raise "don't use this, initialise the memory opts directly"
  end

  @impl Electric.ShapeCache.Storage
  def for_shape(shape_handle, {parent, init, stack_storage}) do
    send(parent, {__MODULE__, :for_shape, shape_handle})
    shape_init = Map.get(init, shape_handle, [])

    {parent, shape_handle, {shape_init, stack_storage},
     Storage.for_shape(shape_handle, stack_storage)}
  end

  @impl Electric.ShapeCache.Storage
  def stack_start_link({_parent, _init, storage}), do: Storage.stack_start_link(storage)

  @impl Electric.ShapeCache.Storage
  def start_link({_parent, _shape_handle, _shape_init, storage}) do
    Storage.start_link(storage)
  end

  @impl Electric.ShapeCache.Storage
  def init_writer!({parent, shape_handle, {init, _} = storage_init, storage}, shape_definition) do
    send(parent, {__MODULE__, :init_writer!, shape_handle, shape_definition})

    {module, opts} = storage

    with state <- Storage.init_writer!(storage, shape_definition) do
      for {name, args} <- init do
        apply(module, name, args ++ [opts])
      end

      {parent, shape_handle, storage_init, state}
    end
  end

  @impl Electric.ShapeCache.Storage
  def get_all_stored_shape_handles({parent, _init, storage}) do
    send(parent, {__MODULE__, :get_all_stored_shape_handles})
    Storage.get_all_stored_shape_handles(storage)
  end

  @impl Electric.ShapeCache.Storage
  def get_total_disk_usage({parent, _init, storage}) do
    send(parent, {__MODULE__, :get_total_disk_usage})
    Storage.get_total_disk_usage(storage)
  end

  @impl Electric.ShapeCache.Storage
  def fetch_latest_offset({parent, shape_handle, _, storage}) do
    send(parent, {__MODULE__, :fetch_latest_offset, shape_handle})
    Storage.fetch_latest_offset(storage)
  end

  @impl Electric.ShapeCache.Storage
  def fetch_pg_snapshot({parent, shape_handle, _, storage}) do
    send(parent, {__MODULE__, :fetch_pg_snapshot, shape_handle})
    Storage.fetch_pg_snapshot(storage)
  end

  @impl Electric.ShapeCache.Storage
  def set_pg_snapshot(pg_snapshot, {parent, shape_handle, _, storage}) do
    send(parent, {__MODULE__, :set_pg_snapshot, shape_handle, pg_snapshot})
    Storage.set_pg_snapshot(pg_snapshot, storage)
  end

  @impl Electric.ShapeCache.Storage
  def snapshot_started?({parent, shape_handle, _, storage}) do
    send(parent, {__MODULE__, :snapshot_started?, shape_handle})
    Storage.snapshot_started?(storage)
  end

  @impl Electric.ShapeCache.Storage
  def get_log_stream(offset, max_offset, {parent, shape_handle, _, storage}) do
    send(parent, {__MODULE__, :get_log_stream, shape_handle, offset, max_offset})
    Storage.get_log_stream(offset, max_offset, storage)
  end

  @impl Electric.ShapeCache.Storage
  def get_chunk_end_log_offset(offset, {parent, shape_handle, _, storage}) do
    send(parent, {__MODULE__, :get_chunk_end_log_offset, shape_handle, offset})
    Storage.get_chunk_end_log_offset(offset, storage)
  end

  @impl Electric.ShapeCache.Storage
  def make_new_snapshot!(data_stream, {parent, shape_handle, _, storage}) do
    send(parent, {__MODULE__, :make_new_snapshot!, shape_handle, data_stream})
    Storage.make_new_snapshot!(data_stream, storage)
  end

  @impl Electric.ShapeCache.Storage
  def mark_snapshot_as_started({parent, shape_handle, _, storage}) do
    send(parent, {__MODULE__, :mark_snapshot_as_started, shape_handle})
    Storage.mark_snapshot_as_started(storage)
  end

  @impl Electric.ShapeCache.Storage
  def append_to_log!(log_items, {parent, shape_handle, data, storage}) do
    send(parent, {__MODULE__, :append_to_log!, shape_handle, log_items})
    storage = Storage.append_to_log!(log_items, storage)
    {parent, shape_handle, data, storage}
  end

  @impl Electric.ShapeCache.Storage
  def supports_txn_fragment_streaming?, do: false

  @impl Electric.ShapeCache.Storage
  def append_fragment_to_log!(_, _) do
    raise "Intentionally not implemented. Use Support.StorageTracer instead"
  end

  @impl Electric.ShapeCache.Storage
  def signal_txn_commit!(_, _) do
    raise "Intentionally not implemented. Use Support.StorageTracer instead"
  end

  @impl Electric.ShapeCache.Storage
  def append_move_in_snapshot_to_log!(name, {parent, shape_handle, data, storage}) do
    send(parent, {__MODULE__, :append_move_in_snapshot_to_log!, shape_handle, name})
    {range, storage} = Storage.append_move_in_snapshot_to_log!(name, storage)
    {range, {parent, shape_handle, data, storage}}
  end

  @impl Electric.ShapeCache.Storage
  def append_move_in_snapshot_to_log_filtered!(
        name,
        {parent, shape_handle, data, storage},
        touch_tracker,
        snapshot,
        tags_to_skip
      ) do
    send(
      parent,
      {__MODULE__, :append_move_in_snapshot_to_log_filtered!, shape_handle, name, touch_tracker,
       snapshot, tags_to_skip}
    )

    {range, storage} =
      Storage.append_move_in_snapshot_to_log_filtered!(
        name,
        storage,
        touch_tracker,
        snapshot,
        tags_to_skip
      )

    {range, {parent, shape_handle, data, storage}}
  end

  @impl Electric.ShapeCache.Storage
  def append_control_message!(control_message, {parent, shape_handle, data, storage}) do
    send(parent, {__MODULE__, :append_control_message!, shape_handle, control_message})
    {range, storage} = Storage.append_control_message!(control_message, storage)
    {range, {parent, shape_handle, data, storage}}
  end

  @impl Electric.ShapeCache.Storage
  def write_move_in_snapshot!(stream, name, {parent, shape_handle, _data, storage}) do
    send(parent, {__MODULE__, :write_move_in_snapshot!, shape_handle, name, stream})
    Storage.write_move_in_snapshot!(stream, name, storage)
    :ok
  end

  @impl Electric.ShapeCache.Storage
  def cleanup!({parent, shape_handle, {init, stack_storage}, _storage}) do
    cleanup!({parent, init, stack_storage}, shape_handle)
  end

  @impl Electric.ShapeCache.Storage
  def cleanup!({parent, _, storage}, shape_handle) do
    send(parent, {__MODULE__, :cleanup!, shape_handle})
    Storage.cleanup!(storage, shape_handle)
  end

  @impl Electric.ShapeCache.Storage
  def cleanup_all!({parent, _init, storage}) do
    send(parent, {__MODULE__, :cleanup_all!})
    Storage.cleanup_all!(storage)
  end

  @impl Electric.ShapeCache.Storage
  def compact({parent, shape_handle, _, storage}, keep_complete_chunks) do
    send(parent, {__MODULE__, :compact, shape_handle, keep_complete_chunks})
    Storage.compact(storage, keep_complete_chunks)
  end

  @impl Electric.ShapeCache.Storage
  def terminate({parent, shape_handle, _, storage}) do
    send(parent, {__MODULE__, :terminate, shape_handle})
    Storage.terminate(storage)
  end

  @impl Electric.ShapeCache.Storage
  def hibernate({parent, shape_handle, data, storage}) do
    send(parent, {__MODULE__, :hibernate, shape_handle})
    storage = Storage.hibernate(storage)
    {parent, shape_handle, data, storage}
  end
end
