defmodule Electric.Postgres.LogicalReplication.DecoderTest do
  use ExUnit.Case, async: true
  doctest Electric.Postgres.LogicalReplication.Decoder, import: true
  import Electric.Postgres.LogicalReplication.Decoder

  alias Electric.Postgres.LogicalReplication.Messages.{
    Begin,
    Commit,
    Origin,
    Message,
    Relation,
    Relation.Column,
    Insert,
    Update,
    Delete,
    Truncate,
    Type,
    Unsupported
  }

  alias Electric.Postgres.Lsn

  def lsn({segment, offset}), do: %Lsn{segment: segment, offset: offset}

  test "decodes begin messages" do
    {:ok, expected_dt, 0} = DateTime.from_iso8601("2019-07-18T17:02:35.726322Z")

    assert decode(
             <<66, 0, 0, 0, 2, 167, 244, 168, 128, 0, 2, 48, 246, 88, 88, 213, 242, 0, 0, 2, 107>>
           ) == %Begin{
             commit_timestamp: expected_dt,
             final_lsn: lsn({2, 2_817_828_992}),
             xid: 619
           }
  end

  test "decodes commit messages" do
    {:ok, expected_dt, 0} = DateTime.from_iso8601("2019-07-18T17:02:35.726322Z")

    assert decode(
             <<67, 0, 0, 0, 0, 2, 167, 244, 168, 128, 0, 0, 0, 2, 167, 244, 168, 176, 0, 2, 48,
               246, 88, 88, 213, 242>>
           ) == %Commit{
             flags: [],
             lsn: lsn({2, 2_817_828_992}),
             end_lsn: lsn({2, 2_817_829_040}),
             commit_timestamp: expected_dt
           }
  end

  test "decodes origin messages" do
    assert decode(<<79, 0, 0, 0, 2, 167, 244, 168, 128, "Elmer Fud", 0>>) ==
             %Origin{
               origin_commit_lsn: %Lsn{segment: 2, offset: 2_817_828_992},
               name: "Elmer Fud"
             }
  end

  test "decodes 'message' messages" do
    assert decode(<<?M, 1::8, 1::64, "hello", 0, 5::32, "world">>) ==
             %Message{
               transactional?: true,
               lsn: lsn({0, 1}),
               prefix: "hello",
               content: "world"
             }
  end

  test "decodes relation messages" do
    assert decode(
             <<82, 0, 0, 96, 0, 112, 117, 98, 108, 105, 99, 0, 102, 111, 111, 0, 100, 0, 2, 0, 98,
               97, 114, 0, 0, 0, 0, 25, 255, 255, 255, 255, 1, 105, 100, 0, 0, 0, 0, 23, 255, 255,
               255, 255>>
           ) == %Relation{
             id: 24576,
             namespace: "public",
             name: "foo",
             replica_identity: :default,
             columns: [
               %Column{
                 flags: [],
                 name: "bar",
                 # :text
                 type_oid: 25,
                 type_modifier: -1
               },
               %Column{
                 flags: [:key],
                 name: "id",
                 # :int4
                 type_oid: 23,
                 type_modifier: -1
               }
             ]
           }
  end

  test "decodes relation messages with different identities" do
    assert %Relation{replica_identity: :default} =
             decode(
               <<82, 0, 0, 96, 0, 112, 117, 98, 108, 105, 99, 0, 102, 111, 111, 0, ?d, 0, 0>>
             )

    assert %Relation{replica_identity: :nothing} =
             decode(
               <<82, 0, 0, 96, 0, 112, 117, 98, 108, 105, 99, 0, 102, 111, 111, 0, ?n, 0, 0>>
             )

    assert %Relation{replica_identity: :all_columns} =
             decode(
               <<82, 0, 0, 96, 0, 112, 117, 98, 108, 105, 99, 0, 102, 111, 111, 0, ?f, 0, 0>>
             )

    assert %Relation{replica_identity: :index} =
             decode(
               <<82, 0, 0, 96, 0, 112, 117, 98, 108, 105, 99, 0, 102, 111, 111, 0, ?i, 0, 0>>
             )
  end

  test "decodes relation messages with array types" do
    assert decode(
             <<82, 0, 0, 64, 18, 112, 117, 98, 108, 105, 99, 0, 99, 111, 109, 112, 108, 101, 120,
               0, 102, 0, 3, 1, 105, 100, 0, 0, 0, 11, 134, 255, 255, 255, 255, 1, 110, 117, 109,
               98, 101, 114, 115, 0, 0, 0, 3, 239, 255, 255, 255, 255, 1, 116, 101, 120, 116, 95,
               109, 97, 116, 114, 105, 120, 0, 0, 0, 3, 241, 255, 255, 255, 255>>
           ) == %Relation{
             id: 16402,
             namespace: "public",
             name: "complex",
             replica_identity: :all_columns,
             columns: [
               %Column{
                 flags: [:key],
                 name: "id",
                 # :uuid
                 type_oid: 2950,
                 type_modifier: -1
               },
               %Column{
                 flags: [:key],
                 name: "numbers",
                 # {:array, :int4}
                 type_oid: 1007,
                 type_modifier: -1
               },
               %Column{
                 flags: [:key],
                 name: "text_matrix",
                 # {:array, :text}
                 type_oid: 1009,
                 type_modifier: -1
               }
             ]
           }
  end

  test "decodes type messages" do
    assert decode(
             <<89, 0, 0, 128, 52, 112, 117, 98, 108, 105, 99, 0, 101, 120, 97, 109, 112, 108, 101,
               95, 116, 121, 112, 101, 0>>
           ) ==
             %Type{
               id: 32820,
               namespace: "public",
               name: "example_type"
             }
  end

  describe "truncate messages" do
    test "decodes messages" do
      assert decode(<<84, 0, 0, 0, 1, 0, 0, 0, 96, 0>>) ==
               %Truncate{
                 number_of_relations: 1,
                 options: [],
                 truncated_relations: [24576]
               }
    end

    test "decodes messages with cascade option" do
      assert decode(<<84, 0, 0, 0, 1, 1, 0, 0, 96, 0>>) ==
               %Truncate{
                 number_of_relations: 1,
                 options: [:cascade],
                 truncated_relations: [24576]
               }
    end

    test "decodes messages with restart identity option" do
      assert decode(<<84, 0, 0, 0, 1, 2, 0, 0, 96, 0>>) ==
               %Truncate{
                 number_of_relations: 1,
                 options: [:restart_identity],
                 truncated_relations: [24576]
               }
    end

    test "decodes messages with both cascade and restart identity options" do
      assert decode(<<84, 0, 0, 0, 1, 3, 0, 0, 96, 0>>) ==
               %Truncate{
                 number_of_relations: 1,
                 options: [:cascade, :restart_identity],
                 truncated_relations: [24576]
               }
    end

    test "decodes unknown messages" do
      assert decode("!what's this message") ==
               %Unsupported{data: "!what's this message"}
    end
  end

  describe "data message (TupleData) decoder" do
    test "decodes insert messages" do
      assert decode(
               <<73, 0, 0, 96, 0, 78, 0, 2, 116, 0, 0, 0, 3, 98, 97, 122, 116, 0, 0, 0, 3, 53, 54,
                 48>>
             ) == %Insert{
               relation_id: 24576,
               tuple_data: ["baz", "560"],
               bytes: 6
             }
    end

    test "decodes insert messages with null values" do
      assert decode(<<73, 0, 0, 96, 0, 78, 0, 2, 110, 116, 0, 0, 0, 3, 53, 54, 48>>) == %Insert{
               relation_id: 24576,
               tuple_data: [nil, "560"],
               bytes: 3
             }
    end

    test "decodes insert messages with unchanged toasted values" do
      assert decode(<<73, 0, 0, 96, 0, 78, 0, 2, 117, 116, 0, 0, 0, 3, 53, 54, 48>>) == %Insert{
               relation_id: 24576,
               tuple_data: [:unchanged_toast, "560"],
               bytes: 3
             }
    end

    test "decodes update messages with default replica identity setting" do
      assert decode(
               <<85, 0, 0, 96, 0, 78, 0, 2, 116, 0, 0, 0, 7, 101, 120, 97, 109, 112, 108, 101,
                 116, 0, 0, 0, 3, 53, 54, 48>>
             ) == %Update{
               relation_id: 24576,
               changed_key_tuple_data: nil,
               old_tuple_data: nil,
               tuple_data: ["example", "560"],
               bytes: 10
             }
    end

    test "decodes update messages with FULL replica identity setting" do
      assert decode(
               <<85, 0, 0, 96, 0, 79, 0, 2, 116, 0, 0, 0, 3, 98, 97, 122, 116, 0, 0, 0, 3, 53, 54,
                 48, 78, 0, 2, 116, 0, 0, 0, 7, 101, 120, 97, 109, 112, 108, 101, 116, 0, 0, 0, 3,
                 53, 54, 48>>
             ) == %Update{
               relation_id: 24576,
               changed_key_tuple_data: nil,
               old_tuple_data: ["baz", "560"],
               tuple_data: ["example", "560"],
               bytes: 16
             }
    end

    test "decodes update messages with USING INDEX replica identity setting" do
      assert decode(
               <<85, 0, 0, 96, 0, 75, 0, 2, 116, 0, 0, 0, 3, 98, 97, 122, 110, 78, 0, 2, 116, 0,
                 0, 0, 7, 101, 120, 97, 109, 112, 108, 101, 116, 0, 0, 0, 3, 53, 54, 48>>
             ) == %Update{
               relation_id: 24576,
               changed_key_tuple_data: ["baz", nil],
               old_tuple_data: nil,
               tuple_data: ["example", "560"],
               bytes: 13
             }
    end

    test "decodes DELETE messages with USING INDEX replica identity setting" do
      assert decode(
               <<68, 0, 0, 96, 0, 75, 0, 2, 116, 0, 0, 0, 7, 101, 120, 97, 109, 112, 108, 101,
                 110>>
             ) == %Delete{
               relation_id: 24576,
               changed_key_tuple_data: ["example", nil],
               bytes: 7
             }
    end

    test "decodes DELETE messages with FULL replica identity setting" do
      assert decode(
               <<68, 0, 0, 96, 0, 79, 0, 2, 116, 0, 0, 0, 3, 98, 97, 122, 116, 0, 0, 0, 3, 53, 54,
                 48>>
             ) == %Delete{
               relation_id: 24576,
               old_tuple_data: ["baz", "560"],
               bytes: 6
             }
    end
  end
end
