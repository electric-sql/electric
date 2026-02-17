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
        tag_structure: [["parent_id"]]
      }

      move_outs = [{"dep-handle-1", [{1, "1"}, {2, "2"}, {3, "3"}]}]

      message =
        SubqueryMoves.make_move_out_control_message(shape, "stack-id", "shape-handle", move_outs)

      tag1 =
        :crypto.hash(:md5, "stack-id" <> "shape-handle" <> "v:1")
        |> Base.encode16(case: :lower)

      tag2 =
        :crypto.hash(:md5, "stack-id" <> "shape-handle" <> "v:2")
        |> Base.encode16(case: :lower)

      tag3 =
        :crypto.hash(:md5, "stack-id" <> "shape-handle" <> "v:3")
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
        tag_structure: [[{:hash_together, ["col1", "col2"]}]]
      }

      # Composite keys are represented as lists
      move_outs = [{"dep-handle-1", [{{1, "a"}, {"1", "a"}}, {{2, "b"}, {"2", "b"}}]}]

      message =
        SubqueryMoves.make_move_out_control_message(shape, "stack-id", "shape-handle", move_outs)

      tag1 =
        :crypto.hash(:md5, "stack-id" <> "shape-handle" <> "col1:v:1col2:v:a")
        |> Base.encode16(case: :lower)

      tag2 =
        :crypto.hash(:md5, "stack-id" <> "shape-handle" <> "col1:v:2col2:v:b")
        |> Base.encode16(case: :lower)

      assert message == %{
               headers: %{
                 event: "move-out",
                 patterns: [%{pos: 0, value: tag1}, %{pos: 0, value: tag2}]
               }
             }
    end
  end

  describe "tag_structure from DNF decomposition" do
    test "returns empty list for shape without where clause" do
      shape = Shape.new!("child", inspector: @inspector)

      assert shape.tag_structure == []
    end

    test "returns empty list for shape without dependencies" do
      shape = Shape.new!("child", where: "parent_id > 5", inspector: @inspector)

      assert shape.tag_structure == []
    end

    test "extracts single column reference from sublink" do
      shape =
        Shape.new!("child",
          where: "parent_id IN (SELECT id FROM parent)",
          inspector: @inspector
        )

      # DNF produces a single disjunct with one position for the subquery column
      assert [disjunct] = shape.tag_structure
      assert "parent_id" in disjunct

      # comparison_expressions should have the sublink entry
      assert %{["$sublink", "0"] => %Eval.Expr{eval: %Eval.Parser.Ref{path: ["parent_id"]}}} =
               shape.subquery_comparison_expressions
    end

    test "extracts composite key references from row expression" do
      shape =
        Shape.new!("child",
          where: "(col1, col2) IN (SELECT id1, id2 FROM parent)",
          inspector: @composite_inspector
        )

      assert [disjunct] = shape.tag_structure
      assert {:hash_together, ["col1", "col2"]} in disjunct

      assert %{
               ["$sublink", "0"] => %Eval.Expr{
                 eval: %Eval.Parser.RowExpr{
                   elements: [%Eval.Parser.Ref{path: ["col1"]}, %Eval.Parser.Ref{path: ["col2"]}]
                 }
               }
             } = shape.subquery_comparison_expressions
    end
  end

  defp fill_handles(shape) do
    filled_deps = Enum.map(shape.shape_dependencies, &fill_handles/1)
    handles = Enum.map(filled_deps, &Shape.generate_id/1)
    %{shape | shape_dependencies: filled_deps, shape_dependencies_handles: handles}
  end
end
