defmodule Electric.Shapes.Filter.Indexes.SubqueryIndexTest do
  use ExUnit.Case, async: true

  alias Electric.Replication.Eval.Parser
  alias Electric.Replication.Eval.Parser.{Func, Ref}
  alias Electric.Shapes.DnfPlan
  alias Electric.Shapes.Filter
  alias Electric.Shapes.Filter.Indexes.SubqueryIndex
  alias Electric.Shapes.Filter.Indexes.SubqueryIndex.MultiTimeView
  alias Electric.Shapes.Filter.WhereCondition

  @subquery_ref ["$sublink", "0"]
  @other_subquery_ref ["$sublink", "1"]
  @field "par_id"
  @other_field "id"
  @dep_handle_a "dep_a"
  @dep_handle_b "dep_b"

  setup do
    filter = Filter.new()
    condition_id = make_ref()
    WhereCondition.init(filter, condition_id)
    index = filter.subquery_index

    %{
      filter: filter,
      index: index,
      table: index.table,
      mtv: index.multi_time_view,
      condition_id: condition_id
    }
  end

  describe "register_shape/4" do
    test "stores polarity per subquery_ref and marks the shape as fallback", %{index: index} do
      SubqueryIndex.register_shape(index, "s1", make_plan(), [@dep_handle_a])

      assert SubqueryIndex.fallback?(index, "s1")

      SubqueryIndex.register_shape(
        index,
        "s2",
        make_plan(polarity: :negated),
        [@dep_handle_a]
      )

      assert SubqueryIndex.fallback?(index, "s2")
    end

    test "membership_or_fallback? defaults to true for positive fallback", %{index: index} do
      SubqueryIndex.register_shape(index, "s1", make_plan(), [@dep_handle_a])

      assert SubqueryIndex.membership_or_fallback?(index, "s1", @subquery_ref, 99)
    end

    test "membership_or_fallback? defaults to false for negated fallback", %{index: index} do
      SubqueryIndex.register_shape(
        index,
        "s1",
        make_plan(polarity: :negated),
        [@dep_handle_a]
      )

      refute SubqueryIndex.membership_or_fallback?(index, "s1", @subquery_ref, 99)
    end
  end

  describe "unregister_shape/2" do
    test "drops polarity, dep_handle, and fallback rows", %{index: index} do
      SubqueryIndex.register_shape(index, "s1", make_plan(), [@dep_handle_a])
      SubqueryIndex.unregister_shape(index, "s1")

      refute SubqueryIndex.fallback?(index, "s1")
    end
  end

  describe "add_shape/5 (positive)" do
    test "creates a single child for the first shape in a group + subquery", %{
      filter: filter,
      index: index,
      condition_id: condition_id
    } do
      register_node_shape(filter, condition_id, "s1")

      assert SubqueryIndex.has_positions?(index, "s1")
    end

    test "two shapes sharing the same group + subquery share a single child", %{
      filter: filter,
      table: table,
      condition_id: condition_id
    } do
      register_node_shape(filter, condition_id, "s1")
      register_node_shape(filter, condition_id, "s2")

      children =
        :ets.match(table, {{:shape_child, "s1", :"$1", :_}, :_}) ++
          :ets.match(table, {{:shape_child, "s2", :"$1", :_}, :_})

      assert children |> Enum.uniq() |> length() == 1
    end

    test "shapes with the same group but different subqueries land on different children", %{
      filter: filter,
      table: table,
      condition_id: condition_id
    } do
      register_node_shape(filter, condition_id, "s1", dep_handles: [@dep_handle_a])

      register_node_shape(filter, condition_id, "s2", dep_handles: [@dep_handle_b])

      [[c1]] = :ets.match(table, {{:shape_child, "s1", :"$1", :_}, :_})
      [[c2]] = :ets.match(table, {{:shape_child, "s2", :"$1", :_}, :_})

      assert c1 != c2
    end

    test "first-child creation seeds positive routing from MultiTimeView", %{
      filter: filter,
      mtv: mtv,
      table: table,
      condition_id: condition_id
    } do
      MultiTimeView.init_subquery(mtv, @dep_handle_a, [10, 20])
      MultiTimeView.mark_ready(mtv, @dep_handle_a)

      register_node_shape(filter, condition_id, "s1")

      [[_, group_id]] =
        :ets.match(table, {{:group, condition_id, @field, :"$1"}, :"$2"})

      assert :ets.match(table, {{:positive, group_id, :"$1", :_}, :_}) |> Enum.sort() ==
               [[10], [20]] |> Enum.sort()
    end

    test "adding a second shape to an existing child does not duplicate positive routes", %{
      filter: filter,
      mtv: mtv,
      table: table,
      condition_id: condition_id
    } do
      MultiTimeView.init_subquery(mtv, @dep_handle_a, [10, 20])
      MultiTimeView.mark_ready(mtv, @dep_handle_a)

      register_node_shape(filter, condition_id, "s1")

      before_routes = :ets.match(table, {{:positive, :_, :_, :_}, :_})
      register_node_shape(filter, condition_id, "s2")
      after_routes = :ets.match(table, {{:positive, :_, :_, :_}, :_})

      assert Enum.sort(before_routes) == Enum.sort(after_routes)
    end
  end

  describe "add_shape/5 (negated)" do
    test "stores one group-keyed routing row regardless of subquery value count", %{
      filter: filter,
      mtv: mtv,
      table: table,
      condition_id: condition_id
    } do
      MultiTimeView.init_subquery(mtv, @dep_handle_a, [1, 2, 3, 4, 5])
      MultiTimeView.mark_ready(mtv, @dep_handle_a)

      register_node_shape(filter, condition_id, "n1", polarity: :negated)

      assert :ets.match(table, {{:negated, :_, :_}, :_}) |> length() == 1
      assert :ets.match(table, {{:positive, :_, :_, :_}, :_}) == []
    end
  end

  describe "affected_shapes/4 (positive routing)" do
    test "returns shapes whose subquery has the value at the shape's logical time", %{
      filter: filter,
      index: index,
      mtv: mtv,
      condition_id: condition_id
    } do
      MultiTimeView.init_subquery(mtv, @dep_handle_a, [5])
      MultiTimeView.mark_ready(mtv, @dep_handle_a)

      register_node_shape(filter, condition_id, "s1")
      SubqueryIndex.set_shape_subquery(index, "s1", @subquery_ref, @dep_handle_a, 0)
      SubqueryIndex.mark_ready(index, "s1")

      assert MapSet.new(["s1"]) ==
               SubqueryIndex.affected_shapes(
                 filter,
                 condition_id,
                 @field,
                 %{"par_id" => "5"}
               )
    end

    test "diverging consumer times: routing keeps the value, exact check splits the result", %{
      filter: filter,
      index: index,
      mtv: mtv,
      condition_id: condition_id
    } do
      MultiTimeView.init_subquery(mtv, @dep_handle_a, [])
      MultiTimeView.mark_ready(mtv, @dep_handle_a)

      register_node_shape(filter, condition_id, "s_old")
      register_node_shape(filter, condition_id, "s_new")

      MultiTimeView.mark_in(mtv, @dep_handle_a, 30, 1)
      SubqueryIndex.add_positive_route(index, @dep_handle_a, 30)

      SubqueryIndex.set_shape_subquery(index, "s_old", @subquery_ref, @dep_handle_a, 0)
      SubqueryIndex.set_shape_subquery(index, "s_new", @subquery_ref, @dep_handle_a, 1)
      SubqueryIndex.mark_ready(index, "s_old")
      SubqueryIndex.mark_ready(index, "s_new")

      affected =
        SubqueryIndex.affected_shapes(
          filter,
          condition_id,
          @field,
          %{"par_id" => "30"}
        )

      assert MapSet.new(["s_old", "s_new"]) == affected

      refute SubqueryIndex.member?(index, "s_old", @subquery_ref, 30)
      assert SubqueryIndex.member?(index, "s_new", @subquery_ref, 30)
    end

    test "returns only shapes registered under the requested field key", %{
      filter: filter,
      index: index,
      mtv: mtv,
      condition_id: condition_id
    } do
      MultiTimeView.init_subquery(mtv, @dep_handle_a, [5])
      MultiTimeView.mark_ready(mtv, @dep_handle_a)

      register_node_shape(filter, condition_id, "local")

      register_node_shape(filter, condition_id, "other_field",
        field: @other_field,
        subquery_ref: @other_subquery_ref,
        dep_handles: [@dep_handle_a]
      )

      for shape <- ~w(local other_field) do
        SubqueryIndex.mark_ready(index, shape)
      end

      SubqueryIndex.set_shape_subquery(index, "local", @subquery_ref, @dep_handle_a, 0)

      SubqueryIndex.set_shape_subquery(
        index,
        "other_field",
        @other_subquery_ref,
        @dep_handle_a,
        0
      )

      assert MapSet.new(["local"]) ==
               SubqueryIndex.affected_shapes(
                 filter,
                 condition_id,
                 @field,
                 %{"par_id" => "5", "id" => "5"}
               )
    end

    test "delegates an and_where tail to the child WhereCondition", %{
      filter: filter,
      index: index,
      mtv: mtv,
      condition_id: condition_id
    } do
      MultiTimeView.init_subquery(mtv, @dep_handle_a, [5])
      MultiTimeView.mark_ready(mtv, @dep_handle_a)

      register_node_shape(filter, condition_id, "tail",
        and_where: where("name ILIKE 'keep%'", %{["name"] => :text})
      )

      SubqueryIndex.set_shape_subquery(index, "tail", @subquery_ref, @dep_handle_a, 0)
      SubqueryIndex.mark_ready(index, "tail")

      assert MapSet.new(["tail"]) ==
               SubqueryIndex.affected_shapes(
                 filter,
                 condition_id,
                 @field,
                 %{"par_id" => "5", "name" => "keep_me"}
               )

      assert MapSet.new() ==
               SubqueryIndex.affected_shapes(
                 filter,
                 condition_id,
                 @field,
                 %{"par_id" => "5", "name" => "discard"}
               )
    end

    test "routes unseeded shapes via the per-node fallback rows", %{
      filter: filter,
      condition_id: condition_id
    } do
      register_node_shape(filter, condition_id, "unseeded")

      assert MapSet.new(["unseeded"]) ==
               SubqueryIndex.affected_shapes(
                 filter,
                 condition_id,
                 @field,
                 %{"par_id" => "999"}
               )
    end
  end

  describe "affected_shapes/4 (negated routing)" do
    test "prunes the child when the value is a member at every retained time", %{
      filter: filter,
      index: index,
      mtv: mtv,
      condition_id: condition_id
    } do
      MultiTimeView.init_subquery(mtv, @dep_handle_a, [5])
      MultiTimeView.mark_ready(mtv, @dep_handle_a)

      register_node_shape(filter, condition_id, "n1", polarity: :negated)
      SubqueryIndex.set_shape_subquery(index, "n1", @subquery_ref, @dep_handle_a, 0)
      SubqueryIndex.mark_ready(index, "n1")

      assert MapSet.new() ==
               SubqueryIndex.affected_shapes(
                 filter,
                 condition_id,
                 @field,
                 %{"par_id" => "5"}
               )

      assert MapSet.new(["n1"]) ==
               SubqueryIndex.affected_shapes(
                 filter,
                 condition_id,
                 @field,
                 %{"par_id" => "99"}
               )
    end

    test "keeps the child when the value is only a member at some retained time", %{
      filter: filter,
      index: index,
      mtv: mtv,
      condition_id: condition_id
    } do
      MultiTimeView.init_subquery(mtv, @dep_handle_a, [])
      MultiTimeView.mark_ready(mtv, @dep_handle_a)

      register_node_shape(filter, condition_id, "n1", polarity: :negated)
      MultiTimeView.mark_in(mtv, @dep_handle_a, 30, 1)

      SubqueryIndex.set_shape_subquery(index, "n1", @subquery_ref, @dep_handle_a, 0)
      SubqueryIndex.mark_ready(index, "n1")

      assert MapSet.new(["n1"]) ==
               SubqueryIndex.affected_shapes(
                 filter,
                 condition_id,
                 @field,
                 %{"par_id" => "30"}
               )
    end
  end

  describe "all_shape_ids/3" do
    test "returns shapes for the requested field key only", %{
      filter: filter,
      condition_id: condition_id
    } do
      register_node_shape(filter, condition_id, "s1")

      register_node_shape(filter, condition_id, "s2",
        and_where: where("name ILIKE 'keep%'", %{["name"] => :text})
      )

      register_node_shape(filter, condition_id, "other",
        field: @other_field,
        subquery_ref: @other_subquery_ref
      )

      assert MapSet.new(["s1", "s2"]) ==
               SubqueryIndex.all_shape_ids(filter, condition_id, @field)
    end
  end

  describe "add_positive_route/3 and remove_positive_route/3" do
    test "mutate routing without touching per-shape rows", %{
      filter: filter,
      index: index,
      mtv: mtv,
      table: table,
      condition_id: condition_id
    } do
      MultiTimeView.init_subquery(mtv, @dep_handle_a, [])
      MultiTimeView.mark_ready(mtv, @dep_handle_a)

      register_node_shape(filter, condition_id, "s1")

      shape_rows_before = :ets.match(table, {{:shape_child, "s1", :_, :_}, :_})

      SubqueryIndex.add_positive_route(index, @dep_handle_a, 42)

      [[group_id]] = :ets.match(table, {{:group, condition_id, @field, :positive}, :"$1"})
      assert :ets.match(table, {{:positive, group_id, 42, :_}, :_}) |> length() == 1

      SubqueryIndex.remove_positive_route(index, @dep_handle_a, 42)
      assert :ets.match(table, {{:positive, group_id, 42, :_}, :_}) == []

      assert :ets.match(table, {{:shape_child, "s1", :_, :_}, :_}) == shape_rows_before
    end
  end

  describe "remove_shape/5" do
    test "leaves shared child intact when other shapes remain", %{
      filter: filter,
      index: index,
      condition_id: condition_id
    } do
      register_node_shape(filter, condition_id, "s1")
      register_node_shape(filter, condition_id, "s2")

      assert :ok =
               SubqueryIndex.remove_shape(filter, condition_id, "s1", subquery_optimisation(), [])

      assert MapSet.new(["s2"]) == SubqueryIndex.all_shape_ids(filter, condition_id, @field)
      refute SubqueryIndex.has_positions?(index, "s1")
    end

    test "cleans the child and positive routes when the last shape leaves", %{
      filter: filter,
      mtv: mtv,
      table: table,
      condition_id: condition_id
    } do
      MultiTimeView.init_subquery(mtv, @dep_handle_a, [10, 20])
      MultiTimeView.mark_ready(mtv, @dep_handle_a)

      register_node_shape(filter, condition_id, "s1")
      register_node_shape(filter, condition_id, "s2")

      assert :ok =
               SubqueryIndex.remove_shape(filter, condition_id, "s1", subquery_optimisation(), [])

      assert :deleted =
               SubqueryIndex.remove_shape(filter, condition_id, "s2", subquery_optimisation(), [])

      assert :ets.match(table, {{:positive, :_, :_, :_}, :_}) == []
      assert :ets.match(table, {{:child_meta, :_}, :_}) == []
    end

    test "tracks emptiness per field key", %{
      filter: filter,
      condition_id: condition_id
    } do
      register_node_shape(filter, condition_id, "s1")

      register_node_shape(filter, condition_id, "s2",
        field: @other_field,
        subquery_ref: @other_subquery_ref
      )

      assert :deleted =
               SubqueryIndex.remove_shape(filter, condition_id, "s1", subquery_optimisation(), [])

      assert MapSet.new(["s2"]) ==
               SubqueryIndex.all_shape_ids(filter, condition_id, @other_field)

      assert :deleted =
               SubqueryIndex.remove_shape(
                 filter,
                 condition_id,
                 "s2",
                 subquery_optimisation(field: @other_field, subquery_ref: @other_subquery_ref),
                 []
               )
    end
  end

  describe "remove_subquery/3" do
    test "cascades to every child and participant for that subquery only", %{
      filter: filter,
      index: index,
      mtv: mtv,
      condition_id: condition_id
    } do
      MultiTimeView.init_subquery(mtv, @dep_handle_a, [10])
      MultiTimeView.init_subquery(mtv, @dep_handle_b, [20])
      MultiTimeView.mark_ready(mtv, @dep_handle_a)
      MultiTimeView.mark_ready(mtv, @dep_handle_b)

      register_node_shape(filter, condition_id, "s_a", dep_handles: [@dep_handle_a])

      register_node_shape(filter, condition_id, "s_b",
        field: @other_field,
        subquery_ref: @other_subquery_ref,
        dep_handles: [@dep_handle_b]
      )

      SubqueryIndex.remove_subquery(index, @dep_handle_a)

      refute SubqueryIndex.has_positions?(index, "s_a")
      assert SubqueryIndex.has_positions?(index, "s_b")
      refute MultiTimeView.member_at_some_time?(mtv, @dep_handle_a, 10)
      assert MultiTimeView.member_at_some_time?(mtv, @dep_handle_b, 20)
    end
  end

  describe "mark_ready/2 and fallback?/2" do
    test "mark_ready clears fallback and per-node fallback rows", %{
      filter: filter,
      index: index,
      table: table,
      condition_id: condition_id
    } do
      register_node_shape(filter, condition_id, "s1")
      assert SubqueryIndex.fallback?(index, "s1")
      assert :ets.match(table, {{:node_fallback, :_, :_, :_, "s1"}, :_}) != []

      SubqueryIndex.mark_ready(index, "s1")

      refute SubqueryIndex.fallback?(index, "s1")
      assert :ets.match(table, {{:node_fallback, :_, :_, :_, "s1"}, :_}) == []
    end
  end

  describe "member?/5 and membership_or_fallback?/5" do
    test "membership_or_fallback? defers to MultiTimeView at the shape's logical time", %{
      filter: filter,
      index: index,
      mtv: mtv,
      condition_id: condition_id
    } do
      MultiTimeView.init_subquery(mtv, @dep_handle_a, [5])
      MultiTimeView.mark_ready(mtv, @dep_handle_a)

      register_node_shape(filter, condition_id, "s1")
      SubqueryIndex.set_shape_subquery(index, "s1", @subquery_ref, @dep_handle_a, 0)
      SubqueryIndex.mark_ready(index, "s1")

      assert SubqueryIndex.membership_or_fallback?(index, "s1", @subquery_ref, 5)
      refute SubqueryIndex.membership_or_fallback?(index, "s1", @subquery_ref, 99)
    end

    test "member? without a stored logical time returns false", %{index: index} do
      refute SubqueryIndex.member?(index, "no_such_shape", @subquery_ref, 1)
    end
  end

  describe "for_stack/1" do
    test "returns the index when one was created for the stack" do
      stack_id = "test-stack-#{System.unique_integer([:positive])}"
      _index = SubqueryIndex.new(stack_id: stack_id)
      assert %SubqueryIndex{} = SubqueryIndex.for_stack(stack_id)
    end

    test "returns nil for unknown stack" do
      assert SubqueryIndex.for_stack("nonexistent-stack-#{System.unique_integer([:positive])}") ==
               nil
    end
  end

  defp register_node_shape(filter, condition_id, shape_id, opts \\ []) do
    dep_handles = Keyword.get(opts, :dep_handles, [@dep_handle_a])
    SubqueryIndex.register_shape(filter.subquery_index, shape_id, make_plan(opts), dep_handles)

    :ok =
      SubqueryIndex.add_shape(
        filter,
        condition_id,
        shape_id,
        subquery_optimisation(opts),
        []
      )
  end

  defp subquery_optimisation(opts \\ []) do
    field = Keyword.get(opts, :field, @field)

    %{
      operation: "subquery",
      field: field,
      testexpr: %Ref{path: [field], type: :int8},
      subquery_ref: Keyword.get(opts, :subquery_ref, @subquery_ref),
      dep_index: Keyword.get(opts, :dep_index, 0),
      polarity: Keyword.get(opts, :polarity, :positive),
      and_where: Keyword.get(opts, :and_where)
    }
  end

  defp make_plan(opts \\ []) do
    polarity = Keyword.get(opts, :polarity, :positive)
    dep_index = Keyword.get(opts, :dep_index, 0)
    subquery_ref = Keyword.get(opts, :subquery_ref, @subquery_ref)
    field = Keyword.get(opts, :field, @field)

    testexpr = %Ref{path: [field], type: :int8}
    ref = %Ref{path: subquery_ref, type: {:array, :int8}}

    ast = %Func{
      name: "sublink_membership_check",
      args: [testexpr, ref],
      type: :bool
    }

    %DnfPlan{
      disjuncts: [],
      disjuncts_positions: [],
      position_count: 1,
      positions: %{
        0 => %{
          ast: ast,
          sql: "fake",
          is_subquery: true,
          negated: polarity == :negated,
          dependency_index: dep_index,
          subquery_ref: subquery_ref,
          tag_columns: [field]
        }
      },
      dependency_positions: %{dep_index => [0]},
      dependency_disjuncts: %{},
      dependency_polarities: %{dep_index => polarity}
    }
  end

  defp where(query, refs), do: Parser.parse_and_validate_expression!(query, refs: refs)
end
