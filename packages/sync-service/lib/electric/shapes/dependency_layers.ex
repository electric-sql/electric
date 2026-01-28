defmodule Electric.Shapes.DependencyLayers do
  def new do
    []
  end

  def add_dependency(layers, shape, shape_handle) do
    case shape.shape_dependencies_handles do
      [] ->
        {:ok, add_to_first_layer(layers, shape_handle)}

      dependency_handles ->
        add_after_dependencies(layers, shape_handle, MapSet.new(dependency_handles))
    end
  end

  defp add_after_dependencies([layer | rest], shape_handle, deps_to_find) do
    remaining_deps = MapSet.difference(deps_to_find, layer)

    if MapSet.size(remaining_deps) == 0 do
      {:ok, [layer | add_to_first_layer(rest, shape_handle)]}
    else
      case add_after_dependencies(rest, shape_handle, remaining_deps) do
        {:ok, rest_layers} -> {:ok, [layer | rest_layers]}
        {:error, _} = error -> error
      end
    end
  end

  defp add_after_dependencies([], _shape_handle, deps_to_find) do
    {:error, {:missing_dependencies, deps_to_find}}
  end

  def remove_dependency(layers, shape_handle) do
    # FIXME: this assumes children are removed before parents, not sure how true this is
    Enum.map(layers, &MapSet.delete(&1, shape_handle))
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
