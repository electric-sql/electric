defmodule Electric.ShapeCache.ShapeCleaner.CleanupTaskSupervisor do
  require Logger

  @env Mix.env()

  # set a high timeout (except for tests) for the shape cleanup to terminate
  # we don't want to see errors due to e.g. a slow filesystem.
  # any actual errors in the processes will be caught and reported
  @cleanup_timeout if @env != :test, do: 60_000, else: 3_000

  def child_spec(opts) do
    {:ok, stack_id} = Keyword.fetch(opts, :stack_id)

    %{
      id: {__MODULE__, stack_id},
      start: {__MODULE__, :start_link, [opts]},
      type: :supervisor
    }
  end

  def start_link(opts) do
    {:ok, stack_id} = Keyword.fetch(opts, :stack_id)

    if on_cleanup_callback = Keyword.get(opts, :on_cleanup, nil) do
      Electric.StackConfig.put(
        stack_id,
        {Electric.ShapeCache.ShapeCleaner, :on_cleanup},
        on_cleanup_callback
      )
    end

    Task.Supervisor.start_link(name: name(stack_id))
  end

  def name(stack_id) do
    Electric.ProcessRegistry.name(stack_id, __MODULE__)
  end

  def perform_async(stack_id, fun) do
    with {:ok, _pid} <-
           Task.Supervisor.start_child(name(stack_id), fn ->
             set_task_metadata(stack_id)
             fun.()
           end) do
      :ok
    end
  end

  def cleanup_async(stack_id, shape_handles) when is_list(shape_handles) do
    perform_async(stack_id, fn ->
      cleanup_callback = on_cleanup_callback(stack_id)

      set_task_metadata(stack_id)

      tasks = [
        async(stack_id, shape_handles, &notify_shape_rotation/2),
        async(stack_id, shape_handles, &cleanup_publication_manager/2)
      ]

      try do
        Task.await_many(tasks, @cleanup_timeout)
      catch
        :exit, {:timeout, _} ->
          Logger.warning(
            "Shape cleanup tasks for #{length(shape_handles)} shapes timed out after #{@cleanup_timeout}ms"
          )

          :ok
      after
        Enum.each(shape_handles, cleanup_callback)
      end
    end)
  end

  defp notify_shape_rotation(stack_id, shape_handles) do
    Enum.each(shape_handles, fn shape_handle ->
      Registry.dispatch(
        Electric.StackSupervisor.registry_name(stack_id),
        shape_handle,
        fn registered ->
          Logger.debug(fn ->
            "Notifying ~#{length(registered)} clients about removal of shape #{shape_handle}"
          end)

          for {pid, ref} <- registered, do: send(pid, {ref, :shape_rotation})
        end
      )
    end)
  end

  defp cleanup_publication_manager(stack_id, shape_handles) do
    Enum.each(shape_handles, fn shape_handle ->
      perform_reporting_errors(
        fn ->
          Electric.Replication.PublicationManager.remove_shape(stack_id, shape_handle)
        end,
        "Failed to remove shape #{shape_handle} from publication"
      )
    end)
  end

  defp async(stack_id, shape_handles, fun) do
    Task.Supervisor.async(name(stack_id), fn ->
      set_task_metadata(stack_id)
      fun.(stack_id, shape_handles)
    end)
  end

  defp set_task_metadata(stack_id) do
    Logger.metadata(stack_id: stack_id)
    Electric.Telemetry.Sentry.set_tags_context(stack_id: stack_id)
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

  defp on_cleanup_callback(stack_id) do
    Electric.StackConfig.lookup(stack_id, {Electric.ShapeCache.ShapeCleaner, :on_cleanup}, fn _ ->
      :ok
    end)
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
