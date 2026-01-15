# Race Condition Analysis: Shape Removal in Electric Sync Service

## Executive Summary

A race condition exists in the shape removal flow that can cause the `ConsumerRegistry.publish`
function to crash with `ArgumentError` from `Process.monitor(nil)`. The developers are **aware**
of this race (see comment at `shape_cache.ex:227`), but the stated mitigation does not actually
prevent the crash.

## The Bug

### Location
- **`lib/electric/shape_cache/shape_cleaner.ex:156-177`** - Shape removal sequence
- **`lib/electric/shapes/consumer_registry.ex:86,127`** - Missing nil check
- **`lib/electric/shape_cache.ex:226-230`** - Acknowledged but unmitigated race

### Root Cause

The shape removal sequence has incorrect ordering:

```elixir
# ShapeCleaner.remove_shape_immediate (lines 156-177)
defp remove_shape_immediate(stack_id, shape_handle, reason) do
  # Step 1: ShapeStatus.remove_shape - IMMEDIATE (SQLite/ETS update)
  case ShapeStatus.remove_shape(stack_id, shape_handle) do
    :ok ->
      # Step 2: Consumer.stop - IMMEDIATE
      with :ok <- Consumer.stop(stack_id, shape_handle, reason),
           # Step 3: Storage.cleanup! - IMMEDIATE
           :ok <- Storage.cleanup!(stack_storage, shape_handle),
           # Step 4: ShapeLogCollector.remove_shape - ASYNC via RequestBatcher!
           :ok <- ShapeLogCollector.remove_shape(stack_id, shape_handle) do
        :ok
      end
  end
end
```

**Key issue**: `ShapeLogCollector.remove_shape` batches the removal request and sends it via
`GenServer.cast` (async). This means EventRouter removal happens *after* ShapeStatus removal.

### The Race Window

```
Time →
┌────────────────────────────────────────────────────────────────────────┐
│ ShapeStatus has shape │ EventRouter has shape │ ConsumerRegistry has │
├───────────────────────┼──────────────────────┼──────────────────────┤
│ Step 1: REMOVED       │ Still present        │ Still present (?)    │
│ Step 2: -             │ Still present        │ REMOVED (stopped)    │
│ Step 3: -             │ Still present        │ -                    │
│ <--- RACE WINDOW: Transaction can arrive here --->                   │
│ Step 4: -             │ Eventually removed   │ -                    │
└────────────────────────────────────────────────────────────────────────┘
```

During the race window:
1. EventRouter routes events to the shape (it's still in the filter)
2. ConsumerRegistry.publish tries to find/start consumer
3. `consumer_pid` returns `nil` (consumer stopped)
4. `start_consumer!` calls `ShapeCache.start_consumer_for_handle`
5. ShapeCache queries ShapeStatus → shape not found → returns `{:error, :no_shape}`
6. `start_consumer!` returns `nil`
7. **`send(nil, msg)` crashes with ArgumentError: "invalid destination"!**
   (In OTP 24+, `Process.monitor(nil)` returns a reference, but `send(nil, ...)` raises)

### Code Path to Crash

```elixir
# consumer_registry.ex:81-89
def publish(events_by_handle, registry_state) do
  %{table: table} = registry_state
  events_by_handle
  |> Enum.map(fn {handle, event} ->
    # Line 86: No nil filtering here!
    {handle, event, consumer_pid(handle, table) || start_consumer!(handle, registry_state)}
  end)
  |> broadcast()  # nil pid passed here
  |> publish(registry_state)
end

# consumer_registry.ex:122-147
def broadcast(handle_event_pids) do
  handle_event_pids
  |> Enum.map(fn {handle, event, pid} ->
    ref = Process.monitor(pid)  # OTP 24+: returns reference even for nil
    send(pid, {:"$gen_call", {self(), ref}, event})  # CRASH if pid is nil!
    send(pid, {:"$gen_call", {self(), ref}, event})
    {handle, event, ref}
  end)
  ...
end
```

### Developer Awareness

The developers are aware of this race condition:

```elixir
# shape_cache.ex:226-230
def handle_call({:start_consumer_for_handle, shape_handle}, _from, state) do
  # This is racy: it's possible for a shape to have been deleted while the
  # ShapeLogCollector is processing a transaction that includes it
  # In this case fetch_shape_by_handle returns an error. ConsumerRegistry
  # basically ignores the {:error, :no_shape} result - excluding the shape handle
  # from the broadcast.
```

**However**, the claim that ConsumerRegistry "ignores" the result and "excludes the shape handle
from the broadcast" is **incorrect**. The `nil` pid is passed directly to `broadcast()` without
any filtering.

## Formal Model

See `ShapeRemovalRaceSimple.lean` for a Lean 4 formal verification model that proves:

1. The initial state where shape is in all components satisfies the safety invariant
2. After steps 1+2 (ShapeStatus removed, Consumer stopped), the invariant is violated
3. A transaction arriving during this window would cause the crash
4. Reordering operations (EventRouter first) maintains the invariant throughout

## Recommended Fixes

### Option A: Filter nil pids (Quick Fix)

```elixir
# consumer_registry.ex - Add filter before broadcast
def publish(events_by_handle, registry_state) do
  %{table: table} = registry_state
  events_by_handle
  |> Enum.map(fn {handle, event} ->
    {handle, event, consumer_pid(handle, table) || start_consumer!(handle, registry_state)}
  end)
  |> Enum.reject(fn {_handle, _event, pid} -> is_nil(pid) end)  # ADD THIS LINE
  |> broadcast()
  |> publish(registry_state)
end
```

### Option B: Reorder removal sequence (Proper Fix)

```elixir
# shape_cleaner.ex - Remove from EventRouter FIRST
defp remove_shape_immediate(stack_id, shape_handle, reason) do
  # Step 1: Remove from EventRouter FIRST (make synchronous)
  :ok = ShapeLogCollector.remove_shape_sync(stack_id, shape_handle)

  # Step 2: Now safe to remove from ShapeStatus
  case ShapeStatus.remove_shape(stack_id, shape_handle) do
    :ok ->
      with :ok <- Consumer.stop(stack_id, shape_handle, reason),
           :ok <- Storage.cleanup!(stack_storage, shape_handle) do
        :ok
      end
  end
end
```

### Option C: Use tombstone markers

Instead of immediately removing from ShapeStatus, mark it as "being removed" so that
`start_consumer_for_handle` can return a meaningful error that's properly handled.

## Test Case

To reproduce:
1. Create a shape with active consumer
2. In a tight loop, send removal requests and transactions concurrently
3. The crash should manifest when a transaction arrives between ShapeStatus removal
   and EventRouter removal

## Severity

**Medium-High**:
- The crash would terminate the ShapeLogCollector GenServer
- This would disrupt all shape consumers for that stack
- The supervisor would restart it, but data consistency during the gap is unclear

## Timeline

- Bug introduced: Likely when RequestBatcher was added (batching made removal async)
- Developers aware: Yes (comment at shape_cache.ex:227)
- Mitigation claimed: Yes, but incorrect - the nil isn't actually filtered
