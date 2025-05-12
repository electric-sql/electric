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

  def cleanup_async(
        stack_id,
        storage_impl,
        publication_manager_impl,
        shape_status_impl,
        shape_handle,
        shape,
        on_cleanup \\ fn _ -> :ok end
      ) do
    with {:ok, _pid} <-
           Task.Supervisor.start_child(name(stack_id), fn ->
             Logger.metadata(shape_handle: shape_handle, stack_id: stack_id)

             try do
               cleanup(
                 stack_id,
                 storage_impl,
                 publication_manager_impl,
                 shape_status_impl,
                 shape_handle,
                 shape
               )
               |> case do
                 :ok ->
                   :ok

                 {:error, reason} ->
                   Logger.error(["Failed to clean shape #{shape_handle}: ", reason])
               end
             catch
               exception -> Logger.error(exception)
             after
               on_cleanup.(shape_handle)
             end
           end) do
      :ok
    end
  end

  defp cleanup(
         stack_id,
         storage_impl,
         publication_manager_impl,
         shape_status_impl,
         shape_handle,
         shape
       ) do
    if consumer_alive?(stack_id, shape_handle) do
      {:error, "Expected shape #{shape_handle} consumer to not be alive before cleaning shape"}
    else
      {publication_manager, publication_manager_opts} = publication_manager_impl
      {shape_status, shape_status_state} = shape_status_impl

      Logger.debug("cleaning shape data #{inspect(shape_handle)}")

      shape_status.remove_shape(shape_status_state, shape_handle)

      data_cleanup =
        perform_async_catching_errors(
          fn ->
            shape_handle
            |> Storage.for_shape(storage_impl)
            |> Storage.unsafe_cleanup!()
          end,
          "Failed to delete data for shape #{shape_handle}"
        )

      remove_shape =
        perform_async_catching_errors(
          fn ->
            publication_manager.remove_shape(shape_handle, shape, publication_manager_opts)
          end,
          "Failed to remove shape #{shape_handle} from publication"
        )

      [data_cleanup, remove_shape]
      |> Task.await_many(60000)
      |> Enum.find(:ok, &match?({:error, _}, &1))
    end
  end

  defp consumer_alive?(stack_id, shape_handle) do
    !is_nil(Electric.Shapes.Consumer.whereis(stack_id, shape_handle))
  end

  defp perform_async_catching_errors(fun, message) do
    Task.async(fn ->
      try do
        fun.()
      catch
        kind, reason when kind in [:exit, :error] ->
          Logger.error([message, ": ", Exception.format(kind, reason, __STACKTRACE__)])

          {:error, reason}
      end
    end)
  end
end
