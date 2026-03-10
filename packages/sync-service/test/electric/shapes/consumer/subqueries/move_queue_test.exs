defmodule Electric.Shapes.Consumer.Subqueries.MoveQueueTest do
  use ExUnit.Case, async: true

  alias Electric.Shapes.Consumer.Subqueries.MoveQueue

  test "drops redundant move outs for values absent from the base view" do
    queue = MoveQueue.enqueue(MoveQueue.new(), %{move_out: [{1, "1"}]}, MapSet.new())

    assert %MoveQueue{move_out: [], move_in: []} = queue
  end

  test "drops redundant move ins for values already present in the base view" do
    queue = MoveQueue.enqueue(MoveQueue.new(), %{move_in: [{1, "1"}]}, MapSet.new([1]))

    assert %MoveQueue{move_out: [], move_in: []} = queue
  end

  test "cancels a pending move in with a later move out for the same value" do
    queue =
      MoveQueue.new()
      |> MoveQueue.enqueue(%{move_in: [{1, "1"}]}, MapSet.new())
      |> MoveQueue.enqueue(%{move_out: [{1, "1"}]}, MapSet.new())

    assert %MoveQueue{move_out: [], move_in: []} = queue
  end

  test "cancels a pending move out with a later move in for the same value" do
    queue =
      MoveQueue.new()
      |> MoveQueue.enqueue(%{move_out: [{1, "1"}]}, MapSet.new([1]))
      |> MoveQueue.enqueue(%{move_in: [{1, "1"}]}, MapSet.new([1]))

    assert %MoveQueue{move_out: [], move_in: []} = queue
  end

  test "merges repeated move ins and keeps the terminal tuple" do
    queue =
      MoveQueue.new()
      |> MoveQueue.enqueue(%{move_in: [{1, "01"}]}, MapSet.new())
      |> MoveQueue.enqueue(%{move_in: [{1, "1"}], move_out: []}, MapSet.new())

    assert %MoveQueue{move_out: [], move_in: [{1, "1"}]} = queue
  end

  test "merges repeated move outs and keeps the terminal tuple" do
    queue =
      MoveQueue.new()
      |> MoveQueue.enqueue(%{move_out: [{1, "01"}]}, MapSet.new([1]))
      |> MoveQueue.enqueue(%{move_out: [{1, "1"}], move_in: []}, MapSet.new([1]))

    assert %MoveQueue{move_out: [{1, "1"}], move_in: []} = queue
  end

  test "orders surviving move outs before move ins" do
    queue =
      MoveQueue.new()
      |> MoveQueue.enqueue(%{move_in: [{2, "2"}]}, MapSet.new([1]))
      |> MoveQueue.enqueue(%{move_out: [{1, "1"}]}, MapSet.new([1]))

    assert %MoveQueue{move_out: [{1, "1"}], move_in: [{2, "2"}]} = queue
  end

  test "uses the provided base view when reducing buffering follow-up moves" do
    queue =
      MoveQueue.new()
      |> MoveQueue.enqueue(%{move_in: [{2, "2"}]}, MapSet.new([1]))
      |> MoveQueue.enqueue(%{move_out: [{2, "2"}]}, MapSet.new([1]))

    assert %MoveQueue{move_out: [], move_in: []} = queue
  end

  test "pop_next returns the whole move out batch before the move in batch" do
    queue =
      MoveQueue.new()
      |> MoveQueue.enqueue(%{move_in: [{2, "2"}], move_out: [{1, "1"}]}, MapSet.new([1]))
      |> MoveQueue.enqueue(%{move_in: [{3, "3"}]}, MapSet.new([1]))

    assert {{:move_out, [{1, "1"}]}, queue} = MoveQueue.pop_next(queue)
    assert %MoveQueue{move_out: [], move_in: [{2, "2"}, {3, "3"}]} = queue

    assert {{:move_in, [{2, "2"}, {3, "3"}]}, queue} = MoveQueue.pop_next(queue)
    assert %MoveQueue{move_out: [], move_in: []} = queue
    assert nil == MoveQueue.pop_next(queue)
  end

  test "length counts queued values across both batches" do
    queue =
      MoveQueue.new()
      |> MoveQueue.enqueue(%{move_in: [{2, "2"}], move_out: [{1, "1"}]}, MapSet.new([1]))
      |> MoveQueue.enqueue(%{move_in: [{3, "3"}]}, MapSet.new([1]))

    assert 3 == MoveQueue.length(queue)
  end
end
