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

  describe "update_tag_index/4" do
    test "tracks new tags for inserts" do
      msg = make_change_msg("key1", :insert, tags: ["tag_a", "tag_b"])

      {tag_to_keys, key_data, _dp} = TagTracker.update_tag_index(%{}, %{}, nil, msg)

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
      {tag_to_keys, key_data, dp} = TagTracker.update_tag_index(%{}, %{}, nil, msg1)

      # Update adds tag_b
      msg2 = make_change_msg("key1", :update, tags: ["tag_b"])
      {tag_to_keys, key_data, _dp} = TagTracker.update_tag_index(tag_to_keys, key_data, dp, msg2)

      assert tag_to_keys == %{
               {0, "tag_a"} => MapSet.new(["key1"]),
               {0, "tag_b"} => MapSet.new(["key1"])
             }

      assert key_data["key1"].tags == MapSet.new([{0, "tag_a"}, {0, "tag_b"}])
    end

    test "removes tags when removed_tags specified" do
      # Initial insert with tag_a and tag_b
      msg1 = make_change_msg("key1", :insert, tags: ["tag_a", "tag_b"])
      {tag_to_keys, key_data, dp} = TagTracker.update_tag_index(%{}, %{}, nil, msg1)

      # Update removes tag_a
      msg2 = make_change_msg("key1", :update, removed_tags: ["tag_a"])
      {tag_to_keys, key_data, _dp} = TagTracker.update_tag_index(tag_to_keys, key_data, dp, msg2)

      assert tag_to_keys == %{
               {0, "tag_b"} => MapSet.new(["key1"])
             }

      assert key_data["key1"].tags == MapSet.new([{0, "tag_b"}])
    end

    test "removes key from tracking on delete" do
      msg1 = make_change_msg("key1", :insert, tags: ["tag_a"])
      {tag_to_keys, key_data, dp} = TagTracker.update_tag_index(%{}, %{}, nil, msg1)

      msg2 = make_change_msg("key1", :delete, tags: [])
      {tag_to_keys, key_data, _dp} = TagTracker.update_tag_index(tag_to_keys, key_data, dp, msg2)

      assert tag_to_keys == %{}
      assert key_data == %{}
    end

    test "handles messages without tags" do
      msg = make_change_msg("key1", :insert, tags: [])
      {tag_to_keys, key_data, _dp} = TagTracker.update_tag_index(%{}, %{}, nil, msg)

      assert tag_to_keys == %{}
      assert key_data == %{}
    end

    test "multiple keys with same tag" do
      msg1 = make_change_msg("key1", :insert, tags: ["shared_tag"])
      msg2 = make_change_msg("key2", :insert, tags: ["shared_tag"])

      {tag_to_keys, key_data, dp} = TagTracker.update_tag_index(%{}, %{}, nil, msg1)
      {tag_to_keys, key_data, _dp} = TagTracker.update_tag_index(tag_to_keys, key_data, dp, msg2)

      assert tag_to_keys == %{
               {0, "shared_tag"} => MapSet.new(["key1", "key2"])
             }

      assert Map.has_key?(key_data, "key1")
      assert Map.has_key?(key_data, "key2")
    end
  end

  describe "generate_synthetic_deletes/5" do
    test "generates deletes for keys matching pattern" do
      msg1 =
        make_change_msg("key1", :insert,
          tags: ["tag_a"],
          active_conditions: [true],
          value: %{"id" => "1"}
        )

      msg2 =
        make_change_msg("key2", :insert,
          tags: ["tag_a"],
          active_conditions: [true],
          value: %{"id" => "2"}
        )

      {tag_to_keys, key_data, dp} = TagTracker.update_tag_index(%{}, %{}, nil, msg1)
      {tag_to_keys, key_data, dp} = TagTracker.update_tag_index(tag_to_keys, key_data, dp, msg2)

      patterns = [%{pos: 0, value: "tag_a"}]
      timestamp = DateTime.utc_now()

      {deletes, new_tag_to_keys, new_key_data} =
        TagTracker.generate_synthetic_deletes(tag_to_keys, key_data, dp, patterns, timestamp)

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

    test "does not delete keys still visible via another disjunct" do
      # key1 has two disjuncts: pos 0 and pos 1
      msg =
        make_change_msg("key1", :insert,
          tags: ["tag_a/", "/tag_b"],
          active_conditions: [true, true],
          value: %{"id" => "1"}
        )

      {tag_to_keys, key_data, dp} = TagTracker.update_tag_index(%{}, %{}, nil, msg)

      # Move-out only for pos 0
      patterns = [%{pos: 0, value: "tag_a"}]
      timestamp = DateTime.utc_now()

      {deletes, new_tag_to_keys, new_key_data} =
        TagTracker.generate_synthetic_deletes(tag_to_keys, key_data, dp, patterns, timestamp)

      assert deletes == []
      assert new_key_data["key1"].active_conditions == [false, true]

      # tag_to_keys entries preserved for move-in broadcasts
      assert Map.has_key?(new_tag_to_keys, {0, "tag_a"})
      assert Map.has_key?(new_tag_to_keys, {1, "tag_b"})
    end

    test "handles non-existent tag pattern" do
      msg =
        make_change_msg("key1", :insert,
          tags: ["tag_a"],
          active_conditions: [true]
        )

      {tag_to_keys, key_data, dp} = TagTracker.update_tag_index(%{}, %{}, nil, msg)

      patterns = [%{pos: 0, value: "nonexistent_tag"}]
      timestamp = DateTime.utc_now()

      {deletes, new_tag_to_keys, new_key_data} =
        TagTracker.generate_synthetic_deletes(tag_to_keys, key_data, dp, patterns, timestamp)

      assert deletes == []
      assert new_tag_to_keys == tag_to_keys
      assert new_key_data == key_data
    end

    test "handles multiple patterns in one call" do
      msg1 =
        make_change_msg("key1", :insert,
          tags: ["tag_a"],
          active_conditions: [true]
        )

      msg2 =
        make_change_msg("key2", :insert,
          tags: ["tag_b"],
          active_conditions: [true]
        )

      {tag_to_keys, key_data, dp} = TagTracker.update_tag_index(%{}, %{}, nil, msg1)
      {tag_to_keys, key_data, dp} = TagTracker.update_tag_index(tag_to_keys, key_data, dp, msg2)

      patterns = [%{pos: 0, value: "tag_a"}, %{pos: 0, value: "tag_b"}]
      timestamp = DateTime.utc_now()

      {deletes, new_tag_to_keys, new_key_data} =
        TagTracker.generate_synthetic_deletes(tag_to_keys, key_data, dp, patterns, timestamp)

      assert length(deletes) == 2
      assert new_tag_to_keys == %{}
      assert new_key_data == %{}
    end

    test "falls back to empty-tag-set deletion when active_conditions are missing" do
      msg =
        make_change_msg("key1", :insert,
          tags: ["tag_a", "tag_b"],
          value: %{"id" => "1"}
        )

      {tag_to_keys, key_data, dp} = TagTracker.update_tag_index(%{}, %{}, nil, msg)

      assert key_data["key1"].active_conditions == nil

      {deletes, tag_to_keys, key_data} =
        TagTracker.generate_synthetic_deletes(
          tag_to_keys,
          key_data,
          dp,
          [%{pos: 0, value: "tag_a"}],
          DateTime.utc_now()
        )

      assert deletes == []
      assert key_data["key1"].active_conditions == nil
      assert key_data["key1"].tags == MapSet.new([{0, "tag_b"}])
      assert tag_to_keys == %{{0, "tag_b"} => MapSet.new(["key1"])}

      {deletes, tag_to_keys, key_data} =
        TagTracker.generate_synthetic_deletes(
          tag_to_keys,
          key_data,
          dp,
          [%{pos: 0, value: "tag_b"}],
          DateTime.utc_now()
        )

      assert length(deletes) == 1
      assert hd(deletes).key == "key1"
      assert tag_to_keys == %{}
      assert key_data == %{}
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

      {ttk, kd, dp} = TagTracker.update_tag_index(%{}, %{}, nil, msg1)

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

      {ttk, _kd, _dp} = TagTracker.update_tag_index(ttk, kd, dp, msg2)

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

      {ttk, kd, dp} = TagTracker.update_tag_index(%{}, %{}, nil, msg)

      # Move-out at position 0 - disjunct 1 still satisfied
      patterns = [%{pos: 0, value: "hash_a"}]
      timestamp = DateTime.utc_now()

      {deletes, ttk, kd} =
        TagTracker.generate_synthetic_deletes(ttk, kd, dp, patterns, timestamp)

      # Still visible via disjunct 1
      assert deletes == []
      assert kd["key1"].active_conditions == [false, true]

      # Move-out at position 1 - no disjunct satisfied
      patterns = [%{pos: 1, value: "hash_b"}]

      {deletes, _ttk, _kd} =
        TagTracker.generate_synthetic_deletes(ttk, kd, dp, patterns, timestamp)

      assert length(deletes) == 1
      assert hd(deletes).key == "key1"
    end

    test "handle_move_in activates correct positions" do
      msg =
        make_change_msg("key1", :insert,
          tags: ["hash_a/", "/hash_b"],
          active_conditions: [true, false]
        )

      {ttk, kd, _dp} = TagTracker.update_tag_index(%{}, %{}, nil, msg)

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

      {ttk, _kd, _dp} = TagTracker.update_tag_index(%{}, %{}, nil, msg)

      assert Map.has_key?(ttk, {0, "hash_a"})
      assert Map.has_key?(ttk, {1, "hash_b"})
      assert Map.has_key?(ttk, {0, "hash_c"})
      assert Map.has_key?(ttk, {1, "hash_d"})
    end

    test "active_conditions stored from headers and disjunct_positions derived once" do
      msg =
        make_change_msg("key1", :insert,
          tags: ["hash_a/hash_b"],
          active_conditions: [true, false]
        )

      {_ttk, kd, dp} = TagTracker.update_tag_index(%{}, %{}, nil, msg)

      assert kd["key1"].active_conditions == [true, false]
      assert dp == [[0, 1]]
    end

    test "orphaned tag_to_keys entries after delete do not cause phantom deletes" do
      # Shape: (A AND C) OR (B AND C) → disjuncts [[0,1], [2,3]]
      # Row "r" has all 4 positions active with hash "X"
      msg =
        make_change_msg("r", :insert,
          tags: ["X/X//", "//X/X"],
          active_conditions: [true, true, true, true]
        )

      {ttk, kd, dp} = TagTracker.update_tag_index(%{}, %{}, nil, msg)

      # Deactivate positions 1 and 3 (dep C moves out with hash "X")
      # Both disjuncts lose their C position → row invisible → deleted from key_data
      patterns = [%{pos: 1, value: "X"}, %{pos: 3, value: "X"}]

      {deletes, ttk, kd} =
        TagTracker.generate_synthetic_deletes(ttk, kd, dp, patterns, DateTime.utc_now())

      assert length(deletes) == 1
      assert hd(deletes).key == "r"
      refute Map.has_key?(kd, "r")

      # Bug: {0, "X"} and {2, "X"} are still in tag_to_keys as orphans
      # pointing to the deleted key "r"

      # Re-insert row "r" with NEW hash "Y" at all positions (move-in)
      msg =
        make_change_msg("r", :insert,
          tags: ["Y/Y//", "//Y/Y"],
          active_conditions: [true, true, true, true]
        )

      {ttk, kd, dp} = TagTracker.update_tag_index(ttk, kd, dp, msg)

      # Deactivate position 0 with STALE hash "X" — should have NO effect
      # since the row's current hash at pos 0 is "Y", not "X"
      patterns = [%{pos: 0, value: "X"}]

      {deletes, ttk, kd} =
        TagTracker.generate_synthetic_deletes(ttk, kd, dp, patterns, DateTime.utc_now())

      assert deletes == []
      # Without fix: active_conditions would be corrupted to [false, true, true, true]
      assert kd["r"].active_conditions == [true, true, true, true]

      # Now a legitimate deactivation at position 2 with current hash "Y"
      patterns = [%{pos: 2, value: "Y"}]

      {deletes, _ttk, _kd} =
        TagTracker.generate_synthetic_deletes(ttk, kd, dp, patterns, DateTime.utc_now())

      # Disjunct 0 ([0,1]) is still fully active → row should remain visible
      # Without fix: the corrupted pos 0 causes both disjuncts to fail → phantom delete
      assert deletes == []
    end

    test "disjunct structure derived correctly from slash-delimited tags" do
      msg =
        make_change_msg("key1", :insert,
          tags: ["hash_a/", "/hash_b"],
          active_conditions: [true, true]
        )

      {_ttk, _kd, dp} = TagTracker.update_tag_index(%{}, %{}, nil, msg)

      # Disjunct 0 uses position 0, disjunct 1 uses position 1
      assert dp == [[0], [1]]
    end

    test "multi-disjunct: row stays when one disjunct lost, deleted when all lost" do
      # Tags: ["hash_a/hash_b/", "//hash_c"]
      # Disjunct 0 covers positions [0, 1], disjunct 1 covers position [2]
      msg =
        make_change_msg("key1", :insert,
          tags: ["hash_a/hash_b/", "//hash_c"],
          active_conditions: [true, true, true],
          value: %{"id" => "1", "name" => "User 1"}
        )

      {ttk, kd, dp} = TagTracker.update_tag_index(%{}, %{}, nil, msg)
      assert dp == [[0, 1], [2]]

      # Move-out at position 0 → disjunct 0 fails (needs [0,1]), disjunct 1 (pos 2) still satisfied
      patterns = [%{pos: 0, value: "hash_a"}]
      timestamp = DateTime.utc_now()

      {deletes, ttk, kd} =
        TagTracker.generate_synthetic_deletes(ttk, kd, dp, patterns, timestamp)

      assert deletes == []
      assert kd["key1"].active_conditions == [false, true, true]

      # Move-out at position 2 → disjunct 1 also fails, no disjunct satisfied
      patterns = [%{pos: 2, value: "hash_c"}]

      {deletes, _ttk, _kd} =
        TagTracker.generate_synthetic_deletes(ttk, kd, dp, patterns, timestamp)

      assert length(deletes) == 1
      assert hd(deletes).key == "key1"
    end

    test "overwrite active_conditions when row is re-sent (move-in overwrite)" do
      # Insert row with active_conditions [true, false]
      msg1 =
        make_change_msg("key1", :insert,
          tags: ["hash_a/hash_b"],
          active_conditions: [true, false],
          value: %{"id" => "1", "name" => "User 1"}
        )

      {ttk, kd, dp} = TagTracker.update_tag_index(%{}, %{}, nil, msg1)
      assert kd["key1"].active_conditions == [true, false]

      # Server re-sends the same row with updated active_conditions
      msg2 =
        make_change_msg("key1", :update,
          tags: ["hash_a/hash_b"],
          active_conditions: [true, true],
          value: %{"id" => "1", "name" => "User 1 updated"}
        )

      {ttk, kd, dp} = TagTracker.update_tag_index(ttk, kd, dp, msg2)
      assert kd["key1"].active_conditions == [true, true]

      # Verify the overwritten active_conditions work correctly:
      # With single disjunct [0,1], move-out at pos 0 should make row invisible
      patterns = [%{pos: 0, value: "hash_a"}]
      timestamp = DateTime.utc_now()

      {deletes, _ttk, _kd} =
        TagTracker.generate_synthetic_deletes(ttk, kd, dp, patterns, timestamp)

      assert length(deletes) == 1
      assert hd(deletes).key == "key1"
    end

    test "move-out preserves tag_to_keys so move-in can re-activate" do
      # Row with two disjuncts: pos 0 and pos 1
      msg =
        make_change_msg("key1", :insert,
          tags: ["hash_a/", "/hash_b"],
          active_conditions: [true, true],
          value: %{"id" => "1", "name" => "User 1"}
        )

      {ttk, kd, dp} = TagTracker.update_tag_index(%{}, %{}, nil, msg)

      # Move-out at pos 0 — row stays visible via disjunct 1
      patterns = [%{pos: 0, value: "hash_a"}]

      {deletes, ttk, kd} =
        TagTracker.generate_synthetic_deletes(ttk, kd, dp, patterns, DateTime.utc_now())

      assert deletes == []
      assert kd["key1"].active_conditions == [false, true]

      # Move-in at pos 0 — should find key1 via preserved tag_to_keys entry
      patterns = [%{pos: 0, value: "hash_a"}]
      {ttk, kd} = TagTracker.handle_move_in(ttk, kd, patterns)

      assert kd["key1"].active_conditions == [true, true]

      # Now both disjuncts active again; move-out at pos 1 alone should not delete
      patterns = [%{pos: 1, value: "hash_b"}]

      {deletes, _ttk, kd} =
        TagTracker.generate_synthetic_deletes(ttk, kd, dp, patterns, DateTime.utc_now())

      assert deletes == []
      assert kd["key1"].active_conditions == [true, false]
    end

    test "deleted row cleans up all tag_to_keys entries" do
      # Row with entries at pos 0 and pos 1 in a single disjunct
      msg =
        make_change_msg("key1", :insert,
          tags: ["hash_a/hash_b"],
          active_conditions: [true, true],
          value: %{"id" => "1"}
        )

      {ttk, kd, dp} = TagTracker.update_tag_index(%{}, %{}, nil, msg)
      assert Map.has_key?(ttk, {0, "hash_a"})
      assert Map.has_key?(ttk, {1, "hash_b"})

      # Move-out at pos 0 — single disjunct [0,1] fails → row deleted
      patterns = [%{pos: 0, value: "hash_a"}]

      {deletes, ttk, kd} =
        TagTracker.generate_synthetic_deletes(ttk, kd, dp, patterns, DateTime.utc_now())

      assert length(deletes) == 1
      assert kd == %{}
      # Both entries cleaned, not just the matched {0, "hash_a"}
      refute Map.has_key?(ttk, {0, "hash_a"})
      refute Map.has_key?(ttk, {1, "hash_b"})
    end

    test "multiple patterns deactivating same row in one call" do
      # Row with single disjunct needing both pos 0 and pos 1
      msg =
        make_change_msg("key1", :insert,
          tags: ["hash_a/hash_b"],
          active_conditions: [true, true],
          value: %{"id" => "1"}
        )

      {ttk, kd, dp} = TagTracker.update_tag_index(%{}, %{}, nil, msg)

      # Both positions deactivated in one call
      patterns = [%{pos: 0, value: "hash_a"}, %{pos: 1, value: "hash_b"}]

      {deletes, ttk, kd} =
        TagTracker.generate_synthetic_deletes(ttk, kd, dp, patterns, DateTime.utc_now())

      assert length(deletes) == 1
      assert hd(deletes).key == "key1"
      assert kd == %{}
      assert ttk == %{}
    end

    test "disjunct_positions derived once and reused across keys" do
      msg1 =
        make_change_msg("key1", :insert,
          tags: ["hash_a/", "/hash_b"],
          active_conditions: [true, true]
        )

      {ttk, kd, dp} = TagTracker.update_tag_index(%{}, %{}, nil, msg1)
      assert dp == [[0], [1]]

      # Second key with different hashes but same structure
      msg2 =
        make_change_msg("key2", :insert,
          tags: ["hash_c/", "/hash_d"],
          active_conditions: [true, false]
        )

      {_ttk, _kd, dp2} = TagTracker.update_tag_index(ttk, kd, dp, msg2)

      # disjunct_positions unchanged — derived once, reused
      assert dp2 == dp
    end
  end
end
