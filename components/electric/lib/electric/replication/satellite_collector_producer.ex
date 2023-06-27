defmodule Electric.Replication.SatelliteCollectorProducer do
  @moduledoc """
  A producer that's meant to feed the SlotServer from a cache of transactions which
  came from a number of Satellites.

  This is a "fan-in" piece of architecture, where we merge the incoming operations
  from all clients into one stream, and push them to Postgres. Conflict resolution
  triggers on Postgres should take care of properly conflict-resolving inserts based
  on the metadata, regardless of observed operation order.
  """
  use GenStage
  require Logger

  def start_link(opts) do
    GenStage.start_link(__MODULE__, [], Keyword.take(opts, [:name]))
  end

  def name(identifier \\ :default) do
    {:via, :gproc, {:n, :l, {__MODULE__, identifier}}}
  end

  def store_incoming_transactions(_, []), do: :ok

  def store_incoming_transactions(server, transactions) do
    GenStage.call(server, {:store_incoming_transactions, transactions})
  end

  # Internal API

  @impl GenStage
  def init(_) do
    table = ETS.Set.new!(ordered: true, keypos: 2)
    {:producer, %{table: table, next_key: 0, demand: 0}}
  end

  @impl GenStage
  def handle_call({:store_incoming_transactions, transactions}, _, state) do
    transactions
    |> Stream.each(& &1.ack_fn())
    |> Stream.reject(&Enum.empty?(&1.changes))
    |> Stream.with_index(state.next_key)
    |> Enum.to_list()
    |> then(&ETS.Set.put(state.table, &1))

    next_key = ETS.Set.last!(state.table) + 1

    {:noreply, events, state} = send_events_from_ets(%{state | next_key: next_key})

    {:reply, :ok, events, state}
  end

  @impl GenStage
  def handle_subscribe(producer_or_consumer, subscription_options, _from, state) do
    Logger.debug(
      "Subscription request to satellite collector producer from #{producer_or_consumer} with #{inspect(subscription_options)}"
    )

    {:automatic, state}
  end

  @impl GenStage
  def handle_demand(incoming_demand, state) do
    Logger.debug("Handling incoming demand #{incoming_demand}")
    send_events_from_ets(Map.update!(state, :demand, &(&1 + incoming_demand)))
  end

  defp send_events_from_ets(%{demand: 0} = state), do: {:noreply, [], state}

  defp send_events_from_ets(%{demand: demand, table: set} = state) do
    {results, _} = ETS.Set.match!(set, {:"$1", :"$2"}, demand)

    case Electric.Utils.list_last_and_length(results) do
      {_, 0} ->
        {:noreply, [], state}

      {[_, last_key], fulfilled} ->
        # Delete items we're going to return now
        ETS.Set.select_delete!(set, [{{:_, :"$1"}, [{:"=<", :"$1", last_key}], [true]}])

        {:noreply, Enum.map(results, fn [tx, pos] -> {tx, pos} end),
         Map.update!(state, :demand, &(&1 - fulfilled))}
    end
  end
end
