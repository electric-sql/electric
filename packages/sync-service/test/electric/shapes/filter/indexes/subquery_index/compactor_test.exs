defmodule Electric.Shapes.Filter.Indexes.SubqueryIndex.CompactorTest do
  use ExUnit.Case, async: true

  alias Electric.Shapes.Filter.Indexes.SubqueryIndex
  alias Electric.Shapes.Filter.Indexes.SubqueryIndex.Compactor
  alias Electric.Shapes.Filter.Indexes.SubqueryIndex.MultiTimeView
  alias Electric.Shapes.Filter.Indexes.SubqueryIndex.ProgressMonitor

  setup do
    stack_id = "compactor-test-#{System.unique_integer([:positive])}"
    Electric.ProcessRegistry.start_link(stack_id: stack_id)
    {:ok, _} = ProgressMonitor.start_link(stack_id: stack_id)
    {:ok, compactor} = Compactor.start_link(stack_id: stack_id, interval_ms: 3_600_000)

    mtv = MultiTimeView.new(stack_id: stack_id)
    %{stack_id: stack_id, mtv: mtv, compactor: compactor}
  end

  test "advances min_required_time and drops empty histories from MTV", %{
    stack_id: stack_id,
    mtv: mtv
  } do
    MultiTimeView.init_subquery(mtv, :sq, [1, 2])
    MultiTimeView.mark_ready(mtv, :sq)
    MultiTimeView.mark_out(mtv, :sq, 1, 5)
    MultiTimeView.mark_in(mtv, :sq, 3, 7)

    :ok = ProgressMonitor.register_consumer(stack_id, :sq, "shape-a", self(), 0)
    :ok = ProgressMonitor.notify_processed_up_to(stack_id, 6, :sq, "shape-a")

    :ok = Compactor.compact_now(stack_id)

    # Value 1 was out for the entire retained window (>= 7) so its row is gone.
    assert MultiTimeView.values(mtv, :sq) |> Enum.sort() == [2, 3]
  end

  test "GCs positive-routing rows for values whose history compacts away", %{
    stack_id: stack_id,
    mtv: _mtv
  } do
    # Build a real SubqueryIndex (with its own MTV) so add_positive_route /
    # remove_positive_route can be exercised end-to-end. The compactor finds
    # the index via SubqueryIndex.for_stack/1.
    _index = SubqueryIndex.new(stack_id: stack_id)
    index = SubqueryIndex.for_stack(stack_id)
    mtv = index.multi_time_view

    MultiTimeView.init_subquery(mtv, :sq2, [10])
    MultiTimeView.mark_ready(mtv, :sq2)
    MultiTimeView.mark_out(mtv, :sq2, 10, 4)

    SubqueryIndex.add_positive_route(index, :sq2, 10)

    :ok = ProgressMonitor.register_consumer(stack_id, :sq2, "shape-b", self(), 0)
    :ok = ProgressMonitor.notify_processed_up_to(stack_id, 5, :sq2, "shape-b")

    :ok = Compactor.compact_now(stack_id)

    refute :ets.member(index.table, {:positive, :sq2, 10})
  end
end
