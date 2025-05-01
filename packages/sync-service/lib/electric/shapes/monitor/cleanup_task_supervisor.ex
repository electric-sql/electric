defmodule Electric.Shapes.Monitor.CleanupTaskSupervisor do
  require Logger

  alias Electric.ShapeCache.Storage

  def child_spec(opts) do
    {:ok, stack_id} = Keyword.fetch(opts, :stack_id)

    %{
      id: {__MODULE__, stack_id},
      start: {Task.Supervisor, :start_link, [[name: name(stack_id)]]},
      type: :supervisor
    }
  end

  def name(stack_id) do
    Electric.ProcessRegistry.name(stack_id, __MODULE__)
  end

  def cleanup(stack_id, storage_impl, shape_handle) do
    Task.Supervisor.start_child(name(stack_id), fn ->
      Logger.metadata(shape_handle: shape_handle, stack_id: stack_id)
      cleanup_shape(storage_impl, shape_handle)
    end)
  end

  defp cleanup_shape(storage_impl, shape_handle) do
    Logger.debug("cleaning shape data #{inspect(shape_handle)}")

    shape_handle
    |> Storage.for_shape(storage_impl)
    |> Storage.unsafe_cleanup!()
  catch
    exception -> Logger.error(exception)
  end
end
