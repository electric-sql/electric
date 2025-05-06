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

  def cleanup(
        stack_id,
        storage_impl,
        publication_manager_impl,
        shape_status_impl,
        shape_handle,
        shape,
        on_cleanup
      ) do
    Task.Supervisor.start_child(name(stack_id), fn ->
      Logger.metadata(shape_handle: shape_handle, stack_id: stack_id)

      try do
        {publication_manager, publication_manager_opts} = publication_manager_impl
        {shape_status, shape_status_state} = shape_status_impl

        Logger.debug("cleaning shape data #{inspect(shape_handle)}")

        shape_status.remove_shape(shape_status_state, shape_handle)
        publication_manager.remove_shape(shape, publication_manager_opts)

        shape_handle
        |> Storage.for_shape(storage_impl)
        |> Storage.unsafe_cleanup!()
      catch
        exception -> Logger.error(exception)
      after
        on_cleanup.(shape_handle)
      end
    end)
  end
end
