defmodule Electric.Replication.Eval.Expr do
  @moduledoc """
  Parsed expression, available for evaluation using the runner
  """

  alias Electric.Replication.Eval.Parser
  alias Electric.Replication.Eval.Env

  defstruct [:query, :eval, :used_refs, :returns]

  @type used_refs :: %{required([String.t(), ...]) => Env.pg_type()}

  @type t() :: %__MODULE__{
          query: String.t(),
          eval: term(),
          used_refs: used_refs(),
          returns: Env.pg_type()
        }

  @doc """
  Returns a flat list of all used refs used in the expression
  that point to the current table

  ## Examples

      iex> used_refs = %{["id"] => :int8, ["created_at"] => :timestamp}
      iex> unqualified_refs(%Expr{query: "id = 1", used_refs: used_refs})
      ["created_at", "id"]

      iex> used_refs = %{["id"] => :int8, ["potato", "created_at"] => :timestamp}
      iex> unqualified_refs(%Expr{query: "id = 1", used_refs: used_refs, returns: :int8})
      ["id"]
  """
  @spec unqualified_refs(t()) :: [String.t()]
  def unqualified_refs(%__MODULE__{used_refs: used_refs}) do
    used_refs
    # Keep only used refs that are pointing to current table
    |> Enum.filter(&match?({[_], _}, &1))
    |> Enum.map(fn {[key], _} -> key end)
  end

  @doc false
  @spec to_json_safe(t()) :: map()
  def to_json_safe(%__MODULE__{query: query, used_refs: used_refs}) do
    %{
      version: 1,
      query: query,
      used_refs: Enum.map(used_refs, fn {k, v} -> [k, json_safe_type(v)] end)
    }
  end

  defp json_safe_type({:array, type}), do: [:array, json_safe_type(type)]
  defp json_safe_type({:row, types}), do: [:row, Enum.map(types, &json_safe_type/1)]
  defp json_safe_type({:internal, type}), do: [:internal, json_safe_type(type)]
  defp json_safe_type({:enum, type}), do: [:enum, json_safe_type(type)]
  defp json_safe_type(type), do: type

  @doc false
  @spec from_json_safe(map()) :: {:ok, t()} | {:error, String.t()}
  def from_json_safe(map, sublink_queries \\ %{})

  def from_json_safe(
        %{"version" => 1, "query" => query, "used_refs" => refs},
        sublink_queries
      ) do
    refs =
      Map.new(refs, fn [k, v] -> {k, type_from_json_safe(v)} end)

    Parser.parse_and_validate_expression(query, refs: refs, sublink_queries: sublink_queries)
  end

  def from_json_safe(_, _),
    do: {:error, "Incorrect serialized format: keys must be `version`, `query`, `used_refs`"}

  defp type_from_json_safe(["array", type]), do: {:array, type_from_json_safe(type)}
  defp type_from_json_safe(["row", types]), do: {:row, Enum.map(types, &type_from_json_safe/1)}
  defp type_from_json_safe(["internal", type]), do: {:internal, type_from_json_safe(type)}
  defp type_from_json_safe(["enum", type]), do: {:enum, type_from_json_safe(type)}
  defp type_from_json_safe(type) when is_binary(type), do: String.to_existing_atom(type)

  @doc """
  Wrap a parser part (Const, Ref, Func, Array, RowExpr) in an Expr struct, so that it can be evaluated on it's own.

  This is used when a subtree of our AST needs to be made evaluatable on it's own inside Electric. The `query` field
  is not needed in that context, it's used when going back to postgres, so we don't bother calculating it.
  """
  def wrap_parser_part(expr) do
    %__MODULE__{
      query: "This should not be executed on the database",
      eval: expr,
      used_refs: Parser.find_refs(expr),
      returns: expr.type
    }
  end

  defimpl Electric.Shapes.Shape.Comparable do
    def comparable(%Electric.Replication.Eval.Expr{} = expr) do
      {:eval_expr, expr.query, expr.returns}
    end
  end
end

defimpl Jason.Encoder, for: Electric.Replication.Eval.Expr do
  def encode(expr, opts) do
    expr
    |> Electric.Replication.Eval.Expr.to_json_safe()
    |> Jason.Encode.map(opts)
  end
end
