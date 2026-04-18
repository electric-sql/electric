defmodule Electric.Shapes.Filter.Indexes.SubqueryIndexNodeTest do
  use ExUnit.Case

  alias Electric.Replication.Eval.Parser
  alias Electric.Replication.Eval.Parser.{Func, Ref}
  alias Electric.Shapes.DnfPlan
  alias Electric.Shapes.Filter
  alias Electric.Shapes.Filter.Indexes.SubqueryIndex
  alias Electric.Shapes.Filter.WhereCondition

  @subquery_ref ["$sublink", "0"]
  @field "par_id"
  @other_field "id"

  setup do
    filter = Filter.new()
    condition_id = make_ref()
    WhereCondition.init(filter, condition_id)

    %{
      filter: filter,
      condition_id: condition_id,
      reverse_index: Filter.subquery_index(filter)
    }
  end

  describe "affected_shapes/4" do
    test "returns only shapes registered under the current field key", %{
      filter: filter,
      condition_id: condition_id,
      reverse_index: reverse_index
    } do
      register_node_shape(filter, reverse_index, condition_id, "local_shape")

      register_node_shape(filter, reverse_index, condition_id, "other_field_shape",
        field: @other_field
      )

      seed_shape(reverse_index, "local_shape", [5])
      seed_shape(reverse_index, "other_field_shape", [5])

      assert MapSet.new(["local_shape"]) ==
               SubqueryIndex.affected_shapes(
                 filter,
                 condition_id,
                 @field,
                 %{"par_id" => "5", "id" => "5"}
               )
    end

    test "delegates matching candidates to the child where condition", %{
      filter: filter,
      condition_id: condition_id,
      reverse_index: reverse_index
    } do
      register_node_shape(
        filter,
        reverse_index,
        condition_id,
        "shape_with_exact_tail",
        and_where: where("name ILIKE 'keep%'", %{["name"] => :text})
      )

      seed_shape(reverse_index, "shape_with_exact_tail", [5])

      assert MapSet.new(["shape_with_exact_tail"]) ==
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

    test "routes unseeded shapes once traversal reaches the node", %{
      filter: filter,
      condition_id: condition_id,
      reverse_index: reverse_index
    } do
      register_node_shape(filter, reverse_index, condition_id, "unseeded_shape")

      assert MapSet.new(["unseeded_shape"]) ==
               SubqueryIndex.affected_shapes(
                 filter,
                 condition_id,
                 @field,
                 %{"par_id" => "999"}
               )
    end
  end

  describe "all_shape_ids/3" do
    test "returns only the shape ids for the requested field key", %{
      filter: filter,
      condition_id: condition_id,
      reverse_index: reverse_index
    } do
      register_node_shape(filter, reverse_index, condition_id, "shape1")

      register_node_shape(
        filter,
        reverse_index,
        condition_id,
        "shape2",
        and_where: where("name ILIKE 'keep%'", %{["name"] => :text})
      )

      register_node_shape(filter, reverse_index, condition_id, "other_field_shape",
        field: @other_field
      )

      assert MapSet.new(["shape1", "shape2"]) ==
               SubqueryIndex.all_shape_ids(filter, condition_id, @field)
    end
  end

  describe "remove_shape/4" do
    test "tracks emptiness per field key", %{
      filter: filter,
      condition_id: condition_id,
      reverse_index: reverse_index
    } do
      register_node_shape(filter, reverse_index, condition_id, "shape1")
      register_node_shape(filter, reverse_index, condition_id, "shape2", field: @other_field)

      assert :deleted =
               SubqueryIndex.remove_shape(
                 filter,
                 condition_id,
                 "shape1",
                 subquery_optimisation()
               )

      refute SubqueryIndex.has_positions?(reverse_index, "shape1")

      assert MapSet.new(["shape2"]) ==
               SubqueryIndex.all_shape_ids(filter, condition_id, @other_field)

      assert :deleted =
               SubqueryIndex.remove_shape(
                 filter,
                 condition_id,
                 "shape2",
                 subquery_optimisation(field: @other_field)
               )
    end
  end

  defp register_node_shape(filter, reverse_index, condition_id, shape_id, opts \\ []) do
    SubqueryIndex.register_shape(reverse_index, shape_id, make_plan(opts))

    :ok =
      SubqueryIndex.add_shape(
        filter,
        condition_id,
        shape_id,
        subquery_optimisation(opts)
      )
  end

  defp seed_shape(reverse_index, shape_id, values) do
    SubqueryIndex.seed_membership(
      reverse_index,
      shape_id,
      @subquery_ref,
      0,
      MapSet.new(values)
    )

    SubqueryIndex.mark_ready(reverse_index, shape_id)
  end

  defp subquery_optimisation(opts \\ []) do
    %{
      operation: "subquery",
      field: Keyword.get(opts, :field, @field),
      testexpr: %Ref{path: [Keyword.get(opts, :field, @field)], type: :int8},
      subquery_ref: Keyword.get(opts, :subquery_ref, @subquery_ref),
      dep_index: Keyword.get(opts, :dep_index, 0),
      polarity: Keyword.get(opts, :polarity, :positive),
      and_where: Keyword.get(opts, :and_where)
    }
  end

  defp where(query, refs) do
    Parser.parse_and_validate_expression!(query, refs: refs)
  end

  defp make_plan(opts) do
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
end
