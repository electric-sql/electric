# SubqueryIndex latency benchmarks.
#
# Run from packages/sync-service:
#
#     mix run --no-start bench/subquery_index_bench.exs
#
# `--no-start` skips the sync-service application (no replication client,
# admission control, etc.) which keeps the bench output focused.
#
# Each benchmark group sweeps a single size dimension (values, history
# length, children, participants) so the Benchee output makes the scaling
# behaviour directly visible. The RFC at docs/rfcs/subquery-index.md states
# expected complexity for every operation here — see the comment above each
# `Benchee.run/2` call for the expected curve.
#
# The "add_shape: new subquery → triggers materializer" case from the task
# brief is intentionally not benchmarked here. That cost is paid in the
# materializer's initial population, which lives outside SubqueryIndex's
# responsibility and which the RFC explicitly acknowledges cannot be O(1).

alias Electric.Replication.Eval.Parser.{Func, Ref}
alias Electric.Shapes.DnfPlan
alias Electric.Shapes.Filter
alias Electric.Shapes.Filter.Indexes.SubqueryIndex
alias Electric.Shapes.Filter.Indexes.SubqueryIndex.MultiTimeView
alias Electric.Shapes.Filter.Indexes.SubqueryIndex.ProgressMonitor
alias Electric.Shapes.Filter.WhereCondition

defmodule Bench.Pop do
  @moduledoc false

  @field "par_id"
  @subquery_ref ["$sublink", "0"]

  def field, do: @field
  def subquery_ref, do: @subquery_ref

  def make_plan(opts \\ []) do
    polarity = Keyword.get(opts, :polarity, :positive)
    dep_index = Keyword.get(opts, :dep_index, 0)
    subquery_ref = Keyword.get(opts, :subquery_ref, @subquery_ref)
    field = Keyword.get(opts, :field, @field)

    testexpr = %Ref{path: [field], type: :int8}
    ref = %Ref{path: subquery_ref, type: {:array, :int8}}

    ast = %Func{
      name: "sublink_membership_check",
      args: [testexpr, ref],
      type: :bool
    }

    %DnfPlan{
      disjuncts: [],
      disjuncts_positions: [],
      position_count: 1,
      positions: %{
        0 => %{
          ast: ast,
          sql: "fake",
          is_subquery: true,
          negated: polarity == :negated,
          dependency_index: dep_index,
          subquery_ref: subquery_ref,
          tag_columns: [field]
        }
      },
      dependency_positions: %{dep_index => [0]},
      dependency_disjuncts: %{},
      dependency_polarities: %{dep_index => polarity}
    }
  end

  def subquery_optimisation(opts \\ []) do
    field = Keyword.get(opts, :field, @field)

    %{
      operation: "subquery",
      field: field,
      testexpr: %Ref{path: [field], type: :int8},
      subquery_ref: Keyword.get(opts, :subquery_ref, @subquery_ref),
      dep_index: Keyword.get(opts, :dep_index, 0),
      polarity: Keyword.get(opts, :polarity, :positive),
      and_where: Keyword.get(opts, :and_where)
    }
  end

  @doc """
  Build a fresh Filter with `subquery_count` subqueries, `values_per_subquery`
  values each, attached at one shared condition_id. Returns
  `{filter, condition_id, dep_handles, shape_ids}`.
  """
  def build(opts) do
    subquery_count = Keyword.get(opts, :subquery_count, 1)
    values_per_subquery = Keyword.get(opts, :values_per_subquery, 1)
    shapes_per_subquery = Keyword.get(opts, :shapes_per_subquery, 1)
    polarity = Keyword.get(opts, :polarity, :positive)

    filter = Filter.new()
    condition_id = make_ref()
    WhereCondition.init(filter, condition_id)
    index = filter.subquery_index

    dep_handles =
      for i <- 0..(subquery_count - 1) do
        dep = "dep_#{i}"
        values = for v <- 0..(values_per_subquery - 1), do: i * 10_000_000 + v
        MultiTimeView.init_subquery(index.multi_time_view, dep, values)
        MultiTimeView.mark_ready(index.multi_time_view, dep)
        dep
      end

    shape_ids =
      for i <- 0..(subquery_count - 1),
          dep = Enum.at(dep_handles, i),
          j <- 0..(shapes_per_subquery - 1) do
        shape_id = "shape_#{i}_#{j}"

        SubqueryIndex.register_shape(
          index,
          shape_id,
          make_plan(polarity: polarity),
          [dep]
        )

        SubqueryIndex.add_shape(
          filter,
          condition_id,
          shape_id,
          subquery_optimisation(polarity: polarity),
          []
        )

        SubqueryIndex.mark_ready(index, shape_id)
        shape_id
      end

    {filter, condition_id, dep_handles, shape_ids}
  end

  @doc """
  Build a filter where one subquery has `child_count` positive children, each
  in a distinct group (distinct condition_id), with one shape per child. Used
  for benchmarks that sweep "positive_children_for_subquery".
  """
  def build_n_positive_children(child_count, opts \\ []) do
    values = Keyword.get(opts, :values, [1, 2])
    polarity = Keyword.get(opts, :polarity, :positive)
    filter = Filter.new()
    index = filter.subquery_index
    dep = "dep_shared"

    MultiTimeView.init_subquery(index.multi_time_view, dep, values)
    MultiTimeView.mark_ready(index.multi_time_view, dep)

    condition_ids =
      for i <- 0..(child_count - 1) do
        cid = make_ref()
        WhereCondition.init(filter, cid)
        shape_id = "child_#{i}"

        SubqueryIndex.register_shape(
          index,
          shape_id,
          make_plan(polarity: polarity),
          [dep]
        )

        SubqueryIndex.add_shape(
          filter,
          cid,
          shape_id,
          subquery_optimisation(polarity: polarity),
          []
        )

        SubqueryIndex.mark_ready(index, shape_id)
        cid
      end

    {filter, condition_ids, dep}
  end

  @doc """
  Build a filter where one *negated* group has `child_count` children, each
  on a distinct subquery (distinct dep_handle). Used to sweep
  "negated_children_in_group".
  """
  def build_n_negated_children_same_group(child_count) do
    filter = Filter.new()
    condition_id = make_ref()
    WhereCondition.init(filter, condition_id)
    index = filter.subquery_index

    deps =
      for i <- 0..(child_count - 1) do
        dep = "dep_neg_#{i}"
        # Each subquery contains one member at all times (so the negated
        # routing path still has to consult MTV.member_at_all_times? on
        # the query value; we use a different query value below).
        MultiTimeView.init_subquery(index.multi_time_view, dep, [42])
        MultiTimeView.mark_ready(index.multi_time_view, dep)

        shape_id = "neg_#{i}"

        SubqueryIndex.register_shape(
          index,
          shape_id,
          make_plan(polarity: :negated, dep_index: 0),
          [dep]
        )

        SubqueryIndex.add_shape(
          filter,
          condition_id,
          shape_id,
          subquery_optimisation(polarity: :negated),
          []
        )

        SubqueryIndex.mark_ready(index, shape_id)
        dep
      end

    {filter, condition_id, deps}
  end

  @doc """
  Build a `History.t/0` of length `n` toggling per logical time. Returns
  the produced history list and the final logical time.
  """
  def build_history(view, dep, value, n) do
    for t <- 1..n do
      if rem(t, 2) == 0 do
        MultiTimeView.mark_out(view, dep, value, t)
      else
        MultiTimeView.mark_in(view, dep, value, t)
      end
    end

    {:ok, n}
  end
end

# ============================================================================
# Routing hot path
# ============================================================================

IO.puts("\n\n# ========== Routing hot path ==========\n")

# affected_shapes/4 — positive group
# Sweep: values_in_subquery. Expected: ~O(1) per call (value-keyed lookup).
Benchee.run(
  %{
    "affected_shapes (positive)" => fn {filter, condition_id, _deps, _shapes} ->
      SubqueryIndex.affected_shapes(filter, condition_id, Bench.Pop.field(), %{
        "par_id" => "42"
      })
    end
  },
  inputs:
    for n <- [10, 100, 1_000, 10_000], into: %{} do
      {"#{n} values", n}
    end,
  before_scenario: fn n ->
    Bench.Pop.build(values_per_subquery: n, subquery_count: 1, shapes_per_subquery: 1)
  end,
  time: 2,
  warmup: 1,
  # Benchee measures memory in a separate process; Filter's private ETS
  # tables can't be read from there. Memory cost is covered by the
  # dedicated script at scripts/subquery_logical_time_memory.exs.
  memory_time: 0
)

# affected_shapes/4 — negated group
# Sweep: negated_children_in_group. Expected: O(N) (RFC explicitly accepts).
Benchee.run(
  %{
    "affected_shapes (negated)" => fn {filter, condition_id, _deps} ->
      SubqueryIndex.affected_shapes(filter, condition_id, Bench.Pop.field(), %{
        "par_id" => "999"
      })
    end
  },
  inputs:
    for n <- [10, 100, 1_000, 10_000], into: %{} do
      {"#{n} negated children", n}
    end,
  before_scenario: &Bench.Pop.build_n_negated_children_same_group/1,
  time: 2,
  warmup: 1,
  # Benchee measures memory in a separate process; Filter's private ETS
  # tables can't be read from there. Memory cost is covered by the
  # dedicated script at scripts/subquery_logical_time_memory.exs.
  memory_time: 0
)

# MultiTimeView.member?/4
# Sweep: history_length_for_value. Expected: O(history) — list walk.
Benchee.run(
  %{
    "MultiTimeView.member?" => fn {view, dep, value, t} ->
      MultiTimeView.member?(view, dep, value, t)
    end
  },
  inputs:
    for n <- [1, 10, 100, 1_000], into: %{} do
      {"history length #{n}", n}
    end,
  before_scenario: fn n ->
    view = MultiTimeView.new()
    dep = "dep"
    MultiTimeView.init_subquery(view, dep, [])
    Bench.Pop.build_history(view, dep, 42, n)
    # Ask at the middle of the history so we don't always short-circuit at
    # the head.
    {view, dep, 42, div(n, 2)}
  end,
  time: 2,
  warmup: 1,
  # Benchee measures memory in a separate process; Filter's private ETS
  # tables can't be read from there. Memory cost is covered by the
  # dedicated script at scripts/subquery_logical_time_memory.exs.
  memory_time: 0
)

# ============================================================================
# Subquery lifecycle
# ============================================================================

IO.puts("\n\n# ========== Subquery lifecycle ==========\n")

# MultiTimeView.mark_ready/2 — expected O(1).
Benchee.run(
  %{
    "MultiTimeView.mark_ready" => fn {view, dep} ->
      MultiTimeView.mark_ready(view, dep)
    end
  },
  inputs: %{"single" => :only},
  before_each: fn :only ->
    view = MultiTimeView.new()
    dep = "dep_#{System.unique_integer([:positive])}"
    MultiTimeView.init_subquery(view, dep, [1])
    {view, dep}
  end,
  time: 2,
  warmup: 1,
  # Benchee measures memory in a separate process; Filter's private ETS
  # tables can't be read from there. Memory cost is covered by the
  # dedicated script at scripts/subquery_logical_time_memory.exs.
  memory_time: 0
)

# SubqueryIndex.remove_subquery/2 — sweep values × 1 child.
# Expected: O(values + children) for *this* subquery, no scan of unrelated.
Benchee.run(
  %{
    "remove_subquery" => fn {index, dep} ->
      SubqueryIndex.remove_subquery(index, dep)
    end
  },
  inputs:
    for n <- [10, 100, 1_000, 10_000], into: %{} do
      {"#{n} values", n}
    end,
  before_each: fn n ->
    {filter, _cid, [dep], _shapes} =
      Bench.Pop.build(values_per_subquery: n, subquery_count: 1, shapes_per_subquery: 1)

    {filter.subquery_index, dep}
  end,
  time: 2,
  warmup: 1,
  # Benchee measures memory in a separate process; Filter's private ETS
  # tables can't be read from there. Memory cost is covered by the
  # dedicated script at scripts/subquery_logical_time_memory.exs.
  memory_time: 0
)

# ============================================================================
# Shape lifecycle
# ============================================================================

IO.puts("\n\n# ========== Shape lifecycle ==========\n")

# add_shape — existing child in existing group (additional shape sharing).
# Expected: O(1) per call.
Benchee.run(
  %{
    "add_shape (existing child)" => fn {filter, condition_id, dep, n} ->
      shape_id = "extra_#{n}"

      SubqueryIndex.register_shape(
        filter.subquery_index,
        shape_id,
        Bench.Pop.make_plan(),
        [dep]
      )

      SubqueryIndex.add_shape(
        filter,
        condition_id,
        shape_id,
        Bench.Pop.subquery_optimisation(),
        []
      )
    end
  },
  inputs:
    for n <- [10, 100, 1_000, 10_000], into: %{} do
      {"#{n} values in subquery", n}
    end,
  before_each: fn n ->
    {filter, condition_id, [dep], _shapes} =
      Bench.Pop.build(values_per_subquery: n, subquery_count: 1, shapes_per_subquery: 1)

    {filter, condition_id, dep, n}
  end,
  time: 2,
  warmup: 1,
  # Benchee measures memory in a separate process; Filter's private ETS
  # tables can't be read from there. Memory cost is covered by the
  # dedicated script at scripts/subquery_logical_time_memory.exs.
  memory_time: 0
)

# add_shape — new child, MTV ready: must seed positive routing from MTV.
# Expected: O(values_in_subquery) one-off.
Benchee.run(
  %{
    "add_shape (new child, MTV ready, seeds routing)" => fn {filter, dep, n} ->
      condition_id = make_ref()
      WhereCondition.init(filter, condition_id)

      shape_id = "first_#{n}"

      SubqueryIndex.register_shape(
        filter.subquery_index,
        shape_id,
        Bench.Pop.make_plan(),
        [dep]
      )

      SubqueryIndex.add_shape(
        filter,
        condition_id,
        shape_id,
        Bench.Pop.subquery_optimisation(),
        []
      )
    end
  },
  inputs:
    for n <- [10, 100, 1_000, 10_000], into: %{} do
      {"#{n} values in subquery", n}
    end,
  before_each: fn n ->
    filter = Filter.new()
    index = filter.subquery_index
    dep = "dep"
    values = for v <- 0..(n - 1), do: v
    MultiTimeView.init_subquery(index.multi_time_view, dep, values)
    MultiTimeView.mark_ready(index.multi_time_view, dep)
    {filter, dep, n}
  end,
  time: 2,
  warmup: 1,
  # Benchee measures memory in a separate process; Filter's private ETS
  # tables can't be read from there. Memory cost is covered by the
  # dedicated script at scripts/subquery_logical_time_memory.exs.
  memory_time: 0
)

# add_shape — new child, MTV NOT ready (fallback path, no seeding).
# Expected: O(1) — no value walk.
Benchee.run(
  %{
    "add_shape (new child, MTV not ready, fallback)" => fn {filter, dep, n} ->
      condition_id = make_ref()
      WhereCondition.init(filter, condition_id)

      shape_id = "fb_#{n}"

      SubqueryIndex.register_shape(
        filter.subquery_index,
        shape_id,
        Bench.Pop.make_plan(),
        [dep]
      )

      SubqueryIndex.add_shape(
        filter,
        condition_id,
        shape_id,
        Bench.Pop.subquery_optimisation(),
        []
      )
    end
  },
  inputs:
    for n <- [10, 100, 1_000, 10_000], into: %{} do
      {"#{n} values in subquery (no MTV current_time)", n}
    end,
  before_each: fn n ->
    filter = Filter.new()
    dep = "dep"
    # Deliberately do NOT call init_subquery — current_time(view, dep) == nil
    # forces the fallback path in seed_child_routing.
    _ = n
    {filter, dep, n}
  end,
  time: 2,
  warmup: 1,
  # Benchee measures memory in a separate process; Filter's private ETS
  # tables can't be read from there. Memory cost is covered by the
  # dedicated script at scripts/subquery_logical_time_memory.exs.
  memory_time: 0
)

# remove_shape — other shapes remain on the child.
# Expected: O(participants_for_shape) — does NOT walk subquery values.
Benchee.run(
  %{
    "remove_shape (other shapes remain)" => fn {filter, condition_id, shape_to_remove} ->
      SubqueryIndex.remove_shape(
        filter,
        condition_id,
        shape_to_remove,
        Bench.Pop.subquery_optimisation(),
        []
      )
    end
  },
  inputs:
    for n <- [10, 100, 1_000, 10_000], into: %{} do
      {"#{n} values in subquery", n}
    end,
  before_each: fn n ->
    # Two shapes on the same child, so removing one keeps the child alive.
    {filter, condition_id, _deps, [s1, _s2]} =
      Bench.Pop.build(values_per_subquery: n, subquery_count: 1, shapes_per_subquery: 2)

    {filter, condition_id, s1}
  end,
  time: 2,
  warmup: 1,
  # Benchee measures memory in a separate process; Filter's private ETS
  # tables can't be read from there. Memory cost is covered by the
  # dedicated script at scripts/subquery_logical_time_memory.exs.
  memory_time: 0
)

# remove_shape — last shape on the child (collapses child, drops routing).
# Expected: O(values_in_subquery) — must remove every positive route row.
Benchee.run(
  %{
    "remove_shape (last on child, drops routes)" => fn {filter, condition_id, shape_to_remove} ->
      SubqueryIndex.remove_shape(
        filter,
        condition_id,
        shape_to_remove,
        Bench.Pop.subquery_optimisation(),
        []
      )
    end
  },
  inputs:
    for n <- [10, 100, 1_000, 10_000], into: %{} do
      {"#{n} values in subquery", n}
    end,
  before_each: fn n ->
    {filter, condition_id, _deps, [s1]} =
      Bench.Pop.build(values_per_subquery: n, subquery_count: 1, shapes_per_subquery: 1)

    {filter, condition_id, s1}
  end,
  time: 2,
  warmup: 1,
  # Benchee measures memory in a separate process; Filter's private ETS
  # tables can't be read from there. Memory cost is covered by the
  # dedicated script at scripts/subquery_logical_time_memory.exs.
  memory_time: 0
)

# ============================================================================
# Value changes (materializer-driven)
# ============================================================================

IO.puts("\n\n# ========== Value changes ==========\n")

# MultiTimeView.mark_in/4 — first time vs extending history.
Benchee.run(
  %{
    "MultiTimeView.mark_in (extend existing history)" => fn {view, dep, value, next_t} ->
      MultiTimeView.mark_in(view, dep, value, next_t)
    end
  },
  inputs:
    for n <- [1, 10, 100, 1_000], into: %{} do
      {"history length #{n}", n}
    end,
  before_each: fn n ->
    view = MultiTimeView.new()
    dep = "dep_#{System.unique_integer([:positive])}"
    MultiTimeView.init_subquery(view, dep, [])
    Bench.Pop.build_history(view, dep, 42, n)
    # Next history toggle. If n is odd, value is currently :in, so the next
    # mark_in is a no-op; bias to even so mark_in actually appends.
    next_t = n + if(rem(n, 2) == 0, do: 1, else: 2)
    {view, dep, 42, next_t}
  end,
  time: 2,
  warmup: 1,
  # Benchee measures memory in a separate process; Filter's private ETS
  # tables can't be read from there. Memory cost is covered by the
  # dedicated script at scripts/subquery_logical_time_memory.exs.
  memory_time: 0
)

Benchee.run(
  %{
    "MultiTimeView.mark_out (extend existing history)" => fn {view, dep, value, next_t} ->
      MultiTimeView.mark_out(view, dep, value, next_t)
    end
  },
  inputs:
    for n <- [1, 10, 100, 1_000], into: %{} do
      {"history length #{n}", n}
    end,
  before_each: fn n ->
    view = MultiTimeView.new()
    dep = "dep_#{System.unique_integer([:positive])}"
    MultiTimeView.init_subquery(view, dep, [])
    Bench.Pop.build_history(view, dep, 42, n)
    next_t = n + if(rem(n, 2) == 1, do: 1, else: 2)
    {view, dep, 42, next_t}
  end,
  time: 2,
  warmup: 1,
  # Benchee measures memory in a separate process; Filter's private ETS
  # tables can't be read from there. Memory cost is covered by the
  # dedicated script at scripts/subquery_logical_time_memory.exs.
  memory_time: 0
)

# add_positive_route / remove_positive_route — sweep positive_children_for_subquery.
# Expected: O(positive_children).
Benchee.run(
  %{
    "add_positive_route" => fn {filter, dep, value} ->
      SubqueryIndex.add_positive_route(filter.subquery_index, dep, value)
    end
  },
  inputs:
    for n <- [1, 10, 100, 1_000], into: %{} do
      {"#{n} positive children", n}
    end,
  before_each: fn n ->
    {filter, _cids, dep} = Bench.Pop.build_n_positive_children(n, values: [])
    # Pick a fresh value each iteration to avoid no-op writes when the bag
    # already contains the row.
    value = System.unique_integer([:positive])
    {filter, dep, value}
  end,
  time: 2,
  warmup: 1,
  # Benchee measures memory in a separate process; Filter's private ETS
  # tables can't be read from there. Memory cost is covered by the
  # dedicated script at scripts/subquery_logical_time_memory.exs.
  memory_time: 0
)

Benchee.run(
  %{
    "remove_positive_route" => fn {filter, dep, value} ->
      SubqueryIndex.remove_positive_route(filter.subquery_index, dep, value)
    end
  },
  inputs:
    for n <- [1, 10, 100, 1_000], into: %{} do
      {"#{n} positive children", n}
    end,
  before_each: fn n ->
    {filter, _cids, dep} = Bench.Pop.build_n_positive_children(n, values: [])
    value = System.unique_integer([:positive])
    # Seed the route on every child first, so remove has actual work to do.
    SubqueryIndex.add_positive_route(filter.subquery_index, dep, value)
    {filter, dep, value}
  end,
  time: 2,
  warmup: 1,
  # Benchee measures memory in a separate process; Filter's private ETS
  # tables can't be read from there. Memory cost is covered by the
  # dedicated script at scripts/subquery_logical_time_memory.exs.
  memory_time: 0
)

# ============================================================================
# Progress / compaction
# ============================================================================

IO.puts("\n\n# ========== Progress / compaction ==========\n")

stack_for_pm = "bench-stack-#{System.unique_integer([:positive])}"
{:ok, pm_pid} = ProgressMonitor.start_link(stack_id: stack_for_pm)

# notify_processed_up_to/3 — expected O(1) when no consumer change makes
# the minimum recompute walk many rows. Use a single consumer for one
# subquery; only the consumer's own row is touched.
Benchee.run(
  %{
    "ProgressMonitor.notify_processed_up_to" => fn {dep, shape_handle, t} ->
      :ok = ProgressMonitor.notify_processed_up_to(stack_for_pm, t, dep, shape_handle)
    end
  },
  inputs: %{"single consumer" => :only},
  before_each: fn :only ->
    dep = "dep_#{System.unique_integer([:positive])}"
    shape_handle = "shape_#{System.unique_integer([:positive])}"
    :ok = ProgressMonitor.register_consumer(stack_for_pm, dep, shape_handle, self(), 0)
    t = System.unique_integer([:positive])
    {dep, shape_handle, t}
  end,
  time: 2,
  warmup: 1,
  # Benchee measures memory in a separate process; Filter's private ETS
  # tables can't be read from there. Memory cost is covered by the
  # dedicated script at scripts/subquery_logical_time_memory.exs.
  memory_time: 0
)

# Compactor pass — sweep "values touched" via dirty histories that have to
# compact. Each iteration sets a min_required_time past the toggle and
# measures `MultiTimeView.set_min_required_time/3` plus the route cleanup
# loop in `Compactor.compact_subquery/4` directly, since the GenServer tick
# is just a wrapper around those.
Benchee.run(
  %{
    "Compactor pass (set_min_required_time + route cleanup)" =>
      fn {filter, dep, min_time} ->
        removed = MultiTimeView.set_min_required_time(filter.subquery_index.multi_time_view, dep, min_time)

        for value <- removed do
          SubqueryIndex.remove_positive_route(filter.subquery_index, dep, value)
        end
      end
  },
  inputs:
    for n <- [10, 100, 1_000, 10_000], into: %{} do
      {"#{n} dirty values", n}
    end,
  before_each: fn n ->
    {filter, _cid, [dep], _shapes} =
      Bench.Pop.build(values_per_subquery: n, subquery_count: 1, shapes_per_subquery: 1)

    # Mark every value out at time 1, so a min_time of 2 compacts every
    # history to empty and triggers the full deletion + route cleanup path.
    for v <- 0..(n - 1) do
      MultiTimeView.mark_out(filter.subquery_index.multi_time_view, dep, v, 1)
    end

    {filter, dep, 2}
  end,
  time: 2,
  warmup: 1,
  # Benchee measures memory in a separate process; Filter's private ETS
  # tables can't be read from there. Memory cost is covered by the
  # dedicated script at scripts/subquery_logical_time_memory.exs.
  memory_time: 0
)

# Dead-consumer release: a consumer monitored by ProgressMonitor dies while
# it had pinned times on N subqueries. The DOWN handler must process each
# of those subqueries.
Benchee.run(
  %{
    "ProgressMonitor consumer DOWN release" => fn {pid, _deps} ->
      ref = Process.monitor(pid)
      send(pid, :stop)

      receive do
        {:DOWN, ^ref, :process, ^pid, _} -> :ok
      after
        1_000 -> raise "timeout waiting for consumer DOWN"
      end
    end
  },
  inputs:
    for n <- [1, 10, 100, 1_000], into: %{} do
      {"#{n} pinned subqueries", n}
    end,
  before_each: fn n ->
    {consumer_pid, _ref} =
      spawn_monitor(fn ->
        receive do
          :stop -> :ok
        end
      end)

    deps =
      for i <- 0..(n - 1) do
        dep = "dep_down_#{System.unique_integer([:positive])}_#{i}"
        :ok = ProgressMonitor.register_consumer(stack_for_pm, dep, "shape", consumer_pid, 0)
        dep
      end

    {consumer_pid, deps}
  end,
  time: 2,
  warmup: 1,
  # Benchee measures memory in a separate process; Filter's private ETS
  # tables can't be read from there. Memory cost is covered by the
  # dedicated script at scripts/subquery_logical_time_memory.exs.
  memory_time: 0
)

# Tear the GenServer down so we exit cleanly.
GenServer.stop(pm_pid)

IO.puts("\n\nDone.\n")
