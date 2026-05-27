defmodule Electric.Shapes.Consumer.Subqueries.MoveQueueTest do
  use ExUnit.Case, async: true

  alias Electric.Shapes.Consumer.Subqueries.MoveQueue

  @dep 0

  defp view(values), do: fn value -> value in values end

  test "drops redundant move outs for values absent from the base view" do
    queue = MoveQueue.enqueue(MoveQueue.new(), @dep, %{move_out: [{1, "1"}]}, view([]))

    assert nil == MoveQueue.pop_next(queue)
  end

  test "drops redundant move ins for values already present in the base view" do
    queue = MoveQueue.enqueue(MoveQueue.new(), @dep, %{move_in: [{1, "1"}]}, view([1]))

    assert nil == MoveQueue.pop_next(queue)
  end

  test "cancels a pending move in with a later move out for the same value" do
    queue =
      MoveQueue.new()
      |> MoveQueue.enqueue(@dep, %{move_in: [{1, "1"}]}, view([]))
      |> MoveQueue.enqueue(@dep, %{move_out: [{1, "1"}]}, view([]))

    assert nil == MoveQueue.pop_next(queue)
  end

  test "cancels a pending move out with a later move in for the same value" do
    queue =
      MoveQueue.new()
      |> MoveQueue.enqueue(@dep, %{move_out: [{1, "1"}]}, view([1]))
      |> MoveQueue.enqueue(@dep, %{move_in: [{1, "1"}]}, view([1]))

    assert nil == MoveQueue.pop_next(queue)
  end

  test "merges repeated move ins and keeps the terminal tuple" do
    queue =
      MoveQueue.new()
      |> MoveQueue.enqueue(@dep, %{move_in: [{1, "01"}]}, view([]))
      |> MoveQueue.enqueue(@dep, %{move_in: [{1, "1"}], move_out: []}, view([]))

    assert {%{move_in_values: [{1, "1"}], move_out_values: []}, _queue} = MoveQueue.pop_next(queue)
  end

  test "merges repeated move outs and keeps the terminal tuple" do
    queue =
      MoveQueue.new()
      |> MoveQueue.enqueue(@dep, %{move_out: [{1, "01"}]}, view([1]))
      |> MoveQueue.enqueue(@dep, %{move_out: [{1, "1"}], move_in: []}, view([1]))

    assert {%{move_in_values: [], move_out_values: [{1, "1"}]}, _queue} = MoveQueue.pop_next(queue)
  end

  test "pop_next returns one combined batch per dep carrying both kinds" do
    queue =
      MoveQueue.new()
      |> MoveQueue.enqueue(@dep, %{move_in: [{2, "2"}], move_out: [{1, "1"}]}, view([1]))
      |> MoveQueue.enqueue(@dep, %{move_in: [{3, "3"}]}, view([1]))

    assert {
             %{
               dep_index: 0,
               move_in_values: [{2, "2"}, {3, "3"}],
               move_out_values: [{1, "1"}]
             },
             queue
           } = MoveQueue.pop_next(queue)

    assert nil == MoveQueue.pop_next(queue)
  end

  test "carries the first from_time and the max to_time per dep" do
    queue =
      MoveQueue.new()
      |> MoveQueue.enqueue(
        @dep,
        %{move_in: [{1, "1"}], from_time: 5, to_time: 6},
        view([])
      )
      |> MoveQueue.enqueue(
        @dep,
        %{move_in: [{2, "2"}], from_time: 6, to_time: 9},
        view([])
      )

    assert {%{from_time: 5, to_time: 9}, _queue} = MoveQueue.pop_next(queue)
  end

  test "accumulates txids from successive enqueues per dependency" do
    queue =
      MoveQueue.new()
      |> MoveQueue.enqueue(@dep, %{move_in: [{1, "1"}], txids: [10]}, view([]))
      |> MoveQueue.enqueue(@dep, %{move_in: [{2, "2"}], txids: [20]}, view([]))

    assert {%{move_in_values: _, txids: [10, 20]}, _queue} = MoveQueue.pop_next(queue)
  end

  test "pops the lowest-indexed dep first across deps" do
    queue =
      MoveQueue.new()
      |> MoveQueue.enqueue(1, %{move_in: [{2, "2"}]}, view([]))
      |> MoveQueue.enqueue(0, %{move_in: [{1, "1"}]}, view([]))

    assert {%{dep_index: 0}, queue} = MoveQueue.pop_next(queue)
    assert {%{dep_index: 1}, _queue} = MoveQueue.pop_next(queue)
  end

  test "length counts queued values across both batches" do
    queue =
      MoveQueue.new()
      |> MoveQueue.enqueue(@dep, %{move_in: [{2, "2"}], move_out: [{1, "1"}]}, view([1]))
      |> MoveQueue.enqueue(@dep, %{move_in: [{3, "3"}]}, view([1]))

    assert 3 == MoveQueue.length(queue)
  end
end
