defmodule Electric.Client.TagTrackerTest do
  use ExUnit.Case, async: true

  alias Electric.Client.TagTracker
  alias Electric.Client.Message.ChangeMessage
  alias Electric.Client.Message.Headers

  defp make_change_msg(key, operation, opts) do
    tags = Keyword.get(opts, :tags, [])
    removed_tags = Keyword.get(opts, :removed_tags, [])
    active_conditions = Keyword.get(opts, :active_conditions, [])
    value = Keyword.get(opts, :value, %{"id" => key})

    %ChangeMessage{
      key: key,
      value: value,
      old_value: nil,
      headers: %Headers{
        operation: operation,
        relation: ["public", "test"],
        handle: "test-handle",
        tags: tags,
        removed_tags: removed_tags,
        active_conditions: active_conditions
      },
      request_timestamp: DateTime.utc_now()
    }
  end

  describe "update_tag_index/3" do
    test "tracks new tags for inserts" do
      msg = make_change_msg("key1", :insert, tags: ["tag_a", "tag_b"])

      {tag_to_keys, key_data} = TagTracker.update_tag_index(%{}, %{}, msg)

      assert tag_to_keys == %{
               {0, "tag_a"} => MapSet.new(["key1"]),
               {0, "tag_b"} => MapSet.new(["key1"])
             }

      assert Map.has_key?(key_data, "key1")
      assert key_data["key1"].tags == MapSet.new([{0, "tag_a"}, {0, "tag_b"}])
    end

    test "updates tags for updates" do
      # Initial insert with tag_a
      msg1 = make_change_msg("key1", :insert, tags: ["tag_a"])
      {tag_to_keys, key_data} = TagTracker.update_tag_index(%{}, %{}, msg1)

      # Update adds tag_b
      msg2 = make_change_msg("key1", :update, tags: ["tag_b"])
      {tag_to_keys, key_data} = TagTracker.update_tag_index(tag_to_keys, key_data, msg2)

      assert tag_to_keys == %{
               {0, "tag_a"} => MapSet.new(["key1"]),
               {0, "tag_b"} => MapSet.new(["key1"])
             }

      assert key_data["key1"].tags == MapSet.new([{0, "tag_a"}, {0, "tag_b"}])
    end

    test "removes tags when removed_tags specified" do
      # Initial insert with tag_a and tag_b
      msg1 = make_change_msg("key1", :insert, tags: ["tag_a", "tag_b"])
      {tag_to_keys, key_data} = TagTracker.update_tag_index(%{}, %{}, msg1)

      # Update removes tag_a
      msg2 = make_change_msg("key1", :update, removed_tags: ["tag_a"])
      {tag_to_keys, key_data} = TagTracker.update_tag_index(tag_to_keys, key_data, msg2)

      assert tag_to_keys == %{
               {0, "tag_b"} => MapSet.new(["key1"])
             }

      assert key_data["key1"].tags == MapSet.new([{0, "tag_b"}])
    end

    test "removes key from tracking on delete" do
      msg1 = make_change_msg("key1", :insert, tags: ["tag_a"])
      {tag_to_keys, key_data} = TagTracker.update_tag_index(%{}, %{}, msg1)

      msg2 = make_change_msg("key1", :delete, tags: [])
      {tag_to_keys, key_data} = TagTracker.update_tag_index(tag_to_keys, key_data, msg2)

      assert tag_to_keys == %{}
      assert key_data == %{}
    end

    test "handles messages without tags" do
      msg = make_change_msg("key1", :insert, tags: [])
      {tag_to_keys, key_data} = TagTracker.update_tag_index(%{}, %{}, msg)

      assert tag_to_keys == %{}
      assert key_data == %{}
    end

    test "multiple keys with same tag" do
      msg1 = make_change_msg("key1", :insert, tags: ["shared_tag"])
      msg2 = make_change_msg("key2", :insert, tags: ["shared_tag"])

      {tag_to_keys, key_data} = TagTracker.update_tag_index(%{}, %{}, msg1)
      {tag_to_keys, key_data} = TagTracker.update_tag_index(tag_to_keys, key_data, msg2)

      assert tag_to_keys == %{
               {0, "shared_tag"} => MapSet.new(["key1", "key2"])
             }

      assert Map.has_key?(key_data, "key1")
      assert Map.has_key?(key_data, "key2")
    end
  end

  describe "generate_synthetic_deletes/4" do
    test "generates deletes for keys matching pattern" do
      # Set up: two keys with tag_a
      msg1 = make_change_msg("key1", :insert, tags: ["tag_a"], value: %{"id" => "1"})
      msg2 = make_change_msg("key2", :insert, tags: ["tag_a"], value: %{"id" => "2"})

      {tag_to_keys, key_data} = TagTracker.update_tag_index(%{}, %{}, msg1)
      {tag_to_keys, key_data} = TagTracker.update_tag_index(tag_to_keys, key_data, msg2)

      # Move-out for tag_a
      patterns = [%{pos: 0, value: "tag_a"}]
      timestamp = DateTime.utc_now()

      {deletes, new_tag_to_keys, new_key_data} =
        TagTracker.generate_synthetic_deletes(tag_to_keys, key_data, patterns, timestamp)

      assert length(deletes) == 2

      keys = Enum.map(deletes, & &1.key) |> Enum.sort()
      assert keys == ["key1", "key2"]

      Enum.each(deletes, fn delete ->
        assert delete.headers.operation == :delete
        assert delete.request_timestamp == timestamp
      end)

      assert new_tag_to_keys == %{}
      assert new_key_data == %{}
    end

    test "does not delete keys with remaining tags" do
      # Set up: key1 has tag_a and tag_b
      msg = make_change_msg("key1", :insert, tags: ["tag_a", "tag_b"], value: %{"id" => "1"})
      {tag_to_keys, key_data} = TagTracker.update_tag_index(%{}, %{}, msg)

      # Move-out only for tag_a
      patterns = [%{pos: 0, value: "tag_a"}]
      timestamp = DateTime.utc_now()

      {deletes, new_tag_to_keys, new_key_data} =
        TagTracker.generate_synthetic_deletes(tag_to_keys, key_data, patterns, timestamp)

      # No synthetic deletes - key1 still has tag_b
      assert deletes == []

      # tag_a removed, tag_b remains
      assert new_tag_to_keys == %{
               {0, "tag_b"} => MapSet.new(["key1"])
             }

      assert new_key_data["key1"].tags == MapSet.new([{0, "tag_b"}])
    end

    test "handles non-existent tag pattern" do
      msg = make_change_msg("key1", :insert, tags: ["tag_a"])
      {tag_to_keys, key_data} = TagTracker.update_tag_index(%{}, %{}, msg)

      patterns = [%{pos: 0, value: "nonexistent_tag"}]
      timestamp = DateTime.utc_now()

      {deletes, new_tag_to_keys, new_key_data} =
        TagTracker.generate_synthetic_deletes(tag_to_keys, key_data, patterns, timestamp)

      assert deletes == []
      assert new_tag_to_keys == tag_to_keys
      assert new_key_data == key_data
    end

    test "handles multiple patterns in one call" do
      msg1 = make_change_msg("key1", :insert, tags: ["tag_a"])
      msg2 = make_change_msg("key2", :insert, tags: ["tag_b"])

      {tag_to_keys, key_data} = TagTracker.update_tag_index(%{}, %{}, msg1)
      {tag_to_keys, key_data} = TagTracker.update_tag_index(tag_to_keys, key_data, msg2)

      patterns = [%{pos: 0, value: "tag_a"}, %{pos: 0, value: "tag_b"}]
      timestamp = DateTime.utc_now()

      {deletes, new_tag_to_keys, new_key_data} =
        TagTracker.generate_synthetic_deletes(tag_to_keys, key_data, patterns, timestamp)

      assert length(deletes) == 2
      assert new_tag_to_keys == %{}
      assert new_key_data == %{}
    end
  end

  describe "normalize_tags/1" do
    test "normalizes slash-delimited tags to 2D structure" do
      assert TagTracker.normalize_tags(["hash1/hash2/", "//hash3"]) ==
               [["hash1", "hash2", nil], [nil, nil, "hash3"]]

      assert TagTracker.normalize_tags(["tag_a"]) == [["tag_a"]]
      assert TagTracker.normalize_tags([]) == []
    end

    test "single-position tags normalize to single-element lists" do
      assert TagTracker.normalize_tags(["hash_a", "hash_b"]) ==
               [["hash_a"], ["hash_b"]]
    end

    test "multi-position tags with mixed nils" do
      assert TagTracker.normalize_tags(["hash_a/", "/hash_b"]) ==
               [["hash_a", nil], [nil, "hash_b"]]
    end
  end

  describe "tag_tracker with DNF wire format" do
    test "removed_tags in slash-delimited format are correctly filtered" do
      msg1 =
        make_change_msg("key1", :insert,
          tags: ["hash_a/hash_b"],
          active_conditions: [true, true]
        )

      {ttk, kd} = TagTracker.update_tag_index(%{}, %{}, msg1)

      assert ttk == %{
               {0, "hash_a"} => MapSet.new(["key1"]),
               {1, "hash_b"} => MapSet.new(["key1"])
             }

      # Remove hash_a via slash-delimited removed_tags, add new hash at pos 0
      msg2 =
        make_change_msg("key1", :update,
          tags: ["hash_c/hash_b"],
          removed_tags: ["hash_a/"],
          active_conditions: [true, true]
        )

      {ttk, _kd} = TagTracker.update_tag_index(ttk, kd, msg2)

      assert ttk == %{
               {0, "hash_c"} => MapSet.new(["key1"]),
               {1, "hash_b"} => MapSet.new(["key1"])
             }
    end

    test "row_visible? evaluates DNF correctly" do
      # Disjunct 0 needs positions [0, 1], disjunct 1 needs positions [2]
      disjunct_positions = [[0, 1], [2]]

      # All active
      assert TagTracker.row_visible?([true, true, true], disjunct_positions)

      # Only disjunct 0 satisfied
      assert TagTracker.row_visible?([true, true, false], disjunct_positions)

      # Only disjunct 1 satisfied
      assert TagTracker.row_visible?([false, false, true], disjunct_positions)

      # No disjunct satisfied (pos 0 false means disjunct 0 fails, pos 2 false means disjunct 1 fails)
      refute TagTracker.row_visible?([false, true, false], disjunct_positions)
      refute TagTracker.row_visible?([false, false, false], disjunct_positions)
    end

    test "generate_synthetic_deletes only deletes when all disjuncts unsatisfied" do
      # Key1 has two disjuncts: disjunct 0 uses pos 0, disjunct 1 uses pos 1
      msg =
        make_change_msg("key1", :insert,
          tags: ["hash_a/", "/hash_b"],
          active_conditions: [true, true]
        )

      {ttk, kd} = TagTracker.update_tag_index(%{}, %{}, msg)

      # Move-out at position 0 - disjunct 1 still satisfied
      patterns = [%{pos: 0, value: "hash_a"}]
      timestamp = DateTime.utc_now()

      {deletes, ttk, kd} =
        TagTracker.generate_synthetic_deletes(ttk, kd, patterns, timestamp)

      # Still visible via disjunct 1
      assert deletes == []
      assert kd["key1"].active_conditions == [false, true]

      # Move-out at position 1 - no disjunct satisfied
      patterns = [%{pos: 1, value: "hash_b"}]

      {deletes, _ttk, _kd} =
        TagTracker.generate_synthetic_deletes(ttk, kd, patterns, timestamp)

      assert length(deletes) == 1
      assert hd(deletes).key == "key1"
    end

    test "handle_move_in activates correct positions" do
      msg =
        make_change_msg("key1", :insert,
          tags: ["hash_a/", "/hash_b"],
          active_conditions: [true, false]
        )

      {ttk, kd} = TagTracker.update_tag_index(%{}, %{}, msg)

      # Position 1 is inactive
      refute Enum.at(kd["key1"].active_conditions, 1)

      # Move-in activates position 1
      patterns = [%{pos: 1, value: "hash_b"}]
      {_ttk, kd} = TagTracker.handle_move_in(ttk, kd, patterns)

      assert kd["key1"].active_conditions == [true, true]
    end

    test "position-based tag_to_keys index for multi-disjunct shapes" do
      msg =
        make_change_msg("key1", :insert,
          tags: ["hash_a/hash_b", "hash_c/hash_d"],
          active_conditions: [true, true]
        )

      {ttk, _kd} = TagTracker.update_tag_index(%{}, %{}, msg)

      assert Map.has_key?(ttk, {0, "hash_a"})
      assert Map.has_key?(ttk, {1, "hash_b"})
      assert Map.has_key?(ttk, {0, "hash_c"})
      assert Map.has_key?(ttk, {1, "hash_d"})
    end

    test "active_conditions stored from headers" do
      msg =
        make_change_msg("key1", :insert,
          tags: ["hash_a/hash_b"],
          active_conditions: [true, false]
        )

      {_ttk, kd} = TagTracker.update_tag_index(%{}, %{}, msg)

      assert kd["key1"].active_conditions == [true, false]
      assert kd["key1"].disjunct_positions == [[0, 1]]
    end

    test "disjunct structure derived correctly from slash-delimited tags" do
      msg =
        make_change_msg("key1", :insert,
          tags: ["hash_a/", "/hash_b"],
          active_conditions: [true, true]
        )

      {_ttk, kd} = TagTracker.update_tag_index(%{}, %{}, msg)

      # Disjunct 0 uses position 0, disjunct 1 uses position 1
      assert kd["key1"].disjunct_positions == [[0], [1]]
    end
  end
end
