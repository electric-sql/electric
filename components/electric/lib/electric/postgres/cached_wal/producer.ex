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

  alias Electric.Postgres.CachedWal
  alias Electric.Postgres.Lsn

  def start_link(opts) do
    GenStage.start_link(__MODULE__, opts, Keyword.take(opts, [:name]))
  end

  def name(param) do
    {:via, :gproc, {:n, :l, {__MODULE__, param}}}
  end

  @impl GenStage
  def init(opts) do
    {:producer,
     %{
       cached_wal_module:
         Keyword.get(opts, :cached_wal_module, Electric.Postgres.CachedWal.EtsBacked),
       current_position: nil,
       demand: 0
     }}
  end

  @impl GenStage
  def handle_subscribe(:consumer, options, _, state) do
    # TODO: The default value here shouldn't be present: that means the connecting client is empty and thus
    #       requires a complete sync, which shouldn't be handled just from the cached WAL section.
    #       But right now we don't have that functionality, so we start from the beginning of the cached log.
    starting_wal_position =
      case Keyword.fetch(options, :start_subscription) do
        {:ok, :eof} -> raise "This producer doesn't currently support subscription starting from the tip of the stream"
        # TODO: Since we're always calling "next" against the ETS, the segment with initial position is never sent,
        #       so we need a value "before the first" - which is a 0. I'm not sure I like this assumption, maybe it's better to
        #       encode that into a special function on the `CachedWal.Api` to avoid assumptions outside of those modules.
        {:ok, %Lsn{segment: 0, offset: 0}} -> {:ok, 0}
        {:ok, lsn} -> CachedWal.Api.get_wal_position_from_lsn(state.cached_wal_module, lsn)
        :error -> {:ok, 0}
      end

    with {:ok, starting_wal_position} <- starting_wal_position do
      {:automatic, %{state | current_position: starting_wal_position}}
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
        |> send_events_from_cache([{segment, segment.lsn} | events])

      :latest ->
        CachedWal.Api.request_notification(state.cached_wal_module, state.current_position)
        {:noreply, Enum.reverse(events), state}
    end
  end
end
