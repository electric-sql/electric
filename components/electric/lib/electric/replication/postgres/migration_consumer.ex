defmodule Electric.Replication.Postgres.MigrationConsumer do
  @moduledoc """
  Holds state information about a postgres db instance, stored in tables within the db itself.
  """
  use GenStage

  import Electric.Postgres.Extension,
    only: [
      is_ddl_relation: 1,
      is_extension_relation: 1,
      is_perms_relation: 1
    ]

  alias Electric.Postgres.{
    Extension.SchemaLoader,
    Extension.SchemaCache,
    OidDatabase
  }

  alias Electric.Replication.Changes.Migration
  alias Electric.Replication.Connectors
  alias Electric.Replication.Postgres.Client
  alias Electric.Satellite.Permissions

  require Logger

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

    {:ok, permissions_consumer} = Permissions.State.new(loader)

    refresh_sub? = Keyword.get(opts, :refresh_subscription, true)

    Logger.info("Starting #{__MODULE__} using #{elem(loader, 0)} backend")

    state = %{
      origin: origin,
      publication: publication,
      subscription: subscription,
      producer: producer,
      loader: loader,
      permissions: permissions_consumer,
      opts: opts,
      refresh_subscription: refresh_sub?,
      refresh_enum_types: Keyword.get(opts, :refresh_enum_types, true),
      conn_opts: Connectors.get_connection_opts(conn_config)
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
  def handle_events(transactions, _from, state) do
    {txns, state} = process_transactions(transactions, state)
    {:noreply, txns, state}
  end

  defp process_transactions(transactions, state) do
    {_transactions, _state} =
      Enum.map_reduce(transactions, state, &process_transaction/2)
  end

  defp process_transaction(tx, state) do
    {changes, state} =
      {tx.changes, state}
      |> process_migrations()
      |> process_permissions()
      |> filter_changes()

    {%{tx | changes: changes}, state}
  end

  defp filter_changes({changes, state}) do
    filtered =
      Enum.filter(changes, fn
        %{relation: relation} when is_ddl_relation(relation) ->
          true

        %{relation: relation} when is_perms_relation(relation) ->
          false

        %{relation: relation} = change when is_extension_relation(relation) ->
          Logger.debug("---- Filtering #{inspect(change)}")
          false

        _change ->
          true
      end)

    {filtered, state}
  end

  defp process_migrations({changes, state}) do
    {changes, loader} =
      Electric.Postgres.Migration.State.update(changes, state.loader,
        schema_change_handler: &update_oids_after_migration(&1, &2, state),
        skip_applied: true
      )

    state =
      Enum.reduce(changes, %{state | loader: loader}, fn
        %Migration{} = migration, state ->
          # By pre-emptively updating the permissions with the schema changes,
          # we are effectively re-ordering the changes within a tx. I don't think
          # this is a problem but it's something to be aware of.
          state
          |> refresh_permissions_consumer(migration.schema)
          |> refresh_subscription()

        _change, state ->
          state
      end)

    {changes, state}
  end

  defp process_permissions({changes, state}) do
    %{permissions: consumer_state, loader: loader} = state

    {:ok, changes, consumer_state, loader} =
      Permissions.State.update(changes, consumer_state, loader)

    {changes, %{state | permissions: consumer_state, loader: loader}}
  end

  defp update_oids_after_migration(old_schema_version, new_schema_version, state) do
    if state.refresh_enum_types &&
         old_schema_version.schema.enums != new_schema_version.schema.enums do
      Client.with_conn(state.conn_opts, fn conn -> OidDatabase.update_oids(conn, [:ENUM]) end)
    end
  end

  # update the subscription to add any new
  # tables (this only works when data has been added -- doing it at the
  # point of receiving the migration has no effect).
  defp refresh_subscription(%{refresh_subscription: refresh?} = state) do
    if refresh? do
      Logger.debug("#{__MODULE__} refreshing subscription '#{state.subscription}'")
      :ok = SchemaLoader.refresh_subscription(state.loader, state.subscription)
    end

    state
  end

  defp refresh_permissions_consumer(state, schema_version) do
    consumer_state = Permissions.State.update_schema(state.permissions, schema_version)
    %{state | permissions: consumer_state}
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
end
