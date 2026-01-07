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

  @outer_shape_handle "outer-shape"
  @inner_shape_handle "inner-shape"
  @inner_inner_shape_handle "inner-inner-shape"

  describe "groups into dependency layers" do
    test "for two layers" do
      inner_shape = Shape.new!("parent", select: "SELECT id FROM parent", inspector: @inspector)

      outer_shape =
        Shape.new!("child", where: "parent_id IN (SELECT id FROM parent)", inspector: @inspector)
        |> Map.put(:shape_dependencies, [inner_shape])
        |> Map.put(:shape_dependencies_handles, [@inner_shape_handle])

      layers =
        DependencyLayers.new()
        |> DependencyLayers.add_dependency(inner_shape, @inner_shape_handle)
        |> DependencyLayers.add_dependency(outer_shape, @outer_shape_handle)

      assert DependencyLayers.get_for_handles(
               layers,
               MapSet.new([@outer_shape_handle, @inner_shape_handle])
             ) == [
               MapSet.new([@inner_shape_handle]),
               MapSet.new([@outer_shape_handle])
             ]

      assert DependencyLayers.get_for_handles(
               layers,
               MapSet.new([@outer_shape_handle])
             ) == [
               MapSet.new([@outer_shape_handle])
             ]

      assert DependencyLayers.get_for_handles(
               layers,
               MapSet.new([@inner_shape_handle])
             ) == [
               MapSet.new([@inner_shape_handle])
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
        |> Map.put(:shape_dependencies_handles, [@inner_inner_shape_handle])

      outer_shape =
        Shape.new!("comments",
          where:
            "issue_id IN (SELECT id FROM issues WHERE project_id IN (SELECT id FROM projects))",
          inspector: @inspector
        )
        |> Map.put(:shape_dependencies, [inner_shape])
        |> Map.put(:shape_dependencies_handles, [@inner_shape_handle])

      layers =
        DependencyLayers.new()
        |> DependencyLayers.add_dependency(inner_inner_shape, @inner_inner_shape_handle)
        |> DependencyLayers.add_dependency(inner_shape, @inner_shape_handle)
        |> DependencyLayers.add_dependency(outer_shape, @outer_shape_handle)

      assert DependencyLayers.get_for_handles(
               layers,
               MapSet.new([@outer_shape_handle, @inner_inner_shape_handle, @inner_shape_handle])
             ) == [
               MapSet.new([@inner_inner_shape_handle]),
               MapSet.new([@inner_shape_handle]),
               MapSet.new([@outer_shape_handle])
             ]
    end

    test "for multiple dependencies at the same level" do
      # Two inner shapes at layer 0
      inner_shape_1 =
        Shape.new!("parent", select: "SELECT id FROM parent", inspector: @inspector)

      inner_shape_2 =
        Shape.new!("projects", select: "SELECT id FROM projects", inspector: @inspector)

      inner_handle_1 = "inner-shape-1"
      inner_handle_2 = "inner-shape-2"

      # Outer shape depends on both inner shapes
      outer_shape =
        Shape.new!("child",
          where:
            "parent_id IN (SELECT id FROM parent) AND project_id IN (SELECT id FROM projects)",
          inspector: @inspector
        )
        |> Map.put(:shape_dependencies, [inner_shape_1, inner_shape_2])
        |> Map.put(:shape_dependencies_handles, [inner_handle_1, inner_handle_2])

      layers =
        DependencyLayers.new()
        |> DependencyLayers.add_dependency(inner_shape_1, inner_handle_1)
        |> DependencyLayers.add_dependency(inner_shape_2, inner_handle_2)
        |> DependencyLayers.add_dependency(outer_shape, @outer_shape_handle)

      # Both inner shapes should be in layer 0, outer shape should be in layer 1
      assert DependencyLayers.get_for_handles(
               layers,
               MapSet.new([@outer_shape_handle, inner_handle_1, inner_handle_2])
             ) == [
               MapSet.new([inner_handle_1, inner_handle_2]),
               MapSet.new([@outer_shape_handle])
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
        |> Map.put(:shape_dependencies_handles, [@inner_inner_shape_handle])

      # another inner shape with no dependencies, goes to layer 0
      another_inner_shape =
        Shape.new!("parent", select: "SELECT id FROM parent", inspector: @inspector)

      another_inner_handle = "another-inner-shape"

      # Outer shape depends on both inner and another_inner (layers 1 and 0)
      # Should go to layer 2 (1 + max(1, 0))
      outer_shape =
        Shape.new!("comments",
          where:
            "issue_id IN (SELECT id FROM issues WHERE project_id IN (SELECT id FROM projects)) AND parent_id IN (SELECT id FROM parent)",
          inspector: @inspector
        )
        |> Map.put(:shape_dependencies, [inner_shape, another_inner_shape])
        |> Map.put(:shape_dependencies_handles, [@inner_shape_handle, another_inner_handle])

      layers =
        DependencyLayers.new()
        |> DependencyLayers.add_dependency(inner_inner_shape, @inner_inner_shape_handle)
        |> DependencyLayers.add_dependency(inner_shape, @inner_shape_handle)
        |> DependencyLayers.add_dependency(another_inner_shape, another_inner_handle)
        |> DependencyLayers.add_dependency(outer_shape, @outer_shape_handle)

      assert DependencyLayers.get_for_handles(
               layers,
               MapSet.new([
                 @outer_shape_handle,
                 @inner_inner_shape_handle,
                 @inner_shape_handle,
                 another_inner_handle
               ])
             ) == [
               # Layer 0: inner_inner and another_inner
               MapSet.new([@inner_inner_shape_handle, another_inner_handle]),
               # Layer 1: inner
               MapSet.new([@inner_shape_handle]),
               # Layer 2: outer
               MapSet.new([@outer_shape_handle])
             ]
    end
  end
end
