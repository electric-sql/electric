defmodule Electric.Telemetry.SystemMonitor do
  use GenServer
  require Logger

  def start_link(opts) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  def init(_) do
    # Monitor for: GC taking more than 500ms, process not interrupted for more than 500ms, message queue length > 1000
    :erlang.system_monitor(self(),
      long_gc: 500,
      long_schedule: 500,
      long_message_queue: {100, 1000}
    )

    :timer.send_interval(2000, :report_long_queues)

    {:ok, %{long_message_queue_pids: %{}}}
  end

  def handle_info({:monitor, gc_pid, :long_gc, info}, state) do
    Logger.debug(
      "Long GC detected for pid #{inspect(gc_pid)}: took #{Keyword.fetch!(info, :timeout)}ms. #{inspect(info, limit: :infinity)}"
    )

    %{type: type} = Electric.Debug.Process.type_and_memory(gc_pid)

    :telemetry.execute([:vm, :monitor, :long_gc], Map.new(info), %{process_type: type})
    {:noreply, state}
  end

  def handle_info({:monitor, port, :long_schedule, info}, state) when is_port(port) do
    Logger.debug(
      "Long schedule detected for port #{inspect(port)}, took #{Keyword.fetch!(info, :timeout)}ms"
    )

    :telemetry.execute(
      [:vm, :monitor, :long_schedule],
      %{timeout: Keyword.fetch!(info, :timeout)},
      %{process_type: :port}
    )

    {:noreply, state}
  end

  def handle_info({:monitor, pid, :long_schedule, info}, state) when is_pid(pid) do
    Logger.debug(
      "Long schedule detected for pid #{inspect(pid)}, took #{Keyword.fetch!(info, :timeout)}ms"
    )

    %{type: type} = Electric.Debug.Process.type_and_memory(pid)

    :telemetry.execute(
      [:vm, :monitor, :long_schedule],
      %{timeout: Keyword.fetch!(info, :timeout)},
      %{process_type: type}
    )

    {:noreply, state}
  end

  def handle_info({:monitor, pid, :long_message_queue, true}, state) do
    Logger.debug("Long message queue detected for pid #{inspect(pid)}")

    %{type: type} = Electric.Debug.Process.type_and_memory(pid)

    :telemetry.execute([:vm, :monitor, :long_message_queue], %{present: 1}, %{process_type: type})

    {:noreply,
     %{state | long_message_queue_pids: Map.put(state.long_message_queue_pids, pid, type)}}
  end

  def handle_info({:monitor, pid, :long_message_queue, false}, state) do
    Logger.debug("Long message queue no longer detected for pid #{inspect(pid)}")
    {:noreply, %{state | long_message_queue_pids: Map.delete(state.long_message_queue_pids, pid)}}
  end

  def handle_info(:report_long_queues, state) when state.long_message_queue_pids != %{} do
    for {_, type} <- state.long_message_queue_pids do
      :telemetry.execute([:vm, :monitor, :long_message_queue], %{present: 1}, %{
        process_type: type
      })
    end

    {:noreply, state}
  end

  def handle_info(:report_long_queues, state) do
    {:noreply, state}
  end
end
