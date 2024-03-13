defmodule Electric.Satellite.SubscriptionManager do
  @moduledoc """
  Keep track of previously-established subscriptions to be able to resume them.

  Currently this uses an ETS without "cold storage" because subscription continuation
  is tied to being able to resume from the PG cached WAL, which is neither persisted
  nor restored for now.
  """

  use GenServer

  alias Electric.Replication.Connectors
  alias Electric.Replication.Shapes.ShapeRequest

  require Logger

  def start_link(connector_config) do
    origin = Connectors.origin(connector_config)
    GenServer.start_link(__MODULE__, connector_config, name: name(origin))
  end

  def name(origin) do
    Electric.name(__MODULE__, origin)
  end

  @doc """
  Saves the given shape requests under given subscription id for this client
  """
  @spec save_subscription(Connectors.origin(), String.t(), String.t(), [ShapeRequest.t()]) :: :ok
  def save_subscription(origin, client_id, subscription_id, shape_requests) do
    GenServer.call(
      name(origin),
      {:save_subscription, {client_id, subscription_id}, shape_requests}
    )
  end

  @doc """
  Finds the shape requests associated with a given subscription id for this client
  """
  @spec fetch_subscription(Connectors.origin(), String.t(), String.t()) ::
          {:ok, ShapeRequest.t()} | :error
  def fetch_subscription(origin, client_id, subscription_id) do
    case :ets.lookup(ets_table_name(origin), {client_id, subscription_id}) do
      [] -> :error
      [{_key, data}] -> {:ok, data}
    end
  end

  @doc """
  Remove a subscription for a client
  """
  @spec delete_subscription(Connectors.origin(), String.t(), String.t()) :: :ok
  def delete_subscription(origin, client_id, subscription_id) do
    GenServer.call(name(origin), {:delete_subscription, {client_id, subscription_id}})
  end

  @doc """
  Remove all subscriptions for a client
  """
  @spec delete_all_subscriptions(Connectors.origin(), String.t()) :: :ok
  def delete_all_subscriptions(origin, client_id) do
    GenServer.call(name(origin), {:delete_all_subscriptions, client_id})
  end

  # GenServer API

  @impl GenServer
  def init(connector_config) do
    origin = Connectors.origin(connector_config)
    Logger.metadata(component: "SubscriptionManager")
    table = :ets.new(ets_table_name(origin), [:named_table, :protected, :set])
    {:ok, %{table: table, connector_config: connector_config}}
  end

  defp ets_table_name(origin) do
    String.to_atom(inspect(__MODULE__) <> ":" <> origin)
  end

  @impl GenServer
  def handle_call({:save_subscription, key, shape_requests}, _, state) do
    Logger.debug("Saved subscription #{inspect(key)}")
    :ets.insert(state.table, {key, shape_requests})

    {:reply, :ok, state}
  end

  def handle_call({:delete_subscription, key}, _, state) do
    :ets.delete(state.table, key)

    {:reply, :ok, state}
  end

  def handle_call({:delete_all_subscriptions, client_id}, _, state) do
    :ets.match_delete(state.table, {{client_id, :_}, :_})

    {:reply, :ok, state}
  end
end
