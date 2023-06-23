defmodule Electric.Postgres.Extension.SchemaCache.Global do
  @moduledoc """
  A wrapper around multiple SchemaCache instances to allow for usage from
  processes that have no concept of a postgres "origin".

  Every SchemaCache instance calls `register/1` but only one succeeds. This
  one instance handles calls to `SchemaRegistry.Global`.
  """

  alias Electric.Postgres.Extension.SchemaCache

  require Logger

  @name Electric.name(SchemaCache, :__global__)

  def name, do: @name

  def register(origin) do
    case Electric.reg_or_locate(@name, origin) do
      :ok ->
        # Kept as a warning to remind us that this is wrong... ;)
        Logger.warning("SchemaCache #{inspect(origin)} registered as the global instance")

      {:error, :already_registered, {_pid, registered_origin}} ->
        Logger.error(
          "Failed to register SchemaCache #{inspect(origin)} as global: #{inspect(registered_origin)} is already registered"
        )
    end
  end

  def primary_keys({_schema, _name} = relation) do
    SchemaCache.primary_keys(@name, relation)
  end

  def primary_keys(schema, name) when is_binary(schema) and is_binary(name) do
    SchemaCache.primary_keys(@name, schema, name)
  end

  def migration_history(version) do
    SchemaCache.migration_history(@name, version)
  end

  def relation(oid) when is_integer(oid) do
    SchemaCache.relation(@name, oid)
  end

  def relation({_schema, _name} = relation) do
    SchemaCache.relation(@name, relation)
  end

  def relation({_schema, _name} = relation, version) when is_binary(version) do
    SchemaCache.relation(@name, relation, version)
  end

  def relation!(relation) do
    SchemaCache.relation!(@name, relation)
  end

  def relation!(relation, version) do
    SchemaCache.relation!(@name, relation, version)
  end

  def electrified_tables() do
    SchemaCache.electrified_tables(@name)
  end
end

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

  @instance Global.name()

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

  @spec name(Electric.reg_name()) :: Electric.reg_name()
  def name(ref) when is_tuple(ref) do
    ref
  end

  def instance() do
    @instance
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
  def electrified_tables(origin) do
    call(origin, :electrified_tables)
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

  defp call(name, msg) when is_binary(name) do
    call(name(name), msg)
  end

  defp call(name, msg) when is_tuple(name) do
    GenServer.call(name, msg)
  end

  @impl GenServer
  def init({conn_config, opts}) do
    origin = Connectors.origin(conn_config)

    Logger.metadata(pg_producer: origin)
    Logger.info("Starting #{__MODULE__}")
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

  def handle_call({:save, version, schema, stmts}, _from, state) do
    {:ok, backend} = SchemaLoader.save(state.backend, version, schema, stmts)
    {:reply, {:ok, state.origin}, %{state | backend: backend, current: {version, schema}}}
  end

  def handle_call({:relation_oid, type, schema, name}, _from, state) do
    {:reply, SchemaLoader.relation_oid(state.backend, type, schema, name), state}
  end

  def handle_call({:primary_keys, schema, name}, _from, state) do
    {:reply, SchemaLoader.primary_keys(state.backend, schema, name), state}
  end

  def handle_call({:migration_history, version}, _from, state) do
    {:reply, SchemaLoader.migration_history(state.backend, version), state}
  end

  def handle_call({:known_migration_version?, version}, _from, state) do
    {:reply, SchemaLoader.known_migration_version?(state.backend, version), state}
  end

  def handle_call(:electrified_tables, _from, state) do
    {:reply, SchemaLoader.electrified_tables(state.backend), state}
  end

  def handle_call({:relation, oid}, _from, state) when is_integer(oid) do
    {result, state} =
      with {{:ok, _version, schema}, state} <- current_schema(state),
           {:table, {:ok, table}} <- {:table, Schema.lookup_oid(schema, oid)} do
        {Schema.table_info(table), state}
      else
        {:table, :error} -> {{:error, "invalid table oid: #{inspect(oid)}"}, state}
        error -> {error, state}
      end

    {:reply, result, state}
  end

  def handle_call({:relation, {_sname, _tname} = relation}, _from, state) do
    {result, state} =
      with {{:ok, _version, schema}, state} <- current_schema(state),
           {:table, {:ok, table}} <- {:table, Schema.fetch_table(schema, relation)} do
        {Schema.table_info(table), state}
      else
        {:table, :error} -> {{:error, "invalid table #{inspect(relation)}"}, state}
        error -> {error, state}
      end

    {:reply, result, state}
  end

  def handle_call({:relation, relation, version}, _from, state) do
    {result, state} =
      with {:ok, ^version, schema} <- SchemaLoader.load(state.backend, version),
           {:table, {:ok, table}} <- {:table, Schema.fetch_table(schema, relation)} do
        {Schema.table_info(table), state}
      else
        {:table, :error} -> {{:error, "invalid table #{inspect(relation)}"}, state}
        error -> {error, state}
      end

    {:reply, result, state}
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
