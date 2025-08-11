if Code.ensure_loaded?(Ecto) do
  defmodule Electric.Client.EctoAdapter do
    @moduledoc false

    alias Electric.Client.ShapeDefinition
    alias Electric.Client.EctoAdapter.ArrayDecoder

    @behaviour Electric.Client.ValueMapper

    def shape!(schema, opts \\ [])

    def shape!(schema, opts) when is_atom(schema), do: shape_from_query!(schema, opts)
    def shape!(%Ecto.Query{} = query, opts), do: shape_from_query!(query, opts)
    def shape!(%Ecto.Changeset{} = changeset, opts), do: shape_from_changeset!(changeset, opts)

    def shape!(changeset_fun, opts) when is_function(changeset_fun, 1),
      do: shape_from_changeset!(changeset_fun, opts)

    @doc false
    @spec shape_from_query!(Ecto.Queryable.t()) :: ShapeDefinition.t()
    def shape_from_query!(queryable, opts \\ []) do
      query = Ecto.Queryable.to_query(queryable)

      validate_query!(query)

      {table_name, namespace, struct} = table_name(query)
      # it's possible that the ecto schema does not contain all the columns in
      # the table so, since we know the columns we want, let's specify them
      # explicitly
      columns = query_columns(query)
      where = where(query)

      ShapeDefinition.new!(
        table_name,
        merge_shape_opts(
          [namespace: namespace, where: where, columns: columns, parser: {__MODULE__, struct}],
          opts
        )
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

      ShapeDefinition.new!(
        table_name,
        merge_shape_opts(
          [columns: columns, parser: {__MODULE__, schema}, namespace: namespace],
          opts
        )
      )
    end

    defp merge_shape_opts(base, overrides) do
      Keyword.merge(base, overrides, fn _key, base, over ->
        if is_nil(over), do: base, else: over
      end)
    end

    defp table_name(%{
           prefix: query_prefix,
           from: %{prefix: source_prefix, source: {table_name, struct}}
         }) do
      {table_name, query_prefix || source_prefix, struct}
    end

    defp query_columns(%{select: %Ecto.Query.SelectExpr{take: %{0 => {action, columns}}}})
         when action in [:any, :map, :struct] do
      Enum.map(columns, &to_string/1)
    end

    defp query_columns(%{select: %Ecto.Query.SelectExpr{expr: [{{:., _, _}, [], []} | _] = expr}}) do
      map_expr_columns(expr)
    end

    defp query_columns(%{select: %Ecto.Query.SelectExpr{expr: {:{}, [], [_ | _] = expr}}}) do
      map_expr_columns(expr)
    end

    defp query_columns(%{from: %{source: {_table_name, struct}}}) do
      Enum.map(
        struct.__schema__(:fields),
        &to_string(struct.__schema__(:field_source, &1))
      )
    end

    defp map_expr_columns(expr) do
      for {{:., [], [{:&, [], [0]}, name]}, [], []} <- expr, do: to_string(name)
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

    @doc false
    def cast_to(:boolean) do
      fn
        nil -> nil
        "t" -> true
        "f" -> false
        value -> Ecto.Type.cast!(:boolean, value)
      end
    end

    def cast_to({:parameterized, {module, params}} = type) do
      fn
        nil ->
          nil

        value ->
          decoded_value =
            case Jason.decode(value) do
              {:ok, decoded} -> decoded
              {:error, _} -> value
            end

          case module.load(decoded_value, &Ecto.Type.embedded_load(&1, &2, :json), params) do
            {:ok, loaded} -> loaded
            :error -> raise Ecto.CastError, type: type, value: value
          end
      end
    end

    def cast_to({:array, type}) do
      fn
        nil -> nil
        value -> ArrayDecoder.decode!(value, type)
      end
    end

    def cast_to(type) when is_atom(type) do
      with {:module, _} <- Code.ensure_loaded(type),
           true <- function_exported?(type, :type, 0),
           true <- function_exported?(type, :load, 1) do
        case type.type() do
          :uuid -> &cast_uuid(&1, type)
          _type -> &cast_ecto(type, &1)
        end
      else
        _ -> &cast_ecto(type, &1)
      end
    end

    defp cast_ecto(_type, nil), do: nil

    defp cast_ecto(:map, value) do
      Jason.decode!(value)
    end

    defp cast_ecto(:bitstring, value) when is_binary(value) do
      <<String.to_integer(value, 2)::size(byte_size(value))>>
    end

    defp cast_ecto(:binary, "\\x" <> value) when is_binary(value) do
      Base.decode16!(value, case: :lower)
    end

    defp cast_ecto(type, value) do
      Ecto.Type.cast!(type, value)
    end

    defp cast_uuid(nil, _type), do: nil

    # this is mostly to support Ecto.ULID who's `cast/1` function assumes a
    # base32 encoded value (unlike Ecto.UUID which supports both string- and
    # binary-encoded values). so instead of using `cast/1`, we convert the
    # string to a binary and use `load/1` (uuid's always come through the
    # replication stream string-encoded).
    defp cast_uuid(
           <<a1, a2, a3, a4, a5, a6, a7, a8, ?-, b1, b2, b3, b4, ?-, c1, c2, c3, c4, ?-, d1, d2,
             d3, d4, ?-, e1, e2, e3, e4, e5, e6, e7, e8, e9, e10, e11, e12>> = orig_value,
           type
         ) do
      case type.load(
             <<d(a1)::4, d(a2)::4, d(a3)::4, d(a4)::4, d(a5)::4, d(a6)::4, d(a7)::4, d(a8)::4,
               d(b1)::4, d(b2)::4, d(b3)::4, d(b4)::4, d(c1)::4, d(c2)::4, d(c3)::4, d(c4)::4,
               d(d1)::4, d(d2)::4, d(d3)::4, d(d4)::4, d(e1)::4, d(e2)::4, d(e3)::4, d(e4)::4,
               d(e5)::4, d(e6)::4, d(e7)::4, d(e8)::4, d(e9)::4, d(e10)::4, d(e11)::4, d(e12)::4>>
           ) do
        {:ok, value} ->
          value

        :error ->
          raise Ecto.CastError, type: type, value: orig_value
      end
    end

    @compile {:inline, d: 1}

    for {r, o} <- [{?0..?9, 0}, {?A..?F, 10}, {?a..?f, 10}], {c, i} <- Enum.with_index(r, o) do
      defp d(unquote(c)), do: unquote(i)
    end

    defp d(c) do
      raise Ecto.CastError,
        type: Ecto.UUID,
        value: to_string([c]),
        message: "Invalid char in UUID \"#{[c]}\""
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
