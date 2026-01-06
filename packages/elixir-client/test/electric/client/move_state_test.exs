defmodule Electric.Client.MoveStateTest do
  use ExUnit.Case, async: true

  alias Electric.Client.MoveState

  describe "new/0" do
    test "creates empty move state" do
      state = MoveState.new()
      assert state.row_tags == %{}
      refute MoveState.has_tags?(state)
    end
  end

  describe "add_tags_to_row/3" do
    test "adds tags to new row" do
      state =
        MoveState.new()
        |> MoveState.add_tags_to_row("row1", ["abc123", "def456"])

      assert MoveState.row_has_tags?(state, "row1")
      assert MoveState.get_row_tags(state, "row1") == MapSet.new(["abc123", "def456"])
    end

    test "adds tags to existing row" do
      state =
        MoveState.new()
        |> MoveState.add_tags_to_row("row1", ["abc123"])
        |> MoveState.add_tags_to_row("row1", ["def456"])

      assert MoveState.get_row_tags(state, "row1") == MapSet.new(["abc123", "def456"])
    end

    test "does not duplicate tags" do
      state =
        MoveState.new()
        |> MoveState.add_tags_to_row("row1", ["abc123"])
        |> MoveState.add_tags_to_row("row1", ["abc123"])

      assert MoveState.get_row_tags(state, "row1") == MapSet.new(["abc123"])
    end

    test "handles empty tag list" do
      state =
        MoveState.new()
        |> MoveState.add_tags_to_row("row1", [])

      refute MoveState.row_has_tags?(state, "row1")
    end

    test "sets has_tags? flag" do
      state =
        MoveState.new()
        |> MoveState.add_tags_to_row("row1", ["abc123"])

      assert MoveState.has_tags?(state)
    end
  end

  describe "remove_tags_from_row/3" do
    test "removes specific tags from row" do
      state =
        MoveState.new()
        |> MoveState.add_tags_to_row("row1", ["abc123", "def456"])
        |> MoveState.remove_tags_from_row("row1", ["abc123"])

      assert MoveState.get_row_tags(state, "row1") == MapSet.new(["def456"])
    end

    test "removes row from tracking when all tags removed" do
      state =
        MoveState.new()
        |> MoveState.add_tags_to_row("row1", ["abc123"])
        |> MoveState.remove_tags_from_row("row1", ["abc123"])

      refute MoveState.row_has_tags?(state, "row1")
      assert MoveState.get_row_tags(state, "row1") == MapSet.new([])
    end

    test "handles removing non-existent tags" do
      state =
        MoveState.new()
        |> MoveState.add_tags_to_row("row1", ["abc123"])
        |> MoveState.remove_tags_from_row("row1", ["xyz789"])

      assert MoveState.get_row_tags(state, "row1") == MapSet.new(["abc123"])
    end

    test "handles removing from non-existent row" do
      state =
        MoveState.new()
        |> MoveState.remove_tags_from_row("row1", ["abc123"])

      refute MoveState.row_has_tags?(state, "row1")
    end

    test "handles empty tag list" do
      state =
        MoveState.new()
        |> MoveState.add_tags_to_row("row1", ["abc123"])
        |> MoveState.remove_tags_from_row("row1", [])

      assert MoveState.get_row_tags(state, "row1") == MapSet.new(["abc123"])
    end
  end

  describe "clear_row/2" do
    test "removes all tags for row" do
      state =
        MoveState.new()
        |> MoveState.add_tags_to_row("row1", ["abc123", "def456"])
        |> MoveState.clear_row("row1")

      refute MoveState.row_has_tags?(state, "row1")
    end

    test "cleans up tag index" do
      state =
        MoveState.new()
        |> MoveState.add_tags_to_row("row1", ["abc"])
        |> MoveState.add_tags_to_row("row2", ["abc"])
        |> MoveState.clear_row("row1")

      # row2 should still be findable via pattern
      {rows, _} = MoveState.process_move_out_pattern(state, %{pos: 0, value: "abc"})
      assert rows == ["row2"]
    end

    test "handles clearing non-existent row" do
      state =
        MoveState.new()
        |> MoveState.clear_row("row1")

      refute MoveState.row_has_tags?(state, "row1")
    end
  end

  describe "process_move_out_pattern/2" do
    test "returns rows to delete when tag set becomes empty" do
      state =
        MoveState.new()
        |> MoveState.add_tags_to_row("row1", ["abc123"])

      {rows_to_delete, state} = MoveState.process_move_out_pattern(state, %{pos: 0, value: "abc123"})

      assert rows_to_delete == ["row1"]
      refute MoveState.row_has_tags?(state, "row1")
    end

    test "does not delete rows with remaining tags" do
      state =
        MoveState.new()
        |> MoveState.add_tags_to_row("row1", ["abc123", "def456"])

      {rows_to_delete, state} = MoveState.process_move_out_pattern(state, %{pos: 0, value: "abc123"})

      assert rows_to_delete == []
      assert MoveState.get_row_tags(state, "row1") == MapSet.new(["def456"])
    end

    test "handles pattern matching multiple rows" do
      state =
        MoveState.new()
        |> MoveState.add_tags_to_row("row1", ["abc"])
        |> MoveState.add_tags_to_row("row2", ["abc"])
        |> MoveState.add_tags_to_row("row3", ["xyz"])

      {rows_to_delete, state} = MoveState.process_move_out_pattern(state, %{pos: 0, value: "abc"})

      assert Enum.sort(rows_to_delete) == ["row1", "row2"]
      refute MoveState.row_has_tags?(state, "row1")
      refute MoveState.row_has_tags?(state, "row2")
      assert MoveState.row_has_tags?(state, "row3")
    end

    test "handles composite tags" do
      state =
        MoveState.new()
        |> MoveState.add_tags_to_row("row1", ["abc|def"])
        |> MoveState.add_tags_to_row("row2", ["abc|ghi"])

      {rows_to_delete, _state} = MoveState.process_move_out_pattern(state, %{pos: 1, value: "def"})

      assert rows_to_delete == ["row1"]
    end

    test "handles no matching pattern" do
      state =
        MoveState.new()
        |> MoveState.add_tags_to_row("row1", ["abc123"])

      {rows_to_delete, state} = MoveState.process_move_out_pattern(state, %{pos: 0, value: "xyz789"})

      assert rows_to_delete == []
      assert MoveState.row_has_tags?(state, "row1")
    end

    test "handles empty state" do
      state = MoveState.new()

      {rows_to_delete, _state} = MoveState.process_move_out_pattern(state, %{pos: 0, value: "abc"})

      assert rows_to_delete == []
    end

    test "matches wildcard tags" do
      state =
        MoveState.new()
        |> MoveState.add_tags_to_row("row1", ["_|def"])

      # Wildcard at pos 0 should match any value
      {rows_to_delete, _state} = MoveState.process_move_out_pattern(state, %{pos: 0, value: "anything"})

      assert rows_to_delete == ["row1"]
    end
  end

  describe "row_has_tags?/2" do
    test "returns false for unknown row" do
      state = MoveState.new()
      refute MoveState.row_has_tags?(state, "row1")
    end

    test "returns true for row with tags" do
      state =
        MoveState.new()
        |> MoveState.add_tags_to_row("row1", ["abc123"])

      assert MoveState.row_has_tags?(state, "row1")
    end

    test "returns false after all tags removed" do
      state =
        MoveState.new()
        |> MoveState.add_tags_to_row("row1", ["abc123"])
        |> MoveState.remove_tags_from_row("row1", ["abc123"])

      refute MoveState.row_has_tags?(state, "row1")
    end
  end

  describe "get_row_tags/2" do
    test "returns empty set for unknown row" do
      state = MoveState.new()
      assert MoveState.get_row_tags(state, "row1") == MapSet.new([])
    end

    test "returns all tags for row" do
      state =
        MoveState.new()
        |> MoveState.add_tags_to_row("row1", ["abc", "def", "ghi"])

      assert MoveState.get_row_tags(state, "row1") == MapSet.new(["abc", "def", "ghi"])
    end
  end

  describe "reset/1" do
    test "clears all state" do
      state =
        MoveState.new()
        |> MoveState.add_tags_to_row("row1", ["abc123"])
        |> MoveState.add_tags_to_row("row2", ["def456"])
        |> MoveState.reset()

      refute MoveState.has_tags?(state)
      refute MoveState.row_has_tags?(state, "row1")
      refute MoveState.row_has_tags?(state, "row2")
    end
  end

  describe "has_tags?/1" do
    test "returns false for new state" do
      refute MoveState.has_tags?(MoveState.new())
    end

    test "returns true after adding tags" do
      state =
        MoveState.new()
        |> MoveState.add_tags_to_row("row1", ["abc"])

      assert MoveState.has_tags?(state)
    end
  end

  describe "integration scenarios" do
    test "simulates typical move-in/move-out flow" do
      # Initial sync with tagged rows
      state =
        MoveState.new()
        |> MoveState.add_tags_to_row("child/1", ["parent_abc"])
        |> MoveState.add_tags_to_row("child/2", ["parent_abc"])
        |> MoveState.add_tags_to_row("child/3", ["parent_xyz"])

      # Parent ABC is deleted - move-out event
      {rows_to_delete, state} =
        MoveState.process_move_out_pattern(state, %{pos: 0, value: "parent_abc"})

      assert Enum.sort(rows_to_delete) == ["child/1", "child/2"]
      assert MoveState.row_has_tags?(state, "child/3")
    end

    test "handles row with multiple tags from different parents" do
      # Child belongs to multiple parents via subquery
      state =
        MoveState.new()
        |> MoveState.add_tags_to_row("child/1", ["parent_a", "parent_b"])

      # Remove first parent
      {rows_to_delete, state} =
        MoveState.process_move_out_pattern(state, %{pos: 0, value: "parent_a"})

      assert rows_to_delete == []
      assert MoveState.get_row_tags(state, "child/1") == MapSet.new(["parent_b"])

      # Remove second parent
      {rows_to_delete, _state} =
        MoveState.process_move_out_pattern(state, %{pos: 0, value: "parent_b"})

      assert rows_to_delete == ["child/1"]
    end

    test "handles update that changes tag" do
      state =
        MoveState.new()
        |> MoveState.add_tags_to_row("row1", ["old_tag"])

      # Simulate update: remove old tag, add new tag
      state =
        state
        |> MoveState.remove_tags_from_row("row1", ["old_tag"])
        |> MoveState.add_tags_to_row("row1", ["new_tag"])

      assert MoveState.get_row_tags(state, "row1") == MapSet.new(["new_tag"])

      # Old tag pattern should not match
      {rows, _} = MoveState.process_move_out_pattern(state, %{pos: 0, value: "old_tag"})
      assert rows == []

      # New tag pattern should match
      {rows, _} = MoveState.process_move_out_pattern(state, %{pos: 0, value: "new_tag"})
      assert rows == ["row1"]
    end
  end
end
