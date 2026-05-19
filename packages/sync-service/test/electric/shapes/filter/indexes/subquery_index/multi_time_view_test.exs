defmodule Electric.Shapes.Filter.Indexes.SubqueryIndex.MultiTimeViewTest do
  use ExUnit.Case, async: true

  alias Electric.Shapes.Filter.Indexes.SubqueryIndex.MultiTimeView

  setup do
    %{view: MultiTimeView.new()}
  end

  describe "init_subquery/3" do
    test "starts the subquery at logical time 0", %{view: view} do
      MultiTimeView.init_subquery(view, :s7, [10, 20])
      assert MultiTimeView.current_time(view, :s7) == 0
    end

    test "makes the initial values members at time 0", %{view: view} do
      MultiTimeView.init_subquery(view, :s7, [10, 20])

      assert MultiTimeView.member?(view, :s7, 10, 0)
      assert MultiTimeView.member?(view, :s7, 20, 0)
    end

    test "values outside the initial set are not members", %{view: view} do
      MultiTimeView.init_subquery(view, :s7, [10, 20])
      refute MultiTimeView.member?(view, :s7, 30, 0)
    end

    test "does not mark the subquery as ready", %{view: view} do
      MultiTimeView.init_subquery(view, :s7, [10, 20])
      refute MultiTimeView.ready?(view, :s7)
    end

    test "keeps subqueries isolated from each other", %{view: view} do
      MultiTimeView.init_subquery(view, :s7, [10])
      MultiTimeView.init_subquery(view, :s8, [20])

      assert MultiTimeView.member?(view, :s7, 10, 0)
      refute MultiTimeView.member?(view, :s7, 20, 0)
      assert MultiTimeView.member?(view, :s8, 20, 0)
      refute MultiTimeView.member?(view, :s8, 10, 0)
    end
  end

  describe "mark_ready/2 and ready?/2" do
    test "an unknown subquery is not ready", %{view: view} do
      refute MultiTimeView.ready?(view, :s7)
    end

    test "a subquery is not ready immediately after init", %{view: view} do
      MultiTimeView.init_subquery(view, :s7, [10])
      refute MultiTimeView.ready?(view, :s7)
    end

    test "becomes ready after mark_ready", %{view: view} do
      MultiTimeView.init_subquery(view, :s7, [10])
      MultiTimeView.mark_ready(view, :s7)
      assert MultiTimeView.ready?(view, :s7)
    end
  end

  describe "mark_in/4" do
    test "adds a value as a member from the transition time onwards", %{view: view} do
      MultiTimeView.init_subquery(view, :s7, [10])
      MultiTimeView.mark_in(view, :s7, 30, 1)

      refute MultiTimeView.member?(view, :s7, 30, 0)
      assert MultiTimeView.member?(view, :s7, 30, 1)
      assert MultiTimeView.member?(view, :s7, 30, 5)
    end

    test "advances the current logical time", %{view: view} do
      MultiTimeView.init_subquery(view, :s7, [10])
      MultiTimeView.mark_in(view, :s7, 30, 3)

      assert MultiTimeView.current_time(view, :s7) == 3
    end

    test "is a no-op when the value is already a member", %{view: view} do
      MultiTimeView.init_subquery(view, :s7, [10])
      MultiTimeView.mark_in(view, :s7, 10, 1)

      assert MultiTimeView.member_at_all_times?(view, :s7, 10)
    end
  end

  describe "mark_out/4" do
    test "removes a value from the transition time onwards", %{view: view} do
      MultiTimeView.init_subquery(view, :s7, [10, 20])
      MultiTimeView.mark_out(view, :s7, 20, 2)

      assert MultiTimeView.member?(view, :s7, 20, 0)
      assert MultiTimeView.member?(view, :s7, 20, 1)
      refute MultiTimeView.member?(view, :s7, 20, 2)
      refute MultiTimeView.member?(view, :s7, 20, 5)
    end

    test "advances the current logical time", %{view: view} do
      MultiTimeView.init_subquery(view, :s7, [10, 20])
      MultiTimeView.mark_out(view, :s7, 20, 2)

      assert MultiTimeView.current_time(view, :s7) == 2
    end

    test "is a no-op when the value was never a member", %{view: view} do
      MultiTimeView.init_subquery(view, :s7, [10])
      MultiTimeView.mark_out(view, :s7, 99, 1)

      refute MultiTimeView.member_at_some_time?(view, :s7, 99)
    end
  end

  describe "member?/4" do
    test "is false for values never seen", %{view: view} do
      MultiTimeView.init_subquery(view, :s7, [10])
      refute MultiTimeView.member?(view, :s7, 99, 0)
    end

    test "tracks add-then-remove transitions correctly", %{view: view} do
      MultiTimeView.init_subquery(view, :s7, [])
      MultiTimeView.mark_in(view, :s7, 30, 1)
      MultiTimeView.mark_out(view, :s7, 30, 3)

      refute MultiTimeView.member?(view, :s7, 30, 0)
      assert MultiTimeView.member?(view, :s7, 30, 1)
      assert MultiTimeView.member?(view, :s7, 30, 2)
      refute MultiTimeView.member?(view, :s7, 30, 3)
    end
  end

  describe "member_at_some_time?/3" do
    test "true for values currently present", %{view: view} do
      MultiTimeView.init_subquery(view, :s7, [10])
      assert MultiTimeView.member_at_some_time?(view, :s7, 10)
    end

    test "true for values that were members at any retained time", %{view: view} do
      MultiTimeView.init_subquery(view, :s7, [])
      MultiTimeView.mark_in(view, :s7, 30, 1)
      MultiTimeView.mark_out(view, :s7, 30, 2)

      # 30 is no longer present at the current time, but is still retained.
      assert MultiTimeView.member_at_some_time?(view, :s7, 30)
    end

    test "false for values never seen", %{view: view} do
      MultiTimeView.init_subquery(view, :s7, [10])
      refute MultiTimeView.member_at_some_time?(view, :s7, 99)
    end
  end

  describe "member_at_all_times?/3" do
    test "true when the value has no toggles in the retained window", %{view: view} do
      MultiTimeView.init_subquery(view, :s7, [10])
      assert MultiTimeView.member_at_all_times?(view, :s7, 10)
    end

    test "false once a transition has been recorded", %{view: view} do
      MultiTimeView.init_subquery(view, :s7, [10])
      MultiTimeView.mark_out(view, :s7, 10, 1)

      refute MultiTimeView.member_at_all_times?(view, :s7, 10)
    end

    test "false for values never seen", %{view: view} do
      MultiTimeView.init_subquery(view, :s7, [10])
      refute MultiTimeView.member_at_all_times?(view, :s7, 99)
    end
  end

  describe "values/2" do
    test "returns every value with retained membership", %{view: view} do
      MultiTimeView.init_subquery(view, :s7, [10, 20])
      MultiTimeView.mark_in(view, :s7, 30, 1)

      assert MultiTimeView.values(view, :s7) |> Enum.sort() == [10, 20, 30]
    end

    test "includes values that have been removed but are still retained", %{view: view} do
      MultiTimeView.init_subquery(view, :s7, [10, 20])
      MultiTimeView.mark_out(view, :s7, 20, 1)

      assert MultiTimeView.values(view, :s7) |> Enum.sort() == [10, 20]
    end

    test "returns an empty list for an unknown subquery", %{view: view} do
      assert MultiTimeView.values(view, :unknown) == []
    end
  end

  describe "values/3" do
    test "returns only members at the given logical time", %{view: view} do
      MultiTimeView.init_subquery(view, :s7, [10, 20])
      MultiTimeView.mark_in(view, :s7, 30, 1)
      MultiTimeView.mark_out(view, :s7, 20, 2)

      assert MultiTimeView.values(view, :s7, 0) |> Enum.sort() == [10, 20]
      assert MultiTimeView.values(view, :s7, 1) |> Enum.sort() == [10, 20, 30]
      assert MultiTimeView.values(view, :s7, 2) |> Enum.sort() == [10, 30]
    end
  end

  describe "current_time/2" do
    test "is nil for an unknown subquery", %{view: view} do
      assert MultiTimeView.current_time(view, :unknown) == nil
    end

    test "is the highest time written so far", %{view: view} do
      MultiTimeView.init_subquery(view, :s7, [10])
      MultiTimeView.mark_in(view, :s7, 30, 1)
      MultiTimeView.mark_out(view, :s7, 30, 4)

      assert MultiTimeView.current_time(view, :s7) == 4
    end
  end

  describe "set_min_required_time/3" do
    test "folds toggles at or before the new min into the initial state", %{view: view} do
      MultiTimeView.init_subquery(view, :s7, [10])
      MultiTimeView.mark_out(view, :s7, 10, 1)
      MultiTimeView.mark_in(view, :s7, 10, 3)

      MultiTimeView.set_min_required_time(view, :s7, 3)

      # Value 10 is in for the entire retained window after compaction.
      assert MultiTimeView.member_at_all_times?(view, :s7, 10)
    end

    test "drops rows for values that are out for the whole retained window", %{view: view} do
      MultiTimeView.init_subquery(view, :s7, [10, 20])
      MultiTimeView.mark_out(view, :s7, 20, 1)

      MultiTimeView.set_min_required_time(view, :s7, 2)

      refute MultiTimeView.member_at_some_time?(view, :s7, 20)
      assert MultiTimeView.values(view, :s7) == [10]
    end

    test "preserves membership for retained times after compaction", %{view: view} do
      MultiTimeView.init_subquery(view, :s7, [])
      MultiTimeView.mark_in(view, :s7, 30, 1)
      MultiTimeView.mark_out(view, :s7, 30, 5)

      MultiTimeView.set_min_required_time(view, :s7, 3)

      # 30 was in from time 1, including at time 3 (the new min) and 4.
      assert MultiTimeView.member?(view, :s7, 30, 3)
      assert MultiTimeView.member?(view, :s7, 30, 4)
      refute MultiTimeView.member?(view, :s7, 30, 5)
    end
  end

  describe "remove_subquery/2" do
    test "deletes all rows for the subquery", %{view: view} do
      MultiTimeView.init_subquery(view, :s7, [10, 20])
      MultiTimeView.mark_ready(view, :s7)
      MultiTimeView.mark_in(view, :s7, 30, 1)

      MultiTimeView.remove_subquery(view, :s7)

      refute MultiTimeView.ready?(view, :s7)
      assert MultiTimeView.values(view, :s7) == []
      assert MultiTimeView.current_time(view, :s7) == nil
    end

    test "leaves other subqueries untouched", %{view: view} do
      MultiTimeView.init_subquery(view, :s7, [10])
      MultiTimeView.init_subquery(view, :s8, [20])
      MultiTimeView.mark_ready(view, :s8)

      MultiTimeView.remove_subquery(view, :s7)

      assert MultiTimeView.values(view, :s8) == [20]
      assert MultiTimeView.ready?(view, :s8)
    end
  end

  describe "for_stack/1" do
    test "returns the table when one was created for the stack" do
      stack_id = "stack-#{System.unique_integer([:positive])}"
      _view = MultiTimeView.new(stack_id: stack_id)

      assert MultiTimeView.for_stack(stack_id) != nil
    end

    test "returns nil when no table exists for the stack" do
      assert MultiTimeView.for_stack("nope-#{System.unique_integer([:positive])}") == nil
    end
  end
end
