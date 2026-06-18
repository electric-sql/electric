defmodule Electric.Shapes.DependencyLayers do
  def new do
    []
  end

  def add_dependency(layers, dependency_ids, shape_id) do
    case dependency_ids do
      [] ->
        {:ok, add_to_first_layer(layers, shape_id)}

      dependency_ids ->
        add_after_dependencies(layers, shape_id, MapSet.new(dependency_ids))
    end
  end

  defp add_after_dependencies([layer | rest], shape_id, deps_to_find) do
    remaining_deps = MapSet.difference(deps_to_find, layer)

    if MapSet.size(remaining_deps) == 0 do
      {:ok, [layer | add_to_first_layer(rest, shape_id)]}
    else
      case add_after_dependencies(rest, shape_id, remaining_deps) do
        {:ok, rest_layers} -> {:ok, [layer | rest_layers]}
        {:error, _} = error -> error
      end
    end
  end

  defp add_after_dependencies([], _shape_id, deps_to_find) do
    {:error, {:missing_dependencies, deps_to_find}}
  end

  def remove_dependency(layers, shape_id) do
    # FIXME: this assumes children are removed before parents, not sure how true this is
    Enum.map(layers, &MapSet.delete(&1, shape_id))
  end

  defp add_to_first_layer([], shape_id) do
    [MapSet.new([shape_id])]
  end

  defp add_to_first_layer([first_layer | rest], shape_id) do
    [MapSet.put(first_layer, shape_id) | rest]
  end

  def get_for_shape_ids(layers, shape_ids) do
    layers
    |> Enum.map(&MapSet.intersection(&1, shape_ids))
    |> Enum.reject(&(MapSet.size(&1) == 0))
  end
end
