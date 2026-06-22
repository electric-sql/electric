defmodule Electric.Shapes.DependencyLayersTest do
  use ExUnit.Case, async: true

  alias Electric.Shapes.DependencyLayers

  @outer_shape_id 1
  @inner_shape_id 2
  @inner_inner_shape_id 3

  defp add_dependency!(layers, dependency_ids, shape_id) do
    {:ok, layers} =
      DependencyLayers.add_dependency(layers, dependency_ids, shape_id)

    layers
  end

  describe "groups into dependency layers" do
    test "for two layers" do
      # outer depends on inner
      layers =
        DependencyLayers.new()
        |> add_dependency!([], @inner_shape_id)
        |> add_dependency!([@inner_shape_id], @outer_shape_id)

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
      # outer depends on inner, inner depends on inner_inner
      layers =
        DependencyLayers.new()
        |> add_dependency!([], @inner_inner_shape_id)
        |> add_dependency!([@inner_inner_shape_id], @inner_shape_id)
        |> add_dependency!([@inner_shape_id], @outer_shape_id)

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
      inner_id_1 = 11
      inner_id_2 = 12

      # Outer shape depends on both inner shapes
      layers =
        DependencyLayers.new()
        |> add_dependency!([], inner_id_1)
        |> add_dependency!([], inner_id_2)
        |> add_dependency!([inner_id_1, inner_id_2], @outer_shape_id)

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
      # inner depends on inner_inner, goes to layer 1
      # another_inner has no dependencies, goes to layer 0
      another_inner_id = 13

      # Outer shape depends on both inner and another_inner (layers 1 and 0)
      # Should go to layer 2 (1 + max(1, 0))
      layers =
        DependencyLayers.new()
        |> add_dependency!([], @inner_inner_shape_id)
        |> add_dependency!([@inner_inner_shape_id], @inner_shape_id)
        |> add_dependency!([], another_inner_id)
        |> add_dependency!([@inner_shape_id, another_inner_id], @outer_shape_id)

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
      # Add outer shape WITHOUT adding inner shape first
      layers = DependencyLayers.new()

      assert {:error, {:missing_dependencies, _missing}} =
               DependencyLayers.add_dependency(
                 layers,
                 [@inner_shape_id],
                 @outer_shape_id
               )
    end

    test "returns error when dependency was removed before dependent was added" do
      # Add inner shape, then remove it
      layers =
        DependencyLayers.new()
        |> add_dependency!([], @inner_shape_id)
        |> DependencyLayers.remove_dependency(@inner_shape_id)

      # Try to add dependent - should fail
      assert {:error, {:missing_dependencies, _missing}} =
               DependencyLayers.add_dependency(
                 layers,
                 [@inner_shape_id],
                 @outer_shape_id
               )
    end

    test "returns error when some dependencies are missing" do
      inner_id_1 = 11
      inner_id_2 = 12

      # Outer shape depends on both inner shapes
      # Only add inner_shape_1, not inner_shape_2
      layers =
        DependencyLayers.new()
        |> add_dependency!([], inner_id_1)

      assert {:error, {:missing_dependencies, _missing}} =
               DependencyLayers.add_dependency(
                 layers,
                 [inner_id_1, inner_id_2],
                 @outer_shape_id
               )
    end

    test "adding shape without dependencies returns ok tuple" do
      assert {:ok, layers} =
               DependencyLayers.new()
               |> DependencyLayers.add_dependency(
                 [],
                 @inner_shape_id
               )

      assert layers == [MapSet.new([@inner_shape_id])]
    end
  end
end
