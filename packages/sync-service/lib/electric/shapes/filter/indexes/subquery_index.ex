defmodule Electric.Shapes.Filter.Indexes.SubqueryIndex do
  # Shared subquery routing index.
  #
  # The hot rows describe the *topology* shared across all outer shapes that
  # reference the same subquery: groups (per filter node + polarity), child
  # nodes (per group + dependency subquery), value-keyed positive routing,
  # group-keyed negated routing, and child participants. Per-shape value
  # membership is *not* stored here, and the filter is intentionally
  # time-unaware: it routes conservatively across all retained logical times
  # and lets each consumer's `Shape.convert_change` do the exact check at its
  # own per-subquery logical time(s). See `docs/rfcs/subquery-index.md`
  # §Routing for why a per-shape logical-time pin in the filter cannot
  # represent a consumer that is mid-move on a subquery (it reads at both
  # `from_time` and `to_time` simultaneously).
  @moduledoc false

  import Electric, only: [is_stack_id: 1]

  alias Electric.Replication.Eval.Expr
  alias Electric.Replication.Eval.Runner
  alias Electric.Shapes.DnfPlan
  alias Electric.Shapes.Filter
  alias Electric.Shapes.Filter.Indexes.SubqueryIndex
  alias Electric.Shapes.Filter.Indexes.SubqueryIndex.MultiTimeView
  alias Electric.Shapes.Filter.WhereCondition

  defstruct [:table, :multi_time_view]

  @type t :: %SubqueryIndex{table: :ets.tid() | atom(), multi_time_view: MultiTimeView.t() | nil}

  defp table_name(stack_id) when is_stack_id(stack_id), do: :"subquery_index:#{stack_id}"

  @spec new(keyword()) :: t()
  def new(opts \\ []) do
    table =
      case Keyword.get(opts, :stack_id) do
        nil ->
          :ets.new(:subquery_index, [:bag, :public])

        stack_id ->
          try do
            :ets.new(table_name(stack_id), [:bag, :public, :named_table])
          rescue
            ArgumentError -> table_name(stack_id)
          end
      end

    multi_time_view = MultiTimeView.new(Keyword.take(opts, [:stack_id]))
    %SubqueryIndex{table: table, multi_time_view: multi_time_view}
  end

  @spec for_stack(String.t()) :: t() | nil
  def for_stack(stack_id) when is_stack_id(stack_id) do
    case :ets.whereis(table_name(stack_id)) do
      :undefined ->
        nil

      _tid ->
        %SubqueryIndex{
          table: table_name(stack_id),
          multi_time_view: MultiTimeView.for_stack(stack_id)
        }
    end
  end

  @doc """
  Register per-shape metadata: per-dep-index dependency handle (a.k.a.
  `subquery_id`) and the fallback flag.

  `dep_handles` is the outer shape's `shape_dependencies_handles` list,
  indexed by `dep_index`.
  """
  @spec register_shape(t(), term(), DnfPlan.t(), [term()]) :: :ok
  def register_shape(%SubqueryIndex{table: table}, shape_handle, %DnfPlan{} = plan, dep_handles) do
    for dep_index <- Map.keys(plan.dependency_polarities) do
      dep_handle = Enum.at(dep_handles, dep_index) || {shape_handle, dep_index}
      :ets.insert(table, {{:dep_handle, shape_handle, dep_index}, dep_handle})
    end

    :ets.insert(table, {{:fallback, shape_handle}, true})
    :ok
  end

  @doc "Remove all metadata for `shape_handle`."
  @spec unregister_shape(t(), term()) :: :ok
  def unregister_shape(%SubqueryIndex{table: table}, shape_handle) do
    :ets.match_delete(table, {{:dep_handle, shape_handle, :_}, :_})
    :ets.delete(table, {:fallback, shape_handle})
    :ok
  end

  @doc """
  Attach a shape to the indexed subquery node identified by
  `{condition_id, optimisation.field, optimisation.polarity}`. Creates the
  group and child node lazily.

  When the child is fresh, seeds positive (or negated) routing from the
  shared `MultiTimeView` at the subquery's current logical time. If the
  view is not yet ready for the subquery, the child is left unseeded —
  shapes still attached to that child are routed conservatively via the
  per-shape fallback rows until the seed happens (phase 2 of the RFC).
  """
  @spec add_shape(Filter.t(), reference(), term(), map(), [atom()]) :: :ok
  def add_shape(
        %Filter{subquery_index: %SubqueryIndex{table: table} = index} = filter,
        condition_id,
        shape_handle,
        optimisation,
        branch_key
      ) do
    ensure_node_meta(table, condition_id, optimisation.field, optimisation.testexpr)

    group_id =
      ensure_group(table, condition_id, optimisation.field, optimisation.polarity)

    subquery_id = lookup_dep_handle!(table, shape_handle, optimisation.dep_index)

    {child_node_id, next_condition_id} =
      ensure_child(
        filter,
        index,
        group_id,
        subquery_id,
        optimisation.polarity,
        condition_id,
        optimisation.field
      )

    WhereCondition.add_shape(
      filter,
      next_condition_id,
      shape_handle,
      optimisation.and_where,
      branch_key
    )

    :ets.insert(table, {{:child_shape, child_node_id}, {shape_handle, branch_key}})
    :ets.insert(table, {{:shape_child, shape_handle}, {child_node_id, branch_key}})

    if shape_in_fallback?(table, shape_handle) do
      :ets.insert(
        table,
        {{:node_fallback, condition_id, optimisation.field}, {child_node_id, shape_handle}}
      )
    end

    :ok
  end

  @doc """
  Detach a shape from an indexed subquery node. Returns `:deleted` when the
  node has no remaining children (so the parent `WhereCondition` can drop
  its index key), else `:ok`.
  """
  @spec remove_shape(Filter.t(), reference(), term(), map(), [atom()]) :: :deleted | :ok
  def remove_shape(
        %Filter{subquery_index: %SubqueryIndex{table: table, multi_time_view: mtv}} = filter,
        condition_id,
        shape_handle,
        optimisation,
        branch_key
      ) do
    case lookup_child_for_shape(
           table,
           condition_id,
           optimisation.field,
           optimisation.polarity,
           shape_handle,
           branch_key
         ) do
      nil ->
        node_status(table, condition_id, optimisation.field)

      {child_node_id, next_condition_id} ->
        _ =
          WhereCondition.remove_shape(
            filter,
            next_condition_id,
            shape_handle,
            optimisation.and_where,
            branch_key
          )

        :ets.delete_object(table, {{:child_shape, child_node_id}, {shape_handle, branch_key}})
        :ets.delete_object(table, {{:shape_child, shape_handle}, {child_node_id, branch_key}})

        :ets.delete_object(
          table,
          {{:node_fallback, condition_id, optimisation.field}, {child_node_id, shape_handle}}
        )

        if child_empty?(table, child_node_id) do
          delete_child(table, mtv, child_node_id)
        end

        node_status(table, condition_id, optimisation.field)
    end
  end

  @doc "Mark a shape as routable (clear fallback rows)."
  @spec mark_ready(t(), term()) :: :ok
  def mark_ready(%SubqueryIndex{table: table}, shape_handle) do
    :ets.delete(table, {:fallback, shape_handle})
    :ets.match_delete(table, {{:node_fallback, :_, :_}, {:_, shape_handle}})
    :ok
  end

  @spec fallback?(t(), term()) :: boolean()
  def fallback?(%SubqueryIndex{table: table}, shape_handle),
    do: shape_in_fallback?(table, shape_handle)

  defp shape_in_fallback?(table, shape_handle),
    do: :ets.member(table, {:fallback, shape_handle})

  @doc "Whether `shape_handle` is attached to at least one indexed subquery node."
  @spec has_positions?(t(), term()) :: boolean()
  def has_positions?(%SubqueryIndex{table: table}, shape_handle) do
    :ets.member(table, {:shape_child, shape_handle})
  end

  @doc """
  Add a positive route for `value` to every existing positive child of
  `subquery_id`. Called by the materializer when a value enters the
  retained window for that subquery.
  """
  @spec add_positive_route(t(), term(), term()) :: :ok
  def add_positive_route(%SubqueryIndex{table: table}, subquery_id, value) do
    for child_node_id <- children_for_subquery(table, subquery_id) do
      case :ets.lookup(table, {:child_meta, child_node_id}) do
        [{_, %{polarity: :positive, group_id: group_id}}] ->
          :ets.insert(table, {{:positive, group_id, value}, child_node_id})

        _ ->
          :ok
      end
    end

    :ok
  end

  @doc """
  Drop the positive route for `value` from every positive child of
  `subquery_id`. Called by compaction when `value` is out for the whole
  retained window.
  """
  @spec remove_positive_route(t(), term(), term()) :: :ok
  def remove_positive_route(%SubqueryIndex{table: table}, subquery_id, value) do
    for child_node_id <- children_for_subquery(table, subquery_id) do
      case :ets.lookup(table, {:child_meta, child_node_id}) do
        [{_, %{polarity: :positive, group_id: group_id}}] ->
          :ets.delete_object(table, {{:positive, group_id, value}, child_node_id})

        _ ->
          :ok
      end
    end

    :ok
  end

  @doc """
  Cascade removal of `subquery_id`: drop every child node, participant
  row, and routing row tied to that subquery. The bundled MultiTimeView is
  also cleared so values for the subquery are gone everywhere.
  """
  @spec remove_subquery(t(), term()) :: :ok
  def remove_subquery(%SubqueryIndex{table: table, multi_time_view: mtv}, subquery_id) do
    for child_node_id <- children_for_subquery(table, subquery_id) do
      cleanup_child_shapes(table, child_node_id)
      delete_child(table, mtv, child_node_id)
    end

    if mtv, do: MultiTimeView.remove_subquery(mtv, subquery_id)
    :ok
  end

  @doc """
  Shape candidates for a record entering the node `{condition_id,
  field_key}`. Combines value-keyed positive children with
  conservatively-kept negated children and any fallback children, then
  recurses through each child's `WhereCondition`.
  """
  @spec affected_shapes(Filter.t(), reference(), term(), map()) :: MapSet.t()
  def affected_shapes(
        %Filter{subquery_index: %SubqueryIndex{table: table, multi_time_view: mtv}} = filter,
        condition_id,
        field_key,
        record
      ) do
    candidates =
      case evaluate_node_lhs(table, condition_id, field_key, record) do
        {:ok, typed_value} ->
          positive_children(table, condition_id, field_key, typed_value)
          |> MapSet.union(negated_children(table, mtv, condition_id, field_key, typed_value))
          |> MapSet.union(fallback_children(table, condition_id, field_key))

        :error ->
          all_children(table, condition_id, field_key)
      end

    Enum.reduce(candidates, MapSet.new(), fn child_node_id, acc ->
      case :ets.lookup(table, {:child_meta, child_node_id}) do
        [{_, %{next_condition_id: next_condition_id}}] ->
          MapSet.union(acc, WhereCondition.affected_shapes(filter, next_condition_id, record))

        [] ->
          acc
      end
    end)
  end

  @spec all_shape_ids(Filter.t(), reference(), term()) :: MapSet.t()
  def all_shape_ids(
        %Filter{subquery_index: %SubqueryIndex{table: table}} = filter,
        condition_id,
        field_key
      ) do
    table
    |> all_children(condition_id, field_key)
    |> Enum.reduce(MapSet.new(), fn child_node_id, acc ->
      case :ets.lookup(table, {:child_meta, child_node_id}) do
        [{_, %{next_condition_id: next_condition_id}}] ->
          MapSet.union(acc, WhereCondition.all_shape_ids(filter, next_condition_id))

        [] ->
          acc
      end
    end)
  end

  defp ensure_node_meta(table, condition_id, field_key, testexpr) do
    case :ets.lookup(table, {:node_testexpr, condition_id, field_key}) do
      [] -> :ets.insert(table, {{:node_testexpr, condition_id, field_key}, testexpr})
      _ -> :ok
    end
  end

  defp ensure_group(table, condition_id, field_key, polarity) do
    key = {:group, condition_id, field_key, polarity}

    case :ets.lookup(table, key) do
      [{_, group_id}] ->
        group_id

      [] ->
        group_id = make_ref()
        :ets.insert(table, {key, group_id})
        group_id
    end
  end

  defp ensure_child(filter, index, group_id, subquery_id, polarity, condition_id, field_key) do
    %SubqueryIndex{table: table, multi_time_view: mtv} = index

    case :ets.lookup(table, {:child, group_id, subquery_id}) do
      [{_, child_node_id}] ->
        [{_, meta}] = :ets.lookup(table, {:child_meta, child_node_id})
        {child_node_id, meta.next_condition_id}

      [] ->
        child_node_id = make_ref()
        next_condition_id = make_ref()

        WhereCondition.init(filter, next_condition_id)

        meta = %{
          group_id: group_id,
          subquery_id: subquery_id,
          polarity: polarity,
          next_condition_id: next_condition_id,
          field_key: field_key,
          condition_id: condition_id
        }

        :ets.insert(table, {{:child, group_id, subquery_id}, child_node_id})
        :ets.insert(table, {{:child_meta, child_node_id}, meta})
        :ets.insert(table, {{:subquery_child, subquery_id}, child_node_id})

        seed_child_routing(table, mtv, child_node_id, meta)
        {child_node_id, next_condition_id}
    end
  end

  defp children_for_subquery(table, subquery_id) do
    for {_, cnid} <- :ets.lookup(table, {:subquery_child, subquery_id}), do: cnid
  end

  defp seed_child_routing(_table, nil, _child_node_id, _meta), do: :ok

  defp seed_child_routing(table, mtv, child_node_id, %{
         polarity: :positive,
         group_id: group_id,
         subquery_id: subquery_id
       }) do
    case MultiTimeView.current_time(mtv, subquery_id) do
      nil ->
        :ok

      time ->
        for value <- MultiTimeView.values(mtv, subquery_id, time) do
          :ets.insert(table, {{:positive, group_id, value}, child_node_id})
        end

        :ok
    end
  end

  defp seed_child_routing(table, _mtv, child_node_id, %{
         polarity: :negated,
         group_id: group_id
       }) do
    :ets.insert(table, {{:negated, group_id}, child_node_id})
    :ok
  end

  defp lookup_dep_handle!(table, shape_handle, dep_index) do
    case :ets.lookup(table, {:dep_handle, shape_handle, dep_index}) do
      [{_, dep_handle}] ->
        dep_handle

      [] ->
        raise ArgumentError,
              "no dep_handle registered for shape #{inspect(shape_handle)} dep_index " <>
                inspect(dep_index)
    end
  end

  defp lookup_child_for_shape(table, condition_id, field_key, polarity, shape_handle, branch_key) do
    with [{_, group_id}] <- :ets.lookup(table, {:group, condition_id, field_key, polarity}),
         {cnid, next} when not is_nil(cnid) <-
           Enum.find_value(
             :ets.lookup(table, {:shape_child, shape_handle}),
             {nil, nil},
             fn
               {_, {cnid, ^branch_key}} ->
                 case :ets.lookup(table, {:child_meta, cnid}) do
                   [{_, %{group_id: ^group_id, next_condition_id: next}}] -> {cnid, next}
                   _ -> nil
                 end

               _ ->
                 nil
             end
           ) do
      {cnid, next}
    else
      _ -> nil
    end
  end

  defp child_empty?(table, child_node_id) do
    not :ets.member(table, {:child_shape, child_node_id})
  end

  defp delete_child(table, mtv, child_node_id) do
    case :ets.lookup(table, {:child_meta, child_node_id}) do
      [] ->
        :ok

      [{_, meta}] ->
        case meta.polarity do
          :positive ->
            if mtv != nil do
              for value <- MultiTimeView.values(mtv, meta.subquery_id) do
                :ets.delete_object(table, {{:positive, meta.group_id, value}, child_node_id})
              end
            end

          :negated ->
            :ets.delete_object(table, {{:negated, meta.group_id}, child_node_id})
        end

        :ets.match_delete(table, {{:node_fallback, :_, :_}, {child_node_id, :_}})
        :ets.delete(table, {:child, meta.group_id, meta.subquery_id})
        :ets.delete_object(table, {{:subquery_child, meta.subquery_id}, child_node_id})
        :ets.delete(table, {:child_meta, child_node_id})

        if group_empty?(table, meta.group_id) do
          :ets.delete(
            table,
            {:group, meta.condition_id, meta.field_key, meta.polarity}
          )

          if node_empty?(table, meta.condition_id, meta.field_key) do
            :ets.delete(table, {:node_testexpr, meta.condition_id, meta.field_key})
          end
        end

        :ok
    end
  end

  defp cleanup_child_shapes(table, child_node_id) do
    for {_, {shape_handle, branch_key}} <- :ets.lookup(table, {:child_shape, child_node_id}) do
      :ets.delete_object(table, {{:shape_child, shape_handle}, {child_node_id, branch_key}})
      :ets.delete_object(table, {{:child_shape, child_node_id}, {shape_handle, branch_key}})
    end
  end

  defp group_empty?(table, group_id) do
    :ets.match(table, {{:child, group_id, :_}, :_}) == []
  end

  defp node_empty?(table, condition_id, field_key) do
    :ets.match(table, {{:group, condition_id, field_key, :_}, :_}) == []
  end

  defp positive_children(table, condition_id, field_key, value) do
    case :ets.lookup(table, {:group, condition_id, field_key, :positive}) do
      [] ->
        MapSet.new()

      [{_, group_id}] ->
        for {_, cnid} <- :ets.lookup(table, {:positive, group_id, value}),
            into: MapSet.new(),
            do: cnid
    end
  end

  defp negated_children(table, mtv, condition_id, field_key, value) do
    case :ets.lookup(table, {:group, condition_id, field_key, :negated}) do
      [] ->
        MapSet.new()

      [{_, group_id}] ->
        for {_, cnid} <- :ets.lookup(table, {:negated, group_id}),
            keep_negated_child?(table, mtv, cnid, value),
            into: MapSet.new(),
            do: cnid
    end
  end

  defp keep_negated_child?(_table, nil, _cnid, _value), do: true

  defp keep_negated_child?(table, mtv, cnid, value) do
    case :ets.lookup(table, {:child_meta, cnid}) do
      [{_, %{subquery_id: subquery_id}}] ->
        not MultiTimeView.member_at_all_times?(mtv, subquery_id, value)

      [] ->
        false
    end
  end

  defp fallback_children(table, condition_id, field_key) do
    for {_, {cnid, _shape}} <- :ets.lookup(table, {:node_fallback, condition_id, field_key}),
        into: MapSet.new(),
        do: cnid
  end

  defp all_children(table, condition_id, field_key) do
    table
    |> :ets.match({{:group, condition_id, field_key, :"$1"}, :"$2"})
    |> Enum.flat_map(fn [_polarity, group_id] ->
      table
      |> :ets.match({{:child, group_id, :_}, :"$1"})
      |> Enum.map(fn [cnid] -> cnid end)
    end)
    |> MapSet.new()
  end

  defp node_status(table, condition_id, field_key) do
    if node_empty?(table, condition_id, field_key), do: :deleted, else: :ok
  end

  defp evaluate_node_lhs(table, condition_id, field_key, record) do
    case :ets.lookup(table, {:node_testexpr, condition_id, field_key}) do
      [{_, testexpr}] ->
        expr = Expr.wrap_parser_part(testexpr)

        with {:ok, ref_values} <- Runner.record_to_ref_values(expr.used_refs, record),
             {:ok, value} <- Runner.execute(expr, ref_values) do
          {:ok, value}
        else
          _ -> :error
        end

      [] ->
        :error
    end
  end
end
