defmodule Electric.Replication.SchemaReconciler do
  @moduledoc """
  Takes care of periodically reconciling the schema of the database with
  the inspector caches and active shapes.

  Covers cases where either the table was recreated and thus isn't in the
  publication anymore, or where some alterations were made to the schema,
  but we don't see them because there were no writes to the affected tables.
  """

  use GenServer

  require Logger

  alias Electric.Postgres.Inspector
  alias Electric.ShapeCache.ShapeCleaner

  @name_schema_tuple {:tuple, [:atom, :atom, :any]}
  @genserver_name_schema {:or, [:atom, @name_schema_tuple]}
  @schema NimbleOptions.new!(
            name: [type: @genserver_name_schema, required: false],
            period: [type: :pos_integer, required: false, default: 60_000],
            inspector: [type: :any, required: true],
            stack_id: [type: :string, required: true]
          )

  def start_link(opts) do
    with {:ok, opts} <- NimbleOptions.validate(Map.new(opts), @schema) do
      name = Map.get(opts, :name, name(opts.stack_id))
      GenServer.start_link(__MODULE__, opts, name: name)
    end
  end

  def name(stack_id) do
    Electric.ProcessRegistry.name(stack_id, __MODULE__)
  end

  @doc """
  Triggers an immediate schema reconciliation check.
  """
  def reconcile_now(name_or_pid) do
    GenServer.call(name_or_pid, :reconcile_now)
  end

  def init(opts) do
    Process.set_label({:schema_reconciler, opts.stack_id})
    Logger.metadata(stack_id: opts.stack_id)
    Electric.Telemetry.Sentry.set_tags_context(stack_id: opts.stack_id)

    Logger.debug("SchemaReconciler started with state #{inspect(opts)}")
    {:ok, opts, {:continue, :reconcile}}
  end

  def handle_continue(:schedule_next_check, state) do
    Process.send_after(self(), :reconcile, state.period)
    {:noreply, state}
  end

  def handle_continue(:reconcile, state) do
    _ = handle_reconcile(state)
    {:noreply, state, {:continue, :schedule_next_check}}
  end

  def handle_call(:reconcile_now, _from, state) do
    _ = handle_reconcile(state)
    {:reply, :ok, state}
  end

  def handle_info(:reconcile, state) do
    {:noreply, state, {:continue, :reconcile}}
  end

  defp handle_reconcile(state) do
    case Electric.StatusMonitor.status(state.stack_id) do
      %{conn: :up} ->
        state.inspector
        |> Inspector.list_relations_with_stale_cache()
        |> handle_diverged_relations(state)

      status ->
        Logger.debug("Schema reconciliation skipped due to inactive stack: #{inspect(status)}")
    end
  catch
    # We essentially never want to fail here, as this is a periodic task.
    # If it fails, we'll just try again next time, so no additional retries are implemented
    type, reason ->
      st = __STACKTRACE__
      Logger.error("Schema reconciliation failed: #{Exception.format(type, reason, st)}")
      :error
  end

  defp handle_diverged_relations({:ok, []}, _state), do: :ok

  defp handle_diverged_relations({:ok, diverged_relations}, state) do
    with :ok <-
           ShapeCleaner.remove_shapes_for_relations(diverged_relations, stack_id: state.stack_id),
         :ok <-
           Enum.each(diverged_relations, fn {oid, _} -> Inspector.clean(oid, state.inspector) end) do
      :ok
    else
      {:error, reason} ->
        Logger.warning("Schema reconciliation failed: #{reason}")
        :error
    end
  end

  defp handle_diverged_relations(:error, _state),
    do: Logger.warning("Schema reconciliation failed while fetching fresh relations")
end
