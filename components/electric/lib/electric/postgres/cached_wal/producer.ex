defmodule Electric.Postgres.CachedWal.Producer do
  @moduledoc """
  Cached WAL GenStage producer.

  This producer is meant to be used as the producer for
  `Electric.Satellite.WsServer` acting as a consumer. It is
  meant to be used with at most one subscriber at a time, starting to read
  from the cached WAL storage only when the first subscription is established.

  The producer itself is a temporary solution as a holdover before we figure out
  how better to organize the `WsServer` code to read from WAL within the same process.
  """
  use GenStage
  require Logger

  alias Electric.Postgres.CachedWal

  def start_link(opts) do
    GenStage.start_link(__MODULE__, opts, Keyword.take(opts, [:name]))
  end

  def name(param) do
    {:via, :gproc, {:n, :l, {__MODULE__, param}}}
  end

  @impl GenStage
  def init(opts) do
    Logger.metadata(component: "CachedWal.Producer")

    {:producer,
     %{
       cached_wal_module: Keyword.get(opts, :cached_wal_module, CachedWal.Api.default_module()),
       current_position: nil,
       demand: 0
     }}
  end

  @impl GenStage
  def handle_subscribe(:consumer, options, _, state) do
    Logger.debug("Got a subscription request with options #{inspect(options)}")

    case Keyword.fetch(options, :start_subscription) do
      {:ok, :start_from_latest} ->
        raise "This producer doesn't currently support subscription starting from the tip of the stream"

      {:ok, wal_pos} ->
        {:automatic, %{state | current_position: wal_pos}}
    end
  end

  @impl GenStage
  def handle_demand(demand, state) do
    state
    |> Map.update!(:demand, &(&1 + demand))
    |> send_events_from_cache()
  end

  @impl GenStage
  def handle_info({:cached_wal_notification, _, :new_segments_available}, state) do
    send_events_from_cache(state)
  end

  defp send_events_from_cache(state, events \\ [])

  defp send_events_from_cache(%{demand: demand} = state, events) when demand == 0,
    do: {:noreply, Enum.reverse(events), state}

  defp send_events_from_cache(%{demand: demand} = state, events) do
    case CachedWal.Api.next_segment(state.cached_wal_module, state.current_position) do
      {:ok, segment, new_position} ->
        %{state | current_position: new_position, demand: demand - 1}
        |> send_events_from_cache([{segment, new_position} | events])

      :latest ->
        CachedWal.Api.request_notification(state.cached_wal_module, state.current_position)
        {:noreply, Enum.reverse(events), state}
    end
  end
end
