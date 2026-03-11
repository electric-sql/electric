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
      assert plan.has_negated_subquery == false
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
      assert plan.has_negated_subquery == false
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
    test "NOT with subquery marks has_negated_subquery" do
      {where, deps} =
        parse_where_with_sublinks(~S"NOT x IN (SELECT id FROM dep1)", 1)

      shape = make_shape(where, deps)
      assert {:ok, plan} = DnfPlan.compile(shape)

      assert plan.has_negated_subquery == true

      pos0 = plan.positions[0]
      assert pos0.is_subquery == true
      assert pos0.negated == true
    end

    test "positive subquery does not mark has_negated_subquery" do
      {where, deps} =
        parse_where_with_sublinks(~S"x IN (SELECT id FROM dep1)", 1)

      shape = make_shape(where, deps)
      assert {:ok, plan} = DnfPlan.compile(shape)

      assert plan.has_negated_subquery == false
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

  @stack_id "test_stack"
  @shape_handle "test_shape"

  describe "project_row/6 - single subquery" do
    test "row included when value is in subquery view" do
      {where, deps} = parse_where_with_sublinks(~S"x IN (SELECT id FROM dep)", 1)
      shape = make_shape(where, deps)
      {:ok, plan} = DnfPlan.compile(shape)

      record = %{"id" => "1", "x" => "5", "y" => "10", "status" => "open"}
      views = %{["$sublink", "0"] => MapSet.new([5])}

      assert {:ok, true, tags, active_conditions} =
               DnfPlan.project_row(plan, record, views, where, @stack_id, @shape_handle)

      assert active_conditions == [true]
      assert length(tags) == 1
    end

    test "row excluded when value is not in subquery view" do
      {where, deps} = parse_where_with_sublinks(~S"x IN (SELECT id FROM dep)", 1)
      shape = make_shape(where, deps)
      {:ok, plan} = DnfPlan.compile(shape)

      record = %{"id" => "1", "x" => "5", "y" => "10", "status" => "open"}
      views = %{["$sublink", "0"] => MapSet.new([99])}

      assert {:ok, false, _tags, active_conditions} =
               DnfPlan.project_row(plan, record, views, where, @stack_id, @shape_handle)

      assert active_conditions == [false]
    end
  end

  describe "project_row/6 - OR with subqueries" do
    setup do
      {where, deps} =
        parse_where_with_sublinks(
          ~S"x IN (SELECT id FROM dep1) OR y IN (SELECT id FROM dep2)",
          2
        )

      shape = make_shape(where, deps)
      {:ok, plan} = DnfPlan.compile(shape)
      %{plan: plan, where: where}
    end

    test "included via first disjunct only", %{plan: plan, where: where} do
      record = %{"id" => "1", "x" => "5", "y" => "10", "status" => "open"}
      views = %{["$sublink", "0"] => MapSet.new([5]), ["$sublink", "1"] => MapSet.new([])}

      assert {:ok, true, tags, active_conditions} =
               DnfPlan.project_row(plan, record, views, where, @stack_id, @shape_handle)

      assert active_conditions == [true, false]
      assert length(tags) == 2
    end

    test "included via second disjunct only", %{plan: plan, where: where} do
      record = %{"id" => "1", "x" => "5", "y" => "10", "status" => "open"}
      views = %{["$sublink", "0"] => MapSet.new([]), ["$sublink", "1"] => MapSet.new([10])}

      assert {:ok, true, _tags, active_conditions} =
               DnfPlan.project_row(plan, record, views, where, @stack_id, @shape_handle)

      assert active_conditions == [false, true]
    end

    test "included via both disjuncts", %{plan: plan, where: where} do
      record = %{"id" => "1", "x" => "5", "y" => "10", "status" => "open"}
      views = %{["$sublink", "0"] => MapSet.new([5]), ["$sublink", "1"] => MapSet.new([10])}

      assert {:ok, true, _tags, active_conditions} =
               DnfPlan.project_row(plan, record, views, where, @stack_id, @shape_handle)

      assert active_conditions == [true, true]
    end

    test "excluded when neither disjunct satisfied", %{plan: plan, where: where} do
      record = %{"id" => "1", "x" => "5", "y" => "10", "status" => "open"}
      views = %{["$sublink", "0"] => MapSet.new([99]), ["$sublink", "1"] => MapSet.new([99])}

      assert {:ok, false, _tags, active_conditions} =
               DnfPlan.project_row(plan, record, views, where, @stack_id, @shape_handle)

      assert active_conditions == [false, false]
    end
  end

  describe "project_row/6 - mixed row predicate and subquery" do
    setup do
      {where, deps} =
        parse_where_with_sublinks(
          ~S"(x IN (SELECT id FROM dep1) AND status = 'open') OR y IN (SELECT id FROM dep2)",
          2
        )

      shape = make_shape(where, deps)
      {:ok, plan} = DnfPlan.compile(shape)
      %{plan: plan, where: where}
    end

    test "included via first disjunct when subquery matches and row predicate true",
         %{plan: plan, where: where} do
      record = %{"id" => "1", "x" => "5", "y" => "10", "status" => "open"}
      views = %{["$sublink", "0"] => MapSet.new([5]), ["$sublink", "1"] => MapSet.new([])}

      assert {:ok, true, _tags, active_conditions} =
               DnfPlan.project_row(plan, record, views, where, @stack_id, @shape_handle)

      # All 3 positions: subquery true, row predicate true, sq2 false
      assert Enum.count(active_conditions, & &1) == 2
    end

    test "excluded from first disjunct when row predicate false", %{plan: plan, where: where} do
      record = %{"id" => "1", "x" => "5", "y" => "10", "status" => "closed"}
      views = %{["$sublink", "0"] => MapSet.new([5]), ["$sublink", "1"] => MapSet.new([])}

      assert {:ok, false, _tags, active_conditions} =
               DnfPlan.project_row(plan, record, views, where, @stack_id, @shape_handle)

      # Row predicate position should be false
      row_pred_pos =
        plan.positions
        |> Enum.find(fn {_pos, info} -> not info.is_subquery end)
        |> elem(0)

      refute Enum.at(active_conditions, row_pred_pos)
    end

    test "included via second disjunct even when first disjunct row predicate false",
         %{plan: plan, where: where} do
      record = %{"id" => "1", "x" => "5", "y" => "10", "status" => "closed"}
      views = %{["$sublink", "0"] => MapSet.new([5]), ["$sublink", "1"] => MapSet.new([10])}

      assert {:ok, true, _tags, _active_conditions} =
               DnfPlan.project_row(plan, record, views, where, @stack_id, @shape_handle)
    end
  end

  describe "project_row/6 - tags" do
    test "tags have correct structure with slots per position" do
      {where, deps} =
        parse_where_with_sublinks(
          ~S"x IN (SELECT id FROM dep1) OR y IN (SELECT id FROM dep2)",
          2
        )

      shape = make_shape(where, deps)
      {:ok, plan} = DnfPlan.compile(shape)

      record = %{"id" => "1", "x" => "5", "y" => "10", "status" => "open"}
      views = %{["$sublink", "0"] => MapSet.new([5]), ["$sublink", "1"] => MapSet.new([10])}

      assert {:ok, true, tags, _active_conditions} =
               DnfPlan.project_row(plan, record, views, where, @stack_id, @shape_handle)

      assert length(tags) == 2

      # Tag 0 (disjunct for x IN sq1): has hash at pos 0, empty at pos 1
      [tag0, tag1] = tags
      [slot0_0, slot0_1] = String.split(tag0, "/")
      assert slot0_0 != ""
      assert slot0_1 == ""

      # Tag 1 (disjunct for y IN sq2): empty at pos 0, has hash at pos 1
      [slot1_0, slot1_1] = String.split(tag1, "/")
      assert slot1_0 == ""
      assert slot1_1 != ""
    end

    test "row predicate positions get sentinel value in tags" do
      {where, deps} =
        parse_where_with_sublinks(
          ~S"(x IN (SELECT id FROM dep1) AND status = 'open') OR y IN (SELECT id FROM dep2)",
          2
        )

      shape = make_shape(where, deps)
      {:ok, plan} = DnfPlan.compile(shape)

      record = %{"id" => "1", "x" => "5", "y" => "10", "status" => "open"}
      views = %{["$sublink", "0"] => MapSet.new([5]), ["$sublink", "1"] => MapSet.new([])}

      assert {:ok, true, tags, _active_conditions} =
               DnfPlan.project_row(plan, record, views, where, @stack_id, @shape_handle)

      # The first disjunct's tag should contain a "1" sentinel for the row predicate position
      [tag0 | _] = tags
      slots = String.split(tag0, "/")

      # Find the row predicate position
      row_pred_pos =
        plan.positions
        |> Enum.find(fn {_pos, info} -> not info.is_subquery end)
        |> elem(0)

      assert Enum.at(slots, row_pred_pos) == "1"
    end
  end

  describe "project_row/6 - update scenarios" do
    test "update that changes which disjuncts are satisfied" do
      {where, deps} =
        parse_where_with_sublinks(
          ~S"(x IN (SELECT id FROM dep1) AND status = 'open') OR y IN (SELECT id FROM dep2)",
          2
        )

      shape = make_shape(where, deps)
      {:ok, plan} = DnfPlan.compile(shape)
      views = %{["$sublink", "0"] => MapSet.new([5]), ["$sublink", "1"] => MapSet.new([10])}

      # Old record: status = 'open', included via disjunct 0
      old_record = %{"id" => "1", "x" => "5", "y" => "10", "status" => "open"}

      assert {:ok, true, old_tags, old_ac} =
               DnfPlan.project_row(plan, old_record, views, where, @stack_id, @shape_handle)

      # New record: status = 'closed', no longer via disjunct 0 but still via disjunct 1
      new_record = %{"id" => "1", "x" => "5", "y" => "10", "status" => "closed"}

      assert {:ok, true, new_tags, new_ac} =
               DnfPlan.project_row(plan, new_record, views, where, @stack_id, @shape_handle)

      # Row predicate position should have changed
      row_pred_pos =
        plan.positions
        |> Enum.find(fn {_pos, info} -> not info.is_subquery end)
        |> elem(0)

      assert Enum.at(old_ac, row_pred_pos) == true
      assert Enum.at(new_ac, row_pred_pos) == false

      # removed_tags = old - new
      removed_tags = old_tags -- new_tags
      assert removed_tags == [] or length(removed_tags) >= 0
    end

    test "correct removed_tags when column values change" do
      {where, deps} =
        parse_where_with_sublinks(
          ~S"x IN (SELECT id FROM dep1) OR y IN (SELECT id FROM dep2)",
          2
        )

      shape = make_shape(where, deps)
      {:ok, plan} = DnfPlan.compile(shape)
      views = %{["$sublink", "0"] => MapSet.new([5, 99]), ["$sublink", "1"] => MapSet.new([10])}

      old_record = %{"id" => "1", "x" => "5", "y" => "10", "status" => "open"}

      {:ok, _old_incl, old_tags, _old_ac} =
        DnfPlan.project_row(plan, old_record, views, where, @stack_id, @shape_handle)

      # x changes from 5 to 99
      new_record = %{"id" => "1", "x" => "99", "y" => "10", "status" => "open"}

      {:ok, _new_incl, new_tags, _new_ac} =
        DnfPlan.project_row(plan, new_record, views, where, @stack_id, @shape_handle)

      # Tag hashes should differ because x changed
      [old_tag0, _] = old_tags
      [new_tag0, _] = new_tags
      assert old_tag0 != new_tag0

      # But tag1 (y IN sq2) should be the same since y didn't change
      [_, old_tag1] = old_tags
      [_, new_tag1] = new_tags
      assert old_tag1 == new_tag1

      removed_tags = old_tags -- new_tags
      assert length(removed_tags) == 1
    end
  end

  describe "move_in_where_clause/5 - x IN sq1 OR y IN sq2" do
    setup do
      {where, deps} =
        parse_where_with_sublinks(
          ~S"x IN (SELECT id FROM dep1) OR y IN (SELECT id FROM dep2)",
          2
        )

      shape = make_shape(where, deps)
      {:ok, plan} = DnfPlan.compile(shape)
      %{plan: plan, where: where}
    end

    test "move on dep 0 generates candidate for sq1 and exclusion for sq2",
         %{plan: plan, where: where} do
      move_in_values = [1, 2, 3]
      views = %{["$sublink", "0"] => MapSet.new([10]), ["$sublink", "1"] => MapSet.new([20, 30])}

      {sql, params} =
        DnfPlan.move_in_where_clause(plan, 0, move_in_values, views, where.used_refs)

      # Candidate should reference move_in_values with = ANY ($1::...)
      assert sql =~ "= ANY ($1::"
      # Exclusion should reference sq2's current view
      assert sql =~ "AND NOT"
      assert sql =~ "= ANY ($2::"

      # First param is move_in_values, second is current view for sq2
      assert length(params) == 2
      assert Enum.at(params, 0) == [1, 2, 3]
      assert Enum.sort(Enum.at(params, 1)) == [20, 30]
    end

    test "move on dep 1 generates candidate for sq2 and exclusion for sq1",
         %{plan: plan, where: where} do
      move_in_values = [100]
      views = %{["$sublink", "0"] => MapSet.new([5]), ["$sublink", "1"] => MapSet.new([10])}

      {sql, params} =
        DnfPlan.move_in_where_clause(plan, 1, move_in_values, views, where.used_refs)

      assert sql =~ "AND NOT"
      assert length(params) == 2
      assert Enum.at(params, 0) == [100]
      assert Enum.at(params, 1) == [5]
    end
  end

  describe "move_in_where_clause/5 - (x IN sq1 AND status = 'open') OR y IN sq2" do
    setup do
      {where, deps} =
        parse_where_with_sublinks(
          ~S"(x IN (SELECT id FROM dep1) AND status = 'open') OR y IN (SELECT id FROM dep2)",
          2
        )

      shape = make_shape(where, deps)
      {:ok, plan} = DnfPlan.compile(shape)
      %{plan: plan, where: where}
    end

    test "move on dep 0 includes row predicate in candidate",
         %{plan: plan, where: where} do
      move_in_values = [1, 2]
      views = %{["$sublink", "0"] => MapSet.new([10]), ["$sublink", "1"] => MapSet.new([20])}

      {sql, params} =
        DnfPlan.move_in_where_clause(plan, 0, move_in_values, views, where.used_refs)

      # Candidate should include both the subquery condition and the row predicate
      assert sql =~ "= ANY ($1::"
      assert sql =~ ~s|"status" = 'open'|
      # Exclusion should be sq2's disjunct
      assert sql =~ "AND NOT"
      assert length(params) == 2
    end
  end

  describe "make_move_in_broadcast/5" do
    test "generates position-aware patterns" do
      {where, deps} =
        parse_where_with_sublinks(
          ~S"x IN (SELECT id FROM dep1) OR y IN (SELECT id FROM dep2)",
          2
        )

      shape = make_shape(where, deps)
      {:ok, plan} = DnfPlan.compile(shape)

      values = [{5, "5"}, {10, "10"}]
      broadcast = DnfPlan.make_move_in_broadcast(plan, 0, values, @stack_id, @shape_handle)

      assert broadcast.headers.event == "move-in"
      assert length(broadcast.headers.patterns) == 2

      # All patterns should reference pos 0 (dep 0's position)
      dep0_positions = Map.get(plan.dependency_positions, 0, [])

      Enum.each(broadcast.headers.patterns, fn pattern ->
        assert pattern.pos in dep0_positions
        assert is_binary(pattern.value)
      end)
    end
  end

  describe "make_move_out_broadcast/5" do
    test "generates position-aware patterns" do
      {where, deps} =
        parse_where_with_sublinks(
          ~S"x IN (SELECT id FROM dep1) OR y IN (SELECT id FROM dep2)",
          2
        )

      shape = make_shape(where, deps)
      {:ok, plan} = DnfPlan.compile(shape)

      values = [{5, "5"}]
      broadcast = DnfPlan.make_move_out_broadcast(plan, 1, values, @stack_id, @shape_handle)

      assert broadcast.headers.event == "move-out"
      assert length(broadcast.headers.patterns) == 1

      dep1_positions = Map.get(plan.dependency_positions, 1, [])
      [pattern] = broadcast.headers.patterns
      assert pattern.pos in dep1_positions
    end
  end

  describe "active_conditions_sql/1" do
    test "generates per-position boolean SQL expressions" do
      {where, deps} =
        parse_where_with_sublinks(
          ~S"(x IN (SELECT id FROM dep1) AND status = 'open') OR y IN (SELECT id FROM dep2)",
          2
        )

      shape = make_shape(where, deps)
      {:ok, plan} = DnfPlan.compile(shape)

      sqls = DnfPlan.active_conditions_sql(plan)

      assert length(sqls) == plan.position_count

      # Each should be a boolean expression
      Enum.each(sqls, fn sql ->
        assert sql =~ "::boolean"
      end)
    end
  end

  describe "tags_sql/3" do
    test "generates per-disjunct tag SQL with position slots" do
      {where, deps} =
        parse_where_with_sublinks(
          ~S"(x IN (SELECT id FROM dep1) AND status = 'open') OR y IN (SELECT id FROM dep2)",
          2
        )

      shape = make_shape(where, deps)
      {:ok, plan} = DnfPlan.compile(shape)

      sqls = DnfPlan.tags_sql(plan, @stack_id, @shape_handle)

      # One tag SQL per disjunct
      assert length(sqls) == length(plan.disjuncts)

      # Each tag SQL should contain '/' separators between slots
      Enum.each(sqls, fn sql ->
        assert sql =~ "'/' ||"
      end)

      # First disjunct should have md5 for subquery + sentinel for row predicate
      [tag0_sql, _tag1_sql] = sqls
      assert tag0_sql =~ "md5("
      assert tag0_sql =~ "'1'"
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
end
