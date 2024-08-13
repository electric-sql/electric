defmodule Electric.Shapes.Shape do
  @moduledoc """
  Struct describing the requested shape
  """
  require Logger
  alias Electric.Postgres.Inspector
  alias Electric.Replication.Eval.Parser
  alias Electric.Replication.Eval.Runner
  alias Electric.Replication.Changes

  @enforce_keys [:root_table]
  defstruct [:root_table, :table_info, :where]

  @type t() :: %__MODULE__{
          root_table: Electric.relation(),
          table_info: %{
            Electric.relation() => %{
              columns: [Inspector.column_info(), ...],
              pk: [String.t(), ...]
            }
          },
          where: Electric.Replication.Eval.Expr.t() | nil
        }

  def hash(%__MODULE__{} = shape), do: shape |> Map.drop([:table_info]) |> :erlang.phash2()

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
        table_name = parse_quoted_name(table_name)
        IO.puts("table: public.#{table_name}")
        {:ok, {"public", table_name}}

      [schema_name, table_name] when table_name != "" ->
        schema_name = parse_quoted_name(schema_name)
        table_name = parse_quoted_name(table_name)
        IO.puts("table: #{schema_name}.#{table_name}")
        {:ok, {schema_name, table_name}}

      _ ->
        {:error, ["table name does not match expected format"]}
    end
  end

  @doc """
  List tables that are a part of this shape.
  """
  def affected_tables(%__MODULE__{root_table: table}), do: [table]

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
end

defimpl Inspect, for: Electric.Shapes.Shape do
  import Inspect.Algebra

  def inspect(%Electric.Shapes.Shape{} = shape, _opts) do
    {schema, table} = shape.root_table

    where = if shape.where, do: concat([", where: \"", shape.where.query, "\""]), else: ""

    concat(["Shape.new!(\"", schema, ".", table, "\"", where, ")"])
  end
end
