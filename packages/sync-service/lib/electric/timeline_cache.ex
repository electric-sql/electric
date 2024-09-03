defmodule Electric.TimelineCache do
  @moduledoc """
  Cache storing the Postgres timeline on which Electric is running.
  """
  require Logger
  use GenServer

  alias Electric.PersistentKV

  @timeline_key "timeline_id"

  @schema NimbleOptions.new!(
            name: [
              type: {:or, [:atom, {:tuple, [:atom, :atom, :any]}]},
              default: __MODULE__
            ],
            timeline_id: [type: {:or, [:integer, nil]}, default: nil],
            persistent_kv: [type: :any, required: true]
          )

  def start_link(opts) do
    with {:ok, config} <- NimbleOptions.validate(opts, @schema) do
      GenServer.start_link(__MODULE__, config, name: config[:name])
    end
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
  def init(opts) do
    with {:ok, tid} <- Access.fetch(opts, :timeline_id),
         {:ok, kv_backend} <- Access.fetch(opts, :persistent_kv) do
      persistent_kv = PersistentKV.Serialized.new!(backend: kv_backend)
      timeline_id = load_timeline_id(tid, persistent_kv)
      {:ok, %{id: timeline_id, persistent_kv: persistent_kv}}
    end
  end

  @impl true
  def handle_call({:store, timeline_id}, _from, %{persistent_kv: kv} = state) do
    PersistentKV.set(kv, @timeline_key, timeline_id)
    {:reply, :ok, %{state | id: timeline_id}}
  end

  def handle_call(:get, _from, state) do
    {:reply, Map.get(state, :id, nil), state}
  end

  # Loads the timeline ID from persistent storage
  # if the provided timeline_id is nil.
  # If it is not nil, it stores the provided timeline ID in persistent storage.
  defp load_timeline_id(nil, kv) do
    case PersistentKV.get(kv, @timeline_key) do
      {:ok, timeline_id} ->
        timeline_id

      {:error, :not_found} ->
        nil

      error ->
        Logger.warning("Failed to load timeline ID from persistent storage: #{error}")
        nil
    end
  end

  defp load_timeline_id(timeline_id, kv) do
    PersistentKV.set(kv, @timeline_key, timeline_id)
    timeline_id
  end
end
