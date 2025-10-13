defmodule Electric.AsyncDeleter do
  @moduledoc """
  A GenServer that batches file/directory deletions by first moving them into a
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

  defstruct [
    :stack_id,
    :interval_ms,
    timer_ref: nil,
    pending: []
  ]

  @trash_dir_base ".electric_trash"
  @default_cleanup_interval_ms 10_000

  def name(stack_id) when is_binary(stack_id),
    do: Electric.ProcessRegistry.name(stack_id, __MODULE__)

  def name(opts), do: name(opts[:stack_id])

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

    Process.set_label({:async_deleter, stack_id})
    Electric.Telemetry.Sentry.set_tags_context(stack_id: stack_id)

    state = %__MODULE__{
      stack_id: stack_id,
      interval_ms: Keyword.get(opts, :cleanup_interval_ms, @default_cleanup_interval_ms),
      timer_ref: nil,
      pending: []
    }

    {:ok, state, {:continue, :initial_cleanup}}
  end

  @impl true
  def handle_continue(:initial_cleanup, state) do
    {:noreply, do_cleanup(state)}
  end

  # schedule timer if not already running
  def handle_continue(:schedule_cleanup, %{timer_ref: nil} = state) do
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
  def handle_info(:perform_delete, state) do
    {:noreply, do_cleanup(state)}
  end

  def trash_dir!(stack_id) do
    if trash_dir = Electric.StackConfig.get(stack_id, {__MODULE__, :trash_dir}) do
      trash_dir
    else
      raise RuntimeError,
        message: "#{inspect(__MODULE__)} config is missing for stack #{stack_id}"
    end
  end

  def trash_dir(storage_dir, stack_id), do: Path.join([storage_dir, @trash_dir_base, stack_id])

  defp do_rename(path, trash_dir) do
    dest = unique_destination(trash_dir, Path.basename(path))

    with :ok <- File.mkdir_p(trash_dir),
         :ok <- File.rename(path, dest) do
      {:ok, dest}
    end
  end

  defp do_cleanup(state) do
    # Remove the entire trash dir contents in one go
    if state.pending != [] do
      start_time = System.monotonic_time(:millisecond)

      try do
        clean_dir!(trash_dir!(state.stack_id))
      rescue
        e -> Logger.warning("AsyncDeleter: rm_rf failed: #{inspect(e)}")
      end

      duration = System.monotonic_time(:millisecond) - start_time

      Logger.debug(
        "AsyncDeleter: deleted #{length(state.pending)} paths " <>
          "for stack #{state.stack_id} in #{duration}ms"
      )
    end

    %{state | pending: [], timer_ref: nil}
  end

  def clean_dir!(path) do
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
