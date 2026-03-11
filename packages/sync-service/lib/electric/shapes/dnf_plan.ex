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

  @doc """
  Build the WHERE clause and params for a move-in query from the DNF plan.

  Given the triggering dependency index, the move-in values (delta), the
  current views for all dependencies, and the WHERE clause's `used_refs`
  type map, generates a parameterized WHERE clause.

  The candidate predicate selects rows matching the impacted disjuncts with
  move_in_values substituted for the triggering dependency.

  The exclusion predicate filters out rows already present via unaffected
  disjuncts.
  """
  @spec move_in_where_clause(t(), non_neg_integer(), [term()], map(), map()) ::
          {String.t(), [list()]}
  def move_in_where_clause(plan, dep_index, move_in_values, views, used_refs) do
    impacted = Map.get(plan.dependency_disjuncts, dep_index, [])
    all_idxs = Enum.to_list(0..(length(plan.disjuncts) - 1))
    unaffected = all_idxs -- impacted

    {candidate_sql, candidate_params, next_param} =
      build_disjuncts_sql(
        plan,
        impacted,
        dep_index,
        move_in_values,
        views,
        used_refs,
        1
      )

    {exclusion_sql, exclusion_params, _} =
      build_disjuncts_sql(
        plan,
        unaffected,
        nil,
        nil,
        views,
        used_refs,
        next_param
      )

    where =
      case exclusion_sql do
        nil -> candidate_sql
        excl -> "(#{candidate_sql}) AND NOT (#{excl})"
      end

    {where, candidate_params ++ exclusion_params}
  end

  @doc """
  Build a move-in control message for the given dependency and values.

  The message contains position-aware patterns so clients can update
  `active_conditions` for rows already present via another disjunct.
  """
  def make_move_in_broadcast(plan, dep_index, values, stack_id, shape_handle) do
    positions = Map.get(plan.dependency_positions, dep_index, [])

    patterns =
      Enum.flat_map(positions, fn pos ->
        info = plan.positions[pos]

        Enum.map(values, fn {_typed_value, original_value} ->
          %{pos: pos, value: make_broadcast_hash(info, stack_id, shape_handle, original_value)}
        end)
      end)

    %{headers: %{event: "move-in", patterns: patterns}}
  end

  @doc """
  Build a move-out control message for the given dependency and values.
  """
  def make_move_out_broadcast(plan, dep_index, values, stack_id, shape_handle) do
    positions = Map.get(plan.dependency_positions, dep_index, [])

    patterns =
      Enum.flat_map(positions, fn pos ->
        info = plan.positions[pos]

        Enum.map(values, fn {_typed_value, original_value} ->
          %{pos: pos, value: make_broadcast_hash(info, stack_id, shape_handle, original_value)}
        end)
      end)

    %{headers: %{event: "move-out", patterns: patterns}}
  end

  @doc """
  Generate SQL expressions for computing per-position active_conditions
  in a SELECT clause. Returns a list of SQL boolean expressions, one per
  position.

  For row predicates, the SQL is the predicate itself cast to boolean.
  For subquery predicates, the SQL evaluates the subquery membership.
  """
  def active_conditions_sql(plan) do
    Enum.map(0..(plan.position_count - 1), fn pos ->
      info = plan.positions[pos]
      base_sql = info.sql

      if info.negated do
        "(NOT (#{base_sql}))::boolean"
      else
        "(#{base_sql})::boolean"
      end
    end)
  end

  @doc """
  Generate SQL expressions for computing per-disjunct tags in a SELECT clause.

  Each disjunct produces one tag string with `position_count` slots joined by "/".
  Subquery positions get md5 hashes, row predicates get "1", and positions not
  in the disjunct get empty strings.
  """
  def tags_sql(plan, stack_id, shape_handle) do
    Enum.map(plan.disjuncts, fn conj ->
      positions_in_disjunct = MapSet.new(conj, &elem(&1, 0))

      slot_sqls =
        Enum.map(0..(plan.position_count - 1), fn pos ->
          if MapSet.member?(positions_in_disjunct, pos) do
            tag_slot_sql(plan.positions[pos], stack_id, shape_handle)
          else
            "''"
          end
        end)

      Enum.join(slot_sqls, " || '/' || ")
    end)
  end

  # -- Private: SQL generation helpers --

  defp build_disjuncts_sql(_plan, [], _trigger_dep, _trigger_vals, _views, _used_refs, pidx) do
    {nil, [], pidx}
  end

  defp build_disjuncts_sql(plan, disjunct_idxs, trigger_dep, trigger_vals, views, used_refs, pidx) do
    {sqls, params, next_pidx} =
      Enum.reduce(disjunct_idxs, {[], [], pidx}, fn didx, {sqls, params, pi} ->
        conj = Enum.at(plan.disjuncts, didx)

        {conj_sql, conj_params, next_pi} =
          build_conjunction_sql(plan, conj, trigger_dep, trigger_vals, views, used_refs, pi)

        {[conj_sql | sqls], params ++ conj_params, next_pi}
      end)

    sql =
      case Enum.reverse(sqls) do
        [single] -> single
        multiple -> Enum.map_join(multiple, " OR ", &"(#{&1})")
      end

    {sql, params, next_pidx}
  end

  defp build_conjunction_sql(plan, conj, trigger_dep, trigger_vals, views, used_refs, pidx) do
    {parts, params, next_pi} =
      Enum.reduce(conj, {[], [], pidx}, fn {pos, polarity}, {parts, params, pi} ->
        info = plan.positions[pos]

        {sql, ps, next_pi} =
          position_to_sql(info, trigger_dep, trigger_vals, views, used_refs, pi)

        sql = if polarity == :negated, do: "NOT (#{sql})", else: sql
        {[sql | parts], params ++ ps, next_pi}
      end)

    sql = parts |> Enum.reverse() |> Enum.join(" AND ")
    {sql, params, next_pi}
  end

  defp position_to_sql(%{is_subquery: false} = info, _, _, _, _, pidx) do
    {info.sql, [], pidx}
  end

  defp position_to_sql(
         %{is_subquery: true, dependency_index: dep_idx} = info,
         trigger_dep,
         trigger_vals,
         views,
         used_refs,
         pidx
       ) do
    lhs_sql = lhs_sql_from_ast(info.ast)
    ref_type = Map.get(used_refs, info.subquery_ref)

    values =
      if dep_idx == trigger_dep and trigger_vals != nil do
        trigger_vals
      else
        Map.get(views, info.subquery_ref, MapSet.new()) |> MapSet.to_list()
      end

    case ref_type do
      {:array, {:row, col_types}} ->
        casts = Enum.map(col_types, &Electric.Replication.Eval.type_to_pg_cast/1)

        params =
          case values do
            [] -> Enum.map(casts, fn _ -> [] end)
            _ -> values |> Electric.Utils.unzip_any() |> Tuple.to_list()
          end

        sql =
          casts
          |> Enum.with_index(pidx)
          |> Enum.map_join(", ", fn {col, index} -> "$#{index}::#{col}[]" end)
          |> then(&"#{lhs_sql} IN (SELECT * FROM unnest(#{&1}))")

        {sql, params, pidx + length(casts)}

      {:array, element_type} ->
        type_cast = Electric.Replication.Eval.type_to_pg_cast(element_type)
        sql = "#{lhs_sql} = ANY ($#{pidx}::#{type_cast}[])"
        {sql, [values], pidx + 1}
    end
  end

  defp lhs_sql_from_ast(%Func{name: "sublink_membership_check", args: [testexpr, _]}) do
    SqlGenerator.to_sql(testexpr)
  end

  defp make_broadcast_hash(%{tag_columns: [_col]}, stack_id, shape_handle, value) do
    Subqueries.make_value_hash(stack_id, shape_handle, value)
  end

  defp make_broadcast_hash(
         %{tag_columns: {:hash_together, cols}},
         stack_id,
         shape_handle,
         original_value
       ) do
    parts =
      original_value
      |> Tuple.to_list()
      |> Enum.zip_with(cols, fn value, column ->
        column <> ":" <> Subqueries.namespace_value(value)
      end)

    Subqueries.make_value_hash_raw(stack_id, shape_handle, Enum.join(parts))
  end

  defp tag_slot_sql(%{is_subquery: true, tag_columns: [col]}, stack_id, shape_handle) do
    col_sql = ~s["#{col}"::text]
    namespaced = pg_namespace_value_sql(col_sql)
    ~s[md5('#{stack_id}#{shape_handle}' || #{namespaced})]
  end

  defp tag_slot_sql(
         %{is_subquery: true, tag_columns: {:hash_together, cols}},
         stack_id,
         shape_handle
       ) do
    column_parts =
      Enum.map(cols, fn col_name ->
        col = ~s["#{col_name}"::text]
        ~s['#{col_name}:' || #{pg_namespace_value_sql(col)}]
      end)

    ~s[md5('#{stack_id}#{shape_handle}' || #{Enum.join(column_parts, " || ")})]
  end

  defp tag_slot_sql(%{is_subquery: false}, _stack_id, _shape_handle) do
    "'1'"
  end

  defp pg_namespace_value_sql(col_sql) do
    ~s[CASE WHEN #{col_sql} IS NULL THEN '#{Subqueries.null_sentinel()}' ELSE '#{Subqueries.value_prefix()}' || #{col_sql} END]
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
