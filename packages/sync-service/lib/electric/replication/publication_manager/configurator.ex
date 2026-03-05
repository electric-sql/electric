defmodule Electric.Replication.PublicationManager.Configurator do
  @moduledoc """
  Configures and maintains a PostgreSQL publication on behalf of
  Electric.Replication.PublicationManager.RelationTracker.

  It receives requests to update the publication such that a given
  set of relations are published with REPLICA IDENTITY FULL, and
  performs the necessary SQL commands to ensure that the publication
  matches the requested set of relations.

  Each relation is updated individually to avoid blocking all other
  operations on the publication due to locks held on individual tables.
  """
  use GenServer

  require Logger

  alias Electric.Replication.PublicationManager
  alias Electric.Replication.PublicationManager.RelationTracker
  alias Electric.Postgres.Configuration
  alias Electric.Utils
  alias Electric.Telemetry.OpenTelemetry

  @enforce_keys [
    :stack_id,
    :publication_name,
    :db_pool,
    :manual_table_publishing?,
    :can_alter_publication?,
    :scheduled_filters,
    :update_debounce_timeout,
    :scheduled_update_ref
  ]

  defstruct @enforce_keys

  @type state :: %__MODULE__{
          stack_id: Electric.stack_id(),
          publication_name: String.t(),
          manual_table_publishing?: boolean(),
          can_alter_publication?: boolean(),
          scheduled_filters: PublicationManager.RelationTracker.relation_filters() | nil,
          update_debounce_timeout: timeout(),
          scheduled_update_ref: nil | reference()
        }

  def name(stack_ref), do: Electric.ProcessRegistry.name(stack_ref, __MODULE__)

  def configure_publication(opts, filters) do
    GenServer.cast(name(opts), {:update_publication, filters})
  end

  def start_link(opts) do
    stack_id = Keyword.fetch!(opts, :stack_id)

    opts = Keyword.put_new(opts, :db_pool, Electric.Connection.Manager.admin_pool(stack_id))

    GenServer.start_link(__MODULE__, opts, name: name(stack_id))
  end

  @impl true
  def init(opts) do
    opts = Map.new(opts)

    Process.set_label({:publication_manager_configurator, opts.stack_id})
    Logger.metadata(stack_id: opts.stack_id)
    Electric.Telemetry.Sentry.set_tags_context(stack_id: opts.stack_id)

    {
      :ok,
      %__MODULE__{
        stack_id: opts.stack_id,
        publication_name: opts.publication_name,
        db_pool: opts.db_pool,
        manual_table_publishing?: opts.manual_table_publishing?,
        can_alter_publication?: true,
        scheduled_filters: nil,
        update_debounce_timeout: opts.update_debounce_timeout,
        scheduled_update_ref: nil
      },
      {:continue, :fetch_initial_filters}
    }
  end

  @impl true
  def handle_cast({:update_publication, filters}, %{scheduled_update_ref: nil} = state) do
    ref = Process.send_after(self(), :debounced_update_publication, state.update_debounce_timeout)
    {:noreply, %{state | scheduled_filters: filters, scheduled_update_ref: ref}}
  end

  def handle_cast({:update_publication, filters}, state) do
    {:noreply, %{state | scheduled_filters: filters}}
  end

  @impl true
  def handle_info(:debounced_update_publication, state) do
    {
      :noreply,
      %{state | scheduled_filters: nil, scheduled_update_ref: nil},
      {:continue, {:check_publication, state.scheduled_filters}}
    }
  end

  @impl true
  def handle_continue(:fetch_initial_filters, state) do
    filters = RelationTracker.fetch_current_filters!(stack_id: state.stack_id)
    {:noreply, state, {:continue, {:check_publication, filters}}}
  end

  def handle_continue({:check_publication, filters}, state) do
    case check_publication_status(state) do
      {:ok, status} ->
        state = %{state | can_alter_publication?: status.can_alter_publication?}

        RelationTracker.notify_publication_status(status, stack_id: state.stack_id)

        {:noreply, state, {:continue, {:configure_filters, filters}}}

      {:error, err} ->
        notify_global_configuration_error(err, state)
        {:noreply, state}
    end
  end

  def handle_continue({:configure_filters, filters}, state) do
    case determine_publication_relation_actions(state, filters) do
      {:ok,
       %{
         to_preserve: to_preserve,
         to_invalidate: to_invalidate,
         to_add: to_add,
         to_drop: to_drop,
         to_configure_replica_identity: to_configure_replica_identity
       }} ->
        to_configure_only = MapSet.difference(to_configure_replica_identity, to_add)

        notify_filters_result(to_preserve, {:ok, :configured}, state)
        notify_filters_result(to_invalidate, {:error, :schema_changed}, state)

        if can_update_publication?(state) do
          to_add_and_configure = MapSet.intersection(to_add, to_configure_replica_identity)
          to_add_only = MapSet.difference(to_add, to_configure_replica_identity)

          # Notes on avoiding deadlocks
          # - `ALTER TABLE` should be after the publication altering, because it takes out an exclusive lock over this table,
          #   but the publication altering takes out a shared lock on all mentioned tables, so a concurrent transaction will
          #   deadlock if the order is reversed, and we've seen this happen even within the context of a single process perhaps
          #   across multiple calls from separate deployments or timing issues.
          # - It is important for all table operations to also occur in the same order to avoid deadlocks due to
          #   lock ordering issues, so despite splitting drop and add operations we sort them and process them together
          #   in a sorted single pass
          relation_actions =
            [
              Enum.map(to_add_only, &{:add, &1}),
              Enum.map(to_add_and_configure, &{:add_and_configure, &1}),
              Enum.map(to_configure_only, &{:configure, &1}),
              Enum.map(to_drop, &{:drop, &1})
            ]
            |> Stream.concat()
            |> Enum.sort(&(elem(&1, 1) <= elem(&2, 1)))

          if relation_actions != [] do
            to_add_list = for {_, rel} <- to_add, do: Utils.relation_to_sql(rel)
            to_drop_list = for {_, rel} <- to_drop, do: Utils.relation_to_sql(rel)
            to_invalidate_list = for {_, rel} <- to_invalidate, do: Utils.relation_to_sql(rel)

            to_configure_list =
              for {_, rel} <- to_configure_replica_identity, do: Utils.relation_to_sql(rel)

            Logger.notice(
              "Configuring publication #{state.publication_name} to " <>
                "drop #{inspect(to_drop_list)} tables, " <>
                "add #{inspect(to_add_list)} tables, " <>
                "and configure replica identity for #{inspect(to_configure_list)} tables " <>
                "- skipping altered tables #{inspect(to_invalidate_list)}",
              publication_alter_drop_tables: to_drop_list,
              publication_alter_add_tables: to_add_list,
              publication_alter_configure_replica_identity: to_configure_list,
              publication_alter_invalid_tables: to_invalidate_list
            )
          end

          {:noreply, state, {:continue, {:perform_relation_actions, relation_actions}}}
        else
          notify_filters_result(to_add, {:error, :relation_missing_from_publication}, state)

          notify_filters_result(
            to_configure_only,
            {:error, :misconfigured_replica_identity},
            state
          )

          if MapSet.size(to_add) == 0 and MapSet.size(to_configure_replica_identity) == 0 do
            Logger.notice(fn ->
              tables = for {_, rel} <- to_preserve, do: Utils.relation_to_sql(rel)

              "Verified publication #{state.publication_name} to include #{inspect(tables)} " <>
                "tables with REPLICA IDENTITY FULL"
            end)
          end

          {:noreply, state}
        end

      {:error, err} ->
        notify_global_configuration_error(err, state)
        {:noreply, state}
    end
  end

  def handle_continue({:perform_relation_actions, []}, state) do
    Logger.debug("Processed all publication relation actions")
    {:noreply, state}
  end

  def handle_continue({:perform_relation_actions, [{action, filter} | rest]}, state) do
    {_oid, rel} = filter

    res =
      OpenTelemetry.with_span(
        "publication_manager.update_publication_relation",
        [action: inspect(action), relation: Utils.relation_to_sql(rel)],
        state.stack_id,
        fn -> do_publication_update(action, filter, state) end
      )

    notify_filter_result(filter, res, state)

    {:noreply, state, {:continue, {:perform_relation_actions, rest}}}
  end

  @spec check_publication_status(state()) ::
          {:ok, Configuration.publication_status()} | {:error, any()}
  defp check_publication_status(state) do
    Configuration.run_handling_db_connection_errors(fn ->
      case Configuration.check_publication_status!(state.db_pool, state.publication_name) do
        :not_found ->
          err = Electric.DbConfigurationError.publication_missing(state.publication_name)
          handle_publication_fatally_misconfigured(err, state)
          {:error, err}

        %{publishes_all_operations?: false} ->
          err =
            Electric.DbConfigurationError.publication_missing_operations(state.publication_name)

          handle_publication_fatally_misconfigured(err, state)
          {:error, err}

        status ->
          {:ok, status}
      end
    end)
  end

  @spec determine_publication_relation_actions(state(), RelationTracker.relation_filters()) ::
          {:ok, Configuration.relation_actions()} | {:error, any()}
  defp determine_publication_relation_actions(state, filters) do
    Configuration.run_handling_db_connection_errors(fn ->
      res =
        Configuration.determine_publication_relation_actions!(
          state.db_pool,
          state.publication_name,
          filters
        )

      {:ok, res}
    end)
  end

  @spec do_publication_update(
          :add_and_configure | :add | :configure | :drop,
          Electric.oid_relation(),
          state()
        ) :: {:ok, :configured | :dropped} | {:error, any()}
  defp do_publication_update(action, filter, state)

  defp do_publication_update(:add_and_configure, filter, state) do
    with :ok <-
           Configuration.configure_table_for_replication(
             state.db_pool,
             state.publication_name,
             filter
           ) do
      {:ok, :configured}
    end
  end

  defp do_publication_update(:add, filter, state) do
    with :ok <-
           Configuration.add_table_to_publication(state.db_pool, state.publication_name, filter) do
      {:ok, :configured}
    end
  end

  defp do_publication_update(:configure, filter, state) do
    with :ok <- Configuration.set_table_replica_identity_full(state.db_pool, filter) do
      {:ok, :configured}
    end
  end

  defp do_publication_update(:drop, filter, state) do
    with :ok <-
           Configuration.drop_table_from_publication(
             state.db_pool,
             state.publication_name,
             filter
           ) do
      {:ok, :dropped}
    end
  end

  defp handle_publication_fatally_misconfigured(err, %{manual_table_publishing?: true}),
    do:
      Logger.warning("""
      Publication fatal misconfiguration: #{inspect(err)}
      Recovery attempt skipped due to manual table publishing mode.
      Please ensure that the publication is created and configured correctly.
      """)

  defp handle_publication_fatally_misconfigured(err, state) do
    Logger.warning("""
    Publication fatal misconfiguration: #{inspect(err)}
    Attempting recovery through a restart and fresh setup of connection subsystem.
    """)

    Electric.Connection.Restarter.restart_connection_subsystem(state.stack_id)
    :ok
  end

  defp can_update_publication?(%__MODULE__{
         can_alter_publication?: can_alter,
         manual_table_publishing?: manual
       }) do
    can_alter and not manual
  end

  defp notify_filters_result(filters, reply, state) do
    for filter <- filters, do: notify_filter_result(filter, reply, state)
  end

  defp notify_filter_result(filter, {:ok, res} = reply, state)
       when res in [:configured, :dropped] do
    RelationTracker.notify_relation_configuration_result(filter, reply, stack_id: state.stack_id)
  end

  defp notify_filter_result(filter, {:error, err}, state) do
    reply = {:error, publication_error(err, filter, state)}
    RelationTracker.notify_relation_configuration_result(filter, reply, stack_id: state.stack_id)
  end

  defp notify_global_configuration_error(err, state) do
    RelationTracker.notify_configuration_error({:error, err}, stack_id: state.stack_id)
  end

  defp publication_error(:relation_missing_from_publication, oid_rel, state) do
    tail =
      cond do
        state.manual_table_publishing? ->
          "the ELECTRIC_MANUAL_TABLE_PUBLISHING setting prevents Electric from adding it"

        not state.can_alter_publication? ->
          "Electric lacks privileges to add it"
      end

    {_oid, rel} = oid_rel
    table = rel |> Utils.relation_to_sql() |> Utils.quote_name()

    %Electric.DbConfigurationError{
      type: :relation_missing_from_publication,
      message:
        "Database table #{table} is missing from " <>
          "the publication #{Utils.quote_name(state.publication_name)} and " <>
          tail
    }
  end

  defp publication_error(:misconfigured_replica_identity, oid_rel, _state) do
    {_oid, rel} = oid_rel
    table = rel |> Utils.relation_to_sql() |> Utils.quote_name()

    %Electric.DbConfigurationError{
      type: :misconfigured_replica_identity,
      message: "Database table #{table} does not have its replica identity set to FULL"
    }
  end

  defp publication_error(:schema_changed, oid_rel, _state) do
    {_oid, rel} = oid_rel

    table = rel |> Utils.relation_to_sql() |> Utils.quote_name()

    %Electric.DbConfigurationError{
      type: :schema_changed,
      message: "Database table #{table} has been dropped or renamed"
    }
  end

  defp publication_error(reason, _oid_rel, _state), do: reason
end
