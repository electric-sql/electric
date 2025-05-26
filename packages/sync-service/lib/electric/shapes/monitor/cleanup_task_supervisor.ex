defmodule Electric.Shapes.Monitor.CleanupTaskSupervisor do
  require Logger

  alias Electric.ShapeCache.Storage

  @env Mix.env()

  # set a high timeout for the shape cleanup to terminate
  # we don't want to see errors due to e.g. a slow filesystem.
  # any actual errors in the processes will be caught and reported
  @cleanup_timeout 60_000

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
    if consumer_alive?(stack_id, shape_handle) do
      {:error, "Expected shape #{shape_handle} consumer to not be alive before cleaning shape"}
    else
      {:ok, _pid} =
        Task.Supervisor.start_child(name(stack_id), fn ->
          Logger.debug("Cleaning shape data for shape #{inspect(shape_handle)}")

          task1 =
            Task.Supervisor.async(name(stack_id), fn ->
              Logger.metadata(stack_id: stack_id, shape_handle: shape_handle)
              cleanup_shape_status(shape_status_impl, shape_handle)
            end)

          task2 =
            Task.Supervisor.async(name(stack_id), fn ->
              Logger.metadata(stack_id: stack_id, shape_handle: shape_handle)
              cleanup_storage(storage_impl, shape_handle)
            end)

          task3 =
            Task.Supervisor.async(name(stack_id), fn ->
              Logger.metadata(stack_id: stack_id, shape_handle: shape_handle)
              cleanup_publication_manager(publication_manager_impl, shape_handle, shape)
            end)

          try do
            [task1, task2, task3]
            |> Task.await_many(@cleanup_timeout)
          after
            on_cleanup.(shape_handle)
          end
        end)

      :ok
    end
  end

  defp cleanup_shape_status(shape_status_impl, shape_handle) do
    {shape_status, shape_status_state} = shape_status_impl

    case shape_status.remove_shape(shape_status_state, shape_handle) do
      {:ok, _shape} ->
        Logger.debug("Deregistered shape #{shape_handle}")

      {:error, _reason} ->
        # this is actually quite likely as during normal shutdown the shape is removed asap
        # this path is just to make sure we do that in case of a crash
        Logger.debug(["Shape already de-registered #{shape_handle}"])
    end
  end

  defp cleanup_storage(
         storage_impl,
         shape_handle
       ) do
    perform_reporting_errors(
      fn ->
        shape_handle
        |> Storage.for_shape(storage_impl)
        |> Storage.unsafe_cleanup!()
      end,
      "Failed to delete data for shape #{shape_handle}"
    )
  end

  defp cleanup_publication_manager(
         publication_manager_impl,
         shape_handle,
         shape
       ) do
    {publication_manager, publication_manager_opts} = publication_manager_impl

    perform_reporting_errors(
      fn ->
        publication_manager.remove_shape(shape_handle, shape, publication_manager_opts)
      end,
      "Failed to remove shape #{shape_handle} from publication"
    )
  end

  defp perform_reporting_errors(fun, message) do
    try do
      fun.()
    catch
      kind, reason when kind in [:exit, :error] ->
        log_error(kind, [message, ": ", Exception.format(kind, reason, __STACKTRACE__)])

        {:error, reason}
    end
  end

  defp consumer_alive?(stack_id, shape_handle) do
    !is_nil(Electric.Shapes.Consumer.whereis(stack_id, shape_handle))
  end

  # don't spam test logs with failures due to process shutdown
  if @env == :test do
    defp log_error(:exit, _message) do
      :ok
    end
  end

  defp log_error(_kind, message) do
    Logger.error(message)
  end
end
