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
          {:set_snapshot_xmin, [123]},
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
  def start_link({_parent, _shape_handle, _shape_init, storage}) do
    Storage.start_link(storage)
  end

  @impl Electric.ShapeCache.Storage
  def initialise({parent, shape_handle, init, storage}) do
    send(parent, {__MODULE__, :initialise, shape_handle})

    {module, opts} = storage

    with :ok <- Storage.initialise(storage) do
      for {name, args} <- init do
        apply(module, name, args ++ [opts])
      end

      :ok
    end
  end

  @impl Electric.ShapeCache.Storage
  def set_shape_definition(shape, {parent, shape_handle, _, storage}) do
    send(parent, {__MODULE__, :set_shape_definition, shape_handle, shape})
    Storage.set_shape_definition(shape, storage)
  end

  @impl Electric.ShapeCache.Storage
  def get_all_stored_shapes({parent, _init, storage}) do
    send(parent, {__MODULE__, :get_all_stored_shapes})
    Storage.get_all_stored_shapes(storage)
  end

  @impl Electric.ShapeCache.Storage
  def get_current_position({parent, shape_handle, _, storage}) do
    send(parent, {__MODULE__, :get_current_position, shape_handle})
    Storage.get_current_position(storage)
  end

  @impl Electric.ShapeCache.Storage
  def set_snapshot_xmin(xmin, {parent, shape_handle, _, storage}) do
    send(parent, {__MODULE__, :set_snapshot_xmin, shape_handle, xmin})
    Storage.set_snapshot_xmin(xmin, storage)
  end

  @impl Electric.ShapeCache.Storage
  def snapshot_started?({parent, shape_handle, _, storage}) do
    send(parent, {__MODULE__, :snapshot_started?, shape_handle})
    Storage.snapshot_started?(storage)
  end

  @impl Electric.ShapeCache.Storage
  def get_snapshot({parent, shape_handle, _, storage}) do
    send(parent, {__MODULE__, :get_snapshot, shape_handle})
    Storage.get_snapshot(storage)
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
  def append_to_log!(log_items, {parent, shape_handle, _, storage}) do
    send(parent, {__MODULE__, :append_to_log!, shape_handle, log_items})
    Storage.append_to_log!(log_items, storage)
  end

  @impl Electric.ShapeCache.Storage
  def cleanup!({parent, shape_handle, _, storage}) do
    send(parent, {__MODULE__, :cleanup!, shape_handle})
    Storage.cleanup!(storage)
  end
end
