defmodule Electric.Replication.TransactionBuilderTest do
  use ExUnit.Case, async: true

  alias Electric.Postgres.Lsn
  alias Electric.Replication.TransactionBuilder

  alias Electric.Replication.Changes.{
    Commit,
    Transaction,
    TransactionFragment,
    NewRecord,
    UpdatedRecord,
    DeletedRecord,
    TruncatedRelation
  }

  alias Electric.Replication.LogOffset

  @lsn Lsn.from_integer(123)
  @xid 456
  @commit_timestamp ~U[2024-01-01 00:00:00Z]
  @changes [
    %NewRecord{
      relation: {"public", "users"},
      record: %{"id" => "123"},
      log_offset: LogOffset.new(@lsn, 0)
    },
    %UpdatedRecord{
      relation: {"public", "users"},
      old_record: %{"id" => "123"},
      record: %{"id" => "124"},
      log_offset: LogOffset.new(@lsn, 2)
    },
    %DeletedRecord{
      relation: {"public", "users"},
      old_record: %{"id" => "124"},
      log_offset: LogOffset.new(@lsn, 4)
    },
    %TruncatedRelation{
      relation: {"public", "profiles"},
      log_offset: LogOffset.new(@lsn, 6)
    }
  ]

  describe "build/2" do
    test "constructs a transaction from a complete TransactionFragment" do
      fragment = %TransactionFragment{
        xid: @xid,
        lsn: @lsn,
        has_begin?: true,
        commit: %Commit{
          commit_timestamp: @commit_timestamp,
          transaction_size: 100
        },
        changes: @changes
      }

      builder = TransactionBuilder.new()

      assert {[
                %Transaction{
                  xid: @xid,
                  lsn: @lsn,
                  commit_timestamp: @commit_timestamp,
                  changes: @changes
                }
              ], _builder} =
               TransactionBuilder.build(fragment, builder)
    end

    test "does not emit anything until a complete transaction is seen" do
      builder = TransactionBuilder.new()

      # First fragment with begin and some changes
      fragment1 = %TransactionFragment{
        xid: @xid,
        lsn: @lsn,
        has_begin?: true,
        changes: @changes
      }

      assert {[], builder} = TransactionBuilder.build(fragment1, builder)

      # Second fragment with commit
      fragment2 = %TransactionFragment{
        xid: @xid,
        lsn: @lsn,
        has_begin?: false,
        commit: %Commit{
          commit_timestamp: @commit_timestamp,
          transaction_size: 100
        },
        changes: []
      }

      assert {[
                %Transaction{
                  xid: @xid,
                  lsn: @lsn,
                  commit_timestamp: @commit_timestamp,
                  changes: @changes
                }
              ], _builder} =
               TransactionBuilder.build(fragment2, builder)
    end

    test "handles multi-batch transactions with changes spread across fragments" do
      builder = TransactionBuilder.new()

      # First fragment with begin and first two changes
      changes_part1 = Enum.take(@changes, 2)

      fragment1 = %TransactionFragment{
        xid: @xid,
        lsn: @lsn,
        has_begin?: true,
        changes: changes_part1
      }

      assert {[], builder} = TransactionBuilder.build(fragment1, builder)

      # Second fragment with remaining changes
      changes_part2 = Enum.drop(@changes, 2)

      fragment2 = %TransactionFragment{
        xid: @xid,
        lsn: @lsn,
        has_begin?: false,
        changes: changes_part2
      }

      assert {[], builder} = TransactionBuilder.build(fragment2, builder)

      # Final fragment with commit
      fragment3 = %TransactionFragment{
        xid: @xid,
        lsn: @lsn,
        has_begin?: false,
        commit: %Commit{
          commit_timestamp: @commit_timestamp,
          transaction_size: 100
        },
        changes: []
      }

      assert {[
                %Transaction{
                  xid: @xid,
                  lsn: @lsn,
                  commit_timestamp: @commit_timestamp,
                  changes: @changes
                }
              ], _builder} =
               TransactionBuilder.build(fragment3, builder)
    end

    test "transaction state is reset after complete transaction" do
      builder = TransactionBuilder.new()

      # First complete transaction
      fragment1 = %TransactionFragment{
        xid: @xid,
        lsn: @lsn,
        has_begin?: true,
        commit: %Commit{
          commit_timestamp: @commit_timestamp,
          transaction_size: 100
        },
        changes: @changes
      }

      assert {[%Transaction{xid: @xid}], builder} = TransactionBuilder.build(fragment1, builder)

      # Second transaction
      lsn2 = Lsn.from_integer(456)

      fragment2 = %TransactionFragment{
        xid: 789,
        lsn: lsn2,
        has_begin?: true,
        commit: %Commit{
          commit_timestamp: ~U[2024-01-02 00:00:00Z],
          transaction_size: 50
        },
        changes: [%NewRecord{relation: {"public", "users"}, record: %{"id" => "999"}}]
      }

      assert {[%Transaction{xid: 789, lsn: ^lsn2}], _builder} =
               TransactionBuilder.build(fragment2, builder)
    end
  end
end
