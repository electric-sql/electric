# SubqueryIndex O(1) Shape Removal — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make subquery-shape removal in `Electric.Shapes.Filter.Indexes.SubqueryIndex` cost O(V_shape · log n) — independent of total shapes, shapes-on-node, and shapes-per-value — by switching its ETS table from `:bag` to `:ordered_set` and lifting discriminating fields into keys so removals are prefix-bounded `select_delete`s and exact-key point deletes.

**Architecture:** Pure internal storage change to one module. Every public function signature and all externally-observable behavior is preserved; the existing unit/integration tests are the behavioral contract. The two removal entry points (`unregister_shape/2`, `remove_shape/5`) stop doing partial-key `match_delete` scans; `node_*_member` deletions are _derived_ from the removed shape's own membership rows (scoped by `optimisation.subquery_ref`) and applied as exact point deletes.

**Tech Stack:** Elixir, Erlang ETS (`:ordered_set`, match specifications / `:ets.select`, `:ets.select_delete`).

**Design spec:** `docs/superpowers/specs/2026-06-16-subquery-index-o1-removal-design.md` — read this first. The key-layout table and the Invariants section are authoritative.

**Skills:** Use @superpowers:test-driven-development for every task. Run tests from `packages/sync-service`.

---

## Background the implementer must know

- **The module:** `packages/sync-service/lib/electric/shapes/filter/indexes/subquery_index.ex`. Read it in full before starting.
- **Why `:bag` is O(n):** a `:bag` (hash) ETS table can only skip a full scan when the _delete key is fully bound_. The current code deletes with partially-bound keys (`{:membership, handle, :_, :_}`, `{:node_positive_member, node, :_}`), forcing full-table scans.
- **Why `:ordered_set` fixes it:** in an `:ordered_set` (tree), a delete whose key has a _bound prefix_ is range-limited (the match-spec compiler derives a key range). A point delete by a fully-bound key is O(log n). Both avoid scanning unrelated rows. This was verified empirically (a prefix `select_delete` is flat at ~9 reductions vs the bag's linear blow-up).
- **`:ordered_set` requires unique keys.** Every row that was a distinct `:bag` object must have a distinct key — so previously-in-value discriminators (`value`, `shape`, `branch`, `next_cond`) move into the key.
- **Removal safety invariant (do not break):** the shape's consumer is the only writer of membership/`node_member` rows and is _synchronously stopped before_ `Filter.remove_shape` runs (`ShapeCleaner.remove_shape_immediate` → `with :ok <- Consumer.stop(...)`). Derivation relies on membership rows still being present at removal time. See spec Invariants 1–2.

### The exact key layout (from the spec — copy precisely)

| Row             | `:ordered_set` key                                          | value                   |
| --------------- | ----------------------------------------------------------- | ----------------------- |
| membership      | `{:membership, handle, ref, value}`                         | `true`                  |
| polarity        | `{:polarity, handle, ref}`                                  | `polarity`              |
| fallback        | `{:fallback, handle}`                                       | `true`                  |
| shape→node      | `{:shape_node, handle, node_id, branch}`                    | `{dep, pol, next_cond}` |
| shape+dep→node  | `{:shape_dep_node, handle, dep, node_id, branch}`           | `{pol, next_cond}`      |
| node→shape      | `{:node_shape, node_id, shape, branch}`                     | `{dep, pol, next_cond}` |
| node negated    | `{:node_negated_shape, node_id, shape, next_cond}`          | `true`                  |
| node fallback   | `{:node_fallback, node_id, shape, next_cond}`               | `true`                  |
| node pos member | `{:node_positive_member, node_id, value, shape, next_cond}` | `true`                  |
| node neg member | `{:node_negated_member, node_id, value, shape, next_cond}`  | `true`                  |
| node meta       | `{:node_meta, node_id}`                                     | `%{testexpr: …}`        |

---

## Chunk 1: Test suite (RED)

These tests define "done". Chunk 1 lands the tests; they must be RED (or, for guards, GREEN-and-must-stay-GREEN) before any implementation in Chunk 2.

### Task 1: Seed the two existing Filter-level perf tests

The two `:performance` tests added earlier (`filter_test.exs`, in the `describe "optimisations"` block) currently do **not** seed memberships, so they never exercise `node_*_member` removal — the dominant production cost. Seed them.

**Files:**

- Modify: `packages/sync-service/test/electric/shapes/filter_test.exs` (the two tests titled "removing a subquery shape is O(1) in the total number of shapes" and "...in the number of shapes on its node")

- [ ] **Step 1: Add a seed helper near the other perf helpers** (just above `defp reductions(fun)` in the `optimisations` describe block)

```elixir
@subquery_ref ["$sublink", "0"]

defp seed_shape(filter, shape_id, values) do
  index = Filter.subquery_index(filter)
  SubqueryIndex.seed_membership(index, shape_id, @subquery_ref, 0, MapSet.new(values))
  SubqueryIndex.mark_ready(index, shape_id)
end
```

- [ ] **Step 2: In the "total number of shapes" test, seed each shape after adding it.** After the `Filter.add_shape(filter, i, shape)` line inside the build loop, add:

```elixir
seed_shape(filter, i, [1, 2, 3, 4, 5])
```

- [ ] **Step 3: Do the same in the "number of shapes on its node" test.** Seed each shape with a small _distinct_ view so the node accrues many distinct member rows:

```elixir
seed_shape(filter, i, [i, i + 1_000_000])
```

- [ ] **Step 4: Run the two tests to confirm they still fail (now with membership exercised)**

Run: `mix test test/electric/shapes/filter_test.exs --only performance`
Expected: the two seeded subquery tests FAIL with removal reductions ≫ `@max_reductions` (tens of thousands vs 1300). The unrelated `@>`/`ANY` perf tests are out of scope.

- [ ] **Step 5: Commit**

```bash
git add packages/sync-service/test/electric/shapes/filter_test.exs
git commit -m "test: seed the subquery removal perf tests so they exercise node_member removal"
```

### Task 2: Unit-level flatness perf tests (the rigorous independence proof)

A fixed `< budget` ceiling does not prove _independence_ from a dimension (an O(log n) or cheap-linear impl could pass). These tests measure removal at two well-separated sizes and assert the delta is within noise. They live at the `SubqueryIndex` unit level where setup is cheap (no SQL parsing), so they can scale to 50k shapes.

**Files:**

- Modify: `packages/sync-service/test/electric/shapes/filter/subquery_index_test.exs`

Read this file first — it already has `register_node_shape/4`, `subquery_optimisation/1`, and `make_plan/1` helpers you will reuse.

- [ ] **Step 1: Add perf constants and helpers at the bottom of the module** (after `make_plan/1`)

```elixir
# Removal must not scale with these dimensions. We measure removal reductions at a
# small and a 50x-larger size and require the delta to stay within noise.
@perf_small 1_000
@perf_large 20_000
@flatness_tolerance 3_000
@perf_timeout 120_000

defp reductions(fun) do
  {:reductions, before} = :erlang.process_info(self(), :reductions)
  fun.()
  {:reductions, after_} = :erlang.process_info(self(), :reductions)
  after_ - before
end

# Replicates the index work done by Filter.remove_shape: per-node remove_shape,
# then unregister_shape. branch_key is [] throughout these tests.
defp remove_one(filter, condition_id, shape_id) do
  table = Filter.subquery_index(filter)
  SubqueryIndex.remove_shape(filter, condition_id, shape_id, subquery_optimisation(), [])
  SubqueryIndex.unregister_shape(table, shape_id)
end

defp seed(table, shape_id, values) do
  SubqueryIndex.seed_membership(table, shape_id, @subquery_ref, 0, MapSet.new(values))
  SubqueryIndex.mark_ready(table, shape_id)
end
```

(`@subquery_ref` is already defined at the top of this test module.)

- [ ] **Step 2: Write the "total shapes" flatness test** (each shape on its own node, fixed small view)

```elixir
@tag :performance
@tag timeout: @perf_timeout
test "removal is O(1) in the total number of shapes" do
  measure = fn n ->
    filter = Filter.new()
    table = Filter.subquery_index(filter)
    condition_ids = for _ <- 1..n, do: make_ref()

    condition_ids
    |> Enum.with_index(1)
    |> Enum.each(fn {condition_id, i} ->
      WhereCondition.init(filter, condition_id)
      register_node_shape(filter, table, condition_id, i)
      seed(table, i, [1, 2, 3, 4, 5])
    end)

    {condition_ids |> Enum.at(div(n, 2)), div(n, 2) + 1, filter}
  end

  {cid_s, id_s, filter_s} = measure.(@perf_small)
  small = reductions(fn -> remove_one(filter_s, cid_s, id_s) end)

  {cid_l, id_l, filter_l} = measure.(@perf_large)
  large = reductions(fn -> remove_one(filter_l, cid_l, id_l) end)

  assert abs(large - small) < @flatness_tolerance,
         "removal grew with total shapes: #{small} -> #{large} reductions"
end
```

- [ ] **Step 3: Write the "shapes-on-node" flatness test** (all shapes on one node, distinct views)

```elixir
@tag :performance
@tag timeout: @perf_timeout
test "removal is O(1) in the number of shapes on the node" do
  measure = fn n ->
    filter = Filter.new()
    table = Filter.subquery_index(filter)
    condition_id = make_ref()
    WhereCondition.init(filter, condition_id)

    for i <- 1..n do
      register_node_shape(filter, table, condition_id, i)
      seed(table, i, [i, i + 1_000_000])
    end

    {condition_id, div(n, 2), filter}
  end

  {cid_s, id_s, filter_s} = measure.(@perf_small)
  small = reductions(fn -> remove_one(filter_s, cid_s, id_s) end)

  {cid_l, id_l, filter_l} = measure.(@perf_large)
  large = reductions(fn -> remove_one(filter_l, cid_l, id_l) end)

  assert abs(large - small) < @flatness_tolerance,
         "removal grew with shapes-on-node: #{small} -> #{large} reductions"
end
```

- [ ] **Step 4: Write the "shapes-per-value" flatness test** (the production repro — all shapes share the same values on one node)

```elixir
@tag :performance
@tag timeout: @perf_timeout
test "removal is O(1) in the number of shapes sharing each value" do
  shared = [1, 2, 3, 4, 5]

  measure = fn n ->
    filter = Filter.new()
    table = Filter.subquery_index(filter)
    condition_id = make_ref()
    WhereCondition.init(filter, condition_id)

    for i <- 1..n do
      register_node_shape(filter, table, condition_id, i)
      seed(table, i, shared)
    end

    {condition_id, div(n, 2), filter}
  end

  {cid_s, id_s, filter_s} = measure.(@perf_small)
  small = reductions(fn -> remove_one(filter_s, cid_s, id_s) end)

  {cid_l, id_l, filter_l} = measure.(@perf_large)
  large = reductions(fn -> remove_one(filter_l, cid_l, id_l) end)

  assert abs(large - small) < @flatness_tolerance,
         "removal grew with shapes-per-value: #{small} -> #{large} reductions"
end
```

- [ ] **Step 5: Run the three new tests to confirm they FAIL on the current `:bag` impl**

Run: `mix test test/electric/shapes/filter/subquery_index_test.exs --only performance`
Expected: all three FAIL — `large` is tens-of-thousands of reductions larger than `small` (the bag's full-table scans). If a test errors instead of failing (e.g. a helper typo), fix the test until it _fails on the assertion_.

- [ ] **Step 6: Commit**

```bash
git add packages/sync-service/test/electric/shapes/filter/subquery_index_test.exs
git commit -m "test: add unit-level flatness perf tests for subquery shape removal"
```

### Task 3: Positive-control + no-orphan guard tests

**Files:**

- Modify: `packages/sync-service/test/electric/shapes/filter/subquery_index_test.exs`
- Modify: `packages/sync-service/test/electric/shapes/filter_test.exs`

- [ ] **Step 1: Positive control — removal cost _does_ grow with the removed shape's own view size** (pins the complexity class as O(V_shape), so a future regression can't hide under a flat budget). Add to `subquery_index_test.exs`:

```elixir
@tag :performance
@tag timeout: @perf_timeout
test "removal cost grows with the removed shape's own view size" do
  measure = fn v ->
    filter = Filter.new()
    table = Filter.subquery_index(filter)
    condition_id = make_ref()
    WhereCondition.init(filter, condition_id)
    register_node_shape(filter, table, condition_id, "s")
    seed(table, "s", Enum.to_list(1..v))
    {condition_id, filter}
  end

  {cid_small, filter_small} = measure.(20)
  small = reductions(fn -> remove_one(filter_small, cid_small, "s") end)

  {cid_big, filter_big} = measure.(20 * 50)
  big = reductions(fn -> remove_one(filter_big, cid_big, "s") end)

  assert big > small * 5,
         "expected removal to scale with view size, got #{small} -> #{big}"
end
```

Note: this control is only meaningful once removal is O(V_shape); on the current `:bag` impl removal is dominated by full-table scans, so it may not hold yet. That is expected — it becomes a true assertion after Chunk 2.

- [ ] **Step 2: No-orphan guard — a node with several seeded shapes, removed one-by-one, leaves zero rows for that node.** Add to `filter_test.exs` (near the existing `"Filter.remove_shape/2 removes seeded subquery index state"` test, reusing `@inspector`):

```elixir
test "Filter.remove_shape/2 leaves no orphan subquery rows when draining a shared node" do
  filter = Filter.new()
  index = Filter.subquery_index(filter)
  state_before = snapshot_filter_ets(filter)

  shape_ids = ["a", "b", "c"]

  for id <- shape_ids do
    shape =
      Shape.new!("table",
        where: "id IN (SELECT id FROM another_table)",
        inspector: @inspector,
        feature_flags: ["allow_subqueries"]
      )

    Filter.add_shape(filter, id, shape)
    SubqueryIndex.seed_membership(index, id, ["$sublink", "0"], 0, MapSet.new([1, 2, 3]))
    SubqueryIndex.mark_ready(index, id)
  end

  for id <- shape_ids, do: Filter.remove_shape(filter, id)

  assert snapshot_filter_ets(filter) == state_before
end
```

- [ ] **Step 3: Run both**

Run: `mix test test/electric/shapes/filter_test.exs:LINE_OF_NEW_TEST` and `mix test test/electric/shapes/filter/subquery_index_test.exs --only performance`
Expected: the no-orphan guard PASSES on the current impl (current code removes everything correctly, just slowly) — it must stay green through Chunk 2. The positive control may not hold yet (see note above).

- [ ] **Step 4: Commit**

```bash
git add packages/sync-service/test/electric/shapes/filter_test.exs packages/sync-service/test/electric/shapes/filter/subquery_index_test.exs
git commit -m "test: add view-size positive control and no-orphan drain guard for subquery removal"
```

---

## Chunk 2: Implementation (GREEN)

The rewrite changes the table's storage format, which all functions share — so it is a single coherent change verified against the whole existing test suite, not function-by-function. Apply the complete code below, then verify.

### Task 4: Rewrite `subquery_index.ex` to `:ordered_set`

**Files:**

- Modify: `packages/sync-service/lib/electric/shapes/filter/indexes/subquery_index.ex`

Work top-to-bottom through the module. The code below is complete; match-spec syntax is exact (in a match-spec body, `{{a, b}}` constructs the tuple `{a, b}`).

- [ ] **Step 1: `new/1` — switch table type**

```elixir
def new(opts \\ []) do
  case Keyword.get(opts, :stack_id) do
    nil -> :ets.new(:subquery_index, [:ordered_set, :public])
    stack_id -> :ets.new(table_name(stack_id), [:ordered_set, :public, :named_table])
  end
end
```

- [ ] **Step 2: Add a private prefix-delete helper** (used by `unregister_shape` and `mark_ready`)

```elixir
# Range-bounded delete of every row whose key matches `key_pattern` (a tuple with a
# bound prefix and `:_` wildcards in trailing positions). On an :ordered_set this is
# O(log n + matched), never a full scan.
defp delete_by_key_prefix(table, key_pattern) do
  :ets.select_delete(table, [{{key_pattern, :_}, [], [true]}])
end
```

- [ ] **Step 3: `register_shape/3` — unchanged keys, ordered_set insert** (polarity + fallback). The existing body already inserts `{{:polarity, shape_handle, subquery_ref}, polarity}` and `{{:fallback, shape_handle}, true}`; leave as is.

- [ ] **Step 4: `unregister_shape/2` — replace partial-key `match_delete` scans with prefix deletes**

```elixir
def unregister_shape(table, shape_handle) do
  delete_by_key_prefix(table, {:membership, shape_handle, :_, :_})
  delete_by_key_prefix(table, {:polarity, shape_handle, :_})
  delete_by_key_prefix(table, {:shape_node, shape_handle, :_, :_})
  delete_by_key_prefix(table, {:shape_dep_node, shape_handle, :_, :_, :_})
  :ets.delete(table, {:fallback, shape_handle})
  :ok
end
```

- [ ] **Step 5: `add_shape/5` — new key shapes** (replace the `:ets.insert` block; keep the `WhereCondition` + `ensure_node_meta` calls)

```elixir
:ets.insert(
  table,
  {{:node_shape, node_id, shape_id, branch_key},
   {optimisation.dep_index, optimisation.polarity, next_condition_id}}
)

if optimisation.polarity == :negated do
  :ets.insert(table, {{:node_negated_shape, node_id, shape_id, next_condition_id}, true})
end

:ets.insert(
  table,
  {{:shape_node, shape_id, node_id, branch_key},
   {optimisation.dep_index, optimisation.polarity, next_condition_id}}
)

:ets.insert(
  table,
  {{:shape_dep_node, shape_id, optimisation.dep_index, node_id, branch_key},
   {optimisation.polarity, next_condition_id}}
)

:ets.insert(table, {{:node_fallback, node_id, shape_id, next_condition_id}, true})
:ok
```

- [ ] **Step 6: `remove_shape/5` — point/prefix deletes + derived member deletes**

```elixir
def remove_shape(
      %Filter{subquery_index: table} = filter,
      condition_id,
      shape_id,
      optimisation,
      branch_key
    ) do
  node_id = {condition_id, optimisation.field}

  case node_shape_entry_for_shape(table, shape_id, node_id, branch_key) do
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
        node_id,
        shape_id,
        polarity,
        next_condition_id,
        optimisation.subquery_ref
      )

      :ets.delete(table, {:node_shape, node_id, shape_id, branch_key})

      if polarity == :negated do
        :ets.delete(table, {:node_negated_shape, node_id, shape_id, next_condition_id})
      end

      :ets.delete(table, {:node_fallback, node_id, shape_id, next_condition_id})
      :ets.delete(table, {:shape_node, shape_id, node_id, branch_key})
      :ets.delete(table, {:shape_dep_node, shape_id, dep_index, node_id, branch_key})

      if node_empty?(table, node_id) do
        :ets.delete(table, {:node_meta, node_id})
        :deleted
      else
        :ok
      end
  end
end
```

- [ ] **Step 7: `delete_node_members/6` — derive from membership, point-delete** (replace the old `delete_node_members/5`)

```elixir
# Delete this shape's node-local member rows for this node by enumerating the shape's
# own values (scoped to the node's subquery_ref) from its membership rows and
# point-deleting each. O(V_node · log n); touches only this shape's rows. Relies on
# membership rows still being present (consumer stopped before removal — see spec).
defp delete_node_members(table, node_id, shape_id, polarity, next_condition_id, subquery_ref) do
  tag =
    case polarity do
      :positive -> :node_positive_member
      :negated -> :node_negated_member
    end

  values =
    :ets.select(table, [
      {{{:membership, shape_id, subquery_ref, :"$1"}, :_}, [], [:"$1"]}
    ])

  for value <- values do
    :ets.delete(table, {tag, node_id, value, shape_id, next_condition_id})
  end

  :ok
end
```

- [ ] **Step 8: `add_value/5` — exact-key member inserts**

```elixir
def add_value(table, shape_handle, subquery_ref, dep_index, value) do
  for {node_id, polarity, next_condition_id, _branch_key} <-
        nodes_for_shape_dependency(table, shape_handle, dep_index) do
    tag = if polarity == :positive, do: :node_positive_member, else: :node_negated_member
    :ets.insert(table, {{tag, node_id, value, shape_handle, next_condition_id}, true})
  end

  :ets.insert(table, {{:membership, shape_handle, subquery_ref, value}, true})
  :ok
end
```

- [ ] **Step 9: `remove_value/5` — exact-key member deletes**

```elixir
def remove_value(table, shape_handle, subquery_ref, dep_index, value) do
  for {node_id, polarity, next_condition_id, _branch_key} <-
        nodes_for_shape_dependency(table, shape_handle, dep_index) do
    tag = if polarity == :positive, do: :node_positive_member, else: :node_negated_member
    :ets.delete(table, {tag, node_id, value, shape_handle, next_condition_id})
  end

  :ets.delete(table, {:membership, shape_handle, subquery_ref, value})
  :ok
end
```

- [ ] **Step 10: `mark_ready/2` — prefix-delete the shape's node_fallback rows**

```elixir
def mark_ready(table, shape_handle) do
  :ets.delete(table, {:fallback, shape_handle})

  for {node_id, _dep_index, _polarity, _next_condition_id, _branch_key} <-
        nodes_for_shape(table, shape_handle) do
    delete_by_key_prefix(table, {:node_fallback, node_id, shape_handle, :_})
  end

  :ok
end
```

- [ ] **Step 11: `affected_shapes/4` — prefix selects** (replace the `candidates` computation; the trailing `Enum.reduce` over candidates is unchanged)

```elixir
candidates =
  case evaluate_node_lhs(table, node_id, record) do
    {:ok, typed_value} ->
      positive = members_for(table, :node_positive_member, node_id, typed_value)

      negated =
        MapSet.difference(
          negated_shapes_for(table, node_id),
          members_for(table, :node_negated_member, node_id, typed_value)
        )

      fallback = fallback_for(table, node_id)

      positive
      |> MapSet.union(negated)
      |> MapSet.union(fallback)

    :error ->
      all_node_shapes(table, node_id)
  end
```

- [ ] **Step 12: Replace the read helpers.** First **delete** these now-unused private functions so `--warnings-as-errors` stays clean: the old `delete_node_members/5` (replaced by the `/6` version in Step 7) and `values_for_key/2` (its only callers were in `affected_shapes`, replaced in Step 11). Then replace the bodies of `all_node_shapes/2`, `nodes_for_shape/2`, `nodes_for_shape_dependency/3`, `node_shape_entry_for_shape/4`, `node_empty?/2` and add `members_for/4`, `negated_shapes_for/2`, `fallback_for/2` with:

```elixir
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

defp nodes_for_shape_dependency(table, shape_handle, dep_index) do
  :ets.select(table, [
    {{{:shape_dep_node, shape_handle, dep_index, :"$1", :"$2"}, {:"$3", :"$4"}}, [],
     [{{:"$1", :"$3", :"$4", :"$2"}}]}
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
```

`positions_for_shape/2` and `has_positions?/2` already call `nodes_for_shape/2` and keep working (the projected tuple shape `{node_id, dep, pol, next, branch}` is preserved). `member?/4`, `membership_or_fallback?/4`, `fallback?/2`, `polarity_for_shape_ref`, `ensure_node_meta/3`, `evaluate_node_lhs/3`, `all_shape_ids/3`, `seed_membership/5` are unchanged.

- [ ] **Step 13: Compile and format**

Run: `mix compile --warnings-as-errors && mix format`
Expected: clean compile, no warnings (e.g. unused private functions — delete any leftover old helper like the old `values_for_key/2` if nothing references it).

### Task 5: Verify everything green

- [ ] **Step 1: Run the SubqueryIndex unit tests (behavioral contract)**

Run: `mix test test/electric/shapes/filter/subquery_index_test.exs`
Expected: PASS (including the new `:performance` tests — they run by default unless excluded; if the project excludes `:performance` by default, also run `--include performance`).

- [ ] **Step 2: Run the Filter tests (behavioral + perf + no-orphan)**

Run: `mix test test/electric/shapes/filter_test.exs --include performance`
Expected: PASS — all subquery routing tests, the seeded perf tests (now well under budget), and the no-orphan drain guard. The pre-existing `@>` inclusion-index add-cost perf failure (unrelated to this change) may still fail; confirm it is the _only_ failure and that it predates this work.

- [ ] **Step 3: Run the consumer/integration tests that touch the subquery index**

Run: `mix test test/electric/shapes/consumer_test.exs test/electric/replication/shape_log_collector_test.exs`
Expected: PASS.

- [ ] **Step 4: Run the full suite for regressions**

Run: `mix test`
Expected: PASS except the known unrelated pre-existing `@>` perf assertion. Investigate any other failure before proceeding.

- [ ] **Step 5: Confirm the flatness tests now prove independence**

Run: `mix test test/electric/shapes/filter/subquery_index_test.exs --only performance`
Expected: all flatness tests PASS (delta within `@flatness_tolerance`); the view-size positive control now holds (`big > small * 5`).

- [ ] **Step 6: Commit**

```bash
git add packages/sync-service/lib/electric/shapes/filter/indexes/subquery_index.ex
git commit -m "fix(sync-service): O(1) subquery shape removal via ordered_set index (#4279)"
```

### Task 6: Changeset

**Files:**

- Create: `.changeset/<descriptive-name>.md`

- [ ] **Step 1: Inspect an existing changeset for the exact frontmatter/package format**

Run: `ls .changeset && cat .changeset/$(ls .changeset | grep -v '^config' | head -1)`

- [ ] **Step 2: Write a patch changeset** for `@core/sync-service` (use the package name observed in step 1) describing the fix: "Restore O(1) removal of subquery shapes from the where-clause filter, fixing replication-stream WAL lag when many subquery shapes are present (#4279)."

- [ ] **Step 3: Commit**

```bash
git add .changeset
git commit -m "chore: changeset for O(1) subquery shape removal"
```

---

## Definition of done

- All existing `subquery_index_test.exs` / `filter_test.exs` / consumer tests pass unchanged (behavior preserved).
- The three flatness perf tests pass (removal independent of total shapes, shapes-on-node, shapes-per-value).
- The view-size positive control passes (removal is O(V_shape)).
- The no-orphan drain guard passes.
- `subquery_index.ex` uses `:ordered_set`; no `match_delete`/`select_delete` with a _value_-position wildcard on the removal path; member deletions are exact point deletes derived from membership.
- Changeset added.
- Only the pre-existing unrelated `@>` perf assertion may remain failing.
