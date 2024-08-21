defmodule Electric.Postgres.ReplicationClient.CollectorTest do
  use ExUnit.Case, async: true

  import ExUnit.CaptureLog

  alias Electric.Postgres.LogicalReplication.Messages, as: LR
  alias Electric.Postgres.Lsn
  alias Electric.Postgres.ReplicationClient.Collector

  alias Electric.Replication.Changes.{
    Transaction,
    NewRecord,
    UpdatedRecord,
    DeletedRecord,
    TruncatedRelation
  }

  alias Electric.Replication.LogOffset

  @test_lsn Lsn.from_integer(123)
  @test_log_offset LogOffset.new(@test_lsn, 0)
  @test_end_lsn Lsn.from_integer(456)

  @relation %LR.Relation{
    id: 1,
    namespace: "public",
    name: "users",
    replica_identity: :default,
    columns: [%LR.Relation.Column{name: "id", flags: [:key], type_oid: 23, type_modifier: -1}]
  }

  setup do
    collector = %Collector{}
    {_relation, collector} = Collector.handle_message(@relation, collector)
    {:ok, collector: collector}
  end

  test "collector correctly starts a transaction when seeing a 'Begin' message", %{
    collector: collector
  } do
    begin_msg = %LR.Begin{
      final_lsn: @test_lsn,
      commit_timestamp: DateTime.utc_now(),
      xid: 456
    }

    updated_collector = Collector.handle_message(begin_msg, collector)

    assert %Collector{transaction: %Transaction{xid: 456, lsn: @test_lsn}} = updated_collector
  end

  test "collector stores received relation message", %{collector: collector} do
    new_relation = %LR.Relation{
      id: 2,
      namespace: "public",
      name: "posts",
      replica_identity: :default,
      columns: [%LR.Relation.Column{name: "id", flags: [:key], type_oid: 23, type_modifier: -1}]
    }

    {_rel, updated_collector} = Collector.handle_message(new_relation, collector)

    assert %Collector{relations: %{1 => @relation, 2 => ^new_relation}} = updated_collector
  end

  # TODO: move this test to the shape log collector tests
  # test "collector logs a warning when receiving a new relation message that doesn't match the previous one",
  #     %{collector: collector} do
  #  new_relation = %{
  #    @relation
  #    | columns: [%LR.Relation.Column{name: "id", flags: [:key], type_oid: 20, type_modifier: -1}]
  #  }
  #
  #  log = capture_log(fn -> Collector.handle_message(new_relation, collector) end)
  #  assert log =~ "Schema for the table public.users had changed"
  # end

  test "collector logs information when receiving a generic message",
       %{collector: collector} do
    message = %LR.Message{prefix: "test", content: "hello world"}
    log = capture_log(fn -> Collector.handle_message(message, collector) end)
    assert log =~ "Got a message from PG via logical replication"
  end

  test "collector does nothing on origin & type messages",
       %{collector: collector} do
    origin = %LR.Origin{name: "another origin"}
    type = %LR.Type{name: "custom_type"}

    assert collector == Collector.handle_message(origin, collector)
    assert collector == Collector.handle_message(type, collector)
  end

  test "collector stores received insert when the relation is known", %{collector: collector} do
    collector =
      Collector.handle_message(
        %LR.Begin{final_lsn: @test_lsn, commit_timestamp: DateTime.utc_now(), xid: 456},
        collector
      )

    insert_msg = %LR.Insert{
      relation_id: 1,
      tuple_data: ["123"]
    }

    updated_collector = Collector.handle_message(insert_msg, collector)

    assert %Collector{
             transaction: %Transaction{
               changes: [%NewRecord{relation: {"public", "users"}, record: %{"id" => "123"}}]
             }
           } = updated_collector
  end

  test "collector stores received update when the relation is known", %{collector: collector} do
    collector =
      Collector.handle_message(
        %LR.Begin{final_lsn: @test_lsn, commit_timestamp: DateTime.utc_now(), xid: 456},
        collector
      )

    update_msg = %LR.Update{
      relation_id: 1,
      old_tuple_data: ["123"],
      tuple_data: ["124"]
    }

    updated_collector = Collector.handle_message(update_msg, collector)

    assert %Collector{
             transaction: %Transaction{
               changes: [
                 %UpdatedRecord{
                   relation: {"public", "users"},
                   old_record: %{"id" => "123"},
                   record: %{"id" => "124"}
                 }
               ]
             }
           } = updated_collector
  end

  test "collector logs an error for empty old data on updates", %{collector: collector} do
    collector =
      Collector.handle_message(
        %LR.Begin{final_lsn: @test_lsn, commit_timestamp: DateTime.utc_now(), xid: 456},
        collector
      )

    update_msg = %LR.Update{
      relation_id: 1,
      old_tuple_data: nil,
      tuple_data: ["124"]
    }

    log =
      capture_log(fn ->
        updated_collector = Collector.handle_message(update_msg, collector)
        send(self(), updated_collector)
      end)

    assert_received %Collector{
      transaction: %Transaction{
        changes: [
          %UpdatedRecord{
            relation: {"public", "users"},
            old_record: %{},
            record: %{"id" => "124"}
          }
        ]
      }
    }

    assert log =~
             "[error] Received an update from PG for public.users that did not have " <>
               "old data included in the message."

    assert log =~ "Try executing `ALTER TABLE public.users REPLICA IDENTITY FULL`"
  end

  test "collector stores received delete when the relation is known", %{collector: collector} do
    collector =
      Collector.handle_message(
        %LR.Begin{final_lsn: @test_lsn, commit_timestamp: DateTime.utc_now(), xid: 456},
        collector
      )

    delete_msg = %LR.Delete{
      relation_id: 1,
      old_tuple_data: ["123"]
    }

    updated_collector = Collector.handle_message(delete_msg, collector)

    assert %Collector{
             transaction: %Transaction{
               changes: [
                 %DeletedRecord{relation: {"public", "users"}, old_record: %{"id" => "123"}}
               ]
             }
           } = updated_collector
  end

  test "collector stores received truncate when the relation is known", %{collector: collector} do
    collector =
      Collector.handle_message(
        %LR.Begin{final_lsn: @test_lsn, commit_timestamp: DateTime.utc_now(), xid: 456},
        collector
      )

    truncate_msg = %LR.Truncate{
      number_of_relations: 1,
      options: [],
      truncated_relations: [1]
    }

    updated_collector = Collector.handle_message(truncate_msg, collector)

    assert %Collector{
             transaction: %Transaction{
               changes: [%TruncatedRelation{relation: {"public", "users"}}]
             }
           } = updated_collector
  end

  test "collector emits a complete transaction when seeing a 'Commit' message", %{
    collector: collector
  } do
    collector =
      Collector.handle_message(
        %LR.Begin{final_lsn: @test_lsn, commit_timestamp: DateTime.utc_now(), xid: 456},
        collector
      )

    commit_msg = %LR.Commit{
      lsn: @test_lsn,
      end_lsn: @test_end_lsn
    }

    {completed_txn, updated_collector} = Collector.handle_message(commit_msg, collector)

    assert %Transaction{xid: 456, lsn: @test_end_lsn, last_log_offset: @test_log_offset} =
             completed_txn

    assert %Collector{transaction: nil, tx_op_index: nil} = updated_collector
  end

  test "Multiple collected operations are stored in the correct order within the transaction when it's emitted",
       %{collector: collector} do
    collector =
      Collector.handle_message(
        %LR.Begin{final_lsn: @test_lsn, commit_timestamp: DateTime.utc_now(), xid: 456},
        collector
      )

    insert_msg = %LR.Insert{relation_id: 1, tuple_data: ["123"]}
    update_msg = %LR.Update{relation_id: 1, old_tuple_data: ["123"], tuple_data: ["124"]}
    delete_msg = %LR.Delete{relation_id: 1, old_tuple_data: ["124"]}

    collector = Collector.handle_message(insert_msg, collector)
    collector = Collector.handle_message(update_msg, collector)
    collector = Collector.handle_message(delete_msg, collector)

    commit_msg = %LR.Commit{lsn: @test_lsn, end_lsn: @test_end_lsn}

    {completed_txn, _updated_collector} = Collector.handle_message(commit_msg, collector)

    log_offset_1 = LogOffset.new(@test_lsn, 0)
    log_offset_2 = LogOffset.new(@test_lsn, 2)
    log_offset_3 = LogOffset.new(@test_lsn, 4)

    assert [
             %NewRecord{
               relation: {"public", "users"},
               record: %{"id" => "123"},
               log_offset: ^log_offset_1
             },
             %UpdatedRecord{
               relation: {"public", "users"},
               old_record: %{"id" => "123"},
               record: %{"id" => "124"},
               log_offset: ^log_offset_2
             },
             %DeletedRecord{
               relation: {"public", "users"},
               old_record: %{"id" => "124"},
               log_offset: ^log_offset_3
             }
           ] = completed_txn.changes
  end
end
