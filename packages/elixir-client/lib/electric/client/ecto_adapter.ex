if Code.ensure_loaded?(Ecto) do
  defmodule Electric.Client.EctoAdapter do
    @moduledoc false

    alias Electric.Client.ShapeDefinition

    @behaviour Electric.Client.ValueMapper

    def shape!(schema) when is_atom(schema), do: shape_from_query!(schema)
    def shape!(%Ecto.Query{} = query), do: shape_from_query!(query)
    def shape!(%Ecto.Changeset{} = changeset), do: shape_from_changeset!(changeset)

    def shape!(changeset_fun) when is_function(changeset_fun, 1),
      do: shape_from_changeset!(changeset_fun)

    @doc false
    @spec shape_from_query!(Ecto.Queryable.t()) :: ShapeDefinition.t()
    def shape_from_query!(queryable) do
      query = Ecto.Queryable.to_query(queryable)

      validate_query!(query)

      {table_name, namespace, struct} = table_name(query)
      # it's possible that the ecto schema does not contain all the columns in
      # the table so, since we know the columns we want, let's specify them
      # explicitly
      columns = query_columns(query)
      where = where(query)

      ShapeDefinition.new!(table_name,
        namespace: namespace,
        where: where,
        columns: columns,
        parser: {__MODULE__, struct}
      )
    end

    @shape_from_changeset_opts_schema ShapeDefinition.schema_definition()
                                      |> Keyword.drop([:columns])
                                      |> NimbleOptions.new!()

    @type shape_from_changeset_opts() :: [
            unquote(NimbleOptions.option_typespec(@shape_from_changeset_opts_schema))
          ]

    @spec shape_from_changeset!(
            (map() -> Ecto.Changeset.t()) | Ecto.Changeset.t(),
            shape_from_changeset_opts()
          ) :: ShapeDefinition.t()
    def shape_from_changeset!(changeset_or_fun, opts \\ [])

    def shape_from_changeset!(%Ecto.Changeset{} = changeset, opts) do
      generate_shape_from_changeset(changeset, opts)
    end

    def shape_from_changeset!(changeset_fun, opts) when is_function(changeset_fun, 1) do
      case changeset_fun.(%{}) do
        %Ecto.Changeset{} = changeset ->
          generate_shape_from_changeset(changeset, opts)

        invalid ->
          raise ArgumentError,
            message:
              "Changeset function returned #{inspect(invalid)}, was expecting an Ecto.Changeset struct"
      end
    end

    defp generate_shape_from_changeset(%Ecto.Changeset{data: %schema{}} = changeset, opts) do
      if !function_exported?(schema, :__schema__, 1),
        do:
          raise(ArgumentError,
            message:
              "cannot generate a shape from a schema-less changeset. Use #{inspect(ShapeDefinition)}.new/2"
          )

      table_name = schema.__schema__(:source)
      namespace = schema.__schema__(:prefix)
      pks = schema.__schema__(:primary_key)

      columns =
        [pks, changeset.required, Keyword.keys(changeset.validations)]
        |> Enum.concat()
        |> Enum.uniq()
        |> Enum.map(&schema.__schema__(:field_source, &1))
        |> Enum.map(&to_string/1)

      shape_opts = Keyword.take(opts, Keyword.keys(ShapeDefinition.schema_definition()))

      ShapeDefinition.new!(
        table_name,
        shape_opts
        |> Keyword.put_new(:namespace, namespace)
        |> Keyword.merge(columns: columns)
      )
    end

    defp table_name(%{
           prefix: query_prefix,
           from: %{prefix: source_prefix, source: {table_name, struct}}
         }) do
      {table_name, query_prefix || source_prefix, struct}
    end

    defp query_columns(%{from: %{source: {_table_name, struct}}}) do
      Enum.map(
        struct.__schema__(:fields),
        &to_string(struct.__schema__(:field_source, &1))
      )
    end

    @doc false
    def where(%{wheres: []} = _query) do
      nil
    end

    def where(query) do
      %{from: %{source: {table_name, struct}}} = query

      {query, bindings, _key} =
        Ecto.Query.Planner.plan(query, :all, Ecto.Adapters.Postgres)

      {query, _} = Ecto.Query.Planner.normalize(query, :all, Ecto.Adapters.Postgres, 1)

      query
      |> Electric.Client.EctoAdapter.Postgres.where(
        {{quote_table(table_name), quote_table(table_name), struct}, []},
        bindings
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

    defp cast_to({:parameterized, {_, _}} = type) do
      fn
        nil ->
          nil

        value ->
          decoded_value =
            case Jason.decode(value) do
              {:ok, decoded} -> decoded
              {:error, _} -> value
            end

          case Ecto.Type.load(type, decoded_value) do
            {:ok, loaded} -> loaded
            :error -> raise Ecto.CastError, type: type, value: value
          end
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
