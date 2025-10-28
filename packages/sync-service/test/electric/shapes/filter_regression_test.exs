defmodule Electric.Shapes.FilterRegressionTest do
  use ExUnit.Case

  alias Electric.Replication.Changes.{NewRecord, Transaction}
  alias Electric.Shapes.{Filter, Shape}
  alias Support.StubInspector

  @moduletag :regression_test

  @inspector StubInspector.new(
               tables: ["users"],
               columns: [
                 %{name: "id", type: "int8", pk_position: 0},
                 %{name: "status", type: "text"}
               ]
             )

  describe "remove_shape/2 ordering bug (ID reuse)" do
    test "removing and re-adding shapes with ID reuse doesn't cause false positives" do
      # This test catches the critical bug where removing a shape before cleaning
      # up indexes can leave stale bits that cause false positives when IDs are reused.
      #
      # Scenario:
      # 1. Add shape A (status = 'active') - gets ID 0
      # 2. Add shape B (status = 'pending') - gets ID 1
      # 3. Remove shape A - ID 0 is freed
      # 4. Add shape C (status = 'completed') - reuses ID 0
      # 5. Insert record with status='active'
      #
      # Bug: If we removed the bitmap mapping BEFORE cleaning indexes,
      # the old bit for "active" would still be set at ID 0.
      # When C reuses ID 0, records matching A would incorrectly match C.

      # Step 1: Add shape A (status = 'active')
      shape_a = Shape.new!("users", where: "status = 'active'", inspector: @inspector)
      filter = Filter.new() |> Filter.add_shape("shape_a", shape_a)

      # Verify A matches 'active' records
      active_record = %Transaction{
        changes: [%NewRecord{relation: {"public", "users"}, record: %{"status" => "active"}}]
      }

      assert Filter.affected_shapes(filter, active_record) == MapSet.new(["shape_a"])

      # Step 2: Add shape B (status = 'pending')
      shape_b = Shape.new!("users", where: "status = 'pending'", inspector: @inspector)
      filter = Filter.add_shape(filter, "shape_b", shape_b)

      # Verify B matches 'pending' records
      pending_record = %Transaction{
        changes: [%NewRecord{relation: {"public", "users"}, record: %{"status" => "pending"}}]
      }

      assert Filter.affected_shapes(filter, pending_record) == MapSet.new(["shape_b"])

      # Step 3: Remove shape A - this should clean up the 'active' index entries
      filter = Filter.remove_shape(filter, "shape_a")

      # Verify 'active' records no longer match anything
      assert Filter.affected_shapes(filter, active_record) == MapSet.new([])

      # Step 4: Add shape C (status = 'completed') - may reuse A's old ID
      shape_c = Shape.new!("users", where: "status = 'completed'", inspector: @inspector)
      filter = Filter.add_shape(filter, "shape_c", shape_c)

      # Step 5: CRITICAL TEST - Verify 'active' records still don't match
      # If the bug exists, this would match shape_c because it reused A's ID
      # and the stale 'active' bit was left in the index
      active_after_reuse = Filter.affected_shapes(filter, active_record)

      assert active_after_reuse == MapSet.new([]),
             """
             REGRESSION: Shape C incorrectly matched records for removed shape A!
             This indicates the bitmap index was not cleaned up before the ID was reused.
             Expected: no matches
             Got: #{inspect(active_after_reuse)}
             """

      # Verify C correctly matches only 'completed' records
      completed_record = %Transaction{
        changes: [%NewRecord{relation: {"public", "users"}, record: %{"status" => "completed"}}]
      }

      assert Filter.affected_shapes(filter, completed_record) == MapSet.new(["shape_c"])

      # Verify B still works correctly
      assert Filter.affected_shapes(filter, pending_record) == MapSet.new(["shape_b"])
    end

    test "multiple remove/add cycles with same predicates" do
      # More aggressive test: repeatedly add/remove shapes with the same predicates
      # to maximize chances of ID reuse and expose stale bitmap issues

      for _iteration <- 1..10 do
        filter = Filter.new()

        # Add 5 shapes
        filter =
          Enum.reduce(1..5, filter, fn i, f ->
            shape = Shape.new!("users", where: "status = 'status_#{i}'", inspector: @inspector)
            Filter.add_shape(f, "shape_#{i}", shape)
          end)

        # Remove shapes 1, 3, 5 (to fragment ID space)
        filter =
          Enum.reduce([1, 3, 5], filter, fn i, f ->
            Filter.remove_shape(f, "shape_#{i}")
          end)

        # Add 3 new shapes (likely reusing IDs 1, 3, 5)
        filter =
          Enum.reduce(6..8, filter, fn i, f ->
            shape = Shape.new!("users", where: "status = 'new_status_#{i}'", inspector: @inspector)
            Filter.add_shape(f, "shape_#{i}", shape)
          end)

        # Verify old predicates don't match
        for i <- [1, 3, 5] do
          record = %Transaction{
            changes: [%NewRecord{relation: {"public", "users"}, record: %{"status" => "status_#{i}"}}]
          }

          matches = Filter.affected_shapes(filter, record)

          assert matches == MapSet.new([]),
                 """
                 Old predicate 'status_#{i}' incorrectly matched after removal!
                 Iteration context: multiple add/remove cycles
                 Matches: #{inspect(matches)}
                 """
        end

        # Verify new shapes work
        for i <- 6..8 do
          record = %Transaction{
            changes: [%NewRecord{relation: {"public", "users"}, record: %{"status" => "new_status_#{i}"}}]
          }

          matches = Filter.affected_shapes(filter, record)

          assert matches == MapSet.new(["shape_#{i}"]),
                 "New shape #{i} should match its predicate"
        end
      end
    end

    test "concurrent updates and deletes don't cause cross-contamination" do
      # Test that when shapes are removed and IDs reused, updates/deletes
      # affecting old records don't incorrectly match new shapes

      shape_a = Shape.new!("users", where: "id = 100", inspector: @inspector)
      filter = Filter.new() |> Filter.add_shape("shape_a", shape_a)

      # Remove shape A
      filter = Filter.remove_shape(filter, "shape_a")

      # Add shape B with different predicate (may reuse ID)
      shape_b = Shape.new!("users", where: "id = 200", inspector: @inspector)
      filter = Filter.add_shape(filter, "shape_b", shape_b)

      # Update record with old shape A's predicate (id=100)
      # Should NOT match shape B even if B reused A's bitmap ID
      update_old_id = %Transaction{
        changes: [
          %NewRecord{relation: {"public", "users"}, record: %{"id" => "100", "status" => "active"}}
        ]
      }

      matches = Filter.affected_shapes(filter, update_old_id)

      assert matches == MapSet.new([]),
             """
             Shape B incorrectly matched records from removed shape A's predicate!
             Shape A: id = 100 (removed)
             Shape B: id = 200 (current)
             Record: id = 100
             Matches: #{inspect(matches)}
             """

      # Verify B correctly matches its own predicate
      update_new_id = %Transaction{
        changes: [
          %NewRecord{relation: {"public", "users"}, record: %{"id" => "200", "status" => "active"}}
        ]
      }

      assert Filter.affected_shapes(filter, update_new_id) == MapSet.new(["shape_b"])
    end
  end
end
