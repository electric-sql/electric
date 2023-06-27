defmodule Electric.Replication.SatelliteCollectorConsumer do
  @moduledoc """
  A consumer that generates demand to pull data from Satellites, and stores received
  events by forwarding them to `Electric.Replication.SatelliteCollectorProducer`.
  """
  alias Electric.Replication.SatelliteCollectorProducer

  use GenStage

  def start_link(opts) do
    GenStage.start_link(__MODULE__, opts, Keyword.take(opts, [:name]))
  end

  def name(param) do
    {:via, :gproc, {:n, :l, {__MODULE__, param}}}
  end

  @impl GenStage
  def init(opts) do
    {:consumer, Map.new(Keyword.take(opts, [:push_to])), Keyword.take(opts, [:subscribe_to])}
  end

  @impl GenStage
  def handle_events(events, _, state) do
    SatelliteCollectorProducer.store_incoming_transactions(state.push_to, events)

    {:noreply, [], state}
  end
end
