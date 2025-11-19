defmodule Electric.Replication.TransactionBuilderTest do
  use ExUnit.Case, async: true

  alias Electric.Postgres.Lsn
  alias Electric.Replication.TransactionBuilder

  alias Electric.Replication.Changes.{
    Begin,
    Commit,
    Transaction,
    Relation,
    Column,
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
    test "constructs a transaction from Begin, changes, and Commit" do
      operations =
        [%Begin{xid: @xid}] ++
          @changes ++
          [
            %Commit{
              lsn: @lsn,
              commit_timestamp: @commit_timestamp,
              transaction_size: 100
            }
          ]

      builder = TransactionBuilder.new()

      assert {[
                %Transaction{
                  xid: @xid,
                  lsn: @lsn,
                  commit_timestamp: @commit_timestamp,
                  changes: @changes
                }
              ], _builder} =
               TransactionBuilder.build(operations, builder)
    end

    test "does not emit anything until a full transaction is seen" do
      builder = TransactionBuilder.new()

      assert {[], builder} = TransactionBuilder.build([%Begin{xid: @xid}], builder)
      assert {[], builder} = TransactionBuilder.build(@changes, builder)

      assert {[
                %Transaction{
                  xid: @xid,
                  lsn: @lsn,
                  commit_timestamp: @commit_timestamp,
                  changes: @changes
                }
              ], _builder} =
               TransactionBuilder.build(
                 [
                   %Commit{
                     lsn: @lsn,
                     commit_timestamp: @commit_timestamp,
                     transaction_size: 100
                   }
                 ],
                 builder
               )
    end

    test "passes through relation messages" do
      relation = %Relation{
        id: 1,
        schema: "public",
        table: "users",
        columns: [%Column{name: "id", type_oid: 23}]
      }

      builder = TransactionBuilder.new()

      assert {[^relation], _} = TransactionBuilder.build([relation], builder)
    end

    test "builder handles relations mixed with transaction" do
      operations = [
        %Begin{xid: 456},
        %Relation{
          id: 1,
          schema: "public",
          table: "users",
          columns: [%Column{name: "id", type_oid: 23}]
        },
        %NewRecord{
          relation: {"public", "users"},
          record: %{"id" => "123"},
          log_offset: LogOffset.new(@lsn, 0)
        },
        %Commit{
          lsn: @lsn,
          commit_timestamp: ~U[2024-01-01 00:00:00Z],
          transaction_size: 100
        }
      ]

      assert {[%Relation{}, %Transaction{}], _} =
               TransactionBuilder.build(operations, TransactionBuilder.new())
    end
  end
end
