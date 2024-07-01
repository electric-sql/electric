defmodule DownstreamProducerMock do
  use GenStage
  require Logger

  defmodule State do
    defstruct events: [],
              status: nil,
              pid: nil,
              demand: 0
  end

  def start_link(name, _opts \\ %{}) do
    GenStage.start_link(__MODULE__, [], name: name)
  end

  @impl true
  def init(_) do
    {:producer, %State{}, buffer_size: 1}
  end

  def set_expected_producer_connected(producer, status) do
    GenStage.call(producer, {:set_expected_producer_connected, status})
  end

  def produce(producer, events) do
    GenStage.call(producer, {:produce, events})
  end

  @impl true
  def handle_call({:set_expected_producer_connected, status}, _from, state) do
    {:reply, :ok, [], %State{state | status: status}}
  end

  @impl true
  def handle_call({:produce, events}, _from, state) do
    state = %State{state | events: state.events ++ events}
    {:noreply, dispatch_events, state} = handle_demand(0, state)
    {:reply, :ok, dispatch_events, state}
  end

  @impl true
  def handle_cancel(_, _from, state) do
    {:noreply, [], %State{state | demand: 0, events: []}}
  end

  @impl true
  def handle_demand(demand, state) do
    demand = state.demand + demand
    {dispatch_events, remaining} = Enum.split(state.events, demand)
    remaining_demand = demand - length(dispatch_events)

    {:noreply, dispatch_events, %State{state | events: remaining, demand: remaining_demand}}
  end
end
