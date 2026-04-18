defmodule Electric.Shapes.Filter.Indexes.SubqueryIndex do
  # Index for subquery routing and exact membership.

  # Each subquery predicate in the filter tree registers a node identified by
  # `{condition_id, field_key}`. For each node, this table acts as a reverse
  # index from the value seen on the root-table record to the shapes whose
  # current subquery view makes that value relevant at that node.

  # Each shape consumer maintains its own entries in the index. On startup it
  # seeds the node memberships for its current dependency views, then updates
  # only those memberships as its subquery views change. This keeps the filter's
  # materialized view of subquery membership aligned with the view that shape
  # currently needs, without re-evaluating subqueries globally.

  # The same table also stores exact `shape_handle + subquery_ref + typed_value`
  # membership rows used by `WhereClause.includes_record?/3` when the filter
  # needs to verify subquery membership for a specific shape.

  # Shapes begin in a fallback set until their consumer has loaded and seeded
  # that local state. Fallback routing is needed for restored or lazily started
  # consumers: before their subquery view is available we still need to route
  # root-table changes conservatively so the shape can be started and brought up
  # to date. `mark_ready/2` removes the shape from fallback once its index
  # entries reflect the consumer's current view.
  @moduledoc false

  import Electric, only: [is_stack_id: 1]

  alias Electric.Replication.Eval.Expr
  alias Electric.Replication.Eval.Runner
  alias Electric.Shapes.DnfPlan
  alias Electric.Shapes.Filter
  alias Electric.Shapes.Filter.WhereCondition

  @type t :: :ets.tid() | atom()
  @type node_id :: {reference(), term()}

  defp table_name(stack_id) when is_stack_id(stack_id), do: :"subquery_index:#{stack_id}"

  @doc """
  Create a new SubqueryIndex ETS table.

  The table is `:public` so consumer processes can seed and update membership
  while the filter reads candidates during routing.
  """
  @spec new(keyword()) :: t()
  def new(opts \\ []) do
    case Keyword.get(opts, :stack_id) do
      nil ->
        :ets.new(:subquery_index, [:bag, :public])

      stack_id ->
        :ets.new(table_name(stack_id), [:bag, :public, :named_table])
    end
  end

  @doc """
  Look up the SubqueryIndex table for a stack.
  """
  @spec for_stack(String.t()) :: t() | nil
  def for_stack(stack_id) when is_stack_id(stack_id) do
    case :ets.whereis(table_name(stack_id)) do
      :undefined -> nil
      _tid -> table_name(stack_id)
    end
  end

  @doc """
  Register per-shape exact membership metadata from a compiled DnfPlan.

  Node-local routing metadata is registered by `add_shape/4` when the filter
  adds the shape to a concrete subquery node.
  """
  @spec register_shape(t(), term(), DnfPlan.t()) :: :ok
  def register_shape(table, shape_handle, %DnfPlan{} = plan) do
    polarities =
      plan.positions
      |> Enum.filter(fn {_pos, info} -> info.is_subquery end)
      |> Map.new(fn {_pos, info} ->
        {info.subquery_ref, if(info.negated, do: :negated, else: :positive)}
      end)

    for {subquery_ref, polarity} <- polarities do
      :ets.insert(table, {{:polarity, shape_handle, subquery_ref}, polarity})
    end

    :ets.insert(table, {{:fallback, shape_handle}, true})

    :ok
  end

  @doc """
  Remove all exact membership metadata for a shape.
  """
  @spec unregister_shape(t(), term()) :: :ok
  def unregister_shape(table, shape_handle) do
    :ets.match_delete(table, {{:membership, shape_handle, :_, :_}, true})
    :ets.match_delete(table, {{:polarity, shape_handle, :_}, :_})
    :ets.match_delete(table, {{:shape_node, shape_handle}, :_})
    :ets.match_delete(table, {{:shape_dep_node, shape_handle, :_}, :_})
    :ets.delete(table, {:fallback, shape_handle})
    :ok
  end

  @doc """
  Register a shape on a concrete subquery filter node.
  """
  @spec add_shape(Filter.t(), reference(), term(), map()) :: :ok
  def add_shape(%Filter{subquery_index: table} = filter, condition_id, shape_id, optimisation) do
    node_id = {condition_id, optimisation.field}
    next_condition_id = make_ref()

    WhereCondition.init(filter, next_condition_id)
    WhereCondition.add_shape(filter, next_condition_id, shape_id, optimisation.and_where)

    ensure_node_meta(table, node_id, optimisation.testexpr)

    :ets.insert(
      table,
      {{:node_shape, node_id},
       {shape_id, optimisation.dep_index, optimisation.polarity, next_condition_id}}
    )

    if optimisation.polarity == :negated do
      :ets.insert(table, {{:node_negated_shape, node_id}, {shape_id, next_condition_id}})
    end

    :ets.insert(
      table,
      {{:shape_node, shape_id},
       {node_id, optimisation.dep_index, optimisation.polarity, next_condition_id}}
    )

    :ets.insert(
      table,
      {{:shape_dep_node, shape_id, optimisation.dep_index},
       {node_id, optimisation.polarity, next_condition_id}}
    )

    :ets.insert(table, {{:node_fallback, node_id}, {shape_id, next_condition_id}})
    :ok
  end

  @doc """
  Remove a shape from a concrete subquery filter node.
  """
  @spec remove_shape(Filter.t(), reference(), term(), map()) :: :deleted | :ok
  def remove_shape(%Filter{subquery_index: table} = filter, condition_id, shape_id, optimisation) do
    node_id = {condition_id, optimisation.field}

    case node_shape_entry_for_shape(table, shape_id, node_id) do
      nil ->
        :deleted

      {dep_index, polarity, next_condition_id} ->
        _ =
          WhereCondition.remove_shape(filter, next_condition_id, shape_id, optimisation.and_where)

        :ets.match_delete(
          table,
          {{:node_shape, node_id}, {shape_id, dep_index, polarity, next_condition_id}}
        )

        if polarity == :negated do
          :ets.match_delete(
            table,
            {{:node_negated_shape, node_id}, {shape_id, next_condition_id}}
          )
        end

        :ets.match_delete(
          table,
          {{:shape_node, shape_id}, {node_id, dep_index, polarity, next_condition_id}}
        )

        :ets.match_delete(
          table,
          {{:shape_dep_node, shape_id, dep_index}, {node_id, polarity, next_condition_id}}
        )

        :ets.match_delete(table, {{:node_fallback, node_id}, {shape_id, next_condition_id}})
        delete_node_members(table, node_id, shape_id, polarity, next_condition_id)

        if node_empty?(table, node_id) do
          :ets.delete(table, {:node_meta, node_id})
          :deleted
        else
          :ok
        end
    end
  end

  @doc """
  Seed membership entries from a dependency view.
  """
  @spec seed_membership(t(), term(), [String.t()], non_neg_integer(), MapSet.t()) :: :ok
  def seed_membership(table, shape_handle, subquery_ref, dep_index, view) do
    for value <- view do
      add_value(table, shape_handle, subquery_ref, dep_index, value)
    end

    :ok
  end

  @doc """
  Mark a shape as ready for indexed routing.
  """
  @spec mark_ready(t(), term()) :: :ok
  def mark_ready(table, shape_handle) do
    :ets.delete(table, {:fallback, shape_handle})

    for {node_id, _dep_index, _polarity, _next_condition_id} <-
          nodes_for_shape(table, shape_handle) do
      :ets.match_delete(table, {{:node_fallback, node_id}, {shape_handle, :_}})
    end

    :ok
  end

  @doc """
  Add a value to both the node-local routing index and the exact membership set.
  """
  @spec add_value(t(), term(), [String.t()], non_neg_integer(), term()) :: :ok
  def add_value(table, shape_handle, subquery_ref, dep_index, value) do
    for {node_id, polarity, next_condition_id} <-
          nodes_for_shape_dependency(table, shape_handle, dep_index) do
      case polarity do
        :positive ->
          :ets.insert(
            table,
            {{:node_positive_member, node_id, value}, {shape_handle, next_condition_id}}
          )

        :negated ->
          :ets.insert(
            table,
            {{:node_negated_member, node_id, value}, {shape_handle, next_condition_id}}
          )
      end
    end

    :ets.insert(table, {{:membership, shape_handle, subquery_ref, value}, true})
    :ok
  end

  @doc """
  Remove a value from both the node-local routing index and the exact membership set.
  """
  @spec remove_value(t(), term(), [String.t()], non_neg_integer(), term()) :: :ok
  def remove_value(table, shape_handle, subquery_ref, dep_index, value) do
    for {node_id, polarity, next_condition_id} <-
          nodes_for_shape_dependency(table, shape_handle, dep_index) do
      case polarity do
        :positive ->
          :ets.match_delete(
            table,
            {{:node_positive_member, node_id, value}, {shape_handle, next_condition_id}}
          )

        :negated ->
          :ets.match_delete(
            table,
            {{:node_negated_member, node_id, value}, {shape_handle, next_condition_id}}
          )
      end
    end

    :ets.delete(table, {:membership, shape_handle, subquery_ref, value})
    :ok
  end

  @doc """
  Get affected shape handles for a specific subquery node.
  """
  @spec affected_shapes(Filter.t(), reference(), term(), map()) :: MapSet.t()
  def affected_shapes(%Filter{subquery_index: table} = filter, condition_id, field_key, record) do
    node_id = {condition_id, field_key}

    candidates =
      case evaluate_node_lhs(table, node_id, record) do
        {:ok, typed_value} ->
          positive =
            values_for_key(table, {:node_positive_member, node_id, typed_value}) |> MapSet.new()

          negated =
            MapSet.difference(
              values_for_key(table, {:node_negated_shape, node_id}) |> MapSet.new(),
              values_for_key(table, {:node_negated_member, node_id, typed_value}) |> MapSet.new()
            )

          fallback = values_for_key(table, {:node_fallback, node_id}) |> MapSet.new()

          positive
          |> MapSet.union(negated)
          |> MapSet.union(fallback)

        :error ->
          all_node_shapes(table, node_id)
      end

    Enum.reduce(candidates, MapSet.new(), fn {_shape_id, next_condition_id}, acc ->
      MapSet.union(
        acc,
        WhereCondition.affected_shapes(filter, next_condition_id, record)
      )
    end)
  end

  @doc """
  Get all shape ids registered on a specific subquery node.
  """
  @spec all_shape_ids(Filter.t(), reference(), term()) :: MapSet.t()
  def all_shape_ids(%Filter{subquery_index: table} = filter, condition_id, field_key) do
    table
    |> all_node_shapes({condition_id, field_key})
    |> Enum.reduce(MapSet.new(), fn {_shape_id, next_condition_id}, acc ->
      MapSet.union(acc, WhereCondition.all_shape_ids(filter, next_condition_id))
    end)
  end

  @doc """
  Check if a specific shape has a value in its current dependency view
  for a canonical subquery ref.
  """
  @spec member?(t(), term(), [String.t()], term()) :: boolean()
  def member?(table, shape_handle, subquery_ref, typed_value) do
    :ets.member(table, {:membership, shape_handle, subquery_ref, typed_value})
  end

  @doc """
  Check subquery membership for exact evaluation, falling back to the shape's
  dependency polarity while the shape is still unseeded.
  """
  @spec membership_or_fallback?(t(), term(), [String.t()], term()) :: boolean()
  def membership_or_fallback?(table, shape_handle, subquery_ref, typed_value) do
    if shape_ready?(table, shape_handle) do
      member?(table, shape_handle, subquery_ref, typed_value)
    else
      case polarity_for_shape_ref(table, shape_handle, subquery_ref) do
        :positive -> true
        :negated -> false
      end
    end
  end

  @doc """
  Check if a shape is in the fallback set.
  """
  @spec fallback?(t(), term()) :: boolean()
  def fallback?(table, shape_handle) do
    :ets.member(table, {:fallback, shape_handle})
  end

  @doc """
  Check if a shape has any registered subquery nodes.
  """
  @spec has_positions?(t(), term()) :: boolean()
  def has_positions?(table, shape_handle) do
    nodes_for_shape(table, shape_handle) != []
  end

  @doc """
  Return the registered node ids for a shape.
  """
  @spec positions_for_shape(t(), term()) :: [node_id()]
  def positions_for_shape(table, shape_handle) do
    table
    |> nodes_for_shape(shape_handle)
    |> Enum.map(fn {node_id, _dep_index, _polarity, _next_condition_id} -> node_id end)
  end

  defp ensure_node_meta(table, node_id, testexpr) do
    case :ets.lookup(table, {:node_meta, node_id}) do
      [] ->
        :ets.insert(table, {{:node_meta, node_id}, %{testexpr: testexpr}})

      _ ->
        :ok
    end
  end

  defp delete_node_members(table, node_id, shape_id, polarity, next_condition_id) do
    case polarity do
      :positive ->
        :ets.match_delete(
          table,
          {{:node_positive_member, node_id, :_}, {shape_id, next_condition_id}}
        )

      :negated ->
        :ets.match_delete(
          table,
          {{:node_negated_member, node_id, :_}, {shape_id, next_condition_id}}
        )
    end
  end

  defp nodes_for_shape(table, shape_handle) do
    table
    |> :ets.lookup({:shape_node, shape_handle})
    |> Enum.map(&elem(&1, 1))
  end

  defp nodes_for_shape_dependency(table, shape_handle, dep_index) do
    table
    |> :ets.lookup({:shape_dep_node, shape_handle, dep_index})
    |> Enum.map(&elem(&1, 1))
  end

  defp node_shape_entry_for_shape(table, shape_id, node_id) do
    table
    |> nodes_for_shape(shape_id)
    |> Enum.find_value(fn
      {^node_id, dep_index, polarity, next_condition_id} ->
        {dep_index, polarity, next_condition_id}

      _ ->
        nil
    end)
  end

  defp node_empty?(table, node_id) do
    :ets.lookup(table, {:node_shape, node_id}) == []
  end

  defp all_node_shapes(table, node_id) do
    table
    |> :ets.lookup({:node_shape, node_id})
    |> Enum.reduce(MapSet.new(), fn
      {{:node_shape, ^node_id}, {shape_id, _dep_index, _polarity, next_condition_id}}, acc ->
        MapSet.put(acc, {shape_id, next_condition_id})

      _, acc ->
        acc
    end)
  end

  defp evaluate_node_lhs(table, node_id, record) do
    case :ets.lookup(table, {:node_meta, node_id}) do
      [{_, %{testexpr: testexpr}}] ->
        expr = Expr.wrap_parser_part(testexpr)

        case Runner.record_to_ref_values(expr.used_refs, record) do
          {:ok, ref_values} ->
            case Runner.execute(expr, ref_values) do
              {:ok, value} -> {:ok, value}
              _ -> :error
            end

          _ ->
            :error
        end

      [] ->
        :error
    end
  end

  defp values_for_key(table, key) do
    table
    |> :ets.lookup(key)
    |> Enum.map(&elem(&1, 1))
  end

  defp shape_ready?(table, shape_handle) do
    not fallback?(table, shape_handle)
  end

  defp polarity_for_shape_ref(table, shape_handle, subquery_ref) do
    case :ets.lookup(table, {:polarity, shape_handle, subquery_ref}) do
      [{_, polarity}] ->
        polarity

      [] ->
        raise ArgumentError,
              "missing polarity for shape #{inspect(shape_handle)} and ref #{inspect(subquery_ref)}"
    end
  end
end
