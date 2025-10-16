defmodule Electric.Postgres.Inspector do
  alias Electric.Replication.Eval.Parser
  import Electric, only: :macros

  @type relation :: Electric.relation()
  @type relation_id :: Electric.relation_id()
  @type relation_kind :: :ordinary_table | :partitioned_table
  @type type_kind :: :base | :composite | :domain | :enum | :pseudo | :range | :multirange

  @type column_info :: %{
          name: String.t(),
          type: String.t(),
          type_mod: integer() | nil,
          type_kind: type_kind(),
          formatted_type: String.t(),
          pk_position: non_neg_integer() | nil,
          type_id: {typid :: non_neg_integer(), typmod :: integer()},
          array_dimensions: non_neg_integer(),
          not_null: boolean(),
          array_type: String.t()
        }

  @type relation_info :: %{
          relation_id: relation_id(),
          relation: relation(),
          kind: relation_kind(),
          parent: nil | relation(),
          children: nil | [relation(), ...]
        }

  @type supported_features :: %{
          supports_generated_column_replication: boolean()
        }

  @callback load_relation_oid(relation(), opts :: term()) ::
              {:ok, Electric.oid_relation()}
              | :table_not_found
              | {:error, String.t() | :connection_not_available}

  @callback load_relation_info(relation_id(), opts :: term()) ::
              {:ok, relation_info()}
              | :table_not_found
              | {:error, String.t() | :connection_not_available}

  @callback load_column_info(relation_id(), opts :: term()) ::
              {:ok, [column_info()]}
              | :table_not_found
              | {:error, String.t() | :connection_not_available}

  @callback load_supported_features(opts :: term()) ::
              {:ok, supported_features()}
              | {:error, String.t() | :connection_not_available}

  @callback clean(relation_id(), opts :: term()) :: :ok

  @callback list_relations_with_stale_cache(opts :: term()) ::
              {:ok, [Electric.oid_relation()]} | :error

  @type inspector :: {module(), opts :: term()}

  @doc """
  Expects the table name provided by the user and validates that the table exists,
  returning the OID.

  Table name is expected to have been normalized beforehand
  """
  @spec load_relation_oid(relation(), inspector()) ::
          {:ok, Electric.oid_relation()}
          | :table_not_found
          | {:error, String.t() | :connection_not_available}

  def load_relation_oid(relation, {module, opts}) when is_relation(relation) do
    module.load_relation_oid(relation, opts)
  end

  @doc """
  Load additional information about a given relation.

  Additional information includes the relation kind, parent/child relationships,
  and other metadata.
  """
  @spec load_relation_info(relation_id(), inspector()) ::
          {:ok, relation_info()}
          | :table_not_found
          | {:error, String.t() | :connection_not_available}

  def load_relation_info(relation_id, {module, opts}) when is_relation_id(relation_id) do
    module.load_relation_info(relation_id, opts)
  end

  @doc """
  Load column information about a given table using a provided inspector.
  """
  @spec load_column_info(relation_id(), inspector()) ::
          {:ok, [column_info()]}
          | :table_not_found
          | {:error, String.t() | :connection_not_available}
  def load_column_info(relation_id, {module, opts}) when is_relation_id(relation_id) do
    module.load_column_info(relation_id, opts)
  end

  @doc """
  Load the supported features on the target database using a provided inspector.
  """
  @spec load_supported_features(inspector()) ::
          {:ok, supported_features()} | {:error, String.t() | :connection_not_available}
  def load_supported_features({module, opts}) do
    module.load_supported_features(opts)
  end

  @doc """
  Clean up all information about a given relation using a provided inspector.
  """
  @spec clean(relation_id(), inspector()) :: :ok
  def clean(relation_id, {module, opts}) when is_relation_id(relation_id) do
    module.clean(relation_id, opts)
  end

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
    Map.new(columns, fn
      %{name: name, array_type: arr_type} when not is_nil(arr_type) ->
        {[name], {:array, as_atom(arr_type)}}

      %{name: name, type_kind: :enum, type: type_name} ->
        {[name], {:enum, type_name}}

      %{name: name, type: type} ->
        {[name], as_atom(type)}
    end)
  end

  @doc """
  List relations that have stale cache. Doesn't clean the cache immediately,
  that's left to the caller. Inspectors without cache will return an `:error`.
  """
  @spec list_relations_with_stale_cache(inspector()) ::
          {:ok, [Electric.oid_relation()]} | :error
  def list_relations_with_stale_cache({module, opts}) do
    module.list_relations_with_stale_cache(opts)
  end

  defp as_atom(type) when is_binary(type), do: String.to_atom(type)
  defp as_atom(type) when is_atom(type), do: type
end
