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
  def for_shape(shape_handle, {parent, init, storage}) do
    send(parent, {__MODULE__, :for_shape, shape_handle})
    shape_init = Map.get(init, shape_handle, [])
    {parent, shape_handle, shape_init, Storage.for_shape(shape_handle, storage)}
  end

  @impl Electric.ShapeCache.Storage
  def stack_start_link({_parent, _init, storage}), do: Storage.stack_start_link(storage)

  @impl Electric.ShapeCache.Storage
  def start_link({_parent, _shape_handle, _shape_init, storage}) do
    Storage.start_link(storage)
  end

  @impl Electric.ShapeCache.Storage
  def init_writer!({parent, shape_handle, init, storage}, shape_definition) do
    send(parent, {__MODULE__, :init_writer!, shape_handle, shape_definition})

    {module, opts} = storage

    with state <- Storage.init_writer!(storage, shape_definition) do
      for {name, args} <- init do
        apply(module, name, args ++ [opts])
      end

      {parent, shape_handle, init, state}
    end
  end

  @impl Electric.ShapeCache.Storage
  def get_all_stored_shapes({parent, _init, storage}) do
    send(parent, {__MODULE__, :get_all_stored_shapes})
    Storage.get_all_stored_shapes(storage)
  end

  @impl Electric.ShapeCache.Storage
  def get_total_disk_usage({parent, _init, storage}) do
    send(parent, {__MODULE__, :get_total_disk_usage})
    Storage.get_total_disk_usage(storage)
  end

  @impl Electric.ShapeCache.Storage
  def get_current_position({parent, shape_handle, _, storage}) do
    send(parent, {__MODULE__, :get_current_position, shape_handle})
    Storage.get_current_position(storage)
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
  def cleanup!({parent, shape_handle, _, storage}) do
    send(parent, {__MODULE__, :cleanup!, shape_handle})
    Storage.cleanup!(storage)
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
end
