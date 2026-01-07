defmodule Electric.Shapes.Shape.SubqueryMovesTest do
  use ExUnit.Case, async: true

  alias Electric.Replication.Eval
  alias Electric.Shapes.Shape
  alias Electric.Shapes.Shape.SubqueryMoves

  @inspector Support.StubInspector.new(
               tables: ["parent", "child"],
               columns: [
                 %{name: "id", type: "int8", pk_position: 0, type_id: {20, 1}},
                 %{name: "value", type: "text", pk_position: nil, type_id: {28, 1}},
                 %{name: "parent_id", type: "int8", pk_position: nil, type_id: {20, 1}}
               ]
             )

  @composite_inspector Support.StubInspector.new(
                         tables: ["parent", "child"],
                         columns: [
                           %{name: "id1", type: "int4", pk_position: 0, type_id: {23, 1}},
                           %{name: "id2", type: "text", pk_position: 1, type_id: {28, 1}},
                           %{name: "col1", type: "int4", pk_position: nil, type_id: {23, 1}},
                           %{name: "col2", type: "text", pk_position: nil, type_id: {28, 1}},
                           %{name: "value", type: "int4", pk_position: nil, type_id: {23, 1}}
                         ]
                       )

  describe "move_in_where_clause/3" do
    test "generates ANY clause for single column subquery" do
      # Query in the shape is normalized on casing, and we're matching that casing for this test
      shape =
        Shape.new!("child",
          where: "parent_id IN (SELECT id FROM public.parent WHERE value = '1')",
          inspector: @inspector
        )
        |> fill_handles()

      move_ins = ["1", "2", "3"]

      {query, params} =
        SubqueryMoves.move_in_where_clause(
          shape,
          Enum.at(shape.shape_dependencies_handles, 0),
          move_ins
        )

      assert query == "parent_id = ANY ($1::text[]::int8[])"
      assert params == [["1", "2", "3"]]
    end

    test "generates unnest clause for composite key subquery" do
      shape =
        Shape.new!("child",
          where: "(col1, col2) IN (SELECT id1, id2 FROM public.parent WHERE value = 1)",
          inspector: @composite_inspector
        )
        |> fill_handles()

      # Move-ins for composite keys come as tuples
      move_ins = [{"1", "a"}, {"2", "b"}]

      {query, params} =
        SubqueryMoves.move_in_where_clause(
          shape,
          Enum.at(shape.shape_dependencies_handles, 0),
          move_ins
        )

      assert query ==
               "(col1, col2) IN (SELECT * FROM unnest($1::text[]::int4[], $2::text[]::text[]))"

      assert params == [["1", "2"], ["a", "b"]]
    end

    test "handles shape without where clause in dependency" do
      shape =
        Shape.new!("child",
          where: "parent_id IN (SELECT id FROM public.parent)",
          inspector: @inspector
        )
        |> fill_handles()

      move_ins = ["1"]

      {query, params} =
        SubqueryMoves.move_in_where_clause(
          shape,
          Enum.at(shape.shape_dependencies_handles, 0),
          move_ins
        )

      assert query == "parent_id = ANY ($1::text[]::int8[])"
      assert params == [["1"]]
    end
  end

  describe "make_move_out_control_message/2" do
    test "creates control message with patterns for single values" do
      shape = %Shape{
        root_table: {"public", "child"},
        root_table_id: 1,
        shape_dependencies_handles: ["dep-handle-1"],
        tag_structure: %{["$sublink", "0"] => ["parent_id"]}
      }

      move_outs = [{"dep-handle-1", [{1, "1"}, {2, "2"}, {3, "3"}]}]

      message =
        SubqueryMoves.make_move_out_control_message(shape, "stack-id", "shape-handle", move_outs)

      # Tags now include sublink index in the hash
      tag1 =
        :crypto.hash(:md5, "stack-id" <> "shape-handle" <> "sublink:0:" <> "1")
        |> Base.encode16(case: :lower)

      tag2 =
        :crypto.hash(:md5, "stack-id" <> "shape-handle" <> "sublink:0:" <> "2")
        |> Base.encode16(case: :lower)

      tag3 =
        :crypto.hash(:md5, "stack-id" <> "shape-handle" <> "sublink:0:" <> "3")
        |> Base.encode16(case: :lower)

      assert message == %{
               headers: %{
                 event: "move-out",
                 patterns: [
                   %{pos: 0, value: tag1},
                   %{pos: 0, value: tag2},
                   %{pos: 0, value: tag3}
                 ]
               }
             }
    end

    test "creates patterns for composite values" do
      shape = %Shape{
        root_table: {"public", "child"},
        root_table_id: 1,
        shape_dependencies_handles: ["dep-handle-1"],
        tag_structure: %{["$sublink", "0"] => [{:hash_together, ["col1", "col2"]}]}
      }

      # Composite keys are represented as lists
      move_outs = [{"dep-handle-1", [{{1, "a"}, {"1", "a"}}, {{2, "b"}, {"2", "b"}}]}]

      message =
        SubqueryMoves.make_move_out_control_message(shape, "stack-id", "shape-handle", move_outs)

      # Tags now include sublink index in the hash
      tag1 =
        :crypto.hash(:md5, "stack-id" <> "shape-handle" <> "sublink:0:" <> "col1:1:col2:a")
        |> Base.encode16(case: :lower)

      tag2 =
        :crypto.hash(:md5, "stack-id" <> "shape-handle" <> "sublink:0:" <> "col1:2:col2:b")
        |> Base.encode16(case: :lower)

      assert message == %{
               headers: %{
                 event: "move-out",
                 patterns: [%{pos: 0, value: tag1}, %{pos: 0, value: tag2}]
               }
             }
    end

    test "only emits patterns for the correct dependency in multi-subquery shapes" do
      shape = %Shape{
        root_table: {"public", "child"},
        root_table_id: 1,
        shape_dependencies_handles: ["dep-handle-1", "dep-handle-2"],
        tag_structure: %{
          ["$sublink", "0"] => ["col1"],
          ["$sublink", "1"] => ["col2"]
        }
      }

      # Only move-out for the second dependency
      move_outs = [{"dep-handle-2", [{1, "x"}, {2, "y"}]}]

      message =
        SubqueryMoves.make_move_out_control_message(shape, "stack-id", "shape-handle", move_outs)

      # Tags should only be for dependency index 1
      tag1 =
        :crypto.hash(:md5, "stack-id" <> "shape-handle" <> "sublink:1:" <> "x")
        |> Base.encode16(case: :lower)

      tag2 =
        :crypto.hash(:md5, "stack-id" <> "shape-handle" <> "sublink:1:" <> "y")
        |> Base.encode16(case: :lower)

      assert message == %{
               headers: %{
                 event: "move-out",
                 patterns: [%{pos: 0, value: tag1}, %{pos: 0, value: tag2}]
               }
             }
    end
  end

  describe "move_in_tag_structure/1" do
    test "returns empty map for shape without where clause" do
      shape = Shape.new!("child", inspector: @inspector)

      assert SubqueryMoves.move_in_tag_structure(shape) == {%{}, %{}}
    end

    test "returns empty map for shape without dependencies" do
      shape = Shape.new!("child", where: "parent_id > 5", inspector: @inspector)

      assert SubqueryMoves.move_in_tag_structure(shape) == {%{}, %{}}
    end

    test "extracts single column reference from sublink" do
      shape =
        Shape.new!("child",
          where: "parent_id IN (SELECT id FROM parent)",
          inspector: @inspector
        )

      result = SubqueryMoves.move_in_tag_structure(shape)

      # tag_structure is now a map keyed by sublink ref
      assert {%{["$sublink", "0"] => ["parent_id"]},
              %{["$sublink", "0"] => %Eval.Expr{eval: %Eval.Parser.Ref{path: ["parent_id"]}}}} =
               result
    end

    test "extracts composite key references from row expression" do
      shape =
        Shape.new!("child",
          where: "(col1, col2) IN (SELECT id1, id2 FROM parent)",
          inspector: @composite_inspector
        )

      result = SubqueryMoves.move_in_tag_structure(shape)

      # tag_structure is now a map keyed by sublink ref
      assert {%{["$sublink", "0"] => [{:hash_together, ["col1", "col2"]}]},
              %{
                ["$sublink", "0"] => %Eval.Expr{
                  eval: %Eval.Parser.RowExpr{
                    elements: [%Eval.Parser.Ref{path: ["col1"]}, %Eval.Parser.Ref{path: ["col2"]}]
                  }
                }
              }} = result
    end
  end

  describe "multiple OR-combined subqueries" do
    @multi_inspector Support.StubInspector.new(
                       tables: ["parent1", "parent2", "child"],
                       columns: [
                         %{name: "id", type: "int8", pk_position: 0, type_id: {20, 1}},
                         %{name: "value", type: "text", pk_position: nil, type_id: {28, 1}},
                         %{name: "x", type: "int8", pk_position: nil, type_id: {20, 1}},
                         %{name: "y", type: "int8", pk_position: nil, type_id: {20, 1}}
                       ]
                     )

    test "extracts tag structure for OR-combined subqueries" do
      shape =
        Shape.new!("child",
          where: "x IN (SELECT id FROM parent1) OR y IN (SELECT id FROM parent2)",
          inspector: @multi_inspector
        )

      {tag_structure, comparison_expressions} = SubqueryMoves.move_in_tag_structure(shape)

      # Should have two entries in tag_structure map
      assert Map.has_key?(tag_structure, ["$sublink", "0"])
      assert Map.has_key?(tag_structure, ["$sublink", "1"])

      assert tag_structure[["$sublink", "0"]] == ["x"]
      assert tag_structure[["$sublink", "1"]] == ["y"]

      # Should have two comparison expressions
      assert %Eval.Expr{eval: %Eval.Parser.Ref{path: ["x"]}} = comparison_expressions[["$sublink", "0"]]
      assert %Eval.Expr{eval: %Eval.Parser.Ref{path: ["y"]}} = comparison_expressions[["$sublink", "1"]]
    end

    test "shape creation allows multiple subqueries" do
      # This should not raise an error anymore
      shape =
        Shape.new!("child",
          where: "x IN (SELECT id FROM parent1) OR y IN (SELECT id FROM parent2)",
          inspector: @multi_inspector
        )

      assert length(shape.shape_dependencies) == 2
      assert map_size(shape.tag_structure) == 2
    end

    test "make_value_hash includes sublink index to prevent collisions" do
      stack_id = "stack-1"
      shape_handle = "shape-1"
      value = "42"

      # Same value but different sublink indices should produce different hashes
      hash0 = SubqueryMoves.make_value_hash(stack_id, shape_handle, "0", value)
      hash1 = SubqueryMoves.make_value_hash(stack_id, shape_handle, "1", value)

      refute hash0 == hash1
    end
  end

  defp fill_handles(shape) do
    filled_deps = Enum.map(shape.shape_dependencies, &fill_handles/1)
    handles = Enum.map(filled_deps, &Shape.generate_id/1)
    %{shape | shape_dependencies: filled_deps, shape_dependencies_handles: handles}
  end
end
