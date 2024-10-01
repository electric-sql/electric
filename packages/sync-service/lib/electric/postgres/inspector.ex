defmodule Electric.Postgres.Inspector do
  alias Electric.Replication.Eval.Parser
  @type relation :: Electric.relation()

  @type column_info :: %{
          name: String.t(),
          type: String.t(),
          type_mod: integer() | nil,
          formatted_type: String.t(),
          pk_position: non_neg_integer() | nil,
          type_id: {typid :: non_neg_integer(), typmod :: integer()},
          array_dimensions: non_neg_integer(),
          not_null: boolean(),
          array_type: String.t()
        }

  @callback load_column_info(relation(), opts :: term()) ::
              {:ok, [column_info()]} | :table_not_found

  @callback clean_column_info(relation(), opts :: term()) :: true

  @callback get_namespace_and_tablename(relation(), opts :: term()) ::
              {:ok, relation()} | :table_not_found

  @type inspector :: {module(), opts :: term()}

  @doc """
  Load column information about a given table using a provided inspector.
  """
  @spec load_column_info(relation(), inspector()) :: {:ok, [column_info()]} | :table_not_found
  def load_column_info(relation, {module, opts}) do
    module.load_column_info(relation, opts)
  end

  @doc """
  Clean up column information about a given table using a provided inspector.
  """
  @spec clean_column_info(relation(), inspector()) :: true
  def clean_column_info(relation, {module, opts}), do: module.clean_column_info(relation, opts)

  @doc """
  Expects the table name provided by the user
  and validates that the table exists and returns the namespace and table name.

  The table name can be quoted or unquoted and can optionally be qualified,
  e.g. `users` would return `{"public", "users"}`,
       `usErs` would return `{"public", "users"}`,
       `"Users"` would return `{"public", "Users"}`,
       `some_schema.users` would return `{"some_schema", "users"}`.
  """
  @spec get_namespace_and_tablename(String.t(), inspector()) ::
          relation() | {:error, String.t()}
  def get_namespace_and_tablename(table, {module, opts}),
    do: module.get_namespace_and_tablename(table, opts)

  @doc """
  Get columns that should be considered a PK for table. If the table
  has no PK, then we're considering all columns as identifying.
  """
  @spec get_pk_cols([column_info(), ...]) :: [String.t(), ...]
  def get_pk_cols([_ | _] = columns) do
    columns
    |> Enum.reject(&is_nil(&1.pk_position))
    |> Enum.sort_by(& &1.pk_position)
    |> Enum.map(& &1.name)
    |> case do
      [] -> Enum.map(columns, & &1.name)
      results -> results
    end
  end

  @doc """
  Convert a column list into something that can be used by
  `Electric.Replication.Eval.Parser.parse_and_validate_expression/2`
  """
  @spec columns_to_expr([column_info(), ...]) :: Parser.refs_map()
  def columns_to_expr(columns) when is_list(columns) do
    Map.new(columns, fn %{name: name, type: type} -> {[name], atom_type(type)} end)
  end

  defp atom_type(type) when is_binary(type), do: String.to_atom(type)
  defp atom_type(type) when is_atom(type), do: type
end
