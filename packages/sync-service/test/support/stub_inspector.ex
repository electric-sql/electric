defmodule Support.StubInspector do
  @behaviour Electric.Postgres.Inspector
  import Electric, only: :macros

  @impl Electric.Postgres.Inspector
  def list_relations_with_stale_cache(opts), do: {:ok, Access.get(opts, :diverged_relations, [])}

  # the opts is either a list of column details which will be applied to every table
  # or a map of %{{schema, name} => [columns: column_info, relation: relation_info]}

  def new(opts) when is_list(opts) do
    with {:ok, table_list} <- Keyword.fetch(opts, :tables),
         {:ok, column_list} <- Keyword.fetch(opts, :columns) do
      table_list
      |> Enum.map(fn table -> {table, column_list} end)
      |> Enum.into(%{})
      |> new()
    else
      :error ->
        raise "Invalid StubInspector config (missing a top-level key `tables` and `columns`), got #{inspect(opts)}"
    end
  end

  def new(opts) when is_map(opts) do
    {relation_to_oid, info} =
      Enum.map(opts, fn
        {k, v} ->
          {oid, relation} = normalize_oid_relation(k)

          relation_info =
            get_relation_info(v)
            |> Map.put(:relation, relation)
            |> Map.put(:relation_id, oid)
            |> Map.put_new(:kind, :ordinary_table)
            |> Map.put_new(:parent, nil)
            |> Map.put_new(:children, nil)

          column_info = get_column_info(v)

          {
            {relation, oid},
            {oid, %{relation: relation_info, columns: column_info}}
          }

        not_a_tuple ->
          raise "Invalid StubInspector config (must be a map/kv with a relation as key), got #{inspect(not_a_tuple)} in #{inspect(opts)}"
      end)
      |> Enum.unzip()

    {__MODULE__, {Map.new(relation_to_oid), Map.new(info)}}
  end

  def no_conn(), do: {__MODULE__, :no_conn}

  defp normalize_oid_relation(oid_relation) when is_oid_relation(oid_relation) do
    oid_relation
  end

  defp normalize_oid_relation(relation) when is_relation(relation) do
    {:erlang.phash2(relation), relation}
  end

  defp normalize_oid_relation(relation) when is_binary(relation) or is_atom(relation) do
    normalize_oid_relation({"public", to_string(relation)})
  end

  defp get_relation_info(%{relation: relation}), do: relation
  defp get_relation_info(_), do: %{}

  defp get_column_info(%{columns: columns}), do: columns
  defp get_column_info(column_list) when is_list(column_list), do: column_list

  @impl true
  def load_relation_oid(_, :no_conn) do
    {:error, :connection_not_available}
  end

  def load_relation_oid(relation, {relation_to_oid, _}) when is_relation(relation) do
    case Map.fetch(relation_to_oid, relation) do
      {:ok, oid} -> {:ok, {oid, relation}}
      :error -> :table_not_found
    end
  end

  @impl true
  def load_column_info(_, :no_conn) do
    {:error, :connection_not_available}
  end

  def load_column_info(oid, {_, info}) when is_relation_id(oid) when is_map_key(info, oid) do
    info[oid].columns
    |> Enum.map(fn column ->
      column
      |> Map.put_new(:pk_position, nil)
      |> Map.put_new(:type, "text")
      |> Map.put_new(:type_id, {25, -1})
      |> Map.put_new(:is_generated, false)
      |> Map.put_new(:array_dimensions, 0)
    end)
    |> then(&{:ok, &1})
  end

  @impl true
  def load_relation_info(_, :no_conn) do
    {:error, :connection_not_available}
  end

  def load_relation_info(oid, {_, info}) when is_relation_id(oid) and is_map_key(info, oid) do
    {:ok, info[oid].relation}
  end

  @impl true
  def load_supported_features(:no_conn) do
    {:error, :connection_not_available}
  end

  def load_supported_features(_), do: {:ok, %{supports_generated_column_replication: true}}

  # def load_relation(table, _opts) do
  #   with {:ok, rel} <- parse_relation(table) do
  #     {:ok, %{relation: rel, relation_id: :erlang.phash2(rel)}}
  #   end
  # end

  @impl true
  def clean(_, _), do: :ok
end
