defmodule Electric.AsyncDeleter.CleanupTaskSupervisor do
  @moduledoc """
  A Task.Supervisor that runs asynchronous cleanup tasks to delete
  directories moved into trash.
  """

  require Logger

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

  @doc """
  Starts an asynchronous task to clean up the given trash directory and
  monitors it for completion.

  Returns a reference that can be used to handle task completion with a
  message like:

      {{:cleanup_task, ref, start_time}, task_ref, :process, pid, reason}
  """
  @spec cleanup_dir_async(Electric.stack_id(), Path.t()) :: reference()
  def cleanup_dir_async(stack_id, trash_dir) do
    ref = make_ref()
    start_time = System.monotonic_time(:millisecond)

    {:ok, pid} =
      Task.Supervisor.start_child(name(stack_id), fn ->
        Process.set_label({:async_deleter_cleanup_task, stack_id})
        Logger.metadata(stack_id: stack_id)
        Electric.Telemetry.Sentry.set_tags_context(stack_id: stack_id)

        Logger.debug("AsyncDeleter: Cleaning trash directory #{inspect(trash_dir)}")

        try do
          clean_dir!(trash_dir)
        rescue
          e -> Logger.warning("AsyncDeleter: rm_rf failed: #{inspect(e)}")
        end
      end)

    Process.monitor(pid, tag: {:cleanup_task, ref, start_time})

    ref
  end

  defp clean_dir!(path) do
    path
    |> File.ls!()
    |> Enum.each(fn entry ->
      path
      |> Path.join(entry)
      |> unsafe_cleanup_with_retries!()
    end)
  end

  defp unsafe_cleanup_with_retries!(directory, attempts_left \\ 5) do
    with {:ok, _} <- File.rm_rf(directory) do
      :ok
    else
      # There is a very unlikely but observed scenario where the rm_rf call
      # tries to delete a directory after having deleted all its files, but
      # due to some FS race the deletion fails with EEXIST. Very hard to test
      # and prevent so we mitigate it with arbitrary retries.
      {:error, :eexist, _} when attempts_left > 0 ->
        unsafe_cleanup_with_retries!(directory, attempts_left - 1)

      {:error, reason, path} ->
        raise File.Error,
          reason: reason,
          path: path,
          action: "remove files and directories recursively from"
    end
  end
end
