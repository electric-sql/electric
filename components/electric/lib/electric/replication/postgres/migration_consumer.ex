defmodule Electric.Replication.Postgres.MigrationConsumer do
  @moduledoc """
  Holds state information about a postgres db instance, stored in tables within the db itself.
  """
  use GenStage

  alias Electric.Telemetry.Metrics
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
    Schema
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

    %{publication: publication, subscription: subscription} =
      Connectors.get_replication_opts(conn_config)

    Logger.metadata(pg_producer: origin)

    {:ok, producer} = Keyword.fetch(opts, :producer)

    :ok = await_producer(producer)

    {:ok, loader} =
      opts
      |> SchemaLoader.get(:backend, SchemaCache)
      |> SchemaLoader.connect(conn_config)

    refresh_sub? = Keyword.get(opts, :refresh_subscription, false)

    Logger.info("Starting #{__MODULE__} using #{elem(loader, 0)} backend")

    state = %{
      origin: origin,
      publication: publication,
      subscription: subscription,
      producer: producer,
      loader: loader,
      opts: opts,
      refresh_subscription: refresh_sub?
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
    {:noreply, filter_transactions(events), process_relations_and_migrations(events, state)}
  end

  defp filter_transactions(events) do
    for event <- events, not match?(%Relation{}, event) do
      filter_transaction(event)
    end
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

  defp process_relations_and_migrations(events, state) do
    grouped_events = Enum.group_by(events, & &1.__struct__)

    state
    |> apply_relations(Map.get(grouped_events, Relation, []))
    |> apply_migrations(Map.get(grouped_events, Transaction, []))
  end

  defp apply_relations(state, relations) do
    Enum.reduce(relations, state, &process_relation/2)
  end

  defp apply_migrations(state, transactions) do
    transactions
    |> Enum.flat_map(&transaction_changes_to_migrations(&1, state))
    |> Enum.group_by(&elem(&1, 0), &elem(&1, 1))
    |> Enum.reduce(state, &perform_migration/2)
  end

  defp process_relation(%Relation{} = _relation, state) do
    refresh_subscription(state)
  end

  # update the subscription to add any new
  # tables (this only works when data has been added -- doing it at the
  # point of receiving the migration has no effect).
  defp refresh_subscription(%{refresh_subscription: false} = state) do
    state
  end

  defp refresh_subscription(state) do
    Logger.debug("#{__MODULE__} refreshing subscription '#{state.subscription}'")
    :ok = SchemaLoader.refresh_subscription(state.loader, state.subscription)
    state
  end

  defp transaction_changes_to_migrations(%Transaction{changes: changes}, state) do
    for %NewRecord{record: record, relation: relation} <- changes, is_ddl_relation(relation) do
      {:ok, version} = SchemaLoader.tx_version(state.loader, record)
      {:ok, sql} = Extension.extract_ddl_sql(record)
      {version, sql}
    end
  end

  defp perform_migration({version, stmts}, state) do
    {:ok, loader} = apply_migration(version, stmts, state.loader)

    {:ok, table_count} = SchemaLoader.count_electrified_tables(loader)

    Metrics.non_span_event(
      [:postgres, :migration],
      %{electrified_tables: table_count},
      %{migration_version: version}
    )

    refresh_subscription(%{state | loader: loader})
  end

  @impl GenStage
  def handle_cancel({:down, _}, _from, %{producer: producer} = state) do
    Logger.warning("producer is down: #{inspect(producer)}")
    await_producer(producer)
    {:noreply, [], state}
  end

  defp await_producer(producer) when is_pid(producer) do
    send(self(), {:subscribe, producer})
    :ok
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

  @doc """
  Apply a migration, composed of a version and a list of DDL statements, to a schema
  using the given implementation of SchemaLoader.
  """
  @spec apply_migration(String.t(), [String.t()], SchemaLoader.t()) ::
          {:ok, SchemaLoader.t()} | {:error, term()}
  def apply_migration(version, stmts, loader) when is_list(stmts) do
    {:ok, old_version, schema} = SchemaLoader.load(loader)

    Logger.info("Migrating version #{old_version || "<nil>"} -> #{version}")

    oid_loader = &SchemaLoader.relation_oid(loader, &1, &2, &3)

    schema =
      Enum.reduce(stmts, schema, fn stmt, schema ->
        Logger.info("Applying migration #{version}: #{inspect(stmt)}")
        Schema.update(schema, stmt, oid_loader: oid_loader)
      end)
      |> Schema.add_shadow_tables(oid_loader: oid_loader)

    Logger.info("Saving schema version #{version} /#{inspect(loader)}/")

    {:ok, _loader} = SchemaLoader.save(loader, version, schema, stmts)
  end
end
