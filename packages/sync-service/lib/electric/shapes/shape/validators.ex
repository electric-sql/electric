defmodule Electric.Shapes.Shape.Validators do
  def validate_parameters(params) when is_map(params) do
    with {:ok, keys} <- all_keys_are_numbers(params),
         :ok <- all_keys_are_sequential(keys) do
      :ok
    end
  end

  def validate_parameters(_), do: :ok

  defp all_keys_are_numbers(params) do
    Electric.Utils.map_while_ok(params, fn {key, _} ->
      case Integer.parse(key) do
        {int, ""} -> {:ok, int}
        _ -> {:error, {:params, "Parameters can only use numbers as keys"}}
      end
    end)
  end

  defp all_keys_are_sequential(keys) do
    keys
    |> Enum.sort()
    |> Enum.with_index(fn key, index -> key == index + 1 end)
    |> Enum.all?()
    |> if(
      do: :ok,
      else: {:error, {:params, "Parameters must be numbered sequentially, starting from 1"}}
    )
  end

  def validate_where_return_type(where) do
    case where.returns do
      :bool -> {:ok, where}
      _ -> {:error, {:where, "WHERE clause must return a boolean"}}
    end
  end
end
