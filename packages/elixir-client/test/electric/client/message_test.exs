defmodule Electric.Client.MessageTest do
  use ExUnit.Case, async: true

  alias Electric.Client.Message
  alias Electric.Client.Message.{ChangeMessage, ControlMessage, MoveOutMessage}

  # request_timestamp
  @ts ~U[2024-01-15 10:30:00Z]

  describe "ControlMessage" do
    test "up-to-date" do
      assert [%ControlMessage{control: :up_to_date}] =
               Message.parse(%{"headers" => %{"control" => "up-to-date"}}, "handle", & &1, @ts)

      assert [%ControlMessage{control: :up_to_date}] =
               Message.parse(%{headers: %{control: "up-to-date"}}, "handle", & &1, @ts)
    end

    test "must-refetch" do
      assert [%ControlMessage{control: :must_refetch}] =
               Message.parse(%{"headers" => %{"control" => "must-refetch"}}, "handle", & &1, @ts)

      assert [%ControlMessage{control: :must_refetch}] =
               Message.parse(%{headers: %{control: "must-refetch"}}, "handle", & &1, @ts)
    end

    test "snapshot-end" do
      assert [%ControlMessage{control: :snapshot_end}] =
               Message.parse(%{"headers" => %{"control" => "snapshot-end"}}, "handle", & &1, @ts)

      assert [%ControlMessage{control: :snapshot_end}] =
               Message.parse(%{headers: %{control: "snapshot-end"}}, "handle", & &1, @ts)
    end
  end

  describe "MoveOutMessage" do
    test "parses move-out with string keys" do
      msg = %{
        "headers" => %{
          "event" => "move-out",
          "patterns" => [%{"pos" => 0, "value" => "tag-hash-abc"}]
        }
      }

      assert [%MoveOutMessage{patterns: [%{pos: 0, value: "tag-hash-abc"}], handle: "my-handle"}] =
               Message.parse(msg, "my-handle", & &1, @ts)
    end

    test "parses move-out with atom keys" do
      msg = %{
        headers: %{
          event: "move-out",
          patterns: [%{pos: 0, value: "tag-hash-xyz"}]
        }
      }

      assert [%MoveOutMessage{patterns: [%{pos: 0, value: "tag-hash-xyz"}], handle: "my-handle"}] =
               Message.parse(msg, "my-handle", & &1, @ts)
    end

    test "parses move-out with multiple patterns" do
      msg = %{
        "headers" => %{
          "event" => "move-out",
          "patterns" => [
            %{"pos" => 0, "value" => "tag-1"},
            %{"pos" => 1, "value" => "tag-2"},
            %{"pos" => 2, "value" => "tag-3"}
          ]
        }
      }

      assert [
               %MoveOutMessage{
                 patterns: [
                   %{pos: 0, value: "tag-1"},
                   %{pos: 1, value: "tag-2"},
                   %{pos: 2, value: "tag-3"}
                 ]
               }
             ] = Message.parse(msg, "handle", & &1, @ts)
    end
  end

  describe "Headers with tags" do
    test "parses headers with tags" do
      msg = %{
        "headers" => %{"operation" => "insert", "tags" => ["tag-a", "tag-b"]},
        "value" => %{"id" => "1"}
      }

      assert [%ChangeMessage{headers: headers}] = Message.parse(msg, "handle", & &1, @ts)
      assert headers.tags == ["tag-a", "tag-b"]
    end

    test "parses headers with removed_tags" do
      msg = %{
        "headers" => %{"operation" => "update", "removed_tags" => ["old-tag"]},
        "value" => %{"id" => "1"}
      }

      assert [%ChangeMessage{headers: headers}] = Message.parse(msg, "handle", & &1, @ts)
      assert headers.removed_tags == ["old-tag"]
    end

    test "parses headers with both tags and removed_tags" do
      msg = %{
        "headers" => %{
          "operation" => "update",
          "tags" => ["new-tag"],
          "removed_tags" => ["old-tag"]
        },
        "value" => %{"id" => "1"}
      }

      assert [%ChangeMessage{headers: headers}] = Message.parse(msg, "handle", & &1, @ts)
      assert headers.tags == ["new-tag"]
      assert headers.removed_tags == ["old-tag"]
    end

    test "defaults tags and removed_tags to empty lists" do
      msg = %{
        "headers" => %{"operation" => "insert"},
        "value" => %{"id" => "1"}
      }

      assert [%ChangeMessage{headers: headers}] = Message.parse(msg, "handle", & &1, @ts)
      assert headers.tags == []
      assert headers.removed_tags == []
    end
  end

  describe "ChangeMessage" do
    test "parses insert with tags in headers" do
      msg = %{
        "key" => "row-key",
        "headers" => %{"operation" => "insert", "tags" => ["my-tag"]},
        "value" => %{"id" => "123", "name" => "test"}
      }

      assert [%ChangeMessage{} = change] = Message.parse(msg, "my-handle", & &1, @ts)
      assert change.key == "row-key"
      assert change.value == %{"id" => "123", "name" => "test"}
      assert change.headers.operation == :insert
      assert change.headers.tags == ["my-tag"]
      assert change.headers.handle == "my-handle"
    end

    test "parses update with old_value" do
      msg = %{
        "key" => "row-key",
        "headers" => %{"operation" => "update", "tags" => ["tag-1"]},
        "value" => %{"id" => "123", "name" => "updated"},
        "old_value" => %{"name" => "original"}
      }

      assert [%ChangeMessage{} = change] = Message.parse(msg, "handle", & &1, @ts)
      assert change.headers.operation == :update
      assert change.value == %{"id" => "123", "name" => "updated"}
      assert change.old_value == %{"name" => "original"}
    end

    test "parses delete" do
      msg = %{
        "key" => "row-key",
        "headers" => %{"operation" => "delete", "tags" => ["tag-1"]},
        "value" => %{"id" => "123"}
      }

      assert [%ChangeMessage{} = change] = Message.parse(msg, "handle", & &1, @ts)
      assert change.headers.operation == :delete
      assert change.value == %{"id" => "123"}
    end
  end
end
