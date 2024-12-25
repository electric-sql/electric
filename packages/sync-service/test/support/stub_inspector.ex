defmodule Support.StubInspector do
  @behaviour Electric.Postgres.Inspector

  # the opts is either a list of column details which will be applied to every table
  # or a map of %{{schema, name} => [columns: column_info, relation: relation_info]}
  def new(opts), do: {__MODULE__, opts}

  @impl true
  def load_column_info(_relation, column_info) when is_list(column_info) do
    column_info
    |> Enum.map(fn column ->
      column
      |> Map.put_new(:pk_position, nil)
      |> Map.put_new(:type, "text")
      |> Map.put_new(:type_id, {25, -1})
    end)
    |> then(&{:ok, &1})
  end

  def load_column_info(relation, opts) when is_map(opts) and is_map_key(opts, relation) do
    opts
    |> Map.fetch!(relation)
    |> Access.fetch!(:columns)
    |> then(&load_column_info(relation, &1))
  end

  @impl true
  def load_relation(table, opts) when is_map(opts) do
    with {:ok, rel} <- parse_relation(table),
         {:ok, config} <- Map.fetch(opts, rel),
         {:ok, info} <- Access.fetch(config, :relation) do
      {:ok,
       info
       |> Map.put_new(:relation, rel)
       |> Map.put_new(:relation_id, :erlang.phash2(rel))
       |> Map.put_new(:parent, nil)
       |> Map.put_new(:children, nil)}
    else
      :error ->
        raise "Invalid StubInspector config #{inspect(opts)}"

      error ->
        error
    end
  end

  def load_relation(table, _opts) do
    with {:ok, rel} <- parse_relation(table) do
      {:ok, %{relation: rel, relation_id: :erlang.phash2(rel)}}
    end
  end

  @impl true
  def clean(_, _), do: true

  defp parse_relation(table) when is_binary(table) do
    Electric.Postgres.Identifiers.parse_relation(table)
  end

  defp parse_relation({_, _} = rel) do
    {:ok, rel}
  end
end
