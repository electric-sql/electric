defmodule DownstreamProducerMock do
  use GenStage
  require Logger

  alias Electric.Replication.Vaxine.LogProducer
  @behaviour Electric.Replication.DownstreamProducer

  defmodule State do
    defstruct events: [],
              status: nil,
              pid: nil,
              demand: 0
  end

  @impl true
  def start_link(name, _opts \\ %{}) do
    GenStage.start_link(__MODULE__, name)
  end

  @impl true
  def init(name) do
    {:via, :gproc, name1} = LogProducer.get_name(name)
    :gproc.reg(name1)
    {:producer, %State{}, [{:dispatcher, GenStage.DemandDispatcher}, {:buffer_size, 1}]}
  end

  @impl true
  def start_replication(producer, offset) do
    GenStage.call(producer, {:start_replication, offset})
  end

  @impl true
  def connected?(producer) do
    GenStage.call(producer, :connected?)
  end

  def set_expected_producer_connected(producer, status) do
    GenStage.call(producer, {:set_expected_producer_connected, status})
  end

  def produce(producer, events) do
    GenStage.call(producer, {:produce, events})
  end

  @impl true
  def handle_call({:start_replication, _offset}, _from, connected?) do
    {:reply, :ok, [], connected?}
  end

  @impl true
  def handle_call(:connected?, _from, state) do
    {:reply, state.status, [], state}
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
    {dispatch_events, remainig} = Enum.split(state.events, demand)
    remaining_demand = demand - length(dispatch_events)

    {:noreply, dispatch_events, %State{state | events: remainig, demand: remaining_demand}}
  end
end
