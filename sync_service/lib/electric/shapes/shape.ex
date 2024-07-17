defmodule Electric.Shapes.Shape do
  @moduledoc """
  Struct describing the requested shape
  """
  require Logger
  alias Electric.Replication.Eval.Parser
  alias Electric.Replication.Eval.Runner
  alias Electric.Replication.Changes

  @enforce_keys [:root_table]
  defstruct [:root_table, :where]

  @type t() :: %__MODULE__{root_table: Electric.relation()}

  def hash(%__MODULE__{} = shape), do: :erlang.phash2(shape)

  def new!(table, opts \\ []) do
    case new(table, opts) do
      {:ok, shape} -> shape
      {:error, [message | _]} -> raise message
      {:error, message} when is_binary(message) -> raise message
    end
  end

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
         {:ok, table_info} <- load_table_info(table, Access.fetch!(opts, :inspector)),
         {:ok, where} <- maybe_parse_where_clause(Access.get(opts, :where), table_info) do
      {:ok, %__MODULE__{root_table: table, where: where}}
    end
  end

  defp maybe_parse_where_clause(nil, _), do: {:ok, nil}

  defp maybe_parse_where_clause(where, info),
    do: Parser.parse_and_validate_expression(where, info)

  defp load_table_info(table, {module, inspector_opts}) do
    case module.load_table_info(table, inspector_opts) do
      [] ->
        {:error, ["table not found"]}

      table_info ->
        # %{["column_name"] => :type}
        Logger.debug("Table #{inspect(table)} found with #{length(table_info)} columns")

        {:ok,
         Map.new(table_info, fn %{name: name, type: type} -> {[name], String.to_atom(type)} end)}
    end
  end

  defp validate_table(definition) when is_binary(definition) do
    case String.split(definition, ".") do
      [table_name] when table_name != "" ->
        {:ok, {"public", table_name}}

      [schema_name, table_name] when schema_name != "" and table_name != "" ->
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
