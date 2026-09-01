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

  ## Mechanism

  Around each bounded socket write, the request handler arms a BIF timer
  (`:erlang.start_timer/3`) addressed at this server and cancels it when the
  write completes. Timers are per-scheduler O(1) and a cancelled timer never
  sends anything, so this server's load is proportional to *stalls* — the
  rare event it exists for — rather than to write throughput, and deadlines
  fire exactly rather than with sweep slack.

  A fired timer is only acted on if the handler's process dictionary still
  carries that exact timer ref: the handler stamps the ref when arming and
  deletes it when the write completes, so a timeout message racing a
  completed write (or landing after the same process has moved on to another
  request on a keepalive connection) is a no-op rather than a wrong kill.

  ## What a kill must clean up

  `Process.exit(pid, :kill)` destroys the handler without running another
  instruction, so this server takes over the accounting the handler can no
  longer do. From the same dictionary snapshot used for the ref check it
  reads the handler's admission permit (see
  `Electric.AdmissionControl.permit_pd_key/0`), then monitors, kills, and on
  observing the `:killed` exit releases the permit and emits a
  `[:electric, :plug, :serve_shape, :reaped]` telemetry event with the stack
  and shape — otherwise reaped serves would be invisible to request metrics
  (the handler's own telemetry emission dies with it) and would permanently
  leak their admission slot. There is a theoretical window in which the
  handler completes its entire serve and releases its own permit between the
  dictionary snapshot and the kill landing — accepted, like the analogous
  arm/fire boundary race, as it requires the whole remainder of a serve to
  execute in the microseconds after its current write has already overrun a
  deadline measured in tens of seconds.

  The handler's root OTel span is not ended by the kill; orphaned spans are
  dropped by the SDK's sweeper.

  ## Scope

  Serves are only guarded under adapters where the plug runs in the
  socket-owning process (Bandit HTTP/1) — see `Response.send_stream/2` for
  the gate. Arming toward a stack without a running server is a silent
  no-op, so serving degrades to unguarded rather than failing; if this
  server restarts, in-flight serves re-arm toward it on their next write.
  """
  use GenServer

  require Logger

  @write_ref_key {__MODULE__, :write_ref}

  def start_link(opts) do
    stack_id = Keyword.fetch!(opts, :stack_id)
    GenServer.start_link(__MODULE__, stack_id, name: name(stack_id))
  end

  def name(stack_id) do
    Electric.ProcessRegistry.name(stack_id, __MODULE__)
  end

  @doc """
  Resolve the watchdog for a stack, or nil if none is running — including
  when the stack's process registry itself is absent, so callers uniformly
  degrade to unguarded serving.
  """
  def resolve(stack_id) do
    GenServer.whereis(name(stack_id))
  rescue
    ArgumentError -> nil
  end

  @doc """
  Arm a deadline for a socket write the calling process is about to make.

  Returns the timer ref to pass to `disarm/1` once the write completes.
  """
  def arm(watchdog, shape_handle, timeout_ms) when is_pid(watchdog) do
    ref = :erlang.start_timer(timeout_ms, watchdog, {:stalled_write, self(), shape_handle})
    Process.put(@write_ref_key, ref)
    ref
  end

  @doc """
  Disarm a deadline after the write completed.

  Clearing the stamped ref before cancelling matters: with an asynchronous
  cancel, the timer may already have fired, and the stale stamp would
  otherwise make the in-flight timeout message kill a handler whose write
  completed.
  """
  def disarm(ref) do
    Process.delete(@write_ref_key)
    :erlang.cancel_timer(ref, async: true, info: false)
    :ok
  end

  @impl GenServer
  def init(stack_id) do
    Process.set_label({:serve_watchdog, stack_id})
    Logger.metadata(stack_id: stack_id)
    {:ok, %{stack_id: stack_id, pending_kills: %{}}}
  end

  @impl GenServer
  def handle_info({:timeout, ref, {:stalled_write, pid, shape_handle}}, state) do
    state =
      case Process.info(pid, :dictionary) do
        {:dictionary, dict} ->
          if List.keyfind(dict, @write_ref_key, 0) == {@write_ref_key, ref} do
            kill(pid, shape_handle, dict, state)
          else
            # The write completed (or the process moved on to another
            # request) before the cancel could beat the firing timer.
            state
          end

        # The handler died on its own; nothing to do.
        nil ->
          state
      end

    {:noreply, state}
  end

  def handle_info({:DOWN, mref, :process, _pid, reason}, state) do
    {entry, pending_kills} = Map.pop(state.pending_kills, mref)

    if entry && reason == :killed do
      release_permit(entry.permit)

      :telemetry.execute([:electric, :plug, :serve_shape, :reaped], %{count: 1}, %{
        stack_id: state.stack_id,
        shape_handle: entry.shape_handle
      })
    end

    {:noreply, %{state | pending_kills: pending_kills}}
  end

  defp kill(pid, shape_handle, dict, state) do
    permit =
      case List.keyfind(dict, Electric.AdmissionControl.permit_pd_key(), 0) do
        {_key, permit} -> permit
        nil -> nil
      end

    Logger.warning(
      "Terminating stalled shape response serve: client did not accept an " <>
        "in-flight write within its deadline",
      shape_handle: shape_handle
    )

    mref = Process.monitor(pid)

    # The handler is blocked inside a socket write and cannot process
    # messages, so only an untrappable exit can terminate it. The permit
    # release and reap telemetry happen when the resulting :killed exit is
    # observed, standing in for the cleanup the killed handler can no
    # longer run itself.
    Process.exit(pid, :kill)

    %{
      state
      | pending_kills:
          Map.put(state.pending_kills, mref, %{permit: permit, shape_handle: shape_handle})
    }
  end

  defp release_permit({stack_id, kind}), do: Electric.AdmissionControl.release(stack_id, kind)
  defp release_permit(nil), do: :ok
end
