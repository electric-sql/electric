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

  use GenServer

  require Logger

  import Electric, only: [is_stack_id: 1]

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

  def name(stack_id), do: Electric.ProcessRegistry.name(stack_id, __MODULE__)

  def start_link(opts) do
    stack_id = Keyword.fetch!(opts, :stack_id)
    {storage_dir, opts} = Keyword.pop(opts, :storage_dir)
    Electric.StackConfig.put(stack_id, {__MODULE__, :trash_dir}, trash_dir(storage_dir, stack_id))

    GenServer.start_link(__MODULE__, opts, name: name(stack_id))
  end

  @doc """
  Deletes the given directory by first renaming it into the stack's trash directory
  then asynchronously removing the trash entry using rm -rf.
  """
  @spec delete(Electric.stack_id(), Path.t()) :: :ok | {:error, term()}
  def delete(stack_id, path) when is_stack_id(stack_id) and is_binary(path) do
    trash_dir = trash_dir!(stack_id)

    case do_rename(path, trash_dir) do
      {:ok, _dest} ->
        GenServer.cast(name(stack_id), {:schedule_cleanup, path})
        :ok

      {:error, :enoent} ->
        Logger.debug("AsyncDeleter: path already gone #{path}")
        :ok

      {:error, reason} ->
        # If this is happening then there's something bad going on and our
        # storage is just accruing.
        Logger.error("AsyncDeleter: rename failed for #{path}: #{inspect(reason)}")
        {:error, reason}
    end
  end

  @impl true
  def init(opts) do
    stack_id = Keyword.fetch!(opts, :stack_id)

    Process.set_label({:async_deleter_request_handler, stack_id})
    Logger.metadata(stack_id: stack_id)
    Electric.Telemetry.Sentry.set_tags_context(stack_id: stack_id)

    trash_dir = trash_dir!(stack_id)
    File.mkdir_p(trash_dir)

    state = %__MODULE__{
      stack_id: stack_id,
      interval_ms: Keyword.get(opts, :cleanup_interval_ms, @default_cleanup_interval_ms),
      pending: File.ls!(trash_dir)
    }

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
    suffix = System.unique_integer([:positive]) |> to_string()
    Path.join(trash_dir, base <> "_" <> suffix)
  end

  @impl true
  def handle_info(:perform_delete, %{cleanup_task: nil} = state) do
    state = do_cleanup(state)
    {:noreply, %{state | timer_ref: nil}}
  end

  def handle_info(:perform_delete, state) do
    Logger.debug("AsyncDeleter: cleanup already in progress, skipping scheduled cleanup")
    {:noreply, %{state | timer_ref: nil}}
  end

  def handle_info({ref, :ok}, %{cleanup_task: {%Task{ref: ref}, start_time}} = state) do
    duration = System.monotonic_time(:millisecond) - start_time

    Logger.debug(
      "AsyncDeleter: deleted #{length(state.in_progress)} paths " <>
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
       | pending: state.in_progress ++ state.pending,
         in_progress: [],
         cleanup_task: nil
     }, {:continue, :schedule_cleanup}}
  end

  # ignore down messages for normal task termination, already handled in result message
  def handle_info({:DOWN, _ref, :process, _pid, :normal}, state), do: {:noreply, state}

  @impl true
  def terminate(reason, state) do
    # We want to avoid AsyncDeleter being brought back up while a cleanup task is still running,
    # which could lead to concurrent `rm_rf` calls on the trash directory, so we explicitly kill
    # it as part of this process termination.
    if not is_nil(state.cleanup_task) do
      Logger.debug("AsyncDeleter: terminating, killing cleanup task due to #{inspect(reason)}")
      {task, _start_time} = state.cleanup_task
      Task.shutdown(task, 1_000)
    end
  end

  def trash_dir!(stack_id) do
    Electric.StackConfig.lookup!(stack_id, {__MODULE__, :trash_dir})
  end

  def trash_dir(storage_dir, stack_id), do: Path.join([storage_dir, @trash_dir_base, stack_id])

  defp do_rename(path, trash_dir, attempts \\ 3) do
    dest = unique_destination(trash_dir, Path.basename(path))

    case :prim_file.rename(path, dest) do
      :ok -> {:ok, dest}
      # in the unlikely event of a name collision, retry with a new name
      # rather than incur the cost of ensuring uniqueness on every rename
      {:error, :eexist} when attempts > 0 -> do_rename(path, trash_dir, attempts - 1)
      {:error, reason} -> {:error, reason}
    end
  end

  defp do_cleanup(%{pending: []} = state), do: state

  defp do_cleanup(state) do
    start_time = System.monotonic_time(:millisecond)
    stack_id = state.stack_id

    task =
      Task.async(fn ->
        Process.set_label({:async_deleter_cleanup_task, stack_id})
        Logger.metadata(stack_id: stack_id)
        Electric.Telemetry.Sentry.set_tags_context(stack_id: stack_id)

        trash_dir = trash_dir!(stack_id)
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
