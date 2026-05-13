defmodule Electric.Shapes.Filter.Indexes.LogicalTimeSubqueryIndexTest do
  use ExUnit.Case, async: true

  alias Electric.Shapes.Filter.Indexes.LogicalTimeSubqueryIndex

  setup do
    index = LogicalTimeSubqueryIndex.new()
    LogicalTimeSubqueryIndex.new_cohort(index, :users_enabled, [1, 2, 3, 4])

    %{index: index}
  end

  test "reads one shared materialized view at separate logical times", %{index: index} do
    assert LogicalTimeSubqueryIndex.latest_time(index, :users_enabled) == 0

    assert LogicalTimeSubqueryIndex.values_at(index, :users_enabled, 0) ==
             MapSet.new([1, 2, 3, 4])

    time = LogicalTimeSubqueryIndex.advance(index, :users_enabled, [{5, true}])

    refute LogicalTimeSubqueryIndex.member?(index, :users_enabled, 0, 5)
    assert LogicalTimeSubqueryIndex.member?(index, :users_enabled, time, 5)

    assert LogicalTimeSubqueryIndex.values_at(index, :users_enabled, 0) ==
             MapSet.new([1, 2, 3, 4])

    assert LogicalTimeSubqueryIndex.values_at(index, :users_enabled, time) ==
             MapSet.new([1, 2, 3, 4, 5])
  end

  test "routes participants by their pinned logical time and polarity", %{index: index} do
    old_positive =
      LogicalTimeSubqueryIndex.add_participant(index, "shape-old-pos", :users_enabled, :positive,
        time: 0
      )

    old_negated =
      LogicalTimeSubqueryIndex.add_participant(index, "shape-old-neg", :users_enabled, :negated,
        time: 0
      )

    time = LogicalTimeSubqueryIndex.advance(index, :users_enabled, [{5, true}])

    new_positive =
      LogicalTimeSubqueryIndex.add_participant(index, "shape-new-pos", :users_enabled, :positive,
        time: time
      )

    new_negated =
      LogicalTimeSubqueryIndex.add_participant(index, "shape-new-neg", :users_enabled, :negated,
        time: time
      )

    assert LogicalTimeSubqueryIndex.route(index, :users_enabled, 5) ==
             MapSet.new([old_negated, new_positive])

    assert LogicalTimeSubqueryIndex.route(index, :users_enabled, 1) ==
             MapSet.new([old_positive, new_positive])

    refute MapSet.member?(LogicalTimeSubqueryIndex.route(index, :users_enabled, 1), new_negated)
  end

  test "moving a participant to a new logical time updates routing", %{index: index} do
    participant =
      LogicalTimeSubqueryIndex.add_participant(index, "shape-neg", :users_enabled, :negated,
        time: 0
      )

    time = LogicalTimeSubqueryIndex.advance(index, :users_enabled, [{5, true}])

    assert LogicalTimeSubqueryIndex.route(index, :users_enabled, 5) == MapSet.new([participant])

    assert :ok = LogicalTimeSubqueryIndex.set_participant_time(index, participant, time)
    assert LogicalTimeSubqueryIndex.route(index, :users_enabled, 5) == MapSet.new()
  end

  test "shape removal deletes participant metadata without deleting the shared view", %{
    index: index
  } do
    Enum.each(5..100, fn value ->
      LogicalTimeSubqueryIndex.advance(index, :users_enabled, [{value, true}])
    end)

    participant =
      LogicalTimeSubqueryIndex.add_participant(index, "shape-1", :users_enabled, :positive)

    before_remove = LogicalTimeSubqueryIndex.stats(index)

    assert LogicalTimeSubqueryIndex.participant_member?(index, participant, 42)
    assert :ok = LogicalTimeSubqueryIndex.remove_shape(index, "shape-1")

    after_remove = LogicalTimeSubqueryIndex.stats(index)

    assert after_remove.value_history == before_remove.value_history
    assert after_remove.participants == 0
    assert after_remove.participants_by_shape == 0
    assert after_remove.participants_by_time == 0
  end

  test "compaction keeps the history needed after the minimum pinned time", %{index: index} do
    time_1 = LogicalTimeSubqueryIndex.advance(index, :users_enabled, [{1, false}, {5, true}])
    time_2 = LogicalTimeSubqueryIndex.advance(index, :users_enabled, [{1, true}, {2, false}])

    assert LogicalTimeSubqueryIndex.values_at(index, :users_enabled, time_1) ==
             MapSet.new([2, 3, 4, 5])

    assert LogicalTimeSubqueryIndex.values_at(index, :users_enabled, time_2) ==
             MapSet.new([1, 3, 4, 5])

    assert :ok = LogicalTimeSubqueryIndex.compact(index, :users_enabled, time_1)

    assert LogicalTimeSubqueryIndex.values_at(index, :users_enabled, time_1) ==
             MapSet.new([2, 3, 4, 5])

    assert LogicalTimeSubqueryIndex.values_at(index, :users_enabled, time_2) ==
             MapSet.new([1, 3, 4, 5])
  end
end
