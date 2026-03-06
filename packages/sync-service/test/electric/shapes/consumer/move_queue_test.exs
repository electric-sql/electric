defmodule Electric.Shapes.Consumer.MoveQueueTest do
  use ExUnit.Case, async: true

  alias Electric.Shapes.Consumer.MoveQueue
  alias Electric.Shapes.Consumer.MoveIns
  alias Electric.Shapes.Consumer.State
  alias Electric.Shapes.Consumer.SubqueryRuntime

  describe "MoveQueue ordering" do
    test "prioritizes move_out over move_in while preserving FIFO within each type" do
      queue =
        MoveQueue.new()
        |> MoveQueue.enqueue_move_ins("dep-a", [:in_1, :in_2])
        |> MoveQueue.enqueue_move_outs("dep-a", [:out_1, :out_2])
        |> MoveQueue.enqueue_move_ins("dep-a", [:in_3])

      {{:move_out, "dep-a", :out_1}, queue} = MoveQueue.pop_next(queue)
      {{:move_out, "dep-a", :out_2}, queue} = MoveQueue.pop_next(queue)
      {{:move_in, "dep-a", :in_1}, queue} = MoveQueue.pop_next(queue)
      {{:move_in, "dep-a", :in_2}, queue} = MoveQueue.pop_next(queue)
      {{:move_in, "dep-a", :in_3}, queue} = MoveQueue.pop_next(queue)
      {:empty, _queue} = MoveQueue.pop_next(queue)
    end
  end

  describe "SubqueryRuntime queueing" do
    test "enqueues one operation per changed value (no batching)" do
      state = %State{subquery_runtime: SubqueryRuntime.new()}

      state =
        SubqueryRuntime.queue_dependency_changes(
          state,
          "dep-a",
          %{move_out: [{1, "1"}, {2, "2"}], move_in: [{3, "3"}, {4, "4"}]}
        )

      queue = state.subquery_runtime.queue

      {{:move_out, "dep-a", {1, "1"}}, queue} = MoveQueue.pop_next(queue)
      {{:move_out, "dep-a", {2, "2"}}, queue} = MoveQueue.pop_next(queue)
      {{:move_in, "dep-a", {3, "3"}}, queue} = MoveQueue.pop_next(queue)
      {{:move_in, "dep-a", {4, "4"}}, queue} = MoveQueue.pop_next(queue)
      {:empty, _} = MoveQueue.pop_next(queue)
    end

    test "does not process queued operations while move-in is waiting" do
      move_handling_state =
        MoveIns.new()
        |> MoveIns.add_waiting("move-1", {["$sublink", "0"], MapSet.new([1])})

      state = %State{
        move_handling_state: move_handling_state,
        subquery_runtime: %SubqueryRuntime{
          queue: MoveQueue.enqueue_move_outs(MoveQueue.new(), "dep-a", [{1, "1"}]),
          phase: :waiting_move_in
        }
      }

      {state, notifications} = SubqueryRuntime.process_queue(state)

      assert notifications == []

      assert {:move_out, "dep-a", {1, "1"}} =
               elem(MoveQueue.pop_next(state.subquery_runtime.queue), 0)
    end
  end
end
