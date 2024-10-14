defmodule Electric.Plug.Utils do
  @moduledoc """
  Utility functions for Electric endpoints, e.g. for parsing and validating
  path and query parameters.
  """

  @doc """
  Parse columns parameter from a string consisting of a comma separated list
  of potentially quoted column names into a sorted list of strings.

  ## Examples
      iex> Electric.Plug.Utils.parse_columns_param("")
      {:ok, MapSet.new([""])}
      iex> Electric.Plug.Utils.parse_columns_param("id")
      {:ok, MapSet.new(["id"])}
      iex> Electric.Plug.Utils.parse_columns_param("beta,alpha")
      {:ok, MapSet.new(["alpha", "beta"])}
      iex> Electric.Plug.Utils.parse_columns_param(~S|"PoTaTo,sunday",foo|)
      {:ok, MapSet.new(["PoTaTo,sunday", "foo"])}
      iex> Electric.Plug.Utils.parse_columns_param(~S|\"fo\"\"o\",bar|)
      {:ok, MapSet.new(["bar", ~S|fo"o|])}
      iex> Electric.Plug.Utils.parse_columns_param(~S|"id,"name"|)
      {:error, ~S|Invalid column, unmatched quote: "id|}
  """
  @spec parse_columns_param(binary()) :: {:ok, MapSet.t(String.t())} | {:error, term()}
  def parse_columns_param(columns) when is_binary(columns) do
    columns
    # Split by commas that are not inside quotes
    |> String.split(~r/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)
    |> Enum.reduce_while(MapSet.new([]), fn column, acc ->
      casted_column = remove_surrounding_quotes(column)

      if contains_unescaped_quote?(casted_column) do
        {:halt, {:error, "Invalid column, unmatched quote: #{casted_column}"}}
      else
        {:cont, acc |> MapSet.put(unescape_quotes(casted_column))}
      end
    end)
    |> then(fn result ->
      case result do
        parsed_cols when is_map(parsed_cols) -> {:ok, parsed_cols}
        {:error, reason} -> {:error, reason}
      end
    end)
  end

  defp contains_unescaped_quote?(string) do
    Regex.match?(~r/(?<!")"(?!")/, string)
  end

  defp remove_surrounding_quotes(string) do
    string
    |> String.replace(~r/^"(.*)"$/, "\\1")
  end

  defp unescape_quotes(string) do
    string
    |> String.replace(~r/""/, "\"")
  end
end
