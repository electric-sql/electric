defmodule Electric.Satellite.ClientManager do
  alias Electric.Replication.Connectors
  alias Electric.Replication.SatelliteConnector

  @moduledoc """
  Process manages resources for satellite connections
  """

  require Logger
  use GenServer

  defmodule State do
    defstruct clients: %{},
              resources: %{},
              reverse: %{}

    @type t() :: %__MODULE__{
            clients: %{pid() => {String.t(), reference()}},
            resources: %{pid() => {String.t(), reference()}},
            reverse: %{String.t() => {client_pid :: pid() | nil, resource_pid :: pid() | nil}}
          }
  end

  @spec start_link(any) :: :ignore | {:error, any} | {:ok, pid}
  def start_link(_) do
    GenServer.start_link(__MODULE__, [], name: __MODULE__)
  end

  @spec register_client(GenServer.server(), String.t(), Electric.reg_name()) ::
          :ok | {:error, term()}
  def register_client(server \\ __MODULE__, client_name, reg_name) do
    GenServer.call(server, {:register, client_name, reg_name})
  end

  def get_clients(server \\ __MODULE__) do
    GenServer.call(server, {:get_clients})
  end

  @impl GenServer
  def init(_) do
    {:ok, %State{}}
  end

  @impl GenServer
  def handle_call({:get_clients}, _, %State{} = state) do
    res =
      for {client, {client_pid, _sup_pid}} <- state.reverse do
        {client, client_pid}
      end

    {:reply, {:ok, res}, state}
  end

  def handle_call({:register, client_name, reg_name}, {client_pid, _}, %State{} = state) do
    with {:ok, sup_pid} <-
           Connectors.start_connector(
             SatelliteConnector,
             %{name: client_name, producer: reg_name}
           ) do
      client_ref = Process.monitor(client_pid)
      resource_ref = Process.monitor(sup_pid)

      clients = Map.put_new(state.clients, client_pid, client_ref)
      resources = Map.put_new(state.resources, sup_pid, resource_ref)
      reverse = Map.put_new(state.reverse, client_name, {client_pid, sup_pid})

      {:reply, :ok, %State{state | clients: clients, resources: resources, reverse: reverse}}
    else
      error ->
        {:reply, {:error, error}, state}
    end
  end

  @impl GenServer
  def handle_call(_, _, state) do
    {:reply, {:error, :not_implemented}, state}
  end

  @impl GenServer
  def handle_cast(_, state) do
    {:noreply, state}
  end

  @impl GenServer
  def handle_info({:DOWN, _ref, :process, client_pid, _}, state)
      when is_map_key(client_pid, state.clients) do
    # client connection have terminated, we can do something smart here if we
    # expect client to be reconnecting soon

    {{client_name, _}, clients} = Map.pop!(state.clients, client_pid)

    {{^client_pid, sup_pid}, reverse} = Map.pop!(state.reverse, client_name)

    resources =
      case Map.pop(state.resources, sup_pid) do
        # supervisor have already terminated
        {nil, map} ->
          map

        {{_, sup_ref}, map} ->
          _ = Connectors.stop_connector(sup_pid)
          Process.demonitor(sup_ref, [:flush])
          map
      end

    {:noreply, %State{state | clients: clients, reverse: reverse, resources: resources}}
  end

  def handle_info({:DOWN, sup_ref, :process, sup_pid, _}, state)
      when is_map_key(sup_pid, state.resources) do
    # supervisor with client resources have terminated, if client is still alive
    # - we should restart supervisor, or terminate the client if it's
    # missbehaving
    {{client_name, ^sup_ref}, resources} = Map.pop!(state.resources, sup_pid)

    with {{client_pid, _}, reverse} when is_pid(client_pid) <-
           Map.pop(state.reverse, client_name),
         {:ok, sup_pid} <- Connectors.start_connector(SatelliteConnector, %{name: client_name}) do
      resource_ref = Process.monitor(sup_pid)
      resources = Map.put(resources, sup_pid, resource_ref)
      reverse = Map.put(reverse, client_name, {client_pid, sup_pid})

      {:noreply, %State{state | resources: resources, reverse: reverse}}
    else
      {{nil, _}, reverse} ->
        # client has been disconnected
        {:noreply, %State{state | reverse: reverse, resources: resources}}

      error ->
        {:stop, {:shutdown, error}, state}
    end
  end

  def handle_info(_, state) do
    {:noreply, state}
  end
end
