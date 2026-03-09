defmodule Electric.Shapes.Consumer.Subqueries.MaterializedViewTest do
  use ExUnit.Case, async: true

  alias Electric.Replication.Changes
  alias Electric.Shapes.Consumer.Subqueries.MaterializedView

  test "insert of a new value emits a move in" do
    state = new_view()

    {event, state} =
      MaterializedView.handle_changes(state, [
        %Changes.NewRecord{key: "1", record: %{"value" => "10"}}
      ])

    assert event == {:materializer_changes, "dep-handle", %{move_in: [{10, "10"}]}}
    assert MaterializedView.values(state) == MapSet.new([10])
  end

  test "duplicate value insert does not emit a second move in" do
    state = new_view()

    {_, state} =
      MaterializedView.handle_changes(state, [
        %Changes.NewRecord{key: "1", record: %{"value" => "10"}}
      ])

    {event, state} =
      MaterializedView.handle_changes(state, [
        %Changes.NewRecord{key: "2", record: %{"value" => "10"}}
      ])

    assert event == nil
    assert MaterializedView.values(state) == MapSet.new([10])
  end

  test "update to a new unique value emits move out and move in" do
    state = new_view()

    {_, state} =
      MaterializedView.handle_changes(state, [
        %Changes.NewRecord{key: "1", record: %{"value" => "10"}}
      ])

    {event, state} =
      MaterializedView.handle_changes(state, [
        %Changes.UpdatedRecord{
          key: "1",
          old_record: %{"value" => "10"},
          record: %{"value" => "11"}
        }
      ])

    assert event ==
             {:materializer_changes, "dep-handle",
              %{move_in: [{11, "11"}], move_out: [{10, "10"}]}}

    assert MaterializedView.values(state) == MapSet.new([11])
  end

  test "same batch move in and move out for the same value cancels out" do
    state = new_view()

    {event, state} =
      MaterializedView.handle_changes(state, [
        %Changes.NewRecord{key: "1", record: %{"value" => "10"}},
        %Changes.DeletedRecord{key: "1", old_record: %{"value" => "10"}}
      ])

    assert event == nil
    assert MaterializedView.values(state) == MapSet.new()
  end

  test "composite values are materialized as tuples" do
    state =
      MaterializedView.new(
        dependency_handle: "dep-handle",
        columns: ["id1", "id2"],
        materialized_type: {:array, {:row, [:int4, :text]}}
      )

    {event, state} =
      MaterializedView.handle_changes(state, [
        %Changes.NewRecord{key: "1", record: %{"id1" => "10", "id2" => "a"}}
      ])

    assert event == {:materializer_changes, "dep-handle", %{move_in: [{{10, "a"}, {"10", "a"}}]}}
    assert MaterializedView.values(state) == MapSet.new([{10, "a"}])
  end

  defp new_view do
    MaterializedView.new(
      dependency_handle: "dep-handle",
      columns: ["value"],
      materialized_type: {:array, :int8}
    )
  end
end
