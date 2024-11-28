defmodule Electric.Shapes.Filter.TableFilter do
  def remove_shape(%{fields: fields, other_shapes: other_shapes}, handle) do
    %{
      fields: remove_shape_from_fields(fields, handle),
      other_shapes: Map.delete(other_shapes, handle)
    }
  end

  defp remove_shape_from_fields(fields, handle) do
    fields
    |> Map.new(fn {field, value_filter} ->
      {field, remove_shape_from_value_filter(value_filter, handle)}
    end)
    |> Enum.reject(fn {_field, value_filter} -> map_size(value_filter) == 0 end)
    |> Map.new()
  end

  defp remove_shape_from_value_filter(value_filter, handle) do
    value_filter
    |> Map.new(fn {value, shapes} -> {value, shapes |> Enum.reject(&(&1.handle == handle))} end)
    |> Enum.reject(fn {_value, shapes} -> shapes == [] end)
    |> Map.new()
  end
end
