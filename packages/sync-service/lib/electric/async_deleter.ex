defmodule Electric.AsyncDeleter do
  @moduledoc """
  A service that batches file/directory deletions by first moving them into a
  per-stack trash directory and then, after a configurable interval, removing
  the trash directory contents in one `rm -rf` operation.

  This reduces filesystem churn when many deletes happen in quick succession
  (e.g. cache eviction) and avoids blocking callers: `delete/1` returns after a
  quick `File.rename/2` into the trash directory.

  Configuration:

    * `:cleanup_interval_ms` - interval in milliseconds after the
       first queued delete before the batch is removed. Defaults to 10000 ms.
  """

  require Logger

  use GenServer
  require Logger

  defstruct [
    :stack_id,
    :interval_ms,
    timer_ref: nil,
    cleanup_task: nil,
    pending: [],
    in_progress: []
  ]

  @trash_dir_base ".electric_trash"
  @default_cleanup_interval_ms 10_000

  def name(stack_id) when is_binary(stack_id),
    do: Electric.ProcessRegistry.name(stack_id, __MODULE__)

  def start_link(opts) do
    stack_id = Keyword.fetch!(opts, :stack_id)
    {storage_dir, opts} = Keyword.pop(opts, :storage_dir)
    Electric.StackConfig.put(stack_id, {__MODULE__, :trash_dir}, trash_dir(storage_dir, stack_id))

    GenServer.start_link(__MODULE__, opts, name: name(stack_id))
  end

  @doc """
  Deletes a file or directory using rm -rf.
  Returns {:ok, output} on success or {:error, reason} on failure.
  """
  def delete(path, opts) when is_binary(path) do
    stack_id =
      opts[:stack_id] ||
        raise ArgumentError, message: "Missing required :stack_id in opts: #{inspect(opts)}"

    trash_dir = trash_dir!(stack_id)

    case do_rename(path, trash_dir) do
      {:ok, _dest} ->
        server = opts[:server] || name(stack_id)
        GenServer.cast(server, {:schedule_cleanup, path})
        :ok

      {:error, :enoent} ->
        Logger.debug("AsyncDeleter: path already gone #{path}")
        :ok

      {:error, reason} ->
        Logger.warning("AsyncDeleter: rename failed for #{path}: #{inspect(reason)}")
        {:error, reason}
    end
  end

  @impl true
  def init(opts) do
    stack_id = Keyword.fetch!(opts, :stack_id)

    Process.set_label({:async_deleter_request_handler, stack_id})
    Logger.metadata(stack_id: stack_id)
    Electric.Telemetry.Sentry.set_tags_context(stack_id: stack_id)

    state = %__MODULE__{
      stack_id: stack_id,
      interval_ms: Keyword.get(opts, :cleanup_interval_ms, @default_cleanup_interval_ms)
    }

    File.mkdir_p(trash_dir!(stack_id))

    {:ok, state, {:continue, :initial_cleanup}}
  end

  @impl true
  def handle_continue(:initial_cleanup, state) do
    {:noreply, do_cleanup(state)}
  end

  # schedule cleanup if not already scheduled and no cleanup is running
  def handle_continue(:schedule_cleanup, %{timer_ref: nil, cleanup_task: nil} = state) do
    Logger.debug("AsyncDeleter: scheduling cleanup in #{state.interval_ms}ms")

    {:noreply,
     %{state | timer_ref: Process.send_after(self(), :perform_delete, state.interval_ms)}}
  end

  def handle_continue(:schedule_cleanup, state), do: {:noreply, state}

  @impl true
  def handle_cast({:schedule_cleanup, path}, state) do
    {:noreply, %{state | pending: [path | state.pending]}, {:continue, :schedule_cleanup}}
  end

  defp unique_destination(trash_dir, base) do
    attempt = Path.join(trash_dir, base <> "_" <> random_suffix())

    if File.exists?(attempt) do
      unique_destination(trash_dir, base)
    else
      attempt
    end
  end

  defp random_suffix, do: System.unique_integer([:positive]) |> to_string()

  @impl true
  def handle_info(:perform_delete, %{cleanup_task: nil} = state) do
    state = do_cleanup(state)
    {:noreply, %{state | timer_ref: nil}}
  end

  def handle_info({ref, :ok}, %{cleanup_task: {%Task{ref: ref}, start_time}} = state) do
    duration = System.monotonic_time(:millisecond) - start_time

    Logger.debug(
      "AsyncDeleter: deleted #{length(state.pending)} paths " <>
        "for stack #{state.stack_id} in #{duration}ms"
    )

    {:noreply, %{state | in_progress: [], cleanup_task: nil}, {:continue, :schedule_cleanup}}
  end

  def handle_info(
        {:DOWN, ref, :process, _pid, reason},
        %{cleanup_task: {%Task{ref: ref}, start_time}} = state
      ) do
    duration = System.monotonic_time(:millisecond) - start_time

    Logger.warning(
      "AsyncDeleter: failed to delete #{length(state.pending)} paths " <>
        "for stack #{state.stack_id} after #{duration}ms with reason: #{inspect(reason)}" <>
        " - will retry on next scheduled cleanup."
    )

    {:noreply,
     %{
       state
       | pending: Enum.concat(state.in_progress, state.pending),
         in_progress: [],
         cleanup_task: nil
     }, {:continue, :schedule_cleanup}}
  end

  # ignore down messages for normal task termination, already handled in result message
  def handle_info({:DOWN, _ref, :process, _pid, :normal}, state), do: {:noreply, state}

  @impl true
  def terminate(reason, state) do
    if not is_nil(state.cleanup_task) do
      Logger.debug("AsyncDeleter: terminating, killing cleanup task due to #{inspect(reason)}")
      {task, _start_time} = state.cleanup_task
      Task.shutdown(task, 1_000)
    end
  end

  def trash_dir!(stack_id) do
    Electric.StackConfig.lookup(stack_id, {__MODULE__, :trash_dir})
  rescue
    ArgumentError ->
      raise RuntimeError,
        message: "#{inspect(__MODULE__)} config is missing for stack #{stack_id}"
  end

  def trash_dir(storage_dir, stack_id), do: Path.join([storage_dir, @trash_dir_base, stack_id])

  defp do_rename(path, trash_dir) do
    dest = unique_destination(trash_dir, Path.basename(path))

    with :ok <- :prim_file.rename(path, dest) do
      {:ok, dest}
    end
  end

  defp do_cleanup(%{pending: []} = state), do: state

  defp do_cleanup(state) do
    start_time = System.monotonic_time(:millisecond)

    task =
      Task.async(fn ->
        Process.set_label({:async_deleter_cleanup_task, state.stack_id})
        Logger.metadata(stack_id: state.stack_id)
        Electric.Telemetry.Sentry.set_tags_context(stack_id: state.stack_id)

        trash_dir = trash_dir!(state.stack_id)
        Logger.debug("AsyncDeleter: Cleaning trash directory #{inspect(trash_dir)}")

        try do
          clean_dir!(trash_dir)
        rescue
          e -> Logger.warning("AsyncDeleter: rm_rf failed: #{inspect(e)}")
        end
      end)

    Process.unlink(task.pid)

    %{
      state
      | pending: [],
        in_progress: state.pending,
        cleanup_task: {task, start_time}
    }
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
