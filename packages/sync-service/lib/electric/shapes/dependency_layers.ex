defmodule Electric.Shapes.DependencyLayers do
  def new do
    []
  end

  def add_dependency(layers, shape, shape_handle) do
    case shape.shape_dependencies_handles do
      [] ->
        add_to_first_layer(layers, shape_handle)

      [dependency_handle] ->
        [first_layer | rest] = layers

        if MapSet.member?(first_layer, dependency_handle) do
          [first_layer | add_to_first_layer(rest, shape_handle)]
        else
          [first_layer | add_dependency(rest, shape, shape_handle)]
        end
    end
  end

  defp add_to_first_layer([], shape_handle) do
    [MapSet.new([shape_handle])]
  end

  defp add_to_first_layer([first_layer | rest], shape_handle) do
    [MapSet.put(first_layer, shape_handle) | rest]
  end

  def get_for_handles(layers, shape_handles) do
    layers
    |> Enum.map(&MapSet.intersection(&1, shape_handles))
    |> Enum.reject(&(&1 == MapSet.new()))
  end
end
