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
- Storage: `lib/electric/shape_cache/storage.ex`, `pure_file_storage.ex` (+`pure_file_storage/shared_records.ex`), `in_memory_storage.ex`, `shape_status/shape_db.ex` (+`shape_db/query.ex`, `shape_db/connection.ex`), `lib/electric/postgres/snapshot_query.ex`
- The client change-notification Elixir `Registry`
- **Subquery tag hashing — MUST stay on handle (client + persistence + Postgres-side contract):** `lib/electric/shapes/subquery_tags.ex` and `lib/electric/shapes/consumer/subqueries/move_broadcast.ex`. `SubqueryTags.make_value_hash/3` computes `md5("#{stack_id}#{shape_handle}#{value}")`; this hash is emitted in `:tags`/`removed_tags` log headers (streamed to clients **and** persisted on disk) and **must byte-match** the Postgres-side hash built in `querying.ex` (`make_tags`/`tag_slot_sql`: `md5('#{stack_id}#{shape_handle}' || …)`). Both use the shape's *own* handle (`shape_info.shape_handle`), which the consumer already holds — no lookup needed. Switching to a per-boot id would corrupt the persisted log, break reconnecting clients, and diverge from the SQL side.
- **The cleaner straddles both:** `lib/electric/shape_cache/shape_cleaner.ex` (+`shape_cleaner/cleanup_task_supervisor.ex`) is *driven* by handles (its public API and storage cleanup are handle-based) but calls id-keyed routing fns; it resolves handle→id internally (see Chunk 3, Task 3f).

**Authority — gains the id and the `handle ↔ id` map:**
- `lib/electric/shape_cache/shape_status.ex`

**Carries both id and handle (the bridge):**
- `lib/electric/shapes/consumer.ex`, `consumer/state.ex`

**Converts to `shape_id`:**
- Routing: `lib/electric/shapes/consumer_registry.ex`, `event_router.ex`, `dependency_layers.ex`, `partitions.ex`, `dynamic_consumer_supervisor.ex`
- Replication: `lib/electric/replication/shape_log_collector.ex`, `shape_log_collector/request_batcher.ex`, `shape_log_collector/flush_tracker.ex`, `publication_manager.ex`, `publication_manager/relation_tracker.ex`
- Filter: `lib/electric/shapes/filter.ex`, `filter/index.ex`, `filter/where_condition.ex`, `filter/indexes/{equality,inclusion,subquery}_index.ex`
- Subquery/materializer: `consumer/materializer.ex`, `consumer/subqueries/{shape_info,splice_plan}.ex`, `consumer/event_handler/subqueries/steady.ex`, `consumer/event_handler/default.ex`, `consumer/event_handler_builder.ex`, `consumer/ref_resolver.ex`, `consumer/effects.ex`, `consumer/setup_effects.ex`, `consumer/snapshotter.ex`, `consumer/initial_snapshot.ex` (note: `subquery_tags.ex` and `move_broadcast.ex` are **excluded** — see the stays-on-handle set above)

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

- [ ] **Step 2: Write failing tests for id assignment + lookups.** In `test/electric/shape_cache/shape_status_test.exs`, add a describe block. **Follow this file's conventions:** tests take `ctx`, ETS tables are created by `ShapeStatus.initialize/1` via the `new_state(ctx)` helper (which returns the `stack_id`), and shape fixtures are `shape!/0` and `shape2!/0` (there is no `shape1`). The tables MUST be initialized before any `ShapeStatus` call or it raises `ArgumentError` on the missing table:

```elixir
describe "shape_id" do
  setup ctx do
    {:ok, stack_id, _} = new_state(ctx)
    %{stack_id: stack_id}
  end

  test "add_shape assigns a monotonic id and returns {handle, id}", %{stack_id: stack_id} do
    {:ok, {handle1, id1}} = ShapeStatus.add_shape(stack_id, shape!())
    {:ok, {handle2, id2}} = ShapeStatus.add_shape(stack_id, shape2!())

    assert is_binary(handle1) and is_integer(id1)
    assert id2 > id1
    assert {:ok, ^id1} = ShapeStatus.id_for_handle(stack_id, handle1)
    assert {:ok, ^handle1} = ShapeStatus.handle_for_id(stack_id, id1)
  end

  test "shape_handle_for_log returns the handle, or a fallback once removed", %{stack_id: stack_id} do
    {:ok, {handle, id}} = ShapeStatus.add_shape(stack_id, shape!())
    assert ShapeStatus.shape_handle_for_log(stack_id, id) == handle

    :ok = ShapeStatus.remove_shape(stack_id, handle)
    assert ShapeStatus.shape_handle_for_log(stack_id, id) == "unknown, id: #{id}"
  end
end
```

  (Confirm the exact arity/return of `new_state/1` in the file — if it returns `{:ok, state, opts}` where `state` is the stack_id string, destructure accordingly; the point is to initialize tables first and use the returned stack_id.)

- [ ] **Step 3: Run tests, verify they fail.** Run: `mix test test/electric/shape_cache/shape_status_test.exs -v` — Expected: FAIL (`id_for_handle/2` undefined, `add_shape` returns `{:ok, handle}`).

- [ ] **Step 4: Add the id table + counter + position constant.** In `shape_status.ex`:
  - Add `@shape_id_pos 6` near `@shape_last_used_time_pos 4`; update the tuple-format comment.
  - Add `defp shape_id_table(stack_id), do: :"shape_id_table:#{stack_id}"`.
  - In `create_shape_meta_table/1`, `ensure_state_table(shape_id_table(stack_id), read_concurrency: true, write_concurrency: :auto)` and `:ets.delete_all_objects(shape_id_table(stack_id))`.
  - In `reset/1` (note: arity 1, not 2), clear `shape_id_table` too.
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
- Modify: `lib/electric/shape_cache.ex` (`maybe_create_shape`, `start_shape`, `restore_shape_and_dependencies`, `build_shape_dependencies`, `start_consumer_for_handle` paths)
- Modify: `lib/electric/shapes/dynamic_consumer_supervisor.ex` (`start_child` reads `shape_id` from config; partition by id)
- Modify: `lib/electric/shapes/consumer.ex` (accept `shape_id` in `start_link`/`init` config, pass to `State.new`)
- Modify: `lib/electric/shapes/consumer/snapshotter.ex` (accept `shape_id` in config + state — required so `start_child` can partition by it)
- Modify: `lib/electric/shapes/consumer/state.ex` (add `:shape_id` field, accept in `new/2` and `new/3`)
- Test: `test/electric/shapes/consumer_test.exs`, `test/electric/shapes/consumer/state_test.exs`, `test/electric/shape_cache_test.exs`

> **Threading direction (important):** identity (`stack_id`, `shape_handle`) reaches the consumer via the **`start_link`/`init` config map**, NOT via the later `{:initialize_shape, …}`/`init_consumer` message (which carries `action`/`otel_ctx`/`feature_flags`). `shape_id` must be added to that `start_link` config map so it is present at `init/1` time — both because `State.new` is called there (`consumer.ex` `init/1` → `State.new(stack_id, shape_handle)`) and because Chunk 3 registers the consumer's `{:via, ConsumerRegistry, {stack_id, shape_id}}` name during init, which needs the id already in hand.

### Steps

- [ ] **Step 1: Add `:shape_id` to consumer state.** In `consumer/state.ex`: add `:shape_id` to the `defstruct` list (next to `:shape_handle`). Update **both** constructors — note the existing 3-ary `new(stack_id, shape_handle, shape)` (test-only) becomes 4-ary; this is a deliberate signature break, every caller moves with it:

```elixir
@spec new(Electric.stack_id(), Shape.handle(), Electric.shape_id(), Shape.t()) :: uninitialized_t()
def new(stack_id, shape_handle, shape_id, shape) do
  stack_id |> new(shape_handle, shape_id) |> initialize_shape(shape, %{})
end

@spec new(Electric.stack_id(), Shape.handle(), Electric.shape_id()) :: uninitialized_t()
def new(stack_id, shape_handle, shape_id) do
  %__MODULE__{stack_id: stack_id, shape_handle: shape_handle, shape_id: shape_id, ...}
end
```

  Keep `telemetry_attrs/1` using `state.shape_handle` directly — the consumer holds it, no lookup needed.

- [ ] **Step 2: Thread id from `ShapeCache` into `start_shape`.** In `shape_cache.ex`:
  - `maybe_create_shape`: capture the id from `add_shape` — `{:ok, {shape_handle, shape_id}} = ShapeStatus.add_shape(stack_id, shape)` (replaces the discard added in Chunk 1 Step 10) — and pass to `start_shape(shape_handle, shape_id, shape, opts)`.
  - On the existing-shape path (`fetch_handle_by_shape_critical` returns only a handle) resolve the id with `ShapeStatus.id_for_handle(stack_id, handle)` immediately after obtaining the handle.
  - In `restore_shape_and_dependencies`/`build_shape_dependencies` (the dependency loop at `shape_cache.ex:461` iterates `{handle, shape, opts}` tuples) **each inner handle needs its own `id_for_handle` lookup** before its `start_shape` call — there are multiple handles here, not one. Resolve per handle. This is the authority resolving once at consumer-start; cold path, not per-change.
  - `start_shape/4` passes `shape_id: shape_id` in the child configs to `DynamicConsumerSupervisor.start_shape_consumer` **and** `start_materializer`.

- [ ] **Step 3: Partition + log by id in the supervisor.** In `dynamic_consumer_supervisor.ex` `start_child/2`: read `%{shape_handle: shape_handle, shape_id: shape_id} = child_opts`; change `partition_for(stack_id, shape_id)` and `partition_for/2` to hash `shape_id`. Keep the debug log (prefer `shape_id`).
  - **Note (benign behavior change):** switching the partition hash key from handle to id changes which partition supervisor each shape lands in. This is invisible to routing — `ConsumerRegistry.whereis` resolves the pid via its own table, never by reconstructing a partition from the key; the partition supervisor only groups children for parallel shutdown. Since id is minted once per boot and `refresh/1` preserves it (Chunk 1 Step 8), a consumer partitions consistently for its whole life. If any test asserts partition placement, update it.

- [ ] **Step 4: Give every `start_child` caller a `shape_id` (or `start_child` crashes).** `start_child/2` is shared by `start_shape_consumer`, `start_materializer`, and `start_snapshotter`. Once it destructures `shape_id`, **every** config map must include it:
  - `consumer.ex` consumer config (Step 5).
  - `shape_cache.ex` materializer config (`start_shape/4`, Step 2).
  - **`consumer.ex` snapshotter config** (built where the consumer calls `DynamicConsumerSupervisor.start_snapshotter`, ~`consumer.ex:1205`): add `shape_id: state.shape_id`. The snapshotter doesn't route by it in this chunk — it only needs it so `start_child` can partition. Add `:shape_id` to `snapshotter.ex`'s state/config acceptance so it doesn't reject the key.

- [ ] **Step 5: Consumer accepts id in `start_link` config and passes to state.** In `consumer.ex`: add `shape_id` to the `start_link/1` config and the `init/1` destructure (`%{stack_id, shape_handle, shape_id}`), and pass it to `Consumer.State.new(stack_id, shape_handle, shape_id)`. The consumer's `start_link` config originates in `shape_cache.ex` `start_shape/4` (Step 2).

- [ ] **Step 6: Update tests.** 
  - `test/electric/shapes/consumer/state_test.exs`: every `State.new(stack_id, "test-handle", shape)` and `State.new(stack_id, "test-handle")` call moves to the new arity with an id argument.
  - `test/electric/shapes/consumer_test.exs`: any place that starts the Consumer directly with a `%{shape_handle, stack_id}` config adds `shape_id:`; assert it lands in state.
  - `test/electric/shape_cache_test.exs`: adjust for the `add_shape`→`{handle, id}` and `start_shape/4` changes.

- [ ] **Step 7: Run tests.** Run: `mix test test/electric/shapes/consumer_test.exs test/electric/shapes/consumer/state_test.exs test/electric/shape_cache_test.exs` — Expected: PASS.

- [ ] **Step 8: Commit.**

```bash
git add -A
git commit -m "feat(consumer): carry numeric shape_id alongside shape_handle"
```

---

## Chunk 3: Convert the routing pipeline to `shape_id`

**Outcome:** The SLC → EventRouter → ConsumerRegistry → Consumer routing path is keyed by id end-to-end. The consumer registers in `ConsumerRegistry` by id and adds itself to the SLC/EventRouter/Filter/Partitions/PublicationManager by id; it keeps the Elixir `Registry` (client changes) keyed by handle. This is the largest chunk — sub-tasks commit independently, but **certain flips must land in the same commit** (see the lockstep warning).

> Most target modules already type their identifier as `shape_id :: term()`/`any()` (`event_router.ex`, `flush_tracker.ex`, `partitions.ex`, `filter.ex`), so the edits are: stop passing the handle in, pass `state.shape_id` instead, rename `shape_handle` locals → `shape_id`, drop `is_shape_handle` guards. Behavior is identical — only the value carried changes.

> **⚠ LOCKSTEP WARNING — key producers are scattered across files.** A data structure keyed by id is only consistent if **every** producer and consumer of that key flips in the same commit. The three keys and their (verified) call sites:
> - **The routing/registration key** (ConsumerRegistry ETS + `{:via}` name + EventRouter/Filter add): produced by the consumer's `{:via, ConsumerRegistry, …}` name at `consumer.ex:56`, by `ShapeLogCollector.add_shape` called from **`consumer/setup_effects.ex:33`** (NOT `consumer.ex`), and consumed by SLC routing/`publish`. → Tasks 3a + 3c + 3d + 3e + **3f** must form one consistent set; commit them together if a sub-task would otherwise leave the EventRouter holding a mix of handle-keyed adds and id-keyed routing.
> - **The flush key** (`{:writer_flushed, …}` cast → FlushTracker): produced by `ShapeLogCollector.notify_flushed` called from **`consumer.ex:1133`, `consumer.ex:1160`, AND `consumer/effects.ex:326`**. All three must flip with FlushTracker (Task 3f).
> - **The removal key** (ConsumerRegistry/SLC/PublicationManager remove): driven by **`shape_cleaner.ex` / `cleanup_task_supervisor.ex`**, which hold only the handle and run *after* `ShapeStatus.remove_shape` has deleted the id mapping (Task 3f handles the ordering).

### Task 3a: `ConsumerRegistry` keyed by id

**Files:** `lib/electric/shapes/consumer_registry.ex`; `test/electric/shapes/consumer_registry_test.exs`; callers `consumer.ex`, `shape_cache.ex`.

- [ ] **Step 1:** Replace `shape_handle` with `shape_id` throughout `consumer_registry.ex`: the `{:via, __MODULE__, {stack_id, shape_id}}` name, `register_name`/`whereis_name`/`whereis`, the ETS `{shape_id, pid}` rows, `register_consumer*`, `do_remove_consumer`, `consumer_pid`, `publish/2` (`events_by_id`), `resolve_and_broadcast`, `broadcast` (keys are ids), `enable_suspend` foldl. Drop the `is_shape_handle/1` guards (use `is_integer/1` where a guard is wanted).
- [ ] **Step 2:** `start_consumer!/2` now has an id. Change `ShapeCache.start_consumer_for_handle(handle, …)` → `ShapeCache.start_consumer_for_id(id, …)` (Task 3b). For the telemetry/log lines inside `start_consumer!`, use `ShapeStatus.shape_handle_for_log(stack_id, id)` so the readable handle still appears.
- [ ] **Step 3:** Update `Consumer.name/2`, `whereis/2`, `register_*` (`consumer.ex`) to pass `state.shape_id`. The consumer's `{:via}` name resolves at `init/1` time, so `shape_id` MUST already be in the `start_link` config — confirm Chunk 2 Step 5 delivered it (not just post-init state).
- [ ] **Step 4:** Update `consumer_registry_test.exs` to register/look up by integer ids. Run `mix test test/electric/shapes/consumer_registry_test.exs`. Commit (with 3b): `refactor(consumer_registry): key consumer routing by shape_id`.

### Task 3b: `ShapeCache.start_consumer_for_id`

**Files:** `lib/electric/shape_cache.ex`; `test/electric/shape_cache_test.exs`.

- [ ] Add `start_consumer_for_id(shape_id, stack_id, opts)` mirroring `start_consumer_for_handle`, and a `{:start_consumer_for_id, shape_id, otel_ctx}` `handle_call` that does `ShapeStatus.fetch_shape_by_id(stack_id, shape_id)`, resolves the handle via `ShapeStatus.handle_for_id`, then `restore_shape_and_dependencies(handle, shape_id, shape, …)`. Remove `start_consumer_for_handle` — `ConsumerRegistry.start_consumer!` (consumer_registry.ex:271) is its only caller (verified). Also confirm `restore_shape_and_dependencies` registers/looks up consumers by id (it calls `ConsumerRegistry.whereis` at `shape_cache.ex:462` — pass the inner shape's id resolved in Chunk 2 Step 2). Update tests.

### Task 3c: `EventRouter` + `Filter` (non-subquery) keyed by id

**Files:** `lib/electric/shapes/event_router.ex`, `filter.ex`, `filter/index.ex`, `filter/where_condition.ex`, `filter/indexes/{equality,inclusion}_index.ex` (subquery index stays untouched here — Chunk 4); tests `test/electric/shapes/event_router_test.exs`, `test/electric/shapes/filter_test.exs`, filter index tests.

- [ ] These are already generic (`shape_id :: any()`). Confirm `filter.ex`'s `maybe_register_subquery_shape` passes the key straight through to `SubqueryIndex` without inspecting it (so leaving the subquery index on the old representation until Chunk 4 is safe — the key it receives is whatever the consumer passes). Rename `shape_handle` locals/specs → `shape_id`; rename `event_by_shape_handle/2` → `event_by_shape_id/2` and its result map. No guards to drop (none present).
- [ ] Update tests to add/route by integer ids (they currently pass string handles as the generic id — swap to integers). Run `mix test test/electric/shapes/filter_test.exs test/electric/shapes/event_router_test.exs`.

### Task 3d: SLC, `RequestBatcher`, `FlushTracker`, `Partitions`, `DependencyLayers`, `PublicationManager` keyed by id

**Files:** `lib/electric/replication/shape_log_collector.ex` (+`request_batcher.ex`, `flush_tracker.ex`), `lib/electric/shapes/partitions.ex`, `dependency_layers.ex`, `lib/electric/replication/publication_manager.ex` (+`relation_tracker.ex`); corresponding tests.

- [ ] **SLC core:** `add_shape(stack_id, shape_id, shape, operation)`, `remove_shape(stack_id, shape_id)`, the `{:writer_flushed, shape_id, offset}` cast + `notify_flushed/3` spec, and the `EventRouter`/`ConsumerRegistry`/`Partitions` calls switch to id. Delete the dead `pids_by_shape_handle` state field (declared SLC:244, `Map.delete`'d at :787, never inserted — verified dead). `request_batcher.ex`: `to_add`/`to_remove`/`to_schedule_waiters` keyed by id (rename type aliases). `flush_tracker.ex`: already `shape_id :: term()` — callers change only.
- [ ] **SLC restore path (do not miss):** `handle_continue(:restore_shapes)` (SLC:277–298) and `restore_partitions_for_shape` (SLC:351) reduce over `ShapeStatus.list_shapes/1`, which returns `{handle, shape}` tuples, and feed `EventRouter.add_shape`/`Partitions.add_shape`/`DependencyLayers.add_dependency`. Resolve each handle → id via `ShapeStatus.id_for_handle/2` (ids were minted at boot in Chunk 1 Step 8) before adding, so restored structures are id-keyed like live routing.
- [ ] **PublicationManager/RelationTracker:** `add_shape`/`remove_shape` and the tracked ETS switch to id; rename `tracked_handles_table` → `tracked_shapes_table`. **Its only callers are the snapshotter's `add_shape` and the cleaner's `remove_shape` (Task 3f)** — flip those in the same commit (verified: `add_shape` ← `snapshotter.ex:64`, `remove_shape` ← `cleanup_task_supervisor.ex:95`).
- [ ] Update tests to integer ids. Run `mix test test/electric/replication test/electric/shapes/partitions_test.exs`.

### Task 3e: Flip the Consumer's own routing calls to id

**Files:** `lib/electric/shapes/consumer.ex`; `test/electric/shapes/consumer_test.exs`.

- [ ] In `consumer.ex`, pass `state.shape_id` to: `ConsumerRegistry.name/register/whereis`, `EventRouter`/`Filter`/`Partitions`/`FlushTracker` interactions, `DynamicConsumerSupervisor` lookups, and the two `ShapeLogCollector.notify_flushed` calls (`:1133`, `:1160`).
- [ ] **Keep on handle (do NOT change):** `Consumer.register_for_changes/2` and `Registry.dispatch(Electric.StackSupervisor.registry_name(stack_id), state.shape_handle, …)` (client pub-sub, `consumer.ex:59`/`:1041`); all `Storage.*` calls; `Process.set_label({:consumer, state.shape_handle})` (already holds the handle — no lookup).
- [ ] Update `consumer_test.exs`. (Full end-to-end run happens after 3f.)

### Task 3f: Lockstep — the remaining key producers + cleaner ordering

The producers that live outside `consumer.ex`/`consumer_registry.ex` and the cleaner's id resolution. Land this with 3c/3d/3e so no structure is left mixed-key.

**Files:** `lib/electric/shapes/consumer/setup_effects.ex`, `consumer/effects.ex`, `consumer/snapshotter.ex`, `lib/electric/shape_cache/shape_cleaner.ex`, `shape_cleaner/cleanup_task_supervisor.ex`; their tests.

- [ ] **Add path:** `setup_effects.ex:33` — `ShapeLogCollector.add_shape(state.stack_id, state.shape_id, state.shape, action)` (was `state.shape_handle`). Also flip `SubqueryIndex.mark_ready(index, state.shape_id)` at `setup_effects.ex:64` only if Chunk 4 hasn't run yet — **NO**: the subquery index is still handle-keyed until Chunk 4, so `mark_ready` stays on `state.shape_handle` here and flips in Chunk 4. Be precise: in 3f, change only the `ShapeLogCollector.add_shape` arg in this file.
- [ ] **Flush path:** `effects.ex:326` — `ShapeLogCollector.notify_flushed(state.stack_id, state.shape_id, log_offset)` (was `state.shape_handle`). With this + the two consumer.ex calls (3e) + FlushTracker (3d), the flush key is fully id.
- [ ] **Publication add:** `snapshotter.ex:64` — `PublicationManager.add_shape(…, state.shape_id, …)`. Requires `shape_id` in snapshotter state (Chunk 2 Step 4).
- [ ] **Removal path + ordering (the subtle one — two phases).** `ShapeStatus.remove_shape` deletes the id mapping, so the id must be captured *before* it and threaded to every id-keyed removal across **both** the immediate and deferred phases (`remove_shapes` → `remove_shapes_immediate` → `remove_shapes_deferred` → `CleanupTaskSupervisor.cleanup_async`):
  - In `remove_shape_immediate/3` (`shape_cleaner.ex`): resolve `id = ShapeStatus.id_for_handle(stack_id, shape_handle)` **before** `ShapeStatus.remove_shape`. Pass the id to the now-id-keyed `Consumer.stop` and `ShapeLogCollector.remove_shape` in the same `with` chain. `Storage.cleanup!` stays on handle. On `:error` (already gone) skip the id-keyed removals.
  - Thread the id to the deferred phase: change `remove_shapes_immediate`'s return from bare `valid_handles` to **`[{handle, id}]` pairs**, and propagate through `remove_shapes_deferred` → `CleanupTaskSupervisor.cleanup_async(stack_id, [{handle, id}])`.
  - In `cleanup_task_supervisor.ex`: `cleanup_publication_manager/2` uses the **id** → `PublicationManager.remove_shape(stack_id, id)`; `notify_shape_rotation/2` keeps the **handle** for the client `Registry.dispatch` (stays on handle). Both read from the same `{handle, id}` pair.
- [ ] **Suspend path (separate removal-key producer):** `shape_cleaner.ex:112` `handle_writer_termination(_, _, @shutdown_suspend)` calls `ConsumerRegistry.remove_consumer(shape_handle, stack_id)` directly, bypassing `remove_shape_immediate`. The shape is NOT removed from ShapeStatus here, so resolve `ShapeStatus.id_for_handle` (mapping intact) and pass the id to `remove_consumer`.
- [ ] **Test-support producer (flip in the same commit — THREE touch points):** `test/support/transaction_consumer.ex` has three id-keyed sites: the `{:via}` name `ConsumerRegistry.name(stack_id, shape_handle)` (lines 8–9), `ShapeLogCollector.add_shape(stack_id, shape_handle, …)` (line 73), and the symmetric `ShapeLogCollector.remove_shape(stack_id, shape_handle)` in `terminate/2` (line 113). Add a `shape_id` opt, store it in state, and use it for **all three**. Flipping `add_shape` without `remove_shape` leaves an id-keyed add paired with a handle-keyed remove — a silent mixed-key leak (the very corruption the lockstep warning guards against), and the id-keyed SLC `publish` would never reach a handle-registered helper, failing the routing tests.
- [ ] Update affected tests. Run the full routing surface: `mix test test/electric/replication test/electric/shapes test/electric/shape_cache test/electric/plug/router_test.exs`. Commit 3c–3f together: `refactor(routing): key shape routing, flush, and removal by shape_id`.

> **Removal-key producer checklist (the lockstep set must be complete):** (1) `remove_shape_immediate` → `Consumer.stop` + `SLC.remove_shape`; (2) deferred `cleanup_publication_manager` → `PublicationManager.remove_shape`; (3) suspend clause `shape_cleaner.ex:112` → `ConsumerRegistry.remove_consumer`; (4) `consumer_registry.ex:99` suspend foldl (Task 3a); (5) `shape_log_collector.ex:799` SLC self-remove (Task 3d). All five flip together.

---

## Chunk 4: Subquery / materializer subsystem to `shape_id`

**Outcome:** The subquery index (the biggest memory amplifier — handle repeated 4–6× per node) and the materializer/dependency machinery key by id. This chunk is separate because shapes persist **dependency handles** (`shape.shape_dependencies_handles`), so dependency references must be resolved handle→id when a consumer wires up its dependencies.

**Files:** `lib/electric/shapes/filter/indexes/subquery_index.ex`, `lib/electric/shapes/consumer/materializer.ex`, `consumer/subqueries/{shape_info,splice_plan}.ex`, `consumer/event_handler/subqueries/steady.ex`, `consumer/event_handler/default.ex`, `consumer/event_handler_builder.ex`, `consumer/ref_resolver.ex`, `consumer/effects.ex`, `consumer/setup_effects.ex`; their tests; `test/integration/` subquery tests.

> **EXCLUDED (must stay on handle):** `consumer/subqueries/move_broadcast.ex` and `shapes/subquery_tags.ex`. Their `make_value_hash` feeds the `:tags` log headers (streamed + persisted) and must byte-match the Postgres-side `md5('#{stack_id}#{shape_handle}' || …)` in `querying.ex`. They use the shape's *own* handle, which the consumer holds — leave entirely as-is. See the stays-on-handle note in the Files reference.

### Design note: dependency handle → id resolution

A consumer knows its own `shape_id` and its dependencies' **handles** (`shape.shape_dependencies_handles`). The dependency-handle map that drives subquery routing is built in **`consumer/event_handler_builder.ex` `build/2`** (it constructs the `RefResolver` keyed on dep handles, e.g. `dep_handle_to_ref`/`handle_to_ref`), and consumed by `Steady.handle_event({:materializer_changes, dep, …})` via `ref_from_dep_handle!`. Since the materializer will send a dep **id** in that message (Step 3), the `RefResolver` must be rebuilt to key on dep **ids**. So: in `event_handler_builder.build/2` (and `ref_resolver.ex`), resolve each dep handle → id via `ShapeStatus.id_for_handle/2` and key the resolver on ids. Also update the `shape_dependencies_handles` read sites in **`materializer.ex` `get_all_as_refs/2` / `get_link_values`** (`materializer.ex:94–104`) to use the resolved dep ids.

Ordering is sound (verified): inner shapes are created — and their ids minted in `ShapeStatus.add_shape` — before the outer shape in `safe_maybe_create_inner_shapes` (`shape_cache.ex:405–417`); on restore, `populate_shape_meta_table` mints ids for all handles at boot before any consumer starts; and `event_handler_builder.build/2` additionally `Materializer.wait_until_ready`s each dep. So `id_for_handle` at setup cannot miss.

### Steps

- [ ] **Step 1:** In `event_handler_builder.ex` `build/2` (and `ref_resolver.ex`), resolve `shape.shape_dependencies_handles` → dependency ids via `ShapeStatus.id_for_handle/2` and key the `RefResolver` on ids. Add a failing test asserting the resolver maps a `{:materializer_changes, dep_id, …}` message to the right ref.
- [ ] **Step 2:** `subquery_index.ex`: replace the shape identifier with `shape_id` in **every** ETS tuple — `{:polarity, shape_id, subquery_ref}`, `{:fallback, shape_id}`, `{:node_shape, …}`, `{:shape_node, …}`, `{:shape_dep_node, …}`, `{:node_fallback, …}`, **`{:node_negated_shape, node_id, shape_id, next_condition_id}`** (do not omit this one — it feeds `negated_shapes_for/2` → `affected_shapes/4`), `{:membership, shape_id, subquery_ref, value}`, `{:node_positive_member, …, shape_id, …}`, `{:node_negated_member, …, shape_id, …}` — and in the public fns (`register_shape`, `unregister_shape`, `add_value`, `remove_value`, `member?`, `membership_or_fallback?`, `fallback?`, `negated_shapes_for`). This is the core memory win. Update `subquery_index_test.exs` to integer ids.
- [ ] **Step 3:** `materializer.ex`: link-values ETS key and `name/2` switch to id (`Materializer.name(stack_id, shape_id)`; started with `shape_id` config in Chunk 2); `get_all_as_refs/2`/`get_link_values` use resolved dep ids; the `{:materializer_changes, shape_id, …}` message carries the dep id. `shape_info.ex`, `splice_plan.ex`, `steady.ex`, `default.ex`: replace handle locals/keys with the resolved dependency ids / `state.shape_id`. **Leave any `shape_info.shape_handle` use that flows into `MoveBroadcast`/`SubqueryTags` on the handle** (the excluded modules consume it).
- [ ] **Step 4:** `setup_effects.ex:64` — flip `SubqueryIndex.mark_ready(index, state.shape_id)` now that the subquery index is id-keyed (it was deliberately left on handle in Task 3f). Flip any remaining `setup_effects.ex`/`effects.ex` subquery-index calls (`update_subquery_index`, `SeedSubqueryIndex`) to ids.
- [ ] **Step 5:** Run subquery unit + integration tests: `mix test test/electric/shapes/filter/indexes/subquery_index_test.exs` and `mix test test/integration` (subquery/tags suites). Commit: `refactor(subqueries): key subquery index + materializer by shape_id`.

---

## Chunk 5: Logging / telemetry / process-name lookups in id-only modules

**Outcome:** Any log/telemetry/label site that now has only an id (i.e. in modules converted in Chunks 3–4 that do not also hold the handle) resolves the handle via `ShapeStatus.shape_handle_for_log/2`. Sites that still hold the handle (Consumer, boundary) keep using it directly.

**Files:** sweep the converted modules; tests as needed.

- [ ] **Step 1:** `grep -rn "shape_handle" lib/electric/shapes lib/electric/replication` and classify each remaining hit into **three** buckets:
  - (a) **Genuine handle holder** (Consumer state, storage call, client `Registry`) — leave it.
  - (b) **Client-facing or persisted/Postgres-matched value** (`subquery_tags.ex`, `move_broadcast.ex`, storage path keys) — leave it; this is a correct retention, NOT a missed conversion. Do not "fix" it to an id.
  - (c) **Log/telemetry/`OpenTelemetry`/`Logger.metadata`/`Process.set_label` in an id-only module** — replace the value with `ShapeStatus.shape_handle_for_log(stack_id, shape_id)`.
  Only bucket (c) changes.
- [ ] **Step 2:** Confirm no internal function signature accepts both a handle and an id (no `is_binary or is_integer` guards; no parameter named ambiguously). Fix any stragglers.
- [ ] **Step 3:** Run the whole suite: `mix test`. Expected: PASS. Run `mix format`.
- [ ] **Step 4:** Commit: `refactor: resolve handles for logging via ShapeStatus.shape_handle_for_log`.

---

## Final verification

- [ ] `mix format --check-formatted`
- [ ] `mix test` (full suite, dev services up) — all green.
- [ ] `grep -rn "shape_handle" lib/` and eyeball: remaining hits are only in the boundary set, storage set, the authority's external face, the Consumer (holds both), the client `Registry`, and the **subquery-tag hashing** (`subquery_tags.ex`/`move_broadcast.ex`). No internal routing/filter/flush hit remains.
- [ ] Sanity-check memory intent: `SubqueryIndex`, `Filter`, `FlushTracker`, `EventRouter`, `ConsumerRegistry`, `RequestBatcher`, `Partitions` now hold integers, not binaries.
- [ ] **Subquery-tag stability (guards the client/persistence contract):** a subquery integration test asserting the `:tags`/`removed_tags` header bytes for a move-in then move-out are produced by the handle-derived hash and are **identical before vs. after this refactor** (and stable across a consumer restart). This is the positive check that an id did not leak into the tag hash.
- [ ] Router/integration test asserting the `electric-handle` header round-trips unchanged for a reconnecting client (the external contract must be untouched).
- [ ] Grep for any id reaching the wire: confirm no `shape_id` appears in `api/response.ex`, log-item headers, or any client-serialized payload.

---

## Risks & watch-points

- **Id re-minting on boot is intentional** — ids are not stable across restarts. Nothing may persist an id or send it to a client. The verification grep guards this.
- **`refresh/1` must preserve ids** for handles already in the meta table (Chunk 1 Step 8) so running consumers don't have the id changed under them.
- **Dependency handle→id resolution (Chunk 4)** assumes dependencies are registered before dependents start. If a future change makes dependency creation lazy, this resolution must move to first-use.
- **Two registries** — the most likely mistake is converting the client `Registry.dispatch`/`register_for_changes` to id. It must stay on handle.
- **Subquery tag hash is part of the client + Postgres contract** — `SubqueryTags.make_value_hash` (`md5("#{stack_id}#{shape_handle}…")`) is streamed/persisted in `:tags` headers and must byte-match `querying.ex`'s Postgres-side `md5('#{stack_id}#{shape_handle}' || …)`. `subquery_tags.ex` and `move_broadcast.ex` MUST stay on handle. The grep in Chunk 5 Step 1 is three-way precisely to avoid "fixing" these.
- **Lockstep key flips** — the routing/flush/removal keys have producers scattered across `consumer.ex`, `setup_effects.ex`, `effects.ex`, `snapshotter.ex`, and the cleaner. Each key's producers + consumers must flip in one commit, or a structure ends up mixed handle/id-keyed (silent mis-route or stuck flush, not a compile error). See Chunk 3's lockstep warning.
- **Cleaner ordering** — resolve `id_for_handle` BEFORE `ShapeStatus.remove_shape` deletes the mapping (Task 3f).
- **`fetch_shape_by_id` adds an indirection** (id→handle→shape). It is only used at consumer-start (cold path), never per-change.
