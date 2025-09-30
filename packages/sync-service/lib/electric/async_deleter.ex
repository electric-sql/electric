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
    :trash_dir,
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
    GenServer.start_link(__MODULE__, opts, name: name(opts[:stack_id]))
  end

  @doc """
  Deletes a file or directory using rm -rf.
  Returns {:ok, output} on success or {:error, reason} on failure.
  """
  def delete(path, opts) when is_binary(path) do
    stack_id = opts[:stack_id]

    case do_rename(path, stack_id) do
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
      trash_dir: trash_dir(stack_id),
      interval_ms: Keyword.get(opts, :cleanup_interval_ms, @default_cleanup_interval_ms),
      timer_ref: nil,
      pending: []
    }

    File.mkdir_p!(state.trash_dir)

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

  def trash_dir(stack_id) do
    trash_base_dir =
      Application.get_env(:electric, :trash_dir) ||
        Path.join(
          Application.get_env(:electric, :storage_dir, System.tmp_dir!()),
          @trash_dir_base
        )

    Path.join(trash_base_dir, stack_id)
  end

  defp do_rename(path, stack_id) do
    trash_dir = trash_dir(stack_id)
    dest = unique_destination(trash_dir, Path.basename(path))

    with :ok <- File.mkdir_p!(trash_dir),
         :ok <- File.rename(path, dest) do
      {:ok, dest}
    end
  end

  defp do_cleanup(state) do
    # Remove the entire trash dir contents in one go
    start_time = System.monotonic_time(:millisecond)

    try do
      clean_dir!(state.trash_dir)
    rescue
      e -> Logger.warning("AsyncDeleter: rm_rf failed: #{inspect(e)}")
    end

    if state.pending != [] do
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
      full_path = Path.join(path, entry)
      unsafe_cleanup_with_retries!(full_path)
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
