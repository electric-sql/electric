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
  alias Electric.Replication.Eval.Expr
  alias Electric.Replication.Eval.Parser.{Func, Ref, RowExpr}
  alias Electric.Replication.Eval.Runner
  alias Electric.Replication.Eval.SqlGenerator
  alias Electric.Shapes.Consumer.Subqueries

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

  @doc """
  Project row metadata from a DNF plan.

  Given a record, subquery views, and the shape's WHERE clause expression,
  computes whether the row is included, tags for each disjunct, and
  active_conditions for each position.

  `views` should be keyed by subquery ref path, e.g. `%{["$sublink", "0"] => MapSet}`.
  """
  @spec project_row(t(), map(), map(), Expr.t(), String.t(), String.t()) ::
          {:ok, boolean(), [String.t()], [boolean()]} | :error
  def project_row(plan, record, views, where_expr, stack_id, shape_handle) do
    with {:ok, ref_values} <- Runner.record_to_ref_values(where_expr.used_refs, record) do
      refs = Map.merge(ref_values, views)
      active_conditions = compute_active_conditions(plan, refs)
      tags = compute_tags(plan, record, stack_id, shape_handle)
      included? = compute_inclusion(plan, active_conditions)
      {:ok, included?, tags, active_conditions}
    end
  end

  defp compute_active_conditions(plan, refs) do
    Enum.map(0..(plan.position_count - 1), fn pos ->
      info = plan.positions[pos]
      pos_expr = Expr.wrap_parser_part(info.ast)

      base_result =
        case Runner.execute(pos_expr, refs) do
          {:ok, value} when value not in [nil, false] -> true
          _ -> false
        end

      if info.negated, do: not base_result, else: base_result
    end)
  end

  defp compute_tags(plan, record, stack_id, shape_handle) do
    Enum.map(plan.disjuncts, fn conj ->
      positions_in_disjunct = MapSet.new(conj, &elem(&1, 0))

      Enum.map(0..(plan.position_count - 1), fn pos ->
        if MapSet.member?(positions_in_disjunct, pos) do
          compute_tag_slot(plan.positions[pos], record, stack_id, shape_handle)
        else
          ""
        end
      end)
      |> Enum.join("/")
    end)
  end

  defp compute_tag_slot(%{is_subquery: true, tag_columns: [col]}, record, stack_id, shape_handle) do
    Subqueries.make_value_hash(stack_id, shape_handle, Map.get(record, col))
  end

  defp compute_tag_slot(
         %{is_subquery: true, tag_columns: {:hash_together, cols}},
         record,
         stack_id,
         shape_handle
       ) do
    parts =
      Enum.map(cols, fn col ->
        col <> ":" <> Subqueries.namespace_value(Map.get(record, col))
      end)

    Subqueries.make_value_hash_raw(stack_id, shape_handle, Enum.join(parts))
  end

  defp compute_tag_slot(%{is_subquery: false}, _record, _stack_id, _shape_handle) do
    "1"
  end

  defp compute_inclusion(plan, active_conditions) do
    Enum.any?(plan.disjuncts, fn conj ->
      Enum.all?(conj, fn {pos, _polarity} ->
        Enum.at(active_conditions, pos)
      end)
    end)
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
