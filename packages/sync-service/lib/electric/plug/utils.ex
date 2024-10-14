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
      {:error, "Must specify at least one column"}
      iex> Electric.Plug.Utils.parse_columns_param("foo,")
      {:error, "Invalid empty column provided"}
      iex> Electric.Plug.Utils.parse_columns_param("id")
      {:ok, ["id"]}
      iex> Electric.Plug.Utils.parse_columns_param("beta,alpha")
      {:ok, ["alpha", "beta"]}
      iex> Electric.Plug.Utils.parse_columns_param(~S|"PoTaTo,sunday",foo|)
      {:ok, ["PoTaTo,sunday", "foo"]}
      iex> Electric.Plug.Utils.parse_columns_param(~S|\"fo\"\"o\",bar|)
      {:ok, ["bar", ~S|fo"o|]}
      iex> Electric.Plug.Utils.parse_columns_param(~S|"id,"name"|)
      {:error, ~S|Invalid column, unmatched quote: "id|}
  """
  @spec parse_columns_param(binary()) :: {:ok, [String.t(), ...]} | {:error, term()}
  def parse_columns_param("") do
    {:error, "Must specify at least one column"}
  end

  def parse_columns_param(columns) when is_binary(columns) do
    columns
    # Split by commas that are not inside quotes
    |> String.split(~r/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)
    |> Enum.reduce_while([], fn column, acc ->
      casted_column = remove_surrounding_quotes(column)

      cond do
        contains_unescaped_quote?(casted_column) ->
          {:halt, {:error, "Invalid column, unmatched quote: #{casted_column}"}}

        String.trim(casted_column) == "" ->
          {:halt, {:error, "Invalid empty column provided"}}

        true ->
          {:cont, [unescape_quotes(casted_column) | acc]}
      end
    end)
    |> then(fn result ->
      case result do
        # sort to keep selected columns identical
        # TODO: convert output to MapSet?
        parsed_cols when is_list(parsed_cols) -> {:ok, Enum.sort(parsed_cols)}
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
