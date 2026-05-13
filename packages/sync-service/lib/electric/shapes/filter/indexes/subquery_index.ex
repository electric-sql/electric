defmodule Electric.Shapes.Filter.Indexes.SubqueryIndex do
  # Shared subquery membership index.
  #
  # The index stores one base dependency view per cohort and sparse XOR
  # exceptions per shape/dependency participant. Concrete subquery filter-node
  # positions are represented as routing edges that point at those participants.
  @moduledoc false

  import Electric, only: [is_stack_id: 1]

  alias Electric.Replication.Eval.Expr
  alias Electric.Replication.Eval.Runner
  alias Electric.Shapes.DnfPlan
  alias Electric.Shapes.Filter
  alias Electric.Shapes.Filter.WhereCondition
  alias Electric.Shapes.Shape

  defstruct [
    :participant_meta,
    :cohort_meta,
    :cohort_by_key,
    :cohorts_by_node,
    :node_meta,
    :positive_edges,
    :negated_edges,
    :edges_by_participant,
    :participants_by_shape,
    :participants_by_cohort,
    :cohorts_by_subquery,
    :shape_ref_participant,
    :shape_dep_participant,
    :participant_count,
    :cohort_value,
    :exception_by_value,
    :exception_by_participant,
    :shape_fallback,
    :node_fallback,
    :node_shape,
    :shape_node,
    :shape_dep_node
  ]

  @type t :: %__MODULE__{}
  @type node_id :: {reference(), term()}
  @type participant_id :: pos_integer()
  @type cohort_id :: pos_integer()

  @tables [
    {:participant_meta, :set},
    {:cohort_meta, :set},
    {:cohort_by_key, :set},
    {:cohorts_by_node, :bag},
    {:node_meta, :set},
    {:positive_edges, :bag},
    {:negated_edges, :bag},
    {:edges_by_participant, :bag},
    {:participants_by_shape, :bag},
    {:participants_by_cohort, :bag},
    {:cohorts_by_subquery, :bag},
    {:shape_ref_participant, :set},
    {:shape_dep_participant, :set},
    {:participant_count, :set},
    {:cohort_value, :set},
    {:exception_by_value, :bag},
    {:exception_by_participant, :bag},
    {:shape_fallback, :set},
    {:node_fallback, :bag},
    {:node_shape, :bag},
    {:shape_node, :bag},
    {:shape_dep_node, :bag}
  ]

  defp table_name(stack_id, table) when is_stack_id(stack_id),
    do: :"subquery_index:#{stack_id}:#{table}"

  @doc """
  Create a new SubqueryIndex.

  The tables are public so consumer processes can seed and update membership
  while the filter reads candidates during routing.
  """
  @spec new(keyword()) :: t()
  def new(opts \\ []) do
    table_opts = [:public, read_concurrency: true, write_concurrency: true]

    tables =
      Map.new(@tables, fn {name, type} ->
        table =
          case Keyword.get(opts, :stack_id) do
            nil ->
              :ets.new(:"subquery_index_#{name}", [type | table_opts])

            stack_id ->
              :ets.new(table_name(stack_id, name), [type, :named_table | table_opts])
          end

        {name, table}
      end)

    struct!(__MODULE__, tables)
  end

  @doc """
  Look up the SubqueryIndex tables for a stack.
  """
  @spec for_stack(String.t()) :: t() | nil
  def for_stack(stack_id) when is_stack_id(stack_id) do
    first_table = table_name(stack_id, :participant_meta)

    case :ets.whereis(first_table) do
      :undefined ->
        nil

      _tid ->
        tables =
          Map.new(@tables, fn {name, _type} ->
            {name, table_name(stack_id, name)}
          end)

        struct!(__MODULE__, tables)
    end
  end

  @doc """
  Return all ETS tables owned by the index.
  """
  @spec tables(t()) :: [:ets.tid() | atom()]
  def tables(%__MODULE__{} = index) do
    index
    |> Map.from_struct()
    |> Map.values()
  end

  @doc """
  Return row counts for all index tables.
  """
  @spec stats(t()) :: map()
  def stats(%__MODULE__{} = index) do
    index
    |> Map.from_struct()
    |> Map.new(fn {name, table} -> {name, :ets.info(table, :size)} end)
  end

  @doc """
  Register per-shape subquery participants from a compiled DnfPlan.
  """
  @spec register_shape(t(), term(), DnfPlan.t()) :: :ok
  def register_shape(%__MODULE__{} = index, shape_handle, %DnfPlan{} = plan) do
    register_shape(index, shape_handle, plan, [])
  end

  @spec register_shape(t(), term(), Shape.t(), DnfPlan.t()) :: :ok
  def register_shape(
        %__MODULE__{} = index,
        shape_handle,
        %Shape{} = shape,
        %DnfPlan{} = plan
      ) do
    register_shape(index, shape_handle, plan, shape.shape_dependencies_handles)
  end

  @spec register_shape(t(), term(), DnfPlan.t(), [term()]) :: :ok
  def register_shape(%__MODULE__{} = index, shape_handle, %DnfPlan{} = plan, dep_handles)
      when is_list(dep_handles) do
    for {dep_index, positions} <- plan.dependency_positions do
      info = Map.fetch!(plan.positions, hd(positions))
      subquery_ref = info.subquery_ref
      polarity = Map.fetch!(plan.dependency_polarities, dep_index)
      {cohort_key, subquery_key} = cohort_keys(shape_handle, dep_index, dep_handles)
      cohort_id = ensure_cohort(index, cohort_key, subquery_key)
      participant_id = System.unique_integer([:positive])

      :ets.insert(
        index.participant_meta,
        {participant_id, shape_handle, cohort_id, subquery_ref, dep_index, polarity, :fallback}
      )

      :ets.insert(
        index.participants_by_shape,
        {shape_handle, participant_id, cohort_id, polarity}
      )

      :ets.insert(index.participants_by_cohort, {cohort_id, participant_id})

      :ets.insert(
        index.shape_ref_participant,
        {{shape_handle, subquery_ref}, participant_id, cohort_id}
      )

      :ets.insert(
        index.shape_dep_participant,
        {{shape_handle, dep_index}, participant_id, cohort_id}
      )
    end

    :ets.insert(index.shape_fallback, {shape_handle, true})
    :ok
  end

  @doc """
  Remove all subquery participants for a shape.
  """
  @spec unregister_shape(t(), term()) :: :ok
  def unregister_shape(%__MODULE__{} = index, shape_handle) do
    index.participants_by_shape
    |> :ets.lookup(shape_handle)
    |> Enum.each(fn {^shape_handle, participant_id, _cohort_id, _polarity} ->
      remove_participant(index, participant_id)
    end)

    :ets.delete(index.shape_fallback, shape_handle)
    :ok
  end

  @doc """
  Register a shape on a concrete subquery filter node.
  """
  @spec add_shape(Filter.t(), reference(), term(), map(), [atom()]) :: :ok
  def add_shape(
        %Filter{subquery_index: %__MODULE__{} = index} = filter,
        condition_id,
        shape_id,
        optimisation,
        branch_key
      ) do
    node_id = {condition_id, optimisation.field}
    next_condition_id = make_ref()

    WhereCondition.init(filter, next_condition_id)

    WhereCondition.add_shape(
      filter,
      next_condition_id,
      shape_id,
      optimisation.and_where,
      branch_key
    )

    ensure_node_meta(index, node_id, optimisation.testexpr)

    {participant_id, cohort_id} =
      participant_for_shape_dependency(
        index,
        shape_id,
        optimisation.subquery_ref,
        optimisation.dep_index,
        optimisation.polarity
      )

    :ets.insert(index.cohorts_by_node, {node_id, cohort_id})

    edge =
      {participant_id, node_id, cohort_id, optimisation.polarity, next_condition_id, branch_key}

    :ets.insert(index.edges_by_participant, edge)

    case optimisation.polarity do
      :positive ->
        :ets.insert(
          index.positive_edges,
          {{node_id, cohort_id}, participant_id, next_condition_id}
        )

      :negated ->
        :ets.insert(
          index.negated_edges,
          {{node_id, cohort_id}, participant_id, next_condition_id}
        )
    end

    :ets.insert(
      index.node_shape,
      {node_id, shape_id, optimisation.dep_index, optimisation.polarity, next_condition_id,
       branch_key, participant_id, cohort_id}
    )

    :ets.insert(
      index.shape_node,
      {shape_id, node_id, optimisation.dep_index, optimisation.polarity, next_condition_id,
       branch_key, participant_id, cohort_id}
    )

    :ets.insert(
      index.shape_dep_node,
      {{shape_id, optimisation.dep_index}, node_id, optimisation.polarity, next_condition_id,
       branch_key, participant_id, cohort_id}
    )

    :ets.insert(index.node_fallback, {node_id, {shape_id, next_condition_id}})
    :ok
  end

  @doc """
  Remove a shape from a concrete subquery filter node.
  """
  @spec remove_shape(Filter.t(), reference(), term(), map(), [atom()]) :: :deleted | :ok
  def remove_shape(
        %Filter{subquery_index: %__MODULE__{} = index} = filter,
        condition_id,
        shape_id,
        optimisation,
        branch_key
      ) do
    node_id = {condition_id, optimisation.field}

    case node_shape_entry_for_shape(index, shape_id, node_id, branch_key) do
      nil ->
        :deleted

      {dep_index, polarity, next_condition_id, participant_id, cohort_id} ->
        _ =
          WhereCondition.remove_shape(
            filter,
            next_condition_id,
            shape_id,
            optimisation.and_where,
            branch_key
          )

        remove_edge(
          index,
          shape_id,
          node_id,
          dep_index,
          polarity,
          next_condition_id,
          branch_key,
          participant_id,
          cohort_id
        )

        if node_empty?(index, node_id) do
          :ets.delete(index.node_meta, node_id)
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
  def seed_membership(%__MODULE__{} = index, shape_handle, subquery_ref, dep_index, view) do
    {participant_id, cohort_id} =
      participant_for_shape_dependency(index, shape_handle, subquery_ref, dep_index, :positive)

    seed_participant(index, participant_id, cohort_id, MapSet.new(view))
    :ok
  end

  @doc """
  Mark a shape as ready for indexed routing when all participants are indexed.
  """
  @spec mark_ready(t(), term()) :: :ok
  def mark_ready(%__MODULE__{} = index, shape_handle) do
    if shape_participants_ready?(index, shape_handle) do
      :ets.delete(index.shape_fallback, shape_handle)

      for {_shape_handle, participant_id, _cohort_id, _polarity} <-
            :ets.lookup(index.participants_by_shape, shape_handle) do
        for {^participant_id, node_id, _cohort_id, _polarity, next_condition_id, _branch_key} <-
              :ets.lookup(index.edges_by_participant, participant_id) do
          :ets.match_delete(index.node_fallback, {node_id, {shape_handle, next_condition_id}})
        end
      end
    end

    :ok
  end

  @doc """
  Add a value to a participant's local dependency view.
  """
  @spec add_value(t(), term(), [String.t()], non_neg_integer(), term()) :: :ok
  def add_value(%__MODULE__{} = index, shape_handle, subquery_ref, dep_index, value) do
    {participant_id, cohort_id} =
      participant_for_shape_dependency(index, shape_handle, subquery_ref, dep_index, :positive)

    ensure_indexed(index, participant_id, cohort_id)
    set_membership(index, participant_id, cohort_id, value, true)
  end

  @doc """
  Remove a value from a participant's local dependency view.
  """
  @spec remove_value(t(), term(), [String.t()], non_neg_integer(), term()) :: :ok
  def remove_value(%__MODULE__{} = index, shape_handle, subquery_ref, dep_index, value) do
    {participant_id, cohort_id} =
      participant_for_shape_dependency(index, shape_handle, subquery_ref, dep_index, :positive)

    ensure_indexed(index, participant_id, cohort_id)
    set_membership(index, participant_id, cohort_id, value, false)
  end

  @doc """
  Get affected shape handles for a specific subquery node.
  """
  @spec affected_shapes(Filter.t(), reference(), term(), map()) :: MapSet.t()
  def affected_shapes(
        %Filter{subquery_index: %__MODULE__{} = index} = filter,
        condition_id,
        field_key,
        record
      ) do
    node_id = {condition_id, field_key}

    candidates =
      case evaluate_node_lhs(index, node_id, record) do
        {:ok, typed_value} ->
          indexed =
            index.cohorts_by_node
            |> :ets.lookup(node_id)
            |> Enum.reduce(MapSet.new(), fn {^node_id, cohort_id}, acc ->
              MapSet.union(acc, candidates_for_cohort(index, node_id, cohort_id, typed_value))
            end)

          fallback = values_for_key(index.node_fallback, node_id) |> MapSet.new()
          MapSet.union(indexed, fallback)

        :error ->
          all_node_shapes(index, node_id)
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
  def all_shape_ids(
        %Filter{subquery_index: %__MODULE__{} = index} = filter,
        condition_id,
        field_key
      ) do
    index
    |> all_node_shapes({condition_id, field_key})
    |> Enum.reduce(MapSet.new(), fn {_shape_id, next_condition_id}, acc ->
      MapSet.union(acc, WhereCondition.all_shape_ids(filter, next_condition_id))
    end)
  end

  @doc """
  Check if a shape has a value in its current dependency view.
  """
  @spec member?(t(), term(), [String.t()], term()) :: boolean()
  def member?(%__MODULE__{} = index, shape_handle, subquery_ref, typed_value) do
    case :ets.lookup(index.shape_ref_participant, {shape_handle, subquery_ref}) do
      [{{^shape_handle, ^subquery_ref}, participant_id, cohort_id}] ->
        local_member?(index, participant_id, cohort_id, typed_value)

      [] ->
        false
    end
  end

  @doc """
  Check subquery membership for exact evaluation, falling back to dependency
  polarity while the shape is still unseeded.
  """
  @spec membership_or_fallback?(t(), term(), [String.t()], term()) :: boolean()
  def membership_or_fallback?(%__MODULE__{} = index, shape_handle, subquery_ref, typed_value) do
    if shape_ready?(index, shape_handle) do
      member?(index, shape_handle, subquery_ref, typed_value)
    else
      case polarity_for_shape_ref(index, shape_handle, subquery_ref) do
        :positive -> true
        :negated -> false
      end
    end
  end

  @doc """
  Check if a shape is in the fallback set.
  """
  @spec fallback?(t(), term()) :: boolean()
  def fallback?(%__MODULE__{} = index, shape_handle) do
    :ets.member(index.shape_fallback, shape_handle)
  end

  @doc """
  Check if a shape has any registered subquery nodes.
  """
  @spec has_positions?(t(), term()) :: boolean()
  def has_positions?(%__MODULE__{} = index, shape_handle) do
    nodes_for_shape(index, shape_handle) != []
  end

  @doc """
  Return registered node ids for a shape.
  """
  @spec positions_for_shape(t(), term()) :: [node_id()]
  def positions_for_shape(%__MODULE__{} = index, shape_handle) do
    index
    |> nodes_for_shape(shape_handle)
    |> Enum.map(fn {node_id, _dep_index, _polarity, _next_condition_id, _branch_key,
                    _participant_id, _cohort_id} ->
      node_id
    end)
  end

  @doc """
  Remove all cohorts for a dependency lifecycle key.
  """
  @spec remove_subquery(t(), term()) :: :ok
  def remove_subquery(%__MODULE__{} = index, subquery_key) do
    index.cohorts_by_subquery
    |> :ets.lookup(subquery_key)
    |> Enum.each(fn {^subquery_key, cohort_id} ->
      remove_cohort(index, cohort_id)
    end)

    :ok
  end

  @doc """
  Remove a single cohort and all participants attached to it.
  """
  @spec remove_cohort(t(), cohort_id()) :: :ok
  def remove_cohort(%__MODULE__{} = index, cohort_id) do
    index.participants_by_cohort
    |> :ets.lookup(cohort_id)
    |> Enum.each(fn {^cohort_id, participant_id} ->
      remove_participant(index, participant_id)
    end)

    detach_empty_cohort(index, cohort_id)
    :ok
  end

  defp cohort_keys(_shape_handle, dep_index, dep_handles) do
    case Enum.at(dep_handles, dep_index) do
      nil ->
        fallback = {:shape_local_dependency, make_ref(), dep_index}
        {fallback, fallback}

      dep_handle ->
        key = {:dependency_shape, dep_handle}
        {key, key}
    end
  end

  defp ensure_cohort(index, cohort_key, subquery_key) do
    case :ets.lookup(index.cohort_by_key, cohort_key) do
      [{^cohort_key, cohort_id}] ->
        cohort_id

      [] ->
        cohort_id = System.unique_integer([:positive])

        if :ets.insert_new(index.cohort_by_key, {cohort_key, cohort_id}) do
          :ets.insert(index.cohort_meta, {cohort_id, cohort_key, subquery_key, :active})
          :ets.insert(index.cohorts_by_subquery, {subquery_key, cohort_id})
          :ets.insert(index.participant_count, {cohort_id, 0})
          cohort_id
        else
          [{^cohort_key, existing_id}] = :ets.lookup(index.cohort_by_key, cohort_key)
          existing_id
        end
    end
  end

  defp ensure_node_meta(index, node_id, testexpr) do
    case :ets.lookup(index.node_meta, node_id) do
      [] -> :ets.insert(index.node_meta, {node_id, %{testexpr: testexpr}})
      _ -> :ok
    end
  end

  defp participant_for_shape_dependency(index, shape_handle, subquery_ref, dep_index, polarity) do
    case :ets.lookup(index.shape_dep_participant, {shape_handle, dep_index}) do
      [{{^shape_handle, ^dep_index}, participant_id, cohort_id}] ->
        {participant_id, cohort_id}

      [] ->
        cohort_key = {:shape_local_dependency, shape_handle, dep_index}
        cohort_id = ensure_cohort(index, cohort_key, cohort_key)
        participant_id = System.unique_integer([:positive])

        :ets.insert(
          index.participant_meta,
          {participant_id, shape_handle, cohort_id, subquery_ref, dep_index, polarity, :fallback}
        )

        :ets.insert(
          index.participants_by_shape,
          {shape_handle, participant_id, cohort_id, polarity}
        )

        :ets.insert(index.participants_by_cohort, {cohort_id, participant_id})

        :ets.insert(
          index.shape_ref_participant,
          {{shape_handle, subquery_ref}, participant_id, cohort_id}
        )

        :ets.insert(
          index.shape_dep_participant,
          {{shape_handle, dep_index}, participant_id, cohort_id}
        )

        :ets.insert(index.shape_fallback, {shape_handle, true})
        {participant_id, cohort_id}
    end
  end

  defp seed_participant(index, participant_id, cohort_id, view) do
    ensure_indexed(index, participant_id, cohort_id)
    base_values = base_values(index, cohort_id)

    values_to_check =
      view
      |> MapSet.union(base_values)

    Enum.each(values_to_check, fn value ->
      set_membership(index, participant_id, cohort_id, value, MapSet.member?(view, value))
    end)
  end

  defp ensure_indexed(index, participant_id, cohort_id) do
    case :ets.lookup(index.participant_meta, participant_id) do
      [{^participant_id, shape_handle, ^cohort_id, subquery_ref, dep_index, polarity, :indexed}] ->
        {shape_handle, subquery_ref, dep_index, polarity}

      [{^participant_id, shape_handle, ^cohort_id, subquery_ref, dep_index, polarity, _readiness}] ->
        :ets.update_counter(index.participant_count, cohort_id, {2, 1}, {cohort_id, 0})

        :ets.insert(
          index.participant_meta,
          {participant_id, shape_handle, cohort_id, subquery_ref, dep_index, polarity, :indexed}
        )

        {shape_handle, subquery_ref, dep_index, polarity}

      [] ->
        raise ArgumentError, "unknown subquery participant #{inspect(participant_id)}"
    end
  end

  defp set_membership(index, participant_id, cohort_id, value, desired_member?) do
    base_member? = base_member?(index, cohort_id, value)
    has_exception? = exception?(index, cohort_id, value, participant_id)
    current_member? = xor(base_member?, has_exception?)

    if current_member? != desired_member? do
      if has_exception? do
        delete_exception(index, participant_id, cohort_id, value)
      else
        insert_exception(index, participant_id, cohort_id, value)
      end

      maybe_promote(index, cohort_id, value)
    end

    :ok
  end

  defp local_member?(index, participant_id, cohort_id, value) do
    xor(
      base_member?(index, cohort_id, value),
      exception?(index, cohort_id, value, participant_id)
    )
  end

  defp base_member?(index, cohort_id, value) do
    case :ets.lookup(index.cohort_value, {cohort_id, value}) do
      [{{^cohort_id, ^value}, base_member?, _exception_count}] -> base_member?
      [] -> false
    end
  end

  defp exception_count(index, cohort_id, value) do
    case :ets.lookup(index.cohort_value, {cohort_id, value}) do
      [{{^cohort_id, ^value}, _base_member?, exception_count}] -> exception_count
      [] -> 0
    end
  end

  defp exception?(index, cohort_id, value, participant_id) do
    index.exception_by_value
    |> :ets.lookup({cohort_id, value})
    |> Enum.any?(fn
      {{^cohort_id, ^value}, ^participant_id} -> true
      _ -> false
    end)
  end

  defp insert_exception(index, participant_id, cohort_id, value) do
    unless exception?(index, cohort_id, value, participant_id) do
      {base_member?, exception_count} = cohort_value(index, cohort_id, value)
      :ets.insert(index.exception_by_value, {{cohort_id, value}, participant_id})
      :ets.insert(index.exception_by_participant, {participant_id, cohort_id, value})
      put_cohort_value(index, cohort_id, value, base_member?, exception_count + 1)
    end
  end

  defp delete_exception(index, participant_id, cohort_id, value) do
    if exception?(index, cohort_id, value, participant_id) do
      {base_member?, exception_count} = cohort_value(index, cohort_id, value)
      :ets.match_delete(index.exception_by_value, {{cohort_id, value}, participant_id})
      :ets.match_delete(index.exception_by_participant, {participant_id, cohort_id, value})
      put_cohort_value(index, cohort_id, value, base_member?, max(exception_count - 1, 0))
    end
  end

  defp cohort_value(index, cohort_id, value) do
    case :ets.lookup(index.cohort_value, {cohort_id, value}) do
      [{{^cohort_id, ^value}, base_member?, exception_count}] -> {base_member?, exception_count}
      [] -> {false, 0}
    end
  end

  defp put_cohort_value(index, cohort_id, value, false, 0) do
    :ets.delete(index.cohort_value, {cohort_id, value})
  end

  defp put_cohort_value(index, cohort_id, value, base_member?, exception_count) do
    :ets.insert(index.cohort_value, {{cohort_id, value}, base_member?, exception_count})
  end

  defp maybe_promote(index, cohort_id, value) do
    participant_count = participant_count(index, cohort_id)
    exception_count = exception_count(index, cohort_id, value)

    if participant_count > 0 and exception_count == participant_count do
      base_member? = base_member?(index, cohort_id, value)
      participants = exception_participants(index, cohort_id, value)

      Enum.each(participants, fn participant_id ->
        :ets.match_delete(index.exception_by_participant, {participant_id, cohort_id, value})
      end)

      :ets.delete(index.exception_by_value, {cohort_id, value})
      put_cohort_value(index, cohort_id, value, not base_member?, 0)
    end
  end

  defp participant_count(index, cohort_id) do
    case :ets.lookup(index.participant_count, cohort_id) do
      [{^cohort_id, count}] -> count
      [] -> 0
    end
  end

  defp exception_participants(index, cohort_id, value) do
    index.exception_by_value
    |> :ets.lookup({cohort_id, value})
    |> Enum.map(fn {{^cohort_id, ^value}, participant_id} -> participant_id end)
  end

  defp base_values(index, cohort_id) do
    :ets.foldl(
      fn
        {{^cohort_id, value}, true, _exception_count}, acc -> MapSet.put(acc, value)
        _row, acc -> acc
      end,
      MapSet.new(),
      index.cohort_value
    )
  end

  defp candidates_for_cohort(index, node_id, cohort_id, value) do
    base_member? = base_member?(index, cohort_id, value)

    positive_edges = edge_set(index.positive_edges, node_id, cohort_id)
    negated_edges = edge_set(index.negated_edges, node_id, cohort_id)
    positive_exceptions = exception_edge_set(index, node_id, cohort_id, value, :positive)
    negated_exceptions = exception_edge_set(index, node_id, cohort_id, value, :negated)

    matching_edges =
      if base_member? do
        positive_edges
        |> MapSet.difference(positive_exceptions)
        |> MapSet.union(negated_exceptions)
      else
        positive_exceptions
        |> MapSet.union(MapSet.difference(negated_edges, negated_exceptions))
      end

    Enum.reduce(matching_edges, MapSet.new(), fn {participant_id, next_condition_id}, acc ->
      case :ets.lookup(index.participant_meta, participant_id) do
        [{^participant_id, shape_handle, ^cohort_id, _subquery_ref, _dep_index, _polarity, _}] ->
          MapSet.put(acc, {shape_handle, next_condition_id})

        [] ->
          acc
      end
    end)
  end

  defp edge_set(table, node_id, cohort_id) do
    table
    |> :ets.lookup({node_id, cohort_id})
    |> Enum.reduce(MapSet.new(), fn {{^node_id, ^cohort_id}, participant_id, next_condition_id},
                                    acc ->
      MapSet.put(acc, {participant_id, next_condition_id})
    end)
  end

  defp exception_edge_set(index, node_id, cohort_id, value, polarity) do
    index
    |> exception_participants(cohort_id, value)
    |> Enum.reduce(MapSet.new(), fn participant_id, acc ->
      index.edges_by_participant
      |> :ets.lookup(participant_id)
      |> Enum.reduce(acc, fn
        {^participant_id, ^node_id, ^cohort_id, ^polarity, next_condition_id, _branch_key}, acc ->
          MapSet.put(acc, {participant_id, next_condition_id})

        _edge, acc ->
          acc
      end)
    end)
  end

  defp remove_participant(index, participant_id) do
    case :ets.lookup(index.participant_meta, participant_id) do
      [{^participant_id, shape_handle, cohort_id, subquery_ref, dep_index, polarity, readiness}] ->
        index.edges_by_participant
        |> :ets.lookup(participant_id)
        |> Enum.each(fn {^participant_id, node_id, ^cohort_id, edge_polarity, next_condition_id,
                         branch_key} ->
          remove_edge(
            index,
            shape_handle,
            node_id,
            dep_index,
            edge_polarity,
            next_condition_id,
            branch_key,
            participant_id,
            cohort_id
          )
        end)

        if readiness == :indexed do
          :ets.update_counter(index.participant_count, cohort_id, {2, -1, 0, 0}, {cohort_id, 0})
        end

        index.exception_by_participant
        |> :ets.lookup(participant_id)
        |> Enum.each(fn {^participant_id, ^cohort_id, value} ->
          delete_exception(index, participant_id, cohort_id, value)
          maybe_promote(index, cohort_id, value)
        end)

        :ets.match_delete(
          index.participants_by_shape,
          {shape_handle, participant_id, cohort_id, polarity}
        )

        :ets.match_delete(index.participants_by_cohort, {cohort_id, participant_id})
        :ets.delete(index.shape_ref_participant, {shape_handle, subquery_ref})
        :ets.delete(index.shape_dep_participant, {shape_handle, dep_index})
        :ets.delete(index.participant_meta, participant_id)
        detach_empty_cohort(index, cohort_id)
        :ok

      [] ->
        :ok
    end
  end

  defp remove_edge(
         index,
         shape_id,
         node_id,
         dep_index,
         polarity,
         next_condition_id,
         branch_key,
         participant_id,
         cohort_id
       ) do
    edge_key = {node_id, cohort_id}

    case polarity do
      :positive ->
        :ets.match_delete(index.positive_edges, {edge_key, participant_id, next_condition_id})

      :negated ->
        :ets.match_delete(index.negated_edges, {edge_key, participant_id, next_condition_id})
    end

    :ets.match_delete(
      index.edges_by_participant,
      {participant_id, node_id, cohort_id, polarity, next_condition_id, branch_key}
    )

    :ets.match_delete(
      index.node_shape,
      {node_id, shape_id, dep_index, polarity, next_condition_id, branch_key, participant_id,
       cohort_id}
    )

    :ets.match_delete(
      index.shape_node,
      {shape_id, node_id, dep_index, polarity, next_condition_id, branch_key, participant_id,
       cohort_id}
    )

    :ets.match_delete(
      index.shape_dep_node,
      {{shape_id, dep_index}, node_id, polarity, next_condition_id, branch_key, participant_id,
       cohort_id}
    )

    :ets.match_delete(index.node_fallback, {node_id, {shape_id, next_condition_id}})

    if edge_set(index.positive_edges, node_id, cohort_id) == MapSet.new() and
         edge_set(index.negated_edges, node_id, cohort_id) == MapSet.new() do
      :ets.match_delete(index.cohorts_by_node, {node_id, cohort_id})
    end
  end

  defp detach_empty_cohort(index, cohort_id) do
    if :ets.lookup(index.participants_by_cohort, cohort_id) == [] do
      case :ets.lookup(index.cohort_meta, cohort_id) do
        [{^cohort_id, cohort_key, subquery_key, _state}] ->
          :ets.delete(index.cohort_by_key, cohort_key)
          :ets.match_delete(index.cohorts_by_subquery, {subquery_key, cohort_id})
          :ets.delete(index.participant_count, cohort_id)
          :ets.delete(index.cohort_meta, cohort_id)
          cleanup_cohort_base_async(index, cohort_id)

        [] ->
          :ok
      end
    end
  end

  defp cleanup_cohort_base_async(index, cohort_id) do
    _ =
      Task.start(fn ->
        :ets.match_delete(index.cohort_value, {{cohort_id, :_}, :_, :_})
        :ets.match_delete(index.exception_by_value, {{cohort_id, :_}, :_})
        :ets.match_delete(index.exception_by_participant, {:_, cohort_id, :_})
      end)

    :ok
  end

  defp nodes_for_shape(index, shape_handle) do
    index.shape_node
    |> :ets.lookup(shape_handle)
    |> Enum.map(fn {^shape_handle, node_id, dep_index, polarity, next_condition_id, branch_key,
                    participant_id, cohort_id} ->
      {node_id, dep_index, polarity, next_condition_id, branch_key, participant_id, cohort_id}
    end)
  end

  defp node_shape_entry_for_shape(index, shape_id, node_id, branch_key) do
    index
    |> nodes_for_shape(shape_id)
    |> Enum.find_value(fn
      {^node_id, dep_index, polarity, next_condition_id, ^branch_key, participant_id, cohort_id} ->
        {dep_index, polarity, next_condition_id, participant_id, cohort_id}

      _ ->
        nil
    end)
  end

  defp node_empty?(index, node_id) do
    :ets.lookup(index.node_shape, node_id) == []
  end

  defp all_node_shapes(index, node_id) do
    index.node_shape
    |> :ets.lookup(node_id)
    |> Enum.reduce(MapSet.new(), fn
      {^node_id, shape_id, _dep_index, _polarity, next_condition_id, _branch_key, _participant_id,
       _cohort_id},
      acc ->
        MapSet.put(acc, {shape_id, next_condition_id})

      _, acc ->
        acc
    end)
  end

  defp evaluate_node_lhs(index, node_id, record) do
    case :ets.lookup(index.node_meta, node_id) do
      [{^node_id, %{testexpr: testexpr}}] ->
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

  defp shape_participants_ready?(index, shape_handle) do
    participants = :ets.lookup(index.participants_by_shape, shape_handle)

    participants != [] and
      Enum.all?(participants, fn {^shape_handle, participant_id, _cohort_id, _polarity} ->
        case :ets.lookup(index.participant_meta, participant_id) do
          [
            {^participant_id, _shape_handle, _cohort_id, _subquery_ref, _dep_index, _polarity,
             :indexed}
          ] ->
            true

          _ ->
            false
        end
      end)
  end

  defp shape_ready?(index, shape_handle) do
    not fallback?(index, shape_handle)
  end

  defp polarity_for_shape_ref(index, shape_handle, subquery_ref) do
    case :ets.lookup(index.shape_ref_participant, {shape_handle, subquery_ref}) do
      [{{^shape_handle, ^subquery_ref}, participant_id, _cohort_id}] ->
        case :ets.lookup(index.participant_meta, participant_id) do
          [{^participant_id, ^shape_handle, _cohort_id, ^subquery_ref, _dep_index, polarity, _}] ->
            polarity

          [] ->
            raise ArgumentError,
                  "missing participant for shape #{inspect(shape_handle)} and ref #{inspect(subquery_ref)}"
        end

      [] ->
        raise ArgumentError,
              "missing polarity for shape #{inspect(shape_handle)} and ref #{inspect(subquery_ref)}"
    end
  end

  defp xor(left, right), do: left != right
end
