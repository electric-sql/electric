defmodule Electric.Shapes.Shape.Subset do
  alias Electric.Postgres.Inspector
  alias Electric.Replication.Eval.Parser
  alias Electric.Shapes.Shape.Validators

  defstruct [
    :order_by,
    :limit,
    :offset,
    :where
  ]

  @schema_options [
                    order_by: [type: :string],
                    limit: [type: :pos_integer],
                    offset: [type: :non_neg_integer],
                    where: [type: :string],
                    params: [type: {:map, :string, :string}, default: %{}]
                  ]
                  |> NimbleOptions.new!()

  def new(shape, fields, opts) do
    inspector = Access.fetch!(opts, :inspector)

    with {:ok, fields} <- NimbleOptions.validate(Map.new(fields), @schema_options),
         {:ok, columns} <- load_column_info(shape, inspector),
         :ok <- validate_order_by(fields[:order_by], columns),
         original_refs = Inspector.columns_to_expr(columns),
         enum_columns = extract_enum_columns(original_refs),
         refs = enums_to_text(original_refs),
         {:ok, where} <-
           validate_where_clause(fields[:where], fields[:params], refs, enum_columns) do
      {:ok,
       %__MODULE__{
         order_by: fields[:order_by],
         limit: fields[:limit],
         offset: fields[:offset],
         where: where
       }}
    else
      {:error, %NimbleOptions.ValidationError{message: reason, key: key}} ->
        {:error, {key, reason}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp load_column_info(%{root_table_id: table_oid, root_table: table}, inspector) do
    case Inspector.load_column_info(table_oid, inspector) do
      :table_not_found ->
        {:error,
         {:order_by,
          "Table #{Electric.Utils.inspect_relation(table)} does not exist. " <>
            "If the table name contains capitals or special characters you must quote it."}}

      {:ok, columns} ->
        {:ok, columns}
    end
  end

  defp validate_order_by(nil, _columns), do: :ok

  defp validate_order_by(order_by, columns) do
    case Parser.validate_order_by(order_by, columns) do
      :ok -> :ok
      {:error, reason} -> {:error, {:order_by, reason}}
    end
  end

  defp validate_where_clause(nil, _params, _refs, _enum_columns), do: {:ok, nil}

  defp validate_where_clause(where, params, refs, enum_columns) do
    with {:ok, where} <- Parser.parse_query(where),
         {:ok, subqueries} <- Parser.extract_subqueries(where),
         :ok <- assert_no_subqueries(subqueries),
         :ok <- Validators.validate_parameters(params),
         {:ok, where} <-
           Parser.validate_where_ast(where,
             params: params,
             refs: refs,
             enum_columns: enum_columns
           ),
         {:ok, where} <- Validators.validate_where_return_type(where) do
      {:ok, where}
    else
      {:error, {part, reason}} -> {:error, {part, reason}}
      {:error, reason} -> {:error, {:where, reason}}
    end
  end

  defp assert_no_subqueries([]), do: :ok
  defp assert_no_subqueries(_), do: {:error, "Subqueries are not allowed in subsets"}

  # Extract column keys that are enum types
  defp extract_enum_columns(refs) do
    refs
    |> Enum.filter(fn {_key, type} -> match?({:enum, _}, type) end)
    |> Enum.map(fn {key, _type} -> key end)
    |> MapSet.new()
  end

  # Treat enum types as text for where clause validation.
  #
  # This is because enums are not supported in where clauses for shapes
  # and would fail the validation, but since for subsets we only pass 
  # the where clause directly to Postgres we can let Postgres validate
  # the enum usage instead.
  defp enums_to_text(refs) do
    Map.new(refs, fn
      {key, {:enum, _}} -> {key, :text}
      entry -> entry
    end)
  end
end
