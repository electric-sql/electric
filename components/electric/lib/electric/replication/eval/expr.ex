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
end
