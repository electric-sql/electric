defmodule Electric.Replication.ChangesTest do
  use ExUnit.Case, async: true

  alias Electric.Replication.Changes.UpdatedRecord

  describe "UpdatedRecord.changed_columns" do
    test "is empty when old_record is nil" do
      changed_columns = MapSet.new([])

      assert %UpdatedRecord{changed_columns: ^changed_columns} =
               UpdatedRecord.new(old_record: nil, record: %{"this" => "that"})
    end

    test "captures column if new value != old value" do
      changed_columns = MapSet.new(["first"])

      assert %UpdatedRecord{changed_columns: ^changed_columns} =
               UpdatedRecord.new(
                 old_record: %{"first" => "first value", "second" => "second value"},
                 record: %{"first" => "updated first value", "second" => "second value"}
               )
    end

    test "captures column if old record does not have column value" do
      changed_columns = MapSet.new(["first", "second"])

      assert %UpdatedRecord{changed_columns: ^changed_columns} =
               UpdatedRecord.new(
                 old_record: %{"first" => "first value"},
                 record: %{"first" => "updated first value", "second" => "second value"}
               )
    end

    test "ignores column if new does not have value" do
      changed_columns = MapSet.new(["second"])

      assert %UpdatedRecord{changed_columns: ^changed_columns} =
               UpdatedRecord.new(
                 old_record: %{"first" => "first value", "second" => "second value"},
                 record: %{"second" => "second updated value"}
               )
    end
  end
end
