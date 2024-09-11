defmodule Electric.Shapes.Shape do
  @moduledoc """
  Struct describing the requested shape
  """
  require Logger
  alias Electric.Postgres.Inspector
  alias Electric.Replication.Eval.Parser
  alias Electric.Replication.Eval.Runner
  alias Electric.Replication.Changes
  alias Electric.Utils

  @enforce_keys [:root_table]
  defstruct [:root_table, :table_info, :where]

  @type table_info() :: %{
          columns: [Inspector.column_info(), ...],
          pk: [String.t(), ...]
        }
  @type t() :: %__MODULE__{
          root_table: Electric.relation(),
          table_info: %{
            Electric.relation() => table_info()
          },
          where: Electric.Replication.Eval.Expr.t() | nil
        }

  @type table_with_where_clause() :: {Electric.relation(), String.t() | nil}

  @type json_relation() :: [String.t(), ...]
  @type json_table_info() :: table_info() | json_relation()
  @type json_table_list() :: [json_table_info(), ...]
  @type json_safe() :: %{
          root_table: json_relation(),
          where: String.t(),
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
      {:error, [message | _]} -> raise message
      {:error, message} when is_binary(message) -> raise message
    end
  end

  def pk(%__MODULE__{table_info: table_info, root_table: root_table}, relation \\ nil)
      when is_nil(relation) or is_map_key(table_info, relation),
      do: Map.fetch!(table_info, relation || root_table).pk

  @shape_schema NimbleOptions.new!(
                  where: [type: {:or, [:string, nil]}],
                  inspector: [
                    type: :mod_arg,
                    default: {Electric.Postgres.Inspector, Electric.DbPool}
                  ]
                )
  def new(table, opts) do
    opts = NimbleOptions.validate!(opts, @shape_schema)

    with {:ok, table} <- validate_table(table),
         {:ok, column_info, pk_cols} <- load_column_info(table, Access.fetch!(opts, :inspector)),
         refs = Inspector.columns_to_expr(column_info),
         {:ok, where} <- maybe_parse_where_clause(Access.get(opts, :where), refs) do
      {:ok,
       %__MODULE__{
         root_table: table,
         table_info: %{table => %{pk: pk_cols, columns: column_info}},
         where: where
       }}
    end
  end

  defp maybe_parse_where_clause(nil, _), do: {:ok, nil}

  defp maybe_parse_where_clause(where, info),
    do: Parser.parse_and_validate_expression(where, info)

  defp load_column_info(table, inspector) do
    case Inspector.load_column_info(table, inspector) do
      :table_not_found ->
        {:error, ["table not found"]}

      {:ok, column_info} ->
        # %{["column_name"] => :type}
        Logger.debug("Table #{inspect(table)} found with #{length(column_info)} columns")

        pk_cols = Inspector.get_pk_cols(column_info)

        {:ok, column_info, pk_cols}
    end
  end

  defp validate_table(definition) when is_binary(definition) do
    regex =
      ~r/^((?<schema>([a-z_][a-zA-Z0-9_]*|"(""|[^"])+"))\.)?(?<table>([a-z_][a-zA-Z0-9_]*|"(""|[^"])+"))$/

    case Regex.run(regex, definition, capture: :all_names) do
      ["", table_name] when table_name != "" ->
        table_name = Utils.parse_quoted_name(table_name)
        {:ok, {"public", table_name}}

      [schema_name, table_name] when table_name != "" ->
        schema_name = Utils.parse_quoted_name(schema_name)
        table_name = Utils.parse_quoted_name(table_name)
        {:ok, {schema_name, table_name}}

      _ ->
        {:error, ["table name does not match expected format"]}
    end
  end

  @doc """
  List tables that are a part of this shape.
  """
  @spec affected_tables(t()) :: [table_with_where_clause()]
  def affected_tables(%__MODULE__{root_table: table, where: nil}), do: [{table, nil}]

  def affected_tables(%__MODULE__{
        root_table: table,
        where: %Electric.Replication.Eval.Expr{query: where_clause}
      }),
      do: [{table, "(" <> where_clause <> ")"}]

  @doc """
  Convert a change to be correctly represented within the shape.

  New or deleted changes are either propagated as-is, or filtered out completely.
  Updates, on the other hand, may be converted to an "new record" or a "deleted record"
  if the previous/new version of the updated row isn't in the shape.
  """
  def convert_change(%__MODULE__{root_table: table}, %{relation: relation})
      when table != relation,
      do: []

  def convert_change(%__MODULE__{where: nil}, change), do: [change]
  def convert_change(%__MODULE__{where: _}, %Changes.TruncatedRelation{} = change), do: [change]

  def convert_change(%__MODULE__{where: where}, change)
      when is_struct(change, Changes.NewRecord)
      when is_struct(change, Changes.DeletedRecord) do
    record = if is_struct(change, Changes.NewRecord), do: change.record, else: change.old_record
    if record_in_shape?(where, record), do: [change], else: []
  end

  def convert_change(
        %__MODULE__{where: where},
        %Changes.UpdatedRecord{old_record: old_record, record: record} = change
      ) do
    old_record_in_shape = record_in_shape?(where, old_record)
    new_record_in_shape = record_in_shape?(where, record)

    case {old_record_in_shape, new_record_in_shape} do
      {true, true} -> [change]
      {true, false} -> [Changes.convert_update(change, to: :deleted_record)]
      {false, true} -> [Changes.convert_update(change, to: :new_record)]
      {false, false} -> []
    end
  end

  defp record_in_shape?(where, record) do
    with {:ok, refs} <- Runner.record_to_ref_values(where.used_refs, record),
         {:ok, evaluated} <- Runner.execute(where, refs) do
      if is_nil(evaluated), do: false, else: evaluated
    else
      _ -> false
    end
  end

  def is_affected_by_relation_change?(
        shape,
        %Changes.RelationChange{
          old_relation: %Changes.Relation{schema: old_schema, table: old_table},
          new_relation: %Changes.Relation{schema: new_schema, table: new_table}
        }
      )
      when old_schema != new_schema or old_table != new_table do
    # The table's qualified name changed
    # so shapes that match the old schema or table name are affected
    shape_matches?(shape, old_schema, old_table)
  end

  def is_affected_by_relation_change?(shape, %Changes.RelationChange{
        new_relation: %Changes.Relation{schema: schema, table: table}
      }) do
    shape_matches?(shape, schema, table)
  end

  defp shape_matches?({_, %__MODULE__{root_table: {schema, table}}}, schema, table), do: true
  defp shape_matches?(_, _, _), do: false

  @spec from_json_safe!(t()) :: json_safe()
  def to_json_safe(%__MODULE__{} = shape) do
    %{root_table: {schema, name}, where: where, table_info: table_info} = shape

    query =
      case where do
        %{query: query} -> query
        nil -> nil
      end

    %{
      root_table: [schema, name],
      where: query,
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
    %{"root_table" => [schema, name], "where" => where, "table_info" => info} = map

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

    %__MODULE__{root_table: {schema, name}, where: where, table_info: table_info}
  end

  defp column_info_from_json({"type_id", [id, mod]}), do: {:type_id, {id, mod}}
  defp column_info_from_json({"type", type}), do: {:type, String.to_atom(type)}
  defp column_info_from_json({key, value}), do: {String.to_atom(key), value}
end

defimpl Inspect, for: Electric.Shapes.Shape do
  import Inspect.Algebra

  def inspect(%Electric.Shapes.Shape{} = shape, _opts) do
    {schema, table} = shape.root_table

    where = if shape.where, do: concat([", where: \"", shape.where.query, "\""]), else: ""

    concat(["Shape.new!(\"", schema, ".", table, "\"", where, ")"])
  end
end

defimpl Jason.Encoder, for: Electric.Shapes.Shape do
  def encode(shape, opts) do
    shape
    |> Electric.Shapes.Shape.to_json_safe()
    |> Jason.Encode.map(opts)
  end
end
