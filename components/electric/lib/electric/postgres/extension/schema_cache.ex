defmodule Electric.Postgres.Extension.SchemaCache do
  @moduledoc """
  Per-Postgres instance schema load/save functionality.

  Kept as a single `gen_server` to reduce the number of open pg connections
  required by Electric.

  For the moment loads the given schema version without caching. Should at some
  point add some kind of LRU caching to limit db load when sending out a
  migration to multiple satellite clients. 

  Uses a configurable backend (implementing the `SchemaLoader` behaviour) to
  load and save the schema information, defaulting to one backed by postgres
  itself (via the functions in the `Extension` module).
  """

  use GenServer

  alias Electric.Replication.Connectors
  alias Electric.Postgres.Extension.SchemaLoader
  # alias Electric.Postgres.Schema

  require Logger

  @behaviour Electric.Postgres.Extension.SchemaLoader

  def start_link({conn_config, opts}) do
    start_link(conn_config, opts)
  end

  def start_link(conn_config, opts \\ []) do
    GenServer.start_link(__MODULE__, {conn_config, opts}, name: name(conn_config))
  end

  @spec name(Connectors.config()) :: Electric.reg_name()
  def name(conn_config) when is_list(conn_config) do
    name(Connectors.origin(conn_config))
  end

  @spec name(Connectors.origin()) :: Electric.reg_name()
  def name(origin) when is_binary(origin) do
    Electric.name(__MODULE__, origin)
  end

  @impl SchemaLoader
  def connect(conn_config, _opts) do
    {:ok, Connectors.origin(conn_config)}
  end

  @impl SchemaLoader
  def load(origin) do
    GenServer.call(name(origin), {:load, :current})
  end

  @impl SchemaLoader
  def load(origin, version) do
    GenServer.call(name(origin), {:load, {:version, version}})
  end

  @impl SchemaLoader
  def save(origin, version, schema) do
    GenServer.call(name(origin), {:save, version, schema})
  end

  @impl SchemaLoader
  def relation_oid(origin, type, schema, name) do
    GenServer.call(name(origin), {:relation_oid, type, schema, name})
  end

  @impl SchemaLoader
  def primary_keys(origin, schema, name) do
    GenServer.call(name(origin), {:primary_keys, schema, name})
  end

  @impl SchemaLoader
  def refresh_subscription(origin, name) do
    GenServer.call(name(origin), {:refresh_subscription, name})
  end

  @impl GenServer
  def init({conn_config, opts}) do
    origin = Connectors.origin(conn_config)

    Logger.metadata(pg_producer: origin)
    Logger.info("Starting #{__MODULE__}")

    {:ok, backend} =
      opts
      |> SchemaLoader.get(:backend)
      |> SchemaLoader.connect(conn_config)

    state = %{
      origin: origin,
      backend: backend,
      conn_config: conn_config,
      opts: opts,
      current: nil
    }

    {:ok, state}
  end

  @impl GenServer
  def handle_call({:load, :current}, _from, %{current: nil} = state) do
    {result, state} = load_current_schema(state)

    {:reply, result, state}
  end

  def handle_call({:load, :current}, _from, %{current: {version, schema}} = state) do
    {:reply, {:ok, version, schema}, state}
  end

  def handle_call({:load, {:version, version}}, _from, %{current: {version, schema}} = state) do
    {:reply, {:ok, version, schema}, state}
  end

  def handle_call({:load, {:version, version}}, _from, state) do
    {:reply, SchemaLoader.load(state.backend, version), state}
  end

  def handle_call({:save, version, schema}, _from, state) do
    {:ok, backend} = SchemaLoader.save(state.backend, version, schema)
    {:reply, {:ok, state.origin}, %{state | backend: backend, current: {version, schema}}}
  end

  def handle_call({:relation_oid, type, schema, name}, _from, state) do
    {:reply, SchemaLoader.relation_oid(state.backend, type, schema, name), state}
  end

  def handle_call({:primary_keys, schema, name}, _from, state) do
    {:reply, SchemaLoader.primary_keys(state.backend, schema, name), state}
  end

  # # Version of loading primary keys using the materialised schema info
  # def handle_call({:primary_keys, ns, table}, _from, %{current: {_version, schema}} = state) do
  #   result =
  #     with {:ok, table} <- Schema.fetch_table(schema, {ns, table}) do
  #       Schema.primary_keys(table)
  #     end
  #
  #   {:reply, result, state}
  # end
  #
  # def handle_call({:primary_keys, ns, table}, _from, state) do
  #   {result, state} =
  #     with {{:ok, _version, schema}, state} <- load_current_schema(state),
  #          {{:ok, table}, state} <-
  #            {Schema.fetch_table(schema, {ns, table}), state} do
  #       {Schema.primary_keys(table), state}
  #     end
  #
  #   {:reply, result, state}
  # end

  def handle_call({:refresh_subscription, name}, _from, state) do
    {:reply, SchemaLoader.refresh_subscription(state.backend, name), state}
  end

  @impl GenServer
  def handle_continue({:close, conn}, state) do
    :ok = :epgsql.close(conn)
    {:noreply, state}
  end

  defp load_current_schema(state) do
    case SchemaLoader.load(state.backend) do
      {:ok, version, schema} ->
        {{:ok, version, schema}, %{state | current: {version, schema}}}

      error ->
        {error, state}
    end
  end
end
