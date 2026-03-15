defmodule Electric.Replication.ChangesTest do
  use ExUnit.Case, async: true

  alias Electric.Replication.Changes.Commit
  alias Electric.Replication.Changes.NewRecord
  alias Electric.Replication.Changes.UpdatedRecord
  alias Electric.Replication.Changes.DeletedRecord

  doctest Electric.Replication.Changes, import: true

  describe "Commit.calculate_initial_receive_lag/2" do
    test "returns positive lag when commit timestamp is in the past" do
      commit_timestamp = ~U[2024-01-01 12:00:00.000Z]
      current_time = ~U[2024-01-01 12:00:00.500Z]

      lag = Commit.calculate_initial_receive_lag(commit_timestamp, current_time)

      assert lag == 500
    end

    test "returns zero when commit timestamp equals current time" do
      timestamp = ~U[2024-01-01 12:00:00.000Z]

      lag = Commit.calculate_initial_receive_lag(timestamp, timestamp)

      assert lag == 0
    end

    test "clamps to zero when commit timestamp is in the future (clock skew)" do
      commit_timestamp = ~U[2024-01-01 12:00:01.000Z]
      current_time = ~U[2024-01-01 12:00:00.000Z]

      lag = Commit.calculate_initial_receive_lag(commit_timestamp, current_time)

      assert lag == 0
    end
  end

  describe "Commit.calculate_final_receive_lag/2" do
    test "returns initial lag plus elapsed time in Electric" do
      received_at_mono = System.monotonic_time()
      initial_lag = 100
      elapsed_ms = 50

      commit = %Commit{
        commit_timestamp: ~U[2024-01-01 12:00:00.000Z],
        received_at_mono: received_at_mono,
        initial_receive_lag: initial_lag
      }

      current_mono =
        received_at_mono + System.convert_time_unit(elapsed_ms, :millisecond, :native)

      lag = Commit.calculate_final_receive_lag(commit, current_mono)

      assert lag == initial_lag + elapsed_ms
    end

    test "returns initial lag when no time has elapsed" do
      mono_time = System.monotonic_time()
      initial_lag = 250

      commit = %Commit{
        commit_timestamp: ~U[2024-01-01 12:00:00.000Z],
        received_at_mono: mono_time,
        initial_receive_lag: initial_lag
      }

      lag = Commit.calculate_final_receive_lag(commit, mono_time)

      assert lag == initial_lag
    end

    test "never returns negative values even with zero initial lag" do
      mono_time = System.monotonic_time()

      commit = %Commit{
        commit_timestamp: ~U[2024-01-01 12:00:00.000Z],
        received_at_mono: mono_time,
        initial_receive_lag: 0
      }

      lag = Commit.calculate_final_receive_lag(commit, mono_time)

      assert lag >= 0
    end
  end

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
