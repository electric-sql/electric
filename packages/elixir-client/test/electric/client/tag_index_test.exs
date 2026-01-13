defmodule Electric.Client.TagIndexTest do
  use ExUnit.Case, async: true

  alias Electric.Client.TagIndex

  describe "new/0" do
    test "creates an empty tag index" do
      index = TagIndex.new()
      assert index.index == []
      assert index.tag_length == nil
    end
  end

  describe "parse_tag/1" do
    test "parses simple single-value tags" do
      assert TagIndex.parse_tag("abc123") == ["abc123"]
    end

    test "parses composite tags with pipe delimiter" do
      assert TagIndex.parse_tag("abc|def|ghi") == ["abc", "def", "ghi"]
    end

    test "parses two-part tags" do
      assert TagIndex.parse_tag("abc123|def456") == ["abc123", "def456"]
    end

    test "handles escaped pipe characters" do
      assert TagIndex.parse_tag("abc\\|def|ghi") == ["abc|def", "ghi"]
    end

    test "handles multiple escaped pipes" do
      assert TagIndex.parse_tag("a\\|b\\|c|d") == ["a|b|c", "d"]
    end

    test "handles empty string" do
      assert TagIndex.parse_tag("") == [""]
    end
  end

  describe "get_tag_length/1" do
    test "returns length of parsed tag" do
      assert TagIndex.get_tag_length(["abc"]) == 1
      assert TagIndex.get_tag_length(["abc", "def"]) == 2
      assert TagIndex.get_tag_length(["a", "b", "c"]) == 3
    end
  end

  describe "get_value/2" do
    test "returns value at position" do
      tag = ["abc", "def", "ghi"]
      assert TagIndex.get_value(tag, 0) == "abc"
      assert TagIndex.get_value(tag, 1) == "def"
      assert TagIndex.get_value(tag, 2) == "ghi"
    end

    test "raises for out of bounds position" do
      tag = ["abc", "def"]

      assert_raise ArgumentError, ~r/Position 2 out of bounds/, fn ->
        TagIndex.get_value(tag, 2)
      end
    end
  end

  describe "tag_matches_pattern?/2" do
    test "matches exact value at position" do
      tag = ["abc", "def"]
      assert TagIndex.tag_matches_pattern?(tag, %{pos: 0, value: "abc"})
      assert TagIndex.tag_matches_pattern?(tag, %{pos: 1, value: "def"})
    end

    test "does not match different value" do
      tag = ["abc", "def"]
      refute TagIndex.tag_matches_pattern?(tag, %{pos: 0, value: "xyz"})
      refute TagIndex.tag_matches_pattern?(tag, %{pos: 1, value: "abc"})
    end

    test "matches wildcard at position" do
      tag = ["_", "def"]
      assert TagIndex.tag_matches_pattern?(tag, %{pos: 0, value: "anything"})
      assert TagIndex.tag_matches_pattern?(tag, %{pos: 1, value: "def"})
    end

    test "returns false for out of bounds position" do
      tag = ["abc"]
      refute TagIndex.tag_matches_pattern?(tag, %{pos: 1, value: "def"})
    end
  end

  describe "add_tag/3" do
    test "adds single tag to empty index" do
      index =
        TagIndex.new()
        |> TagIndex.add_tag("row1", "abc123")

      assert index.tag_length == 1

      assert TagIndex.find_rows_matching_pattern(index, %{pos: 0, value: "abc123"}) ==
               MapSet.new(["row1"])
    end

    test "adds composite tag to index" do
      index =
        TagIndex.new()
        |> TagIndex.add_tag("row1", "abc|def")

      assert index.tag_length == 2

      assert TagIndex.find_rows_matching_pattern(index, %{pos: 0, value: "abc"}) ==
               MapSet.new(["row1"])

      assert TagIndex.find_rows_matching_pattern(index, %{pos: 1, value: "def"}) ==
               MapSet.new(["row1"])
    end

    test "adds multiple rows with same tag value at position" do
      index =
        TagIndex.new()
        |> TagIndex.add_tag("row1", "abc|def")
        |> TagIndex.add_tag("row2", "abc|ghi")

      assert TagIndex.find_rows_matching_pattern(index, %{pos: 0, value: "abc"}) ==
               MapSet.new(["row1", "row2"])

      assert TagIndex.find_rows_matching_pattern(index, %{pos: 1, value: "def"}) ==
               MapSet.new(["row1"])

      assert TagIndex.find_rows_matching_pattern(index, %{pos: 1, value: "ghi"}) ==
               MapSet.new(["row2"])
    end

    test "infers tag length from first tag" do
      index =
        TagIndex.new()
        |> TagIndex.add_tag("row1", "abc|def")

      assert index.tag_length == 2
    end

    test "rejects tags with wrong length" do
      index =
        TagIndex.new()
        |> TagIndex.add_tag("row1", "abc|def")
        # Wrong length, should be ignored
        |> TagIndex.add_tag("row2", "xyz")

      # row2 should not be indexed
      assert TagIndex.find_rows_matching_pattern(index, %{pos: 0, value: "xyz"}) ==
               MapSet.new([])
    end

    test "does not index wildcard values" do
      index =
        TagIndex.new()
        |> TagIndex.add_tag("row1", "_|def")

      # Wildcard position should not return rows
      assert TagIndex.find_rows_matching_pattern(index, %{pos: 0, value: "_"}) ==
               MapSet.new([])

      # But non-wildcard position should work
      assert TagIndex.find_rows_matching_pattern(index, %{pos: 1, value: "def"}) ==
               MapSet.new(["row1"])
    end
  end

  describe "remove_tag/3" do
    test "removes tag from index" do
      index =
        TagIndex.new()
        |> TagIndex.add_tag("row1", "abc|def")
        |> TagIndex.remove_tag("row1", "abc|def")

      assert TagIndex.find_rows_matching_pattern(index, %{pos: 0, value: "abc"}) ==
               MapSet.new([])
    end

    test "only removes specified row from index" do
      index =
        TagIndex.new()
        |> TagIndex.add_tag("row1", "abc|def")
        |> TagIndex.add_tag("row2", "abc|ghi")
        |> TagIndex.remove_tag("row1", "abc|def")

      assert TagIndex.find_rows_matching_pattern(index, %{pos: 0, value: "abc"}) ==
               MapSet.new(["row2"])
    end

    test "handles removing non-existent tag" do
      index =
        TagIndex.new()
        |> TagIndex.add_tag("row1", "abc|def")
        # Non-existent
        |> TagIndex.remove_tag("row1", "xyz|123")

      # Original should still be there
      assert TagIndex.find_rows_matching_pattern(index, %{pos: 0, value: "abc"}) ==
               MapSet.new(["row1"])
    end

    test "handles removing from empty index" do
      index =
        TagIndex.new()
        |> TagIndex.remove_tag("row1", "abc")

      assert TagIndex.empty?(index)
    end
  end

  describe "find_rows_matching_pattern/2" do
    test "returns empty set for empty index" do
      index = TagIndex.new()

      assert TagIndex.find_rows_matching_pattern(index, %{pos: 0, value: "abc"}) ==
               MapSet.new([])
    end

    test "returns empty set for non-matching pattern" do
      index =
        TagIndex.new()
        |> TagIndex.add_tag("row1", "abc|def")

      assert TagIndex.find_rows_matching_pattern(index, %{pos: 0, value: "xyz"}) ==
               MapSet.new([])
    end

    test "returns all rows matching pattern" do
      index =
        TagIndex.new()
        |> TagIndex.add_tag("row1", "abc|def")
        |> TagIndex.add_tag("row2", "abc|ghi")
        |> TagIndex.add_tag("row3", "xyz|def")

      assert TagIndex.find_rows_matching_pattern(index, %{pos: 0, value: "abc"}) ==
               MapSet.new(["row1", "row2"])

      assert TagIndex.find_rows_matching_pattern(index, %{pos: 1, value: "def"}) ==
               MapSet.new(["row1", "row3"])
    end
  end

  describe "clear/1" do
    test "clears all entries" do
      index =
        TagIndex.new()
        |> TagIndex.add_tag("row1", "abc|def")
        |> TagIndex.add_tag("row2", "xyz|123")
        |> TagIndex.clear()

      assert TagIndex.empty?(index)
    end
  end

  describe "empty?/1" do
    test "returns true for new index" do
      assert TagIndex.empty?(TagIndex.new())
    end

    test "returns false after adding tag" do
      index = TagIndex.add_tag(TagIndex.new(), "row1", "abc")
      refute TagIndex.empty?(index)
    end
  end
end
