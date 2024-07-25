defmodule Support.StubInspector do
  @behaviour Electric.Postgres.Inspector

  def new(opts), do: {__MODULE__, opts}

  @impl true
  def load_column_info(_relation, column_list) when is_list(column_list) do
    column_list
    |> Enum.map(fn column ->
      column
      |> Map.put_new(:pk_position, nil)
      |> Map.put_new(:type, "text")
    end)
    |> then(&{:ok, &1})
  end

  def load_column_info(relation, opts) when is_map(opts) and is_map_key(opts, relation) do
    opts
    |> Map.fetch!(relation)
    |> then(&load_column_info(relation, &1))
  end
end
