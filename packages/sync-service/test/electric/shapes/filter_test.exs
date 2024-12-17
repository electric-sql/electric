defmodule Electric.Shapes.FilterTest do
  use ExUnit.Case

  import ExUnit.CaptureLog

  alias Electric.Replication.Changes.DeletedRecord
  alias Electric.Replication.Changes.NewRecord
  alias Electric.Replication.Changes.Relation
  alias Electric.Replication.Changes.Transaction
  alias Electric.Replication.Changes.TruncatedRelation
  alias Electric.Replication.Changes.UpdatedRecord
  alias Electric.Shapes.Filter
  alias Electric.Shapes.Shape
  alias Support.StubInspector

  @inspector StubInspector.new([
               %{name: "id", type: "int8", pk_position: 0},
               %{name: "an_array", array_type: "int8"}
             ])

  defp filter(inspector \\ @inspector) do
    Filter.new(inspector: inspector)
  end

  defp assert_affected(filter, changes, expected) do
    {_, affected} = Filter.affected_shapes(filter, changes)
    assert affected == expected
  end

  describe "affected_shapes/2" do
    test "returns shapes affected by insert" do
      filter =
        filter()
        |> Filter.add_shape("s1", Shape.new!("t1", where: "id = 1", inspector: @inspector))
        |> Filter.add_shape("s2", Shape.new!("t1", where: "id = 2", inspector: @inspector))
        |> Filter.add_shape("s3", Shape.new!("t1", where: "id = 3", inspector: @inspector))
        |> Filter.add_shape("s4", Shape.new!("t2", where: "id = 2", inspector: @inspector))

      insert =
        %Transaction{
          changes: [
            %NewRecord{
              relation: {"public", "t1"},
              record: %{"id" => "2"}
            }
          ]
        }

      assert_affected(filter, insert, MapSet.new(["s2"]))
    end

    test "returns shapes affected by delete" do
      filter =
        filter()
        |> Filter.add_shape("s1", Shape.new!("t1", where: "id = 1", inspector: @inspector))
        |> Filter.add_shape("s2", Shape.new!("t1", where: "id = 2", inspector: @inspector))
        |> Filter.add_shape("s3", Shape.new!("t1", where: "id = 3", inspector: @inspector))
        |> Filter.add_shape("s4", Shape.new!("t2", where: "id = 2", inspector: @inspector))

      delete =
        %Transaction{
          changes: [
            %DeletedRecord{
              relation: {"public", "t1"},
              old_record: %{"id" => "2"}
            }
          ]
        }

      assert_affected(filter, delete, MapSet.new(["s2"]))
    end

    test "returns shapes affected by update" do
      filter =
        filter()
        |> Filter.add_shape("s1", Shape.new!("t1", where: "id = 1", inspector: @inspector))
        |> Filter.add_shape("s2", Shape.new!("t1", where: "id = 2", inspector: @inspector))
        |> Filter.add_shape("s3", Shape.new!("t1", where: "id = 3", inspector: @inspector))
        |> Filter.add_shape("s4", Shape.new!("t1", where: "id = 4", inspector: @inspector))
        |> Filter.add_shape("s2", Shape.new!("t2", where: "id = 2", inspector: @inspector))

      update =
        %Transaction{
          changes: [
            %UpdatedRecord{
              relation: {"public", "t1"},
              record: %{"id" => "2"},
              old_record: %{"id" => "3"}
            }
          ]
        }

      assert_affected(filter, update, MapSet.new(["s2", "s3"]))
    end

    test "returns shapes affected by relation change" do
      filter =
        filter()
        |> Filter.add_shape("s1", Shape.new!("t1", where: "id = 1", inspector: @inspector))
        |> Filter.add_shape("s2", Shape.new!("t1", where: "id = 2", inspector: @inspector))
        |> Filter.add_shape("s3", Shape.new!("t1", where: "id > 7", inspector: @inspector))
        |> Filter.add_shape("s4", Shape.new!("t1", where: "id > 8", inspector: @inspector))
        |> Filter.add_shape("s5", Shape.new!("t2", where: "id = 1", inspector: @inspector))
        |> Filter.add_shape("s6", Shape.new!("t2", where: "id = 2", inspector: @inspector))
        |> Filter.add_shape("s7", Shape.new!("t2", where: "id > 7", inspector: @inspector))
        |> Filter.add_shape("s8", Shape.new!("t2", where: "id > 8", inspector: @inspector))

      relation = %Relation{schema: "public", table: "t1"}

      assert_affected(filter, relation, MapSet.new(["s1", "s2", "s3", "s4"]))
    end

    test "returns shapes affected by relation rename" do
      table_id = 123
      s1 = Shape.new!("t1", inspector: @inspector)
      s2 = Shape.new!("t2", inspector: @inspector) |> Map.put(:root_table_id, table_id)
      s3 = Shape.new!("t3", inspector: @inspector)

      filter =
        filter()
        |> Filter.add_shape("s1", s1)
        |> Filter.add_shape("s2", s2)
        |> Filter.add_shape("s3", s3)

      rename = %Relation{schema: "public", table: "new_name", id: table_id}

      assert_affected(filter, rename, MapSet.new(["s2"]))
    end

    test "returns shapes affected by truncation" do
      filter =
        filter()
        |> Filter.add_shape("s1", Shape.new!("t1", where: "id = 1", inspector: @inspector))
        |> Filter.add_shape("s2", Shape.new!("t1", where: "id = 2", inspector: @inspector))
        |> Filter.add_shape("s3", Shape.new!("t1", where: "id > 7", inspector: @inspector))
        |> Filter.add_shape("s4", Shape.new!("t1", where: "id > 8", inspector: @inspector))
        |> Filter.add_shape("s5", Shape.new!("t2", where: "id = 1", inspector: @inspector))
        |> Filter.add_shape("s6", Shape.new!("t2", where: "id = 2", inspector: @inspector))
        |> Filter.add_shape("s7", Shape.new!("t2", where: "id > 7", inspector: @inspector))
        |> Filter.add_shape("s8", Shape.new!("t2", where: "id > 8", inspector: @inspector))

      truncation = %Transaction{changes: [%TruncatedRelation{relation: {"public", "t1"}}]}

      assert_affected(filter, truncation, MapSet.new(["s1", "s2", "s3", "s4"]))
    end
  end

  test "shape with no where clause is affected by all changes for the same table" do
    shape = Shape.new!("t1", inspector: @inspector)
    filter = filter() |> Filter.add_shape("s", shape)

    assert_affected(filter, change("t1", %{"id" => "7"}), MapSet.new(["s"]))
    assert_affected(filter, change("t1", %{"id" => "8"}), MapSet.new(["s"]))
    assert_affected(filter, change("t2", %{"id" => "8"}), MapSet.new([]))
  end

  test "shape with a where clause is affected by changes that match that where clause" do
    shape = Shape.new!("t1", where: "id = 7", inspector: @inspector)
    filter = filter() |> Filter.add_shape("s", shape)

    assert_affected(filter, change("t1", %{"id" => "7"}), MapSet.new(["s"]))
    assert_affected(filter, change("t1", %{"id" => "8"}), MapSet.new([]))
    assert_affected(filter, change("t2", %{"id" => "8"}), MapSet.new([]))
  end

  test "invalid record value logs an error and says all shapes for the table are affected" do
    filter =
      filter()
      |> Filter.add_shape("shape1", Shape.new!("table", inspector: @inspector))
      |> Filter.add_shape("shape2", Shape.new!("table", where: "id = 7", inspector: @inspector))
      |> Filter.add_shape("shape3", Shape.new!("table", where: "id = 8", inspector: @inspector))
      |> Filter.add_shape("shape4", Shape.new!("table", where: "id > 9", inspector: @inspector))
      |> Filter.add_shape("shape5", Shape.new!("another_table", inspector: @inspector))

    log =
      capture_log(fn ->
        assert_affected(
          filter,
          change("table", %{"id" => "invalid_value"}),
          MapSet.new(["shape1", "shape2", "shape3", "shape4"])
        )
      end)

    assert log =~ ~s(Could not parse value for field "id" of type :int8)
  end

  test "Filter.remove_shape/2" do
    empty = filter()

    filter1 =
      empty
      |> Filter.add_shape("shape1", Shape.new!("table", inspector: @inspector))

    filter2 =
      filter1
      |> Filter.add_shape("shape2", Shape.new!("another_table", inspector: @inspector))

    filter3 =
      filter2
      |> Filter.add_shape("shape3", Shape.new!("table", where: "id = 1", inspector: @inspector))

    filter4 =
      filter3
      |> Filter.add_shape("shape4", Shape.new!("table", where: "id = 2", inspector: @inspector))

    filter5 =
      filter4
      |> Filter.add_shape("shape5", Shape.new!("table", where: "id > 2", inspector: @inspector))

    filter6 =
      filter5
      |> Filter.add_shape("shape6", Shape.new!("table", where: "id > 7", inspector: @inspector))

    assert Filter.remove_shape(filter6, "shape6") == filter5
    assert Filter.remove_shape(filter5, "shape5") == filter4
    assert Filter.remove_shape(filter4, "shape4") == filter3
    assert Filter.remove_shape(filter3, "shape3") == filter2
    assert Filter.remove_shape(filter2, "shape2") == filter1
    assert Filter.remove_shape(filter1, "shape1") == empty
  end

  for test <- [
        %{where: "id = 7", record: %{"id" => "7"}, affected: true},
        %{where: "id = 7", record: %{"id" => "8"}, affected: false},
        %{where: "id = 7", record: %{"id" => nil}, affected: false},
        %{where: "7 = id", record: %{"id" => "7"}, affected: true},
        %{where: "7 = id", record: %{"id" => "8"}, affected: false},
        %{where: "7 = id", record: %{"id" => nil}, affected: false},
        %{where: "id = 7 AND id > 1", record: %{"id" => "7"}, affected: true},
        %{where: "id = 7 AND id > 1", record: %{"id" => "8"}, affected: false},
        %{where: "id = 7 AND id > 8", record: %{"id" => "7"}, affected: false},
        %{where: "id > 1 AND id = 7", record: %{"id" => "7"}, affected: true},
        %{where: "id > 1 AND id = 7", record: %{"id" => "8"}, affected: false},
        %{where: "id > 8 AND id = 7", record: %{"id" => "7"}, affected: false},
        %{where: "an_array = '{1}'", record: %{"an_array" => "{1}"}, affected: true},
        %{where: "an_array = '{1}'", record: %{"an_array" => "{2}"}, affected: false},
        %{where: "an_array = '{1}'", record: %{"an_array" => "{1,2}"}, affected: false}
      ] do
    test "where: #{test.where}, record: #{inspect(test.record)}" do
      %{where: where, record: record, affected: affected} = unquote(Macro.escape(test))

      shape = Shape.new!("the_table", where: where, inspector: @inspector)

      transaction = change("the_table", record)

      {_filter, shapes} =
        filter()
        |> Filter.add_shape("the-shape", shape)
        |> Filter.affected_shapes(transaction)

      assert shapes == MapSet.new(["the-shape"]) == affected
    end
  end

  describe "optimisations" do
    # These tests assert that the number of reductions needed to calculate the affected shapes
    # when there at @shape_count shapes is less than @max_reductions.
    #
    # Reductions are used as a proxy for time taken for the calculation and
    # have been chosen instead of time since the time taken is not deterministic and
    # leads to flakey tests.
    #
    # Modern machines process approx 300-400 reductions per μs so @max_reductions of 400
    # is roughly equivalent to 1μs.
    #
    # 1μs per change is a desirable and achievable target for replication stream processing.
    # If optimised processing becomes slower than this we should discuss as a team to see if
    # the performance is acceptable.
    #
    # @shape_count is set to 1000. This is somewhat arbitrary but is a reasonable number of shapes.
    # The main point is we don't want to linearly scale with the number of shapes, we want
    # O(1) or at worst O(log n) performance, so if we have that, 1000 or 10_000 shapes should be easy
    # to keep to a microsecond per change. 10_000 shapes makes for a slow test though as the setup
    # time (n Filter.add_shape calls) is slow.
    @shape_count 1000
    @max_reductions 400

    test "where clause in the form `field = const` is optimised" do
      filter =
        1..@shape_count
        |> Enum.reduce(filter(), fn i, filter ->
          Filter.add_shape(filter, i, Shape.new!("t1", where: "id = #{i}", inspector: @inspector))
        end)

      assert_affected(filter, change("t1", %{"id" => "7"}), MapSet.new([7]))

      reductions =
        reductions(fn ->
          Filter.affected_shapes(filter, change("t1", %{"id" => "7"}))
        end)

      assert reductions < @max_reductions
    end

    test "where clause in the form `field = const AND another_condition` is optimised" do
      filter =
        1..@shape_count
        |> Enum.reduce(filter(), fn i, filter ->
          Filter.add_shape(
            filter,
            i,
            Shape.new!("t1", where: "id = #{i} AND id > 6", inspector: @inspector)
          )
        end)

      assert_affected(filter, change("t1", %{"id" => "7"}), MapSet.new([7]))

      reductions =
        reductions(fn ->
          Filter.affected_shapes(filter, change("t1", %{"id" => "7"}))
        end)

      assert reductions < @max_reductions
    end

    test "where clause in the form `a_condition AND field = const` is optimised" do
      filter =
        1..@shape_count
        |> Enum.reduce(filter(), fn i, filter ->
          Filter.add_shape(
            filter,
            i,
            Shape.new!("t1", where: "id > 6 AND id = #{i}", inspector: @inspector)
          )
        end)

      assert_affected(filter, change("t1", %{"id" => "7"}), MapSet.new([7]))

      reductions =
        reductions(fn ->
          Filter.affected_shapes(filter, change("t1", %{"id" => "7"}))
        end)

      assert reductions < @max_reductions
    end

    defp reductions(fun) do
      {:reductions, reductions_before} = :erlang.process_info(self(), :reductions)
      fun.()
      {:reductions, reductions_after} = :erlang.process_info(self(), :reductions)
      reductions_after - reductions_before
    end
  end

  @partition_inspector StubInspector.new(%{
                         {"public", "partitioned"} => %{
                           relation: %{
                             children: [{"public", "partition_01"}, {"public", "partition_02"}]
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

  describe "partitioned tables" do
    test "changes to table partition are sent to root" do
      filter =
        Filter.new(inspector: @partition_inspector)
        |> Filter.add_shape("s1", Shape.new!("partitioned", inspector: @partition_inspector))
        |> Filter.add_shape(
          "s2",
          Shape.new!("partitioned", where: "id = 2", inspector: @partition_inspector)
        )
        |> Filter.add_shape(
          "s3",
          Shape.new!("partitioned", where: "id = 3", inspector: @partition_inspector)
        )

      insert =
        %Transaction{
          changes: [
            %NewRecord{
              relation: {"public", "partition_01"},
              record: %{"id" => "2"}
            }
          ]
        }

      assert_affected(filter, insert, MapSet.new(["s1", "s2"]))
    end

    test "changes to table partition are always sent to partition shape" do
      filter =
        Filter.new(inspector: @partition_inspector)
        |> Filter.add_shape("s1", Shape.new!("partitioned", inspector: @partition_inspector))
        |> Filter.add_shape(
          "s2",
          Shape.new!("partitioned", where: "id = 2", inspector: @partition_inspector)
        )
        |> Filter.add_shape(
          "s3",
          Shape.new!("partition_01", inspector: @partition_inspector)
        )

      insert =
        %Transaction{
          changes: [
            %NewRecord{
              relation: {"public", "partition_01"},
              record: %{"id" => "2"}
            }
          ]
        }

      assert_affected(filter, insert, MapSet.new(["s1", "s2", "s3"]))

      insert =
        %Transaction{
          changes: [
            %NewRecord{
              relation: {"public", "partition_02"},
              record: %{"id" => "2"}
            }
          ]
        }

      assert_affected(filter, insert, MapSet.new(["s1", "s2"]))
    end

    @tag :wip
    test "root shape is affected by partition addition" do
      filter =
        Filter.new(inspector: @partition_inspector)
        |> Filter.add_shape("s1", Shape.new!("partitioned", inspector: @partition_inspector))
        |> Filter.add_shape(
          "s2",
          Shape.new!("partitioned", where: "id = 2", inspector: @partition_inspector)
        )
        |> Filter.add_shape(
          "s3",
          Shape.new!("partition_01", inspector: @partition_inspector)
        )

      relation = %Relation{schema: "public", table: "partition_03"}

      assert_affected(filter, relation, MapSet.new(["s1", "s2"]))
    end

    test "after addition of new partition, shape receives updates" do
      filter =
        Filter.new(inspector: @partition_inspector)
        |> Filter.add_shape("s1", Shape.new!("partitioned", inspector: @partition_inspector))
        |> Filter.add_shape(
          "s2",
          Shape.new!("partitioned", where: "id = 2", inspector: @partition_inspector)
        )
        |> Filter.add_shape(
          "s3",
          Shape.new!("partition_01", inspector: @partition_inspector)
        )

      relation = %Relation{schema: "public", table: "partition_03"}

      {filter, _} = Filter.affected_shapes(filter, relation)

      insert =
        %Transaction{
          changes: [
            %NewRecord{
              relation: {"public", "partition_03"},
              record: %{"id" => "2"}
            }
          ]
        }

      assert_affected(filter, insert, MapSet.new(["s1", "s2"]))
    end

    test "remove_shape/2 cleans up partition information" do
      empty = Filter.new(inspector: @partition_inspector)

      filter =
        empty
        |> Filter.add_shape("s1", Shape.new!("partitioned", inspector: @partition_inspector))
        |> Filter.add_shape(
          "s2",
          Shape.new!("partitioned", where: "id = 1", inspector: @partition_inspector)
        )
        |> Filter.add_shape(
          "s3",
          Shape.new!("partition_01", where: "id = 2", inspector: @partition_inspector)
        )
        |> Filter.add_shape(
          "s4",
          Shape.new!("partition_02", where: "id > 2", inspector: @partition_inspector)
        )
        |> Filter.add_shape(
          "s5",
          Shape.new!("partition_03", where: "id > 7", inspector: @partition_inspector)
        )

      clean_filter =
        filter
        |> Filter.remove_shape("s2")
        |> Filter.remove_shape("s1")
        |> Filter.remove_shape("s4")
        |> Filter.remove_shape("s5")
        |> Filter.remove_shape("s3")

      assert clean_filter == empty
    end
  end

  defp change(table, record) do
    %Transaction{
      changes: [
        %NewRecord{
          relation: {"public", table},
          record: record
        }
      ]
    }
  end
end
