defmodule Electric.Debug.ShutdownTimer do
  @moduledoc """
  TEMPORARY DEBUG MODULE - Remove after investigating slow shutdown.

  Wraps child specs to add shutdown timing logging.
  Also tracks snapshotter process count.
  """

  use GenServer
  require Logger

  @snapshotter_tracker __MODULE__.SnapshotterTracker

  # --- Snapshotter tracking ---

  def start_tracker do
    GenServer.start_link(__MODULE__, %{}, name: @snapshotter_tracker)
  end

  def snapshotter_started do
    GenServer.cast(@snapshotter_tracker, :started)
  end

  def snapshotter_stopped do
    GenServer.cast(@snapshotter_tracker, :stopped)
  end

  @impl true
  def init(_) do
    {:ok, %{count: 0}}
  end

  @impl true
  def handle_cast(:started, %{count: count} = state) do
    new_count = count + 1
    IO.puts("[SHUTDOWN DEBUG] Active snapshotters: #{new_count} (+1)")
    {:noreply, %{state | count: new_count}}
  end

  def handle_cast(:stopped, %{count: count} = state) do
    new_count = max(0, count - 1)
    IO.puts("[SHUTDOWN DEBUG] Active snapshotters: #{new_count} (-1)")
    {:noreply, %{state | count: new_count}}
  end

  # --- Sentinel processes for shutdown order tracking ---

  @doc """
  Inserts sentinel processes between each child in a list.
  Each sentinel logs when it terminates, indicating the next child is about to be terminated.
  Also adds a sentinel at the end to indicate termination is beginning.
  """
  def insert_sentinels(children, supervisor_name) do
    children_with_sentinels =
      children
      |> Enum.with_index()
      |> Enum.flat_map(fn {child, index} ->
        spec = Supervisor.child_spec(child, [])
        child_id = spec.id
        sentinel = sentinel_spec(supervisor_name, child_id, index)
        [sentinel, child]
      end)

    # Add a final sentinel at the end to indicate termination is beginning
    final_sentinel = sentinel_spec(supervisor_name, :termination_beginning, length(children))
    children_with_sentinels ++ [final_sentinel]
  end

  defp sentinel_spec(supervisor_name, next_child_id, index) do
    label = "#{supervisor_name} -> #{inspect(next_child_id)}"

    %{
      id: {__MODULE__.Sentinel, supervisor_name, index},
      start: {__MODULE__.Sentinel, :start_link, [label]},
      type: :worker,
      shutdown: 5000
    }
  end

  # --- Child wrapping for shutdown timing ---

  @doc """
  Wraps a list of child specs to log shutdown timing for each child.
  """
  def wrap_children(children) do
    Enum.map(children, &wrap_child/1)
  end

  @doc """
  Wraps a single child spec to log shutdown timing.
  """
  def wrap_child(child_spec) do
    spec = Supervisor.child_spec(child_spec, [])
    original_start = spec.start

    wrapped_start = {__MODULE__, :start_wrapped, [spec.id, original_start]}

    %{spec | start: wrapped_start}
  end

  @doc false
  def start_wrapped(child_id, {mod, fun, args}) do
    case apply(mod, fun, args) do
      {:ok, pid} ->
        spawn(fn -> monitor_for_shutdown(child_id, pid) end)
        {:ok, pid}

      other ->
        other
    end
  end

  defp monitor_for_shutdown(child_id, pid) do
    ref = Process.monitor(pid)

    receive do
      {:DOWN, ^ref, :process, ^pid, reason} ->
        Logger.warning(
          "[SHUTDOWN DEBUG] Process #{inspect(child_id)} (#{inspect(pid)}) terminated with reason: #{inspect(reason)}"
        )
    end
  end

  @doc """
  Call this in terminate/2 callback of a GenServer to log shutdown timing.
  Use this for processes where you want to measure how long terminate takes.
  """
  defmacro log_terminate_start(name) do
    quote do
      start_time = System.monotonic_time(:millisecond)
      Process.put(:shutdown_debug_start, {unquote(name), start_time})

      Logger.warning(
        "[SHUTDOWN DEBUG] #{unquote(name)} terminate/2 STARTED at #{inspect(self())}"
      )
    end
  end

  defmacro log_terminate_end(name) do
    quote do
      case Process.get(:shutdown_debug_start) do
        {_, start_time} ->
          elapsed = System.monotonic_time(:millisecond) - start_time

          Logger.warning(
            "[SHUTDOWN DEBUG] #{unquote(name)} terminate/2 FINISHED after #{elapsed}ms"
          )

        nil ->
          Logger.warning("[SHUTDOWN DEBUG] #{unquote(name)} terminate/2 FINISHED (no start time)")
      end
    end
  end
end

defmodule Electric.Debug.ShutdownTimer.Sentinel do
  @moduledoc false
  use GenServer

  def start_link(label) do
    GenServer.start_link(__MODULE__, label)
  end

  @impl true
  def init(label) do
    Process.flag(:trap_exit, true)
    {:ok, label}
  end

  @impl true
  def terminate(_reason, label) do
    IO.puts("[SHUTDOWN DEBUG] Sentinel: about to terminate #{label}")
    :ok
  end
end
