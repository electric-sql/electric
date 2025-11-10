use Electric.Telemetry

with_telemetry Telemetry.Metrics do
  defmodule Electric.Telemetry.SystemMonitor do
    @moduledoc """
    Application-wide process that initializes Erlang's system monitor and consumes monitoring events.

    Currently the follow events are tracked:

      - long_gc
      - long_schedule
      - long_message_queue

    """

    use GenServer

    import Electric.Telemetry.Processes, only: [proc_type: 1]

    require Logger

    @vm_monitor_long_gc [:vm, :monitor, :long_gc]
    @vm_monitor_long_schedule [:vm, :monitor, :long_schedule]
    @vm_monitor_long_message_queue [:vm, :monitor, :long_message_queue]

    def start_link(opts) do
      GenServer.start_link(__MODULE__, opts.intervals_and_thresholds, name: __MODULE__)
    end

    def init(opts) do
      :erlang.system_monitor(self(),
        long_gc: opts.long_gc_threshold,
        long_schedule: opts.long_schedule_threshold,
        long_message_queue:
          {opts.long_message_queue_disable_threshold, opts.long_message_queue_enable_threshold}
      )

      {:ok, %{long_message_queue_pids: %{}, long_message_queue_timer: nil}}
    end

    def handle_info({:monitor, gc_pid, :long_gc, info}, state) do
      type = proc_type(gc_pid)

      Logger.debug(
        "Long GC detected for pid #{inspect(gc_pid)} (#{inspect(type)}): took #{Keyword.fetch!(info, :timeout)}ms. #{inspect(info, limit: :infinity)}"
      )

      :telemetry.execute(@vm_monitor_long_gc, Map.new(info), %{process_type: type})

      {:noreply, state}
    end

    def handle_info({:monitor, port, :long_schedule, info}, state) when is_port(port) do
      Logger.debug(
        "Long schedule detected for port #{inspect(port)}, took #{Keyword.fetch!(info, :timeout)}ms"
      )

      :telemetry.execute(@vm_monitor_long_schedule, Map.new(info), %{process_type: :port})

      {:noreply, state}
    end

    def handle_info({:monitor, pid, :long_schedule, info}, state) when is_pid(pid) do
      type = proc_type(pid)

      Logger.debug(fn ->
        locations =
          info
          |> Keyword.delete(:timeout)
          |> Map.new(fn {loc, {m, f, a}} when loc in [:in, :out] ->
            {loc, Exception.format_mfa(m, f, a)}
          end)

        locs_str =
          if map_size(locations) > 0 do
            "; " <>
              (locations |> Enum.map(fn {key, val} -> "#{key}: #{val}" end) |> Enum.join(", "))
          else
            ""
          end

        "Long schedule detected for pid #{inspect(pid)} (#{inspect(type)}), took #{Keyword.fetch!(info, :timeout)}ms" <>
          locs_str
      end)

      :telemetry.execute(@vm_monitor_long_schedule, %{timeout: Keyword.fetch!(info, :timeout)}, %{
        process_type: type
      })

      {:noreply, state}
    end

    def handle_info({:monitor, pid, :long_message_queue, true}, state) do
      type = proc_type(pid)

      Logger.debug("Long message queue detected for pid #{inspect(pid)} (#{inspect(type)})")

      log_long_message_queue_event(pid, type)

      state =
        %{state | long_message_queue_pids: Map.put(state.long_message_queue_pids, pid, type)}
        |> maybe_start_long_message_queue_timer()

      {:noreply, state}
    end

    def handle_info({:monitor, pid, :long_message_queue, false}, state) do
      Logger.debug("Long message queue no longer detected for pid #{inspect(pid)}")

      {:noreply,
       %{state | long_message_queue_pids: Map.delete(state.long_message_queue_pids, pid)}}
    end

    def handle_info(:recheck_message_queues, state)
        when map_size(state.long_message_queue_pids) == 0 do
      :timer.cancel(state.long_message_queue_timer)
      {:noreply, %{state | long_message_queue_timer: nil}}
    end

    def handle_info(:recheck_message_queues, state) do
      Enum.each(state.long_message_queue_pids, fn {pid, type} ->
        log_long_message_queue_event(pid, type)
      end)

      {:noreply, state}
    end

    defp log_long_message_queue_event(pid, type) do
      with {:message_queue_len, queue_len} <- Process.info(pid, :message_queue_len) do
        :telemetry.execute(@vm_monitor_long_message_queue, %{length: queue_len}, %{
          process_type: type
        })
      end
    end

    defp maybe_start_long_message_queue_timer(%{long_message_queue_timer: nil} = state) do
      # A process whose message queue length exceeds the threshold is likely to be spiraling out of
      # control. Therefore we need recheck it quite often to capture the dynamics.
      #
      # Though there's still no guarantee that the VM will not run out of memory before it
      # reaches the next metric export tick.
      {:ok, timer} = :timer.send_interval(200, :recheck_message_queues)

      %{state | long_message_queue_timer: timer}
    end

    defp maybe_start_long_message_queue_timer(state), do: state
  end
end
