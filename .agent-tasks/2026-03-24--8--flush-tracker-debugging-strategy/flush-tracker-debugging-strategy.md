# FlushTracker Stale Entry Debugging Strategy

## Problem Statement

FlushTracker can accumulate stale entries for shapes whose consumer processes have died
or suspended, but whose shapes have not been removed from the system. This blocks WAL
flush advancement (`slot_confirmed_flush_lsn`) indefinitely, causing unbounded WAL growth
on the Postgres side.

Two production customers have exhibited this behavior. Neither uses subqueries. One has
`suspend_consumers` enabled.

**Related issues:** electric-sql/electric#3980, electric-sql/electric#4013
**Prior fix:** PR #4011 (fixed ShapeLogCollector adding dead consumers to FlushTracker)

---

## Background: How FlushTracker Works

### Architecture

```
  Postgres WAL  -->  ReplicationClient  -->  ShapeLogCollector (SLC)
                                                    |
                                         [FlushTracker state]
                                                    |
                             +----------------------+----------------------+
                             |                      |                      |
                        Consumer A             Consumer B             Consumer C
                             |                      |                      |
                        Storage flush          Storage flush          Storage flush
                             |                      |                      |
                       notify_flushed         notify_flushed         notify_flushed
                             |                      |                      |
                             +----------------------+----------------------+
                                                    |
                                         FlushTracker updates
                                         last_global_flushed_offset
                                                    |
                                         ReplicationClient acknowledges
                                         WAL position to Postgres
```

### Key Data Structures

FlushTracker maintains:
- `last_global_flushed_offset` — the WAL position acknowledged to Postgres
- `last_seen_offset` — the latest transaction offset received
- `last_flushed` — a map of `shape_handle => {last_sent, last_flushed}` for shapes with pending flushes
- `min_incomplete_flush_tree` — a gb_tree for O(log n) minimum lookup across pending flush offsets

### Critical Flow

1. **Transaction arrives** → SLC calls `FlushTracker.handle_txn_fragment/4` → shapes added to `last_flushed` map
2. **Consumer processes transaction** → storage flushes → Consumer calls `ShapeLogCollector.notify_flushed/3`
3. **SLC receives flush notification** → calls `FlushTracker.handle_flush_notification/3` → updates or removes shape from `last_flushed`
4. **When all shapes caught up** → `last_global_flushed_offset` advances → `notify_fn` informs ReplicationClient → Postgres WAL can be reclaimed

### The Gap

**FlushTracker tracks shapes by shape_handle, NOT by consumer PID.** There is no process
monitoring of consumers by FlushTracker or SLC. The only cleanup paths for a shape in
FlushTracker are:

1. The consumer sends `notify_flushed` with an offset matching `last_sent` → shape removed from map
2. `handle_shape_removed/2` is called when a shape is fully removed from the system
3. `handle_txn_fragment` marks undeliverable shapes as removed (PR #4011 fix)

**If a consumer dies but the shape is NOT removed**, no cleanup occurs. The shape stays
in `last_flushed` forever.

---

## Analysis of Production State Dumps

### Edison Customer (stack: `svc-resulting-mongoose-fm3kdtxqth`)

- **33 shapes** stuck in `last_flushed`, all at the same `last_sent` offset `(8458315976, 1066)`
- `last_global_flushed_offset`: `(8458315976, 0)` — stuck at the lowest pending flush
- `last_seen_offset`: `(9294634792, 2)` — significantly ahead
- Replication client: `received_wal` = 10,032,775,168, `flushed_wal` = 8,458,315,975
- **WAL gap**: ~1.5 GB and growing
- All 33 shapes have different `last_flushed` offsets within the same transaction (range 0-494 out of 1066)
- 2 shapes flushed **nothing at all** (op 0): `94359551-1773923988150221`, `86559626-1773922634786024`
- Shape creation timestamps span 2026-03-19 12:09 to 2026-03-20 02:07 UTC
- App type: fitness/training (user_profile, workout_log, exercise_library, chat_message tables)

### Faraday Customer (stack: `bb775c81-cfde-4f5a-85de-cacc372c5816`, has `suspend_consumers` enabled)

- **518 shapes tracked total** in snapshot 1:
  - **402 shapes STUCK** at `last_sent` = `(3471528106048, 880)`, flushed ops range 0-790
  - **115 shapes ACTIVE** at `last_sent` = `(3487230289368, 9760)`, making progress
  - 1 shape at latest offset
- `last_global_flushed_offset`: `(3471528106048, 0)` — pinned by oldest stuck entry

- **Snapshot comparison** (two captures at different times):

  | Metric | Snapshot 1 | Snapshot 2 | Delta |
  |--------|-----------|-----------|-------|
  | `received_wal` | 3,487,446,326,072 | 3,488,740,456,624 | +1.2 GB |
  | `flushed_wal` | 3,471,528,106,047 | 3,471,528,106,047 | **0 (stuck)** |
  | WAL gap | ~15.2 GB | ~16.4 GB | **growing** |
  | Stuck shapes | 402 | 402 | **zero change in any flushed position** |
  | Active shapes | 115 | 113 | progressed to new offsets |

- 7 shapes removed between snapshots — all ACTIVE, none from the stuck set. Confirms shape lifecycle events work for active shapes but the 402 stuck shapes' consumers are gone permanently.
- Stuck shape timestamps: created 2026-03-20 08:06 to 2026-03-23 18:28 UTC (3.4-day span)
- Some active shapes **predate** the stuck shapes, meaning the stalling is not age-dependent
- App type: crypto/DeFi (swaps, ohlcv_*, token_metrics, top_holders tables)

### Common Pattern

In both cases:
1. All stuck shapes have been sent data (non-zero `last_sent`) but their `last_flushed` hasn't advanced to match
2. The shapes are stuck at different sub-offsets within the same transaction(s)
3. No new transactions for these shapes have arrived to trigger the "undeliverable" cleanup path (PR #4011 fix)
4. The `last_global_flushed_offset` is blocked by the minimum of these stale entries
5. Active shapes continue to receive and flush new transactions normally — only the stuck shapes are affected
6. The stuck entries are **zombie entries** — their consumer processes are gone, no one will ever send `notify_flushed` for them
7. The WAL gap grows unboundedly over time

---

## Hypothesized Root Causes

### Hypothesis 1: Consumer Suspension Without FlushTracker Cleanup

**Mechanism:**
1. Transaction T1 arrives, affecting shapes S1..Sn
2. SLC publishes to consumers, FlushTracker tracks all shapes
3. Some consumers process T1 and send `notify_flushed`
4. Other consumers time out (hibernate_after) and **suspend** (exit with `@shutdown_suspend`)
5. `ShapeCleaner.handle_writer_termination` only calls `ConsumerRegistry.remove_consumer` — does NOT clean FlushTracker
6. No more transactions arrive for the suspended shapes → FlushTracker entry stays forever

**Code path:**
- `consumer.ex:411` → `{:stop, ShapeCleaner.consumer_suspend_reason(), state}`
- `shape_cleaner.ex:108-113` → only calls `ConsumerRegistry.remove_consumer`, no FlushTracker cleanup

**Likelihood:** HIGH for the customer with `suspend_consumers` enabled.

### Hypothesis 2: Consumer Dies with :shutdown Before Flushing

**Mechanism:**
1. Transaction T1 arrives, affecting shapes S1..Sn
2. SLC publishes to consumers via `ConsumerRegistry.broadcast`
3. Consumers acknowledge receipt (reply to the `$gen_call`)
4. Before storage flushes, some consumers die with `:shutdown` or `{:shutdown, _}`
5. `ShapeCleaner.handle_writer_termination` at lines 115-119 does **nothing** for these exit reasons
6. Consumer is dead, no flush notification will ever come
7. If no new transaction affects these shapes, FlushTracker entry stays forever

**Likelihood:** HIGH — this matches the pattern where shapes are stuck mid-transaction.

### Hypothesis 3: Consumer Crash During Transaction Processing

**Mechanism:**
1. Transaction fragment arrives, SLC tracks shapes in FlushTracker
2. Consumer crashes while processing
3. `ConsumerRegistry.broadcast` detects the crash (`:DOWN` message)
4. SLC's `undeliverable_set` path handles this for the current fragment
5. BUT: if the consumer was already tracked from a previous fragment, and the crash happens between fragments, the cleanup may be incomplete

**Likelihood:** MEDIUM — the current code does handle undeliverable shapes, but there may be timing windows.

### Hypothesis 4: Race Between Transaction Delivery and Consumer Death

**Mechanism:**
1. Consumer is about to suspend (hibernate timer fired)
2. Simultaneously, SLC is processing a new transaction
3. SLC's `ConsumerRegistry.publish` finds the consumer PID in the ETS table
4. `broadcast` sends `$gen_call` to the consumer
5. Consumer suspends between receiving the message and replying
6. `broadcast` gets `:DOWN` with `@consumer_suspend_reason`
7. Shape goes into `suspended` map → retry
8. On retry, new consumer may start and process the transaction
9. BUT: FlushTracker may now have duplicate or stale tracking state

**Likelihood:** MEDIUM — depends on exact timing.

### Hypothesis 5: Stale PID in ConsumerRegistry (Issue #4013)

**Mechanism:**
1. Consumer dies with `:shutdown` or `{:shutdown, _}` reason
2. `ShapeCleaner.handle_writer_termination` (lines 115-119) does nothing — ETS entry NOT removed
3. ConsumerRegistry still has the dead PID
4. New transaction arrives → `ConsumerRegistry.publish` finds the dead PID
5. `broadcast` monitors it, immediately gets `:DOWN` → shape goes to `crashed` (undeliverable)
6. SLC removes from FlushTracker via the PR #4011 path
7. **BUT**: if no new transaction arrives for this shape, the stale PID sits in ETS forever
8. `ShapeCache.restore_shape_and_dependencies` can hand out the dead PID to callers

**Likelihood:** This explains why the PR #4011 fix doesn't help for shapes where no new transactions arrive.

---

## Data Gathering Strategy

### Phase 1: Runtime State Inspection (Immediate, Non-Invasive)

These can be run via ECS Exec on an affected instance right now.

#### 1.1 FlushTracker Shape Liveness Check

For each shape in `FlushTracker.last_flushed`, check if its consumer is alive:

```elixir
# Get FlushTracker state
slc_pid = GenServer.whereis(Electric.Replication.ShapeLogCollector.name(stack_id))
{:ok, slc_state} = :sys.get_state(slc_pid) |> then(fn state -> {:ok, state} end)
flush_tracker = slc_state.flush_tracker

# Get the consumer registry ETS table
registry_table = Electric.Shapes.ConsumerRegistry.ets_name(stack_id)

# For each tracked shape, check consumer liveness
for {shape_handle, {last_sent, last_flushed}} <- flush_tracker.last_flushed do
  consumer_pid = :ets.lookup_element(registry_table, shape_handle, 2, nil)
  alive? = if consumer_pid, do: Process.alive?(consumer_pid), else: false
  {shape_handle, %{
    last_sent: last_sent,
    last_flushed: last_flushed,
    consumer_pid: consumer_pid,
    consumer_alive: alive?,
    gap: LogOffset.compare(last_sent, last_flushed)
  }}
end
```

**What this tells us:** If shapes in FlushTracker have no alive consumer, that confirms the stale entry hypothesis. If they DO have alive consumers, we need to investigate why the consumers aren't flushing.

#### 1.2 Consumer Process Info

For any alive consumers found above:

```elixir
# Check consumer state
consumer_pid = ... # from above
:sys.get_state(consumer_pid)
# Look at:
# - state.writer (is it actively writing?)
# - state.txn_offset_mapping (pending transactions to flush)
# - Process.info(consumer_pid, [:message_queue_len, :status, :current_function])
```

#### 1.3 Shape Status Check

```elixir
# Verify shape still exists in ShapeStatus
Electric.ShapeCache.ShapeStatus.list_shapes(stack_id)
|> Enum.filter(fn {handle, _} -> Map.has_key?(flush_tracker.last_flushed, handle) end)
```

### Phase 2: Targeted Tracing (Requires Code Change / Deploy)

#### 2.1 Instrument Consumer Termination

Add logging to `Consumer.terminate/2` to capture:

```elixir
def terminate(reason, state) do
  # ADD: Log whether this consumer has pending FlushTracker entries
  Logger.warning(fn ->
    "Consumer #{state.shape_handle} terminating with reason #{inspect(reason)}, " <>
    "latest_offset=#{inspect(state.latest_offset)}"
  end)
  # ... existing terminate code ...
end
```

#### 2.2 Instrument ShapeCleaner.handle_writer_termination

Add logging when a consumer dies without FlushTracker cleanup:

```elixir
def handle_writer_termination(_stack_id, shape_handle, reason)
    when reason in [:normal, :killed, :shutdown] or
         (is_tuple(reason) and elem(reason, 0) == :shutdown) do
  Logger.warning(fn ->
    "Consumer #{shape_handle} terminated with reason #{inspect(reason)} - " <>
    "NO FlushTracker cleanup performed"
  end)
  :ok
end
```

#### 2.3 Add FlushTracker Stale Entry Detection

Periodically check for stale entries in FlushTracker. Add to SLC:

```elixir
# In SLC's handle_info, add a periodic check (e.g., every 60 seconds)
def handle_info(:check_stale_flush_entries, state) do
  registry_table = Electric.Shapes.ConsumerRegistry.ets_name(state.stack_id)

  stale_shapes =
    for {shape_handle, {last_sent, last_flushed}} <- state.flush_tracker.last_flushed,
        consumer_pid = :ets.lookup_element(registry_table, shape_handle, 2, nil),
        is_nil(consumer_pid) or not Process.alive?(consumer_pid) do
      shape_handle
    end

  if stale_shapes != [] do
    Logger.error(fn ->
      "FlushTracker has #{length(stale_shapes)} stale entries " <>
      "(shapes with no alive consumer): #{inspect(stale_shapes)}"
    end)
  end

  Process.send_after(self(), :check_stale_flush_entries, 60_000)
  {:noreply, state}
end
```

#### 2.4 Trace Consumer Lifecycle Events

Use Erlang tracing to capture consumer start/stop/suspend events:

```elixir
# Trace consumer termination
:dbg.tracer()
:dbg.tp(Electric.Shapes.Consumer, :terminate, 2, [])
:dbg.p(:all, :c)

# Trace ShapeCleaner decisions
:dbg.tp(Electric.ShapeCache.ShapeCleaner, :handle_writer_termination, 4, [])

# Trace FlushTracker state changes
:dbg.tp(Electric.Replication.ShapeLogCollector.FlushTracker, :handle_flush_notification, 3, [{:_, [], [{:return_trace}]}])
:dbg.tp(Electric.Replication.ShapeLogCollector.FlushTracker, :handle_shape_removed, 2, [{:_, [], [{:return_trace}]}])

# Trace ConsumerRegistry.remove_consumer
:dbg.tp(Electric.Shapes.ConsumerRegistry, :remove_consumer, 2, [])
```

**Caution:** `:dbg` tracing should be time-limited in production. Use `:dbg.stop()` after capturing sufficient data.

### Phase 3: Honeycomb Telemetry (For Pattern Analysis)

#### 3.1 Existing Metrics to Query

```
# WAL lag growth over time
dataset: "Cloud Source - Core Stats"
columns: slot_confirmed_flush_lsn_lag, slot_retained_wal_size
filter: source_id = "<affected_source_id>"

# Shape log collector duration (indicates processing bottleneck)
columns: shape_log_collector.total_duration_µs, shape_log_collector.affected_shape_count

# Consumer suspension events (if logged)
# Search for "Suspending consumer" log messages
```

#### 3.2 New Metrics to Add

Consider adding telemetry events for:

1. **`flush_tracker.stale_entry_count`** — periodic gauge of shapes in FlushTracker with no alive consumer
2. **`flush_tracker.entry_count`** — total shapes in `last_flushed` map
3. **`flush_tracker.lag_seconds`** — time since `last_global_flushed_offset` was last updated
4. **`consumer.terminate`** — event with `reason` attribute and `shape_handle`
5. **`consumer.suspend`** — event when consumer suspends via hibernate timeout
6. **`shape_cleaner.writer_termination`** — event with `reason` and `cleanup_action` (removed/suspended/noop)

### Phase 4: ETS Table Inspection (For Deep State Analysis)

#### 4.1 ConsumerRegistry ETS

```elixir
# Dump all registered consumers
registry_table = Electric.Shapes.ConsumerRegistry.ets_name(stack_id)
:ets.tab2list(registry_table)
|> Enum.map(fn {shape_handle, pid} ->
  {shape_handle, pid, Process.alive?(pid)}
end)
```

#### 4.2 Cross-Reference with FlushTracker

```elixir
# Find mismatches: shapes in FlushTracker but not in ConsumerRegistry (or with dead consumers)
flush_shapes = Map.keys(flush_tracker.last_flushed) |> MapSet.new()
registry_shapes = :ets.tab2list(registry_table) |> Enum.map(&elem(&1, 0)) |> MapSet.new()

# Shapes tracked by FlushTracker but not in ConsumerRegistry at all
orphaned = MapSet.difference(flush_shapes, registry_shapes)

# Shapes tracked by FlushTracker with dead consumers
dead_consumers =
  for {handle, pid} <- :ets.tab2list(registry_table),
      handle in flush_shapes,
      not Process.alive?(pid),
      do: {handle, pid}
```

---

## Recommended Execution Order

### Immediate (on next affected instance)

1. Run **Phase 1** inspection on an affected instance to confirm stale entries have dead/missing consumers
2. This single check will immediately confirm or refute the primary hypothesis

### Short-term (code change, deploy to staging)

3. Add **Phase 2.1-2.2** instrumentation (consumer termination logging)
4. Add **Phase 2.3** stale entry periodic check
5. Deploy to staging and exercise consumer suspension scenarios
6. If confirmed, add **Phase 3.2** telemetry events

### Medium-term (production observability)

7. Deploy instrumentation to production
8. Monitor for stale entry detection events
9. Use Phase 4 cross-reference on any instance that triggers stale entry alerts

---

## Expected Outcome

If the hypothesis is confirmed (stale entries correlate with dead/suspended consumers),
the fix is straightforward:

1. **Option A (reactive):** Add the periodic stale entry check (Phase 2.3) as a
   permanent self-healing mechanism — when stale entries are detected, call
   `FlushTracker.handle_shape_removed` for each.

2. **Option B (proactive):** Add process monitoring in SLC for consumer PIDs.
   When a consumer dies, check if its shape is in FlushTracker and clean up.

3. **Option C (at source):** Modify `ShapeCleaner.handle_writer_termination` to
   also clean up FlushTracker for `:shutdown` and `@shutdown_suspend` reasons.

Option C is the most targeted fix but requires the consumer to have access to SLC's
state (or send a message). Option B is more robust. Option A is the safest as a
defense-in-depth measure regardless of which proactive fix is chosen.
