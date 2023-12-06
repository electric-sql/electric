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
  alias Electric.Postgres.Schema
  alias Electric.Postgres.Extension.SchemaCache.Global

  require Logger

  @behaviour SchemaLoader

  def child_spec({conn_config, _opts} = args) do
    child_spec(Connectors.origin(conn_config), args)
  end

  def child_spec(conn_config) when is_list(conn_config) do
    child_spec(Connectors.origin(conn_config), conn_config)
  end

  defp child_spec(origin, args) do
    default = %{
      id: {__MODULE__, origin},
      start: {__MODULE__, :start_link, [args]}
    }

    Supervisor.child_spec(default, [])
  end

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

  @spec ready?(Connectors.origin()) :: boolean()
  def ready?(origin) do
    case Electric.lookup_pid(name(origin)) do
      pid when is_pid(pid) -> true
      _ -> false
    end
  end

  @impl SchemaLoader
  def connect(conn_config, _opts) do
    {:ok, Connectors.origin(conn_config)}
  end

  @impl SchemaLoader
  def load(origin) do
    call(origin, {:load, :current})
  end

  @impl SchemaLoader
  def load(origin, version) do
    call(origin, {:load, {:version, version}})
  end

  @impl SchemaLoader
  def save(origin, version, schema, stmts) do
    call(origin, {:save, version, schema, stmts})
  end

  @impl SchemaLoader
  def relation_oid(origin, type, schema, name) do
    call(origin, {:relation_oid, type, schema, name})
  end

  @impl SchemaLoader
  def refresh_subscription(origin, name) do
    call(origin, {:refresh_subscription, name})
  end

  @impl SchemaLoader
  def migration_history(origin, version) do
    call(origin, {:migration_history, version})
  end

  @impl SchemaLoader
  def known_migration_version?(origin, version) do
    call(origin, {:known_migration_version?, version})
  end

  @impl SchemaLoader
  def internal_schema(origin) do
    call(origin, :internal_schema)
  end

  def electrified_tables(origin) do
    call(origin, :electrified_tables)
  end

  def replicated_internal_tables(origin) do
    origin
    |> internal_schema()
    |> Schema.table_info()
  end

  @impl SchemaLoader
  def table_electrified?(_origin, {"electric", _name}) do
    {:ok, false}
  end

  def table_electrified?(origin, {schema, name}) do
    call(origin, {:table_electrified?, schema, name})
  end

  @impl SchemaLoader
  def index_electrified?(_origin, {"electric", _name}) do
    {:ok, false}
  end

  def index_electrified?(origin, {schema, name}) do
    call(origin, {:index_electrified?, schema, name})
  end

  @impl SchemaLoader
  def tx_version(origin, row) do
    call(origin, {:tx_version, row})
  end

  def relation(origin, oid) when is_integer(oid) do
    call(origin, {:relation, oid})
  end

  def relation(origin, {_schema, _name} = relation) do
    call(origin, {:relation, relation})
  end

  def relation(origin, {_schema, _name} = relation, version) do
    call(origin, {:relation, relation, version})
  end

  def relation!(origin, relation) do
    case relation(origin, relation) do
      {:ok, table} ->
        table

      error ->
        raise ArgumentError, message: "unknown relation #{inspect(relation)}: #{inspect(error)}"
    end
  end

  def relation!(origin, relation, version) do
    case relation(origin, relation, version) do
      {:ok, table} ->
        table

      error ->
        raise ArgumentError,
          message:
            "unknown relation #{inspect(relation)} for version #{inspect(version)}: #{inspect(error)}"
    end
  end

  def internal_relation!(origin, relation) do
    case call(origin, {:internal_relation, relation}) do
      {:ok, table} ->
        table

      error ->
        raise ArgumentError,
          message: "unknown internal relation #{inspect(relation)}: #{inspect(error)}"
    end
  end

  defp call(name, msg) when is_binary(name) do
    call(name(name), msg)
  end

  defp call(pid, msg) when is_pid(pid) do
    GenServer.call(pid, msg, :infinity)
  end

  defp call(name, msg) when is_tuple(name) do
    GenServer.call(name, msg, :infinity)
  end

  @impl GenServer
  def init({conn_config, opts}) do
    origin = Connectors.origin(conn_config)

    Logger.metadata(pg_producer: origin)
    Logger.info("Starting #{__MODULE__} for #{origin}")
    # NOTE: this allows for a global SchemaCache instance even if the current configuration
    #       requires there to be a schema cache per pg instance
    # TODO: remove this in favour of a global (or namespace-able) consistent
    #       path from pg <--> satellite
    Global.register(origin)

    {:ok, backend} =
      opts
      |> SchemaLoader.get(:backend)
      |> SchemaLoader.connect(conn_config)

    state = %{
      origin: origin,
      backend: backend,
      conn_config: conn_config,
      opts: opts,
      current: nil,
      refresh_task: nil,
      internal_schema: nil,
      tx_version_cache: %{}
    }

    {:ok, state}
  end

  @impl GenServer
  def handle_call({:load, :current}, _from, %{current: nil} = state) do
    with {{:ok, schema_version}, state} <- load_current_schema(state) do
      {:reply, {:ok, schema_version}, state}
    else
      {error, state} ->
        {:reply, error, state}
    end
  end

  def handle_call(
        {:load, :current},
        _from,
        %{current: %SchemaLoader.Version{} = schema_version} = state
      ) do
    {:reply, {:ok, schema_version}, state}
  end

  def handle_call(
        {:load, {:version, version}},
        _from,
        %{current: %{version: version} = schema_version} = state
      ) do
    {:reply, {:ok, schema_version}, state}
  end

  def handle_call({:load, {:version, version}}, _from, state) do
    {:reply, SchemaLoader.load(state.backend, version), state}
  end

  def handle_call({:save, version, schema, stmts}, _from, state) do
    {:ok, backend, schema_version} = SchemaLoader.save(state.backend, version, schema, stmts)

    {:reply, {:ok, state.origin, schema_version},
     %{state | backend: backend, current: schema_version}}
  end

  def handle_call({:relation_oid, type, schema, name}, _from, state) do
    {:reply, SchemaLoader.relation_oid(state.backend, type, schema, name), state}
  end

  def handle_call({:primary_keys, sname, tname}, _from, state) do
    {result, state} =
      with {{:ok, schema_version}, state} <- current_schema(state) do
        case SchemaLoader.Version.primary_keys(schema_version, {sname, tname}) do
          {:ok, pks} ->
            {{:ok, pks}, state}

          {:error, _reason} = error ->
            {error, state}
        end
      end

    {:reply, result, state}
  end

  def handle_call({:migration_history, version}, _from, state) do
    {:reply, SchemaLoader.migration_history(state.backend, version), state}
  end

  def handle_call({:known_migration_version?, version}, _from, state) do
    {:reply, SchemaLoader.known_migration_version?(state.backend, version), state}
  end

  def handle_call(:internal_schema, _from, state) do
    state = load_internal_schema(state)
    {:reply, state.internal_schema, state}
  end

  def handle_call(:electrified_tables, _from, state) do
    load_and_reply(state, fn schema_version ->
      {:ok, Schema.table_info(schema_version.schema)}
    end)
  end

  def handle_call({:table_electrified?, sname, tname}, _from, state) do
    # delegate this call directly to the extension metadata tables to avoid race conditions
    # that can happen between an 'electrify table' call and the receipt of the
    # migration via the replication stream - it's important that this function 
    # be consistent with the state of the db, not our slightly laggy view on it
    {:reply, SchemaLoader.table_electrified?(state.backend, {sname, tname}), state}
  end

  def handle_call({:index_electrified?, sname, iname}, _from, state) do
    {:reply, SchemaLoader.index_electrified?(state.backend, {sname, iname}), state}
  end

  def handle_call({:tx_version, %{"txid" => txid, "txts" => txts} = row}, _from, state) do
    # TODO: replace simple map with some size-bounded implementation for tx version cache
    tx_version_cache =
      Map.put_new_lazy(state.tx_version_cache, {txid, txts}, fn -> load_tx_version(state, row) end)

    {:reply, Map.fetch(tx_version_cache, {txid, txts}),
     %{state | tx_version_cache: tx_version_cache}}
  end

  def handle_call({:relation, oid}, _from, state) when is_integer(oid) do
    load_and_reply(state, fn schema_version ->
      Schema.table_info(schema_version.schema, oid)
    end)
  end

  def handle_call({:relation, {_sname, _tname} = relation}, _from, state) do
    load_and_reply(state, fn schema_version ->
      Schema.table_info(schema_version.schema, relation)
    end)
  end

  def handle_call({:relation, relation, version}, _from, state) do
    {result, state} =
      with {:ok, schema_version} <- SchemaLoader.load(state.backend, version) do
        {Schema.table_info(schema_version.schema, relation), state}
      else
        error -> {error, state}
      end

    {:reply, result, state}
  end

  # Prevent deadlocks:
  # the list of electrified tables is cached and this refresh_subscription call
  # is done via an async Task because otherwise we get into a deadlock in the
  # refresh-tables process:
  #
  # 1. we call refresh tables
  # 2. pg **synchronously** queries the replication publication (electric)
  #    for the list of replicated tables
  # 3. the TcpServer calls this process to get the list of electrified tables
  # 4. this process is waiting for the `REFRESH SUBSCRIPTION` call to finish
  # 5. deadlock
  #
  # So this call to the SchemaLoader is done via a task so that this SchemaCache process
  # is free to handle the `electrified_tables/1` call coming in from the `TcpServer`.
  def handle_call({:refresh_subscription, name}, from, %{refresh_task: nil} = state) do
    task =
      Task.async(fn ->
        result = SchemaLoader.refresh_subscription(state.backend, name)
        GenServer.reply(from, result)
        :ok
      end)

    {:noreply, %{state | refresh_task: task}}
  end

  def handle_call({:refresh_subscription, name}, _from, %{refresh_task: %Task{}} = state) do
    Logger.warning(
      "Refresh subscription already running, ingnoring duplicate refresh of subscription #{name}"
    )

    {:reply, :ok, state}
  end

  def handle_call({:internal_relation, relation}, _from, state) do
    state = load_internal_schema(state)
    {:reply, Schema.table_info(state.internal_schema, relation), state}
  end

  @impl GenServer
  # refresh subscription Task process done
  def handle_info({ref, :ok}, %{refresh_task: %{ref: ref}} = state) when is_reference(ref) do
    {:noreply, %{state | refresh_task: nil}}
  end

  # Task process exited
  def handle_info({:DOWN, _ref, :process, _pid, :normal}, state) do
    {:noreply, state}
  end

  @impl GenServer
  def handle_continue({:close, conn}, state) do
    :ok = :epgsql.close(conn)
    {:noreply, state}
  end

  defp load_internal_schema(%{internal_schema: nil} = state) do
    %{state | internal_schema: SchemaLoader.internal_schema(state.backend)}
  end

  defp load_internal_schema(state) do
    state
  end

  defp load_tx_version(state, row) do
    Logger.debug(
      "Loading tx: #{row["txid"]}/#{row["txts"]} version using #{inspect(state.backend)}"
    )

    {:ok, version} = SchemaLoader.tx_version(state.backend, row)
    Logger.debug("Loaded version #{inspect(version)} for tx: #{row["txid"]}/#{row["txts"]}")
    version
  end

  defp current_schema(%{current: nil} = state) do
    load_current_schema(state)
  end

  defp current_schema(%{current: schema_version} = state) do
    {{:ok, schema_version}, state}
  end

  defp load_current_schema(state) do
    case SchemaLoader.load(state.backend) do
      {:ok, schema_version} ->
        {{:ok, schema_version}, %{state | current: schema_version}}

      error ->
        {error, state}
    end
  end

  defp load_and_reply(state, process) when is_function(process, 1) do
    {result, state} =
      with {{:ok, schema_version}, state} <- current_schema(state) do
        {process.(schema_version), state}
      else
        error -> {error, state}
      end

    {:reply, result, state}
  end
end
