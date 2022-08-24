defmodule DownstreamProducerMock do
  use GenStage

  @behaviour Electric.Replication.DownstreamProducer

  @impl true
  def start_link([]), do: GenStage.start_link(__MODULE__, [])

  @impl true
  def init([]) do
    {:producer, false, dispatcher: GenStage.DemandDispatcher}
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
  def handle_call(:connected?, _from, connected?) do
    {:reply, connected?, [], connected?}
  end

  @impl true
  def handle_call({:set_expected_producer_connected, status}, _from, _) do
    {:reply, :ok, [], status}
  end

  @impl true
  def handle_call({:produce, events}, _from, connected?) do
    {:reply, :ok, events, connected?}
  end

  @impl true
  def handle_demand(_incoming_demand, connected?) do
    {:noreply, [], connected?}
  end
end
