defmodule Electric.Shapes.FilterTest do
  use ExUnit.Case

  import ExUnit.CaptureLog

  alias Electric.Replication.Changes.DeletedRecord
  alias Electric.Replication.Changes.NewRecord
  alias Electric.Replication.Changes.Relation
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

    @where_clause_tests [
      %{
        where: "id = 7",
        records: [
          {%{"id" => "7"}, true},
          {%{"id" => "8"}, false},
          {%{"id" => nil}, false}
        ]
      },
      %{
        where: "7 = id",
        records: [
          {%{"id" => "7"}, true},
          {%{"id" => "8"}, false},
          {%{"id" => nil}, false}
        ]
      },
      %{
        where: "id = 7 AND id > 1",
        records: [
          {%{"id" => "7"}, true},
          {%{"id" => "8"}, false}
        ]
      },
      %{
        where: "id = 7 AND id > 8",
        records: [
          {%{"id" => "7"}, false}
        ]
      },
      %{
        where: "id > 1 AND id = 7",
        records: [
          {%{"id" => "7"}, true},
          {%{"id" => "8"}, false}
        ]
      },
      %{
        where: "id > 8 AND id = 7",
        records: [
          {%{"id" => "7"}, false}
        ]
      },
      %{
        where: "an_array = '{1}'",
        records: [
          {%{"an_array" => "{1}"}, true},
          {%{"an_array" => "{2}"}, false},
          {%{"an_array" => "{1,2}"}, false}
        ]
      },
      %{
        where: "an_array @> '{1}'",
        records: [
          {%{"an_array" => "{1}"}, true},
          {%{"an_array" => "{1,2}"}, true},
          {%{"an_array" => "{3,2,1}"}, true},
          {%{"an_array" => "{2}"}, false},
          {%{"an_array" => "{2,3,4}"}, false},
          {%{"an_array" => nil}, false}
        ]
      },
      %{
        where: "an_array @> '{1,3}'",
        records: [
          {%{"an_array" => "{1,3}"}, true},
          {%{"an_array" => "{3,1}"}, true},
          {%{"an_array" => "{1,2,3}"}, true},
          {%{"an_array" => "{1,2}"}, false},
          {%{"an_array" => "{2,3,4}"}, false},
          {%{"an_array" => nil}, false}
        ]
      },
      %{
        where: "an_array @> '{}'",
        records: [
          {%{"an_array" => "{1,3}"}, true},
          {%{"an_array" => "{}"}, true},
          {%{"an_array" => nil}, false}
        ]
      },
      %{
        where: "an_array @> NULL",
        records: [
          {%{"an_array" => "{1}"}, false},
          {%{"an_array" => "{1,2,3}"}, false},
          {%{"an_array" => nil}, false}
        ]
      },
      %{
        where: "id = 7 AND number > 3 AND number < 10",
        records: [
          {%{"id" => "7", "number" => "5"}, true},
          {%{"id" => "7", "number" => "9"}, true},
          {%{"id" => "7", "number" => "3"}, false},
          {%{"id" => "7", "number" => "10"}, false},
          {%{"id" => "8", "number" => "5"}, false},
          {%{"id" => nil, "number" => "5"}, false}
        ]
      },
      %{
        where: "id > 5 AND id < 10 AND number = 7",
        records: [
          {%{"id" => "7", "number" => "7"}, true},
          {%{"id" => "9", "number" => "7"}, true},
          {%{"id" => "5", "number" => "7"}, false},
          {%{"id" => "10", "number" => "7"}, false},
          {%{"id" => "7", "number" => "8"}, false}
        ]
      },
      %{
        where: "an_array @> '{1}' AND id = 7",
        records: [
          {%{"id" => "7", "an_array" => "{1}"}, true},
          {%{"id" => "7", "an_array" => "{1,2}"}, true},
          {%{"id" => "7", "an_array" => "{3,2,1}"}, true},
          {%{"id" => "7", "an_array" => "{2}"}, false},
          {%{"id" => "7", "an_array" => "{2,3,4}"}, false},
          {%{"id" => "8", "an_array" => "{1}"}, false},
          {%{"id" => "8", "an_array" => "{1,2,3}"}, false},
          {%{"id" => "7", "an_array" => nil}, false},
          {%{"id" => nil, "an_array" => "{1}"}, false}
        ]
      },
      %{
        where: "id = 7 AND an_array @> '{1}'",
        records: [
          {%{"id" => "7", "an_array" => "{1}"}, true},
          {%{"id" => "7", "an_array" => "{1,2}"}, true},
          {%{"id" => "7", "an_array" => "{3,2,1}"}, true},
          {%{"id" => "7", "an_array" => "{2}"}, false},
          {%{"id" => "8", "an_array" => "{1}"}, false},
          {%{"id" => "7", "an_array" => nil}, false}
        ]
      },
      %{
        where: "1 = ANY(an_array)",
        records: [
          {%{"an_array" => "{1}"}, true},
          {%{"an_array" => "{1,2}"}, true},
          {%{"an_array" => "{3,2,1}"}, true},
          {%{"an_array" => "{2}"}, false},
          {%{"an_array" => "{2,3,4}"}, false},
          {%{"an_array" => nil}, false}
        ]
      },
      %{
        where: "1 = ANY(an_array) AND id = 7",
        records: [
          {%{"id" => "7", "an_array" => "{1}"}, true},
          {%{"id" => "7", "an_array" => "{1,2}"}, true},
          {%{"id" => "7", "an_array" => "{2}"}, false},
          {%{"id" => "8", "an_array" => "{1}"}, false},
          {%{"id" => "7", "an_array" => nil}, false}
        ]
      },
      %{
        where: "id = 7 AND 1 = ANY(an_array)",
        records: [
          {%{"id" => "7", "an_array" => "{1}"}, true},
          {%{"id" => "7", "an_array" => "{1,2}"}, true},
          {%{"id" => "7", "an_array" => "{2}"}, false},
          {%{"id" => "8", "an_array" => "{1}"}, false},
          {%{"id" => "7", "an_array" => nil}, false}
        ]
      },
      %{
        where: "id IN (1, 2, 3)",
        records: [
          {%{"id" => "1"}, true},
          {%{"id" => "2"}, true},
          {%{"id" => "3"}, true},
          {%{"id" => "4"}, false},
          {%{"id" => "0"}, false}
        ]
      },
      %{
        where: "id IN (1, 2) AND number > 5",
        records: [
          {%{"id" => "1", "number" => "6"}, true},
          {%{"id" => "2", "number" => "10"}, true},
          {%{"id" => "1", "number" => "3"}, false},
          {%{"id" => "3", "number" => "6"}, false}
        ]
      },
      %{
        where: "number > 5 AND id IN (1, 2)",
        records: [
          {%{"id" => "1", "number" => "6"}, true},
          {%{"id" => "2", "number" => "10"}, true},
          {%{"id" => "1", "number" => "3"}, false},
          {%{"id" => "3", "number" => "6"}, false}
        ]
      }
    ]

    for %{where: where, records: records} <- @where_clause_tests do
      for {record, affected} <- records do
        test "where: #{where}, record: #{inspect(record)}" do
          where = unquote(where)
          record = unquote(Macro.escape(record))
          affected = unquote(affected)

          shape = Shape.new!("the_table", where: where, inspector: @inspector)
          transaction = change("the_table", record)

          assert Filter.new()
                 |> Filter.add_shape("the-shape", shape)
                 |> Filter.affected_shapes(transaction) == MapSet.new(["the-shape"]) == affected
        end
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
      Shape.new!("table", where: "id = 1 AND an_array @> '{1,2}'", inspector: @inspector),
      Shape.new!("table", where: "1 = ANY(an_array)", inspector: @inspector),
      Shape.new!("table", where: "2 = ANY(an_array)", inspector: @inspector),
      Shape.new!("table", where: "id = 1 AND 1 = ANY(an_array)", inspector: @inspector),
      Shape.new!("table", where: "id IN (1, 2, 3)", inspector: @inspector),
      Shape.new!("table", where: "id IN (4, 5)", inspector: @inspector),
      Shape.new!("table", where: "id IN (1, 2) AND number > 5", inspector: @inspector)
    ]

    filter = Filter.new()

    shapes
    |> Enum.shuffle()
    |> Enum.with_index(fn shape, i ->
      # Capture ETS state before adding
      state_before = snapshot_filter_ets(filter)

      Filter.add_shape(filter, i, shape)

      # Ensure that the ETS state has changed after adding
      # (checks we've included all the ets tables in the snapshot)
      assert snapshot_filter_ets(filter) != state_before

      # Remove the shape
      Filter.remove_shape(filter, i)

      # Check that the ETS state after removing is the same as before adding
      assert snapshot_filter_ets(filter) == state_before

      # Add the shape back for the next iteration
      Filter.add_shape(filter, i, shape)
    end)
  end

  # Captures the full state of all ETS tables in a filter for comparison
  defp snapshot_filter_ets(filter) do
    %{
      shapes: :ets.tab2list(filter.shapes_table) |> Enum.sort(),
      tables: :ets.tab2list(filter.tables_table) |> Enum.sort(),
      where_cond: :ets.tab2list(filter.where_cond_table) |> Enum.sort(),
      eq_index: :ets.tab2list(filter.eq_index_table) |> Enum.sort(),
      incl_index: :ets.tab2list(filter.incl_index_table) |> Enum.sort(),
      subquery_shapes: :ets.tab2list(filter.subquery_shapes_table) |> Enum.sort()
    }
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
      filter = Filter.new()

      Enum.each(1..@shape_count, fn i ->
        shape = Shape.new!("t1", where: "id = #{i}", inspector: @inspector)
        add_reductions = reductions(fn -> Filter.add_shape(filter, i, shape) end)
        assert add_reductions < @max_reductions
      end)

      assert Filter.affected_shapes(filter, change("t1", %{"id" => "7"})) == MapSet.new([7])

      affected_reductions =
        reductions(fn ->
          Filter.affected_shapes(filter, change("t1", %{"id" => "7"}))
        end)

      assert affected_reductions < @max_reductions

      Enum.each(1..@shape_count, fn i ->
        remove_reductions = reductions(fn -> Filter.remove_shape(filter, i) end)
        assert remove_reductions < @max_reductions
      end)
    end

    test "where clause in the form `field = const AND another_condition` is optimised" do
      filter = Filter.new()

      Enum.each(1..@shape_count, fn i ->
        shape = Shape.new!("t1", where: "id = #{i} AND id > 6", inspector: @inspector)
        add_reductions = reductions(fn -> Filter.add_shape(filter, i, shape) end)
        assert add_reductions < @max_reductions
      end)

      assert Filter.affected_shapes(filter, change("t1", %{"id" => "7"})) == MapSet.new([7])

      affected_reductions =
        reductions(fn ->
          Filter.affected_shapes(filter, change("t1", %{"id" => "7"}))
        end)

      assert affected_reductions < @max_reductions

      Enum.each(1..@shape_count, fn i ->
        remove_reductions = reductions(fn -> Filter.remove_shape(filter, i) end)
        assert remove_reductions < @max_reductions
      end)
    end

    test "where clause in the form `a_condition AND field = const` is optimised" do
      filter = Filter.new()

      Enum.each(1..@shape_count, fn i ->
        shape = Shape.new!("t1", where: "id > 6 AND id = #{i}", inspector: @inspector)
        add_reductions = reductions(fn -> Filter.add_shape(filter, i, shape) end)
        assert add_reductions < @max_reductions
      end)

      assert Filter.affected_shapes(filter, change("t1", %{"id" => "7"})) == MapSet.new([7])

      affected_reductions =
        reductions(fn ->
          Filter.affected_shapes(filter, change("t1", %{"id" => "7"}))
        end)

      assert affected_reductions < @max_reductions

      Enum.each(1..@shape_count, fn i ->
        remove_reductions = reductions(fn -> Filter.remove_shape(filter, i) end)
        assert remove_reductions < @max_reductions
      end)
    end

    test "where clause in the form `field1 = const1 AND field2 = const2` is optimised for lots of const1 values" do
      filter = Filter.new()

      Enum.each(1..@shape_count, fn i ->
        shape = Shape.new!("t1", where: "id = #{i} AND number = 11", inspector: @inspector)
        add_reductions = reductions(fn -> Filter.add_shape(filter, i, shape) end)
        assert add_reductions < @max_reductions
      end)

      change = change("t1", %{"id" => "5", "number" => "11"})
      assert Filter.affected_shapes(filter, change) == MapSet.new([5])

      affected_reductions = reductions(fn -> Filter.affected_shapes(filter, change) end)

      assert affected_reductions < @max_reductions

      Enum.each(1..@shape_count, fn i ->
        remove_reductions = reductions(fn -> Filter.remove_shape(filter, i) end)
        assert remove_reductions < @max_reductions
      end)
    end

    test "where clause in the form `field1 = const1 AND field2 = const2` is optimised for lots of const2 values" do
      filter = Filter.new()

      Enum.each(1..@shape_count, fn i ->
        shape = Shape.new!("t1", where: "id = 7 AND number = #{i}", inspector: @inspector)
        add_reductions = reductions(fn -> Filter.add_shape(filter, i, shape) end)
        assert add_reductions < @max_reductions
      end)

      change = change("t1", %{"id" => "7", "number" => "9"})
      assert Filter.affected_shapes(filter, change) == MapSet.new([9])

      affected_reductions = reductions(fn -> Filter.affected_shapes(filter, change) end)

      assert affected_reductions < @max_reductions

      Enum.each(1..@shape_count, fn i ->
        remove_reductions = reductions(fn -> Filter.remove_shape(filter, i) end)
        assert remove_reductions < @max_reductions
      end)
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

      filter = Filter.new()

      arrays =
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

      Enum.each(arrays, fn {x, y, z} = array ->
        shape = Shape.new!("t1", where: "an_array @> '{#{x}, #{y}, #{z}}'", inspector: @inspector)
        add_reductions = reductions(fn -> Filter.add_shape(filter, array, shape) end)
        assert add_reductions < max_reductions
      end)

      change = change("t1", %{"an_array" => "{#{chosen_numbers |> Enum.join(", ")}}"})
      assert Filter.affected_shapes(filter, change) == MapSet.new([matching_array])

      affected_reductions = reductions(fn -> Filter.affected_shapes(filter, change) end)

      assert affected_reductions < max_reductions

      Enum.each(arrays, fn array ->
        remove_reductions = reductions(fn -> Filter.remove_shape(filter, array) end)
        assert remove_reductions < max_reductions
      end)
    end

    test "where clause in the form `const = ANY(array_field)` is optimised" do
      # Same shape count as @> but higher budget per shape because the ANY
      # AST is deeper to pattern-match through optimise_where
      shape_count = @shape_count * 5
      max_reductions = @max_reductions * 10

      filter = Filter.new()

      Enum.each(1..shape_count, fn i ->
        shape = Shape.new!("t1", where: "#{i} = ANY(an_array)", inspector: @inspector)
        add_reductions = reductions(fn -> Filter.add_shape(filter, i, shape) end)
        assert add_reductions < max_reductions
      end)

      change = change("t1", %{"an_array" => "{7}"})
      assert Filter.affected_shapes(filter, change) == MapSet.new([7])

      affected_reductions = reductions(fn -> Filter.affected_shapes(filter, change) end)

      assert affected_reductions < max_reductions

      Enum.each(1..shape_count, fn i ->
        remove_reductions = reductions(fn -> Filter.remove_shape(filter, i) end)
        assert remove_reductions < max_reductions
      end)
    end

    test "where clause in the form `field IN (const1, const2, ...)` is optimised" do
      filter = Filter.new()

      Enum.each(1..@shape_count, fn i ->
        shape =
          Shape.new!("t1", where: "id IN (#{i}, #{i + @shape_count})", inspector: @inspector)

        add_reductions = reductions(fn -> Filter.add_shape(filter, i, shape) end)
        assert add_reductions < @max_reductions
      end)

      change = change("t1", %{"id" => "7"})
      assert Filter.affected_shapes(filter, change) == MapSet.new([7])

      affected_reductions = reductions(fn -> Filter.affected_shapes(filter, change) end)

      assert affected_reductions < @max_reductions

      Enum.each(1..@shape_count, fn i ->
        remove_reductions = reductions(fn -> Filter.remove_shape(filter, i) end)
        assert remove_reductions < @max_reductions
      end)
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

  describe "subquery shapes are always routed in filter" do
    import Support.DbSetup
    import Support.DbStructureSetup
    import Support.ComponentSetup

    setup [
      :with_stack_id_from_test,
      :with_shared_db,
      :with_persistent_kv,
      :with_inspector,
      :with_sql_execute
    ]

    @tag with_sql: [
           "CREATE TABLE IF NOT EXISTS parent (id INT PRIMARY KEY)",
           "CREATE TABLE IF NOT EXISTS child (id INT PRIMARY KEY, par_id INT REFERENCES parent(id))"
         ]
    test "subquery shape is always routed for root table changes",
         %{inspector: inspector} do
      {:ok, shape} =
        Shape.new("child",
          inspector: inspector,
          where: "par_id = 7 AND id IN (SELECT id FROM parent)"
        )

      refs_fun = fn _shape ->
        %{["$sublink", "0"] => MapSet.new([1, 2, 3])}
      end

      filter =
        Filter.new(refs_fun: refs_fun)
        |> Filter.add_shape("shape1", shape)

      insert_matching = %NewRecord{
        relation: {"public", "child"},
        record: %{"id" => "1", "par_id" => "7"}
      }

      assert Filter.affected_shapes(filter, insert_matching) == MapSet.new(["shape1"])

      insert_not_in_subquery = %NewRecord{
        relation: {"public", "child"},
        record: %{"id" => "99", "par_id" => "7"}
      }

      assert Filter.affected_shapes(filter, insert_not_in_subquery) == MapSet.new(["shape1"])

      insert_wrong_par_id = %NewRecord{
        relation: {"public", "child"},
        record: %{"id" => "1", "par_id" => "8"}
      }

      assert Filter.affected_shapes(filter, insert_wrong_par_id) == MapSet.new(["shape1"])

      insert_on_other_table = %NewRecord{
        relation: {"public", "parent"},
        record: %{"id" => "1"}
      }

      assert Filter.affected_shapes(filter, insert_on_other_table) == MapSet.new([])
    end

    @tag with_sql: [
           "CREATE TABLE IF NOT EXISTS incl_parent (id INT PRIMARY KEY)",
           "CREATE TABLE IF NOT EXISTS incl_child (id INT PRIMARY KEY, par_id INT REFERENCES incl_parent(id), tags int[] NOT NULL)"
         ]
    test "subquery shape ignores inclusion and subquery values for routing",
         %{inspector: inspector} do
      {:ok, shape} =
        Shape.new("incl_child",
          inspector: inspector,
          where: "tags @> '{1,2}' AND id IN (SELECT id FROM incl_parent)"
        )

      # Create refs_fun that returns sublink values based on the shape
      refs_fun = fn _shape ->
        %{["$sublink", "0"] => MapSet.new([10, 20, 30])}
      end

      filter =
        Filter.new(refs_fun: refs_fun)
        |> Filter.add_shape("shape1", shape)

      insert_matching = %NewRecord{
        relation: {"public", "incl_child"},
        record: %{"id" => "10", "par_id" => "7", "tags" => "{1,2,3}"}
      }

      assert Filter.affected_shapes(filter, insert_matching) == MapSet.new(["shape1"])

      insert_not_in_subquery = %NewRecord{
        relation: {"public", "incl_child"},
        record: %{"id" => "99", "par_id" => "7", "tags" => "{1,2,3}"}
      }

      assert Filter.affected_shapes(filter, insert_not_in_subquery) == MapSet.new(["shape1"])

      insert_wrong_tags = %NewRecord{
        relation: {"public", "incl_child"},
        record: %{"id" => "10", "par_id" => "7", "tags" => "{3,4}"}
      }

      assert Filter.affected_shapes(filter, insert_wrong_tags) == MapSet.new(["shape1"])
    end

    @tag with_sql: [
           "CREATE TABLE IF NOT EXISTS parent (id INT PRIMARY KEY)",
           "CREATE TABLE IF NOT EXISTS child (id INT PRIMARY KEY, par_id INT REFERENCES parent(id))"
         ]
    test "all subquery shapes for the table are routed when multiple shapes exist", %{
      inspector: inspector
    } do
      {:ok, shape1} =
        Shape.new("child",
          inspector: inspector,
          where: "par_id = 7 AND id IN (SELECT id FROM parent)"
        )

      {:ok, shape2} =
        Shape.new("child",
          inspector: inspector,
          where: "par_id = 8 AND id IN (SELECT id FROM parent)"
        )

      refs_fun = fn shape ->
        if shape.where.query =~ "par_id = 7" do
          %{["$sublink", "0"] => MapSet.new([1, 2])}
        else
          %{["$sublink", "0"] => MapSet.new([3, 4])}
        end
      end

      filter =
        Filter.new(refs_fun: refs_fun)
        |> Filter.add_shape("shape1", shape1)
        |> Filter.add_shape("shape2", shape2)

      insert1 = %NewRecord{
        relation: {"public", "child"},
        record: %{"id" => "1", "par_id" => "7"}
      }

      assert Filter.affected_shapes(filter, insert1) == MapSet.new(["shape1", "shape2"])

      insert2 = %NewRecord{
        relation: {"public", "child"},
        record: %{"id" => "3", "par_id" => "8"}
      }

      assert Filter.affected_shapes(filter, insert2) == MapSet.new(["shape1", "shape2"])

      insert3 = %NewRecord{
        relation: {"public", "child"},
        record: %{"id" => "3", "par_id" => "7"}
      }

      assert Filter.affected_shapes(filter, insert3) == MapSet.new(["shape1", "shape2"])
    end

    @tag with_sql: [
           "CREATE TABLE IF NOT EXISTS nested_parent (id INT PRIMARY KEY)",
           "CREATE TABLE IF NOT EXISTS nested_child (id INT PRIMARY KEY, field1 INT NOT NULL, field2 INT REFERENCES nested_parent(id))"
         ]
    test "subquery shape with nested equality conditions is always routed", %{
      inspector: inspector
    } do
      {:ok, shape} =
        Shape.new("nested_child",
          inspector: inspector,
          where: "field1 = 10 AND field2 = 20 AND id IN (SELECT id FROM nested_parent)"
        )

      refs_fun = fn _shape ->
        %{["$sublink", "0"] => MapSet.new([1, 2, 3])}
      end

      filter =
        Filter.new(refs_fun: refs_fun)
        |> Filter.add_shape("shape1", shape)

      insert_matching = %NewRecord{
        relation: {"public", "nested_child"},
        record: %{"id" => "1", "field1" => "10", "field2" => "20"}
      }

      assert Filter.affected_shapes(filter, insert_matching) == MapSet.new(["shape1"])

      insert_not_in_subquery = %NewRecord{
        relation: {"public", "nested_child"},
        record: %{"id" => "99", "field1" => "10", "field2" => "20"}
      }

      assert Filter.affected_shapes(filter, insert_not_in_subquery) == MapSet.new(["shape1"])
    end
  end
end
