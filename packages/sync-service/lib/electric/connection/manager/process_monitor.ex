defmodule Electric.Connection.Manager.ProcessMonitor do
  @moduledoc """
  Exists to allow child processes to synchronously register themselves and be
  monitored in their init/1 callback without deadlocks.

  DOWN messages are forwarded to the connection manager.
  """
  use GenServer

  def name(stack_id) when not is_map(stack_id) and not is_list(stack_id) do
    Electric.ProcessRegistry.name(stack_id, __MODULE__)
  end

  def start_link(stack_id) do
    GenServer.start_link(__MODULE__, stack_id, name: name(stack_id))
  end

  def monitor(stack_id, module, pid) do
    call_monitor(stack_id, {:monitor, module, pid})
  end

  # this process doesn't always exist in tests
  if Mix.env() == :test do
    defp call_monitor(stack_id, msg) do
      if monitor_pid = GenServer.whereis(name(stack_id)) do
        GenServer.call(monitor_pid, msg)
      else
        :ok
      end
    end
  else
    defp call_monitor(stack_id, msg) do
      GenServer.call(name(stack_id), msg)
    end
  end

  @impl GenServer
  def init(stack_id) do
    Process.set_label({:connection_manager_process_monitor, stack_id})

    {:ok, %{stack_id: stack_id}}
  end

  @impl GenServer
  def handle_call({:monitor, module, pid}, _from, state) do
    ref = Process.monitor(pid)

    state
    |> connection_manager!()
    |> send({:process_monitored, module, pid, ref})

    {:reply, :ok, state}
  end

  @impl GenServer
  def handle_info({:DOWN, _ref, :process, _pid, _reason} = down, state) do
    state
    |> connection_manager!()
    |> send(down)

    {:noreply, state}
  end

  defp connection_manager!(%{stack_id: stack_id}) do
    stack_id
    |> Electric.Connection.Manager.name()
    |> GenServer.whereis() || unreachable!(stack_id)
  end

  # unreachable because the owning supervisor is :rest_for_one and we start
  # after the connection manager
  defp unreachable!(stack_id) do
    raise RuntimeError, "Connection manager not found for stack: #{inspect(stack_id)}"
  end
end
