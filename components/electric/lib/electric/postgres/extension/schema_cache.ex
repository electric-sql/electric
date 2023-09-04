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
  def primary_keys(origin, {schema, name}) do
    call(origin, {:primary_keys, schema, name})
  end

  @impl SchemaLoader
  def primary_keys(origin, schema, name) do
    call(origin, {:primary_keys, schema, name})
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
  def internal_schema(_origin) do
    raise "Not implemented"
  end

  def logical_publication_tables(origin) do
    call(origin, :logical_publication_tables)
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
      internal_schema: nil
    }

    {:ok, state, {:continue, :init}}
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

  def handle_call({:save, version, schema, stmts}, _from, state) do
    {:ok, backend} = SchemaLoader.save(state.backend, version, schema, stmts)

    {:reply, {:ok, state.origin}, %{state | backend: backend, current: {version, schema}}}
  end

  def handle_call({:relation_oid, type, schema, name}, _from, state) do
    {:reply, SchemaLoader.relation_oid(state.backend, type, schema, name), state}
  end

  def handle_call({:primary_keys, sname, tname}, _from, state) do
    {result, state} =
      with {{:ok, _version, schema}, state} <- current_schema(state) do
        {Schema.primary_keys(schema, sname, tname), state}
      end

    {:reply, result, state}
  end

  def handle_call({:migration_history, version}, _from, state) do
    {:reply, SchemaLoader.migration_history(state.backend, version), state}
  end

  def handle_call({:known_migration_version?, version}, _from, state) do
    {:reply, SchemaLoader.known_migration_version?(state.backend, version), state}
  end

  def handle_call(:logical_publication_tables, _from, state) do
    {result, state} =
      with {{:ok, _version, schema}, state} <- current_schema(state) do
        {{:ok, Schema.table_info(schema) ++ Schema.table_info(state.internal_schema)}, state}
      else
        error -> {error, state}
      end

    {:reply, result, state}
  end

  def handle_call({:relation, oid}, _from, state) when is_integer(oid) do
    {result, state} =
      with {{:ok, _version, schema}, state} <- current_schema(state) do
        {Schema.table_info(schema, oid), state}
      else
        error -> {error, state}
      end

    {:reply, result, state}
  end

  def handle_call({:relation, {_sname, _tname} = relation}, _from, state) do
    {result, state} =
      with {{:ok, _version, schema}, state} <- current_schema(state) do
        {Schema.table_info(schema, relation), state}
      else
        error -> {error, state}
      end

    {:reply, result, state}
  end

  def handle_call({:relation, relation, version}, _from, state) do
    {result, state} =
      with {:ok, ^version, schema} <- SchemaLoader.load(state.backend, version) do
        {Schema.table_info(schema, relation), state}
      else
        error -> {error, state}
      end

    {:reply, result, state}
  end

  # Prevent deadlocks:
  # the list of tables added to Electirc's publication is cached and this refresh_subscription call
  # is done via an async Task because otherwise we get into a deadlock in the
  # refresh-tables process:
  #
  # 1. we call refresh tables
  # 2. pg **synchronously** queries the replication publication (electric)
  #    for the list of replicated tables
  # 3. the TcpServer calls this process to get the list of published tables
  # 4. this process is waiting for the `REFRESH SUBSCRIPTION` call to finish
  # 5. deadlock
  #
  # So this call to the SchemaLoader is done via a task so that this SchemaCache process
  # is free to handle the `logical_publication_tables/1` call coming in from the `TcpServer`.
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

  def handle_continue(:init, state) do
    {:noreply, %{state | internal_schema: SchemaLoader.internal_schema(state.backend)}}
  end

  defp current_schema(%{current: nil} = state) do
    load_current_schema(state)
  end

  defp current_schema(%{current: {version, schema}} = state) do
    {{:ok, version, schema}, state}
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
