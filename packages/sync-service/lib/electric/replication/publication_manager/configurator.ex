defmodule Electric.Replication.PublicationManager.Configurator do
  @moduledoc false
  use GenServer

  require Logger

  alias Electric.Replication.PublicationManager
  alias Electric.Postgres.Configuration
  alias Electric.Utils

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

  def name(stack_id) when not is_map(stack_id) and not is_list(stack_id),
    do: Electric.ProcessRegistry.name(stack_id, __MODULE__)

  def name(opts), do: name(Access.fetch!(opts, :stack_id))

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
      }
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
  def handle_continue({:check_publication, filters}, state) do
    case check_publication_status(state) do
      {:ok, status} ->
        state = %{state | can_alter_publication?: status.can_alter_publication?}

        PublicationManager.RelationTracker.notify_publication_status(
          [stack_id: state.stack_id],
          status
        )

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

        notify_filters_result(to_preserve, {:ok, :validated}, state)
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

          {:noreply, state, {:continue, {:perform_relation_actions, relation_actions}}}
        else
          notify_filters_result(to_add, {:error, :relation_missing_from_publication}, state)

          notify_filters_result(
            to_configure_only,
            {:error, :misconfigured_replica_identity},
            state
          )

          if MapSet.size(to_add) == 0 and MapSet.size(to_configure_replica_identity) == 0 do
            Logger.info(fn ->
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
    {:noreply, state}
  end

  def handle_continue({:perform_relation_actions, [{:add, filter} | rest]}, state) do
    do_relation_action(
      &Configuration.add_table_to_publication(&1, state.publication_name, filter),
      filter,
      state
    )

    {:noreply, state, {:continue, {:perform_relation_actions, rest}}}
  end

  def handle_continue(
        {:perform_relation_actions, [{:add_and_configure, filter} | rest]},
        state
      ) do
    do_relation_action(
      fn conn ->
        with {:ok, :added} <-
               Configuration.add_table_to_publication(conn, state.publication_name, filter),
             {:ok, :configured} <-
               Configuration.set_table_replica_identity_full(conn, filter) do
          {:ok, :added}
        end
      end,
      filter,
      state
    )

    {:noreply, state, {:continue, {:perform_relation_actions, rest}}}
  end

  def handle_continue({:perform_relation_actions, [{:configure, filter} | rest]}, state) do
    do_relation_action(
      &Configuration.set_table_replica_identity_full(&1, filter),
      filter,
      state
    )

    {:noreply, state, {:continue, {:perform_relation_actions, rest}}}
  end

  def handle_continue({:perform_relation_actions, [{:drop, filter} | rest]}, state) do
    do_relation_action(
      &Configuration.drop_table_from_publication(&1, state.publication_name, filter),
      filter,
      state
    )

    {:noreply, state, {:continue, {:perform_relation_actions, rest}}}
  end

  @spec check_publication_status(state()) ::
          {:ok, Configuration.publication_status()} | {:error, any()}
  defp check_publication_status(state) do
    run_handling_db_connection_errors(fn ->
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

  @spec determine_publication_relation_actions(
          state(),
          PublicationManager.RelationTracker.relation_filters()
        ) ::
          {:ok, Configuration.relation_actions()} | {:error, any()}
  defp determine_publication_relation_actions(state, filters) do
    run_handling_db_connection_errors(fn ->
      res =
        Configuration.determine_publication_relation_actions!(
          state.db_pool,
          state.publication_name,
          filters
        )

      {:ok, res}
    end)
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

  defp do_relation_action(action_fn, filter, state) do
    result = run_in_transaction(state.db_pool, action_fn)
    notify_filter_result(filter, result, state)
  end

  defp run_in_transaction(db_pool, fun) do
    run_handling_db_connection_errors(fn ->
      case Postgrex.transaction(db_pool, fun) do
        {:ok, result} ->
          result

        {:error, :rollback} ->
          {:error, %RuntimeError{message: "Transaction unexpectedly rolled back"}}

        {:error, err} ->
          {:error, err}
      end
    end)
  end

  defp run_handling_db_connection_errors(fun) do
    fun.()
  rescue
    err -> {:error, err}
  catch
    :exit, {_, {DBConnection.Holder, :checkout, _}} ->
      {:error, %DBConnection.ConnectionError{message: "Database connection not available"}}
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

  defp notify_filter_result(filter, {:ok, _} = reply, state) do
    PublicationManager.RelationTracker.notify_relation_configuration_result(
      [stack_id: state.stack_id],
      filter,
      reply
    )
  end

  defp notify_filter_result(filter, {:error, err}, state) do
    reply = {:error, publication_error(err, filter, state)}

    PublicationManager.RelationTracker.notify_relation_configuration_result(
      [stack_id: state.stack_id],
      filter,
      reply
    )
  end

  defp notify_global_configuration_error(err, state) do
    PublicationManager.RelationTracker.notify_configuration_error(
      [stack_id: state.stack_id],
      {:error, err}
    )
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
