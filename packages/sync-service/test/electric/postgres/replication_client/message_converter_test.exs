defmodule Electric.Postgres.ReplicationClient.MessageConverterTest do
  use ExUnit.Case, async: true

  import ExUnit.CaptureLog

  alias Electric.Postgres.LogicalReplication.Messages, as: LR
  alias Electric.Postgres.Lsn
  alias Electric.Postgres.ReplicationClient.MessageConverter

  alias Electric.Replication.Changes.{
    Commit,
    Relation,
    Column,
    NewRecord,
    UpdatedRecord,
    DeletedRecord,
    TruncatedRelation,
    TransactionFragment
  }

  alias Electric.Replication.LogOffset

  @test_lsn Lsn.from_integer(123)
  @test_end_lsn Lsn.from_integer(456)

  @relation %LR.Relation{
    id: 1,
    namespace: "public",
    name: "users",
    replica_identity: :default,
    columns: [%LR.Relation.Column{name: "id", flags: [:key], type_oid: 23, type_modifier: -1}]
  }

  @max_batch_size 100

  setup do
    converter = MessageConverter.new(max_batch_size: @max_batch_size)

    {:ok, %Relation{}, converter} =
      MessageConverter.convert(@relation, converter)

    {:ok, converter: converter}
  end

  describe "convert/2" do
    test "returns Relation immediately when receiving a relation message", %{converter: converter} do
      new_relation = %LR.Relation{
        id: 2,
        namespace: "public",
        name: "posts",
        replica_identity: :default,
        columns: [
          %LR.Relation.Column{name: "id", flags: [:key], type_oid: 23, type_modifier: -1}
        ]
      }

      {:ok,
       %Relation{
         id: 2,
         schema: "public",
         table: "posts",
         columns: [%Column{name: "id", type_oid: 23}]
       }, _converter} = MessageConverter.convert(new_relation, converter)
    end

    test "logs information when receiving a generic message", %{converter: converter} do
      message = %LR.Message{prefix: "test", content: "hello world"}
      log = capture_log(fn -> MessageConverter.convert(message, converter) end)
      assert log =~ "Got a message from PG via logical replication"
    end

    test "skips origin & type messages", %{converter: converter} do
      origin = %LR.Origin{name: "another origin"}
      type = %LR.Type{name: "custom_type"}

      assert {:buffering, _converter} =
               MessageConverter.convert(origin, converter)

      assert {:buffering, _converter} = MessageConverter.convert(type, converter)
    end

    test "returns TransactionFragment once a whole transaction is seen", %{converter: converter} do
      {:buffering, converter} =
        MessageConverter.convert(
          %LR.Begin{final_lsn: @test_lsn, commit_timestamp: DateTime.utc_now(), xid: 456},
          converter
        )

      {:buffering, converter} =
        MessageConverter.convert(
          %LR.Insert{relation_id: 1, tuple_data: ["123"], bytes: 3},
          converter
        )

      assert {:ok,
              %TransactionFragment{
                xid: 456,
                lsn: @test_lsn,
                has_begin?: true,
                commit: %Commit{
                  commit_timestamp: ~U[2024-01-01 00:00:00Z],
                  transaction_size: 3,
                  txn_change_count: 1
                },
                changes: [
                  %NewRecord{
                    relation: {"public", "users"},
                    record: %{"id" => "123"},
                    log_offset: %LogOffset{tx_offset: 123, op_offset: 0}
                  }
                ],
                affected_relations: affected
              }, _converter} =
               MessageConverter.convert(
                 %LR.Commit{
                   lsn: @test_lsn,
                   end_lsn: @test_end_lsn,
                   commit_timestamp: ~U[2024-01-01 00:00:00Z]
                 },
                 converter
               )

      assert MapSet.equal?(affected, MapSet.new([{"public", "users"}]))
    end

    test "returns TransactionFragment with UpdatedRecord for update", %{converter: converter} do
      {:buffering, converter} =
        MessageConverter.convert(
          %LR.Begin{final_lsn: @test_lsn, commit_timestamp: DateTime.utc_now(), xid: 456},
          converter
        )

      {:buffering, converter} =
        MessageConverter.convert(
          %LR.Update{relation_id: 1, old_tuple_data: ["123"], tuple_data: ["124"], bytes: 6},
          converter
        )

      assert {:ok,
              %TransactionFragment{
                xid: 456,
                lsn: @test_lsn,
                has_begin?: true,
                commit: %Commit{
                  commit_timestamp: ~U[2024-01-01 00:00:00Z],
                  transaction_size: 6,
                  txn_change_count: 1
                },
                changes: [
                  %UpdatedRecord{
                    relation: {"public", "users"},
                    old_record: %{"id" => "123"},
                    record: %{"id" => "124"},
                    log_offset: %LogOffset{tx_offset: 123, op_offset: 0}
                  }
                ],
                affected_relations: affected
              }, _converter} =
               MessageConverter.convert(
                 %LR.Commit{
                   lsn: @test_lsn,
                   end_lsn: @test_end_lsn,
                   commit_timestamp: ~U[2024-01-01 00:00:00Z]
                 },
                 converter
               )

      assert MapSet.equal?(affected, MapSet.new([{"public", "users"}]))
    end

    test "errors for empty old data on updates", %{converter: converter} do
      {:buffering, converter} =
        MessageConverter.convert(
          %LR.Begin{final_lsn: @test_lsn, commit_timestamp: DateTime.utc_now(), xid: 456},
          converter
        )

      assert {:error, {:replica_not_full, message}} =
               MessageConverter.convert(
                 %LR.Update{relation_id: 1, old_tuple_data: nil, tuple_data: ["124"], bytes: 3},
                 converter
               )

      assert message =~
               "Received an update from PG for public.users that did not have " <>
                 "old data included in the message."

      assert message =~ "Try executing `ALTER TABLE public.users REPLICA IDENTITY FULL`"
    end

    test "returns TransactionFragment with DeletedRecord for delete", %{converter: converter} do
      {:buffering, converter} =
        MessageConverter.convert(
          %LR.Begin{final_lsn: @test_lsn, commit_timestamp: DateTime.utc_now(), xid: 456},
          converter
        )

      {:buffering, converter} =
        MessageConverter.convert(
          %LR.Delete{relation_id: 1, old_tuple_data: ["123"], bytes: 3},
          converter
        )

      assert {:ok,
              %TransactionFragment{
                xid: 456,
                lsn: @test_lsn,
                has_begin?: true,
                commit: %Commit{
                  commit_timestamp: ~U[2024-01-01 00:00:00Z],
                  transaction_size: 3,
                  txn_change_count: 1
                },
                changes: [
                  %DeletedRecord{
                    relation: {"public", "users"},
                    old_record: %{"id" => "123"},
                    log_offset: %LogOffset{tx_offset: 123, op_offset: 0}
                  }
                ],
                affected_relations: affected
              }, _converter} =
               MessageConverter.convert(
                 %LR.Commit{
                   lsn: @test_lsn,
                   end_lsn: @test_end_lsn,
                   commit_timestamp: ~U[2024-01-01 00:00:00Z]
                 },
                 converter
               )

      assert MapSet.equal?(affected, MapSet.new([{"public", "users"}]))
    end

    test "returns TransactionFragment with TruncatedRelation for truncate", %{
      converter: converter
    } do
      {:buffering, converter} =
        MessageConverter.convert(
          %LR.Begin{final_lsn: @test_lsn, commit_timestamp: DateTime.utc_now(), xid: 456},
          converter
        )

      {:buffering, converter} =
        MessageConverter.convert(
          %LR.Truncate{number_of_relations: 1, options: [], truncated_relations: [1]},
          converter
        )

      assert {:ok,
              %TransactionFragment{
                xid: 456,
                lsn: @test_lsn,
                has_begin?: true,
                commit: %Commit{commit_timestamp: ~U[2024-01-01 00:00:00Z]},
                changes: [
                  %TruncatedRelation{
                    relation: {"public", "users"},
                    log_offset: %LogOffset{tx_offset: 123, op_offset: 0}
                  }
                ],
                affected_relations: affected
              }, _converter} =
               MessageConverter.convert(
                 %LR.Commit{
                   lsn: @test_lsn,
                   end_lsn: @test_end_lsn,
                   commit_timestamp: ~U[2024-01-01 00:00:00Z]
                 },
                 converter
               )

      assert MapSet.equal?(affected, MapSet.new([{"public", "users"}]))
    end

    test "returns TransactionFragment with multiple TruncatedRelations", %{converter: converter} do
      new_relation = %LR.Relation{
        id: 2,
        namespace: "public",
        name: "posts",
        replica_identity: :default,
        columns: [
          %LR.Relation.Column{name: "id", flags: [:key], type_oid: 23, type_modifier: -1}
        ]
      }

      {:ok, %Relation{}, converter} =
        MessageConverter.convert(new_relation, converter)

      {:buffering, converter} =
        MessageConverter.convert(
          %LR.Begin{final_lsn: @test_lsn, commit_timestamp: DateTime.utc_now(), xid: 456},
          converter
        )

      {:buffering, converter} =
        MessageConverter.convert(
          %LR.Truncate{number_of_relations: 2, options: [], truncated_relations: [1, 2]},
          converter
        )

      assert {:ok,
              %TransactionFragment{
                xid: 456,
                lsn: @test_lsn,
                has_begin?: true,
                commit: %Commit{commit_timestamp: ~U[2024-01-01 00:00:00Z]},
                changes: [
                  %TruncatedRelation{
                    relation: {"public", "users"},
                    log_offset: %LogOffset{tx_offset: 123, op_offset: 0}
                  },
                  %TruncatedRelation{
                    relation: {"public", "posts"},
                    log_offset: %LogOffset{tx_offset: 123, op_offset: 2}
                  }
                ],
                affected_relations: affected
              }, _converter} =
               MessageConverter.convert(
                 %LR.Commit{
                   lsn: @test_lsn,
                   end_lsn: @test_end_lsn,
                   commit_timestamp: ~U[2024-01-01 00:00:00Z]
                 },
                 converter
               )

      assert MapSet.equal?(affected, MapSet.new([{"public", "users"}, {"public", "posts"}]))
    end

    test "multiple converted changes maintain correct log offsets", %{converter: converter} do
      {:buffering, converter} =
        MessageConverter.convert(
          %LR.Begin{final_lsn: @test_lsn, commit_timestamp: DateTime.utc_now(), xid: 456},
          converter
        )

      {:buffering, converter} =
        MessageConverter.convert(
          %LR.Insert{relation_id: 1, tuple_data: ["123"], bytes: 3},
          converter
        )

      {:buffering, converter} =
        MessageConverter.convert(
          %LR.Update{relation_id: 1, old_tuple_data: ["123"], tuple_data: ["124"], bytes: 6},
          converter
        )

      {:buffering, converter} =
        MessageConverter.convert(
          %LR.Delete{relation_id: 1, old_tuple_data: ["124"], bytes: 3},
          converter
        )

      assert {:ok,
              %TransactionFragment{
                xid: 456,
                has_begin?: true,
                commit: %Commit{},
                changes: [
                  %NewRecord{
                    relation: {"public", "users"},
                    record: %{"id" => "123"},
                    log_offset: %LogOffset{tx_offset: 123, op_offset: 0}
                  },
                  %UpdatedRecord{
                    relation: {"public", "users"},
                    old_record: %{"id" => "123"},
                    record: %{"id" => "124"},
                    log_offset: %LogOffset{tx_offset: 123, op_offset: 2}
                  },
                  %DeletedRecord{
                    relation: {"public", "users"},
                    old_record: %{"id" => "124"},
                    log_offset: %LogOffset{tx_offset: 123, op_offset: 4}
                  }
                ]
              }, _converter} =
               MessageConverter.convert(
                 %LR.Commit{
                   lsn: @test_lsn,
                   end_lsn: @test_end_lsn,
                   commit_timestamp: ~U[2024-01-01 00:00:00Z]
                 },
                 converter
               )
    end

    test "returns error when transaction size exceeds max_tx_size limit" do
      converter = MessageConverter.new(max_tx_size: 10, max_batch_size: @max_batch_size)

      {:ok, %Relation{}, converter} =
        MessageConverter.convert(@relation, converter)

      {:buffering, converter} =
        MessageConverter.convert(
          %LR.Begin{final_lsn: @test_lsn, commit_timestamp: DateTime.utc_now(), xid: 456},
          converter
        )

      # First insert is under the limit
      {:buffering, converter} =
        MessageConverter.convert(
          %LR.Insert{relation_id: 1, tuple_data: ["123"], bytes: 5},
          converter
        )

      # Second insert exceeds the limit (5 + 10 = 15 > 10)
      assert {:error, {:exceeded_max_tx_size, message}} =
               MessageConverter.convert(
                 %LR.Insert{relation_id: 1, tuple_data: ["456"], bytes: 10},
                 converter
               )

      assert message == "Collected transaction exceeds limit of 10 bytes."
    end

    test "replaces :unchanged_toast with actual values from old_data in updates" do
      multi_col_relation = %LR.Relation{
        id: 2,
        namespace: "public",
        name: "posts",
        replica_identity: :full,
        columns: [
          %LR.Relation.Column{name: "id", flags: [:key], type_oid: 23, type_modifier: -1},
          %LR.Relation.Column{name: "title", flags: [], type_oid: 25, type_modifier: -1},
          %LR.Relation.Column{name: "content", flags: [], type_oid: 25, type_modifier: -1}
        ]
      }

      converter = MessageConverter.new(max_batch_size: @max_batch_size)

      {:ok, %Relation{}, converter} =
        MessageConverter.convert(multi_col_relation, converter)

      {:buffering, converter} =
        MessageConverter.convert(
          %LR.Begin{final_lsn: @test_lsn, commit_timestamp: DateTime.utc_now(), xid: 456},
          converter
        )

      {:buffering, converter} =
        MessageConverter.convert(
          %LR.Update{
            relation_id: 2,
            old_tuple_data: ["1", "Old Title", "Long content that was toasted"],
            tuple_data: ["1", "New Title", :unchanged_toast],
            bytes: 10
          },
          converter
        )

      assert {:ok,
              %TransactionFragment{
                xid: 456,
                has_begin?: true,
                commit: %Commit{},
                changes: [
                  %UpdatedRecord{
                    relation: {"public", "posts"},
                    old_record: %{
                      "id" => "1",
                      "title" => "Old Title",
                      "content" => "Long content that was toasted"
                    },
                    record: %{
                      "id" => "1",
                      "title" => "New Title",
                      "content" => "Long content that was toasted"
                    }
                  }
                ]
              }, _converter} =
               MessageConverter.convert(
                 %LR.Commit{
                   lsn: @test_lsn,
                   end_lsn: @test_end_lsn,
                   commit_timestamp: ~U[2024-01-01 00:00:00Z]
                 },
                 converter
               )
    end

    test "flushes batch when max_batch_size is reached mid-transaction", %{converter: _converter} do
      converter = MessageConverter.new(max_batch_size: 3)
      {:ok, %Relation{}, converter} = MessageConverter.convert(@relation, converter)

      {:buffering, converter} =
        MessageConverter.convert(
          %LR.Begin{final_lsn: @test_lsn, commit_timestamp: DateTime.utc_now(), xid: 456},
          converter
        )

      insert_msg = %LR.Insert{relation_id: 1, tuple_data: ["123"], bytes: 3}

      {:buffering, converter} = MessageConverter.convert(insert_msg, converter)
      {:buffering, converter} = MessageConverter.convert(insert_msg, converter)

      # Third change triggers flush (3 inserts = max_batch_size)
      assert {:ok,
              %TransactionFragment{
                xid: 456,
                lsn: @test_lsn,
                last_log_offset: %LogOffset{tx_offset: 123, op_offset: 4},
                has_begin?: true,
                commit: nil,
                changes: [%NewRecord{}, %NewRecord{}, %NewRecord{}],
                affected_relations: affected
              }, converter} = MessageConverter.convert(insert_msg, converter)

      assert MapSet.equal?(affected, MapSet.new([{"public", "users"}]))

      # Subsequent operations continue to buffer
      {:buffering, converter} = MessageConverter.convert(insert_msg, converter)

      # Until commit
      assert {:ok,
              %TransactionFragment{
                xid: 456,
                lsn: @test_lsn,
                last_log_offset: %LogOffset{tx_offset: 123, op_offset: 6},
                has_begin?: false,
                commit: %Commit{},
                changes: [%NewRecord{}]
              }, _converter} =
               MessageConverter.convert(
                 %LR.Commit{
                   lsn: @test_lsn,
                   end_lsn: @test_end_lsn,
                   commit_timestamp: ~U[2024-01-01 00:00:00Z]
                 },
                 converter
               )
    end

    test "maintains correct log offsets across batches", %{converter: _converter} do
      converter = MessageConverter.new(max_batch_size: 3)
      {:ok, %Relation{}, converter} = MessageConverter.convert(@relation, converter)

      {:buffering, converter} =
        MessageConverter.convert(
          %LR.Begin{final_lsn: @test_lsn, commit_timestamp: DateTime.utc_now(), xid: 456},
          converter
        )

      insert_msg = %LR.Insert{relation_id: 1, tuple_data: ["123"], bytes: 3}

      {:buffering, converter} = MessageConverter.convert(insert_msg, converter)
      {:buffering, converter} = MessageConverter.convert(insert_msg, converter)

      # First batch flushes (3 changes = max_batch_size)
      assert {:ok,
              %TransactionFragment{
                xid: 456,
                has_begin?: true,
                commit: nil,
                changes: [
                  %NewRecord{log_offset: %LogOffset{tx_offset: 123, op_offset: 0}},
                  %NewRecord{log_offset: %LogOffset{tx_offset: 123, op_offset: 2}},
                  %NewRecord{log_offset: %LogOffset{tx_offset: 123, op_offset: 4}}
                ]
              }, converter} = MessageConverter.convert(insert_msg, converter)

      # Second batch continues with correct offsets
      {:buffering, converter} = MessageConverter.convert(insert_msg, converter)

      assert {:ok,
              %TransactionFragment{
                xid: 456,
                has_begin?: false,
                commit: %Commit{},
                changes: [
                  %NewRecord{log_offset: %LogOffset{tx_offset: 123, op_offset: 6}}
                ]
              }, _converter} =
               MessageConverter.convert(
                 %LR.Commit{
                   lsn: @test_lsn,
                   end_lsn: @test_end_lsn,
                   commit_timestamp: ~U[2024-01-01 00:00:00Z]
                 },
                 converter
               )
    end

    test "returns Relation immediately without flushing buffered operations", %{
      converter: converter
    } do
      {:buffering, converter} =
        MessageConverter.convert(
          %LR.Begin{final_lsn: @test_lsn, commit_timestamp: DateTime.utc_now(), xid: 456},
          converter
        )

      {:buffering, converter} =
        MessageConverter.convert(
          %LR.Insert{relation_id: 1, tuple_data: ["123"], bytes: 3},
          converter
        )

      # Relation is returned immediately
      new_relation = %LR.Relation{
        id: 2,
        namespace: "public",
        name: "posts",
        replica_identity: :default,
        columns: [%LR.Relation.Column{name: "id", flags: [:key], type_oid: 23, type_modifier: -1}]
      }

      assert {:ok, %Relation{id: 2, schema: "public", table: "posts"}, converter} =
               MessageConverter.convert(new_relation, converter)

      # Buffered operations still flush on commit
      assert {:ok,
              %TransactionFragment{
                xid: 456,
                has_begin?: true,
                commit: %Commit{},
                changes: [%NewRecord{}]
              }, _converter} =
               MessageConverter.convert(
                 %LR.Commit{
                   lsn: @test_lsn,
                   end_lsn: @test_end_lsn,
                   commit_timestamp: ~U[2024-01-01 00:00:00Z]
                 },
                 converter
               )
    end

    test "returns TransactionFragment with valid last_log_offset for empty transaction", %{
      converter: converter
    } do
      {:buffering, converter} =
        MessageConverter.convert(
          %LR.Begin{final_lsn: @test_lsn, commit_timestamp: DateTime.utc_now(), xid: 456},
          converter
        )

      # Commit without any changes
      assert {:ok,
              %TransactionFragment{
                xid: 456,
                lsn: @test_lsn,
                has_begin?: true,
                commit: %Commit{
                  commit_timestamp: ~U[2024-01-01 00:00:00Z],
                  transaction_size: 0,
                  txn_change_count: 0
                },
                changes: [],
                last_log_offset: %LogOffset{tx_offset: 123, op_offset: 0},
                affected_relations: affected
              }, _converter} =
               MessageConverter.convert(
                 %LR.Commit{
                   lsn: @test_lsn,
                   end_lsn: @test_end_lsn,
                   commit_timestamp: ~U[2024-01-01 00:00:00Z]
                 },
                 converter
               )

      assert MapSet.equal?(affected, MapSet.new([]))
    end
  end
end
