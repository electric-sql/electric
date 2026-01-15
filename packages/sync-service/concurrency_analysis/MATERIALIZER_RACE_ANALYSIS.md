# Race Condition Analysis: Materializer Startup Race

## Executive Summary

A race condition exists in the Materializer startup sequence where the Materializer can crash with
an exit (`:noproc`) if the Consumer process dies between the snapshot becoming ready and the Materializer
attempting to subscribe to it.

## The Bug

### Location
- **`lib/electric/shapes/consumer/materializer.ex:105-119`** - Materializer startup sequence
- **`lib/electric/shapes/consumer.ex:57-61`** - `subscribe_materializer` function

### Root Cause

The Materializer's `handle_continue(:start_materializer, ...)` performs three operations in sequence:
1. Wait for snapshot to start (blocking call to Consumer)
2. Subscribe to materializer updates (call to Consumer)
3. Monitor the Consumer process

If the Consumer dies between steps 1 and 2 (or 2 and 3), the subsequent calls fail catastrophically.

```elixir
# materializer.ex:105-119
def handle_continue(:start_materializer, state) do
  %{stack_id: stack_id, shape_handle: shape_handle} = state

  stack_storage = Storage.for_stack(stack_id)
  shape_storage = Storage.for_shape(shape_handle, stack_storage)

  :started = Consumer.await_snapshot_start(stack_id, shape_handle, :infinity)  # Step 1: SUCCESS

  Consumer.subscribe_materializer(stack_id, shape_handle, self())  # Step 2: CRASH if Consumer died!

  Process.monitor(Consumer.whereis(stack_id, shape_handle),  # Step 3: Also crashes on nil
    tag: {:consumer_down, state.shape_handle}
  )

  {:noreply, state, {:continue, {:read_stream, shape_storage}}}
end
```

```elixir
# consumer.ex:57-61
def subscribe_materializer(stack_id, shape_handle, pid) do
  stack_id
  |> consumer_pid(shape_handle)  # Returns nil if Consumer is dead
  |> GenServer.call({:subscribe_materializer, pid})  # GenServer.call(nil, ...) raises!
end
```

### The Race Window

```
Time ->
+-----------------------------------------------------------------------------+
| Materializer Process              | Consumer Process                        |
+-----------------------------------+-----------------------------------------+
| T1: await_snapshot_start()        |                                         |
|     - GenServer.call to Consumer  |                                         |
|     - Blocking...                 | T1.5: Process snapshot, reply :started  |
|     - Returns :started            |                                         |
+-----------------------------------+-----------------------------------------+
|                                   | T2: Consumer terminates                 |
|                                   |     (cleanup, error, timeout, etc.)     |
+-----------------------------------+-----------------------------------------+
| T3: subscribe_materializer()      |                                         |
|     - consumer_pid() returns nil  |                                         |
|     - GenServer.call(nil, ...)    |                                         |
|     - RAISES exit :noproc!       |                                         |
+-----------------------------------------------------------------------------+
```

## Impact

- **Crash**: Materializer process crashes with `exit :noproc`
- **Propagation**: Dependent shapes may become inconsistent
- **Data integrity**: Move-in/move-out operations may be disrupted
- **Severity**: Medium - The crash is contained to the Materializer, but affects dependent shapes

## Triggers

This race can be triggered when:
1. Consumer process terminates during Materializer startup (cleanup, errors, timeouts)
2. Shape is removed while Materializer is starting up
3. System is under memory pressure causing process exits
4. Any GenServer timeout or crash in the Consumer

## Recommended Fixes

### Option A: Wrap calls in try/catch with graceful shutdown

```elixir
def handle_continue(:start_materializer, state) do
  %{stack_id: stack_id, shape_handle: shape_handle} = state

  try do
    :started = Consumer.await_snapshot_start(stack_id, shape_handle, :infinity)
    Consumer.subscribe_materializer(stack_id, shape_handle, self())

    case Consumer.whereis(stack_id, shape_handle) do
      nil ->
        # Consumer died, shut down gracefully
        {:stop, :shutdown, state}
      consumer_pid ->
        Process.monitor(consumer_pid, tag: {:consumer_down, state.shape_handle})
        # ... continue setup
    end
  catch
    :exit, _ ->
      # Consumer died during calls, shut down gracefully
      {:stop, :shutdown, state}
  end
end
```

### Option B: Atomic subscription with monitoring

```elixir
# In Consumer, provide an atomic subscribe_and_monitor operation
def subscribe_materializer_with_monitor(stack_id, shape_handle, pid) do
  stack_id
  |> consumer_pid(shape_handle)
  |> case do
    nil -> {:error, :consumer_not_found}
    consumer ->
      ref = Process.monitor(consumer)
      try do
        GenServer.call(consumer, {:subscribe_materializer, pid})
        {:ok, ref}
      catch
        :exit, _ ->
          Process.demonitor(ref, [:flush])
          {:error, :consumer_died}
      end
  end
end
```

### Option C: Check Consumer existence before each step

```elixir
def handle_continue(:start_materializer, state) do
  with consumer when is_pid(consumer) <- Consumer.whereis(stack_id, shape_handle),
       :started <- Consumer.await_snapshot_start(stack_id, shape_handle, :infinity),
       consumer when is_pid(consumer) <- Consumer.whereis(stack_id, shape_handle),
       :ok <- Consumer.subscribe_materializer(stack_id, shape_handle, self()),
       consumer when is_pid(consumer) <- Consumer.whereis(stack_id, shape_handle) do
    Process.monitor(consumer, tag: {:consumer_down, state.shape_handle})
    {:noreply, state, {:continue, {:read_stream, shape_storage}}}
  else
    nil -> {:stop, :shutdown, state}
    {:error, _} -> {:stop, :shutdown, state}
  end
end
```

## Formal Verification

See `MaterializerRace.lean` for a Lean 4 model proving:
- The race window exists between await_snapshot_start and subscribe_materializer
- Consumer death in this window causes Materializer crash
- Proposed fix correctly handles Consumer death

## Code Locations

- `lib/electric/shapes/consumer/materializer.ex:105-119` - Startup sequence
- `lib/electric/shapes/consumer.ex:57-61` - subscribe_materializer function
- `lib/electric/shapes/consumer.ex:64-67` - whereis function
