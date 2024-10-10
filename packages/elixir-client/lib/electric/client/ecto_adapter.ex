if Code.ensure_loaded?(Ecto) do
  defmodule Electric.Client.EctoAdapter do
    @moduledoc false

    alias Electric.Client.ShapeDefinition

    @behaviour Electric.Client.ValueMapper

    @doc false
    @spec shape_from_query!(Ecto.Queryable.t()) :: {ShapeDefinition.t(), {module(), module()}}
    def shape_from_query!(queryable) do
      query = Ecto.Queryable.to_query(queryable)

      validate_query!(query)

      {table_name, namespace, struct} = table_name(query)

      where = where_clause(query)

      {ShapeDefinition.new(table_name, namespace: namespace, where: where), {__MODULE__, struct}}
    end

    defp table_name(%{from: %{prefix: prefix, source: {table_name, struct}}}) do
      {table_name, prefix, struct}
    end

    defp where_clause(query) do
      %{from: %{source: {table_name, struct}}} = query

      {query, [], _key} =
        Ecto.Query.Planner.plan(query, :all, Ecto.Adapters.Postgres)

      {query, _} = Ecto.Query.Planner.normalize(query, :all, Ecto.Adapters.Postgres, 1)

      query
      |> Electric.Client.EctoAdapter.Postgres.where(
        {{quote_table(table_name), quote_table(table_name), struct}, []}
      )
      |> case do
        [] -> nil
        iodata -> IO.iodata_to_binary(iodata)
      end
    end

    defp quote_table(table_name) do
      [34, table_name, 34]
    end

    @impl Electric.Client.ValueMapper
    def for_schema(_schema, module) do
      fields =
        Enum.map(module.__schema__(:fields), fn field ->
          {module.__schema__(:field_source, field) |> to_string(), field,
           cast_to(module.__schema__(:type, field))}
        end)

      &map_values(&1, module, fields)
    end

    defp map_values(values, module, fields) do
      struct(
        module,
        Enum.map(fields, fn {column, field, fun} ->
          {field, fun.(Map.get(values, column))}
        end)
      )
    end

    defp cast_to(:boolean) do
      fn
        nil -> nil
        "t" -> true
        "f" -> false
        value -> Ecto.Type.cast!(:boolean, value)
      end
    end

    defp cast_to(type) do
      fn
        nil -> nil
        value -> Ecto.Type.cast!(type, value)
      end
    end

    @problematic_clauses [
      joins: "JOIN",
      updates: "UPDATE",
      order_bys: "ORDER BY",
      havings: "HAVING",
      group_bys: "GROUP BY",
      distinct: "DISTINCT"
    ]

    for {key, name} <- @problematic_clauses do
      defp validate_query!(%{unquote(key) => [_ | _]}),
        do:
          raise(ArgumentError,
            message: "Electric does not support streaming queries with #{unquote(name)} clauses"
          )
    end

    defp validate_query!(_query), do: :ok
  end
end
