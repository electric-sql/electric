defmodule Electric.Shapes.Consumer.DnfContext do
  @moduledoc """
  Holds DNF decomposition state for a shape's WHERE clause.

  Built from a Shape at consumer startup time, this struct encapsulates all
  DNF-related state: the decomposition result, position-to-dependency mappings,
  and negated position tracking.

  The `DnfContext` is computed once and stored in `Consumer.State`, then passed
  explicitly to functions that need it (move_handling, change_handling,
  subquery_moves, querying).
  """

  alias Electric.Replication.Eval.Decomposer
  alias Electric.Replication.Eval.Parser.Func
  alias Electric.Replication.Eval.Parser.Ref
  alias Electric.Replication.Eval.Runner
  alias Electric.Shapes.Shape

  defstruct [
    :decomposition,
    position_to_dependency_map: %{},
    dependency_to_positions_map: %{},
    negated_positions: MapSet.new()
  ]

  @type t :: %__MODULE__{
          decomposition: Decomposer.decomposition(),
          position_to_dependency_map: %{non_neg_integer() => term()},
          dependency_to_positions_map: %{term() => [non_neg_integer()]},
          negated_positions: MapSet.t(non_neg_integer())
        }

  @doc """
  Build a DnfContext from a Shape and its dependency mappings.

  Returns nil if the shape has no WHERE clause or no dependencies (no DNF needed).
  Calls `Decomposer.decompose/1` once; the result is cached on the struct.
  """
  @spec from_shape(Shape.t()) :: t() | nil
  def from_shape(%Shape{where: nil}), do: nil
  def from_shape(%Shape{shape_dependencies: []}), do: nil

  def from_shape(%Shape{} = shape) do
    case Decomposer.decompose(shape.where.eval) do
      {:ok, decomposition} ->
        pos_to_dep =
          build_position_to_dependency_map(decomposition, shape.shape_dependencies_handles)

        dep_to_pos = build_dependency_to_positions_map(pos_to_dep)
        negated = build_negated_positions(decomposition)

        %__MODULE__{
          decomposition: decomposition,
          position_to_dependency_map: pos_to_dep,
          dependency_to_positions_map: dep_to_pos,
          negated_positions: negated
        }

      {:error, _reason} ->
        nil
    end
  end

  @doc "Which DNF positions does this dependency handle affect?"
  @spec get_positions_for_dependency(t(), term()) :: [non_neg_integer()]
  def get_positions_for_dependency(%__MODULE__{dependency_to_positions_map: map}, dep_handle) do
    Map.get(map, dep_handle, [])
  end

  @doc "Is this position negated (NOT IN)?"
  @spec position_negated?(t(), non_neg_integer()) :: boolean()
  def position_negated?(%__MODULE__{negated_positions: negated}, position) do
    MapSet.member?(negated, position)
  end

  @doc "Does this context have a valid DNF with subqueries?"
  @spec has_valid_dnf?(t() | nil) :: boolean()
  def has_valid_dnf?(nil), do: false

  def has_valid_dnf?(%__MODULE__{decomposition: decomposition}) do
    decomposition != nil and decomposition.position_count > 0
  end

  @doc """
  Compute active_conditions for a record against the DNF.

  Returns a list of booleans, one per position. For negated positions,
  the stored AST is the un-negated form, so NOT is applied here to produce
  the effective value clients can use directly.
  """
  @spec compute_active_conditions(t(), map(), map(), map()) :: [boolean()]
  def compute_active_conditions(
        %__MODULE__{decomposition: decomposition},
        record,
        used_refs,
        extra_refs
      ) do
    %{subexpressions: subexpressions, position_count: position_count} = decomposition

    Enum.map(0..(position_count - 1), fn position ->
      subexpr = Map.fetch!(subexpressions, position)
      value = evaluate_subexpression(subexpr, record, used_refs, extra_refs)
      if subexpr.negated, do: not value, else: value
    end)
  end

  @doc """
  Evaluate DNF to determine if record is included.

  `active_conditions` stores effective values (negation already applied),
  so we only need position indices.
  """
  @spec evaluate_dnf([boolean()], [[Decomposer.position()]]) :: boolean()
  def evaluate_dnf(active_conditions, disjuncts_positions) do
    Enum.any?(disjuncts_positions, fn conjunction_positions ->
      Enum.all?(conjunction_positions, fn pos ->
        Enum.at(active_conditions, pos, false) == true
      end)
    end)
  end

  @doc """
  Extract the sublink index from a sublink_membership_check AST node.

  Used to resolve which dependency shape a subquery corresponds to, even when
  multiple subqueries reference the same column.
  """
  @spec extract_sublink_index(term()) :: non_neg_integer() | nil
  def extract_sublink_index(%Func{name: "sublink_membership_check", args: [_, sublink_ref]}) do
    case sublink_ref do
      %Ref{path: ["$sublink", idx_str]} -> String.to_integer(idx_str)
      _ -> nil
    end
  end

  def extract_sublink_index(_), do: nil

  # --- Private helpers ---

  defp build_position_to_dependency_map(decomposition, dep_handles) do
    decomposition.subexpressions
    |> Enum.filter(fn {_pos, subexpr} -> subexpr.is_subquery end)
    |> Enum.flat_map(fn {pos, subexpr} ->
      case extract_sublink_index(subexpr.ast) do
        nil ->
          []

        dep_index ->
          dep_handle = Enum.at(dep_handles, dep_index)
          if dep_handle, do: [{pos, dep_handle}], else: []
      end
    end)
    |> Map.new()
  end

  defp build_dependency_to_positions_map(pos_to_dep) do
    Enum.group_by(pos_to_dep, fn {_pos, handle} -> handle end, fn {pos, _} -> pos end)
  end

  defp build_negated_positions(decomposition) do
    decomposition.subexpressions
    |> Enum.filter(fn {_pos, subexpr} -> subexpr.negated end)
    |> Enum.map(fn {pos, _} -> pos end)
    |> MapSet.new()
  end

  defp evaluate_subexpression(subexpr, record, used_refs, extra_refs) do
    ast = subexpr.ast
    # Build a minimal expression wrapper for evaluation
    expr = %Electric.Replication.Eval.Expr{eval: ast, used_refs: used_refs, returns: :bool}

    with {:ok, refs} <- Runner.record_to_ref_values(used_refs, record),
         {:ok, evaluated} <- Runner.execute(expr, Map.merge(refs, extra_refs)) do
      if is_nil(evaluated), do: false, else: evaluated
    else
      _ -> false
    end
  end
end
