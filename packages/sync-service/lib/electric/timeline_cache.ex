defmodule Electric.TimelineCache do
  @moduledoc """
  In-memory cache for storing the Postgres timeline on which Electric is running.
  """
  use GenServer

  def start_link(timeline_id \\ nil) when is_nil(timeline_id) or is_integer(timeline_id) do
    GenServer.start_link(__MODULE__, timeline_id, name: __MODULE__)
  end

  @doc """
  Store the timeline ID on which Electric is running.
  """
  @spec store_timeline(GenServer.name(), integer()) :: :ok
  def store_timeline(server \\ __MODULE__, timeline_id) do
    GenServer.call(server, {:store, timeline_id})
  end

  @doc """
  Get the timeline ID on which Electric is running.
  Returns nil if the timeline ID is not set.
  """
  @spec get_timeline(GenServer.name()) :: integer() | nil
  def get_timeline(server \\ __MODULE__) do
    GenServer.call(server, :get)
  end

  @impl true
  def init(timeline_id) do
    {:ok, %{id: timeline_id}}
  end

  @impl true
  def handle_call({:store, timeline_id}, _from, state) do
    {:reply, :ok, %{state | id: timeline_id}}
  end

  def handle_call(:get, _from, state) do
    {:reply, Map.get(state, :id, nil), state}
  end
end
