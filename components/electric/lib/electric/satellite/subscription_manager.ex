defmodule Electric.Satellite.SubscriptionManager do
  @moduledoc """
  Keep track of previously-established subscriptions to be able to resume them.

  Currently this uses an ETS without "cold storage" because subscription continuation
  is tied to being able to resume from the PG cached WAL, which is neither persisted
  nor restored for now.
  """

  use GenServer

  alias Electric.Postgres.Extension
  alias Electric.Replication.Connectors
  alias Electric.Replication.Postgres.Client
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
    Logger.metadata(component: "SubscriptionManager")

    origin = Connectors.origin(connector_config)
    table = :ets.new(ets_table_name(origin), [:named_table, :protected, :set])
    state = %{table: table, connector_config: connector_config}

    populate_client_subscriptions_cache(state)

    {:ok, state}
  end

  defp ets_table_name(origin) do
    String.to_atom(inspect(__MODULE__) <> ":" <> origin)
  end

  defp populate_client_subscriptions_cache(state) do
    {:ok, _, rows} =
      query(state, "SELECT * FROM #{Extension.client_shape_subscriptions_table()}")

    subscriptions =
      for {client_id, subscription_id, shape_requests_json} <- rows do
        shape_requests =
          shape_requests_json
          |> Jason.decode!(keys: :atoms)
          |> ShapeRequest.from_json_maps()

        {{client_id, subscription_id}, shape_requests}
      end

    :ets.insert(state.table, subscriptions)
  end

  @insert_equery """
  INSERT INTO
    #{Extension.client_shape_subscriptions_table()}
  VALUES
    ($1, $2, $3)
  ON CONFLICT
    (client_id, subscription_id)
  DO UPDATE
    SET shape_requests = excluded.shape_requests
  """

  @delete_equery """
  DELETE FROM
    #{Extension.client_shape_subscriptions_table()}
  WHERE
    client_id = $1 AND subscription_id = $2
  """

  @delete_all_equery """
  DELETE FROM
    #{Extension.client_shape_subscriptions_table()}
  WHERE
    client_id = $1
  """

  @impl GenServer
  def handle_call(
        {:save_subscription, {client_id, subscription_id} = key, shape_requests},
        _,
        state
      ) do
    :ets.insert(state.table, {key, shape_requests})

    {:ok, 1} =
      query(state, @insert_equery, [client_id, subscription_id, Jason.encode!(shape_requests)])

    {:reply, :ok, state}
  end

  def handle_call({:delete_subscription, {client_id, subscription_id} = key}, _, state) do
    :ets.delete(state.table, key)

    {:ok, 1} = query(state, @delete_equery, [client_id, subscription_id])

    {:reply, :ok, state}
  end

  def handle_call({:delete_all_subscriptions, client_id}, _, state) do
    :ets.match_delete(state.table, {{client_id, :_}, :_})

    {:ok, 1} = query(state, @delete_all_equery, [client_id])

    {:reply, :ok, state}
  end

  defp query(state, query) when is_binary(query) do
    state.connector_config
    |> Connectors.get_connection_opts()
    |> Client.with_conn(fn conn -> :epgsql.squery(conn, query) end)
  end

  defp query(state, query, params) when is_binary(query) and is_list(params) do
    state.connector_config
    |> Connectors.get_connection_opts()
    |> Client.with_conn(fn conn -> :epgsql.equery(conn, query, params) end)
  end
end
