defmodule Electric.Test.UtilsTest do
  alias Electric.Utils
  use ExUnit.Case, async: true

  test "fetch_demand" do
    q = :queue.from_list([1, 2, 3, 4, 5])
    q_empty = :queue.new()

    {0, [1, 2, 3, 4, 5], ^q_empty} = Utils.fetch_demand_from_queue(5, q)

    {0, [1, 2, 3], q1} = Utils.fetch_demand_from_queue(3, q)

    assert {0, [4, 5], q_empty} == Utils.fetch_demand_from_queue(2, q1)
    assert {5, [], q_empty} == Utils.fetch_demand_from_queue(5, q_empty)
  end

  test "add_events" do
    q = :queue.from_list([1, 2, 3])
    q_empty = :queue.new()
    ev = [4, 5]

    assert {0, [1, 2, 3, 4, 5], q_empty} ==
             Utils.fetch_demand_from_queue(5, Utils.add_events_to_queue(ev, q))
  end
end
