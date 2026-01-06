defmodule Electric.Client.MoveIntegrationTest do
  @moduledoc """
  Integration tests for move-in/out support in the Electric client.

  These tests verify the complete flow of:
  - Processing change messages with tags
  - Handling move-out events
  - Buffering move-outs during initial sync
  - Generating synthetic deletes when tag sets become empty
  """

  use ExUnit.Case, async: true

  import Support.ClientHelpers

  alias Electric.Client
  alias Electric.Client.Fetch
  alias Electric.Client.Message.{ChangeMessage, ControlMessage, EventMessage, Headers}
  alias Electric.Client.ShapeDefinition

  describe "change messages with tags" do
    test "processes insert with tags" do
      {:ok, client} = Client.Mock.new()
      parent = self()

      {:ok, _} =
        start_supervised(
          {Task,
           fn ->
             events =
               Client.stream(client, "items")
               |> Enum.take(2)

             send(parent, {:events, events})
           end}
        )

      {:ok, _request} =
        Client.Mock.response(client,
          status: 200,
          schema: %{id: %{type: "int8"}, name: %{type: "text"}},
          last_offset: Client.Offset.new(0, 0),
          shape_handle: "shape-1",
          body: [
            change_with_tags(
              key: "row1",
              value: %{id: "1", name: "Item 1"},
              tags: ["tag_abc|123", "tag_def|456"]
            ),
            up_to_date_msg()
          ]
        )

      events =
        receive do
          {:events, events} -> events
        after
          5000 -> flunk("Timeout waiting for events")
        end

      assert [
               %ChangeMessage{
                 key: "row1",
                 value: %{"id" => 1, "name" => "Item 1"},
                 headers: %Headers{
                   operation: :insert,
                   tags: ["tag_abc|123", "tag_def|456"]
                 }
               },
               up_to_date()
             ] = events
    end

    test "processes update with tags and removed_tags" do
      {:ok, client} = Client.Mock.new()
      parent = self()

      {:ok, _} =
        start_supervised(
          {Task,
           fn ->
             events =
               Client.stream(client, "items")
               |> Enum.take(3)

             send(parent, {:events, events})
           end}
        )

      {:ok, _request} =
        Client.Mock.response(client,
          status: 200,
          schema: %{id: %{type: "int8"}, name: %{type: "text"}},
          last_offset: Client.Offset.new(0, 0),
          shape_handle: "shape-1",
          body: [
            change_with_tags(
              key: "row1",
              value: %{id: "1", name: "Item 1"},
              tags: ["tag_abc|123"]
            ),
            change_with_tags(
              key: "row1",
              operation: :update,
              value: %{id: "1", name: "Updated Item"},
              tags: ["tag_def|456"],
              removed_tags: ["tag_abc|123"]
            ),
            up_to_date_msg()
          ]
        )

      events =
        receive do
          {:events, events} -> events
        after
          5000 -> flunk("Timeout waiting for events")
        end

      assert [
               %ChangeMessage{
                 key: "row1",
                 headers: %Headers{
                   operation: :insert,
                   tags: ["tag_abc|123"],
                   removed_tags: []
                 }
               },
               %ChangeMessage{
                 key: "row1",
                 headers: %Headers{
                   operation: :update,
                   tags: ["tag_def|456"],
                   removed_tags: ["tag_abc|123"]
                 }
               },
               up_to_date()
             ] = events
    end

    test "handles delete clearing all tags" do
      {:ok, client} = Client.Mock.new()
      parent = self()

      {:ok, _} =
        start_supervised(
          {Task,
           fn ->
             events =
               Client.stream(client, "items")
               |> Enum.take(3)

             send(parent, {:events, events})
           end}
        )

      {:ok, _request} =
        Client.Mock.response(client,
          status: 200,
          schema: %{id: %{type: "int8"}, name: %{type: "text"}},
          last_offset: Client.Offset.new(0, 0),
          shape_handle: "shape-1",
          body: [
            change_with_tags(
              key: "row1",
              value: %{id: "1", name: "Item 1"},
              tags: ["tag_abc|123"]
            ),
            change_with_tags(
              key: "row1",
              operation: :delete,
              value: %{id: "1", name: "Item 1"}
            ),
            up_to_date_msg()
          ]
        )

      events =
        receive do
          {:events, events} -> events
        after
          5000 -> flunk("Timeout waiting for events")
        end

      assert [
               %ChangeMessage{
                 key: "row1",
                 headers: %Headers{operation: :insert}
               },
               %ChangeMessage{
                 key: "row1",
                 headers: %Headers{operation: :delete}
               },
               up_to_date()
             ] = events
    end
  end

  describe "move-out events" do
    test "generates synthetic delete for row with matching tag" do
      {:ok, client} = Client.Mock.new()
      parent = self()

      {:ok, _} =
        start_supervised(
          {Task,
           fn ->
             events =
               Client.stream(client, "items")
               |> Enum.take(4)

             send(parent, {:events, events})
           end}
        )

      # First response: initial data with tags
      {:ok, _request} =
        Client.Mock.response(client,
          status: 200,
          schema: %{id: %{type: "int8"}, name: %{type: "text"}},
          last_offset: Client.Offset.new(0, 0),
          shape_handle: "shape-1",
          body: [
            change_with_tags(
              key: "row1",
              value: %{id: "1", name: "Item 1"},
              tags: ["hash1|value1"]
            ),
            up_to_date_msg()
          ]
        )

      # Second response: move-out event
      {:ok, _request} =
        Client.Mock.response(client,
          status: 200,
          schema: %{id: %{type: "int8"}, name: %{type: "text"}},
          last_offset: Client.Offset.new(0, 1),
          shape_handle: "shape-1",
          body: [
            move_out_event([%{pos: 0, value: "hash1"}]),
            up_to_date_msg()
          ]
        )

      events =
        receive do
          {:events, events} -> events
        after
          5000 -> flunk("Timeout waiting for events")
        end

      assert [
               %ChangeMessage{
                 key: "row1",
                 value: %{"id" => 1, "name" => "Item 1"},
                 headers: %Headers{operation: :insert}
               },
               up_to_date(),
               # Synthetic delete from move-out
               %ChangeMessage{
                 key: "row1",
                 value: %{},
                 headers: %Headers{operation: :delete}
               },
               up_to_date()
             ] = events
    end

    test "does not delete row with remaining tags" do
      {:ok, client} = Client.Mock.new()
      parent = self()

      {:ok, _} =
        start_supervised(
          {Task,
           fn ->
             events =
               Client.stream(client, "items")
               |> Enum.take(3)

             send(parent, {:events, events})
           end}
        )

      # First response: row with multiple tags
      {:ok, _request} =
        Client.Mock.response(client,
          status: 200,
          schema: %{id: %{type: "int8"}, name: %{type: "text"}},
          last_offset: Client.Offset.new(0, 0),
          shape_handle: "shape-1",
          body: [
            change_with_tags(
              key: "row1",
              value: %{id: "1", name: "Item 1"},
              tags: ["hash1|value1", "hash2|value2"]
            ),
            up_to_date_msg()
          ]
        )

      # Second response: move-out removes only one tag
      {:ok, _request} =
        Client.Mock.response(client,
          status: 200,
          schema: %{id: %{type: "int8"}, name: %{type: "text"}},
          last_offset: Client.Offset.new(0, 1),
          shape_handle: "shape-1",
          body: [
            move_out_event([%{pos: 0, value: "hash1"}]),
            up_to_date_msg()
          ]
        )

      events =
        receive do
          {:events, events} -> events
        after
          5000 -> flunk("Timeout waiting for events")
        end

      # Should NOT see a synthetic delete because row still has hash2|value2 tag
      assert [
               %ChangeMessage{key: "row1", headers: %Headers{operation: :insert}},
               up_to_date(),
               # No delete here!
               up_to_date()
             ] = events
    end

    test "deletes multiple rows matching move-out pattern" do
      {:ok, client} = Client.Mock.new()
      parent = self()

      {:ok, _} =
        start_supervised(
          {Task,
           fn ->
             events =
               Client.stream(client, "items")
               |> Enum.take(6)

             send(parent, {:events, events})
           end}
        )

      # First response: multiple rows with same tag position 0 value
      {:ok, _request} =
        Client.Mock.response(client,
          status: 200,
          schema: %{id: %{type: "int8"}, name: %{type: "text"}},
          last_offset: Client.Offset.new(0, 0),
          shape_handle: "shape-1",
          body: [
            change_with_tags(
              key: "row1",
              value: %{id: "1", name: "Item 1"},
              tags: ["shared_hash|a"]
            ),
            change_with_tags(
              key: "row2",
              value: %{id: "2", name: "Item 2"},
              tags: ["shared_hash|b"]
            ),
            change_with_tags(
              key: "row3",
              value: %{id: "3", name: "Item 3"},
              tags: ["other_hash|c"]
            ),
            up_to_date_msg()
          ]
        )

      # Second response: move-out for shared_hash
      {:ok, _request} =
        Client.Mock.response(client,
          status: 200,
          schema: %{id: %{type: "int8"}, name: %{type: "text"}},
          last_offset: Client.Offset.new(0, 1),
          shape_handle: "shape-1",
          body: [
            move_out_event([%{pos: 0, value: "shared_hash"}]),
            up_to_date_msg()
          ]
        )

      events =
        receive do
          {:events, events} -> events
        after
          5000 -> flunk("Timeout waiting for events")
        end

      # Filter to just the operations for clarity
      change_keys =
        events
        |> Enum.filter(&match?(%ChangeMessage{}, &1))
        |> Enum.map(fn %ChangeMessage{key: key, headers: %{operation: op}} -> {key, op} end)

      # Should have inserts for row1, row2, row3 and deletes for row1, row2 (not row3)
      assert {"row1", :insert} in change_keys
      assert {"row2", :insert} in change_keys
      assert {"row3", :insert} in change_keys
      assert {"row1", :delete} in change_keys
      assert {"row2", :delete} in change_keys
      refute {"row3", :delete} in change_keys
    end
  end

  describe "move-out buffering during initial sync" do
    test "buffers move-outs and processes them at up-to-date" do
      {:ok, client} = Client.Mock.new()
      parent = self()

      {:ok, _} =
        start_supervised(
          {Task,
           fn ->
             events =
               Client.stream(client, "items")
               |> Enum.take(3)

             send(parent, {:events, events})
           end}
        )

      # Single response with insert, move-out, and up-to-date
      # The move-out should be buffered and processed after up-to-date
      {:ok, _request} =
        Client.Mock.response(client,
          status: 200,
          schema: %{id: %{type: "int8"}, name: %{type: "text"}},
          last_offset: Client.Offset.new(0, 0),
          shape_handle: "shape-1",
          body: [
            change_with_tags(
              key: "row1",
              value: %{id: "1", name: "Item 1"},
              tags: ["hash1|value1"]
            ),
            # Move-out arrives before up-to-date (during initial sync)
            move_out_event([%{pos: 0, value: "hash1"}]),
            up_to_date_msg()
          ]
        )

      events =
        receive do
          {:events, events} -> events
        after
          5000 -> flunk("Timeout waiting for events")
        end

      # The synthetic delete should appear BEFORE up-to-date because
      # buffered move-outs are processed when up-to-date is received
      assert [
               %ChangeMessage{key: "row1", headers: %Headers{operation: :insert}},
               # Synthetic delete from buffered move-out, processed before up-to-date emitted
               %ChangeMessage{key: "row1", headers: %Headers{operation: :delete}},
               up_to_date()
             ] = events
    end
  end

  describe "message parsing" do
    test "parses move-out event message" do
      msg = %{
        "headers" => %{
          "event" => "move-out",
          "patterns" => [
            %{"pos" => 0, "value" => "abc123"},
            %{"pos" => 1, "value" => "def456"}
          ]
        }
      }

      [parsed] = Electric.Client.Message.parse(msg, "shape-1", & &1)

      assert %EventMessage{
               event: :move_out,
               patterns: [
                 %{pos: 0, value: "abc123"},
                 %{pos: 1, value: "def456"}
               ],
               handle: "shape-1"
             } = parsed
    end

    test "parses change message with tags" do
      msg = %{
        "headers" => %{
          "operation" => "insert",
          "tags" => ["abc|123", "def|456"],
          "removed_tags" => ["old|tag"]
        },
        "key" => "pk-1",
        "value" => %{"id" => "1"}
      }

      [parsed] = Electric.Client.Message.parse(msg, "shape-1", & &1)

      assert %ChangeMessage{
               key: "pk-1",
               headers: %Headers{
                 operation: :insert,
                 tags: ["abc|123", "def|456"],
                 removed_tags: ["old|tag"]
               }
             } = parsed
    end

    test "parses snapshot-end control message" do
      msg = %{
        "headers" => %{
          "control" => "snapshot-end",
          "xmin" => 100,
          "xmax" => 200,
          "xip_list" => [150, 175]
        }
      }

      [parsed] = Electric.Client.Message.parse(msg, "shape-1", & &1)

      assert %ControlMessage{
               control: :snapshot_end,
               xmin: 100,
               xmax: 200,
               xip_list: [150, 175]
             } = parsed
    end
  end

  describe "stream state management" do
    test "resets move state on must-refetch" do
      {:ok, client} = Client.Mock.new()
      parent = self()

      {:ok, _} =
        start_supervised(
          {Task,
           fn ->
             events =
               Client.stream(client, "items")
               |> Enum.take(5)

             send(parent, {:events, events})
           end}
        )

      # First response with tags
      {:ok, _request} =
        Client.Mock.response(client,
          status: 200,
          schema: %{id: %{type: "int8"}, name: %{type: "text"}},
          last_offset: Client.Offset.new(0, 0),
          shape_handle: "shape-1",
          body: [
            change_with_tags(
              key: "row1",
              value: %{id: "1", name: "Item 1"},
              tags: ["hash1|value1"]
            ),
            up_to_date_msg()
          ]
        )

      # Second response triggers must-refetch
      {:ok, _request} =
        Client.Mock.response(client,
          status: 409,
          shape_handle: "shape-2",
          body: [
            %{"headers" => %{"control" => "must-refetch"}}
          ]
        )

      # Third response with fresh data
      {:ok, _request} =
        Client.Mock.response(client,
          status: 200,
          schema: %{id: %{type: "int8"}, name: %{type: "text"}},
          last_offset: Client.Offset.new(0, 0),
          shape_handle: "shape-2",
          body: [
            change_with_tags(
              key: "row1",
              value: %{id: "1", name: "Fresh Item"},
              tags: ["newhash|newvalue"]
            ),
            up_to_date_msg()
          ]
        )

      events =
        receive do
          {:events, events} -> events
        after
          5000 -> flunk("Timeout waiting for events")
        end

      # Verify the stream restarted with fresh data
      assert [
               %ChangeMessage{value: %{"name" => "Item 1"}},
               up_to_date(),
               %ControlMessage{control: :must_refetch},
               %ChangeMessage{value: %{"name" => "Fresh Item"}},
               up_to_date()
             ] = events
    end
  end

  # Helper functions

  defp change_with_tags(opts) do
    key = Keyword.get(opts, :key, "pk")
    value = Keyword.get(opts, :value, %{})
    operation = Keyword.get(opts, :operation, :insert)
    tags = Keyword.get(opts, :tags, [])
    removed_tags = Keyword.get(opts, :removed_tags, [])

    %{
      "key" => key,
      "headers" => %{
        "operation" => to_string(operation),
        "tags" => tags,
        "removed_tags" => removed_tags
      },
      "value" => stringify_keys(value)
    }
  end

  defp move_out_event(patterns) do
    %{
      "headers" => %{
        "event" => "move-out",
        "patterns" => Enum.map(patterns, &stringify_keys/1)
      }
    }
  end

  defp up_to_date_msg(lsn \\ 1234) do
    %{"headers" => %{"control" => "up-to-date", "global_last_seen_lsn" => lsn}}
  end

  defp stringify_keys(map) when is_map(map) do
    Map.new(map, fn {k, v} -> {to_string(k), v} end)
  end
end
