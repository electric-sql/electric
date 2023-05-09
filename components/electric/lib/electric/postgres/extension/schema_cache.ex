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

  # TODO: add caching of versions

  use GenServer

  alias Electric.Replication.Connectors
  alias Electric.Postgres.Extension.SchemaLoader

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

  @spec table_primary_keys(Connectors.origin(), binary | nil, binary) ::
          {:ok, [binary()]} | {:error, term()}
  def table_primary_keys(origin, schema, table) do
    GenServer.call(name(origin), {:primary_keys, schema, table})
  end

  @spec table_primary_keys(Connectors.origin(), pos_integer()) ::
          {:ok, [binary()]} | {:error, term()}
  def table_primary_keys(origin, oid) when is_integer(oid) do
    GenServer.call(name(origin), {:primary_keys, oid})
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

  def handle_call({:primary_keys, oid}, _from, state) do
    {:ok, conn} =
      state.conn_config
      |> Connectors.get_connection_opts(replication: false)
      |> :epgsql.connect()

    result = Electric.Replication.Postgres.Client.query_table_pks(conn, oid)

    {:reply, result, state, {:continue, {:close, conn}}}
  end

  @impl GenServer
  def handle_continue({:close, conn}, state) do
    :ok = :epgsql.close(conn)
    {:noreply, state}
  end
  end
end
