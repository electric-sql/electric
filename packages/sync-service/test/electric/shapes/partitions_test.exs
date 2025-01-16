defmodule Electric.Shapes.PartitionsTest do
  use ExUnit.Case, async: true

  alias Electric.Replication.Changes.NewRecord
  alias Electric.Replication.Changes.Relation
  alias Electric.Replication.Changes.Transaction
  alias Electric.Replication.Changes.TruncatedRelation
  alias Electric.Shapes.Partitions
  alias Electric.Shapes.Shape

  alias Support.StubInspector

  @partition_inspector StubInspector.new(%{
                         {"public", "partitioned"} => %{
                           relation: %{
                             children: [
                               {"public", "partition_01"},
                               {"public", "partition_02"}
                             ]
                           },
                           columns: [
                             %{name: "id", type: "int8", pk_position: 0},
                             %{name: "an_array", array_type: "int8"}
                           ]
                         },
                         {"public", "partition_01"} => %{
                           relation: %{
                             children: nil,
                             parent: {"public", "partitioned"}
                           },
                           columns: [
                             %{name: "id", type: "int8", pk_position: 0},
                             %{name: "an_array", array_type: "int8"}
                           ]
                         },
                         {"public", "partition_02"} => %{
                           relation: %{
                             children: nil,
                             parent: {"public", "partitioned"}
                           },
                           columns: [
                             %{name: "id", type: "int8", pk_position: 0},
                             %{name: "an_array", array_type: "int8"}
                           ]
                         },
                         {"public", "partition_03"} => %{
                           relation: %{
                             children: nil,
                             parent: {"public", "partitioned"}
                           },
                           columns: [
                             %{name: "id", type: "int8", pk_position: 0},
                             %{name: "an_array", array_type: "int8"}
                           ]
                         }
                       })

  test "changes to table partition are sent to root" do
    partitions =
      Partitions.new(inspector: @partition_inspector)
      |> Partitions.add_shape("s1", Shape.new!("partitioned", inspector: @partition_inspector))
      |> Partitions.add_shape(
        "s2",
        Shape.new!("partitioned", where: "id = 2", inspector: @partition_inspector)
      )
      |> Partitions.add_shape(
        "s3",
        Shape.new!("partitioned", where: "id = 3", inspector: @partition_inspector)
      )

    new = %NewRecord{
      relation: {"public", "partition_02"},
      record: %{"id" => "2"}
    }

    root = %{new | relation: {"public", "partitioned"}}
    insert = %Transaction{changes: [new]}

    assert {_, %Transaction{changes: [^new, ^root]}} = Partitions.handle_event(partitions, insert)
  end

  test "no change expansion is done when no partitioned shapes are active" do
    partitions =
      Partitions.new(inspector: @partition_inspector)
      |> Partitions.add_shape("s1", Shape.new!("partition_01", inspector: @partition_inspector))
      |> Partitions.add_shape(
        "s2",
        Shape.new!("partition_01", where: "id = 2", inspector: @partition_inspector)
      )
      |> Partitions.add_shape(
        "s3",
        Shape.new!("partition_01", where: "id = 3", inspector: @partition_inspector)
      )

    insert = %Transaction{
      changes: [
        %NewRecord{
          relation: {"public", "partition_01"},
          record: %{"id" => "2"}
        }
      ]
    }

    {_, ^insert} = Partitions.handle_event(partitions, insert)
  end

  test "after addition of new partition, shape receives updates" do
    partitions =
      Partitions.new(inspector: @partition_inspector)
      |> Partitions.add_shape("s1", Shape.new!("partitioned", inspector: @partition_inspector))
      |> Partitions.add_shape(
        "s2",
        Shape.new!("partitioned", where: "id = 2", inspector: @partition_inspector)
      )
      |> Partitions.add_shape(
        "s3",
        Shape.new!("partition_01", inspector: @partition_inspector)
      )

    new = %NewRecord{relation: {"public", "partition_03"}, record: %{"id" => "2"}}
    root = %NewRecord{relation: {"public", "partitioned"}, record: %{"id" => "2"}}
    insert = %Transaction{changes: [new]}

    {_, ^insert} = Partitions.handle_event(partitions, insert)

    relation = %Relation{schema: "public", table: "partition_03"}

    {partitions, ^relation} = Partitions.handle_event(partitions, relation)

    {_, %Transaction{changes: [^new, ^root]}} = Partitions.handle_event(partitions, insert)
  end

  test "remove_shape/2 cleans up partition information" do
    empty = Partitions.new(inspector: @partition_inspector)
    partition_03 = %Relation{schema: "public", table: "partition_03"}

    partitions =
      empty
      |> Partitions.add_shape("s1", Shape.new!("partitioned", inspector: @partition_inspector))
      |> Partitions.add_shape(
        "s2",
        Shape.new!("partitioned", where: "id = 1", inspector: @partition_inspector)
      )
      |> Partitions.add_shape(
        "s3",
        Shape.new!("partition_01", where: "id = 2", inspector: @partition_inspector)
      )
      |> Partitions.add_shape(
        "s4",
        Shape.new!("partition_02", where: "id > 2", inspector: @partition_inspector)
      )
      |> Partitions.handle_relation(partition_03)
      |> Partitions.add_shape(
        "s5",
        Shape.new!("partition_03", where: "id > 7", inspector: @partition_inspector)
      )

    new = %NewRecord{relation: {"public", "partition_03"}, record: %{"id" => "2"}}
    root = %NewRecord{relation: {"public", "partitioned"}, record: %{"id" => "2"}}
    insert = %Transaction{changes: [new]}

    assert {_, %Transaction{changes: [^new, ^root]}} = Partitions.handle_event(partitions, insert)

    clean_partitions =
      partitions
      |> Partitions.remove_shape("s2")
      |> Partitions.remove_shape("s1")
      |> Partitions.remove_shape("s4")
      |> Partitions.remove_shape("s5")
      |> Partitions.remove_shape("s3")

    assert clean_partitions == empty

    assert {_, %Transaction{changes: [^new]}} = Partitions.handle_event(clean_partitions, insert)
  end

  describe "truncation" do
    setup do
      partitions =
        Partitions.new(inspector: @partition_inspector)
        |> Partitions.add_shape("s1", Shape.new!("partitioned", inspector: @partition_inspector))
        |> Partitions.add_shape(
          "s2",
          Shape.new!("partitioned", where: "id = 2", inspector: @partition_inspector)
        )
        |> Partitions.add_shape(
          "s3",
          Shape.new!("partition_01", where: "id = 2", inspector: @partition_inspector)
        )
        |> Partitions.add_shape(
          "s4",
          Shape.new!("partition_02", where: "id > 2", inspector: @partition_inspector)
        )

      [partitions: partitions]
    end

    test "truncation of root partition truncates root and all partitions", ctx do
      truncate_partitioned = %TruncatedRelation{relation: {"public", "partitioned"}}
      truncate_partition_01 = %TruncatedRelation{relation: {"public", "partition_01"}}
      truncate_partition_02 = %TruncatedRelation{relation: {"public", "partition_02"}}

      txn = %Transaction{changes: [truncate_partitioned]}

      assert {_,
              %Transaction{
                changes: [^truncate_partitioned, ^truncate_partition_01, ^truncate_partition_02]
              }} = Partitions.handle_event(ctx.partitions, txn)
    end

    test "truncation of partition truncates root and that partition", ctx do
      truncate_partitioned = %TruncatedRelation{relation: {"public", "partitioned"}}
      truncate_partition_02 = %TruncatedRelation{relation: {"public", "partition_02"}}

      txn = %Transaction{changes: [truncate_partition_02]}

      assert {_,
              %Transaction{
                changes: [^truncate_partition_02, ^truncate_partitioned]
              }} = Partitions.handle_event(ctx.partitions, txn)
    end
  end
end
