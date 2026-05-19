# Cheap Admission Control (Tier 0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make admission control cheap enough to run at the top of every shape request, and reclassify requests off the `:initial` bucket as soon as their PG-side work is done so the cap on initial requests bounds *snapshot creation pressure*, not full request lifetime.

**Architecture:** Two changes, both confined to `ServeShapePlug`'s pipeline:

1. **Cheap Tier 0 classifier.** Replace `:resolve_existing_shape` (which falls through to a SQLite read via `ShapeDb.handle_for_shape` and runs before admission) with a single `:ets.member/2` call on the per-stack shape-meta table. Move `:check_admission` to the front of the pipeline.
2. **Post-`load_shape` reclassification.** After `load_shape` returns, swap the handler's permit from `:initial` to `:existing` atomically. The `:initial` bucket then bounds requests currently in the validate-and-load phase (which funnels through the ShapeCache GenServer and may spawn Snapshotters), not requests currently streaming bytes to clients.

No new modules, no GenServer calls on the admission path, no SQLite on the admission path. HTTP protocol unchanged.

**Tech Stack:** Elixir, Plug, ETS (named tables with `:public` + `:read_concurrency`), existing `Electric.AdmissionControl` GenServer for table ownership.

---

## Background

`ServeShapePlug` today runs `:resolve_existing_shape` before `:check_admission`. Inside `resolve_existing_shape` is a call to `Electric.Shapes.fetch_handle_by_shape/2`, which goes through `ShapeStatus.fetch_handle_by_shape/2` → `ShapeDb.handle_for_shape/2` — a SQLite read. Every request, including the ones admission is about to reject, pays this cost. Issue #4266 identifies this as bottleneck 1 on the pre-admission path.

Additionally, the admission permit acquired in `:check_admission` is held until `Api.Response.send_stream/2` finishes draining the body. For an initial snapshot of a large shape, or a long-poll, that's seconds to minutes. The `:initial` bucket therefore caps "requests anywhere in their lifetime that started without a known handle", not "requests currently exerting snapshot pressure".

This plan does not introduce Tier 2 handler-local waiting or Tier 3 rendezvous. It only addresses Tier 0 (cheap classification) and the bucket-residency mismatch (post-`load_shape` reclassification).

## Design summary

### Cheap Tier 0 classifier

```elixir
defp admission_kind(%Conn{assigns: %{config: config}} = conn) do
  stack_id = get_in(config, [:stack_id])
  handle = conn.query_params["handle"]

  cond do
    is_nil(handle) -> :initial
    ShapeStatus.has_shape_handle?(stack_id, handle) -> :existing
    true -> :initial
  end
rescue
  ArgumentError -> :initial
end
```

`ShapeStatus.has_shape_handle?/2` at `lib/electric/shape_cache/shape_status.ex:262` is `:ets.member(shape_meta_table(stack_id), shape_handle)` — pure ETS, no SQLite, no GenServer. The `ArgumentError` rescue handles the startup race where the per-stack meta table doesn't exist yet.

Properties that fall out of using this signal:
- Fresh node, empty disk: every `has_shape_handle?` returns false → every request `:initial`.
- Pre-init (meta table not created): rescue → `:initial`.
- Restart with shape logs on disk: per-handle classification. Locally-known handle → `:existing`. Stale-from-old-deploy handle → `:initial`.
- Stack tear-down: meta table gone → rescue → `:initial`.

### Post-`load_shape` reclassification

A new plug `:reclassify_admission_kind` runs after `:load_shape` and before `:serve_shape_response`. If the handler currently holds an `:initial` permit, it atomically decrements `:initial` and increments `:existing`. If `:existing` is at cap, the handler keeps its `:initial` permit — the request still completes, just charged to the wrong bucket.

A new `AdmissionControl.try_swap/4` performs the atomic accounting in a **single** `:ets.update_counter` call on the success path. The 4-tuple op form `{Pos, Incr, Threshold, SetValue}` encodes the cap check, and a list of ops on the same row is one atomic update — so both columns move together, with no transient mid-state where the total in-flight count is wrong.

```elixir
def try_swap(stack_id, from_kind, to_kind, opts)
    when from_kind in @allowed_kinds and to_kind in @allowed_kinds do
  table = Keyword.get(opts, :table_name, @table_name)
  cap   = Keyword.fetch!(opts, :max_concurrent)
  to_pos   = tuple_pos(to_kind)
  from_pos = tuple_pos(from_kind)

  # Atomically: to_kind += 1 (clamped to cap+1 if it would exceed cap),
  #             from_kind -= 1 (clamped at 0).
  # Both ops on the same row → fully atomic; from+to invariant holds.
  [new_to, _new_from] =
    :ets.update_counter(
      table,
      stack_id,
      [{to_pos, 1, cap, cap + 1}, {from_pos, -1, 0, 0}],
      {stack_id, 0, 0}
    )

  if new_to > cap do
    # Rejected. Roll back both columns atomically. During the brief
    # mid-state, the row sits at cap + 1, so any concurrent try_acquire
    # on to_kind also rejects — same outcome it would have produced
    # anyway, so no false acceptance.
    :ets.update_counter(
      table,
      stack_id,
      [{to_pos, -1, 0, 0}, {from_pos, 1}],
      {stack_id, 0, 0}
    )

    {:error, :overloaded}
  else
    :ok
  end
end
```

The threshold form's semantics: when `Incr > 0` and the result would exceed `Threshold`, the counter is set to `SetValue` instead of the natural sum. Picking `SetValue = cap + 1` (rather than `cap`) makes the return value distinguish "filled the last slot" (returns `cap`) from "rejected at cap" (returns `cap + 1`).

| Before | After op | Return | Meaning |
|---|---|---|---|
| 5 | 6 | 6 | success |
| 9 | 10 | 10 | success (filled the last slot) |
| 10 | clamped to 11 | 11 | rejected (was already at cap) |

The rollback's `from_pos` increment is unclamped (`{from_pos, +1}`) because we know `from` was just decremented in this swap, so it's ≥ 0; adding 1 can only land back at a valid value.

### What the `:initial` bucket protects after this change

The `:initial` cap bounds **how many requests can be in the validate-and-load phase concurrently**. That phase contains the only synchronous funnels into the ShapeCache GenServer mailbox and the only path that can spawn Snapshotters. Streaming, which is the dominant cost of a snapshot delivery, is on the `:existing` cap.

## File Structure

- Modify: `lib/electric/admission_control.ex` — add `try_swap/4`. No new ETS tables.
- Modify: `lib/electric/plug/serve_shape_plug.ex` — move `:check_admission` to the front; delete `:resolve_existing_shape`; add `:reclassify_admission_kind`; rewrite `admission_kind/1` to use `has_shape_handle?/2`.
- Modify: `test/electric/admission_control_test.exs` — add `try_swap/4` tests.
- Modify: `test/electric/plug/router_test.exs` — add tests asserting bucket classification and reclassification at the router level.
- Create: `.changeset/cheap-admission-control.md`.

---

## Task 1: `try_swap/4` in `AdmissionControl`

**Files:**
- Modify: `lib/electric/admission_control.ex`
- Test: `test/electric/admission_control_test.exs`

- [ ] **Step 1: Write the failing tests**

Add to `test/electric/admission_control_test.exs`:

```elixir
describe "try_swap/4" do
  setup do
    table_name = :"swap_counter_#{System.unique_integer([:positive])}"
    {:ok, _} = start_supervised({AdmissionControl, table_name: table_name, name: nil})
    %{table_name: table_name}
  end

  test "moves the in-flight count from :initial to :existing", %{table_name: t} do
    :ok = AdmissionControl.try_acquire("s", :initial, table_name: t, max_concurrent: 10)
    assert %{initial: 1, existing: 0} = AdmissionControl.get_current("s", table_name: t)

    assert :ok =
             AdmissionControl.try_swap("s", :initial, :existing,
               table_name: t,
               max_concurrent: 10
             )

    assert %{initial: 0, existing: 1} = AdmissionControl.get_current("s", table_name: t)
  end

  test "returns {:error, :overloaded} when the destination bucket is full",
       %{table_name: t} do
    # Saturate :existing.
    for _ <- 1..3 do
      :ok = AdmissionControl.try_acquire("s", :existing, table_name: t, max_concurrent: 3)
    end

    :ok = AdmissionControl.try_acquire("s", :initial, table_name: t, max_concurrent: 10)

    assert {:error, :overloaded} =
             AdmissionControl.try_swap("s", :initial, :existing,
               table_name: t,
               max_concurrent: 3
             )

    # On failure, source must be unchanged.
    assert %{initial: 1, existing: 3} = AdmissionControl.get_current("s", table_name: t)
  end

  test "is atomic under concurrent swap attempts at the cap", %{table_name: t} do
    # Acquire 10 :initial permits, cap :existing at 5, run 10 concurrent swaps,
    # exactly 5 should succeed.
    for _ <- 1..10 do
      :ok = AdmissionControl.try_acquire("s", :initial, table_name: t, max_concurrent: 100)
    end

    tasks =
      for _ <- 1..10 do
        Task.async(fn ->
          AdmissionControl.try_swap("s", :initial, :existing,
            table_name: t,
            max_concurrent: 5
          )
        end)
      end

    results = Task.await_many(tasks)
    assert Enum.count(results, &(&1 == :ok)) == 5
    assert Enum.count(results, &(&1 == {:error, :overloaded})) == 5
    assert %{initial: 5, existing: 5} = AdmissionControl.get_current("s", table_name: t)
  end
end
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `mix test test/electric/admission_control_test.exs`

Expected: `UndefinedFunctionError` for `try_swap/4`.

- [ ] **Step 3: Implement `try_swap/4`**

Add to `lib/electric/admission_control.ex`:

```elixir
  @doc """
  Atomically move an in-flight permit from `from_kind` to `to_kind` for a
  stack.

  On the success path this is a single `:ets.update_counter/4` call:
  both counters move together, so the total in-flight count
  (`from + to`) is invariant throughout. Returns `:ok`.

  When `to_kind` is at capacity the result is rolled back with a second
  atomic op and `{:error, :overloaded}` is returned; `from_kind` is left
  unchanged from the caller's perspective. During the brief mid-state
  the destination row sits at `cap + 1`, so any concurrent
  `try_acquire(to_kind)` also rejects — the same outcome it would
  produce anyway.

  ## Options

    * `:max_concurrent` — required. Cap for `to_kind`.
    * `:table_name` — ETS table (default: `:electric_admission_control`).

  """
  def try_swap(stack_id, from_kind, to_kind, opts)
      when from_kind in @allowed_kinds and to_kind in @allowed_kinds do
    table = Keyword.get(opts, :table_name, @table_name)
    cap = Keyword.fetch!(opts, :max_concurrent)
    to_pos = tuple_pos(to_kind)
    from_pos = tuple_pos(from_kind)
    default = {stack_id, 0, 0}

    [new_to, _new_from] =
      :ets.update_counter(
        table,
        stack_id,
        [{to_pos, 1, cap, cap + 1}, {from_pos, -1, 0, 0}],
        default
      )

    if new_to > cap do
      :ets.update_counter(
        table,
        stack_id,
        [{to_pos, -1, 0, 0}, {from_pos, 1}],
        default
      )

      :telemetry.execute(
        [:electric, :admission_control, :swap_rejected],
        %{count: 1, limit: cap},
        %{stack_id: stack_id, from: from_kind, to: to_kind}
      )

      {:error, :overloaded}
    else
      :telemetry.execute(
        [:electric, :admission_control, :swap],
        %{count: 1, current: new_to, limit: cap},
        %{stack_id: stack_id, from: from_kind, to: to_kind}
      )

      :ok
    end
  end
```

The `swap` / `swap_rejected` telemetry mirrors the existing `acquire` / `reject` events.

- [ ] **Step 4: Run tests to verify they pass**

Run: `mix test test/electric/admission_control_test.exs`

Expected: all green, including the three new tests.

- [ ] **Step 5: Commit**

```bash
git add lib/electric/admission_control.ex test/electric/admission_control_test.exs
git commit -m "feat(sync-service): add AdmissionControl.try_swap/4

Atomically moves an in-flight permit between buckets. Returns
{:error, :overloaded} when the destination is at cap and leaves the source
unchanged. Used by the upcoming reclassification step in ServeShapePlug."
```

---

## Task 2: Move admission to the front and add reclassification

**Files:**
- Modify: `lib/electric/plug/serve_shape_plug.ex`
- Test: `test/electric/plug/router_test.exs`
- Test: `test/electric/plug/serve_shape_plug_test.exs` (if it has admission-classification tests today, update those expectations)

- [ ] **Step 1: Write the failing router tests**

Add a `describe "admission control (Tier 0)"` block in `test/electric/plug/router_test.exs`. Copy the existing test setup helper from a passing router test in the same file — do not invent a new bootstrap. Inside:

```elixir
describe "admission control (Tier 0)" do
  setup ctx do
    ctx = with_running_stack(ctx)
    config =
      put_in(ctx.config, [:api, :max_concurrent_requests], %{initial: 1, existing: 5})

    %{stack_id: ctx.stack_id, config: config}
  end

  test "request without ?handle= is charged :initial at admission",
       %{stack_id: stack_id, config: config} do
    # Saturate :initial.
    :ok =
      Electric.AdmissionControl.try_acquire(stack_id, :initial, max_concurrent: 1)

    conn = conn(:get, "/v1/shape?table=items")
    conn = Electric.Plug.Router.call(conn, config)

    assert conn.status == 503
    assert [_retry_after] = get_resp_header(conn, "retry-after")
  end

  test "request with ?handle= referencing a stale handle is charged :initial",
       %{stack_id: stack_id, config: config} do
    refute Electric.ShapeCache.ShapeStatus.has_shape_handle?(stack_id, "stale")

    :ok =
      Electric.AdmissionControl.try_acquire(stack_id, :initial, max_concurrent: 1)

    conn =
      conn(:get, "/v1/shape?table=items&handle=stale&offset=0_0")

    conn = Electric.Plug.Router.call(conn, config)

    assert conn.status == 503
  end

  test "request with ?handle= referencing a known shape is charged :existing",
       %{stack_id: stack_id, config: config} do
    # Force a known handle into the meta table. Use whichever public seed
    # helper the existing tests use — likely a fixtures module.
    handle = seed_known_shape!(stack_id)

    # Saturate :initial; should not affect a ?handle= for a known shape.
    :ok =
      Electric.AdmissionControl.try_acquire(stack_id, :initial, max_concurrent: 1)

    conn =
      conn(:get, "/v1/shape?table=items&handle=#{handle}&offset=0_0")

    conn = Electric.Plug.Router.call(conn, config)

    refute conn.status == 503
  end

  test "reclassification moves :initial → :existing after load_shape",
       %{stack_id: stack_id, config: config} do
    # Make a real shape request and confirm that by the time the response
    # is being served, the request has vacated :initial and now occupies
    # :existing. The cleanest way to assert this is via the telemetry
    # event emitted by try_swap.
    ref =
      :telemetry_test.attach_event_handlers(self(), [
        [:electric, :admission_control, :swap]
      ])

    conn = conn(:get, "/v1/shape?table=items&offset=-1")
    conn = Electric.Plug.Router.call(conn, config)

    assert conn.status == 200

    assert_received {[:electric, :admission_control, :swap], ^ref, %{count: 1},
                     %{from: :initial, to: :existing, stack_id: ^stack_id}}

    :telemetry.detach(ref)
  end
end
```

If `with_running_stack/1` and `seed_known_shape!/1` aren't already helpers in the router test file, copy the equivalent setup pattern from a passing test in the same file — do not invent new helpers. Flag this for discussion if no existing pattern fits.

- [ ] **Step 2: Run tests to verify they fail**

Run: `mix test test/electric/plug/router_test.exs`

Expected: classification tests fail because `:resolve_existing_shape` still classifies based on shape definition, not handle; reclassification test fails because the swap plug doesn't exist.

- [ ] **Step 3: Rewrite the pipeline**

Edit `lib/electric/plug/serve_shape_plug.ex`:

```elixir
  # check_admission MUST stay first. Classification depends only on the
  # request URL and a cheap ETS lookup — never on shape ETS state.
  plug :check_admission
  plug :put_resp_content_type, "application/json"
  plug :parse_body
  plug :validate_request
  plug :reject_subquery_shape_compaction_request
  plug :load_shape
  # Reclassify off :initial as soon as load_shape returns so the :initial
  # cap bounds validate-and-load throughput, not streaming concurrency.
  plug :reclassify_admission_kind
  plug :serve_shape_response
```

Delete the `:resolve_existing_shape` plug entry and the `defp resolve_existing_shape/2` definition entirely.

Rewrite the classifier:

```elixir
  alias Electric.ShapeCache.ShapeStatus

  defp admission_kind(conn) do
    stack_id = get_in(conn.assigns, [:config, :stack_id])
    handle = conn.query_params["handle"]

    cond do
      is_nil(handle) -> :initial
      ShapeStatus.has_shape_handle?(stack_id, handle) -> :existing
      true -> :initial
    end
  rescue
    # Per-stack shape_meta_table may not exist yet during startup.
    ArgumentError -> :initial
  end
```

Add the reclassification plug:

```elixir
  # Runs after :load_shape. Moves the handler out of :initial so the
  # :initial bucket can admit the next validate-and-load wave while this
  # request is still streaming. If :existing is at cap, we keep the
  # :initial permit — request still completes, just charged to the wrong
  # bucket; the next swap attempt from another request will succeed once
  # the bucket drains naturally.
  defp reclassify_admission_kind(%Conn{assigns: %{config: config}} = conn, _) do
    case Process.get(@admission_permit_key) do
      {stack_id, :initial} ->
        max = Map.fetch!(config[:api].max_concurrent_requests, :existing)

        case Electric.AdmissionControl.try_swap(stack_id, :initial, :existing,
               max_concurrent: max) do
          :ok ->
            Process.put(@admission_permit_key, {stack_id, :existing})

          {:error, :overloaded} ->
            :ok
        end

        conn

      _ ->
        conn
    end
  end
```

Confirm `check_admission/2` still stashes `{stack_id, kind}` in the process dict and that `release_admission_permit/0` reads it back. The release path needs no change — it reads whatever is currently in the process dict, and the swap updates that.

Sanity-check the moduledoc at the top of the file: any references to `:resolve_existing_shape` or to admission-classification-via-shape-existence should be updated.

- [ ] **Step 4: Run the new router tests and the existing tests**

Run, in this order:

```bash
mix test test/electric/admission_control_test.exs
mix test test/electric/plug/serve_shape_plug_test.exs
mix test test/electric/plug/router_test.exs
```

Expected: all green. If `serve_shape_plug_test.exs` had a test relying on the old shape-definition-based classifier (e.g. "request matching an existing shape definition without ?handle= classifies as :existing"), update it: the new behaviour is `:initial` until reclassification.

- [ ] **Step 5: Commit**

```bash
git add lib/electric/plug/serve_shape_plug.ex test/electric/plug/router_test.exs test/electric/plug/serve_shape_plug_test.exs
git commit -m "feat(sync-service): cheap Tier 0 admission + post-load_shape reclassification

Moves :check_admission to the front of ServeShapePlug's pipeline and
classifies requests on a single :ets.member/2 of the per-stack shape-meta
table. Deletes :resolve_existing_shape — admission no longer touches the
SQLite-backed ShapeDb (bottleneck 1 of #4266).

Adds :reclassify_admission_kind between :load_shape and
:serve_shape_response. Once load_shape returns, the handler atomically
swaps its :initial permit for an :existing permit, freeing the :initial
slot for the next validate-and-load wave while this request streams.
If :existing is at cap, the handler keeps its :initial permit; the next
swap attempt will succeed once :existing drains."
```

---

## Task 3: Changeset

**Files:**
- Create: `.changeset/cheap-admission-control.md`

- [ ] **Step 1: Generate a changeset**

From repo root: `pnpm changeset`. Select `@electric-sql/electric` (or whichever package the sync-service publishes as), pick `patch`, and use this summary:

```
Cheap admission control: shape requests are admitted before param validation
and shape lookup, classified using a single ETS membership check on
?handle=. After load_shape returns, the in-flight permit moves from the
:initial bucket to :existing, so :initial caps validate-and-load
concurrency rather than full request lifetime. No HTTP protocol change.
```

- [ ] **Step 2: Commit**

```bash
git add .changeset/cheap-admission-control.md
git commit -m "chore: changeset for cheap admission control"
```

---

## Open questions (resolve while iterating)

1. **POST `/v1/shape` with handle in body?** The plan assumes `?handle=` is always a URL query param. Verify by grepping `request.params.handle` and POST handlers — if any code path reads the handle from the body, classification must be widened or POST requests must default to `:existing` when warm-equivalent.
2. **`:initial` cap sizing.** With the residency change, the appropriate cap may differ from today's tuning. Today it caps "concurrent requests in their entire lifetime"; it now caps "concurrent requests in validate-and-load". The two bound very different resources. Default may need re-evaluation post-deploy; flag in the PR for ops review.
3. **Reclassification on error/halt paths.** The plug only runs on the happy path. If `:load_shape` halts with an error, the handler exits without reclassifying — `:initial` is held until `release_admission_permit/0` in the `after` clause. This is the same behavior as today for short-lived error responses; acceptable.
4. **Counter-tuple leak.** `{stack_id, initial, existing}` rows accumulate as stacks come and go. Pre-existing — flag for follow-up but out of scope here.

---

## Out of scope (explicit)

- Tier 2 (handler-local waiting for stack readiness). The existing `StatusMonitor.wait_until_*` path still applies to requests that get past Tier 0.
- Tier 3 (rendezvous / health-aware queueing). No ShapeCache mailbox checks, no snapshot pool capacity probes.
- Adaptive `Retry-After`. The existing 5–10s jittered value stays; replacing it is a separate workstream tracked in #4295.
- Client-side `Retry-After` jitter (#4297 / `draft-issue-client-retry-after-jitter.md`).
- Cleaning up orphan counter rows for stacks that get torn down.
- Reclassification at `mark_snapshot_complete` (a stricter boundary than load_shape return). Would require shape-event subscription plumbing to dispatch the per-shape signal to N coalesced handlers. Possible follow-up if `:initial`-bucket residency under the new model still feels too long in production.

---

## PR description draft

> **Keep this section through implementation.** Paste verbatim (with light editing for tense) into the PR description once the implementation is done.

### Summary

Two changes to `ServeShapePlug`'s pipeline that together make admission control cheap to run and accurately bound the resource it's supposed to protect.

1. **Cheap Tier 0 classifier.** `:resolve_existing_shape` is deleted. The admission classifier now reads a single ETS table (`shape_meta_table` for the stack) via `ShapeStatus.has_shape_handle?/2`. No SQLite, no GenServer call. Admission moves to the front of the plug pipeline so rejected requests don't pay for validation, shape lookup, or any of the other per-request setup.
2. **Post-`load_shape` reclassification.** Once `load_shape` returns, the in-flight permit atomically swaps from `:initial` to `:existing`. The `:initial` cap now bounds requests currently in the validate-and-load phase, not requests currently streaming their response.

### Pipeline change

Before:

```
:resolve_existing_shape   ← SQLite read (ShapeDb), runs before admission
:check_admission          ← acquires :initial or :existing permit
:put_resp_content_type
:parse_body
:validate_request
:reject_subquery_shape_compaction_request
:load_shape
:serve_shape_response     ← streams body; permit released in after-clause
```

After:

```
:check_admission             ← cheap classifier (1× :ets.member), runs first
:put_resp_content_type
:parse_body
:validate_request
:reject_subquery_shape_compaction_request
:load_shape
:reclassify_admission_kind   ← :initial → :existing swap
:serve_shape_response        ← streams body
```

### Why this is cheaper

`:resolve_existing_shape` called into `Electric.Shapes.fetch_handle_by_shape/2`, which falls through to `ShapeDb.handle_for_shape/2` — a SQLite read on the read pool. Issue #4266 calls this out as the first bottleneck on the pre-admission path: every request, including the ones admission is about to reject, performs that read. Under thundering herd, the read pool saturates before admission can shed anything.

The new classifier is `:ets.member(shape_meta_table(stack_id), handle)`. One lookup, no pool, no GenServer.

The rescue on `ArgumentError` covers the brief window during stack startup where the per-stack meta table hasn't been created yet — those requests classify as `:initial`, which is the safer bucket.

### Why post-`load_shape` reclassification matters

`release_admission_permit/0` runs in `call/2`'s `after` clause — i.e., after `Api.Response.send_stream/2` has finished draining the body. For an initial snapshot of a non-trivial shape, or a long-poll, that's seconds to minutes.

So today, `:initial` permits are held for the **entire** request lifetime:

```
t=0    t=5ms   t=10ms   t=50ms          t=2000ms
│      │       │        │               │
│ check_admission (:initial +1)
│      │ validate
│              │ load_shape (often coalesces; may spawn Snapshotter)
│                       │ start streaming chunks
│                                       │ done streaming, :initial -1
└────────────── :initial held for 2000ms ─────────────────────────┘
```

After this change:

```
t=0    t=5ms   t=10ms   t=50ms          t=2000ms
│      │       │        │               │
│ check_admission (:initial +1)
│      │ validate
│              │ load_shape
│                       │ try_swap (:initial -1, :existing +1)
│                       │ start streaming chunks
│                                       │ done streaming, :existing -1
└──── :initial 50ms ────┤
                        └─────── :existing 1950ms ────────────────┘
```

`:initial` residency drops from "entire request lifetime" to "validate + load_shape". For coalesced handlers on a popular shape, that's the time spent walking through the ShapeCache GenServer to discover the shape is already ready — typically tens of milliseconds. For requests that trigger genuine snapshot creation, the residency is bounded by `snapshot_started?` becoming true, not by the rest of the snapshot streaming.

### What each bucket protects now

| Bucket | Caps | Bounds |
|---|---|---|
| `:initial` | requests in validate + load_shape | ShapeCache GenServer mailbox depth, Snapshotter spawn rate |
| `:existing` | requests currently streaming bytes | concurrent open response streams |

Per-slot cost is much smaller for `:existing` (no PG, no GenServer call), so the cap can be much larger than `:initial`.

### Atomicity

`AdmissionControl.try_swap/4` performs the swap as a single `:ets.update_counter/4` call on the success path. Both columns of the per-stack counter row move in the same atomic op, so the total in-flight count (`from + to`) is invariant throughout — no transient window where another `try_acquire` could observe an over-count and spuriously reject.

The 4-tuple op form `{Pos, Incr, Threshold, SetValue}` encodes the cap check inline: increment `to_kind` by 1; if that would push it above the cap, set it to `cap + 1` instead. The return value distinguishes "filled the last slot" (`new_to == cap`) from "rejected at cap" (`new_to == cap + 1`).

On rejection, a second atomic op rolls back both columns. During the brief mid-state the `to_kind` column sits at `cap + 1`, so any concurrent `try_acquire(to_kind)` also rejects — the same outcome it would produce anyway, so no false acceptance.

Concurrent swaps at the cap converge on exactly `cap` successes; the rest get `:overloaded` and keep their source-bucket permit. The unit-test `is atomic under concurrent swap attempts at the cap` covers this.

### What happens if reclassification fails

The handler keeps its `:initial` permit. The request still completes. The next reclassification from another handler will succeed once an `:existing` slot drains. No retry, no spin, no work lost. The only cost is one over-occupied `:initial` slot until the request finishes streaming.

### What this does *not* do

- Does not introduce health-aware queueing, Tier 2 handler-local waiting, or Tier 3 rendezvous. Stack-not-ready requests still rely on the existing `StatusMonitor` wait path.
- Does not change Retry-After (still 5–10s + jitter). Adaptive Retry-After is tracked in #4295.
- Does not change the HTTP protocol. `?handle=` semantics are unchanged from the client's perspective.

### Related issues

- #4291 — primary issue this PR addresses.
- #4292 — parent meta-issue for cheap admission + adaptive Retry-After.
- #4266 — ShapeCache bottlenecks under thundering herd (bottleneck 1 directly resolved; 2/3/4 remain).
