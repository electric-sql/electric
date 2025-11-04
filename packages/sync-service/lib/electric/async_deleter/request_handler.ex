defmodule Electric.AsyncDeleter.RequestHandler do
  @moduledoc """
  A GenServer that handles batching of file/directory deletions and scheduling
  of the cleanup task.
  """
  use GenServer
  require Logger
  alias Electric.AsyncDeleter.CleanupTaskSupervisor

  defstruct [
    :stack_id,
    :interval_ms,
    timer_ref: nil,
    cleanup_task_ref: nil,
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
  def handle_info(:perform_delete, %{cleanup_task_ref: ref} = state) when is_reference(ref) do
    Logger.debug("AsyncDeleter: cleanup already in progress, rescheduling")
    {:noreply, %{state | timer_ref: nil}, {:continue, :schedule_cleanup}}
  end

  def handle_info(:perform_delete, state) do
    state = do_cleanup(state)
    {:noreply, %{state | timer_ref: nil}}
  end

  def handle_info(
        {{:cleanup_task, ref, start_time}, _ref, :process, _pid, :normal},
        %{cleanup_task_ref: ref} = state
      ) do
    duration = System.monotonic_time(:millisecond) - start_time

    Logger.debug(
      "AsyncDeleter: deleted #{length(state.pending)} paths " <>
        "for stack #{state.stack_id} in #{duration}ms"
    )

    {:noreply, %{state | in_progress: [], cleanup_task_ref: nil}}
  end

  def handle_info(
        {{:cleanup_task, ref, start_time}, _ref, :process, _pid, reason},
        %{cleanup_task_ref: ref} = state
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
         cleanup_task_ref: nil
     }, {:continue, :schedule_cleanup}}
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
    task_ref =
      CleanupTaskSupervisor.cleanup_dir_async(
        state.stack_id,
        trash_dir!(state.stack_id)
      )

    %{
      state
      | pending: [],
        in_progress: state.pending,
        cleanup_task_ref: task_ref
    }
  end
end
