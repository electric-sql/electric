defmodule Electric.Shapes.Consumer.Subqueries.MoveQueueTest do
  use ExUnit.Case, async: true

  alias Electric.Shapes.Consumer.Subqueries.MoveQueue

  @dep 0

  test "drops redundant move outs for values absent from the base view" do
    queue = MoveQueue.enqueue(MoveQueue.new(), @dep, %{move_out: [{1, "1"}]}, MapSet.new())

    assert %MoveQueue{move_out: empty_out, move_in: empty_in} = queue
    assert empty_out == %{}
    assert empty_in == %{}
  end

  test "drops redundant move ins for values already present in the base view" do
    queue = MoveQueue.enqueue(MoveQueue.new(), @dep, %{move_in: [{1, "1"}]}, MapSet.new([1]))

    assert %MoveQueue{move_out: empty_out, move_in: empty_in} = queue
    assert empty_out == %{}
    assert empty_in == %{}
  end

  test "cancels a pending move in with a later move out for the same value" do
    queue =
      MoveQueue.new()
      |> MoveQueue.enqueue(@dep, %{move_in: [{1, "1"}]}, MapSet.new())
      |> MoveQueue.enqueue(@dep, %{move_out: [{1, "1"}]}, MapSet.new())

    assert %MoveQueue{move_out: empty_out, move_in: empty_in} = queue
    assert empty_out == %{}
    assert empty_in == %{}
  end

  test "cancels a pending move out with a later move in for the same value" do
    queue =
      MoveQueue.new()
      |> MoveQueue.enqueue(@dep, %{move_out: [{1, "1"}]}, MapSet.new([1]))
      |> MoveQueue.enqueue(@dep, %{move_in: [{1, "1"}]}, MapSet.new([1]))

    assert %MoveQueue{move_out: empty_out, move_in: empty_in} = queue
    assert empty_out == %{}
    assert empty_in == %{}
  end

  test "merges repeated move ins and keeps the terminal tuple" do
    queue =
      MoveQueue.new()
      |> MoveQueue.enqueue(@dep, %{move_in: [{1, "01"}]}, MapSet.new())
      |> MoveQueue.enqueue(@dep, %{move_in: [{1, "1"}], move_out: []}, MapSet.new())

    assert %MoveQueue{move_in: %{0 => [{1, "1"}]}, move_out: empty_out} = queue
    assert empty_out == %{}
  end

  test "merges repeated move outs and keeps the terminal tuple" do
    queue =
      MoveQueue.new()
      |> MoveQueue.enqueue(@dep, %{move_out: [{1, "01"}]}, MapSet.new([1]))
      |> MoveQueue.enqueue(@dep, %{move_out: [{1, "1"}], move_in: []}, MapSet.new([1]))

    assert %MoveQueue{move_out: %{0 => [{1, "1"}]}, move_in: empty_in} = queue
    assert empty_in == %{}
  end

  test "orders surviving move outs before move ins" do
    queue =
      MoveQueue.new()
      |> MoveQueue.enqueue(@dep, %{move_in: [{2, "2"}]}, MapSet.new([1]))
      |> MoveQueue.enqueue(@dep, %{move_out: [{1, "1"}]}, MapSet.new([1]))

    assert %MoveQueue{move_out: %{0 => [{1, "1"}]}, move_in: %{0 => [{2, "2"}]}} = queue
  end

  test "uses the provided base view when reducing buffering follow-up moves" do
    queue =
      MoveQueue.new()
      |> MoveQueue.enqueue(@dep, %{move_in: [{2, "2"}]}, MapSet.new([1]))
      |> MoveQueue.enqueue(@dep, %{move_out: [{2, "2"}]}, MapSet.new([1]))

    assert %MoveQueue{move_out: empty_out, move_in: empty_in} = queue
    assert empty_out == %{}
    assert empty_in == %{}
  end

  test "pop_next returns the whole move out batch before the move in batch" do
    queue =
      MoveQueue.new()
      |> MoveQueue.enqueue(@dep, %{move_in: [{2, "2"}], move_out: [{1, "1"}]}, MapSet.new([1]))
      |> MoveQueue.enqueue(@dep, %{move_in: [{3, "3"}]}, MapSet.new([1]))

    assert {{:move_out, 0, [{1, "1"}]}, queue} = MoveQueue.pop_next(queue)
    assert queue.move_out == %{}
    assert queue.move_in == %{0 => [{2, "2"}, {3, "3"}]}

    assert {{:move_in, 0, [{2, "2"}, {3, "3"}]}, queue} = MoveQueue.pop_next(queue)
    assert queue.move_out == %{}
    assert queue.move_in == %{}
    assert nil == MoveQueue.pop_next(queue)
  end

  test "length counts queued values across both batches" do
    queue =
      MoveQueue.new()
      |> MoveQueue.enqueue(@dep, %{move_in: [{2, "2"}], move_out: [{1, "1"}]}, MapSet.new([1]))
      |> MoveQueue.enqueue(@dep, %{move_in: [{3, "3"}]}, MapSet.new([1]))

    assert 3 == MoveQueue.length(queue)
  end
end
