defmodule Electric.Replication.ChangesTest do
  use ExUnit.Case, async: true

  alias Electric.Replication.Changes.NewRecord
  alias Electric.Replication.Changes.UpdatedRecord
  alias Electric.Replication.Changes.DeletedRecord

  doctest Electric.Replication.Changes, import: true

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

  describe "Transaction.visible_in_snapshot?/2" do
    alias Electric.Replication.Changes.Transaction

    test "returns true when xid < xmin (completed before snapshot)" do
      txn = %Transaction{xid: 50, lsn: {0, 1}, changes: []}
      snapshot = {100, 200, []}

      assert Transaction.visible_in_snapshot?(txn, snapshot)
    end

    test "returns false when xid >= xmax (started after snapshot)" do
      txn = %Transaction{xid: 200, lsn: {0, 1}, changes: []}
      snapshot = {100, 200, []}

      refute Transaction.visible_in_snapshot?(txn, snapshot)
    end

    test "returns false when xid > xmax" do
      txn = %Transaction{xid: 250, lsn: {0, 1}, changes: []}
      snapshot = {100, 200, []}

      refute Transaction.visible_in_snapshot?(txn, snapshot)
    end

    test "returns true when xmin <= xid < xmax and not in xip_list" do
      txn = %Transaction{xid: 150, lsn: {0, 1}, changes: []}
      snapshot = {100, 200, [160, 170]}

      assert Transaction.visible_in_snapshot?(txn, snapshot)
    end

    test "returns false when xid is in xip_list (in-progress at snapshot time)" do
      txn = %Transaction{xid: 150, lsn: {0, 1}, changes: []}
      snapshot = {100, 200, [150, 160]}

      refute Transaction.visible_in_snapshot?(txn, snapshot)
    end

    test "returns true when xid equals xmin (boundary case)" do
      # xid == xmin means it was the oldest active transaction, but still visible
      # because xmin marks the lower bound of potentially in-progress transactions
      txn = %Transaction{xid: 100, lsn: {0, 1}, changes: []}
      snapshot = {100, 200, []}

      # xid < xmin is false, so we check xid < xmax and not in xip_list
      assert Transaction.visible_in_snapshot?(txn, snapshot)
    end

    test "accepts map form of snapshot" do
      txn = %Transaction{xid: 50, lsn: {0, 1}, changes: []}
      snapshot = %{xmin: 100, xmax: 200, xip_list: []}

      assert Transaction.visible_in_snapshot?(txn, snapshot)
    end

    test "works with raw xid instead of transaction struct" do
      snapshot = {100, 200, [150]}

      assert Transaction.visible_in_snapshot?(50, snapshot)
      assert Transaction.visible_in_snapshot?(160, snapshot)
      refute Transaction.visible_in_snapshot?(150, snapshot)
      refute Transaction.visible_in_snapshot?(200, snapshot)
    end
  end
end
