defmodule Electric.Replication.Postgres.MigrationConsumer do
  @moduledoc """
  Holds state information about a postgres db instance, stored in tables within the db itself.
  """
  use GenStage

  alias Ecto.Adapter.Transaction
  alias Electric.Replication.Connectors

  alias Electric.Replication.Changes.{
    NewRecord,
    Transaction,
    Relation
  }

  alias Electric.Postgres.{
    Extension,
    Extension.SchemaLoader,
    Extension.SchemaCache,
    Schema,
    SchemaRegistry
  }

  require Logger

  import Electric.Postgres.Extension, only: [is_ddl_relation: 1, is_extension_relation: 1]

  @spec name(Connectors.config()) :: Electric.reg_name()
  def name(conn_config) when is_list(conn_config) do
    name(Connectors.origin(conn_config))
  end

  @spec name(Connectors.origin()) :: Electric.reg_name()
  def name(origin) when is_binary(origin) do
    Electric.name(__MODULE__, origin)
  end

  def start_link({conn_config, opts}) do
    start_link(conn_config, opts)
  end

  def start_link(conn_config, opts \\ []) do
    GenStage.start_link(__MODULE__, {conn_config, opts}, name: name(conn_config))
  end

  @impl GenStage
  def init({conn_config, opts}) do
    origin = Connectors.origin(conn_config)
    %{publication: publication} = Connectors.get_replication_opts(conn_config)

    Logger.metadata(pg_producer: origin)

    {:ok, producer} = Keyword.fetch(opts, :producer)

    :ok = await_producer(producer)

    {:ok, loader} =
      opts
      |> SchemaLoader.get(:backend, SchemaCache)
      |> SchemaLoader.connect(conn_config)

    Logger.info("Starting #{__MODULE__} using #{elem(loader, 0)} backend")

    state = %{
      origin: origin,
      publication: publication,
      producer: producer,
      loader: loader,
      opts: opts
    }

    {:producer_consumer, state}
  end

  @impl GenStage
  def handle_info({:subscribe, pid}, state) do
    subscribe_producer(pid)

    {:noreply, [], state}
  end

  def handle_info({:gproc, _, :registered, {_stage, pid, _}}, state) do
    subscribe_producer(pid)

    {:noreply, [], state}
  end

  @impl GenStage
  def handle_events(events, _from, state) do
    {:noreply, filter_events(events, []), process_events(events, {[], state})}
  end

  defp filter_events([], acc) do
    Enum.reverse(acc)
  end

  defp filter_events([%Relation{} | events], acc) do
    filter_events(events, acc)
  end

  defp filter_events([event | events], acc) do
    filter_events(events, [filter_transaction(event) | acc])
  end

  # FIXME: we need this to prevent extension metadata tables from being
  # replicated between pg instances. Should be removed once we're only
  # replicating a subset of tables, rather than all
  defp filter_transaction(%Transaction{changes: changes} = tx) do
    filtered =
      Enum.filter(changes, fn
        %{relation: relation} when is_ddl_relation(relation) ->
          true

        %{relation: relation} = change when is_extension_relation(relation) ->
          Logger.debug("---- Filtering #{inspect(change)}")
          false

        # TODO: VAX-680 remove this special casing of schema_migrations table
        # once we are selectivley replicating tables
        %{relation: {"public", "schema_migrations"}} ->
          false

        _change ->
          true
      end)

    %{tx | changes: filtered}
  end

  defp filter_transaction(change) do
    change
  end

  defp process_events([], {[], state}) do
    state
  end

  defp process_events([], {migrations, state}) do
    migrations
    |> Enum.reverse()
    |> Enum.group_by(&elem(&1, 0), &elem(&1, 1))
    |> Enum.reduce(state, &perform_migration/2)
  end

  defp process_events([%Transaction{changes: changes} | events], {migrations, state}) do
    process_events(events, process_transaction(changes, {migrations, state}))
  end

  defp process_events([%Relation{} = relation | events], {migrations, state}) do
    # TODO: look at the schema registry as-is and see if it can't be replaced
    # with the new materialised schema information held by electric
    {table, columns} = Relation.to_schema_table(relation)
    {:ok, pks} = SchemaLoader.primary_keys(state.loader, table.schema, table.name)

    table = %{table | primary_keys: pks}

    # FIXME: Since we use fake oids for our schema, we need to keep them consistent
    # so retrieve the generated oid from the registry and use it if it exists
    # This function is slow because it doesn't return until the timeout
    table =
      case SchemaRegistry.fetch_existing_table_info({table.schema, table.name}) do
        {:ok, existing_table} ->
          %{table | oid: existing_table.oid}

        :error ->
          table
      end

    :ok = SchemaRegistry.add_replicated_tables(state.publication, [table])
    :ok = SchemaRegistry.put_table_columns({table.schema, table.name}, columns)

    process_events(events, {migrations, state})
  end

  defp process_events([_event | events], {migrations, state}) do
    process_events(events, {migrations, state})
  end

  defp process_transaction([], {migrations, state}) do
    {migrations, state}
  end

  defp process_transaction(
         [%NewRecord{relation: relation} = record | changes],
         {migrations, state}
       )
       when is_ddl_relation(relation) do
    {:ok, version, sql} = Extension.extract_ddl_version(record.record)
    process_transaction(changes, {[{version, sql} | migrations], state})
  end

  defp process_transaction([_record | changes], {migrations, state}) do
    process_transaction(changes, {migrations, state})
  end

  defp perform_migration({version, stmts}, state) do
    {:ok, old_version, schema} = load_schema(state)

    Logger.info("Applying migration #{old_version} -> #{version}")

    oid_loader = &SchemaLoader.relation_oid(state.loader, &1, &2, &3)

    schema =
      Enum.reduce(stmts, schema, fn stmt, schema ->
        Logger.info("Applying migration #{version}: #{inspect(stmt)}")
        Schema.update(schema, stmt, oid_loader: oid_loader)
      end)

    save_schema(state, version, schema, stmts)
  end

  defp load_schema(state) do
    SchemaLoader.load(state.loader)
  end

  # TODO: include the stmts in the saved schema row
  # https://linear.app/electric-sql/issue/VAX-650/record-migration-alongside-final-schema
  defp save_schema(state, version, schema, _stmts) do
    Logger.info("Saving schema version #{version} /#{inspect(state.loader)}/")
    {:ok, loader} = SchemaLoader.save(state.loader, version, schema)
    %{state | loader: loader}
  end

  @impl GenStage
  def handle_cancel({:down, _}, _from, %{producer: producer} = state) do
    Logger.warn("producer is down: #{inspect(producer)}")
    await_producer(producer)
    {:noreply, [], state}
  end

  defp await_producer(producer) when is_pid(producer) do
    send(self(), {:subscribe, producer})
  end

  defp await_producer({:via, :gproc, name}) do
    :gproc.nb_wait(name)
    :ok
  end

  defp subscribe_producer(producer) when is_pid(producer) do
    Logger.debug("request subscription to #{inspect(producer)}")

    :ok =
      GenStage.async_subscribe(self(),
        to: producer,
        cancel: :temporary,
        min_demand: 10,
        max_demand: 50
      )
  end
end
