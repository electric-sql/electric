defmodule Electric.Shapes.Shape do
  @moduledoc """
  Struct describing the requested shape
  """
  require Logger
  alias Electric.Postgres.Inspector
  alias Electric.Replication.Eval.Parser
  alias Electric.Replication.Changes
  alias Electric.Shapes.WhereClause

  @enforce_keys [:root_table, :root_table_id]
  defstruct [
    :root_table,
    :root_table_id,
    :table_info,
    :where,
    :selected_columns,
    replica: :default,
    partitions: %{}
  ]

  @type replica() :: :full | :default
  @type table_info() :: %{
          columns: [Inspector.column_info(), ...],
          pk: [String.t(), ...]
        }
  @type t() :: %__MODULE__{
          root_table: Electric.relation(),
          root_table_id: Electric.relation_id(),
          table_info: %{
            Electric.relation() => table_info()
          },
          partitions: %{Electric.relation() => Electric.relation()},
          where: Electric.Replication.Eval.Expr.t() | nil,
          selected_columns: [String.t(), ...] | nil,
          replica: replica()
        }

  @type json_relation() :: [String.t(), ...]
  @type json_table_info() :: table_info() | json_relation()
  @type json_table_list() :: [json_table_info(), ...]
  @type json_safe() :: %{
          root_table: json_relation(),
          root_table_id: non_neg_integer(),
          where: String.t(),
          selected_columns: [String.t(), ...] | nil,
          table_info: [json_table_list(), ...]
        }

  def hash(%__MODULE__{} = shape), do: shape |> Map.drop([:table_info]) |> :erlang.phash2()

  def generate_id(%__MODULE__{} = shape) do
    hash = hash(shape)
    {hash, "#{hash}-#{DateTime.utc_now() |> DateTime.to_unix(:millisecond)}"}
  end

  def new!(table, opts \\ []) do
    case new(table, opts) do
      {:ok, shape} -> shape
      {:error, {_field, [message | _]}} -> raise message
      {:error, {_field, message}} when is_binary(message) -> raise message
    end
  end

  def pk(%__MODULE__{table_info: table_info, root_table: root_table}, relation \\ nil)
      when is_nil(relation) or is_map_key(table_info, relation),
      do: Map.fetch!(table_info, relation || root_table).pk

  @shape_schema NimbleOptions.new!(
                  where: [type: {:or, [:string, nil]}],
                  columns: [type: {:or, [{:list, :string}, nil]}],
                  replica: [
                    type: {:custom, __MODULE__, :verify_replica, []},
                    default: :default
                  ],
                  inspector: [
                    type: :mod_arg,
                    default: {Electric.Postgres.Inspector, Electric.DbPool}
                  ]
                )
  def new(table, opts) do
    with {:ok, opts} <- NimbleOptions.validate(opts, @shape_schema),
         inspector <- Access.fetch!(opts, :inspector),
         {:ok, relation} <- validate_table(table, inspector),
         %{relation: table, relation_id: relation_id} <- relation,
         {:ok, column_info, pk_cols} <- load_column_info(table, inspector),
         {:ok, selected_columns} <-
           validate_selected_columns(column_info, pk_cols, Access.get(opts, :columns)),
         refs = Inspector.columns_to_expr(column_info),
         {:ok, where} <- maybe_parse_where_clause(Access.get(opts, :where), refs) do
      children = relation |> Map.get(:children, []) |> List.wrap()

      {:ok,
       %__MODULE__{
         root_table: table,
         root_table_id: relation_id,
         table_info: %{table => %{pk: pk_cols, columns: column_info}},
         partitions: Map.new(children, &{&1, table}),
         where: where,
         selected_columns: selected_columns,
         replica: Access.get(opts, :replica, :default)
       }}
    end
  end

  defp maybe_parse_where_clause(nil, _), do: {:ok, nil}

  defp maybe_parse_where_clause(where, info) do
    case Parser.parse_and_validate_expression(where, info) do
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
  defp validate_selected_columns(_column_info, _pk_cols, nil) do
    {:ok, nil}
  end

  defp validate_selected_columns(column_info, pk_cols, columns_to_select) do
    missing_pk_cols = pk_cols -- columns_to_select
    invalid_cols = columns_to_select -- Enum.map(column_info, & &1.name)

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

      true ->
        {:ok, Enum.sort(columns_to_select)}
    end
  end

  defp load_column_info(table, inspector) do
    case Inspector.load_column_info(table, inspector) do
      :table_not_found ->
        {:error, {:table, ["table not found"]}}

      {:ok, column_info} ->
        # %{["column_name"] => :type}
        Logger.debug("Table #{inspect(table)} found with #{length(column_info)} columns")

        pk_cols = Inspector.get_pk_cols(column_info)

        {:ok, column_info, pk_cols}
    end
  end

  defp validate_table(table, inspector) when is_binary(table) do
    # Parse identifier locally first to avoid hitting PG for invalid tables
    with {:ok, _} <- Electric.Postgres.Identifiers.parse_relation(table),
         {:ok, rel} <- Inspector.load_relation(table, inspector) do
      {:ok, rel}
    else
      {:error, err} ->
        case Regex.run(~r/.+ relation "(?<name>.+)" does not exist/, err, capture: :all_names) do
          [table_name] ->
            {:error,
             {:table,
              [
                ~s|Table "#{table_name}" does not exist. If the table name contains capitals or special characters you must quote it.|
              ]}}

          _ ->
            {:error, {:table, [err]}}
        end
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
  def affected_tables(%__MODULE__{root_table: table} = shape) do
    [table | partition_tables(shape)]
  end

  @doc """
  List partitions of this Shape. Will be empty if shape is a partition table
  itself or a normal, non-partitioned table
  """
  @spec partition_tables(t()) :: [Electric.relation()]
  def partition_tables(%__MODULE__{partitions: partitions}) do
    Map.keys(partitions)
  end

  def add_partition(
        %__MODULE__{partitions: partitions} = shape,
        {_, _} = root,
        {_, _} = partition
      ) do
    %{shape | partitions: Map.put(partitions, partition, root)}
  end

  @doc """
  Convert a change to be correctly represented within the shape.

  New or deleted changes are either propagated as-is, or filtered out completely.
  Updates, on the other hand, may be converted to an "new record" or a "deleted record"
  if the previous/new version of the updated row isn't in the shape.
  """
  def convert_change(%__MODULE__{root_table: table} = shape, %{relation: relation} = change)
      when table != relation do
    %{partitions: partitions} = shape

    # if the change has reached here because its an update to a partition child
    # on a root table, and the shape is on the root table, then re-write the
    # change to come from the shape's root table
    case Map.fetch(partitions, relation) do
      {:ok, ^table} ->
        # This does not re-write the change's key. Is that a problem?
        convert_change(shape, %{change | relation: table})

      _ ->
        []
    end
  end

  def convert_change(%__MODULE__{where: nil, selected_columns: nil}, change), do: [change]

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

  # If relation OID matches, but qualified table name does not, then shape is affected
  def is_affected_by_relation_change?(
        %__MODULE__{root_table_id: id, root_table: {shape_schema, shape_table}},
        %Changes.Relation{id: id, schema: schema, table: table}
      )
      when shape_schema != schema or shape_table != table,
      do: true

  def is_affected_by_relation_change?(
        %__MODULE__{
          root_table_id: id,
          root_table: {schema, table} = root_table,
          table_info: table_info
        },
        %Changes.Relation{id: id, schema: schema, table: table, columns: new_columns}
      ) do
    shape_columns = Map.get(table_info, root_table, %{})[:columns]

    if length(shape_columns) != length(new_columns) do
      true
    else
      shape_columns
      |> Enum.map(&{&1.name, elem(&1.type_id, 0)})
      |> Map.new()
      |> then(fn shape_col_map ->
        new_columns
        |> Enum.any?(fn new_col -> Map.get(shape_col_map, new_col.name) != new_col.type_oid end)
      end)
    end
  end

  # If qualified table is the same but OID is different, it affects this shape as
  # it means that its root table has been renamed or deleted
  def is_affected_by_relation_change?(
        %__MODULE__{root_table: {schema, table}, root_table_id: old_id},
        %Changes.Relation{schema: schema, table: table, id: new_id}
      )
      when old_id !== new_id,
      do: true

  # the relation in this case is the parent table of a partition and we're
  # handling the case where a new partition has been added to an existing
  # partitioned table - the new partition arrives as a relation message and is
  # handled by the clauses above, but the the link between the new partition
  # and the partitioned table is handled with raw relation tuples
  def is_affected_by_relation_change?(%__MODULE__{root_table: relation}, {_, _} = relation) do
    true
  end

  def is_affected_by_relation_change?(_shape, _relation), do: false

  @spec to_json_safe(t()) :: json_safe()
  def to_json_safe(%__MODULE__{} = shape) do
    %{
      root_table: {schema, name},
      root_table_id: root_table_id,
      where: where,
      selected_columns: selected_columns,
      table_info: table_info
    } = shape

    query =
      case where do
        %{query: query} -> query
        nil -> nil
      end

    %{
      root_table: [schema, name],
      root_table_id: root_table_id,
      where: query,
      selected_columns: selected_columns,
      table_info:
        if(table_info,
          do:
            Enum.map(table_info, fn {{schema, name}, columns} ->
              [[schema, name], json_safe_columns(columns)]
            end)
        )
    }
  end

  defp json_safe_columns(column_info) do
    Map.update!(column_info, :columns, fn columns ->
      Enum.map(columns, fn column ->
        Map.new(column, &column_info_to_json_safe/1)
      end)
    end)
  end

  defp column_info_to_json_safe({:type, type}), do: {:type, to_string(type)}
  defp column_info_to_json_safe({:type_id, {id, mod}}), do: {:type_id, [id, mod]}
  defp column_info_to_json_safe({k, v}), do: {k, v}

  @spec from_json_safe!(json_safe()) :: t() | no_return()
  def from_json_safe!(map) do
    %{
      "root_table" => [schema, name],
      "root_table_id" => root_table_id,
      "where" => where,
      "selected_columns" => selected_columns,
      "table_info" => info
    } = map

    table_info =
      Enum.reduce(info, %{}, fn [[schema, name], table_info], info ->
        %{"columns" => columns, "pk" => pk} = table_info

        Map.put(info, {schema, name}, %{
          columns: Enum.map(columns, fn column -> Map.new(column, &column_info_from_json/1) end),
          pk: pk
        })
      end)

    {:ok, %{columns: column_info}} = Map.fetch(table_info, {schema, name})
    refs = Inspector.columns_to_expr(column_info)
    {:ok, where} = maybe_parse_where_clause(where, refs)

    %__MODULE__{
      root_table: {schema, name},
      root_table_id: root_table_id,
      where: where,
      selected_columns: selected_columns,
      table_info: table_info
    }
  end

  defp column_info_from_json({"type_id", [id, mod]}), do: {:type_id, {id, mod}}
  defp column_info_from_json({"type", type}), do: {:type, String.to_atom(type)}
  defp column_info_from_json({key, value}), do: {String.to_atom(key), value}
end

defimpl Inspect, for: Electric.Shapes.Shape do
  import Inspect.Algebra

  def inspect(%Electric.Shapes.Shape{} = shape, _opts) do
    %{root_table: {schema, table}, root_table_id: root_table_id} = shape

    where = if shape.where, do: concat([", where: \"", shape.where.query, "\""]), else: ""

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
