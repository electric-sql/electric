defmodule Electric.Postgres.ReplicationClient.MessageConverterTest do
  use ExUnit.Case, async: true

  import ExUnit.CaptureLog

  alias Electric.Postgres.LogicalReplication.Messages, as: LR
  alias Electric.Postgres.Lsn
  alias Electric.Postgres.ReplicationClient.MessageConverter

  alias Electric.Replication.Changes.{
    Begin,
    Commit,
    Relation,
    Column,
    NewRecord,
    UpdatedRecord,
    DeletedRecord,
    TruncatedRelation
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

  setup do
    converter = MessageConverter.new()
    {[_relation], converter} = MessageConverter.convert(@relation, converter)
    {:ok, converter: converter}
  end

  describe "convert/2" do
    test "returns Begin change when seeing a 'Begin' message", %{
      converter: converter
    } do
      begin_msg = %LR.Begin{
        final_lsn: @test_lsn,
        commit_timestamp: DateTime.utc_now(),
        xid: 456
      }

      {changes, updated_converter} = MessageConverter.convert(begin_msg, converter)

      assert [%Begin{xid: 456}] = changes
      assert updated_converter.current_lsn == @test_lsn
      assert updated_converter.tx_op_index == 0
      assert updated_converter.tx_size == 0
    end

    test "returns Relation change when receiving a relation message", %{
      converter: converter
    } do
      new_relation = %LR.Relation{
        id: 2,
        namespace: "public",
        name: "posts",
        replica_identity: :default,
        columns: [
          %LR.Relation.Column{name: "id", flags: [:key], type_oid: 23, type_modifier: -1}
        ]
      }

      {changes, updated_converter} = MessageConverter.convert(new_relation, converter)

      assert [
               %Relation{
                 id: 2,
                 schema: "public",
                 table: "posts",
                 columns: [%Column{name: "id", type_oid: 23}]
               }
             ] = changes

      assert %MessageConverter{relations: %{1 => @relation, 2 => ^new_relation}} =
               updated_converter
    end

    test "logs information when receiving a generic message",
         %{converter: converter} do
      message = %LR.Message{prefix: "test", content: "hello world"}
      log = capture_log(fn -> MessageConverter.convert(message, converter) end)
      assert log =~ "Got a message from PG via logical replication"
    end

    test "returns empty list for origin & type messages",
         %{converter: converter} do
      origin = %LR.Origin{name: "another origin"}
      type = %LR.Type{name: "custom_type"}

      assert {[], ^converter} = MessageConverter.convert(origin, converter)
      assert {[], ^converter} = MessageConverter.convert(type, converter)
    end

    test "returns NewRecord change for insert when the relation is known", %{
      converter: converter
    } do
      {[_begin], converter} =
        MessageConverter.convert(
          %LR.Begin{final_lsn: @test_lsn, commit_timestamp: DateTime.utc_now(), xid: 456},
          converter
        )

      insert_msg = %LR.Insert{
        relation_id: 1,
        tuple_data: ["123"],
        bytes: 3
      }

      {changes, updated_converter} = MessageConverter.convert(insert_msg, converter)

      assert [
               %NewRecord{
                 relation: {"public", "users"},
                 record: %{"id" => "123"},
                 log_offset: log_offset
               }
             ] = changes

      assert log_offset == LogOffset.new(@test_lsn, 0)

      assert updated_converter.tx_op_index == 2
      assert updated_converter.tx_size == 3
    end

    test "returns UpdatedRecord change for update when the relation is known", %{
      converter: converter
    } do
      {[_begin], converter} =
        MessageConverter.convert(
          %LR.Begin{final_lsn: @test_lsn, commit_timestamp: DateTime.utc_now(), xid: 456},
          converter
        )

      update_msg = %LR.Update{
        relation_id: 1,
        old_tuple_data: ["123"],
        tuple_data: ["124"],
        bytes: 6
      }

      {changes, updated_converter} = MessageConverter.convert(update_msg, converter)

      assert [
               %UpdatedRecord{
                 relation: {"public", "users"},
                 old_record: %{"id" => "123"},
                 record: %{"id" => "124"},
                 log_offset: log_offset
               }
             ] = changes

      assert log_offset == LogOffset.new(@test_lsn, 0)

      assert updated_converter.tx_op_index == 2
      assert updated_converter.tx_size == 6
    end

    test "errors for empty old data on updates", %{converter: converter} do
      {[_begin], converter} =
        MessageConverter.convert(
          %LR.Begin{final_lsn: @test_lsn, commit_timestamp: DateTime.utc_now(), xid: 456},
          converter
        )

      update_msg = %LR.Update{
        relation_id: 1,
        old_tuple_data: nil,
        tuple_data: ["124"],
        bytes: 3
      }

      result = MessageConverter.convert(update_msg, converter)

      assert {:error, {:replica_not_full, message}, _} = result

      assert message =~
               "Received an update from PG for public.users that did not have " <>
                 "old data included in the message."

      assert message =~ "Try executing `ALTER TABLE public.users REPLICA IDENTITY FULL`"
    end

    test "returns DeletedRecord change for delete when the relation is known", %{
      converter: converter
    } do
      {[_begin], converter} =
        MessageConverter.convert(
          %LR.Begin{final_lsn: @test_lsn, commit_timestamp: DateTime.utc_now(), xid: 456},
          converter
        )

      delete_msg = %LR.Delete{
        relation_id: 1,
        old_tuple_data: ["123"],
        bytes: 3
      }

      {changes, updated_converter} = MessageConverter.convert(delete_msg, converter)

      assert [
               %DeletedRecord{
                 relation: {"public", "users"},
                 old_record: %{"id" => "123"},
                 log_offset: log_offset
               }
             ] = changes

      assert log_offset == LogOffset.new(@test_lsn, 0)

      assert updated_converter.tx_op_index == 2
      assert updated_converter.tx_size == 3
    end

    test "returns TruncatedRelation change for truncate when the relation is known",
         %{converter: converter} do
      {[_begin], converter} =
        MessageConverter.convert(
          %LR.Begin{final_lsn: @test_lsn, commit_timestamp: DateTime.utc_now(), xid: 456},
          converter
        )

      truncate_msg = %LR.Truncate{
        number_of_relations: 1,
        options: [],
        truncated_relations: [1]
      }

      {changes, updated_converter} = MessageConverter.convert(truncate_msg, converter)

      assert [%TruncatedRelation{relation: {"public", "users"}}] = changes
      assert updated_converter.tx_op_index == 2
    end

    test "returns multiple TruncatedRelation changes when multiple relations are truncated",
         %{converter: converter} do
      {[_begin], converter} =
        MessageConverter.convert(
          %LR.Begin{final_lsn: @test_lsn, commit_timestamp: DateTime.utc_now(), xid: 456},
          converter
        )

      new_relation = %LR.Relation{
        id: 2,
        namespace: "public",
        name: "posts",
        replica_identity: :default,
        columns: [
          %LR.Relation.Column{name: "id", flags: [:key], type_oid: 23, type_modifier: -1}
        ]
      }

      {[%Relation{}], converter} = MessageConverter.convert(new_relation, converter)

      truncate_msg = %LR.Truncate{
        number_of_relations: 1,
        options: [],
        truncated_relations: [1, 2]
      }

      assert {[
                %TruncatedRelation{relation: {"public", "users"}, log_offset: offset1},
                %TruncatedRelation{relation: {"public", "posts"}, log_offset: offset2}
              ], _converter} = MessageConverter.convert(truncate_msg, converter)

      assert offset1 == LogOffset.new(@test_lsn, 0)
      assert offset2 == LogOffset.new(@test_lsn, 2)
    end

    test "returns Commit change when seeing a 'Commit' message", %{
      converter: converter
    } do
      {[_begin], converter} =
        MessageConverter.convert(
          %LR.Begin{final_lsn: @test_lsn, commit_timestamp: DateTime.utc_now(), xid: 456},
          converter
        )

      # Add some changes to track tx_size
      {[_insert], converter} =
        MessageConverter.convert(
          %LR.Insert{relation_id: 1, tuple_data: ["123"], bytes: 10},
          converter
        )

      commit_msg = %LR.Commit{
        lsn: @test_lsn,
        end_lsn: @test_end_lsn,
        commit_timestamp: ~U[2024-01-01 00:00:00Z]
      }

      {changes, updated_converter} = MessageConverter.convert(commit_msg, converter)

      assert [
               %Commit{
                 lsn: @test_lsn,
                 commit_timestamp: ~U[2024-01-01 00:00:00Z],
                 transaction_size: 10
               }
             ] = changes

      assert updated_converter.current_lsn == nil
      assert updated_converter.tx_op_index == nil
      assert updated_converter.tx_size == 0
    end

    test "multiple converted operations maintain correct log offsets", %{converter: converter} do
      {[_begin], converter} =
        MessageConverter.convert(
          %LR.Begin{final_lsn: @test_lsn, commit_timestamp: DateTime.utc_now(), xid: 456},
          converter
        )

      insert_msg = %LR.Insert{relation_id: 1, tuple_data: ["123"], bytes: 3}

      update_msg = %LR.Update{
        relation_id: 1,
        old_tuple_data: ["123"],
        tuple_data: ["124"],
        bytes: 6
      }

      delete_msg = %LR.Delete{relation_id: 1, old_tuple_data: ["124"], bytes: 3}

      {[insert_change], converter} = MessageConverter.convert(insert_msg, converter)
      {[update_change], converter} = MessageConverter.convert(update_msg, converter)
      {[delete_change], _converter} = MessageConverter.convert(delete_msg, converter)

      log_offset_1 = LogOffset.new(@test_lsn, 0)
      log_offset_2 = LogOffset.new(@test_lsn, 2)
      log_offset_3 = LogOffset.new(@test_lsn, 4)

      assert %NewRecord{
               relation: {"public", "users"},
               record: %{"id" => "123"},
               log_offset: ^log_offset_1
             } = insert_change

      assert %UpdatedRecord{
               relation: {"public", "users"},
               old_record: %{"id" => "123"},
               record: %{"id" => "124"},
               log_offset: ^log_offset_2
             } = update_change

      assert %DeletedRecord{
               relation: {"public", "users"},
               old_record: %{"id" => "124"},
               log_offset: ^log_offset_3
             } = delete_change
    end

    test "returns error when transaction size exceeds max_tx_size limit" do
      converter = %MessageConverter{max_tx_size: 10}
      {[_relation], converter} = MessageConverter.convert(@relation, converter)

      {[_begin], converter} =
        MessageConverter.convert(
          %LR.Begin{final_lsn: @test_lsn, commit_timestamp: DateTime.utc_now(), xid: 456},
          converter
        )

      # First insert is under the limit
      insert_msg1 = %LR.Insert{relation_id: 1, tuple_data: ["123"], bytes: 5}
      {[_change], converter} = MessageConverter.convert(insert_msg1, converter)
      assert converter.tx_size == 5

      # Second insert exceeds the limit (5 + 10 = 15 > 10)
      insert_msg2 = %LR.Insert{relation_id: 1, tuple_data: ["456"], bytes: 10}
      result = MessageConverter.convert(insert_msg2, converter)

      assert {:error, {:exceeded_max_tx_size, message}, ^converter} = result
      assert message == "Collected transaction exceeds limit of 10 bytes."
    end
  end
end
