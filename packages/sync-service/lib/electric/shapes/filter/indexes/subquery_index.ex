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
  @type node_id :: {Filter.condition_id(), term()}

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
        :ets.new(:subquery_index, [:ordered_set, :public])

      stack_id ->
        :ets.new(table_name(stack_id), [:ordered_set, :public, :named_table])
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
    sid = intern_handle(table, shape_handle)

    polarities =
      plan.positions
      |> Enum.filter(fn {_pos, info} -> info.is_subquery end)
      |> Map.new(fn {_pos, info} ->
        {info.dependency_index, if(info.negated, do: :negated, else: :positive)}
      end)

    for {dep_index, polarity} <- polarities do
      :ets.insert(table, {{:polarity, sid, dep_index}, polarity})
    end

    :ets.insert(table, {{:fallback, sid}, true})

    :ok
  end

  @doc """
  Remove all exact membership metadata for a shape.
  """
  @spec unregister_shape(t(), term()) :: :ok
  def unregister_shape(table, shape_handle) do
    sid = handle_id(table, shape_handle)

    delete_by_key_prefix(table, {:membership, sid, :_, :_})
    delete_by_key_prefix(table, {:polarity, sid, :_})
    delete_by_key_prefix(table, {:shape_node, sid, :_, :_})
    delete_by_key_prefix(table, {:shape_dep_node, sid, :_, :_, :_})
    :ets.delete(table, {:fallback, sid})
    :ets.delete(table, {:handle_id, shape_handle})
    :ok
  end

  @doc """
  Register a shape on a concrete subquery filter node.
  """
  @spec add_shape(Filter.t(), Filter.condition_id(), term(), map(), [atom()]) :: :ok
  def add_shape(
        %Filter{subquery_index: table} = filter,
        condition_id,
        shape_id,
        optimisation,
        branch_key
      ) do
    node_id = {condition_id, optimisation.field}
    next_condition_id = Filter.next_condition_id(filter)

    # The interned id keys this shape's index rows; the real handle still flows
    # into WhereCondition (its `other_shapes` are returned verbatim by routing).
    sid = intern_handle(table, shape_id)

    WhereCondition.init(filter, next_condition_id)

    WhereCondition.add_shape(
      filter,
      next_condition_id,
      shape_id,
      optimisation.and_where,
      branch_key
    )

    node_int = ensure_node_meta(table, node_id, optimisation.testexpr)

    :ets.insert(
      table,
      {{:node_shape, node_id, sid, branch_key},
       {optimisation.dep_index, optimisation.polarity, next_condition_id}}
    )

    if optimisation.polarity == :negated do
      :ets.insert(table, {{:node_negated_shape, node_id, sid, next_condition_id}, true})
    end

    :ets.insert(
      table,
      {{:shape_node, sid, node_id, branch_key},
       {optimisation.dep_index, optimisation.polarity, next_condition_id}}
    )

    # Carry the node int in the value so the per-value write paths
    # (add_value/remove_value) get it without an extra node_meta lookup.
    :ets.insert(
      table,
      {{:shape_dep_node, sid, optimisation.dep_index, node_id, branch_key},
       {optimisation.polarity, next_condition_id, node_int}}
    )

    :ets.insert(table, {{:node_fallback, node_id, sid, next_condition_id}, true})
    :ok
  end

  @doc """
  Remove a shape from a concrete subquery filter node.
  """
  @spec remove_shape(Filter.t(), Filter.condition_id(), term(), map(), [atom()]) :: :deleted | :ok
  def remove_shape(
        %Filter{subquery_index: table} = filter,
        condition_id,
        shape_id,
        optimisation,
        branch_key
      ) do
    node_id = {condition_id, optimisation.field}
    sid = handle_id(table, shape_id)

    case node_shape_entry_for_shape(table, sid, node_id, branch_key) do
      nil ->
        :deleted

      {dep_index, polarity, next_condition_id} ->
        _ =
          WhereCondition.remove_shape(
            filter,
            next_condition_id,
            shape_id,
            optimisation.and_where,
            branch_key
          )

        delete_node_members(
          table,
          node_int_for(table, node_id),
          sid,
          polarity,
          next_condition_id,
          optimisation.dep_index
        )

        :ets.delete(table, {:node_shape, node_id, sid, branch_key})

        if polarity == :negated do
          :ets.delete(table, {:node_negated_shape, node_id, sid, next_condition_id})
        end

        :ets.delete(table, {:node_fallback, node_id, sid, next_condition_id})
        :ets.delete(table, {:shape_node, sid, node_id, branch_key})
        :ets.delete(table, {:shape_dep_node, sid, dep_index, node_id, branch_key})

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
    sid = handle_id(table, shape_handle)
    :ets.delete(table, {:fallback, sid})

    for {node_id, _dep_index, _polarity, _next_condition_id, _branch_key} <-
          nodes_for_shape(table, sid) do
      delete_by_key_prefix(table, {:node_fallback, node_id, sid, :_})
    end

    :ok
  end

  @doc """
  Add a value to both the node-local routing index and the exact membership set.
  """
  @spec add_value(t(), term(), [String.t()], non_neg_integer(), term()) :: :ok
  def add_value(table, shape_handle, _subquery_ref, dep_index, value) do
    sid = intern_handle(table, shape_handle)

    for {node_int, polarity, next_condition_id, _branch_key} <-
          nodes_for_shape_dependency(table, sid, dep_index) do
      tag = if polarity == :positive, do: :node_positive_member, else: :node_negated_member
      :ets.insert(table, {{tag, node_int, value, sid, next_condition_id}, true})
    end

    :ets.insert(table, {{:membership, sid, dep_index, value}, true})
    :ok
  end

  @doc """
  Remove a value from both the node-local routing index and the exact membership set.
  """
  @spec remove_value(t(), term(), [String.t()], non_neg_integer(), term()) :: :ok
  def remove_value(table, shape_handle, _subquery_ref, dep_index, value) do
    sid = handle_id(table, shape_handle)

    for {node_int, polarity, next_condition_id, _branch_key} <-
          nodes_for_shape_dependency(table, sid, dep_index) do
      tag = if polarity == :positive, do: :node_positive_member, else: :node_negated_member
      :ets.delete(table, {tag, node_int, value, sid, next_condition_id})
    end

    :ets.delete(table, {:membership, sid, dep_index, value})
    :ok
  end

  @doc """
  Get affected shape handles for a specific subquery node.
  """
  @spec affected_shapes(Filter.t(), Filter.condition_id(), term(), map()) :: MapSet.t()
  def affected_shapes(%Filter{subquery_index: table} = filter, condition_id, field_key, record) do
    node_id = {condition_id, field_key}

    candidates =
      case evaluate_node_lhs(table, node_id, record) do
        {:ok, typed_value, node_int} ->
          positive = members_for(table, :node_positive_member, node_int, typed_value)

          negated =
            MapSet.difference(
              negated_shapes_for(table, node_id),
              members_for(table, :node_negated_member, node_int, typed_value)
            )

          fallback = fallback_for(table, node_id)

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
  @spec all_shape_ids(Filter.t(), Filter.condition_id(), term()) :: MapSet.t()
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
    sid = handle_id(table, shape_handle)
    :ets.member(table, {:membership, sid, dep_index_for_ref(subquery_ref), typed_value})
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
    :ets.member(table, {:fallback, handle_id(table, shape_handle)})
  end

  @doc """
  Check if a shape has any registered subquery nodes.
  """
  @spec has_positions?(t(), term()) :: boolean()
  def has_positions?(table, shape_handle) do
    nodes_for_shape(table, handle_id(table, shape_handle)) != []
  end

  @doc """
  Return the registered node ids for a shape.
  """
  @spec positions_for_shape(t(), term()) :: [node_id()]
  def positions_for_shape(table, shape_handle) do
    table
    |> nodes_for_shape(handle_id(table, shape_handle))
    |> Enum.map(fn {node_id, _dep_index, _polarity, _next_condition_id, _branch_key} ->
      node_id
    end)
  end

  # Each node (`{condition_id, field}`) is interned to a small integer used to key
  # the per-value node-member rows, instead of repeating the `{condition_id,
  # field}` tuple (with its boxed field binary) in every one of them. The mapping
  # lives in the node_meta row — already read on the routing path — so resolving
  # a node to its int adds no extra lookup. Nodes are only ever created here, by
  # the single filter-owning process, so a plain lookup-or-create is race-free.
  defp ensure_node_meta(table, node_id, testexpr) do
    case :ets.lookup(table, {:node_meta, node_id}) do
      [{_, %{node_int: node_int}}] ->
        node_int

      [] ->
        node_int = :erlang.unique_integer([:positive, :monotonic])
        :ets.insert(table, {{:node_meta, node_id}, %{testexpr: testexpr, node_int: node_int}})
        node_int
    end
  end

  defp node_int_for(table, node_id) do
    case :ets.lookup(table, {:node_meta, node_id}) do
      [{_, %{node_int: node_int}}] -> node_int
      [] -> :undefined
    end
  end

  # Range-bounded delete of every row whose key matches `key_pattern` (a tuple with a
  # bound prefix and `:_` wildcards in trailing positions). On an :ordered_set this is
  # O(log n + matched), never a full scan.
  defp delete_by_key_prefix(table, key_pattern) do
    :ets.select_delete(table, [{{key_pattern, :_}, [], [true]}])
  end

  # Delete this shape's node-local member rows for this node by enumerating the shape's
  # own values (scoped to the node's dependency index) from its membership rows and
  # point-deleting each. O(V_node · log n); touches only this shape's rows.
  #
  # INVARIANT (the safety of this approach rests on it): a node-member row is always a
  # subset of the shape's membership values — `add_value/5` and `remove_value/5` write
  # and remove the membership row alongside the node-member rows — so enumerating
  # membership finds every node-member row to delete. This requires membership rows to
  # outlive node removal, and to not be mutated concurrently:
  #   * Ordering: `Filter.remove_shape/2` runs this (via `remove_shape/5`) BEFORE
  #     `unregister_shape/2` deletes the `:membership` rows, so they are still present.
  #   * No concurrent writer: the shape's consumer is the only process that writes
  #     membership/node-member rows, and it is stopped synchronously before
  #     `Filter.remove_shape/2` runs (`ShapeCleaner.remove_shape_immediate/3`), so no
  #     `add_value`/`remove_value` can race this.
  # The "no orphan rows" test guards exactly this path. Reordering cleanup to remove
  # from the filter before stopping the consumer would reintroduce orphaned node-member
  # rows.
  defp delete_node_members(table, node_int, shape_id, polarity, next_condition_id, dep_index) do
    tag =
      case polarity do
        :positive -> :node_positive_member
        :negated -> :node_negated_member
      end

    values =
      :ets.select(table, [
        {{{:membership, shape_id, dep_index, :"$1"}, :_}, [], [:"$1"]}
      ])

    for value <- values do
      :ets.delete(table, {tag, node_int, value, shape_id, next_condition_id})
    end

    :ok
  end

  defp members_for(table, tag, node_id, value) do
    :ets.select(table, [
      {{{tag, node_id, value, :"$1", :"$2"}, :_}, [], [{{:"$1", :"$2"}}]}
    ])
    |> MapSet.new()
  end

  defp negated_shapes_for(table, node_id) do
    :ets.select(table, [
      {{{:node_negated_shape, node_id, :"$1", :"$2"}, :_}, [], [{{:"$1", :"$2"}}]}
    ])
    |> MapSet.new()
  end

  defp fallback_for(table, node_id) do
    :ets.select(table, [
      {{{:node_fallback, node_id, :"$1", :"$2"}, :_}, [], [{{:"$1", :"$2"}}]}
    ])
    |> MapSet.new()
  end

  defp all_node_shapes(table, node_id) do
    :ets.select(table, [
      {{{:node_shape, node_id, :"$1", :_}, {:_, :_, :"$2"}}, [], [{{:"$1", :"$2"}}]}
    ])
    |> MapSet.new()
  end

  defp nodes_for_shape(table, shape_handle) do
    :ets.select(table, [
      {{{:shape_node, shape_handle, :"$1", :"$2"}, {:"$3", :"$4", :"$5"}}, [],
       [{{:"$1", :"$3", :"$4", :"$5", :"$2"}}]}
    ])
  end

  # Returns `{node_int, polarity, next_condition_id, branch_key}` — the node int
  # (pulled from the value) keys the per-value node-member rows, replacing the
  # `{condition_id, field}` tuple that was otherwise repeated in each of them.
  defp nodes_for_shape_dependency(table, shape_handle, dep_index) do
    :ets.select(table, [
      {{{:shape_dep_node, shape_handle, dep_index, :_, :"$2"}, {:"$3", :"$4", :"$5"}}, [],
       [{{:"$5", :"$3", :"$4", :"$2"}}]}
    ])
  end

  defp node_shape_entry_for_shape(table, shape_id, node_id, branch_key) do
    case :ets.lookup(table, {:shape_node, shape_id, node_id, branch_key}) do
      [{_, {dep_index, polarity, next_condition_id}}] -> {dep_index, polarity, next_condition_id}
      [] -> nil
    end
  end

  defp node_empty?(table, node_id) do
    case :ets.select(table, [{{{:node_shape, node_id, :_, :_}, :_}, [], [true]}], 1) do
      :"$end_of_table" -> true
      _ -> false
    end
  end

  defp evaluate_node_lhs(table, node_id, record) do
    case :ets.lookup(table, {:node_meta, node_id}) do
      [{_, %{testexpr: testexpr, node_int: node_int}}] ->
        expr = Expr.wrap_parser_part(testexpr)

        case Runner.record_to_ref_values(expr.used_refs, record) do
          {:ok, ref_values} ->
            case Runner.execute(expr, ref_values) do
              {:ok, value} -> {:ok, value, node_int}
              _ -> :error
            end

          _ ->
            :error
        end

      [] ->
        :error
    end
  end

  defp shape_ready?(table, shape_handle) do
    not fallback?(table, shape_handle)
  end

  defp polarity_for_shape_ref(table, shape_handle, subquery_ref) do
    sid = handle_id(table, shape_handle)

    case :ets.lookup(table, {:polarity, sid, dep_index_for_ref(subquery_ref)}) do
      [{_, polarity}] ->
        polarity

      [] ->
        raise ArgumentError,
              "missing polarity for shape #{inspect(shape_handle)} and ref #{inspect(subquery_ref)}"
    end
  end

  # Membership and polarity rows are keyed by the dependency index (a small
  # integer immediate) rather than the canonical subquery ref — a
  # `["$sublink", "<dep_index>"]` list of two boxed binaries that was otherwise
  # repeated in every per-value membership row. The ref encodes its dependency
  # index in the last element, so the read paths that only have the ref recover
  # it cheaply with no extra mapping table.
  defp dep_index_for_ref([_prefix, dep_index]), do: String.to_integer(dep_index)

  # Shape handles are ~25-byte binaries (built by Shape.generate_id as
  # "<hash>-<microseconds>") that occupy 64 bytes in each ETS row that stores one,
  # and were copied into every index row that mentions a shape — and the per-value
  # membership and node-member rows mention one each. We intern each handle to a
  # small integer (an immediate, stored inline in the key tuple for ~0 bytes) and
  # store the handle string itself just once, in a `{:handle_id, handle}` row.
  #
  # Forward-only: the interned id is only ever an identity/dedup key inside the
  # index. Routing reads return shape ids from `WhereCondition`, not from these
  # rows (the node-row shape id is discarded), and every handle-keyed lookup
  # takes the handle as input — so we never need to map an id back to a handle.
  #
  # Ids come from `:erlang.unique_integer/1` rather than a stored counter so
  # there is no per-table bookkeeping row to persist (cleanup restores the table
  # exactly) and interning works from the table alone. `insert_new` makes it
  # idempotent and race-safe: a shape's consumer and the filter owner may both
  # intern the same handle, and whichever loses the insert adopts the winner's id
  # (a discarded unique_integer is harmless — ids need only be unique).
  defp intern_handle(table, handle) do
    case :ets.lookup(table, {:handle_id, handle}) do
      [{_, id}] ->
        id

      [] ->
        id = :erlang.unique_integer([:positive, :monotonic])

        if :ets.insert_new(table, {{:handle_id, handle}, id}) do
          id
        else
          [{_, existing}] = :ets.lookup(table, {:handle_id, handle})
          existing
        end
    end
  end

  # Lookup-only counterpart for read/cleanup paths. Returns `:undefined` when the
  # handle was never interned; since writes always intern a real positive integer
  # first, `:undefined` can never match a stored row, so reads for an unknown
  # handle correctly miss (and never collide with another unknown handle's data).
  defp handle_id(table, handle) do
    case :ets.lookup(table, {:handle_id, handle}) do
      [{_, id}] -> id
      [] -> :undefined
    end
  end
end
