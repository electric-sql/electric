defmodule Electric.Shapes.DependencyLayersTest do
  use ExUnit.Case, async: true

  alias Electric.Shapes.DependencyLayers
  alias Electric.Shapes.Shape
  alias Support.StubInspector

  @inspector StubInspector.new(
               tables: ["parent", "child", "issues", "projects", "comments"],
               columns: [
                 %{name: "id", type: "int8", pk_position: 0},
                 %{name: "parent_id", type: "int8"},
                 %{name: "project_id", type: "int8"},
                 %{name: "issue_id", type: "int8"},
                 %{name: "comment_id", type: "int8"}
               ]
             )

  @outer_shape_id 1
  @inner_shape_id 2
  @inner_inner_shape_id 3

  defp add_dependency!(layers, shape, shape_id) do
    {:ok, layers} =
      DependencyLayers.add_dependency(layers, shape.shape_dependencies_handles, shape_id)

    layers
  end

  describe "groups into dependency layers" do
    test "for two layers" do
      inner_shape = Shape.new!("parent", select: "SELECT id FROM parent", inspector: @inspector)

      outer_shape =
        Shape.new!("child", where: "parent_id IN (SELECT id FROM parent)", inspector: @inspector)
        |> Map.put(:shape_dependencies, [inner_shape])
        |> Map.put(:shape_dependencies_handles, [@inner_shape_id])

      layers =
        DependencyLayers.new()
        |> add_dependency!(inner_shape, @inner_shape_id)
        |> add_dependency!(outer_shape, @outer_shape_id)

      assert DependencyLayers.get_for_shape_ids(
               layers,
               MapSet.new([@outer_shape_id, @inner_shape_id])
             ) == [
               MapSet.new([@inner_shape_id]),
               MapSet.new([@outer_shape_id])
             ]

      assert DependencyLayers.get_for_shape_ids(
               layers,
               MapSet.new([@outer_shape_id])
             ) == [
               MapSet.new([@outer_shape_id])
             ]

      assert DependencyLayers.get_for_shape_ids(
               layers,
               MapSet.new([@inner_shape_id])
             ) == [
               MapSet.new([@inner_shape_id])
             ]
    end

    test "for three layers" do
      inner_inner_shape =
        Shape.new!("project", select: "SELECT id FROM projects", inspector: @inspector)

      inner_shape =
        Shape.new!("issues",
          select: "SELECT id FROM issues WHERE project_id IN (SELECT id FROM projects)",
          inspector: @inspector
        )
        |> Map.put(:shape_dependencies, [inner_inner_shape])
        |> Map.put(:shape_dependencies_handles, [@inner_inner_shape_id])

      outer_shape =
        Shape.new!("comments",
          where:
            "issue_id IN (SELECT id FROM issues WHERE project_id IN (SELECT id FROM projects))",
          inspector: @inspector
        )
        |> Map.put(:shape_dependencies, [inner_shape])
        |> Map.put(:shape_dependencies_handles, [@inner_shape_id])

      layers =
        DependencyLayers.new()
        |> add_dependency!(inner_inner_shape, @inner_inner_shape_id)
        |> add_dependency!(inner_shape, @inner_shape_id)
        |> add_dependency!(outer_shape, @outer_shape_id)

      assert DependencyLayers.get_for_shape_ids(
               layers,
               MapSet.new([@outer_shape_id, @inner_inner_shape_id, @inner_shape_id])
             ) == [
               MapSet.new([@inner_inner_shape_id]),
               MapSet.new([@inner_shape_id]),
               MapSet.new([@outer_shape_id])
             ]
    end

    test "for multiple dependencies at the same level" do
      # Two inner shapes at layer 0
      inner_shape_1 =
        Shape.new!("parent", select: "SELECT id FROM parent", inspector: @inspector)

      inner_shape_2 =
        Shape.new!("projects", select: "SELECT id FROM projects", inspector: @inspector)

      inner_id_1 = 11
      inner_id_2 = 12

      # Outer shape depends on both inner shapes
      outer_shape =
        Shape.new!("child",
          where:
            "parent_id IN (SELECT id FROM parent) AND project_id IN (SELECT id FROM projects)",
          inspector: @inspector
        )
        |> Map.put(:shape_dependencies, [inner_shape_1, inner_shape_2])
        |> Map.put(:shape_dependencies_handles, [inner_id_1, inner_id_2])

      layers =
        DependencyLayers.new()
        |> add_dependency!(inner_shape_1, inner_id_1)
        |> add_dependency!(inner_shape_2, inner_id_2)
        |> add_dependency!(outer_shape, @outer_shape_id)

      # Both inner shapes should be in layer 0, outer shape should be in layer 1
      assert DependencyLayers.get_for_shape_ids(
               layers,
               MapSet.new([@outer_shape_id, inner_id_1, inner_id_2])
             ) == [
               MapSet.new([inner_id_1, inner_id_2]),
               MapSet.new([@outer_shape_id])
             ]
    end

    test "for multiple dependencies at different levels" do
      # inner_inner at layer 0
      inner_inner_shape =
        Shape.new!("projects", select: "SELECT id FROM projects", inspector: @inspector)

      # inner depends on inner_inner, goes to layer 1
      inner_shape =
        Shape.new!("issues",
          select: "SELECT id FROM issues WHERE project_id IN (SELECT id FROM projects)",
          inspector: @inspector
        )
        |> Map.put(:shape_dependencies, [inner_inner_shape])
        |> Map.put(:shape_dependencies_handles, [@inner_inner_shape_id])

      # another inner shape with no dependencies, goes to layer 0
      another_inner_shape =
        Shape.new!("parent", select: "SELECT id FROM parent", inspector: @inspector)

      another_inner_id = 13

      # Outer shape depends on both inner and another_inner (layers 1 and 0)
      # Should go to layer 2 (1 + max(1, 0))
      outer_shape =
        Shape.new!("comments",
          where:
            "issue_id IN (SELECT id FROM issues WHERE project_id IN (SELECT id FROM projects)) AND parent_id IN (SELECT id FROM parent)",
          inspector: @inspector
        )
        |> Map.put(:shape_dependencies, [inner_shape, another_inner_shape])
        |> Map.put(:shape_dependencies_handles, [@inner_shape_id, another_inner_id])

      layers =
        DependencyLayers.new()
        |> add_dependency!(inner_inner_shape, @inner_inner_shape_id)
        |> add_dependency!(inner_shape, @inner_shape_id)
        |> add_dependency!(another_inner_shape, another_inner_id)
        |> add_dependency!(outer_shape, @outer_shape_id)

      assert DependencyLayers.get_for_shape_ids(
               layers,
               MapSet.new([
                 @outer_shape_id,
                 @inner_inner_shape_id,
                 @inner_shape_id,
                 another_inner_id
               ])
             ) == [
               # Layer 0: inner_inner and another_inner
               MapSet.new([@inner_inner_shape_id, another_inner_id]),
               # Layer 1: inner
               MapSet.new([@inner_shape_id]),
               # Layer 2: outer
               MapSet.new([@outer_shape_id])
             ]
    end
  end

  describe "error handling" do
    test "returns error when dependency handle is missing from layers" do
      inner_shape = Shape.new!("parent", select: "SELECT id FROM parent", inspector: @inspector)

      outer_shape =
        Shape.new!("child", where: "parent_id IN (SELECT id FROM parent)", inspector: @inspector)
        |> Map.put(:shape_dependencies, [inner_shape])
        |> Map.put(:shape_dependencies_handles, [@inner_shape_id])

      # Add outer shape WITHOUT adding inner shape first
      layers = DependencyLayers.new()

      assert {:error, {:missing_dependencies, _missing}} =
               DependencyLayers.add_dependency(
                 layers,
                 outer_shape.shape_dependencies_handles,
                 @outer_shape_id
               )
    end

    test "returns error when dependency was removed before dependent was added" do
      inner_shape = Shape.new!("parent", select: "SELECT id FROM parent", inspector: @inspector)

      outer_shape =
        Shape.new!("child", where: "parent_id IN (SELECT id FROM parent)", inspector: @inspector)
        |> Map.put(:shape_dependencies, [inner_shape])
        |> Map.put(:shape_dependencies_handles, [@inner_shape_id])

      # Add inner shape, then remove it
      layers =
        DependencyLayers.new()
        |> add_dependency!(inner_shape, @inner_shape_id)
        |> DependencyLayers.remove_dependency(@inner_shape_id)

      # Try to add dependent - should fail
      assert {:error, {:missing_dependencies, _missing}} =
               DependencyLayers.add_dependency(
                 layers,
                 outer_shape.shape_dependencies_handles,
                 @outer_shape_id
               )
    end

    test "returns error when some dependencies are missing" do
      inner_shape_1 =
        Shape.new!("parent", select: "SELECT id FROM parent", inspector: @inspector)

      inner_shape_2 =
        Shape.new!("projects", select: "SELECT id FROM projects", inspector: @inspector)

      inner_id_1 = 11
      inner_id_2 = 12

      # Outer shape depends on both inner shapes
      outer_shape =
        Shape.new!("child",
          where:
            "parent_id IN (SELECT id FROM parent) AND project_id IN (SELECT id FROM projects)",
          inspector: @inspector
        )
        |> Map.put(:shape_dependencies, [inner_shape_1, inner_shape_2])
        |> Map.put(:shape_dependencies_handles, [inner_id_1, inner_id_2])

      # Only add inner_shape_1, not inner_shape_2
      layers =
        DependencyLayers.new()
        |> add_dependency!(inner_shape_1, inner_id_1)

      assert {:error, {:missing_dependencies, _missing}} =
               DependencyLayers.add_dependency(
                 layers,
                 outer_shape.shape_dependencies_handles,
                 @outer_shape_id
               )
    end

    test "adding shape without dependencies returns ok tuple" do
      shape = Shape.new!("parent", select: "SELECT id FROM parent", inspector: @inspector)

      assert {:ok, layers} =
               DependencyLayers.new()
               |> DependencyLayers.add_dependency(
                 shape.shape_dependencies_handles,
                 @inner_shape_id
               )

      assert layers == [MapSet.new([@inner_shape_id])]
    end
  end
end
