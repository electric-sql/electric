defmodule Electric.Shapes.DnfPlanTest do
  use ExUnit.Case, async: true

  alias Electric.Replication.Eval.Parser
  alias Electric.Shapes.DnfPlan
  alias Electric.Shapes.Shape

  @refs %{
    ["id"] => :int4,
    ["x"] => :int4,
    ["y"] => :int4,
    ["z"] => :int4,
    ["status"] => :text,
    ["name"] => :text,
    ["a"] => :int4,
    ["b"] => :int4
  }

  describe "compile/1 - no subqueries" do
    test "returns :no_subqueries for shape without where clause" do
      shape = make_shape(nil, [])
      assert :no_subqueries = DnfPlan.compile(shape)
    end

    test "returns :no_subqueries for shape without dependencies" do
      where = parse_where(~S"x = 1")
      shape = make_shape(where, [])
      assert :no_subqueries = DnfPlan.compile(shape)
    end
  end

  describe "compile/1 - single subquery" do
    test "single subquery shape" do
      {where, deps} = parse_where_with_sublinks(~S"x IN (SELECT id FROM dep)", 1)
      shape = make_shape(where, deps)

      assert {:ok, plan} = DnfPlan.compile(shape)

      assert plan.position_count == 1
      assert length(plan.disjuncts) == 1

      # Single position, which is a subquery
      assert map_size(plan.positions) == 1
      pos0 = plan.positions[0]
      assert pos0.is_subquery == true
      assert pos0.negated == false
      assert pos0.dependency_index == 0
      assert pos0.subquery_ref == ["$sublink", "0"]
      assert pos0.tag_columns == ["x"]

      assert plan.dependency_positions == %{0 => [0]}
      assert plan.dependency_disjuncts == %{0 => [0]}
      assert plan.dependency_polarities == %{0 => :positive}
    end
  end

  describe "compile/1 - OR with subqueries" do
    test "x IN sq1 OR y IN sq2" do
      {where, deps} =
        parse_where_with_sublinks(
          ~S"x IN (SELECT id FROM dep1) OR y IN (SELECT id FROM dep2)",
          2
        )

      shape = make_shape(where, deps)
      assert {:ok, plan} = DnfPlan.compile(shape)

      assert plan.position_count == 2
      assert length(plan.disjuncts) == 2

      # Position 0: x IN sq1
      pos0 = plan.positions[0]
      assert pos0.is_subquery == true
      assert pos0.dependency_index == 0
      assert pos0.tag_columns == ["x"]

      # Position 1: y IN sq2
      pos1 = plan.positions[1]
      assert pos1.is_subquery == true
      assert pos1.dependency_index == 1
      assert pos1.tag_columns == ["y"]

      # Each dependency maps to its own position and disjunct
      assert plan.dependency_positions == %{0 => [0], 1 => [1]}
      assert plan.dependency_disjuncts == %{0 => [0], 1 => [1]}
      assert plan.dependency_polarities == %{0 => :positive, 1 => :positive}
    end

    test "(x IN sq1 AND status = 'open') OR y IN sq2" do
      {where, deps} =
        parse_where_with_sublinks(
          ~S"(x IN (SELECT id FROM dep1) AND status = 'open') OR y IN (SELECT id FROM dep2)",
          2
        )

      shape = make_shape(where, deps)
      assert {:ok, plan} = DnfPlan.compile(shape)

      assert plan.position_count == 3
      assert length(plan.disjuncts) == 2

      # Find the subquery positions
      subquery_positions =
        plan.positions
        |> Enum.filter(fn {_pos, info} -> info.is_subquery end)
        |> Enum.sort_by(fn {_pos, info} -> info.dependency_index end)

      assert length(subquery_positions) == 2

      [{sq1_pos, sq1_info}, {sq2_pos, sq2_info}] = subquery_positions
      assert sq1_info.dependency_index == 0
      assert sq1_info.tag_columns == ["x"]
      assert sq2_info.dependency_index == 1
      assert sq2_info.tag_columns == ["y"]

      # Find the row predicate position
      row_positions =
        plan.positions
        |> Enum.filter(fn {_pos, info} -> not info.is_subquery end)

      assert [{row_pos, row_info}] = row_positions
      assert row_info.sql =~ "status"
      assert row_info.is_subquery == false
      assert row_info.dependency_index == nil

      # Disjunct 0 should contain sq1 + row predicate, disjunct 1 should contain sq2
      [d0, d1] = plan.disjuncts
      d0_positions = Enum.map(d0, &elem(&1, 0)) |> MapSet.new()
      d1_positions = Enum.map(d1, &elem(&1, 0)) |> MapSet.new()

      assert MapSet.member?(d0_positions, sq1_pos)
      assert MapSet.member?(d0_positions, row_pos)
      assert MapSet.member?(d1_positions, sq2_pos)

      # dependency_disjuncts: dep 0 in disjunct 0, dep 1 in disjunct 1
      assert plan.dependency_disjuncts[0] == [0]
      assert plan.dependency_disjuncts[1] == [1]
    end
  end

  describe "compile/1 - AND with subqueries" do
    test "x IN sq1 AND y IN sq2" do
      {where, deps} =
        parse_where_with_sublinks(
          ~S"x IN (SELECT id FROM dep1) AND y IN (SELECT id FROM dep2)",
          2
        )

      shape = make_shape(where, deps)
      assert {:ok, plan} = DnfPlan.compile(shape)

      # AND produces a single disjunct
      assert plan.position_count == 2
      assert length(plan.disjuncts) == 1

      [d0] = plan.disjuncts
      assert length(d0) == 2

      # Both deps are in the same (only) disjunct
      assert plan.dependency_disjuncts == %{0 => [0], 1 => [0]}
    end
  end

  describe "compile/1 - composite key subqueries" do
    test "composite key subquery position" do
      {where, deps} =
        parse_where_with_sublinks(
          ~S"(x, y) IN (SELECT a, b FROM dep1)",
          1,
          sublink_refs: %{["$sublink", "0"] => {:array, {:row, [:int4, :int4]}}},
          dep_columns: [["a", "b"]]
        )

      shape = make_shape(where, deps)
      assert {:ok, plan} = DnfPlan.compile(shape)

      assert plan.position_count == 1
      pos0 = plan.positions[0]
      assert pos0.is_subquery == true
      assert pos0.tag_columns == {:hash_together, ["x", "y"]}
    end
  end

  describe "compile/1 - negated subqueries" do
    test "NOT with subquery has negated polarity" do
      {where, deps} =
        parse_where_with_sublinks(~S"NOT x IN (SELECT id FROM dep1)", 1)

      shape = make_shape(where, deps)
      assert {:ok, plan} = DnfPlan.compile(shape)

      pos0 = plan.positions[0]
      assert pos0.is_subquery == true
      assert pos0.negated == true
      assert plan.dependency_polarities == %{0 => :negated}
    end

    test "positive subquery has positive polarity" do
      {where, deps} =
        parse_where_with_sublinks(~S"x IN (SELECT id FROM dep1)", 1)

      shape = make_shape(where, deps)
      assert {:ok, plan} = DnfPlan.compile(shape)

      assert plan.dependency_polarities == %{0 => :positive}
    end
  end

  describe "compile/1 - mixed polarity" do
    test "returns error when same subquery is used with both positive and negative polarity" do
      # Parse with 2 separate sublinks, then remap $sublink/1 -> $sublink/0
      # to simulate what Shape.new's canonicalize_where_sublink_refs does
      # when the same subquery appears with opposite polarity.
      {where, deps} =
        parse_where_with_sublinks(
          ~S"x IN (SELECT id FROM dep1) OR NOT x IN (SELECT id FROM dep2)",
          2
        )

      # Remap $sublink/1 refs to $sublink/0 in the AST, simulating deduplication
      remapped_eval = remap_sublink_ref(where.eval, "1", "0")

      remapped_used_refs =
        where.used_refs
        |> Map.delete(["$sublink", "1"])

      where = %{where | eval: remapped_eval, used_refs: remapped_used_refs}

      # Only 1 dependency since both refs now point to the same sublink
      shape = make_shape(where, [hd(deps)])
      assert {:error, reason} = DnfPlan.compile(shape)
      assert reason =~ "positive and negative polarity"
    end
  end

  describe "compile/1 - nested subqueries compile per level" do
    test "outer and inner shapes compile independently" do
      # Outer shape: x IN sq1 (where sq1 itself has subqueries)
      {outer_where, outer_deps} =
        parse_where_with_sublinks(~S"x IN (SELECT id FROM dep1)", 1)

      outer_shape = make_shape(outer_where, outer_deps)

      # Inner shape: a IN sq2 (the inner subquery's own WHERE)
      {inner_where, inner_deps} =
        parse_where_with_sublinks(~S"a IN (SELECT id FROM dep2)", 1)

      inner_shape = make_shape(inner_where, inner_deps)

      # Each compiles independently
      assert {:ok, outer_plan} = DnfPlan.compile(outer_shape)
      assert {:ok, inner_plan} = DnfPlan.compile(inner_shape)

      # Each has its own positions
      assert outer_plan.position_count == 1
      assert inner_plan.position_count == 1

      # Each references its own dependency index 0
      assert outer_plan.dependency_positions == %{0 => [0]}
      assert inner_plan.dependency_positions == %{0 => [0]}
    end
  end

  describe "compile/1 - distribution" do
    test "AND distributes over OR with subqueries" do
      # x IN sq1 AND (status = 'open' OR y IN sq2)
      # Distributes to: (x IN sq1 AND status = 'open') OR (x IN sq1 AND y IN sq2)
      {where, deps} =
        parse_where_with_sublinks(
          ~S"x IN (SELECT id FROM dep1) AND (status = 'open' OR y IN (SELECT id FROM dep2))",
          2
        )

      shape = make_shape(where, deps)
      assert {:ok, plan} = DnfPlan.compile(shape)

      assert length(plan.disjuncts) == 2

      # dep 0 (sq1) should be in both disjuncts since AND distributes
      assert plan.dependency_disjuncts[0] == [0, 1]
      # dep 1 (sq2) should be in only the second disjunct
      assert plan.dependency_disjuncts[1] == [1]
    end
  end

  # -- Helpers --

  defp parse_where(where_clause) do
    {:ok, pgquery} = Parser.parse_query(where_clause)
    {:ok, expr} = Parser.validate_where_ast(pgquery, refs: @refs)
    expr
  end

  defp parse_where_with_sublinks(where_clause, num_deps, opts \\ []) do
    sublink_refs =
      Keyword.get_lazy(opts, :sublink_refs, fn ->
        Map.new(0..(num_deps - 1), fn i ->
          {["$sublink", "#{i}"], {:array, :int4}}
        end)
      end)

    dep_columns = Keyword.get(opts, :dep_columns, nil)

    sublink_queries =
      Map.new(0..(num_deps - 1), fn i ->
        cols =
          if dep_columns do
            Enum.at(dep_columns, i) |> Enum.join(", ")
          else
            "id"
          end

        {i, "SELECT #{cols} FROM dep#{i + 1}"}
      end)

    all_refs = Map.merge(@refs, sublink_refs)
    {:ok, pgquery} = Parser.parse_query(where_clause)

    {:ok, expr} =
      Parser.validate_where_ast(pgquery,
        refs: all_refs,
        sublink_queries: sublink_queries
      )

    deps =
      Enum.map(0..(num_deps - 1), fn _i ->
        %Shape{
          root_table: {"public", "dep"},
          root_table_id: 100,
          root_pk: ["id"],
          root_column_count: 1,
          where: nil,
          selected_columns: ["id"],
          explicitly_selected_columns: ["id"]
        }
      end)

    {expr, deps}
  end

  defp make_shape(where, deps) do
    %Shape{
      root_table: {"public", "test"},
      root_table_id: 1,
      root_pk: ["id"],
      root_column_count: 5,
      where: where,
      selected_columns: ["id", "x", "y", "status"],
      explicitly_selected_columns: ["id", "x", "y", "status"],
      shape_dependencies: deps,
      shape_dependencies_handles: Enum.with_index(deps, fn _, i -> "dep_handle_#{i}" end)
    }
  end

  # Recursively remap $sublink refs in an eval AST
  defp remap_sublink_ref(%Parser.Ref{path: ["$sublink", from]} = ref, from, to) do
    %{ref | path: ["$sublink", to]}
  end

  defp remap_sublink_ref(%Parser.Func{args: args} = func, from, to) do
    %{func | args: Enum.map(args, &remap_sublink_ref(&1, from, to))}
  end

  defp remap_sublink_ref(%Parser.Array{elements: elements} = arr, from, to) do
    %{arr | elements: Enum.map(elements, &remap_sublink_ref(&1, from, to))}
  end

  defp remap_sublink_ref(%Parser.RowExpr{elements: elements} = row, from, to) do
    %{row | elements: Enum.map(elements, &remap_sublink_ref(&1, from, to))}
  end

  defp remap_sublink_ref(other, _from, _to), do: other
end
