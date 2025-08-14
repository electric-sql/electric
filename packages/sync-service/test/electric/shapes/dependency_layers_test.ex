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
  end
end
