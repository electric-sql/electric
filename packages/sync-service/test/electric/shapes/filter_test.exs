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

  @inspector StubInspector.new(
               tables: ["t1", "t2", "t3", "table", "another_table", "the_table"],
               columns: [
                 %{name: "id", type: "int8", pk_position: 0},
                 %{name: "number", type: "int8"},
                 %{name: "an_array", array_type: "int8"}
               ]
             )

  describe "affected_shapes/2" do
    test "returns shapes affected by insert" do
      filter =
        Filter.new()
        |> Filter.add_shape("s1", Shape.new!("t1", where: "id = 1", inspector: @inspector))
        |> Filter.add_shape("s2", Shape.new!("t1", where: "id = 2", inspector: @inspector))
        |> Filter.add_shape("s3", Shape.new!("t1", where: "id = 3", inspector: @inspector))
        |> Filter.add_shape("s4", Shape.new!("t2", where: "id = 2", inspector: @inspector))

      insert = %NewRecord{relation: {"public", "t1"}, record: %{"id" => "2"}}

      assert Filter.affected_shapes(filter, insert) == MapSet.new(["s2"])
    end

    test "returns shapes affected by delete" do
      filter =
        Filter.new()
        |> Filter.add_shape("s1", Shape.new!("t1", where: "id = 1", inspector: @inspector))
        |> Filter.add_shape("s2", Shape.new!("t1", where: "id = 2", inspector: @inspector))
        |> Filter.add_shape("s3", Shape.new!("t1", where: "id = 3", inspector: @inspector))
        |> Filter.add_shape("s4", Shape.new!("t2", where: "id = 2", inspector: @inspector))

      delete = %DeletedRecord{relation: {"public", "t1"}, old_record: %{"id" => "2"}}

      assert Filter.affected_shapes(filter, delete) == MapSet.new(["s2"])
    end

    test "returns shapes affected by update" do
      filter =
        Filter.new()
        |> Filter.add_shape("s1", Shape.new!("t1", where: "id = 1", inspector: @inspector))
        |> Filter.add_shape("s2", Shape.new!("t1", where: "id = 2", inspector: @inspector))
        |> Filter.add_shape("s3", Shape.new!("t1", where: "id = 3", inspector: @inspector))
        |> Filter.add_shape("s4", Shape.new!("t1", where: "id = 4", inspector: @inspector))
        |> Filter.add_shape("s5", Shape.new!("t2", where: "id = 2", inspector: @inspector))

      update = %UpdatedRecord{
        relation: {"public", "t1"},
        record: %{"id" => "2"},
        old_record: %{"id" => "3"}
      }

      assert Filter.affected_shapes(filter, update) == MapSet.new(["s2", "s3"])
    end

    test "returns shapes affected by relation change" do
      filter =
        Filter.new()
        |> Filter.add_shape("s1", Shape.new!("t1", where: "id = 1", inspector: @inspector))
        |> Filter.add_shape("s2", Shape.new!("t1", where: "id = 2", inspector: @inspector))
        |> Filter.add_shape("s3", Shape.new!("t1", where: "id > 7", inspector: @inspector))
        |> Filter.add_shape("s4", Shape.new!("t1", where: "id > 8", inspector: @inspector))
        |> Filter.add_shape(
          "s5",
          Shape.new!("t1", where: "an_array @> '{1,2}'", inspector: @inspector)
        )
        |> Filter.add_shape("s6", Shape.new!("t2", where: "id = 1", inspector: @inspector))
        |> Filter.add_shape("s7", Shape.new!("t2", where: "id = 2", inspector: @inspector))
        |> Filter.add_shape("s8", Shape.new!("t2", where: "id > 7", inspector: @inspector))
        |> Filter.add_shape("s9", Shape.new!("t2", where: "id > 8", inspector: @inspector))

      relation = %Relation{schema: "public", table: "t1"}

      assert Filter.affected_shapes(filter, relation) ==
               MapSet.new(["s1", "s2", "s3", "s4", "s5"])
    end

    test "returns shapes affected by relation rename" do
      table_id = 123
      s1 = Shape.new!("t1", inspector: @inspector)
      s2 = Shape.new!("t2", inspector: @inspector) |> Map.put(:root_table_id, table_id)
      s3 = Shape.new!("t3", inspector: @inspector)

      filter =
        Filter.new()
        |> Filter.add_shape("s1", s1)
        |> Filter.add_shape("s2", s2)
        |> Filter.add_shape("s3", s3)

      rename = %Relation{schema: "public", table: "new_name", id: table_id}

      assert Filter.affected_shapes(filter, rename) == MapSet.new(["s2"])
    end

    test "returns shapes affected by column addition" do
      s1 = Shape.new!("t1", inspector: @inspector)
      s2 = Shape.new!("t1", inspector: @inspector, columns: ["id", "number"])

      filter =
        Filter.new()
        |> Filter.add_shape("s1", s1)
        |> Filter.add_shape("s2", s2)

      rename = %Relation{
        schema: "public",
        table: "t1",
        id: s1.root_table_id,
        columns: ["id", "number", "an_array", "new one"]
      }

      assert Filter.affected_shapes(filter, rename) == MapSet.new(["s1"])
    end

    test "returns shapes affected by column change" do
      s1 = Shape.new!("t1", inspector: @inspector)
      s2 = Shape.new!("t1", inspector: @inspector, columns: ["id", "number"])
      s3 = Shape.new!("t1", inspector: @inspector, columns: ["id", "an_array"])

      filter =
        Filter.new()
        |> Filter.add_shape("s1", s1)
        |> Filter.add_shape("s2", s2)
        |> Filter.add_shape("s3", s3)

      rename = %Relation{
        schema: "public",
        table: "t1",
        id: s1.root_table_id,
        columns: ["id", "number", "an_array"],
        affected_columns: ["number"]
      }

      assert Filter.affected_shapes(filter, rename) == MapSet.new(["s1", "s2"])
    end

    test "returns shapes affected by truncation" do
      filter =
        Filter.new()
        |> Filter.add_shape("s1", Shape.new!("t1", where: "id = 1", inspector: @inspector))
        |> Filter.add_shape("s2", Shape.new!("t1", where: "id = 2", inspector: @inspector))
        |> Filter.add_shape("s3", Shape.new!("t1", where: "id > 7", inspector: @inspector))
        |> Filter.add_shape("s4", Shape.new!("t1", where: "id > 8", inspector: @inspector))
        |> Filter.add_shape("s5", Shape.new!("t2", where: "id = 1", inspector: @inspector))
        |> Filter.add_shape("s6", Shape.new!("t2", where: "id = 2", inspector: @inspector))
        |> Filter.add_shape("s7", Shape.new!("t2", where: "id > 7", inspector: @inspector))
        |> Filter.add_shape("s8", Shape.new!("t2", where: "id > 8", inspector: @inspector))

      truncation = %TruncatedRelation{relation: {"public", "t1"}}

      assert Filter.affected_shapes(filter, truncation) == MapSet.new(["s1", "s2", "s3", "s4"])
    end

    test "shape with no where clause is affected by all changes for the same table" do
      shape = Shape.new!("t1", inspector: @inspector)
      filter = Filter.new() |> Filter.add_shape("s", shape)

      assert Filter.affected_shapes(filter, change("t1", %{"id" => "7"})) == MapSet.new(["s"])
      assert Filter.affected_shapes(filter, change("t1", %{"id" => "8"})) == MapSet.new(["s"])
      assert Filter.affected_shapes(filter, change("t2", %{"id" => "8"})) == MapSet.new([])
    end

    test "shape with a where clause is affected by changes that match that where clause" do
      shape = Shape.new!("t1", where: "id = 7", inspector: @inspector)
      filter = Filter.new() |> Filter.add_shape("s", shape)

      assert Filter.affected_shapes(filter, change("t1", %{"id" => "7"})) == MapSet.new(["s"])
      assert Filter.affected_shapes(filter, change("t1", %{"id" => "8"})) == MapSet.new([])
      assert Filter.affected_shapes(filter, change("t2", %{"id" => "8"})) == MapSet.new([])
    end

    test "invalid record value logs an error and says all shapes for the table are affected" do
      filter =
        Filter.new()
        |> Filter.add_shape("shape1", Shape.new!("table", inspector: @inspector))
        |> Filter.add_shape("shape2", Shape.new!("table", where: "id = 7", inspector: @inspector))
        |> Filter.add_shape("shape3", Shape.new!("table", where: "id = 8", inspector: @inspector))
        |> Filter.add_shape("shape4", Shape.new!("table", where: "id > 9", inspector: @inspector))
        |> Filter.add_shape("shape5", Shape.new!("another_table", inspector: @inspector))

      log =
        capture_log(fn ->
          assert Filter.affected_shapes(filter, change("table", %{"id" => "invalid_value"})) ==
                   MapSet.new(["shape1", "shape2", "shape3", "shape4"])
        end)

      assert log =~ ~s(Could not parse value for field "id" of type :int8)
    end

    test "supports `array_field @> const_array`" do
      shape_count = Enum.random(0..50)
      change_array_size = Enum.random(0..10)
      array_value_population = 5

      change_array =
        Stream.repeatedly(fn -> Enum.random(1..array_value_population) end)
        |> Enum.take(change_array_size)

      shape_arrays =
        Stream.repeatedly(fn ->
          shape_array_size = Enum.random(0..3)

          Stream.repeatedly(fn -> Enum.random(1..array_value_population) end)
          |> Enum.take(shape_array_size)
        end)
        |> Stream.uniq_by(& &1)
        |> Enum.take(shape_count)

      where_clause = fn shape_array ->
        # Randomly choose between `@>` and `<@` to test both forms
        if Enum.random(0..1) == 0 do
          "an_array @> '{#{Enum.join(shape_array, ",")}}'"
        else
          "'{#{Enum.join(shape_array, ",")}}' <@ an_array"
        end
      end

      filter =
        shape_arrays
        |> Enum.reduce(Filter.new(), fn shape_array, filter ->
          Filter.add_shape(
            filter,
            shape_array,
            Shape.new!("t1",
              where: where_clause.(shape_array),
              inspector: @inspector
            )
          )
        end)

      change = change("t1", %{"an_array" => "{#{change_array |> Enum.join(", ")}}"})

      expected_affected_shapes =
        shape_arrays
        |> Enum.filter(fn shape_array ->
          shape_array |> MapSet.new() |> MapSet.subset?(MapSet.new(change_array))
        end)
        |> MapSet.new()

      assert Filter.affected_shapes(filter, change) == expected_affected_shapes
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
          %{where: "an_array = '{1}'", record: %{"an_array" => "{1,2}"}, affected: false},
          %{where: "an_array @> '{1}'", record: %{"an_array" => "{1,2}"}, affected: true},
          %{where: "an_array @> '{1,3}'", record: %{"an_array" => "{1,2}"}, affected: false},
          %{where: "an_array @> '{1,3}'", record: %{"an_array" => "{1,3}"}, affected: true},
          %{where: "an_array @> '{}'", record: %{"an_array" => "{1,3}"}, affected: true},
          %{where: "an_array @> '{}'", record: %{"an_array" => "{}"}, affected: true},
          %{where: "an_array @> '{}'", record: %{"an_array" => nil}, affected: false},
          %{where: "an_array @> NULL", record: %{"an_array" => nil}, affected: false}
        ] do
      test "where: #{test.where}, record: #{inspect(test.record)}" do
        %{where: where, record: record, affected: affected} = unquote(Macro.escape(test))

        shape = Shape.new!("the_table", where: where, inspector: @inspector)

        transaction = change("the_table", record)

        assert Filter.new()
               |> Filter.add_shape("the-shape", shape)
               |> Filter.affected_shapes(transaction) == MapSet.new(["the-shape"]) == affected
      end
    end
  end

  test "Filter.remove_shape/2" do
    shapes = [
      Shape.new!("table", inspector: @inspector),
      Shape.new!("another_table", inspector: @inspector),
      Shape.new!("table", where: "id = 1", inspector: @inspector),
      Shape.new!("table", where: "id = 2", inspector: @inspector),
      Shape.new!("table", where: "id > 2", inspector: @inspector),
      Shape.new!("table", where: "id > 7", inspector: @inspector),
      Shape.new!("table", where: "an_array @> '{}'", inspector: @inspector),
      Shape.new!("table", where: "an_array @> '{1}'", inspector: @inspector),
      Shape.new!("table", where: "an_array @> '{1,2}'", inspector: @inspector),
      Shape.new!("table", where: "an_array @> '{1,3}'", inspector: @inspector),
      Shape.new!("table", where: "id = 1 AND an_array @> '{1}'", inspector: @inspector),
      Shape.new!("table", where: "id = 1 AND an_array @> '{1,2}'", inspector: @inspector)
    ]

    shapes
    |> Enum.shuffle()
    |> Enum.with_index()
    |> Enum.reduce(Filter.new(), fn {shape, i}, filter ->
      filter_with_shape_added = Filter.add_shape(filter, i, shape)

      # Check that whenever you remove a shape the filter is the same as if the shape was never added
      assert Filter.remove_shape(filter_with_shape_added, i) == filter

      filter_with_shape_added
    end)
  end

  describe "optimisations" do
    # These tests assert that the number of reductions needed to calculate the affected shapes
    # when there at @shape_count shapes is less than @max_reductions.
    #
    # Reductions are used as a proxy for time taken for the calculation and
    # have been chosen instead of time since the time taken is not deterministic and
    # leads to flakey tests.
    #
    # Modern machines process approx 300-400 reductions per μs so @max_reductions of 1300
    # is roughly equivalent to 3μs.
    #
    # 3μs per change is a desirable and achievable target for replication stream processing.
    # If optimised processing becomes slower than this we should discuss as a team to see if
    # the performance is acceptable.
    #
    # @shape_count is set to 1000. This is somewhat arbitrary but is a reasonable number of shapes.
    # The main point is we don't want to linearly scale with the number of shapes, we want
    # O(1) or at worst O(log n) performance, so if we have that, 1000 or 10_000 shapes should be easy
    # to keep to a microsecond per change. 10_000 shapes makes for a slow test though as the setup
    # time (n Filter.add_shape calls) is slow.
    @shape_count 1000
    @max_reductions 1300

    test "where clause in the form `field = const` is optimised" do
      filter =
        1..@shape_count
        |> Enum.reduce(Filter.new(), fn i, filter ->
          Filter.add_shape(filter, i, Shape.new!("t1", where: "id = #{i}", inspector: @inspector))
        end)

      assert Filter.affected_shapes(filter, change("t1", %{"id" => "7"})) == MapSet.new([7])

      reductions =
        reductions(fn ->
          Filter.affected_shapes(filter, change("t1", %{"id" => "7"}))
        end)

      assert reductions < @max_reductions
    end

    test "where clause in the form `field = const AND another_condition` is optimised" do
      filter =
        1..@shape_count
        |> Enum.reduce(Filter.new(), fn i, filter ->
          Filter.add_shape(
            filter,
            i,
            Shape.new!("t1", where: "id = #{i} AND id > 6", inspector: @inspector)
          )
        end)

      assert Filter.affected_shapes(filter, change("t1", %{"id" => "7"})) == MapSet.new([7])

      reductions =
        reductions(fn ->
          Filter.affected_shapes(filter, change("t1", %{"id" => "7"}))
        end)

      assert reductions < @max_reductions
    end

    test "where clause in the form `a_condition AND field = const` is optimised" do
      filter =
        1..@shape_count
        |> Enum.reduce(Filter.new(), fn i, filter ->
          Filter.add_shape(
            filter,
            i,
            Shape.new!("t1", where: "id > 6 AND id = #{i}", inspector: @inspector)
          )
        end)

      assert Filter.affected_shapes(filter, change("t1", %{"id" => "7"})) == MapSet.new([7])

      reductions =
        reductions(fn ->
          Filter.affected_shapes(filter, change("t1", %{"id" => "7"}))
        end)

      assert reductions < @max_reductions
    end

    test "where clause in the form `field1 = const1 AND field2 = const2` is optimised for lots of const1 values" do
      filter =
        1..@shape_count
        |> Enum.reduce(Filter.new(), fn i, filter ->
          Filter.add_shape(
            filter,
            i,
            Shape.new!("t1", where: "id = #{i} AND number = 11", inspector: @inspector)
          )
        end)

      change = change("t1", %{"id" => "5", "number" => "11"})
      assert Filter.affected_shapes(filter, change) == MapSet.new([5])

      reductions = reductions(fn -> Filter.affected_shapes(filter, change) end)

      assert reductions < @max_reductions
    end

    test "where clause in the form `field1 = const1 AND field2 = const2` is optimised for lots of const2 values" do
      filter =
        1..@shape_count
        |> Enum.reduce(Filter.new(), fn i, filter ->
          Filter.add_shape(
            filter,
            i,
            Shape.new!("t1", where: "id = 7 AND number = #{i}", inspector: @inspector)
          )
        end)

      change = change("t1", %{"id" => "7", "number" => "9"})
      assert Filter.affected_shapes(filter, change) == MapSet.new([9])

      reductions = reductions(fn -> Filter.affected_shapes(filter, change) end)

      assert reductions < @max_reductions
    end

    test "where clause in the form `array_field @> const_array` is optimised" do
      # The optimisation for `@>` is less performant than the other optimisations,
      # however it performs well with lots of shapes. While it can't do
      # `@shape_count` shapes in < `@max_reductions` reductions, it can do
      # `@shape_count * 5` shapes in < `@max_reductions * 5` reductions.
      multiplier = 5
      shape_count = @shape_count * multiplier
      max_reductions = @max_reductions * multiplier

      chosen_numbers = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29]
      matching_array = {5, 11, 29}

      filter =
        for(
          x <- 1..100,
          y <- 1..100,
          z <- 1..100,
          x < y,
          y < z,
          not (x in chosen_numbers && y in chosen_numbers && z in chosen_numbers),
          do: {x, y, z}
        )
        |> Enum.take_random(shape_count - 1)
        |> Enum.concat([matching_array])
        |> Enum.shuffle()
        |> Enum.reduce(Filter.new(), fn {x, y, z}, filter ->
          Filter.add_shape(
            filter,
            {x, y, z},
            Shape.new!("t1", where: "an_array @> '{#{x}, #{y}, #{z}}'", inspector: @inspector)
          )
        end)

      change = change("t1", %{"an_array" => "{#{chosen_numbers |> Enum.join(", ")}}"})
      assert Filter.affected_shapes(filter, change) == MapSet.new([matching_array])

      reductions = reductions(fn -> Filter.affected_shapes(filter, change) end)

      assert reductions < max_reductions
    end

    defp reductions(fun) do
      {:reductions, reductions_before} = :erlang.process_info(self(), :reductions)
      fun.()
      {:reductions, reductions_after} = :erlang.process_info(self(), :reductions)
      reductions_after - reductions_before
    end
  end

  defp change(table, record) do
    %NewRecord{
      relation: {"public", table},
      record: record
    }
  end
end
