defmodule Electric.Replication.ShapeLogCollector.AffectedColumnsTest do
  use ExUnit.Case, async: true

  alias Electric.Replication.ShapeLogCollector.AffectedColumns
  alias Electric.Replication.Changes.{Relation, Column}

  setup do
    init_state = %{id_to_table_info: %{}, table_to_id: %{}}
    {:ok, state} = AffectedColumns.init(init_state)
    # The state returned by init/1 is our starting state
    %{state: state}
  end

  describe "transform_relation/2" do
    test "adding new relation", %{state: state} do
      relation = %Relation{
        id: 1,
        schema: "public",
        table: "users",
        columns: [
          %Column{name: "id", type_oid: 23},
          %Column{name: "name", type_oid: 25}
        ]
      }

      {returned_relation, new_state} = AffectedColumns.transform_relation(relation, state)

      # Verify relation is returned unchanged
      assert returned_relation == relation
      # Verify relation is added to state
      assert new_state.table_to_id[{"public", "users"}] == 1
      assert new_state.id_to_table_info[1] == relation
    end

    test "adding a second unrelated relation", %{state: state} do
      # First relation
      relation1 = %Relation{
        id: 1,
        schema: "public",
        table: "users",
        columns: [
          %Column{name: "id", type_oid: 23},
          %Column{name: "name", type_oid: 25}
        ]
      }

      {_, state_with_first} = AffectedColumns.transform_relation(relation1, state)

      # Second relation
      relation2 = %Relation{
        id: 2,
        schema: "public",
        table: "posts",
        columns: [
          %Column{name: "id", type_oid: 23},
          %Column{name: "title", type_oid: 25},
          %Column{name: "content", type_oid: 25}
        ]
      }

      {returned_relation, new_state} =
        AffectedColumns.transform_relation(relation2, state_with_first)

      # Verify relation is returned unchanged
      assert returned_relation == relation2
      # Verify both relations are in state
      assert new_state.table_to_id[{"public", "users"}] == 1
      assert new_state.table_to_id[{"public", "posts"}] == 2
      assert new_state.id_to_table_info[1] == relation1
      assert new_state.id_to_table_info[2] == relation2
    end

    test "relation with same id/schema/table but column was added", %{state: state} do
      # Original relation
      original_relation = %Relation{
        id: 1,
        schema: "public",
        table: "users",
        columns: [
          %Column{name: "id", type_oid: 23},
          %Column{name: "name", type_oid: 25}
        ]
      }

      {_, state_with_original} = AffectedColumns.transform_relation(original_relation, state)

      # Updated relation with new column
      updated_relation = %Relation{
        id: 1,
        schema: "public",
        table: "users",
        columns: [
          %Column{name: "id", type_oid: 23},
          %Column{name: "name", type_oid: 25},
          %Column{name: "email", type_oid: 25}
        ]
      }

      {returned_relation, new_state} =
        AffectedColumns.transform_relation(updated_relation, state_with_original)

      # Verify "email" is detected as an affected column
      assert returned_relation.affected_columns == ["email"]
      # Verify state is updated with the new relation
      assert new_state.id_to_table_info[1] == updated_relation
      assert new_state.table_to_id[{"public", "users"}] == 1
    end

    test "relation with same id/schema/table but column type changed", %{state: state} do
      # Original relation
      original_relation = %Relation{
        id: 1,
        schema: "public",
        table: "users",
        columns: [
          %Column{name: "id", type_oid: 23},
          %Column{name: "name", type_oid: 25}
        ]
      }

      {_, state_with_original} = AffectedColumns.transform_relation(original_relation, state)

      # Updated relation with changed column type
      updated_relation = %Relation{
        id: 1,
        schema: "public",
        table: "users",
        columns: [
          %Column{name: "id", type_oid: 23},
          # Changed type OID
          %Column{name: "name", type_oid: 26}
        ]
      }

      {returned_relation, new_state} =
        AffectedColumns.transform_relation(updated_relation, state_with_original)

      # Verify "name" is detected as an affected column
      assert returned_relation.affected_columns == ["name"]
      # Verify state is updated with the new relation
      assert new_state.id_to_table_info[1] == updated_relation
      assert new_state.table_to_id[{"public", "users"}] == 1
    end

    test "relation with same id/schema/table but column name and type changed", %{state: state} do
      # Original relation
      original_relation = %Relation{
        id: 1,
        schema: "public",
        table: "users",
        columns: [
          %Column{name: "id", type_oid: 23},
          %Column{name: "name", type_oid: 25},
          %Column{name: "description", type_oid: 25}
        ]
      }

      {_, state_with_original} = AffectedColumns.transform_relation(original_relation, state)

      # Updated relation with both name and type changes
      updated_relation = %Relation{
        id: 1,
        schema: "public",
        table: "users",
        columns: [
          %Column{name: "id", type_oid: 23},
          # Changed name
          %Column{name: "username", type_oid: 25},
          # Changed type
          %Column{name: "description", type_oid: 26}
        ]
      }

      {returned_relation, new_state} =
        AffectedColumns.transform_relation(updated_relation, state_with_original)

      # Verify both "name"/"username" and "description" are affected columns
      assert Enum.sort(returned_relation.affected_columns) ==
               Enum.sort(["name", "username", "description"])

      # Verify state is updated with the new relation
      assert new_state.id_to_table_info[1] == updated_relation
      assert new_state.table_to_id[{"public", "users"}] == 1
    end

    test "relation with changed id but same schema/table & column list", %{state: state} do
      # Original relation
      original_relation = %Relation{
        id: 1,
        schema: "public",
        table: "users",
        columns: [
          %Column{name: "id", type_oid: 23},
          %Column{name: "name", type_oid: 25}
        ]
      }

      {_, state_with_original} = AffectedColumns.transform_relation(original_relation, state)

      # Relation with changed ID
      updated_relation = %Relation{
        id: 2,
        schema: "public",
        table: "users",
        columns: [
          %Column{name: "id", type_oid: 23},
          %Column{name: "name", type_oid: 25}
        ]
      }

      {returned_relation, new_state} =
        AffectedColumns.transform_relation(updated_relation, state_with_original)

      # Verify relation is returned unchanged
      assert returned_relation == updated_relation
      # Verify old ID is removed
      refute Map.has_key?(new_state.id_to_table_info, 1)
      # Verify new ID is added
      assert new_state.id_to_table_info == %{2 => updated_relation}
      # Verify schema/table points to new ID
      assert new_state.table_to_id == %{{"public", "users"} => 2}
    end

    test "relation with changed schema/table but same id & column list", %{state: state} do
      # Original relation
      original_relation = %Relation{
        id: 1,
        schema: "public",
        table: "users",
        columns: [
          %Column{name: "id", type_oid: 23},
          %Column{name: "name", type_oid: 25}
        ]
      }

      {_, state_with_original} = AffectedColumns.transform_relation(original_relation, state)

      # Relation with changed schema/table
      updated_relation = %Relation{
        id: 1,
        # Changed schema
        schema: "app",
        # Changed table
        table: "accounts",
        columns: [
          %Column{name: "id", type_oid: 23},
          %Column{name: "name", type_oid: 25}
        ]
      }

      {returned_relation, new_state} =
        AffectedColumns.transform_relation(updated_relation, state_with_original)

      # Verify relation is returned unchanged
      assert returned_relation == updated_relation
      # Verify old schema/table mapping is removed
      refute Map.has_key?(new_state.table_to_id, {"public", "users"})
      # Verify new schema/table is added
      assert new_state.table_to_id == %{{"app", "accounts"} => 1}
      # Verify ID still points to the updated relation
      assert new_state.id_to_table_info == %{1 => updated_relation}
    end
  end
end
