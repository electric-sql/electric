defmodule Electric.Shapes.Monitor.CleanupTaskSupervisor do
  require Logger

  alias Electric.ShapeCache.Storage

  @env Mix.env()

  # set a high timeout (except for tests) for the shape cleanup to terminate
  # we don't want to see errors due to e.g. a slow filesystem.
  # any actual errors in the processes will be caught and reported
  @cleanup_timeout if @env != :test, do: 60_000, else: 3_000

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
        shape_handle,
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
              set_task_metadata(stack_id, shape_handle)
              cleanup_shape_status(stack_id, shape_handle)
            end)

          task2 =
            Task.Supervisor.async(name(stack_id), fn ->
              set_task_metadata(stack_id, shape_handle)
              cleanup_shape_log_collector(stack_id, shape_handle)
            end)

          task3 =
            Task.Supervisor.async(name(stack_id), fn ->
              set_task_metadata(stack_id, shape_handle)
              cleanup_storage(storage_impl, shape_handle)
            end)

          task4 =
            Task.Supervisor.async(name(stack_id), fn ->
              set_task_metadata(stack_id, shape_handle)
              cleanup_publication_manager(publication_manager_impl, shape_handle)
            end)

          try do
            [task1, task2, task3, task4]
            |> Task.await_many(@cleanup_timeout)
          catch
            :exit, {:timeout, _} ->
              Logger.warning(
                "Shape cleanup tasks for shape #{shape_handle} timed out after #{@cleanup_timeout}ms"
              )

              :ok
          after
            on_cleanup.(shape_handle)
          end
        end)

      :ok
    end
  end

  defp cleanup_shape_status(stack_id, shape_handle) do
    case Electric.ShapeCache.ShapeStatus.remove_shape(stack_id, shape_handle) do
      {:ok, _shape} ->
        Logger.debug("Deregistered shape #{shape_handle}")

      {:error, _reason} ->
        # this is actually quite likely as during normal shutdown the shape is removed asap
        # this path is just to make sure we do that in case of a crash
        Logger.debug(["Shape already de-registered #{shape_handle}"])
    end
  end

  defp cleanup_shape_log_collector(stack_id, shape_handle) do
    case Electric.Replication.ShapeLogCollector.remove_shape_sync(stack_id, shape_handle) do
      :ok ->
        Logger.debug("Removed shape #{shape_handle} from ShapeLogCollector")

      {:error, _reason} ->
        Logger.debug(["Shape #{shape_handle} already removed from ShapeLogCollector"])
    end
  end

  defp cleanup_storage(
         storage_impl,
         shape_handle
       ) do
    perform_reporting_errors(
      fn -> Storage.cleanup!(storage_impl, shape_handle) end,
      "Failed to delete data for shape #{shape_handle}"
    )
  end

  defp cleanup_publication_manager(publication_manager_impl, shape_handle) do
    {publication_manager, publication_manager_opts} = publication_manager_impl

    perform_reporting_errors(
      fn ->
        publication_manager.remove_shape(shape_handle, publication_manager_opts)
      end,
      "Failed to remove shape #{shape_handle} from publication"
    )
  end

  defp set_task_metadata(stack_id, shape_handle) do
    metadata = [stack_id: stack_id, shape_handle: shape_handle]
    Logger.metadata(metadata)
    Electric.Telemetry.Sentry.set_tags_context(metadata)
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

  if @env == :test do
    # don't spam test logs with failures due to process shutdown
    defp log_error(:exit, _message) do
      :ok
    end
  else
    # don't spam sentry with errors caused by shutdown order (i.e. when the
    # publication manager has been shutdown)
    defp log_error(:exit, message) do
      Logger.log(:warning, message)
    end
  end

  defp log_error(:error, message) do
    Logger.log(:error, message)
  end
end
