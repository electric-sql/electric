# Internal Numeric `shape_id` Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce an in-memory, non-persisted numeric `shape_id` that replaces the binary `shape_handle` for all internal identity/routing, keeping `shape_handle` only at the external HTTP boundary and on-disk storage, to cut the memory cost of holding millions of binary handles in ETS/maps/sets.

**Architecture:** `ShapeStatus` becomes the single authority that mints a monotonic integer `shape_id` (via `:ets.update_counter`) and holds the bidirectional `handle ↔ id` map in its ETS tables. The id is assigned in `add_shape/2` (new shapes) and in `populate_shape_meta_table/2` (shapes restored from SQLite on boot) — it is **never persisted**, so it is freshly minted each boot. The id threads from `ShapeCache` into each `Consumer`, which carries **both** id and handle in its state: it uses `handle` for storage calls + the client change-notification `Registry`, and `id` for everything else (the custom `ConsumerRegistry`, `EventRouter`, `Filter`, `FlushTracker`, `RequestBatcher`, `Partitions`, `PublicationManager`, subquery indexes). Logging/telemetry/process-name sites in id-only modules look up the handle via `ShapeStatus.shape_handle_for_log/2`, which returns `"unknown, id: <id>"` when the shape has already been removed.

**Tech Stack:** Elixir, ETS, ExUnit. No new dependencies.

**Conventions for this plan (read first):**
- **Be explicit, never accept both.** A function takes *either* a handle *or* an id, never both, and never a value that could be either. After conversion, internal functions take `shape_id` (integer); boundary functions take `shape_handle` (binary). Do not add `when is_integer(x) or is_binary(x)` guards.
- **The Consumer is the only bridge.** It holds both. Storage + the client `Registry` get `handle`; everything else gets `id`. No id↔handle lookups on the hot path.
- **Tests move with the code.** When a module switches from handle to id, update its tests in the same task/commit so the diff stays reviewable as a single mechanical unit.
- **Two registries, do not confuse them:**
  - `Electric.Shapes.ConsumerRegistry` — custom ETS `id → pid`, also the consumer's `{:via, ...}` name and the SLC→consumer routing table. **Converts to id.**
  - Elixir `Registry` at `Electric.StackSupervisor.registry_name(stack_id)` — pub-sub to API request handlers (`Consumer.register_for_changes/2`, `Registry.dispatch/3`). **Stays on handle.**
- Run the full suite for a touched area with `mix test test/electric/<area>` and the whole suite with `mix test` before each chunk's final commit. Tests expect `mix start_dev` services running.

---

## Files reference (what changes, and to what)

**Stays on `shape_handle` (boundary + storage + authority's external face):**
- `lib/electric/plug/serve_shape_plug.ex`, `lib/electric/shapes/api.ex`, `lib/electric/shapes/api/params.ex`, `lib/electric/shapes/api/response.ex`, `lib/electric/shapes/api/delete.ex`, `lib/electric/shapes.ex`
- `lib/electric/shapes/shape.ex` (`generate_id/1` mints the handle), `lib/electric/shape_cache.ex` (returns handle to the boundary)
- Storage: `lib/electric/shape_cache/storage.ex`, `pure_file_storage.ex` (+`pure_file_storage/shared_records.ex`), `in_memory_storage.ex`, `shape_status/shape_db.ex` (+`shape_db/query.ex`, `shape_db/connection.ex`), `shape_cleaner.ex` (+`shape_cleaner/cleanup_task_supervisor.ex`), `lib/electric/postgres/snapshot_query.ex`
- The client change-notification Elixir `Registry`

**Authority — gains the id and the `handle ↔ id` map:**
- `lib/electric/shape_cache/shape_status.ex`

**Carries both id and handle (the bridge):**
- `lib/electric/shapes/consumer.ex`, `consumer/state.ex`

**Converts to `shape_id`:**
- Routing: `lib/electric/shapes/consumer_registry.ex`, `event_router.ex`, `dependency_layers.ex`, `partitions.ex`, `dynamic_consumer_supervisor.ex`
- Replication: `lib/electric/replication/shape_log_collector.ex`, `shape_log_collector/request_batcher.ex`, `shape_log_collector/flush_tracker.ex`, `publication_manager.ex`, `publication_manager/relation_tracker.ex`
- Filter: `lib/electric/shapes/filter.ex`, `filter/index.ex`, `filter/where_condition.ex`, `filter/indexes/{equality,inclusion,subquery}_index.ex`
- Subquery/materializer: `consumer/materializer.ex`, `consumer/subqueries/{move_broadcast,shape_info,splice_plan}.ex`, `consumer/event_handler/subqueries/steady.ex`, `consumer/event_handler/default.ex`, `consumer/event_handler_builder.ex`, `consumer/effects.ex`, `consumer/setup_effects.ex`, `consumer/snapshotter.ex`, `consumer/initial_snapshot.ex`, `shapes/subquery_tags.ex`

---

## Chunk 1: `ShapeStatus` becomes the id authority

**Outcome:** `ShapeStatus` mints and stores `shape_id`, exposes bidirectional lookups and `shape_handle_for_log/2`, and `add_shape/2` returns `{:ok, {handle, id}}`. Nothing outside `ShapeStatus` uses the id yet — the rest of the system is untouched and the suite stays green.

**Files:**
- Modify: `lib/electric/shape_cache/shape_status.ex`
- Modify: `lib/electric.ex` (add `@type shape_id`)
- Test: `test/electric/shape_cache/shape_status_test.exs`
- Callers to update for the new `add_shape/2` return shape: `lib/electric/shape_cache.ex:383` (`maybe_create_shape`) — see Chunk 2; for Chunk 1 keep `add_shape` backward-tolerant by updating that single caller in the same commit.

### Design notes (read before coding)

ETS layout in `ShapeStatus`:
- `shape_meta_table` row grows from `{handle, hash, snapshot_started, last_read_time, generation}` to **`{handle, hash, snapshot_started, last_read_time, generation, id}`** (id appended last so existing positional constants `@shape_last_used_time_pos 4` stay valid; add `@shape_id_pos 6`).
- New `shape_id_table(stack_id)` (`:set, :public, :named_table`) holding `{id, handle}` reverse entries **and** the sequence counter under key `:seq` as `{:seq, n}`.
- Mint with `:ets.update_counter(shape_id_table(stack_id), :seq, {2, 1}, {:seq, 0})` → returns the new integer atomically.

Ids are minted in **two** places, both must insert into the meta tuple (pos 6) and the reverse table:
1. `add_shape/2` — brand-new shapes.
2. `populate_shape_meta_table/2` — shapes restored from SQLite at boot/refresh. **On `refresh/1`, reuse an existing id if the handle already has one** (`id_for_handle/2`) so ids stay stable for already-running consumers; only mint when absent.

`remove_shape/2` must look up the id (pos 6) before deleting the meta row, then delete the reverse `shape_id_table` entry too.

Update every place that pattern-matches the 5-tuple to the 6-tuple: `add_shape/2` insert, `validate_shape_handle/3`, `snapshot_started?/2`, `populate_shape_meta_table/2` insert, `least_recently_used/2` foldl clauses, `refresh/1` `select_delete` match (`{:_, :_, :_, :_, :"$1"}` → `{:_, :_, :_, :_, :"$1", :_}`).

### Steps

- [ ] **Step 1: Add the `shape_id` type.** In `lib/electric.ex`, beside `@type shape_handle() :: binary()`, add:

```elixir
@type shape_id() :: non_neg_integer()
```

- [ ] **Step 2: Write failing tests for id assignment + lookups.** In `test/electric/shape_cache/shape_status_test.exs`, add a describe block:

```elixir
describe "shape_id" do
  test "add_shape assigns a monotonic id and returns {handle, id}", %{stack_id: stack_id} do
    {:ok, {handle1, id1}} = ShapeStatus.add_shape(stack_id, shape1())
    {:ok, {handle2, id2}} = ShapeStatus.add_shape(stack_id, shape2())

    assert is_binary(handle1) and is_integer(id1)
    assert id2 > id1
    assert {:ok, ^id1} = ShapeStatus.id_for_handle(stack_id, handle1)
    assert {:ok, ^handle1} = ShapeStatus.handle_for_id(stack_id, id1)
  end

  test "shape_handle_for_log returns the handle, or a fallback once removed", %{stack_id: stack_id} do
    {:ok, {handle, id}} = ShapeStatus.add_shape(stack_id, shape1())
    assert ShapeStatus.shape_handle_for_log(stack_id, id) == handle

    :ok = ShapeStatus.remove_shape(stack_id, handle)
    assert ShapeStatus.shape_handle_for_log(stack_id, id) == "unknown, id: #{id}"
  end
end
```

  (Reuse the existing test's `shape1/0`/`shape2/0` helpers and `stack_id` setup; adapt names to the file's conventions.)

- [ ] **Step 3: Run tests, verify they fail.** Run: `mix test test/electric/shape_cache/shape_status_test.exs -v` — Expected: FAIL (`id_for_handle/2` undefined, `add_shape` returns `{:ok, handle}`).

- [ ] **Step 4: Add the id table + counter + position constant.** In `shape_status.ex`:
  - Add `@shape_id_pos 6` near `@shape_last_used_time_pos 4`; update the tuple-format comment.
  - Add `defp shape_id_table(stack_id), do: :"shape_id_table:#{stack_id}"`.
  - In `create_shape_meta_table/1`, `ensure_state_table(shape_id_table(stack_id), read_concurrency: true, write_concurrency: :auto)` and `:ets.delete_all_objects(shape_id_table(stack_id))`.
  - In `reset/2`, clear `shape_id_table` too.
  - Add:

```elixir
defp mint_id(stack_id) do
  :ets.update_counter(shape_id_table(stack_id), :seq, {2, 1}, {:seq, 0})
end
```

- [ ] **Step 5: Mint in `add_shape/2`, return `{handle, id}`, store both.** Update `add_shape/2`:

```elixir
@spec add_shape(stack_id(), Shape.t()) :: {:ok, {shape_handle(), shape_id()}} | {:error, term()}
def add_shape(stack_id, shape) when is_stack_id(stack_id) do
  OpenTelemetry.with_child_span("shape_status.add_shape", [], stack_id, fn ->
    {_, shape_handle} = Shape.generate_id(shape)
    indexed? = Filter.indexed_shape?(shape)

    with {:ok, shape_hash} <- ShapeDb.add_shape(stack_id, shape, shape_handle) do
      id = mint_id(stack_id)

      if :ets.insert_new(
           shape_meta_table(stack_id),
           {shape_handle, shape_hash, false, nil, 0, id}
         ) do
        :ets.insert(shape_id_table(stack_id), {id, shape_handle})
        :ets.insert(shape_indexability_table(stack_id), {shape_handle, indexed?})
        increment_shape_counts(stack_id, indexed?)
        {:ok, {shape_handle, id}}
      else
        {:error, "duplicate shape #{inspect(shape_handle)}: #{inspect(shape)}"}
      end
    end
  end)
end
```

- [ ] **Step 6: Add the lookup functions.**

```elixir
@spec id_for_handle(stack_id(), shape_handle()) :: {:ok, shape_id()} | :error
def id_for_handle(stack_id, shape_handle) do
  case :ets.lookup_element(shape_meta_table(stack_id), shape_handle, @shape_id_pos, nil) do
    nil -> :error
    id -> {:ok, id}
  end
end

@spec handle_for_id(stack_id(), shape_id()) :: {:ok, shape_handle()} | :error
def handle_for_id(stack_id, id) do
  case :ets.lookup_element(shape_id_table(stack_id), id, 2, nil) do
    nil -> :error
    handle -> {:ok, handle}
  end
end

@doc """
Resolve a shape_id to its handle for logging/telemetry/process labels.
Returns a fallback string when the shape has been removed (the only expected
miss), so callers can log unconditionally.
"""
@spec shape_handle_for_log(stack_id(), shape_id()) :: shape_handle() | binary()
def shape_handle_for_log(stack_id, id) do
  case handle_for_id(stack_id, id) do
    {:ok, handle} -> handle
    :error -> "unknown, id: #{id}"
  end
end

@spec fetch_shape_by_id(stack_id(), shape_id()) :: {:ok, Shape.t()} | :error
def fetch_shape_by_id(stack_id, id) do
  with {:ok, handle} <- handle_for_id(stack_id, id) do
    fetch_shape_by_handle(stack_id, handle)
  end
end
```

- [ ] **Step 7: Update `remove_shape/2` to clear the reverse entry.**

```elixir
def remove_shape(stack_id, shape_handle) when is_stack_id(stack_id) do
  with :ok <- ShapeDb.remove_shape(stack_id, shape_handle) do
    case id_for_handle(stack_id, shape_handle) do
      {:ok, id} -> :ets.delete(shape_id_table(stack_id), id)
      :error -> :ok
    end

    :ets.delete(shape_meta_table(stack_id), shape_handle)
    decrement_shape_counts(stack_id, shape_cached_as_indexed?(stack_id, shape_handle))
    :ok
  end
end
```

- [ ] **Step 8: Mint/reuse ids in the restore path.** Update `populate_shape_meta_table/2` to assign an id per handle, reusing an existing one on refresh:

```elixir
defp populate_shape_meta_table(stack_id, generation) do
  start_time = System.monotonic_time()

  ShapeDb.reduce_shape_meta(
    stack_id,
    :ets.whereis(shape_meta_table(stack_id)),
    fn {handle, hash, snapshot_complete?}, table ->
      id =
        case id_for_handle(stack_id, handle) do
          {:ok, existing} -> existing
          :error ->
            new_id = mint_id(stack_id)
            :ets.insert(shape_id_table(stack_id), {new_id, handle})
            new_id
        end

      true = :ets.insert(table, {handle, hash, snapshot_complete?, start_time, generation, id})
      table
    end
  )

  :ok
end
```

- [ ] **Step 9: Update remaining 5-tuple matches to 6-tuple.** In `shape_status.ex`:
  - `validate_shape_handle/3`: `[{^shape_handle, hash, _snapshot_started, _last_read, _gen, _id}]`
  - `snapshot_started?/2`: `[{^shape_handle, _hash, snapshot_started, _last_read, _gen, _id}]`
  - `least_recently_used/2` foldl: both clauses gain a trailing `, _id` in the tuple pattern.
  - `refresh/1` `select_delete`: `{{:_, :_, :_, :_, :"$1", :_}, [{:"/=", :"$1", generation}], [true]}`

- [ ] **Step 10: Update the single internal caller of `add_shape`.** In `shape_cache.ex:383`, change `{:ok, shape_handle} = ShapeStatus.add_shape(...)` to `{:ok, {shape_handle, _shape_id}} = ShapeStatus.add_shape(...)` (the id is threaded properly in Chunk 2; for now discard it to keep the suite green).

- [ ] **Step 11: Run tests, verify pass.** Run: `mix test test/electric/shape_cache/shape_status_test.exs` then `mix test test/electric/shape_cache` — Expected: PASS.

- [ ] **Step 12: Commit.**

```bash
git add lib/electric.ex lib/electric/shape_cache/shape_status.ex lib/electric/shape_cache.ex test/electric/shape_cache/shape_status_test.exs
git commit -m "feat(shape_status): mint in-memory numeric shape_id with handle<->id map"
```

---

## Chunk 2: Thread `shape_id` into the Consumer (carry both, no behavior change)

**Outcome:** Each consumer receives and stores `shape_id` alongside `shape_handle`. Nothing routes by id yet — id is merely carried. Suite stays green.

**Files:**
- Modify: `lib/electric/shape_cache.ex` (`maybe_create_shape`, `start_shape`, `restore_shape_and_dependencies`, `start_consumer_for_handle` paths)
- Modify: `lib/electric/shapes/dynamic_consumer_supervisor.ex` (`start_child` reads `shape_id` from config; partition by id)
- Modify: `lib/electric/shapes/consumer.ex` (accept `shape_id` in config, pass to `State.new`)
- Modify: `lib/electric/shapes/consumer/state.ex` (add `:shape_id` field, accept in `new/3`)
- Test: `test/electric/shapes/consumer_test.exs`, `test/electric/shape_cache_test.exs`

### Steps

- [ ] **Step 1: Add `:shape_id` to consumer state.** In `consumer/state.ex`: add `:shape_id` to the `defstruct` list (next to `:shape_handle`); thread it through `new/3`/`new/2`:

```elixir
@spec new(Electric.stack_id(), Shape.handle(), Electric.shape_id(), Shape.t()) :: uninitialized_t()
def new(stack_id, shape_handle, shape_id, shape) do
  stack_id |> new(shape_handle, shape_id) |> initialize_shape(shape, %{})
end

def new(stack_id, shape_handle, shape_id) do
  %__MODULE__{stack_id: stack_id, shape_handle: shape_handle, shape_id: shape_id, ...}
end
```

  Keep `telemetry_attrs/1` using `state.shape_handle` directly — the consumer holds it, no lookup needed.

- [ ] **Step 2: Thread id from `ShapeCache` into `start_shape`.** In `shape_cache.ex`:
  - `maybe_create_shape`: capture the id — `{:ok, {shape_handle, shape_id}} = ShapeStatus.add_shape(stack_id, shape)` — and pass to `start_shape(shape_handle, shape_id, shape, opts)`.
  - On the existing-shape path (`fetch_handle_by_shape_critical` returns only a handle) and in `restore_shape_and_dependencies`/`start_consumer_for_handle` (which fetch by handle), resolve the id with `ShapeStatus.id_for_handle(stack_id, handle)` immediately after obtaining the handle. This is the authority resolving once at consumer-start; not a hot path.
  - `start_shape/4` passes `shape_id: shape_id` in the child configs to `DynamicConsumerSupervisor.start_shape_consumer` and `start_materializer`.

- [ ] **Step 3: Partition + log by id in the supervisor.** In `dynamic_consumer_supervisor.ex` `start_child/2`: read `%{shape_handle: shape_handle, shape_id: shape_id} = child_opts`; change `partition_for(stack_id, shape_id)` and `partition_for` to hash `shape_id`. Keep the debug log message (it can use either; prefer `shape_id`).

- [ ] **Step 4: Consumer passes id to state.** In `consumer.ex` init/child config handling: read `shape_id` from opts and pass it to `Consumer.State.new/…`. Store in state.

- [ ] **Step 5: Update tests that start consumers/materializers** to pass `shape_id` in config and assert it lands in state. Run the consumer + shape_cache test files.

- [ ] **Step 6: Run tests.** Run: `mix test test/electric/shapes/consumer_test.exs test/electric/shape_cache_test.exs` — Expected: PASS.

- [ ] **Step 7: Commit.**

```bash
git commit -am "feat(consumer): carry numeric shape_id alongside shape_handle"
```

---

## Chunk 3: Convert the routing pipeline to `shape_id`

**Outcome:** The SLC → EventRouter → ConsumerRegistry → Consumer routing path is keyed by id end-to-end. The consumer registers in `ConsumerRegistry` by id and adds itself to the SLC/EventRouter/Filter by id; it keeps the Elixir `Registry` (client changes) keyed by handle. This is the largest mechanical chunk — split into the sub-tasks below, committing after each, because the key type must change consistently across a pipeline boundary at once.

> These modules already type their identifier as `shape_id :: term()`/`any()` (`event_router.ex`, `flush_tracker.ex`, `partitions.ex`, `filter.ex`), so most edits are: stop passing the handle in, pass `state.shape_id` instead, and rename `shape_handle` locals → `shape_id`. The behavior is identical — only the value carried changes.

### Task 3a: `ConsumerRegistry` keyed by id

**Files:** `lib/electric/shapes/consumer_registry.ex`; `test/electric/shapes/consumer_registry_test.exs`; callers `consumer.ex`, `shape_cache.ex`, `shape_log_collector.ex`.

- [ ] **Step 1:** Replace `shape_handle` with `shape_id` throughout `consumer_registry.ex`: the `{:via, __MODULE__, {stack_id, shape_id}}` name, `register_name`/`whereis_name`/`whereis`, the ETS `{shape_id, pid}` rows, `register_consumer*`, `do_remove_consumer`, `consumer_pid`, `publish/2` (`events_by_id`), `resolve_and_broadcast`, `broadcast` (keys are ids), `enable_suspend` foldl. Drop the `is_shape_handle/1` guards (replace with `is_integer/1` where a guard is wanted).
- [ ] **Step 2:** `start_consumer!/2` now has an id, not a handle. Change `ShapeCache.start_consumer_for_handle(handle, …)` → `ShapeCache.start_consumer_for_id(id, …)` (added in 3b). For the telemetry/log lines inside `start_consumer!`, use `ShapeStatus.shape_handle_for_log(stack_id, id)` so the human-readable handle still appears.
- [ ] **Step 3:** Update `consumer_registry_test.exs` to register/look up by integer ids. Run `mix test test/electric/shapes/consumer_registry_test.exs`.
- [ ] **Step 4:** Update callers: `Consumer.name/2`, `whereis/2`, `register_*` calls pass `state.shape_id`; `ShapeCache.restore_shape_and_dependencies`/`start_shape` look up consumers by id. Commit: `refactor(consumer_registry): key consumer routing by shape_id`.

### Task 3b: `ShapeCache.start_consumer_for_id`

**Files:** `lib/electric/shape_cache.ex`.

- [ ] Add `start_consumer_for_id(shape_id, stack_id, opts)` mirroring `start_consumer_for_handle`, and a `{:start_consumer_for_id, shape_id, otel_ctx}` `handle_call` that does `ShapeStatus.fetch_shape_by_id(stack_id, shape_id)` then `restore_shape_and_dependencies(handle, shape_id, shape, …)` (resolve handle via `ShapeStatus.handle_for_id`). Remove `start_consumer_for_handle` once `ConsumerRegistry` no longer calls it (it's the only caller). Update `test/electric/shape_cache_test.exs`. Commit: `refactor(shape_cache): start consumers by shape_id`.

### Task 3c: `EventRouter` + `Filter` keyed by id

**Files:** `lib/electric/shapes/event_router.ex`, `filter.ex`, `filter/index.ex`, `filter/where_condition.ex`, `filter/indexes/{equality,inclusion}_index.ex` (subquery index in Chunk 4); tests `test/electric/shapes/event_router_test.exs`, `test/electric/shapes/filter_test.exs` and filter index tests.

- [ ] These are already generic (`shape_id :: any()`). The change is at the **call sites**: `ShapeLogCollector.add_shape`/`EventRouter.add_shape`/`Filter.add_shape` are called with the consumer's identifier — switch the consumer to pass `state.shape_id` (Task 3e). Within these modules, rename any `shape_handle` locals/specs → `shape_id` for clarity and drop `is_shape_handle` guards. The `event_by_shape_handle/2` function and result map become `event_by_shape_id/2` keyed by id.
- [ ] Update tests to add/route shapes by integer ids (the tests currently pass string handles as the generic id — swap to integers). Run `mix test test/electric/shapes/filter_test.exs test/electric/shapes/event_router_test.exs`. Commit: `refactor(filter,event_router): use numeric shape_id`.

### Task 3d: SLC, `RequestBatcher`, `FlushTracker`, `Partitions`, `DependencyLayers`, `PublicationManager` keyed by id

**Files:** `lib/electric/replication/shape_log_collector.ex` (+`request_batcher.ex`, `flush_tracker.ex`), `lib/electric/shapes/partitions.ex`, `dependency_layers.ex`, `lib/electric/replication/publication_manager.ex` (+`relation_tracker.ex`); corresponding tests.

- [ ] **SLC:** `add_shape(stack_id, shape_id, shape, operation)`, `remove_shape(stack_id, shape_id)`, the `{:writer_flushed, shape_id, offset}` cast, and the `EventRouter`/`ConsumerRegistry`/`Partitions` calls all switch to id. Remove the dead `pids_by_shape_handle` map field while here (rename or delete — it is never populated). `request_batcher.ex`: `to_add`/`to_remove`/`to_schedule_waiters` keyed by id (already generic-ish — rename type aliases). `flush_tracker.ex`: already `shape_id :: term()` — only the callers change.
- [ ] **PublicationManager/RelationTracker:** `add_shape`/`remove_shape` and the tracked-handles ETS switch to id. Rename `tracked_handles_table` → `tracked_shapes_table` for accuracy. The consumer calls these with `state.shape_id`.
- [ ] Update each module's tests to use integer ids. Run `mix test test/electric/replication test/electric/shapes/partitions_test.exs`. Commit: `refactor(replication): route shapes by numeric shape_id`.

### Task 3e: Flip the Consumer to route by id

**Files:** `lib/electric/shapes/consumer.ex`; `test/electric/shapes/consumer_test.exs`.

- [ ] In `consumer.ex`, change every internal routing call to pass `state.shape_id`: `ConsumerRegistry.name/register/whereis`, `ShapeLogCollector.add_shape/remove_shape`, `EventRouter`/`Filter`/`Partitions`/`PublicationManager`/`FlushTracker` interactions, and `DynamicConsumerSupervisor` lookups.
- [ ] **Keep on handle (do not change):** `Consumer.register_for_changes/2` and the `Registry.dispatch(Electric.StackSupervisor.registry_name(stack_id), state.shape_handle, …)` client pub-sub; all `Storage.*` calls (`state.shape_handle`); `Process.set_label({:consumer, state.shape_handle})` (it already has the handle — no lookup).
- [ ] Update `consumer_test.exs`. Run `mix test test/electric/shapes/consumer_test.exs`. Then run the routers end-to-end: `mix test test/electric/plug/router_test.exs`. Commit: `refactor(consumer): route internally by shape_id, keep handle for storage + client registry`.

---

## Chunk 4: Subquery / materializer subsystem to `shape_id`

**Outcome:** The subquery index (the biggest memory amplifier — handle repeated 4–6× per node) and the materializer/dependency machinery key by id. This chunk is separate because shapes persist **dependency handles** (`shape.shape_dependencies_handles`), so dependency references must be resolved handle→id when a consumer wires up its dependencies.

**Files:** `lib/electric/shapes/filter/indexes/subquery_index.ex`, `lib/electric/shapes/consumer/materializer.ex`, `consumer/subqueries/{move_broadcast,shape_info,splice_plan}.ex`, `consumer/event_handler/subqueries/steady.ex`, `consumer/event_handler/default.ex`, `consumer/event_handler_builder.ex`, `consumer/effects.ex`, `consumer/setup_effects.ex`, `shapes/subquery_tags.ex`; their tests; `test/integration/` subquery tests.

### Design note: dependency handle → id resolution

A consumer knows its own `shape_id` and its dependencies' **handles** (`shape.shape_dependencies_handles`). When wiring subquery dependencies (materializer subscriptions, splice plans, subquery index registration), resolve each dependency handle to its id **once at setup** via `ShapeStatus.id_for_handle/2`, and store the resolved dependency ids in consumer state next to the handles. Internal subquery routing then uses ids only. (Dependencies are guaranteed already created/registered before the dependent consumer starts — see `ShapeCache.safe_maybe_create_inner_shapes` and `restore_shape_and_dependencies`.)

### Steps

- [ ] **Step 1:** In consumer setup (`setup_effects.ex`/`effects.ex`), resolve `shape.shape_dependencies_handles` → dependency ids via `ShapeStatus.id_for_handle/2` and store as e.g. `shape_dependencies_ids` in consumer state. Add a failing test asserting the resolved ids are present.
- [ ] **Step 2:** `subquery_index.ex`: replace `shape_handle` with `shape_id` in every ETS tuple — `{:polarity, shape_id, subquery_ref}`, `{:fallback, shape_id}`, `{:node_shape, …}`, `{:shape_node, …}`, `{:shape_dep_node, …}`, `{:node_fallback, …}`, `{:membership, shape_id, subquery_ref, value}`, `{:node_*_member, …, shape_id, …}` — and in the public fns (`register_shape`, `unregister_shape`, `add_value`, `remove_value`, `member?`, `membership_or_fallback?`, `fallback?`). This is the core memory win. Update `subquery_index_test.exs` to use integer ids.
- [ ] **Step 3:** `materializer.ex`: the link-values ETS key and `name/2` switch to id (`Materializer.name(stack_id, shape_id)`; started with `shape_id` config in Chunk 2). `move_broadcast.ex`, `shape_info.ex`, `splice_plan.ex`, `steady.ex`, `default.ex`, `event_handler_builder.ex`, `subquery_tags.ex`: replace handle locals/keys with the resolved dependency ids / `state.shape_id`.
- [ ] **Step 4:** Run subquery unit + integration tests: `mix test test/electric/shapes/filter/indexes/subquery_index_test.exs` and `mix test test/integration` (subquery/tags suites). Commit: `refactor(subqueries): key subquery index + materializer by shape_id`.

---

## Chunk 5: Logging / telemetry / process-name lookups in id-only modules

**Outcome:** Any log/telemetry/label site that now has only an id (i.e. in modules converted in Chunks 3–4 that do not also hold the handle) resolves the handle via `ShapeStatus.shape_handle_for_log/2`. Sites that still hold the handle (Consumer, boundary) keep using it directly.

**Files:** sweep the converted modules; tests as needed.

- [ ] **Step 1:** `grep -rn "shape_handle" lib/electric/shapes lib/electric/replication` and review each remaining hit: it must be either (a) a genuine handle holder (Consumer state, storage call, client Registry) — leave it, or (b) a log/telemetry/`OpenTelemetry`/`Logger.metadata`/`Process.set_label` site in an id-only module — replace the value with `ShapeStatus.shape_handle_for_log(stack_id, shape_id)`.
- [ ] **Step 2:** Confirm no internal function signature accepts both a handle and an id (no `is_binary or is_integer` guards; no parameter named ambiguously). Fix any stragglers.
- [ ] **Step 3:** Run the whole suite: `mix test`. Expected: PASS. Run `mix format`.
- [ ] **Step 4:** Commit: `refactor: resolve handles for logging via ShapeStatus.shape_handle_for_log`.

---

## Final verification

- [ ] `mix format --check-formatted`
- [ ] `mix test` (full suite, dev services up) — all green.
- [ ] `grep -rn "shape_handle" lib/` and eyeball: remaining hits are only in the boundary set, storage set, the authority's external face, the Consumer (holds both), and the client `Registry`. No internal routing/filter/flush/subquery hit remains.
- [ ] Sanity-check memory intent: `SubqueryIndex`, `Filter`, `FlushTracker`, `EventRouter`, `ConsumerRegistry`, `RequestBatcher`, `Partitions` now hold integers, not binaries.
- [ ] Optional: consider a router/integration test that asserts `electric-handle` header round-trips unchanged for a reconnecting client (the external contract must be untouched).

---

## Risks & watch-points

- **Id re-minting on boot is intentional** — ids are not stable across restarts. Nothing may persist an id or send it to a client. The verification grep guards this.
- **`refresh/1` must preserve ids** for handles already in the meta table (Chunk 1 Step 8) so running consumers don't have the id changed under them.
- **Dependency handle→id resolution (Chunk 4)** assumes dependencies are registered before dependents start. If a future change makes dependency creation lazy, this resolution must move to first-use.
- **Two registries** — the most likely mistake is converting the client `Registry.dispatch`/`register_for_changes` to id. It must stay on handle.
- **`fetch_shape_by_id` adds an indirection** (id→handle→shape). It is only used at consumer-start (cold path), never per-change.
