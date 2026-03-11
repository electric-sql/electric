defmodule Electric.Shapes.DnfPlan do
  @moduledoc """
  A DNF sidecar plan compiled from a shape's WHERE clause.

  Decomposes the WHERE clause into Disjunctive Normal Form and enriches each
  position with subquery dependency metadata, tag generation info, and SQL for
  active_conditions evaluation.

  Not stored on the Shape struct itself — compiled at runtime when needed
  (e.g. in consumer state).
  """

  alias Electric.Replication.Eval.Decomposer
  alias Electric.Replication.Eval.Parser.{Func, Ref, RowExpr}
  alias Electric.Replication.Eval.SqlGenerator

  defstruct [
    :disjuncts,
    :disjuncts_positions,
    :position_count,
    :positions,
    :dependency_positions,
    :dependency_disjuncts,
    :has_negated_subquery
  ]

  @type tag_columns :: [String.t()] | {:hash_together, [String.t()]}

  @type position_info :: %{
          ast: term(),
          sql: String.t(),
          is_subquery: boolean(),
          negated: boolean(),
          dependency_index: non_neg_integer() | nil,
          subquery_ref: [String.t()] | nil,
          tag_columns: tag_columns() | nil
        }

  @type t :: %__MODULE__{
          disjuncts: Decomposer.dnf(),
          disjuncts_positions: [[Decomposer.position()]],
          position_count: non_neg_integer(),
          positions: %{Decomposer.position() => position_info()},
          dependency_positions: %{non_neg_integer() => [Decomposer.position()]},
          dependency_disjuncts: %{non_neg_integer() => [non_neg_integer()]},
          has_negated_subquery: boolean()
        }

  @doc """
  Compile a DNF plan from a shape.

  Returns `{:ok, plan}` for shapes with subquery dependencies,
  `:no_subqueries` for shapes without, or `{:error, reason}` if
  decomposition fails.
  """
  @spec compile(Electric.Shapes.Shape.t()) :: {:ok, t()} | :no_subqueries | {:error, term()}
  def compile(shape) do
    if is_nil(shape.where) or shape.shape_dependencies == [] do
      :no_subqueries
    else
      do_compile(shape)
    end
  end

  defp do_compile(shape) do
    with {:ok, decomposition} <- Decomposer.decompose(shape.where.eval) do
      positions = enrich_positions(decomposition.subexpressions)

      {:ok,
       %__MODULE__{
         disjuncts: decomposition.disjuncts,
         disjuncts_positions: decomposition.disjuncts_positions,
         position_count: decomposition.position_count,
         positions: positions,
         dependency_positions: build_dependency_positions(positions),
         dependency_disjuncts: build_dependency_disjuncts(decomposition.disjuncts, positions),
         has_negated_subquery: has_negated_subquery?(positions)
       }}
    end
  end

  defp enrich_positions(subexpressions) do
    Map.new(subexpressions, fn {pos, subexpr} ->
      {dep_index, subquery_ref, tag_columns} =
        if subexpr.is_subquery do
          extract_subquery_info(subexpr.ast)
        else
          {nil, nil, nil}
        end

      {pos,
       %{
         ast: subexpr.ast,
         sql: SqlGenerator.to_sql(subexpr.ast),
         is_subquery: subexpr.is_subquery,
         negated: subexpr.negated,
         dependency_index: dep_index,
         subquery_ref: subquery_ref,
         tag_columns: tag_columns
       }}
    end)
  end

  defp extract_subquery_info(%Func{
         name: "sublink_membership_check",
         args: [testexpr, %Ref{path: path}]
       }) do
    dep_index = path |> List.last() |> String.to_integer()

    tag_columns =
      case testexpr do
        %Ref{path: [column_name]} ->
          [column_name]

        %RowExpr{elements: elements} ->
          {:hash_together, Enum.map(elements, fn %Ref{path: [col]} -> col end)}
      end

    {dep_index, path, tag_columns}
  end

  defp build_dependency_positions(positions) do
    positions
    |> Enum.filter(fn {_pos, info} -> info.is_subquery end)
    |> Enum.group_by(fn {_pos, info} -> info.dependency_index end, fn {pos, _} -> pos end)
    |> Map.new(fn {idx, poses} -> {idx, Enum.sort(poses)} end)
  end

  defp build_dependency_disjuncts(disjuncts, positions) do
    disjuncts
    |> Enum.with_index()
    |> Enum.reduce(%{}, fn {conj, disjunct_idx}, acc ->
      Enum.reduce(conj, acc, fn {pos, _polarity}, acc ->
        case Map.get(positions, pos) do
          %{is_subquery: true, dependency_index: idx} when not is_nil(idx) ->
            Map.update(acc, idx, MapSet.new([disjunct_idx]), &MapSet.put(&1, disjunct_idx))

          _ ->
            acc
        end
      end)
    end)
    |> Map.new(fn {idx, set} -> {idx, set |> MapSet.to_list() |> Enum.sort()} end)
  end

  defp has_negated_subquery?(positions) do
    Enum.any?(positions, fn {_pos, info} -> info.is_subquery and info.negated end)
  end
end
