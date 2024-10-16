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
      {:error, "Invalid zero-length delimited identifier"}
      iex> Electric.Plug.Utils.parse_columns_param("foo,")
      {:error, "Invalid zero-length delimited identifier"}
      iex> Electric.Plug.Utils.parse_columns_param("id")
      {:ok, ["id"]}
      iex> Electric.Plug.Utils.parse_columns_param("id,name")
      {:ok, ["id", "name"]}
      iex> Electric.Plug.Utils.parse_columns_param(~S|"PoT@To",PoTaTo|)
      {:ok, ["PoT@To", "potato"]}
      iex> Electric.Plug.Utils.parse_columns_param(~S|"PoTaTo,sunday",foo|)
      {:ok, ["PoTaTo,sunday", "foo"]}
      iex> Electric.Plug.Utils.parse_columns_param(~S|"fo""o",bar|)
      {:ok, [~S|fo"o|, "bar"]}
      iex> Electric.Plug.Utils.parse_columns_param(~S|"id,"name"|)
      {:error, ~S|Invalid unquoted identifier contains special characters: "id|}
  """
  @spec parse_columns_param(binary()) :: {:ok, [String.t(), ...]} | {:error, term()}

  def parse_columns_param(columns) when is_binary(columns) do
    columns
    # Split by commas that are not inside quotes
    |> String.split(~r/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)
    |> Enum.reduce_while([], fn column, acc ->
      case Electric.Postgres.Identifiers.parse(column) do
        {:ok, casted_column} -> {:cont, [casted_column | acc]}
        {:error, reason} -> {:halt, {:error, reason}}
      end
    end)
    |> then(fn result ->
      case result do
        # TODO: convert output to MapSet?
        parsed_cols when is_list(parsed_cols) -> {:ok, Enum.reverse(parsed_cols)}
        {:error, reason} -> {:error, reason}
      end
    end)
  end
end
