defmodule Electric.Client.TagTrackerTest do
  use ExUnit.Case, async: true

  alias Electric.Client.TagTracker
  alias Electric.Client.Message.ChangeMessage
  alias Electric.Client.Message.Headers

  defp make_change_msg(key, operation, opts) do
    tags = Keyword.get(opts, :tags, [])
    removed_tags = Keyword.get(opts, :removed_tags, [])
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
        removed_tags: removed_tags
      },
      request_timestamp: DateTime.utc_now()
    }
  end

  describe "update_tag_index/3" do
    test "tracks new tags for inserts" do
      msg = make_change_msg("key1", :insert, tags: ["tag_a", "tag_b"])

      {tag_to_keys, key_data} = TagTracker.update_tag_index(%{}, %{}, msg)

      assert tag_to_keys == %{
               "tag_a" => MapSet.new(["key1"]),
               "tag_b" => MapSet.new(["key1"])
             }

      assert Map.has_key?(key_data, "key1")
      assert key_data["key1"].tags == MapSet.new(["tag_a", "tag_b"])
    end

    test "updates tags for updates" do
      # Initial insert with tag_a
      msg1 = make_change_msg("key1", :insert, tags: ["tag_a"])
      {tag_to_keys, key_data} = TagTracker.update_tag_index(%{}, %{}, msg1)

      # Update adds tag_b
      msg2 = make_change_msg("key1", :update, tags: ["tag_b"])
      {tag_to_keys, key_data} = TagTracker.update_tag_index(tag_to_keys, key_data, msg2)

      assert tag_to_keys == %{
               "tag_a" => MapSet.new(["key1"]),
               "tag_b" => MapSet.new(["key1"])
             }

      assert key_data["key1"].tags == MapSet.new(["tag_a", "tag_b"])
    end

    test "removes tags when removed_tags specified" do
      # Initial insert with tag_a and tag_b
      msg1 = make_change_msg("key1", :insert, tags: ["tag_a", "tag_b"])
      {tag_to_keys, key_data} = TagTracker.update_tag_index(%{}, %{}, msg1)

      # Update removes tag_a
      msg2 = make_change_msg("key1", :update, removed_tags: ["tag_a"])
      {tag_to_keys, key_data} = TagTracker.update_tag_index(tag_to_keys, key_data, msg2)

      assert tag_to_keys == %{
               "tag_b" => MapSet.new(["key1"])
             }

      assert key_data["key1"].tags == MapSet.new(["tag_b"])
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
               "shared_tag" => MapSet.new(["key1", "key2"])
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
               "tag_b" => MapSet.new(["key1"])
             }

      assert new_key_data["key1"].tags == MapSet.new(["tag_b"])
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
end
