defmodule Electric.Shapes.Consumer.DnfContext do
  @moduledoc """
  Holds the DNF (Disjunctive Normal Form) decomposition context for a shape.

  This is computed from the shape's WHERE clause and shape dependencies, and is
  used during change processing to handle move-in/move-out for complex boolean
  expressions with subqueries.

  Stored in Consumer.State rather than Shape to avoid bloating the Shape struct
  which is held in memory in many places.
  """

  alias Electric.Shapes.Shape
  alias Electric.Replication.Eval.Decomposer
  alias Electric.Replication.Eval.Expr
  alias Electric.Replication.Eval.Parser
  alias Electric.Shapes.WhereClause

  defstruct [
    # The DNF decomposition result from Decomposer
    decomposition: nil,
    # Maps position -> dependency_handle for move-in/move-out handling
    position_to_dependency_map: %{},
    # Maps dependency_handle -> [position] for reverse lookup
    dependency_to_positions_map: %{},
    # Set of positions that are negated (NOT IN)
    negated_positions: MapSet.new()
  ]

  @type t :: %__MODULE__{
          decomposition: map() | nil,
          position_to_dependency_map: %{non_neg_integer() => String.t()},
          dependency_to_positions_map: %{String.t() => [non_neg_integer()]},
          negated_positions: MapSet.t(non_neg_integer())
        }

  @doc """
  Build a DnfContext from a shape.

  Returns nil if the shape doesn't need DNF decomposition (no subqueries or no WHERE clause).
  """
  @spec from_shape(Shape.t()) :: t() | nil
  def from_shape(%Shape{where: nil}), do: nil
  def from_shape(%Shape{shape_dependencies: []}), do: nil

  def from_shape(%Shape{} = shape) do
    comparison_expressions = shape.subquery_comparison_expressions

    case Decomposer.decompose(shape.where.eval) do
      {:ok, decomposition} ->
        if decomposition.has_subqueries do
          build_context(decomposition, comparison_expressions, shape.shape_dependencies_handles)
        else
          nil
        end

      {:error, _reason} ->
        nil
    end
  end

  defp build_context(decomposition, comparison_expressions, dep_handles) do
    position_to_dependency_map =
      build_position_to_dependency_map(decomposition, comparison_expressions, dep_handles)

    dependency_to_positions_map =
      position_to_dependency_map
      |> Enum.group_by(fn {_pos, handle} -> handle end, fn {pos, _handle} -> pos end)

    negated_positions = extract_negated_positions(decomposition)

    %__MODULE__{
      decomposition: decomposition,
      position_to_dependency_map: position_to_dependency_map,
      dependency_to_positions_map: dependency_to_positions_map,
      negated_positions: negated_positions
    }
  end

  # Extract positions that are negated in the DNF
  defp extract_negated_positions(decomposition) do
    decomposition.subexpressions
    |> Enum.filter(fn {_pos, subexpr} -> subexpr[:negated] == true end)
    |> Enum.map(fn {pos, _} -> pos end)
    |> MapSet.new()
  end

  # Build a map from DNF position to dependency handle
  defp build_position_to_dependency_map(decomposition, comparison_expressions, dep_handles) do
    decomposition.subexpressions
    |> Enum.filter(fn {_pos, info} -> info.is_subquery end)
    |> Enum.reduce(%{}, fn {pos, info}, acc ->
      case find_sublink_ref_for_expression(info.ast, comparison_expressions) do
        nil ->
          acc

        sublink_ref_path ->
          case sublink_ref_path do
            ["$sublink", idx_str] ->
              idx = String.to_integer(idx_str)

              if idx < length(dep_handles) do
                Map.put(acc, pos, Enum.at(dep_handles, idx))
              else
                acc
              end

            _ ->
              acc
          end
      end
    end)
  end

  # Find the sublink_ref for a given subquery expression
  defp find_sublink_ref_for_expression(ast, comparison_expressions) do
    Enum.find_value(comparison_expressions, fn {sublink_ref_path, testexpr} ->
      if expressions_match?(ast, testexpr) do
        sublink_ref_path
      end
    end)
  end

  # Check if two expressions match (simplified comparison)
  defp expressions_match?(%Parser.Func{name: "sublink_membership_check", args: [test1, _]}, test2) do
    expressions_match?(test1, test2)
  end

  defp expressions_match?(expr1, %Expr{eval: inner}) do
    expressions_match?(expr1, inner)
  end

  defp expressions_match?(%Expr{eval: inner}, expr2) do
    expressions_match?(inner, expr2)
  end

  defp expressions_match?(%Parser.Ref{path: path1}, %Parser.Ref{path: path2}) do
    path1 == path2
  end

  defp expressions_match?(%Parser.RowExpr{elements: e1}, %Parser.RowExpr{elements: e2}) do
    length(e1) == length(e2) and
      Enum.all?(Enum.zip(e1, e2), fn {a, b} -> expressions_match?(a, b) end)
  end

  defp expressions_match?(_, _), do: false

  # --- Query functions ---

  @doc """
  Get the positions affected by a given dependency handle.
  """
  @spec get_positions_for_dependency(t() | nil, String.t()) :: [non_neg_integer()]
  def get_positions_for_dependency(nil, _dep_handle), do: []

  def get_positions_for_dependency(%__MODULE__{dependency_to_positions_map: map}, dep_handle) do
    Map.get(map, dep_handle, [])
  end

  @doc """
  Check if a position is negated (NOT IN).
  """
  @spec position_negated?(t() | nil, non_neg_integer()) :: boolean()
  def position_negated?(nil, _position), do: false

  def position_negated?(%__MODULE__{negated_positions: negated}, position) do
    MapSet.member?(negated, position)
  end

  @doc """
  Check if this context has a valid DNF decomposition with subqueries.
  """
  @spec has_valid_dnf?(t() | nil) :: boolean()
  def has_valid_dnf?(nil), do: false

  def has_valid_dnf?(%__MODULE__{decomposition: nil}), do: false

  def has_valid_dnf?(%__MODULE__{decomposition: %{has_subqueries: has_subqueries}}) do
    has_subqueries
  end

  @doc """
  Compute active conditions for a record.
  """
  @spec compute_active_conditions(t() | nil, map(), map(), map()) ::
          {:ok, [boolean()]} | {:error, term()}
  def compute_active_conditions(nil, _record, _extra_refs, _used_refs), do: {:ok, []}

  def compute_active_conditions(%__MODULE__{decomposition: nil}, _record, _extra_refs, _used_refs) do
    {:ok, []}
  end

  def compute_active_conditions(
        %__MODULE__{decomposition: decomposition},
        record,
        extra_refs,
        used_refs
      ) do
    WhereClause.compute_active_conditions(decomposition, record, extra_refs, used_refs)
  end
end
