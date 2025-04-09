defmodule Electric.StatusMonitor do
  use GenServer

  @conditions [
    :pg_lock_acquired,
    :replication_client_ready,
    :connection_pool_ready,
    :shape_log_collector_ready
  ]

  @default_results for condition <- @conditions, into: %{}, do: {condition, false}

  def start_link(stack_id) do
    GenServer.start_link(__MODULE__, stack_id, name: name(stack_id))
  end

  def init(stack_id) do
    Process.set_label({:status_monitor, stack_id})
    Electric.Telemetry.Sentry.set_tags_context(stack_id: stack_id)

    :ets.new(ets_table(stack_id), [:named_table, :protected])

    {:ok, %{stack_id: stack_id}}
  end

  def status(stack_id) do
    case results(stack_id) do
      %{pg_lock_acquired: false} ->
        :waiting

      %{
        replication_client_ready: true,
        connection_pool_ready: true,
        shape_log_collector_ready: true
      } ->
        :active

      _ ->
        :starting
    end
  end

  def pg_lock_acquired(stack_id) do
    condition_met(stack_id, :pg_lock_acquired)
  end

  def replication_client_ready(stack_id) do
    condition_met(stack_id, :replication_client_ready)
  end

  def connection_pool_ready(stack_id, _pool_pid) do
    condition_met(stack_id, :connection_pool_ready)
  end

  def shape_log_collector_ready(stack_id) do
    condition_met(stack_id, :shape_log_collector_ready)
  end

  defp condition_met(stack_id, condition) do
    GenServer.call(name(stack_id), {:condition_met, condition})
  end

  def handle_call({:condition_met, condition}, _from, state) when condition in @conditions do
    :ets.insert(ets_table(state.stack_id), {condition, true})
    {:reply, :ok, state}
  end

  defp results(stack_id) do
    results =
      stack_id
      |> ets_table()
      |> :ets.tab2list()
      |> Map.new()

    Map.merge(@default_results, results)
  rescue
    ArgumentError ->
      # This happens when the table is not found, which means the process is not started
      @default_results
  end

  defp name(stack_id) do
    Electric.ProcessRegistry.name(stack_id, __MODULE__)
  end

  defp ets_table(stack_id) do
    :"#{stack_id}:status_monitor"
  end
end
