defmodule Electric.Shapes.Shape do
  @moduledoc """
  Struct describing the requested shape
  """
  alias Electric.Replication.Eval.Expr
  alias Electric.Postgres.Inspector
  alias Electric.Replication.Eval.Parser
  alias Electric.Replication.Changes
  alias Electric.Shapes.WhereClause

  require Logger

  defprotocol Comparable do
    @spec comparable(t()) :: t()
    def comparable(term)
  end

  @default_replica :default

  @enforce_keys [:root_table, :root_table_id]
  defstruct [
    :root_table,
    :root_table_id,
    :root_pk,
    :root_column_count,
    :where,
    :selected_columns,
    flags: %{},
    storage: %{compaction: :disabled},
    replica: @default_replica
  ]

  @type replica() :: :full | :default
  @type table_info() :: %{
          columns: [Inspector.column_info(), ...],
          pk: [String.t(), ...]
        }
  @type storage_config :: %{
          compaction: :enabled | :disabled
        }
  @type flag() :: :selects_all_columns | :non_primitive_columns_in_where
  @type t() :: %__MODULE__{
          root_table: Electric.relation(),
          root_table_id: Electric.relation_id(),
          root_pk: [String.t(), ...],
          root_column_count: non_neg_integer(),
          flags: %{optional(flag()) => boolean()},
          where: Electric.Replication.Eval.Expr.t() | nil,
          selected_columns: [String.t(), ...],
          replica: replica(),
          storage: storage_config() | nil
        }

  @type json_relation() :: [String.t(), ...]
  @type json_table_info() :: table_info() | json_relation()
  @type json_table_list() :: [json_table_info(), ...]
  @type json_safe() :: %{
          version: non_neg_integer(),
          root_table: json_relation(),
          root_table_id: non_neg_integer(),
          root_pk: [String.t(), ...],
          root_column_count: non_neg_integer(),
          where: String.t(),
          selected_columns: [String.t(), ...],
          flags: %{optional(flag()) => boolean()},
          replica: String.t(),
          storage: %{required(String.t()) => String.t()}
        }

  def comparable(%__MODULE__{} = shape) do
    shape
    |> Map.drop([:table_info, :storage])
    |> Map.update!(:where, fn
      nil -> nil
      %Expr{} = expr -> Electric.Shapes.Shape.Comparable.comparable(expr)
      statement when is_binary(statement) -> statement
    end)
  end

  def hash(%__MODULE__{} = shape),
    do: shape |> comparable() |> :erlang.phash2()

  def generate_id(%__MODULE__{} = shape) do
    hash = hash(shape)

    # Use microseconds to essentially avoid collisions within the same millisecond when we have a hash collision
    {hash, "#{hash}-#{DateTime.utc_now() |> DateTime.to_unix(:microsecond)}"}
  end

  @doc """
  List all relations that are a part of this shape, as oid-name tuples.
  """
  @spec list_relations(t()) :: [Electric.oid_relation()]
  def list_relations(%__MODULE__{} = shape) do
    [{shape.root_table_id, shape.root_table}]
  end

  def new!(table, opts \\ []) do
    case new(table, opts) do
      {:ok, shape} -> shape
      {:error, {_field, [message | _]}} -> raise message
      {:error, {_field, message}} when is_binary(message) -> raise message
    end
  end

  def pk(%__MODULE__{root_pk: root_pk}, _relation \\ nil), do: root_pk

  @schema_options [
    relation: [type: {:tuple, [:string, :string]}, required: true],
    where: [type: {:or, [:string, nil]}],
    columns: [type: {:or, [{:list, :string}, nil]}],
    params: [type: {:map, :string, :string}, default: %{}],
    replica: [
      type: {:custom, __MODULE__, :verify_replica, []},
      default: :default
    ],
    inspector: [
      type: :mod_arg,
      default: {Electric.Postgres.Inspector, Electric.DbPool}
    ],
    storage: [
      type: {
        :or,
        [
          nil,
          map: [compaction: [type: {:in, [:enabled, :disabled]}, default: :enabled]]
        ]
      },
      default: nil,
      type_spec: quote(do: nil | Electric.Shapes.Shape.storage_config())
    ]
  ]
  @shape_schema NimbleOptions.new!(@schema_options)

  def schema_options do
    @schema_options
  end

  def default_replica_mode, do: @default_replica

  def new(table, opts) when is_binary(table) and is_list(opts) do
    case Electric.Postgres.Identifiers.parse_relation(table) do
      {:ok, relation} ->
        opts
        |> Keyword.put(:relation, relation)
        |> new()

      {:error, reason} ->
        {:error, {:table, [reason]}}
    end
  end

  def new(opts) when is_list(opts) or is_map(opts) do
    with {:ok, opts} <- NimbleOptions.validate(opts, @shape_schema),
         inspector <- Access.fetch!(opts, :inspector),
         {:ok, {oid, table} = relation} <- validate_relation(opts, inspector),
         {:ok, column_info, pk_cols} <- load_column_info(relation, inspector),
         {:ok, selected_columns} <-
           validate_selected_columns(column_info, pk_cols, Access.get(opts, :columns)),
         refs = Inspector.columns_to_expr(column_info),
         {:ok, where} <- maybe_parse_where_clause(Access.get(opts, :where), opts[:params], refs) do
      flags =
        [
          if(is_nil(Access.get(opts, :columns)), do: :selects_all_columns),
          if(any_columns_non_primitive?(column_info, where),
            do: :non_primitive_columns_in_where
          )
        ]
        |> Enum.reject(&is_nil/1)
        |> Map.new(fn k -> {k, true} end)

      {:ok,
       %__MODULE__{
         root_table: table,
         root_table_id: oid,
         root_column_count: length(column_info),
         root_pk: pk_cols,
         flags: flags,
         where: where,
         selected_columns: selected_columns,
         replica: Access.get(opts, :replica, :default),
         storage: Access.get(opts, :storage) || %{compaction: :disabled}
       }}
    end
  end

  defp maybe_parse_where_clause(nil, _, _), do: {:ok, nil}

  defp maybe_parse_where_clause(where, params, refs) do
    case Parser.parse_and_validate_expression(where, params: params, refs: refs) do
      {:ok, expr} -> {:ok, expr}
      {:error, reason} -> {:error, {:where, reason}}
    end
  end

  @spec validate_selected_columns(
          [Inspector.column_info()],
          [String.t()],
          [String.t(), ...] | nil
        ) ::
          {:ok, [String.t(), ...] | nil} | {:error, {:columns, [String.t()]}}
  defp validate_selected_columns(column_info, pk_cols, nil) do
    validate_selected_columns(column_info, pk_cols, Enum.map(column_info, & &1.name))
  end

  defp validate_selected_columns(column_info, pk_cols, columns_to_select) do
    missing_pk_cols = pk_cols -- columns_to_select
    invalid_cols = columns_to_select -- Enum.map(column_info, & &1.name)

    generated_cols =
      column_info
      |> Enum.filter(&(&1.is_generated and &1.name in columns_to_select))
      |> Enum.map(& &1.name)

    cond do
      missing_pk_cols != [] ->
        {:error,
         {:columns,
          [
            "Must include all primary key columns, missing: #{missing_pk_cols |> Enum.join(", ")}"
          ]}}

      invalid_cols != [] ->
        {:error,
         {:columns,
          [
            "The following columns could not be found: #{invalid_cols |> Enum.join(", ")}"
          ]}}

      generated_cols != [] ->
        {:error,
         {:columns,
          [
            "The following columns are generated and cannot be included in replication: #{generated_cols |> Enum.join(", ")}"
          ]}}

      true ->
        {:ok, Enum.sort(columns_to_select)}
    end
  end

  defp load_column_info({oid, relation}, inspector) do
    case Inspector.load_column_info(oid, inspector) do
      :table_not_found ->
        # Rare but technically possible if a `clean` call was made to the inspector between
        # validating the relation and here.
        table_not_found_error(relation)

      {:ok, column_info} ->
        Logger.debug(
          "Table #{inspect(relation)} found with #{length(column_info)} columns. \n" <>
            "Column info: #{inspect(column_info)}"
        )

        pk_cols = Inspector.get_pk_cols(column_info)

        {:ok, column_info, pk_cols}
    end
  end

  defp any_columns_non_primitive?(_, nil), do: false

  defp any_columns_non_primitive?(column_info, where) do
    unqualified_refs =
      Expr.unqualified_refs(where)

    column_info
    |> Enum.filter(&(&1.name in unqualified_refs))
    |> Enum.any?(fn
      %{type_kind: kind} when kind in [:enum, :domain, :composite] -> true
      _ -> false
    end)
  end

  defp table_not_found_error(relation),
    do:
      {:error,
       {:table,
        [
          "Table #{Electric.Utils.inspect_relation(relation)} does not exist. " <>
            "If the table name contains capitals or special characters you must quote it."
        ]}}

  @spec validate_relation(Keyword.t(), term()) ::
          {:ok, Electric.oid_relation()} | {:error, {:table, [String.t()]}}
  defp validate_relation(opts, inspector) do
    relation = Keyword.fetch!(opts, :relation)

    # Parse identifier locally first to avoid hitting PG for invalid tables
    case Inspector.load_relation_oid(relation, inspector) do
      {:ok, rel} -> {:ok, rel}
      :table_not_found -> table_not_found_error(relation)
      {:error, err} -> {:error, {:table, [err]}}
    end
  end

  def verify_replica(mode) when mode in [:full, "full"], do: {:ok, :full}
  def verify_replica(mode) when mode in [:default, "default"], do: {:ok, :default}

  def verify_replica(invalid),
    do:
      {:error,
       "Invalid value for replica: #{inspect(invalid)}. Expecting one of `full` or `default`"}

  @doc """
  List tables that are a part of this shape.
  """
  @spec affected_tables(t()) :: [Electric.relation()]
  def affected_tables(%__MODULE__{root_table: table}) do
    [table]
  end

  @doc """
  Convert a change to be correctly represented within the shape.

  New or deleted changes are either propagated as-is, or filtered out completely.
  Updates, on the other hand, may be converted to an "new record" or a "deleted record"
  if the previous/new version of the updated row isn't in the shape.
  """
  def convert_change(%__MODULE__{root_table: table}, %{relation: relation})
      when table != relation,
      do: []

  def convert_change(%__MODULE__{where: nil, flags: %{selects_all_columns: true}}, change) do
    # If the change actually doesn't change any columns, we can skip it - this is possible on Postgres but we don't care for those.
    if is_struct(change, Changes.UpdatedRecord) and change.changed_columns == MapSet.new() do
      []
    else
      [change]
    end
  end

  def convert_change(%__MODULE__{}, %Changes.TruncatedRelation{} = change), do: [change]

  def convert_change(%__MODULE__{where: where, selected_columns: selected_columns}, change)
      when is_struct(change, Changes.NewRecord)
      when is_struct(change, Changes.DeletedRecord) do
    record = if is_struct(change, Changes.NewRecord), do: change.record, else: change.old_record

    if WhereClause.includes_record?(where, record),
      do: [filter_change_columns(selected_columns, change)],
      else: []
  end

  def convert_change(
        %__MODULE__{where: where, selected_columns: selected_columns},
        %Changes.UpdatedRecord{old_record: old_record, record: record} = change
      ) do
    old_record_in_shape = WhereClause.includes_record?(where, old_record)
    new_record_in_shape = WhereClause.includes_record?(where, record)

    converted_changes =
      case {old_record_in_shape, new_record_in_shape} do
        {true, true} -> [change]
        {true, false} -> [Changes.convert_update(change, to: :deleted_record)]
        {false, true} -> [Changes.convert_update(change, to: :new_record)]
        {false, false} -> []
      end

    converted_changes
    |> Enum.map(&filter_change_columns(selected_columns, &1))
    |> Enum.filter(&filtered_columns_changed/1)
  end

  defp filter_change_columns(nil, change), do: change

  defp filter_change_columns(selected_columns, change) do
    Changes.filter_columns(change, selected_columns)
  end

  defp filtered_columns_changed(%Changes.UpdatedRecord{old_record: record, record: record}),
    do: false

  defp filtered_columns_changed(_), do: true

  # If neither oid nor schema/table name matches, then shape is not affected
  def is_affected_by_relation_change?(
        %__MODULE__{root_table_id: id1, root_table: {schema1, table1}},
        %Changes.Relation{id: id2, schema: schema2, table: table2}
      )
      when id1 != id2 and (schema1 != schema2 or table1 != table2),
      do: false

  # If relation OID matches, but qualified table name does not, then shape is affected
  def is_affected_by_relation_change?(
        %__MODULE__{root_table_id: id, root_table: {shape_schema, shape_table}},
        %Changes.Relation{id: id, schema: schema, table: table}
      )
      when shape_schema != schema or shape_table != table,
      do: true

  # If qualified table is the same but OID is different, it affects this shape as
  # it means that its root table has been renamed or deleted
  def is_affected_by_relation_change?(
        %__MODULE__{root_table: {schema, table}, root_table_id: old_id},
        %Changes.Relation{schema: schema, table: table, id: new_id}
      )
      when old_id !== new_id,
      do: true

  # If shape selects all columns, but number of columns has changed, it affects this shape
  def is_affected_by_relation_change?(
        %__MODULE__{flags: %{selects_all_columns: true}, root_column_count: old_column_count},
        %Changes.Relation{columns: new_columns}
      )
      when length(new_columns) != old_column_count,
      do: true

  def is_affected_by_relation_change?(
        %__MODULE__{selected_columns: columns},
        %Changes.Relation{affected_columns: affected_columns}
      ) do
    Enum.any?(columns, &(&1 in affected_columns))
  end

  @doc false
  @spec to_json_safe(t()) :: json_safe()
  def to_json_safe(%__MODULE__{} = shape) do
    %{
      version: 1,
      root_table: Tuple.to_list(shape.root_table),
      root_table_id: shape.root_table_id,
      root_pks: shape.root_pk,
      root_column_count: shape.root_column_count,
      flags: shape.flags,
      where: shape.where,
      selected_columns: shape.selected_columns,
      storage: shape.storage,
      replica: shape.replica
    }
  end

  @spec from_json_safe(map()) :: {:ok, t()} | {:error, String.t()}
  def from_json_safe(%{
        "version" => 1,
        "root_table" => [schema, name],
        "root_table_id" => root_table_id,
        "root_pks" => root_pks,
        "root_column_count" => root_column_count,
        "flags" => flags,
        "where" => where,
        "selected_columns" => selected_columns,
        "storage" => storage,
        "replica" => replica
      }) do
    with {:ok, where} <- if(where != nil, do: Expr.from_json_safe(where), else: {:ok, nil}) do
      {:ok,
       %__MODULE__{
         root_table: {schema, name},
         root_table_id: root_table_id,
         root_pk: root_pks,
         root_column_count: root_column_count,
         flags: Map.new(flags, fn {k, v} -> {String.to_existing_atom(k), v} end),
         where: where,
         selected_columns: selected_columns,
         storage: storage_config_from_json(storage),
         replica: String.to_existing_atom(replica)
       }}
    end
  end

  # This implementation is kept for backwards compatibility, because we're currently not doing
  # cleanup of old shape files if the definition is malformed.
  def from_json_safe(
        %{
          "root_table" => [schema, name],
          "root_table_id" => root_table_id,
          "where" => where,
          "selected_columns" => selected_columns,
          "table_info" => info
        } = data
      )
      when not is_map_key(data, "version") do
    table_info =
      Enum.reduce(info, %{}, fn [[schema, name], table_info], info ->
        %{"columns" => columns, "pk" => pk} = table_info

        Map.put(info, {schema, name}, %{
          columns: Enum.map(columns, fn column -> Map.new(column, &column_info_from_json/1) end),
          pk: pk
        })
      end)

    %{columns: column_info, pk: pk} = Map.fetch!(table_info, {schema, name})
    refs = Inspector.columns_to_expr(column_info)
    {:ok, where} = maybe_parse_where_clause(where, Map.get(data, "params", %{}), refs)

    flags =
      Enum.reject(
        [
          if(is_nil(selected_columns), do: :selects_all_columns),
          if(any_columns_non_primitive?(column_info, where),
            do: :non_primitive_columns_in_where
          )
        ],
        &is_nil/1
      )
      |> Map.new(&{&1, true})

    {:ok,
     %__MODULE__{
       root_table: {schema, name},
       root_table_id: root_table_id,
       root_pk: pk,
       root_column_count: length(column_info),
       flags: flags,
       where: where,
       selected_columns: selected_columns || Enum.map(column_info, & &1.name),
       replica: String.to_atom(Map.get(data, "replica", "default")),
       storage: storage_config_from_json(Map.get(data, "storage"))
     }}
  end

  defp storage_config_from_json(nil), do: %{compaction: :disabled}
  defp storage_config_from_json(%{"compaction" => "enabled"}), do: %{compaction: :enabled}
  defp storage_config_from_json(%{"compaction" => "disabled"}), do: %{compaction: :disabled}

  defp column_info_from_json({"type_id", [id, mod]}), do: {:type_id, {id, mod}}
  defp column_info_from_json({"type_kind", kind}), do: {:type_kind, String.to_existing_atom(kind)}
  defp column_info_from_json({"type", type}), do: {:type, String.to_atom(type)}
  defp column_info_from_json({key, value}), do: {String.to_atom(key), value}
end

defimpl Inspect, for: Electric.Shapes.Shape do
  import Inspect.Algebra

  def inspect(%Electric.Shapes.Shape{} = shape, _opts) do
    %{root_table: {schema, table}, root_table_id: root_table_id} = shape

    # some tests have invalid, unparsed, where clauses
    where =
      case shape.where do
        %{query: query} -> concat([", where: \"", query, "\""])
        query when is_binary(query) -> concat([", where: \"", query, "\""])
        nil -> ""
      end

    concat(["Shape.new!(\"", schema, ".", table, "\" [OID #{root_table_id}]", where, ")"])
  end
end

defimpl Jason.Encoder, for: Electric.Shapes.Shape do
  def encode(shape, opts) do
    shape
    |> Electric.Shapes.Shape.to_json_safe()
    |> Jason.Encode.map(opts)
  end
end
