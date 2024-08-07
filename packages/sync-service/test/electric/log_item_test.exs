defmodule Electric.LogItemsTest do
  use ExUnit.Case, async: true
  alias Electric.LogItems
  alias Electric.Replication.LogOffset
  alias Electric.Replication.Changes

  describe "from_change/3" do
    test "stores an entire `NewRecord` value" do
      record = %Changes.NewRecord{
        key: "my_key",
        record: %{"pk" => "10", "hello" => "world"},
        log_offset: LogOffset.first(),
        relation: {"public", "test"}
      }

      assert LogItems.from_change(record, 1, ["pk"]) ==
               [
                 %{
                   offset: LogOffset.new(0, 0),
                   value: %{"hello" => "world", "pk" => "10"},
                   key: "my_key",
                   headers: %{relation: ["public", "test"], action: :insert, txid: 1}
                 }
               ]

      # And with empty PK
      assert LogItems.from_change(record, 1, []) ==
               [
                 %{
                   offset: LogOffset.new(0, 0),
                   value: %{"hello" => "world", "pk" => "10"},
                   key: "my_key",
                   headers: %{relation: ["public", "test"], action: :insert, txid: 1}
                 }
               ]
    end

    test "stores only PK of a `DeletedRecord` value" do
      record = %Changes.DeletedRecord{
        key: "my_key",
        old_record: %{"pk" => "10", "hello" => "world"},
        log_offset: LogOffset.first(),
        relation: {"public", "test"}
      }

      assert LogItems.from_change(record, 1, ["pk"]) ==
               [
                 %{
                   offset: LogOffset.new(0, 0),
                   value: %{"pk" => "10"},
                   key: "my_key",
                   headers: %{relation: ["public", "test"], action: :delete, txid: 1}
                 }
               ]
    end

    test "stores entire `DeletedRecord` value if table has no PK" do
      record = %Changes.DeletedRecord{
        key: "my_key",
        old_record: %{"value" => "10", "hello" => "world"},
        log_offset: LogOffset.first(),
        relation: {"public", "test"}
      }

      assert LogItems.from_change(record, 1, []) ==
               [
                 %{
                   offset: LogOffset.new(0, 0),
                   value: %{"hello" => "world", "value" => "10"},
                   key: "my_key",
                   headers: %{relation: ["public", "test"], action: :delete, txid: 1}
                 }
               ]
    end

    test "stores any changed columns and PK of an `UpdatedRecord` value" do
      record =
        Changes.UpdatedRecord.new(%{
          key: "my_key",
          old_record: %{"pk" => "10", "hello" => "world", "test" => "me"},
          record: %{"pk" => "10", "hello" => "world", "test" => "new"},
          log_offset: LogOffset.first(),
          relation: {"public", "test"}
        })

      assert LogItems.from_change(record, 1, ["pk"]) ==
               [
                 %{
                   offset: LogOffset.new(0, 0),
                   value: %{"pk" => "10", "test" => "new"},
                   key: "my_key",
                   headers: %{relation: ["public", "test"], action: :update, txid: 1}
                 }
               ]
    end

    test "splits up the `UpdatedRecord` if a key was changed, adding a reference to both" do
      record =
        Changes.UpdatedRecord.new(%{
          old_key: "old_key",
          key: "new_key",
          old_record: %{"pk" => "9", "hello" => "world", "test" => "me"},
          record: %{"pk" => "10", "hello" => "world", "test" => "new"},
          log_offset: LogOffset.first(),
          relation: {"public", "test"}
        })

      assert LogItems.from_change(record, 1, ["pk"]) ==
               [
                 %{
                   offset: LogOffset.new(0, 0),
                   value: %{"pk" => "9"},
                   key: "old_key",
                   headers: %{
                     relation: ["public", "test"],
                     action: :delete,
                     txid: 1,
                     key_change_to: "new_key"
                   }
                 },
                 %{
                   offset: LogOffset.new(0, 1),
                   value: %{"hello" => "world", "pk" => "10", "test" => "new"},
                   key: "new_key",
                   headers: %{
                     relation: ["public", "test"],
                     action: :insert,
                     txid: 1,
                     key_change_from: "old_key"
                   }
                 }
               ]
    end

    test "splits up the `UpdatedRecord` if a key was changed, adding a reference to both when no PK is defined" do
      record =
        Changes.UpdatedRecord.new(%{
          old_key: "old_key",
          key: "new_key",
          old_record: %{"hello" => "world", "test" => "me"},
          record: %{"hello" => "world", "test" => "new"},
          log_offset: LogOffset.first(),
          relation: {"public", "test"}
        })

      assert LogItems.from_change(record, 1, []) ==
               [
                 %{
                   offset: LogOffset.new(0, 0),
                   value: %{"hello" => "world", "test" => "me"},
                   key: "old_key",
                   headers: %{
                     relation: ["public", "test"],
                     action: :delete,
                     txid: 1,
                     key_change_to: "new_key"
                   }
                 },
                 %{
                   offset: LogOffset.new(0, 1),
                   value: %{"hello" => "world", "test" => "new"},
                   key: "new_key",
                   headers: %{
                     relation: ["public", "test"],
                     action: :insert,
                     txid: 1,
                     key_change_from: "old_key"
                   }
                 }
               ]
    end
  end
end
