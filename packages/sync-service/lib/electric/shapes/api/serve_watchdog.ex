defmodule Electric.Shapes.Api.ServeWatchdog do
  @moduledoc """
  Terminates shape response serves whose clients stop accepting data.

  A serve writing to a socket whose peer stops draining blocks inside the
  socket write and cannot recover on its own: the kernel-level TCP send
  timeout fires only when a driver-level send makes no progress for its
  entire window, and in practice a connection draining even a trickle keeps
  resetting it. Such serves never complete, so they emit no telemetry, and
  each pins its in-flight response data and a file descriptor for as long as
  the connection survives — a population of them accumulates with connection
  count (reproduced in test/integration/stalled_serve_memory_test.exs).

  This server instead times the completion of each bounded application-level
  socket write: request handlers register before every write and deregister
  after it, and a periodic sweep terminates any handler whose in-flight
  write has outlived its deadline. The effective contract is a minimum
  sustained throughput — one bounded write unit per deadline window — which
  any live client trivially meets and a stalled one cannot. Write completion
  is quantized by the OS at up to a kernel send buffer of drain, so
  deadlines should comfortably exceed the time a healthy-but-slow client
  needs to drain one (the 60s default is ample). A terminated client can
  reconnect and resume from its last offset.

  Registration is cast-based: handlers never block on this server, and casts
  to a stack without a running instance are dropped, so serving degrades to
  unguarded rather than failing. If the server restarts, in-flight serves
  re-register on their next write, leaving at most one write unguarded.

  One instance runs per stack.
  """
  use GenServer

  require Logger

  @sweep_interval_ms 1_000

  def start_link(opts) do
    stack_id = Keyword.fetch!(opts, :stack_id)
    sweep_interval_ms = Keyword.get(opts, :sweep_interval_ms, @sweep_interval_ms)
    GenServer.start_link(__MODULE__, {stack_id, sweep_interval_ms}, name: name(stack_id))
  end

  def name(stack_id) do
    Electric.ProcessRegistry.name(stack_id, __MODULE__)
  end

  @doc """
  Register the calling process as being inside a socket write that must
  complete within `timeout_ms`.
  """
  def write_started(stack_id, shape_handle, timeout_ms) do
    deadline = System.monotonic_time(:millisecond) + timeout_ms
    GenServer.cast(name(stack_id), {:write_started, self(), deadline, timeout_ms, shape_handle})
  end

  @doc """
  Deregister the calling process's in-flight write.
  """
  def write_finished(stack_id) do
    GenServer.cast(name(stack_id), {:write_finished, self()})
  end

  @impl GenServer
  def init({stack_id, sweep_interval_ms}) do
    Process.set_label({:serve_watchdog, stack_id})
    Logger.metadata(stack_id: stack_id)
    schedule_sweep(sweep_interval_ms)
    {:ok, %{stack_id: stack_id, sweep_interval_ms: sweep_interval_ms, writes: %{}}}
  end

  @impl GenServer
  def handle_cast({:write_started, pid, deadline, timeout_ms, shape_handle}, state) do
    {:noreply,
     %{state | writes: Map.put(state.writes, pid, {deadline, timeout_ms, shape_handle})}}
  end

  def handle_cast({:write_finished, pid}, state) do
    {:noreply, %{state | writes: Map.delete(state.writes, pid)}}
  end

  @impl GenServer
  def handle_info(:sweep, state) do
    now = System.monotonic_time(:millisecond)

    writes =
      for {pid, {deadline, timeout_ms, shape_handle}} = entry <- state.writes,
          keep_entry?(pid, deadline, timeout_ms, shape_handle, now),
          into: %{} do
        entry
      end

    schedule_sweep(state.sweep_interval_ms)
    {:noreply, %{state | writes: writes}}
  end

  defp keep_entry?(pid, deadline, timeout_ms, shape_handle, now) do
    cond do
      # The handler died on its own (client disconnect, error); nothing to do.
      not Process.alive?(pid) ->
        false

      now > deadline ->
        Logger.warning(
          "Terminating stalled shape response serve: client accepted no data " <>
            "for #{timeout_ms}ms",
          shape_handle: shape_handle
        )

        # The handler is blocked inside a socket write and cannot process
        # messages, so only an untrappable exit can terminate it.
        Process.exit(pid, :kill)
        false

      true ->
        true
    end
  end

  defp schedule_sweep(interval_ms) do
    Process.send_after(self(), :sweep, interval_ms)
  end
end
