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

  @spec get_clients(GenServer.server()) :: {:ok, [{String.t(), pid()}]}
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
    case Map.get(state.reverse, client_name) do
      nil ->
        {:ok, sup_pid} =
          Connectors.start_connector(
            SatelliteConnector,
            %{name: client_name, producer: reg_name}
          )

        client_ref = Process.monitor(client_pid)
        resource_ref = Process.monitor(sup_pid)

        clients = Map.put_new(state.clients, client_pid, {client_ref, client_name})
        resources = Map.put_new(state.resources, sup_pid, {resource_ref, client_name})
        reverse = Map.put_new(state.reverse, client_name, {client_pid, sup_pid})
        {:reply, :ok, %State{state | clients: clients, resources: resources, reverse: reverse}}

      {old_pid, sup_pid} ->
        Logger.info("overtook supervisor")

        case Electric.lookup_pid(reg_name) do
          ^client_pid ->
            client_ref = Process.monitor(client_pid)

            clients =
              state.clients
              |> Map.delete(old_pid)
              |> Map.put_new(client_pid, {client_ref, client_name})

            reverse = Map.put(state.reverse, client_name, {client_pid, sup_pid})

            {:reply, :ok, %State{state | clients: clients, reverse: reverse}}

          _ ->
            # Should never happen except when process crashed right after calling manager
            {:reply, {:error, :wrong_registration}, state}
        end
    end
  end

  @impl GenServer
  def handle_call(_, _, state) do
    {:reply, {:error, :not_implemented}, state}
  end

  @impl GenServer
  def handle_cast(msg, state) do
    Logger.info("Unhandled cast: #{inspect(msg)}")
    {:noreply, state}
  end

  @impl GenServer
  def handle_info({:DOWN, _ref, :process, client_pid, _}, state)
      when is_map_key(state.clients, client_pid) do
    # client connection have terminated, we can do something smart here if we
    # expect client to be reconnecting soon

    {{_client_ref, client_name}, clients} = Map.pop!(state.clients, client_pid)
    {{^client_pid, sup_pid}, reverse} = Map.pop!(state.reverse, client_name)

    Logger.info("cleaning resources for #{inspect(client_name)} #{inspect(client_pid)}")

    resources =
      case Map.pop(state.resources, sup_pid) do
        # supervisor have already terminated
        {nil, map} ->
          map

        {{sup_ref, _}, map} ->
          _ = Connectors.stop_connector(sup_pid)
          Process.demonitor(sup_ref, [:flush])
          map
      end

    {:noreply, %State{state | clients: clients, reverse: reverse, resources: resources}}
  end

  def handle_info({:DOWN, sup_ref, :process, sup_pid, _}, state)
      when is_map_key(state.resources, sup_pid) do
    # supervisor with client resources have terminated, if client is still alive
    # - we should restart supervisor, or terminate the client if it's
    # missbehaving
    {{^sup_ref, client_name}, resources} = Map.pop!(state.resources, sup_pid)
    {{client_pid, ^sup_pid}, reverse} = Map.pop(state.reverse, client_name)

    case Connectors.start_connector(
           SatelliteConnector,
           %{name: client_name, producer: Electric.Satellite.WsServer.reg_name(client_name)}
         ) do
      {:ok, sup_pid1} ->
        resource_ref = Process.monitor(sup_pid)
        resources = Map.put(resources, sup_pid, {resource_ref, client_name})
        reverse = Map.put(reverse, client_name, {client_pid, sup_pid1})

        {:noreply, %State{state | resources: resources, reverse: reverse}}

      error ->
        Logger.error("failed to start satellite connector, do not recover from it")
        {:stop, {:shutdown, error}, state}
    end
  end

  def handle_info(msg, state) do
    Logger.info("Unhandled msg: #{inspect(msg)} #{inspect(state)}")
    {:noreply, state}
  end
end
