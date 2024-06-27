defmodule Electric.Replication.ConnectionPoolObserver do
  use GenServer

  alias Electric.Replication.Connectors

  require Logger

  @spec name(Connectors.origin()) :: Electric.reg_name()
  def name(origin) do
    Electric.name(__MODULE__, origin)
  end

  def start_link(origin) do
    GenServer.start_link(__MODULE__, nil, name: name(origin))
  end

  def ready?(origin) do
    GenServer.call(name(origin), :ready?)
  end

  @impl GenServer
  def init(nil) do
    {:ok, %{connection_monitors: MapSet.new()}}
  end

  @impl GenServer
  def handle_call(:ready?, _from, state) do
    {:reply, MapSet.size(state.connection_monitors) > 0, state}
  end

  @impl GenServer
  def handle_info({:connected, pid}, state) do
    Logger.debug("New connection from the pool is ready")
    monitor = Process.monitor(pid)
    {:noreply, Map.update!(state, :connection_monitors, &MapSet.put(&1, monitor))}
  end

  def handle_info({:DOWN, monitor, :process, _pid, _reason}, state) do
    {:noreply, Map.update!(state, :connection_monitors, &MapSet.delete(&1, monitor))}
  end
end
