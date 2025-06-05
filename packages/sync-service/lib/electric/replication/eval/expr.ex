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
      used_refs:
        Enum.map(used_refs, fn
          {k, v} when is_tuple(v) -> [k, Tuple.to_list(v)]
          {k, v} -> [k, v]
        end)
    }
  end

  @doc false
  @spec from_json_safe(map()) :: {:ok, t()} | {:error, String.t()}
  def from_json_safe(%{"version" => 1, "query" => query, "used_refs" => refs}) do
    refs =
      Map.new(refs, fn
        [k, v] when is_list(v) -> {k, List.to_tuple(v)}
        [k, v] when is_binary(v) -> {k, String.to_existing_atom(v)}
      end)

    Parser.parse_and_validate_expression(query, refs: refs)
  end

  def from_json_safe(_),
    do: {:error, "Incorrect serialized format: keys must be `version`, `query`, `used_refs`"}

  defimpl Electric.Shapes.Shape.Comparable do
    def comparable(%Electric.Replication.Eval.Expr{} = expr) do
      %{expr | eval: Electric.Shapes.Shape.Comparable.comparable(expr.eval)}
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
