defmodule Electric.Shapes.Filter.Indexes.SubqueryIndex.Compactor do
  @moduledoc """
  Periodic compactor for `MultiTimeView` retained histories.

  Every `interval_ms` the compactor walks every subquery known to the stack's
  `MultiTimeView` and advances its `min_required_time` to the minimum required
  by any registered consumer (read from `SubqueryProgressMonitor`). Histories
  that compact to empty (values no longer a member at any retained time) have
  their positive-routing rows removed from `SubqueryIndex` as well, so the
  routing path doesn't grow without bound.

  See RFC §*Compaction*.
  """

  use GenServer

  require Logger

  alias Electric.Shapes.Filter.Indexes.SubqueryIndex
  alias Electric.Shapes.Filter.Indexes.SubqueryIndex.MultiTimeView
  alias Electric.Shapes.Filter.Indexes.SubqueryIndex.ProgressMonitor

  import Electric, only: [is_stack_id: 1]

  @default_interval_ms 10_000

  def name(stack_id) when is_stack_id(stack_id) do
    Electric.ProcessRegistry.name(stack_id, __MODULE__)
  end

  def start_link(opts) do
    stack_id = Keyword.fetch!(opts, :stack_id)
    GenServer.start_link(__MODULE__, opts, name: name(stack_id))
  end

  @doc """
  Run one compaction pass synchronously. Intended for tests; production
  compaction runs from the periodic tick.
  """
  def compact_now(stack_id) when is_stack_id(stack_id) do
    GenServer.call(name(stack_id), :compact_now)
  end

  @impl true
  def init(opts) do
    stack_id = Keyword.fetch!(opts, :stack_id)
    interval_ms = Keyword.get(opts, :interval_ms, @default_interval_ms)
    Process.set_label({:subquery_compactor, stack_id})
    schedule_tick(interval_ms)

    {:ok, %{stack_id: stack_id, interval_ms: interval_ms}}
  end

  @impl true
  def handle_call(:compact_now, _from, state) do
    run_compaction(state.stack_id)
    {:reply, :ok, state}
  end

  @impl true
  def handle_info(:tick, state) do
    run_compaction(state.stack_id)
    schedule_tick(state.interval_ms)
    {:noreply, state}
  end

  defp schedule_tick(interval_ms), do: Process.send_after(self(), :tick, interval_ms)

  defp run_compaction(stack_id) do
    with mtv when not is_nil(mtv) <- MultiTimeView.for_stack(stack_id) do
      index = SubqueryIndex.for_stack(stack_id)

      for subquery_id <- MultiTimeView.subquery_ids(mtv),
          min_time = ProgressMonitor.min_required_time(stack_id, subquery_id),
          is_integer(min_time) do
        compact_subquery(mtv, index, subquery_id, min_time)
      end
    end
  end

  defp compact_subquery(mtv, index, subquery_id, min_time) do
    removed = MultiTimeView.set_min_required_time(mtv, subquery_id, min_time)

    if index do
      for value <- removed do
        SubqueryIndex.remove_positive_route(index, subquery_id, value)
      end
    end
  end
end
