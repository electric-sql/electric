defmodule Electric.Replication.Eval.Expr do
  @moduledoc """
  Parsed expression, available for evaluation using the runner
  """

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
end
